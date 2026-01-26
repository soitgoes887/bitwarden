#!/bin/bash
# Setup script for Pulumi S3 backend
# Run this once to configure the S3 bucket for Pulumi state storage

set -e

BUCKET_NAME="bitwarden-pulumi-state"
REGION="eu-west-2"

echo "Setting up Pulumi S3 backend for Bitwarden..."
echo "Bucket: $BUCKET_NAME"
echo "Region: $REGION"
echo ""

# Check if bucket exists
if aws s3api head-bucket --bucket "$BUCKET_NAME" 2>/dev/null; then
    echo "Bucket already exists."
else
    echo "Creating bucket..."
    aws s3api create-bucket \
        --bucket "$BUCKET_NAME" \
        --region "$REGION" \
        --create-bucket-configuration LocationConstraint="$REGION"
    echo "Bucket created."
fi

# Enable versioning
echo "Enabling versioning..."
aws s3api put-bucket-versioning \
    --bucket "$BUCKET_NAME" \
    --versioning-configuration Status=Enabled
echo "✓ Versioning enabled"

# Enable encryption
echo "Enabling encryption..."
aws s3api put-bucket-encryption \
    --bucket "$BUCKET_NAME" \
    --server-side-encryption-configuration '{
        "Rules": [{
            "ApplyServerSideEncryptionByDefault": {
                "SSEAlgorithm": "AES256"
            },
            "BucketKeyEnabled": true
        }]
    }'
echo "✓ Encryption enabled"

# Block public access
echo "Blocking public access..."
aws s3api put-public-access-block \
    --bucket "$BUCKET_NAME" \
    --public-access-block-configuration \
        "BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true"
echo "✓ Public access blocked"

# Add lifecycle policy
echo "Adding lifecycle policy..."
aws s3api put-bucket-lifecycle-configuration \
    --bucket "$BUCKET_NAME" \
    --lifecycle-configuration '{
        "Rules": [{
            "ID": "DeleteOldVersions",
            "Status": "Enabled",
            "Filter": {"Prefix": ""},
            "NoncurrentVersionExpiration": {
                "NoncurrentDays": 90
            },
            "AbortIncompleteMultipartUpload": {
                "DaysAfterInitiation": 7
            }
        }]
    }'
echo "✓ Lifecycle policy configured"

echo ""
echo "S3 bucket setup complete!"
echo ""
echo "Next steps:"
echo "1. Login to Pulumi with S3 backend:"
echo "   cd infrastructure && pulumi login s3://$BUCKET_NAME"
echo ""
echo "2. Initialize or select your stack:"
echo "   pulumi stack init dev    # or"
echo "   pulumi stack select dev"
echo ""
echo "3. Configure secrets:"
echo "   pulumi config set --secret adminToken \$(openssl rand -base64 48)"
echo "   pulumi config set backup:awsAccessKeyId <your-key>"
echo "   pulumi config set --secret backup:awsSecretAccessKey <your-secret>"
echo "   pulumi config set backup:s3Bucket <backup-bucket-name>"
