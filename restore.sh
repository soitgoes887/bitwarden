#!/bin/bash
set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}  Bitwarden Backup Restore Script${NC}"
echo -e "${GREEN}========================================${NC}"
echo ""

# Load environment variables from .env file
if [ -f .env ]; then
    export $(grep -v '^#' .env | xargs)
else
    echo -e "${RED}ERROR: .env file not found!${NC}"
    echo "Please create a .env file with your S3 credentials."
    exit 1
fi

# Check required environment variables
if [ -z "${AWS_ACCESS_KEY_ID}" ] || [ -z "${AWS_SECRET_ACCESS_KEY}" ] || [ -z "${S3_BUCKET}" ]; then
    echo -e "${RED}ERROR: Missing required S3 credentials in .env file${NC}"
    echo "Required variables: AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, S3_BUCKET"
    exit 1
fi

# Set defaults
AWS_REGION=${AWS_REGION:-eu-west-2}
S3_PREFIX=${S3_PREFIX:-bitwarden/}
BACKUP_DIR="./backups"
DATA_DIR="./bw-data"

# Create backup directory if it doesn't exist
mkdir -p ${BACKUP_DIR}

# Function to list S3 backups
list_s3_backups() {
    echo -e "${YELLOW}Fetching backup list from S3...${NC}"
    aws s3 ls s3://${S3_BUCKET}/${S3_PREFIX} \
        ${AWS_ENDPOINT:+--endpoint-url ${AWS_ENDPOINT}} \
        --region ${AWS_REGION} | \
        grep "bitwarden-backup-" | \
        awk '{print $4}' | \
        sort -r
}

# Check if a specific backup file was provided as argument
if [ -n "$1" ]; then
    BACKUP_FILE="$1"
    echo -e "${YELLOW}Using specified backup: ${BACKUP_FILE}${NC}"
else
    # List available backups
    echo ""
    echo -e "${YELLOW}Available backups in S3:${NC}"
    BACKUPS=$(list_s3_backups)

    if [ -z "$BACKUPS" ]; then
        echo -e "${RED}No backups found in S3!${NC}"
        exit 1
    fi

    echo "$BACKUPS" | nl
    echo ""

    # Get the latest backup (first in the sorted list)
    BACKUP_FILE=$(echo "$BACKUPS" | head -n 1)
    echo -e "${GREEN}Latest backup: ${BACKUP_FILE}${NC}"
    echo ""
fi

# Confirm before proceeding
echo -e "${YELLOW}WARNING: This will:${NC}"
echo "  1. Stop all Bitwarden containers"
echo "  2. Backup current data to bw-data.backup-$(date +%Y%m%d-%H%M%S)"
echo "  3. Download and restore: ${BACKUP_FILE}"
echo "  4. Restart all containers"
echo ""
read -p "Do you want to continue? (yes/no): " CONFIRM

if [ "$CONFIRM" != "yes" ]; then
    echo -e "${RED}Restore cancelled.${NC}"
    exit 0
fi

echo ""
echo -e "${GREEN}Starting restore process...${NC}"
echo ""

# Step 1: Download backup from S3
BACKUP_PATH="${BACKUP_DIR}/${BACKUP_FILE}"

if [ ! -f "${BACKUP_PATH}" ]; then
    echo -e "${YELLOW}[1/5] Downloading backup from S3...${NC}"
    aws s3 cp s3://${S3_BUCKET}/${S3_PREFIX}${BACKUP_FILE} ${BACKUP_PATH} \
        ${AWS_ENDPOINT:+--endpoint-url ${AWS_ENDPOINT}} \
        --region ${AWS_REGION}

    if [ $? -ne 0 ]; then
        echo -e "${RED}ERROR: Failed to download backup from S3!${NC}"
        exit 1
    fi
    echo -e "${GREEN}✓ Download complete${NC}"
else
    echo -e "${YELLOW}[1/5] Backup file already exists locally, skipping download${NC}"
fi

# Step 2: Verify backup integrity
echo -e "${YELLOW}[2/5] Verifying backup integrity...${NC}"
if ! tar -tzf ${BACKUP_PATH} > /dev/null 2>&1; then
    echo -e "${RED}ERROR: Backup file is corrupted or invalid!${NC}"
    exit 1
fi
echo -e "${GREEN}✓ Backup file is valid${NC}"

# Step 3: Stop containers
echo -e "${YELLOW}[3/5] Stopping Docker containers...${NC}"
docker compose down

if [ $? -ne 0 ]; then
    echo -e "${RED}ERROR: Failed to stop containers!${NC}"
    exit 1
fi
echo -e "${GREEN}✓ Containers stopped${NC}"

# Step 4: Backup current data and restore
echo -e "${YELLOW}[4/5] Backing up current data and restoring from backup...${NC}"

# Create backup of current data
if [ -d "${DATA_DIR}" ]; then
    CURRENT_BACKUP="${DATA_DIR}.backup-$(date +%Y%m%d-%H%M%S)"
    echo "Creating backup of current data: ${CURRENT_BACKUP}"
    mv ${DATA_DIR} ${CURRENT_BACKUP}
    echo -e "${GREEN}✓ Current data backed up to ${CURRENT_BACKUP}${NC}"
fi

# Create fresh data directory
mkdir -p ${DATA_DIR}

# Extract backup
echo "Extracting backup to ${DATA_DIR}..."
tar -xzf ${BACKUP_PATH} -C ${DATA_DIR}

if [ $? -ne 0 ]; then
    echo -e "${RED}ERROR: Failed to extract backup!${NC}"
    echo "Restoring previous data..."
    rm -rf ${DATA_DIR}
    mv ${CURRENT_BACKUP} ${DATA_DIR}
    exit 1
fi
echo -e "${GREEN}✓ Backup extracted successfully${NC}"

# Step 5: Start containers
echo -e "${YELLOW}[5/5] Starting Docker containers...${NC}"
docker compose up -d

if [ $? -ne 0 ]; then
    echo -e "${RED}ERROR: Failed to start containers!${NC}"
    exit 1
fi
echo -e "${GREEN}✓ Containers started${NC}"

echo ""
echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}  Restore completed successfully!${NC}"
echo -e "${GREEN}========================================${NC}"
echo ""
echo -e "Backup restored: ${BACKUP_FILE}"
echo -e "Previous data saved to: ${CURRENT_BACKUP}"
echo ""
echo -e "${YELLOW}Next steps:${NC}"
echo "  1. Verify services are running: docker compose ps"
echo "  2. Check logs: docker compose logs -f"
echo "  3. Access your vault: ${DOMAIN}"
echo ""
echo -e "${YELLOW}If anything went wrong, you can restore the previous data:${NC}"
echo "  docker compose down"
echo "  rm -rf ${DATA_DIR}"
echo "  mv ${CURRENT_BACKUP} ${DATA_DIR}"
echo "  docker compose up -d"
echo ""
