import { awscdk } from 'projen';
const project = new awscdk.AwsCdkTypeScriptApp({
  cdkVersion: '2.1.0',
  defaultReleaseBranch: 'main',
  name: 'webnodets',
  projenrcTs: true,
  repository: 'https://github.com/cmorgia/webnodets.git',
  context: {
    //"@aws-cdk/core:bootstrapQualifier": "app",
  },
  deps: [ 'cdk-ecr-deployment']
  // deps: [],                /* Runtime dependencies of this module. */
  // description: undefined,  /* The description is just a string that helps people understand the purpose of the package. */
  // devDeps: [],             /* Build dependencies for this module. */
  // packageName: undefined,  /* The "name" in package.json. */
});
project.synth();