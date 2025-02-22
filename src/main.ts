import { App, CfnOutput, RemovalPolicy, Stack, StackProps } from 'aws-cdk-lib';
import { BuildSpec, PipelineProject } from 'aws-cdk-lib/aws-codebuild';
import { Artifact, Pipeline, PipelineType } from 'aws-cdk-lib/aws-codepipeline';
import { CodeBuildAction, EcrSourceAction, EcsDeployAction, StepFunctionInvokeAction } from 'aws-cdk-lib/aws-codepipeline-actions';
import { Repository } from 'aws-cdk-lib/aws-ecr';
import { DockerImageAsset, Platform } from 'aws-cdk-lib/aws-ecr-assets';
import { ContainerImage, FargateTaskDefinition, FirelensConfigFileType, FireLensLogDriver, FirelensLogRouterType, ICluster, LogDrivers, PropagatedTagSource, TaskDefinition } from 'aws-cdk-lib/aws-ecs';
import { ApplicationLoadBalancedFargateService } from 'aws-cdk-lib/aws-ecs-patterns';
import { Effect, PolicyStatement } from 'aws-cdk-lib/aws-iam';
import { LogGroup, RetentionDays } from 'aws-cdk-lib/aws-logs';
import { IntegrationPattern, StateMachine } from 'aws-cdk-lib/aws-stepfunctions';
import { EcsFargateLaunchTarget, EcsRunTask } from 'aws-cdk-lib/aws-stepfunctions-tasks';
import { Construct } from 'constructs';
import path from 'path';

export class MyStack extends Stack {
  constructor(scope: Construct, id: string, props: StackProps = {}) {
    super(scope, id, props);

    const ecrRepo = new Repository(this, 'webnodets-repo', {
      repositoryName: 'webnodets-repo',
      removalPolicy: RemovalPolicy.DESTROY
    });

    const logGroup1 = new LogGroup(this, 'LogGroup1', {
      logGroupName: '/ecs/myapp/stream1',
      retention: RetentionDays.ONE_WEEK,
      removalPolicy: RemovalPolicy.DESTROY,
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
            log_stream_prefix: 'webnodets-prefix1',
            auto_create_group: 'true',
            log_key: 'log',
            path: '/path/to/first/logfile.log'
          },
        })
      },
    });

    // Create an asset from your local config file
    this.addFirelensConfiguration(srv.taskDefinition, logGroup1);

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
    stateMachine.addToRolePolicy(new PolicyStatement({
      effect: Effect.ALLOW,
      actions: [
        'cloudwatch:PutManagedInsightRules',
        'cloudwatch:DeleteInsightRules',
        'cloudwatch:DescribeInsightRules',
        'states:CreateManagedRule',
        'states:DeleteManagedRule',
        'states:DescribeManagedRule',
        'states:ListManagedRules',
      ],
      resources: ['*']
    }));

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

  private addFirelensConfiguration(taskDefinition: FargateTaskDefinition, logGroup: LogGroup) {
    taskDefinition.addToTaskRolePolicy(new PolicyStatement({
      effect: Effect.ALLOW,
      actions: [
        'logs:CreateLogStream',
        'logs:CreateLogGroup',
        'logs:DescribeLogStreams',
        'logs:PutLogEvents'
      ],
      resources: [
        logGroup.logGroupArn,
        `${logGroup.logGroupArn}:*`,
      ]
    }));

    const asset = new DockerImageAsset(this, 'MyBuildImage', {
      directory: path.join(__dirname, 'docker/fluent'),
      platform: Platform.LINUX_AMD64,
    });

    taskDefinition.addFirelensLogRouter('FirelensLogRouter', {
      image: ContainerImage.fromDockerImageAsset(asset),
      firelensConfig: {
        type: FirelensLogRouterType.FLUENTBIT,
        options: {
          configFileType: FirelensConfigFileType.FILE,
          configFileValue: '/fluent-bit/etc/fluent-bit.conf',
        },
      },
      // Add memory limits to ensure the router has enough resources
      memoryReservationMiB: 50,
      logging: LogDrivers.awsLogs({
        streamPrefix: 'firelens',
        logGroup: new LogGroup(this, 'FirelensLogGroup', {
          logGroupName: '/ecs/firelens',
          retention: RetentionDays.ONE_WEEK,
          removalPolicy: RemovalPolicy.DESTROY,
        }),
      }),
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