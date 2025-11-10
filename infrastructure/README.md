# Bitwarden Backup Infrastructure

This directory contains Pulumi infrastructure-as-code to provision AWS resources for Bitwarden backup storage.

## What Gets Created

- **S3 Bucket**: Encrypted storage for backups with versioning
- **IAM User**: Dedicated user for backup operations
- **Access Keys**: Credentials for the backup container
- **Lifecycle Policies**: Automatic cost optimization and cleanup

### Features

✅ **Server-side encryption** (AES256)
✅ **Versioning** enabled for backup safety
✅ **Public access** completely blocked
✅ **Lifecycle policies**:
  - Move to Standard-IA (cheaper) after 30 days
  - Archive to Glacier Instant Retrieval after 60 days
  - Delete backups after 90 days
  - Delete old versions after 30 days

## Prerequisites

1. **AWS Account** with permissions to create S3 buckets and IAM users
2. **AWS CLI** configured with credentials:
   ```bash
   aws configure
   ```
3. **Node.js** 18+ and npm installed
4. **Pulumi CLI** installed:
   ```bash
   # macOS
   brew install pulumi/tap/pulumi

   # Linux/WSL
   curl -fsSL https://get.pulumi.com | sh

   # Windows
   choco install pulumi
   ```

## Setup & Deployment

### 1. Install Dependencies

```bash
cd infrastructure
npm install
```

### 2. Login to Pulumi

You can use Pulumi Cloud (free) or local state:

**Option A: Pulumi Cloud (Recommended)**
```bash
pulumi login
```

**Option B: Local State**
```bash
pulumi login --local
```

### 3. Initialize Pulumi Stack

```bash
# Create a new stack (e.g., "prod")
pulumi stack init prod

# Set AWS region (default is eu-west-2)
pulumi config set aws:region eu-west-2
```

### 4. Preview Changes

```bash
pulumi preview
```

### 5. Deploy Infrastructure

```bash
pulumi up
```

Review the changes and select "yes" to deploy.

### 6. Get Credentials

After deployment, Pulumi will output the credentials:

```bash
# View all outputs
pulumi stack output

# Get formatted .env config
pulumi stack output envConfig

# Get individual values
pulumi stack output bucketName
pulumi stack output accessKeyId
pulumi stack output secretAccessKey --show-secrets
```

### 7. Update .env File

Copy the credentials to your main `.env` file:

```bash
# From infrastructure directory
cd ..
nano .env
```

Add the output values to your `.env` file.

## Commands

```bash
# Preview changes
pulumi preview

# Deploy/update infrastructure
pulumi up

# Destroy all resources
pulumi destroy

# View current stack outputs
pulumi stack output

# View secret values
pulumi stack output secretAccessKey --show-secrets

# Switch between stacks
pulumi stack select <stack-name>

# View stack configuration
pulumi config

# Export stack state
pulumi stack export > stack-backup.json
```

## Cost Estimation

**Estimated monthly cost** (assuming 365MB daily backup):

| Storage Tier | Days | Size | Cost (eu-west-2) |
|-------------|------|------|------------------|
| Standard | 0-30 | ~10GB | ~$0.25/month |
| Standard-IA | 30-60 | ~10GB | ~$0.13/month |
| Glacier IR | 60-90 | ~10GB | ~$0.04/month |
| **Total** | | | **~$0.42/month** |

Plus minimal costs for:
- Requests: ~$0.01/month
- Data transfer: Free (in)

**Note**: Costs are estimates. Actual costs depend on backup size and frequency.

## Security Best Practices

1. **Never commit credentials** to git (already in .gitignore)
2. **Use separate AWS account** for backups if possible
3. **Enable MFA** on your AWS root account
4. **Review IAM permissions** regularly
5. **Rotate access keys** periodically:
   ```bash
   # Create new access key
   aws iam create-access-key --user-name bitwarden-backup-user

   # Delete old key
   aws iam delete-access-key --user-name bitwarden-backup-user --access-key-id OLD_KEY_ID
   ```

## Customization

### Change Backup Retention

Edit `index.ts` and modify the lifecycle rules:

```typescript
expiration: {
    days: 180,  // Keep backups for 6 months instead of 90 days
},
```

Then run:
```bash
pulumi up
```

### Change Storage Transitions

```typescript
transitions: [
    {
        days: 7,  // Move to IA after 7 days
        storageClass: "STANDARD_IA",
    },
],
```

### Use Different Region

```bash
pulumi config set aws:region us-east-1
pulumi up
```

## Troubleshooting

### "SyntaxError: Unexpected token" or Node.js version issues

If you see errors like:
```
SyntaxError: Unexpected token '.'
```

This means you're running an outdated version of Node.js. Check your version:
```bash
node --version
```

You need **Node.js 18 or higher**. To upgrade:

**Using nvm (recommended):**
```bash
# Install Node.js 20 (LTS)
nvm install 20
nvm use 20

# Verify the version
node --version
```

**After upgrading, reinstall dependencies:**
```bash
cd infrastructure
rm -rf node_modules package-lock.json
npm install
pulumi preview
```

### "No credentials found"

Make sure AWS CLI is configured:
```bash
aws configure
aws sts get-caller-identity
```

Alternatively, export AWS credentials:
```bash
export AWS_ACCESS_KEY_ID="your-access-key-id"
export AWS_SECRET_ACCESS_KEY="your-secret-access-key"
export AWS_REGION="eu-west-2"
```

### "Stack already exists"

Use existing stack or create new one:
```bash
pulumi stack select prod
# or
pulumi stack init prod-v2
```

### "Insufficient permissions"

Your AWS user needs these permissions:
- `s3:CreateBucket`
- `s3:PutBucketPolicy`
- `iam:CreateUser`
- `iam:CreateAccessKey`

### View detailed logs

```bash
pulumi up --logtostderr -v=9
```

## Multi-Environment Setup

You can create separate stacks for different environments:

```bash
# Production
pulumi stack init prod
pulumi config set aws:region eu-west-2
pulumi up

# Development/Testing
pulumi stack init dev
pulumi config set aws:region eu-west-2
pulumi up

# Switch between them
pulumi stack select prod
pulumi stack select dev
```

## Backup & Restore Stack State

```bash
# Export stack state
pulumi stack export > infrastructure-backup.json

# Import stack state
pulumi stack import < infrastructure-backup.json
```

## Clean Up

To destroy all resources:

```bash
# Preview what will be deleted
pulumi destroy --preview

# Destroy resources
pulumi destroy

# Remove the stack
pulumi stack rm prod
```

**WARNING**: This will delete the S3 bucket and all backups!

## Support

- [Pulumi Documentation](https://www.pulumi.com/docs/)
- [AWS S3 Pricing](https://aws.amazon.com/s3/pricing/)
- [Pulumi AWS Provider](https://www.pulumi.com/registry/packages/aws/)

## Files

- `index.ts` - Main infrastructure code
- `Pulumi.yaml` - Project configuration
- `package.json` - Node.js dependencies
- `tsconfig.json` - TypeScript configuration
- `.gitignore` - Ignored files
