# Bitwarden Self-Hosted (Vaultwarden)

Self-hosted [Vaultwarden](https://github.com/dani-garcia/vaultwarden) password manager running on Kubernetes (AWS).

**URL**: https://bitwarden.win

## Architecture

- **Kubernetes**: Self-managed K8s cluster on AWS (ARM64 Graviton instances)
- **Infrastructure**: Pulumi (TypeScript)
- **Storage**: hostPath PersistentVolume (100Mi)
- **Ingress**: nginx-ingress with Cloudflare SSL
- **Backups**: Weekly CronJob to S3
- **Email**: AWS SES

## Prerequisites

- AWS CLI configured
- kubectl configured for your cluster
- Pulumi CLI
- Node.js 20+

## Initial Setup

### 1. Create S3 Bucket for Pulumi State

```bash
./setup-s3-backend.sh
```

### 2. Configure Pulumi

```bash
cd infrastructure
npm install
pulumi login s3://bitwarden-pulumi-state
pulumi stack select --create dev

# Set required config
pulumi config set aws:region eu-west-2

# Admin token (for /admin panel)
pulumi config set --secret adminToken $(openssl rand -base64 48)

# SMTP (AWS SES)
pulumi config set smtp:username <SES_SMTP_USERNAME>
pulumi config set --secret smtp:password '<SES_SMTP_PASSWORD>'
pulumi config set smtp:from hello@bitwarden.win

# Backup S3 bucket (from existing infrastructure)
pulumi config set backup:awsAccessKeyId <BACKUP_AWS_KEY>
pulumi config set --secret backup:awsSecretAccessKey '<BACKUP_AWS_SECRET>'
pulumi config set backup:s3Bucket <BACKUP_BUCKET_NAME>
```

### 3. Deploy

```bash
pulumi up
```

### 4. Configure DNS

Add CNAME record in Cloudflare:
- **Name**: `@` (root) or subdomain
- **Target**: `k8s-ingress-nlb-70de6d0-84458ff0cf344e9f.elb.ap-south-1.amazonaws.com`
- **Proxy**: Enabled (orange cloud)

## CI/CD

GitHub Actions workflows:

- **PR Validation** (`.github/workflows/pr-validation.yml`): TypeScript check + Pulumi preview
- **Deploy** (`.github/workflows/deploy.yml`): Pulumi up on merge to main

### Required GitHub Secrets

| Secret | Description |
|--------|-------------|
| `AWS_ACCESS_KEY_ID` | AWS credentials |
| `AWS_SECRET_ACCESS_KEY` | AWS credentials |
| `KUBECONFIG` | Base64-encoded kubeconfig |
| `PULUMI_CONFIG_PASSPHRASE` | Pulumi encryption passphrase |

## Operations

### View Logs

```bash
kubectl logs -n bitwarden -l app=bitwarden -f
```

### Restart Deployment

```bash
kubectl rollout restart deployment/bitwarden -n bitwarden
```

### Access Admin Panel

1. Get admin token: `pulumi config get adminToken`
2. Go to https://bitwarden.win/admin
3. Enter the token

### Invite Users

1. Access admin panel
2. Go to "Users" tab
3. Enter email and click "Invite"
4. User receives email invitation (requires SES production access or verified email)

## Backups

Automated weekly backups run every Sunday at 2 AM via CronJob.

### Manual Backup

```bash
kubectl create job --from=cronjob/bitwarden-backup manual-backup -n bitwarden
kubectl logs -n bitwarden -l job-name=manual-backup -f
```

### List Backups

```bash
aws s3 ls s3://<BACKUP_BUCKET>/bitwarden/
```

### Restore from Backup

```bash
# Download backup
aws s3 cp s3://<BACKUP_BUCKET>/bitwarden/backup-YYYYMMDD-HHMMSS.tar.gz ./

# Stop pod
kubectl scale deployment/bitwarden -n bitwarden --replicas=0

# SSH to node and restore
ssh <node>
cd /data/bitwarden
tar -xzf /path/to/backup.tar.gz

# Start pod
kubectl scale deployment/bitwarden -n bitwarden --replicas=1
```

## AWS SES Setup

Domain `bitwarden.win` is verified in AWS SES (eu-west-2) with DKIM.

### Verify New Recipient (Sandbox Mode)

```bash
aws ses verify-email-identity --email-address user@example.com --region eu-west-2
```

### Check Verification Status

```bash
aws ses get-identity-verification-attributes --identities bitwarden.win --region eu-west-2
```

## Infrastructure Resources

Pulumi manages:

**AWS:**
- S3 bucket for backups (with lifecycle policies)
- IAM user for backup access
- S3 bucket for Pulumi state

**Kubernetes:**
- Namespace: `bitwarden`
- PersistentVolume/PVC: hostPath at `/data/bitwarden`
- Deployment: vaultwarden/server:latest
- Service: NodePort 30082 (HTTP), 30083 (WebSocket)
- Ingress: nginx-ingress for bitwarden.win
- CronJob: Weekly S3 backups
- ConfigMap: Non-sensitive config
- Secret: ADMIN_TOKEN, SMTP password, AWS credentials

## Security

- Signups disabled by default
- Admin panel protected by token
- HTTPS via Cloudflare
- Secrets managed in Pulumi (encrypted)
- S3 backup bucket encrypted (AES256)

## Client Apps

Configure clients to use `https://bitwarden.win` as the server URL:

- Browser Extensions: Chrome, Firefox, Safari, Edge
- Desktop: Windows, macOS, Linux
- Mobile: iOS, Android

## Resources

- [Vaultwarden Wiki](https://github.com/dani-garcia/vaultwarden/wiki)
- [Bitwarden Help Center](https://bitwarden.com/help/)
