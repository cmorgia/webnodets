import { App, Stack, StackProps } from 'aws-cdk-lib';
import { Artifact, Pipeline } from 'aws-cdk-lib/aws-codepipeline';
import { EcrSourceAction, EcsDeployAction, StepFunctionInvokeAction } from 'aws-cdk-lib/aws-codepipeline-actions';
import { Repository } from 'aws-cdk-lib/aws-ecr';
import { DockerImageAsset } from 'aws-cdk-lib/aws-ecr-assets';
import { ContainerImage, PropagatedTagSource } from 'aws-cdk-lib/aws-ecs';
import { ApplicationLoadBalancedFargateService } from 'aws-cdk-lib/aws-ecs-patterns';
import { IntegrationPattern, StateMachine } from 'aws-cdk-lib/aws-stepfunctions';
import { EcsFargateLaunchTarget, EcsRunTask } from 'aws-cdk-lib/aws-stepfunctions-tasks';
import { Construct } from 'constructs';
import path from 'path';
import * as ecrdeploy from 'cdk-ecr-deployment';

export class MyStack extends Stack {
  constructor(scope: Construct, id: string, props: StackProps = {}) {
    super(scope, id, props);

    const ecrRepo = new Repository(this, 'webnodets-repo', {
      repositoryName: 'webnodets-repo',
    });

    const image = new DockerImageAsset(this, 'webnodets-image', {
      directory: path.join(__dirname, 'docker'),
    });

    new ecrdeploy.ECRDeployment(this, 'DeployDockerImage', {
      src: new ecrdeploy.DockerImageName(image.imageUri),
      dest: new ecrdeploy.DockerImageName(`${props.env?.account}.dkr.ecr.${props.env?.region}.amazonaws.com/webnodets:latest`),
    });

    const srv = new ApplicationLoadBalancedFargateService(this, 'webnodets-service', {
      taskImageOptions: {
        image: ContainerImage.fromEcrRepository(ecrRepo),
      },
    });

    const pipeline = new Pipeline(this, 'webnodets-pipeline', {
      pipelineName: 'webnodets-pipeline',
    });

    const sourceOutput = new Artifact();
    
    pipeline.addStage({
      stageName: 'Source',
      actions: [ 
        new EcrSourceAction({
          actionName: 'EcrSource',
          repository: ecrRepo,
          output: sourceOutput,
        }),
       ],
    });

    const runTask = new EcsRunTask(this, 'RunFargate', {
      integrationPattern: IntegrationPattern.RUN_JOB,
      cluster: srv.cluster,
      taskDefinition: srv.taskDefinition,
      assignPublicIp: true,
      containerOverrides: [{
        containerDefinition: srv.taskDefinition.defaultContainer!,
        environment: [{ name: 'type', value: "leader" }],
      }],
      launchTarget: new EcsFargateLaunchTarget(),
      propagatedTagSource: PropagatedTagSource.TASK_DEFINITION,
    });

    const stateMachine = new StateMachine(this, 'StateMachine', {
      definition: runTask,
    });

    pipeline.addStage({
      stageName: 'RunTask',
      actions: [
        new StepFunctionInvokeAction({
          actionName: 'InvokeStepFunction',
          stateMachine,
        }),
      ],
    });

    // add a pipeline stage to redeploy the service srv.service based on the new image
    pipeline.addStage({
      stageName: 'Deploy',
      actions: [
        new EcsDeployAction({
          actionName: 'DeployAction',
          service: srv.service,
          input: sourceOutput,
        }),
      ],
    });
  }
}

// for development, use account/region from cdk cli
const devEnv = {
  account: process.env.CDK_DEFAULT_ACCOUNT,
  region: process.env.CDK_DEFAULT_REGION,
};

const app = new App();
//Aspects.of(app).add(new IAMResourcePatcherAspect());

new MyStack(app, 'webnodets-dev', { env: devEnv });
// new MyStack(app, 'webnodets-prod', { env: prodEnv });

app.synth();