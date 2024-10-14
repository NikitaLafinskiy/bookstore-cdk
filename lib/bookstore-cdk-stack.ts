import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as ecs_patterns from 'aws-cdk-lib/aws-ecs-patterns';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as rds from 'aws-cdk-lib/aws-rds';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as dotenv from 'dotenv';
dotenv.config();

export class BookstoreCdkStack extends cdk.Stack {
  private readonly CONTAINER_IMAGE: string = 'amazon/amazon-ecs-sample';

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // Create VPC
    const vpc = new ec2.Vpc(this, 'BookStoreVpc', {
      maxAzs: 2,
      subnetConfiguration: [
        { cidrMask: 24, name: 'Public', subnetType: ec2.SubnetType.PUBLIC },
        { cidrMask: 24, name: 'Private', subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS }
      ]
    });

    // Create ECS Cluster
    const cluster = new ecs.Cluster(this, 'BookStoreCluster', { vpc });

    // Create Fargate Service
    const fargateService = new ecs_patterns.ApplicationLoadBalancedFargateService(this, "BookStoreFargate", {
      cluster,
      taskImageOptions: {
        image: ecs.ContainerImage.fromRegistry(this.CONTAINER_IMAGE),
      },
    });

    // Database configuration
    const dbName = process.env.DB_NAME;
    const dbUsername = process.env.DB_USER;
    const engineVersion = rds.MysqlEngineVersion.VER_8_0;
    const instanceType = ec2.InstanceType.of(ec2.InstanceClass.T2, ec2.InstanceSize.MICRO);

    // Create security group for the database
    const dbSecurityGroup = new ec2.SecurityGroup(this, 'DatabaseSecurityGroup', {
      vpc,
      allowAllOutbound: true,
      description: 'Security group for Bookstore Database',
    });

    // Allow inbound traffic from the Fargate service
    dbSecurityGroup.addIngressRule(
        fargateService.service.connections.securityGroups[0],
        ec2.Port.tcp(3306),
        'Allow MySQL access from Fargate service'
    );

    // Create a secret for database credentials
    const databaseCredentialsSecret = new secretsmanager.Secret(this, 'DBCredentialsSecret', {
      secretName: `${dbName}Credentials`,
      generateSecretString: {
        secretStringTemplate: JSON.stringify({ username: dbUsername }),
        excludePunctuation: true,
        includeSpace: false,
        generateStringKey: 'password'
      }
    });

    // Create RDS instance
    const rdsInstance = new rds.DatabaseInstance(this, 'BookstoreDatabase', {
      engine: rds.DatabaseInstanceEngine.mysql({ version: engineVersion }),
      instanceType: instanceType,
      credentials: rds.Credentials.fromSecret(databaseCredentialsSecret),
      databaseName: dbName,
      vpc: vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
      securityGroups: [dbSecurityGroup],
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      deletionProtection: false,
      backupRetention: cdk.Duration.days(7),
      allocatedStorage: 20,
      maxAllocatedStorage: 30,
      allowMajorVersionUpgrade: false,
      autoMinorVersionUpgrade: true,
      publiclyAccessible: false,
      multiAz: false,
      storageEncrypted: true,
      monitoringInterval: cdk.Duration.seconds(60),
      enablePerformanceInsights: false,
    });

    // Add environment variables to the Fargate task
    fargateService.taskDefinition.addContainer('bookstore-app', {
      image: ecs.ContainerImage.fromRegistry(this.CONTAINER_IMAGE),
      environment: {
        DB_HOST: rdsInstance.dbInstanceEndpointAddress,
        DB_NAME: dbName!,
        DB_USER: dbUsername!,
      },
      secrets: {
        DB_PASSWORD: ecs.Secret.fromSecretsManager(databaseCredentialsSecret, 'password'),
      },
    });

    // Outputs
    // new cdk.CfnOutput(this, 'DatabaseEndpoint', {
    //   value: rdsInstance.dbInstanceEndpointAddress,
    //   description: 'Database Endpoint',
    // });
    //
    // new cdk.CfnOutput(this, 'DatabaseName', {
    //   value: dbName!,
    //   description: 'Database Name',
    // });
    //
    // new cdk.CfnOutput(this, 'DatabaseUsername', {
    //   value: dbUsername!,
    //   description: 'Database Username',
    // });
    //
    // new cdk.CfnOutput(this, 'LoadBalancerDNS', {
    //   value: fargateService.loadBalancer.loadBalancerDnsName,
    //   description: 'Load Balancer DNS',
    // });
  }
}

const app = new cdk.App();
new BookstoreCdkStack(app, 'BookstoreCdkStack');
app.synth();