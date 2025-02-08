import { IAspect, CfnResource, Stack } from 'aws-cdk-lib';
import { IConstruct } from 'constructs';

export class IAMResourcePatcherAspect implements IAspect {
  /**
   * An Aspect that patches IAM resources (roles, policies, and instance profiles) so that they
   * conform to the new IAM permissions model.
   *
   * The IAM resources must satisfy the following requirements:
   * - IAM roles must be placed under the `/approles/` path with a permissions boundary attached
   *     - AppPermissionsBoundary for application-like permissions
   *     - CustomResourcePermissionsBoundary for permissions required by custom resources
   * - IAM policies must be placed under the "/apppolicies/" path
   * - IAM instance profiles must be placed under the "/appinstanceprofiles/" path
   *
   * Note: In some cases, resources are added to the node tree as `aws_cdk.CfnResource` instances.
   * To make sure we process all IAM resources, we check `if isinstance(node, aws_cdk.CfnResource)`
   * instead of e.g., `if isinstance(node, aws_iam.CfnRole)`.
   *
   * @param crRoleIds A list of IAM role logical IDs created by custom resource(s) that will be
   * placed under the "/approles/cr/" path with the CustomResourcePermissionsBoundary attached
   */
  private readonly crRoleIds: string[];

  constructor(crRoleIds: string[] = []) {
    this.crRoleIds = crRoleIds;
  }

  visit(node: IConstruct): void {
    if (node instanceof CfnResource) {
      const logicalId = Stack.of(node).resolve(node.logicalId) as string;
      const accountId = Stack.of(node).account;

      if (node.cfnResourceType === 'AWS::IAM::Role') {
        if (this.crRoleIds.some(role => logicalId.includes(role))) {
          node.addPropertyOverride('Path', '/approles/cr/');
          node.addPropertyOverride(
            'PermissionsBoundary',
            `arn:aws:iam::${accountId}:policy/CustomResourcePermissionsBoundary-V1`
          );
        } else {
          node.addPropertyOverride('Path', '/approles/');
          node.addPropertyOverride(
            'PermissionsBoundary',
            `arn:aws:iam::${accountId}:policy/AppPermissionsBoundary-V1`
          );
        }
      }

      if (node.cfnResourceType === 'AWS::IAM::ManagedPolicy') {
        node.addPropertyOverride('Path', '/apppolicies/');
      }

      if (node.cfnResourceType === 'AWS::IAM::InstanceProfile') {
        node.addPropertyOverride('Path', '/appinstanceprofiles/');
      }
    }
  }
}