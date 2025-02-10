import { App, CfnOutput, RemovalPolicy, Stack, StackProps } from 'aws-cdk-lib';
import { BuildSpec, PipelineProject } from 'aws-cdk-lib/aws-codebuild';
import { Artifact, Pipeline } from 'aws-cdk-lib/aws-codepipeline';
import { CodeBuildAction, EcrSourceAction, EcsDeployAction, StepFunctionInvokeAction } from 'aws-cdk-lib/aws-codepipeline-actions';
import { Repository } from 'aws-cdk-lib/aws-ecr';
import { ContainerImage, PropagatedTagSource } from 'aws-cdk-lib/aws-ecs';
import { ApplicationLoadBalancedFargateService } from 'aws-cdk-lib/aws-ecs-patterns';
import { IntegrationPattern, StateMachine } from 'aws-cdk-lib/aws-stepfunctions';
import { EcsFargateLaunchTarget, EcsRunTask } from 'aws-cdk-lib/aws-stepfunctions-tasks';
import { Construct } from 'constructs';

export class MyStack extends Stack {
  constructor(scope: Construct, id: string, props: StackProps = {}) {
    super(scope, id, props);

    const ecrRepo = new Repository(this, 'webnodets-repo', {
      repositoryName: 'webnodets-repo',
      removalPolicy: RemovalPolicy.DESTROY
    });

    const srv = new ApplicationLoadBalancedFargateService(this, 'webnodets-service', {
      taskImageOptions: {
        image: ContainerImage.fromEcrRepository(ecrRepo),
        containerName: 'webnodets-service',
      },
    });

    const pipeline = new Pipeline(this, 'webnodets-pipeline', {
      pipelineName: 'webnodets-pipeline',
    });

    const sourceOutput = new Artifact();
    const buildOutput = new Artifact('BuildOutput');
    
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

    const buildProject = new PipelineProject(this, 'BuildProject', {
      buildSpec: BuildSpec.fromObject({
        version: '0.2',
        phases: {
          build: {
            commands: [
              'echo "[{\\"name\\":\\"webnodets-service\\",\\"imageUri\\":\\"$REPOSITORY_URI:latest\\"}]" > imagedefinitions.json'
            ],
          },
        },
        artifacts: {
          files: 'imagedefinitions.json',
        },
      }),
      environmentVariables: {
        REPOSITORY_URI: {
          value: ecrRepo.repositoryUri,
        },
      },
    });

    pipeline.addStage({
      stageName: 'Build',
      actions: [
        new CodeBuildAction({
          actionName: 'CodeBuild',
          project: buildProject,
          input: sourceOutput,
          outputs: [buildOutput],
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
        environment: [{ name: 'WORKER_TYPE', value: "leader" }],
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
          input: buildOutput,
        }),
      ],
    });

    new CfnOutput(this, 'LoadBalancerDNS', {
      value: `http://${srv.loadBalancer.loadBalancerDnsName}`
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