import { App, Aspects, CfnOutput, RemovalPolicy, Stack, StackProps } from 'aws-cdk-lib';
import { BuildSpec, PipelineProject } from 'aws-cdk-lib/aws-codebuild';
import { Artifact, Pipeline, PipelineType } from 'aws-cdk-lib/aws-codepipeline';
import { CodeBuildAction, EcrSourceAction, EcsDeployAction, StepFunctionInvokeAction } from 'aws-cdk-lib/aws-codepipeline-actions';
import { Repository } from 'aws-cdk-lib/aws-ecr';
import { ContainerImage, FargateTaskDefinition, FirelensConfigFileType, FireLensLogDriver, FirelensLogRouterType, ICluster, PropagatedTagSource, TaskDefinition } from 'aws-cdk-lib/aws-ecs';
import { ApplicationLoadBalancedFargateService } from 'aws-cdk-lib/aws-ecs-patterns';
import { Asset } from 'aws-cdk-lib/aws-s3-assets';
import { IntegrationPattern, StateMachine } from 'aws-cdk-lib/aws-stepfunctions';
import { EcsFargateLaunchTarget, EcsRunTask } from 'aws-cdk-lib/aws-stepfunctions-tasks';
import { Construct } from 'constructs';
import path from 'path';
import { IAMResourcePatcherAspect } from './aspects';

export class MyStack extends Stack {
  constructor(scope: Construct, id: string, props: StackProps = {}) {
    super(scope, id, props);

    const ecrRepo = new Repository(this, 'webnodets-repo', {
      repositoryName: 'webnodets-repo',
      removalPolicy: RemovalPolicy.DESTROY
    });

    const srv = new ApplicationLoadBalancedFargateService(this, 'webnodets-service', {
      minHealthyPercent: 50,
      desiredCount: 1,
      taskImageOptions: {
        image: ContainerImage.fromEcrRepository(ecrRepo),
        containerName: 'webnodets-service',
        logDriver: new FireLensLogDriver({
          options: {
            Name: 'cloudwatch',
            region: 'eu-central-1',
            log_group_name: '/aws/ecs/webnodets-service',
            log_stream_prefix: 'webnodets-app',
            // Configure multiple log files
            log_key: '*',
            extra_options: JSON.stringify({
              "log_file_1": {
                "path": "/path/to/first/log/file.log",
                "stream_name": "stream1"
              },
              "log_file_2": {
                "path": "/path/to/second/log/file.log",
                "stream_name": "stream2"
              }
            }),
          },
        })
      },
    });

    // Create an asset from your local config file
    this.addFirelensConfiguration(srv.taskDefinition);

    const pipeline = new Pipeline(this, 'webnodets-pipeline', {
      pipelineName: 'webnodets-pipeline',
      pipelineType: PipelineType.V2
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

    this.addLeaderToPipeline(srv.cluster, srv.service.taskDefinition, pipeline);

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

  private addLeaderToPipeline(cluster: ICluster, taskDefinition: TaskDefinition, pipeline: Pipeline) {
    const runTask = new EcsRunTask(this, 'RunFargate', {
      integrationPattern: IntegrationPattern.RUN_JOB,
      cluster: cluster,
      taskDefinition: taskDefinition,
      assignPublicIp: true,
      containerOverrides: [{
        containerDefinition: taskDefinition.defaultContainer!,
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
  }

  private addFirelensConfiguration(taskDef: FargateTaskDefinition) {
    const firelensConfigAsset = new Asset(this, 'FirelensConfigAsset', {
      path: path.join(__dirname, 'config/fluent-bit.conf')
    });

    taskDef.addFirelensLogRouter('FirelensLogRouter', {
      image: ContainerImage.fromRegistry('amazon/aws-for-fluent-bit:latest'),
      firelensConfig: {
        type: FirelensLogRouterType.FLUENTBIT,
        options: {
          configFileType: FirelensConfigFileType.S3,
          configFileValue: `${firelensConfigAsset.s3BucketName}/${firelensConfigAsset.s3ObjectKey}`,
        },
      },
      // Add memory limits to ensure the router has enough resources
      memoryReservationMiB: 50
    });

    // Grant read permissions to the task role
    firelensConfigAsset.grantRead(taskDef.taskRole);
  }
}

// for development, use account/region from cdk cli
const devEnv = {
  account: process.env.CDK_DEFAULT_ACCOUNT,
  region: process.env.CDK_DEFAULT_REGION,
};

const app = new App();
Aspects.of(app).add(new IAMResourcePatcherAspect());

new MyStack(app, 'webnodets-dev', { env: devEnv });
// new MyStack(app, 'webnodets-prod', { env: prodEnv });

app.synth();