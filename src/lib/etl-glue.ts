import * as path from 'path';
import { IVpc, Port, SecurityGroup, ISecurityGroup } from '@aws-cdk/aws-ec2';
import { Database, DataFormat, Table, Schema, CfnJob, CfnConnection, CfnCrawler } from '@aws-cdk/aws-glue';
import { CompositePrincipal, ManagedPolicy, PolicyDocument, PolicyStatement, ServicePrincipal, Role } from '@aws-cdk/aws-iam';
import { IBucket, Bucket, BucketEncryption } from '@aws-cdk/aws-s3';
import { BucketDeployment, Source } from '@aws-cdk/aws-s3-deployment';
import { Aws, Construct, RemovalPolicy, Stack, CfnMapping } from '@aws-cdk/core';
import { artifactHash } from './utils';

export interface ETLProps {
  bucket: IBucket;
  s3Prefix?: string;
  vpc: IVpc;
  transactionPrefix: string;
  identityPrefix: string;
  neptune: {
    endpoint: string;
    port: string;
    clusterResourceId: string;
  };
}

export class ETLByGlue extends Construct {
  readonly crawlerName: string;
  readonly jobName: string;
  readonly processedOutputPrefix: string;
  readonly glueJobSG: ISecurityGroup;

  constructor(scope: Construct, id: string, props: ETLProps) {
    super(scope, id);

    const glueJobBucket = new Bucket(this, 'GlueJobBucket', {
      encryption: BucketEncryption.S3_MANAGED,
      autoDeleteObjects: true,
      removalPolicy: RemovalPolicy.DESTROY,
    });

    const transactionDatabase = new Database(this, 'FraudDetectionDatabase', {
      databaseName: 'frand_detection_db',
    });

    const transactionTable = new Table(this, 'TransactionTable', {
      database: transactionDatabase,
      tableName: 'transaction',
      description: 'Transaction Table',
      columns: [
        { name: 'transactionid', type: Schema.STRING },
      ],
      dataFormat: DataFormat.PARQUET,
      bucket: props.bucket,
      s3Prefix: props.transactionPrefix,
      storedAsSubDirectories: true,
    });

    const identityTable = new Table(this, 'IdentityTable', {
      database: transactionDatabase,
      tableName: 'identity',
      description: 'Identity Table',
      columns: [
        { name: 'transactionid', type: Schema.STRING },
      ],
      dataFormat: DataFormat.PARQUET,
      bucket: props.bucket,
      s3Prefix: props.identityPrefix,
      storedAsSubDirectories: true,
    });

    // create crawler to update tables
    const crawlerRole = new Role(this, 'DataCrawlerRole', {
      assumedBy: new CompositePrincipal(
        new ServicePrincipal('glue.amazonaws.com')),
      managedPolicies: [ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSGlueServiceRole')],
    });
    props.bucket.grantRead(crawlerRole, `${props.s3Prefix ?? '/'}*`);
    const crawler = new CfnCrawler(this, 'DataCrawler', {
      role: crawlerRole.roleArn,
      targets: {
        catalogTargets: [{
          databaseName: transactionDatabase.databaseName,
          tables: [
            transactionTable.tableName,
            identityTable.tableName,
          ],
        }],
      },
      databaseName: transactionDatabase.databaseName,
      description: 'The crawler updates tables in Data Catalog.',
      schemaChangePolicy: {
        updateBehavior: 'UPDATE_IN_DATABASE',
        deleteBehavior: 'LOG',
      },
    });
    this.crawlerName = crawler.ref;

    this.glueJobSG = new SecurityGroup(this, 'GlueJobSG', {
      vpc: props.vpc,
      allowAllOutbound: true,
    });
    this.glueJobSG.addIngressRule(this.glueJobSG, Port.allTraffic());
    // TODO: get resource name from CfnConnection
    const networkConn = new CfnConnection(this, 'NetworkConnection', {
      catalogId: transactionDatabase.catalogId,
      connectionInput: {
        connectionType: 'NETWORK',
        connectionProperties: {},
        physicalConnectionRequirements: {
          availabilityZone: props.vpc.privateSubnets[0].availabilityZone,
          subnetId: props.vpc.privateSubnets[0].subnetId,
          securityGroupIdList: [
            this.glueJobSG.securityGroupId,
          ],
        },
      },
    });
    const connName = networkConn.ref;

    const glueJobRole = new Role(this, 'GlueJobRole', {
      assumedBy: new CompositePrincipal(
        new ServicePrincipal('glue.amazonaws.com')),
      managedPolicies: [ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSGlueServiceRole')],
      inlinePolicies: {
        glue: new PolicyDocument({
          statements: [
            new PolicyStatement({
              actions: ['glue:GetConnection'],
              resources: [
                transactionDatabase.catalogArn,
                Stack.of(this).formatArn({
                  service: 'glue',
                  resource: 'connection',
                  resourceName: connName,
                }),
              ],
            }),
          ],
        }),
        neptune: new PolicyDocument({
          statements: [
            new PolicyStatement({
              actions: ['neptune-db:connect'],
              resources: [
                Stack.of(this).formatArn({
                  service: 'neptune-db',
                  resource: props.neptune.clusterResourceId,
                  resourceName: '*',
                }),
              ],
            }),
          ],
        }),
      },
    });
    identityTable.grantRead(glueJobRole);
    transactionTable.grantRead(glueJobRole);


    glueJobBucket.grantReadWrite(glueJobRole, 'tmp/*');
    const scriptPrefix = this._deployGlueArtifact(glueJobBucket,
      path.join(__dirname, '../scripts/glue-etl.py'), 'src/scripts/');
    glueJobBucket.grantRead(glueJobRole, `${scriptPrefix}/*`);

    const neptuneGlueConnectorLibName = 'neptune_python_utils.zip';
    const libPrefix = this._deployGlueArtifact(glueJobBucket,
      path.join(__dirname, `../script-libs/amazon-neptune-tools/neptune-python-utils/target/${neptuneGlueConnectorLibName}`),
      'src/script-libs/amazon-neptune-tools/neptune-python-utils/target/');
    glueJobBucket.grantRead(glueJobRole, `${libPrefix}/*`);

    const glueVersionMapping = new CfnMapping(this, 'GlueVersionMapping', {
      mapping: {
        'aws': {
          glueVersion: '2.0',
        },
        'aws-cn': {
          glueVersion: '1.0',
        },
      },
    });
    const outputPrefix = `${props.s3Prefix ?? ''}processed-data/`;
    const etlJob = new CfnJob(this, 'PreprocessingJob', {
      command: {
        name: 'glueetl',
        pythonVersion: '3',
        scriptLocation: glueJobBucket.s3UrlForObject(`${scriptPrefix}/glue-etl.py`),
      },
      defaultArguments: {
        '--region': Aws.REGION,
        '--database': transactionDatabase.databaseName,
        '--transaction_table': transactionTable.tableName,
        '--identity_table': identityTable.tableName,
        '--id_cols': 'card1,card2,card3,card4,card5,card6,ProductCD,addr1,addr2,P_emaildomain,R_emaildomain',
        '--cat_cols': 'M1,M2,M3,M4,M5,M6,M7,M8,M9',
        '--output_prefix': props.bucket.s3UrlForObject(outputPrefix),
        '--job-language': 'python',
        '--job-bookmark-option': 'job-bookmark-disable',
        '--TempDir': glueJobBucket.s3UrlForObject('tmp/'),
        '--enable-continuous-cloudwatch-log': 'true',
        '--enable-continuous-log-filter': 'false',
        '--enable-metrics': '',
        '--extra-py-files': [glueJobBucket.s3UrlForObject(`${libPrefix}/${neptuneGlueConnectorLibName}`)].join(','),
        '--neptune_endpoint': props.neptune.endpoint,
        '--neptune_port': props.neptune.port,
      },
      role: glueJobRole.roleArn,
      workerType: 'G.2X',
      numberOfWorkers: 2,
      glueVersion: glueVersionMapping.findInMap(Aws.PARTITION, 'glueVersion'),
      connections: {
        connections: [
          connName,
        ],
      },
    });
    props.bucket.grantWrite(glueJobRole, `${outputPrefix}*`);
    this.jobName = etlJob.ref;
    this.processedOutputPrefix = outputPrefix;
  }

  private _deployGlueArtifact(targetBucket: IBucket, artifactPath: string, assetPath: string): string {
    const hex = artifactHash(artifactPath);
    const scriptPrefix = `artifacts/${hex}`;
    new BucketDeployment(this, `GlueJobArtifact-${hex.substring(0, 8)}`, {
      sources: [Source.asset(assetPath)],
      destinationBucket: targetBucket,
      destinationKeyPrefix: scriptPrefix,
      prune: false,
      retainOnDelete: false,
    });
    return scriptPrefix;
  }
}