import * as pulumi from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";

// Configuration
const config = new pulumi.Config();
const projectName = "bitwarden-backup";

// Create S3 bucket for backups
const bucket = new aws.s3.Bucket(`${projectName}-bucket`, {
    bucketPrefix: `${projectName}-`,

    // Enable versioning for backup safety
    versioning: {
        enabled: true,
    },

    // Server-side encryption
    serverSideEncryptionConfiguration: {
        rule: {
            applyServerSideEncryptionByDefault: {
                sseAlgorithm: "AES256",
            },
        },
    },

    // Lifecycle rules to manage old backups
    lifecycleRules: [
        {
            enabled: true,
            id: "delete-old-backups",

            // Delete backups older than 90 days
            expiration: {
                days: 90,
            },

            // Move to cheaper storage after 30 days
            transitions: [
                {
                    days: 30,
                    storageClass: "STANDARD_IA",
                },
                {
                    days: 60,
                    storageClass: "GLACIER_IR",
                },
            ],
        },
        {
            enabled: true,
            id: "delete-old-versions",

            // Delete old versions after 30 days
            noncurrentVersionExpiration: {
                days: 30,
            },
        },
    ],

    tags: {
        Name: "Bitwarden Backup Storage",
        Purpose: "Automated backups",
        ManagedBy: "Pulumi",
    },
});

// Block all public access to the bucket
const bucketPublicAccessBlock = new aws.s3.BucketPublicAccessBlock(`${projectName}-public-access-block`, {
    bucket: bucket.id,
    blockPublicAcls: true,
    blockPublicPolicy: true,
    ignorePublicAcls: true,
    restrictPublicBuckets: true,
});

// Create IAM user for backup operations
const backupUser = new aws.iam.User(`${projectName}-user`, {
    name: `${projectName}-user`,
    tags: {
        Purpose: "Bitwarden backup automation",
        ManagedBy: "Pulumi",
    },
});

// Create IAM policy for the backup user
const backupUserPolicy = new aws.iam.UserPolicy(`${projectName}-user-policy`, {
    user: backupUser.name,
    policy: pulumi.all([bucket.arn]).apply(([bucketArn]) => JSON.stringify({
        Version: "2012-10-17",
        Statement: [
            {
                Effect: "Allow",
                Action: [
                    "s3:PutObject",
                    "s3:PutObjectAcl",
                    "s3:GetObject",
                    "s3:ListBucket",
                    "s3:DeleteObject",
                ],
                Resource: [
                    bucketArn,
                    `${bucketArn}/*`,
                ],
            },
        ],
    })),
});

// Create access key for the backup user
const backupUserAccessKey = new aws.iam.AccessKey(`${projectName}-access-key`, {
    user: backupUser.name,
});

// Export the bucket name and user credentials
export const bucketName = bucket.id;
export const bucketArn = bucket.arn;
export const region = aws.config.region;
export const accessKeyId = backupUserAccessKey.id;
export const secretAccessKey = backupUserAccessKey.secret;

// Export configuration for .env file
export const envConfig = pulumi.interpolate`
# AWS S3 Backup Configuration
AWS_ACCESS_KEY_ID=${backupUserAccessKey.id}
AWS_SECRET_ACCESS_KEY=${backupUserAccessKey.secret}
AWS_REGION=${aws.config.region}
S3_BUCKET=${bucket.id}
S3_PREFIX=bitwarden/
`;

// Export summary
export const summary = pulumi.interpolate`
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Bitwarden Backup Infrastructure Created!
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

S3 Bucket: ${bucket.id}
Region: ${aws.config.region}
IAM User: ${backupUser.name}

Features Enabled:
✓ Server-side encryption (AES256)
✓ Versioning enabled
✓ Public access blocked
✓ Lifecycle policies:
  - Move to cheaper storage after 30 days
  - Archive to Glacier after 60 days
  - Delete backups after 90 days
  - Delete old versions after 30 days

Next Steps:
1. Copy the credentials above to your .env file
2. Run: docker compose up -d --build backup
3. Test: docker compose exec backup /usr/local/bin/backup.sh

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`;
