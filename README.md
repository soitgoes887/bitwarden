# Bitwarden (Vaultwarden) Infrastructure

Self-hosted Bitwarden password manager running on Kubernetes using Vaultwarden.

## Architecture

- **Vaultwarden**: Bitwarden-compatible server
- **Kubernetes**: Container orchestration on Hetzner
- **Pulumi**: Infrastructure as Code (TypeScript)
- **SQLite**: Database backend
- **Hetzner Object Storage**: Backup storage (S3-compatible)

## Deployment

```bash
cd infrastructure
npm install
pulumi up
```

## Backup

Backups run automatically every **Sunday at 3 AM UTC** via a Kubernetes CronJob.

Each backup creates:
- `bitwarden-YYYYMMDD-HHMMSS.sqlite.gz` - Timestamped backup
- `bitwarden-latest.sqlite.gz` - Always points to latest backup

### Manual Backup

```bash
kubectl create job --from=cronjob/bitwarden-backup manual-backup -n bitwarden
kubectl logs -n bitwarden job/manual-backup -f
```

### List Backups

```bash
aws s3 ls s3://bitwarden-backup/ --endpoint-url https://fsn1.your-objectstorage.com
```

## Restore

### Quick Restore (Latest Backup)

```bash
./restore.sh
```

### Restore Specific Backup

```bash
./restore.sh bitwarden-20260216-030000.sqlite.gz
```

### Manual Restore Steps

1. Scale down bitwarden:
   ```bash
   kubectl scale deployment bitwarden -n bitwarden --replicas=0
   ```

2. Run restore job:
   ```bash
   kubectl patch job bitwarden-restore -n bitwarden -p '{"spec":{"suspend":false}}'
   ```

3. Watch logs:
   ```bash
   kubectl logs -n bitwarden job/bitwarden-restore -f
   ```

4. Scale up bitwarden:
   ```bash
   kubectl scale deployment bitwarden -n bitwarden --replicas=1
   ```

5. Reset job for next use:
   ```bash
   kubectl delete job bitwarden-restore -n bitwarden
   cd infrastructure && pulumi up
   ```

## Configuration

### Pulumi Config

| Key | Description |
|-----|-------------|
| `adminToken` | Vaultwarden admin panel token |
| `smtp:host` | SMTP server host |
| `smtp:username` | SMTP username |
| `smtp:password` | SMTP password |
| `smtp:from` | From email address |
| `backup:s3Endpoint` | S3 endpoint URL |
| `backup:s3Bucket` | S3 bucket name |
| `backup:s3AccessKey` | S3 access key |
| `backup:s3SecretKey` | S3 secret key |

### Set Config

```bash
cd infrastructure
pulumi config set --secret adminToken "your-admin-token"
pulumi config set backup:s3Endpoint "https://fsn1.your-objectstorage.com"
pulumi config set backup:s3Bucket "bitwarden-backup"
pulumi config set --secret backup:s3AccessKey "your-access-key"
pulumi config set --secret backup:s3SecretKey "your-secret-key"
```

## Monitoring

```bash
# Check deployment status
kubectl get pods -n bitwarden

# View logs
kubectl logs -n bitwarden -l app=bitwarden -f

# Check backup cronjob
kubectl get cronjobs -n bitwarden

# View recent backup jobs
kubectl get jobs -n bitwarden
```
