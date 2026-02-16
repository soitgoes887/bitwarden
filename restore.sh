#!/bin/bash
set -e

# Bitwarden Restore Script
# Restores from the latest backup or a specified backup file

BACKUP_FILE="${1:-bitwarden-latest.sqlite.gz}"
NAMESPACE="bitwarden"

echo "=== Bitwarden Restore ==="
echo "Backup file: $BACKUP_FILE"
echo ""

# Step 1: Scale down bitwarden
echo "Step 1: Scaling down bitwarden..."
kubectl scale deployment bitwarden -n $NAMESPACE --replicas=0
sleep 5

# Step 2: Update the restore job with the backup file (if specified)
if [ "$BACKUP_FILE" != "bitwarden-latest.sqlite.gz" ]; then
    echo "Step 2: Updating restore job with backup file: $BACKUP_FILE"
    kubectl patch job bitwarden-restore -n $NAMESPACE --type='json' \
        -p="[{\"op\":\"replace\",\"path\":\"/spec/template/spec/containers/0/env/0/value\",\"value\":\"$BACKUP_FILE\"}]"
fi

# Step 3: Run the restore job
echo "Step 3: Running restore job..."
kubectl patch job bitwarden-restore -n $NAMESPACE -p '{"spec":{"suspend":false}}'

# Step 4: Wait for job to complete
echo "Step 4: Waiting for restore to complete..."
kubectl wait --for=condition=complete job/bitwarden-restore -n $NAMESPACE --timeout=300s || {
    echo "Restore job failed or timed out. Checking logs..."
    kubectl logs -n $NAMESPACE job/bitwarden-restore
    exit 1
}

echo "Step 5: Restore logs:"
kubectl logs -n $NAMESPACE job/bitwarden-restore

# Step 6: Scale up bitwarden
echo "Step 6: Scaling up bitwarden..."
kubectl scale deployment bitwarden -n $NAMESPACE --replicas=1

# Step 7: Clean up - delete the job so it can be recreated by Pulumi
echo "Step 7: Cleaning up restore job..."
kubectl delete job bitwarden-restore -n $NAMESPACE

echo ""
echo "=== Restore Complete ==="
echo "Run 'pulumi up' in infrastructure/ to recreate the restore job for future use."
echo "Run 'kubectl logs -n bitwarden -l app=bitwarden -f' to verify bitwarden started correctly."
