#!/bin/sh
set -e

echo "[$(date)] Starting Bitwarden backup..."

# Configuration
BACKUP_DIR="/backups"
TIMESTAMP=$(date +%Y%m%d-%H%M%S)
BACKUP_FILE="bitwarden-backup-${TIMESTAMP}.tar.gz"
BACKUP_PATH="${BACKUP_DIR}/${BACKUP_FILE}"

# Create backup directory if it doesn't exist
mkdir -p ${BACKUP_DIR}

# Create SQLite backup (safe while database is running)
echo "[$(date)] Creating SQLite backup..."
TEMP_DB="/tmp/db-backup.sqlite3"
sqlite3 /data/db.sqlite3 ".backup '${TEMP_DB}'"

# Copy backup to staging area for tar
cp ${TEMP_DB} ${BACKUP_DIR}/db-backup.sqlite3

# Create tar.gz of all data
echo "[$(date)] Creating tar archive..."
cd /data
tar -czf ${BACKUP_PATH} \
    -C ${BACKUP_DIR} db-backup.sqlite3 \
    db.sqlite3-shm \
    db.sqlite3-wal \
    config.json \
    rsa_key* \
    attachments \
    sends \
    icon_cache \
    2>/dev/null || true

# Get file size
BACKUP_SIZE=$(du -h ${BACKUP_PATH} | cut -f1)
echo "[$(date)] Backup created: ${BACKUP_FILE} (${BACKUP_SIZE})"

# Upload to S3 if credentials are provided
if [ -n "${AWS_ACCESS_KEY_ID}" ] && [ -n "${AWS_SECRET_ACCESS_KEY}" ] && [ -n "${S3_BUCKET}" ]; then
    echo "[$(date)] Uploading to S3 bucket: ${S3_BUCKET}..."

    aws s3 cp ${BACKUP_PATH} s3://${S3_BUCKET}/${S3_PREFIX}${BACKUP_FILE} \
        ${AWS_ENDPOINT:+--endpoint-url ${AWS_ENDPOINT}} \
        --region ${AWS_REGION:-eu-west-2}

    if [ $? -eq 0 ]; then
        echo "[$(date)] Upload successful!"

        # Delete local backup after successful upload if configured
        if [ "${DELETE_LOCAL_AFTER_UPLOAD}" = "true" ]; then
            echo "[$(date)] Deleting local backup..."
            rm -f ${BACKUP_PATH}
        fi
    else
        echo "[$(date)] ERROR: Upload failed!"
        exit 1
    fi
else
    echo "[$(date)] S3 credentials not provided, keeping local backup only"
fi

# Clean up old local backups (keep last N backups)
KEEP_BACKUPS=${KEEP_LOCAL_BACKUPS:-7}
echo "[$(date)] Cleaning up old backups (keeping last ${KEEP_BACKUPS})..."
cd ${BACKUP_DIR}
ls -t bitwarden-backup-*.tar.gz | tail -n +$((KEEP_BACKUPS + 1)) | xargs -r rm -f

# Clean up temporary SQLite backups
rm -f /tmp/db-backup.sqlite3
rm -f ${BACKUP_DIR}/db-backup.sqlite3

echo "[$(date)] Backup complete!"
