import * as pulumi from "@pulumi/pulumi";
import * as k8s from "@pulumi/kubernetes";

// Configuration
const config = new pulumi.Config();
const image = config.get("vaultwardenImage") || "vaultwarden/server:latest";
const host = config.get("host") || "bitwarden.win";
const kubeconfigContext = config.get("kubeconfigContext") || "kubernetes-admin@kubernetes";
const storageSize = config.get("storageSize") || "100Mi";

// SMTP configuration
const smtpConfig = new pulumi.Config("smtp");

// Backup configuration
const backupConfig = new pulumi.Config("backup");
const s3Endpoint = backupConfig.get("s3Endpoint") || "https://fsn1.your-objectstorage.com";
const s3Bucket = backupConfig.get("s3Bucket") || "bitwarden-backup";

// Create Kubernetes provider using local kubeconfig
const k8sProvider = new k8s.Provider("k8s-provider", {
    context: kubeconfigContext,
    enableServerSideApply: true,
});

// Create bitwarden namespace
const namespace = new k8s.core.v1.Namespace("bitwarden-namespace", {
    metadata: {
        name: "bitwarden",
    },
}, { provider: k8sProvider });

// Create PersistentVolume with hostPath (data stored on node at /data/bitwarden)
const pv = new k8s.core.v1.PersistentVolume("bitwarden-pv", {
    metadata: {
        name: "bitwarden-data-pv",
        labels: { app: "bitwarden" },
    },
    spec: {
        capacity: {
            storage: storageSize,
        },
        accessModes: ["ReadWriteOnce"],
        persistentVolumeReclaimPolicy: "Retain",
        storageClassName: "manual",
        hostPath: {
            path: "/data/bitwarden",
            type: "DirectoryOrCreate",
        },
    },
}, { provider: k8sProvider });

// Create PersistentVolumeClaim for vaultwarden data
const pvc = new k8s.core.v1.PersistentVolumeClaim("bitwarden-pvc", {
    metadata: {
        name: "bitwarden-data",
        namespace: "bitwarden",
    },
    spec: {
        accessModes: ["ReadWriteOnce"],
        storageClassName: "manual",
        resources: {
            requests: {
                storage: storageSize,
            },
        },
        selector: {
            matchLabels: { app: "bitwarden" },
        },
    },
}, { provider: k8sProvider, dependsOn: [namespace, pv] });

// Create Secret for sensitive configuration
const secret = new k8s.core.v1.Secret("bitwarden-secret", {
    metadata: {
        name: "bitwarden-secret",
        namespace: "bitwarden",
    },
    type: "Opaque",
    stringData: {
        ADMIN_TOKEN: config.getSecret("adminToken") || "",
        SMTP_PASSWORD: smtpConfig.getSecret("password") || "",
    },
}, { provider: k8sProvider, dependsOn: [namespace] });

// Create ConfigMap for non-sensitive configuration
const configMap = new k8s.core.v1.ConfigMap("bitwarden-config", {
    metadata: {
        name: "bitwarden-config",
        namespace: "bitwarden",
    },
    data: {
        DOMAIN: `https://${host}`,
        SIGNUPS_ALLOWED: "false",
        INVITATIONS_ALLOWED: "true",
        SHOW_PASSWORD_HINT: "false",
        WEBSOCKET_ENABLED: "true",
        WEB_VAULT_ENABLED: "true",
        TZ: "Europe/London",
        // SMTP configuration
        SMTP_HOST: smtpConfig.get("host") || "email-smtp.eu-west-2.amazonaws.com",
        SMTP_PORT: smtpConfig.get("port") || "587",
        SMTP_SECURITY: "starttls",
        SMTP_FROM: smtpConfig.get("from") || "hello@bitwarden.win",
        SMTP_USERNAME: smtpConfig.get("username") || "",
    },
}, { provider: k8sProvider, dependsOn: [namespace] });

// Create bitwarden deployment
const deployment = new k8s.apps.v1.Deployment("bitwarden-deployment", {
    metadata: {
        name: "bitwarden",
        namespace: "bitwarden",
        labels: { app: "bitwarden" },
        annotations: {
            "pulumi.com/patchForce": "true",
        },
    },
    spec: {
        replicas: 1,
        strategy: {
            type: "Recreate",
        },
        selector: {
            matchLabels: { app: "bitwarden" },
        },
        template: {
            metadata: {
                labels: { app: "bitwarden" },
            },
            spec: {
                containers: [{
                    name: "vaultwarden",
                    image: image,
                    imagePullPolicy: "Always",
                    ports: [
                        { containerPort: 80, name: "http" },
                        { containerPort: 3012, name: "websocket" },
                    ],
                    envFrom: [
                        { configMapRef: { name: "bitwarden-config" } },
                        { secretRef: { name: "bitwarden-secret" } },
                    ],
                    volumeMounts: [{
                        name: "data",
                        mountPath: "/data",
                    }],
                    resources: {
                        requests: {
                            memory: "128Mi",
                            cpu: "100m",
                        },
                        limits: {
                            memory: "256Mi",
                            cpu: "500m",
                        },
                    },
                    livenessProbe: {
                        httpGet: {
                            path: "/alive",
                            port: 80,
                        },
                        initialDelaySeconds: 15,
                        periodSeconds: 30,
                    },
                    readinessProbe: {
                        httpGet: {
                            path: "/alive",
                            port: 80,
                        },
                        initialDelaySeconds: 5,
                        periodSeconds: 10,
                    },
                }],
                volumes: [{
                    name: "data",
                    persistentVolumeClaim: {
                        claimName: "bitwarden-data",
                    },
                }],
            },
        },
    },
}, { provider: k8sProvider, dependsOn: [namespace, pvc, secret, configMap] });

// Create bitwarden service
const service = new k8s.core.v1.Service("bitwarden-service", {
    metadata: {
        name: "bitwarden",
        namespace: "bitwarden",
    },
    spec: {
        type: "ClusterIP",
        selector: { app: "bitwarden" },
        ports: [
            {
                name: "http",
                port: 80,
                targetPort: 80,
            },
            {
                name: "websocket",
                port: 3012,
                targetPort: 3012,
            },
        ],
    },
}, { provider: k8sProvider, dependsOn: [namespace] });

// Create bitwarden ingress with TLS
const ingress = new k8s.networking.v1.Ingress("bitwarden-ingress", {
    metadata: {
        name: "bitwarden",
        namespace: "bitwarden",
        annotations: {
            "cert-manager.io/cluster-issuer": "letsencrypt-prod",
            "nginx.ingress.kubernetes.io/proxy-body-size": "100m",
            "nginx.ingress.kubernetes.io/proxy-read-timeout": "3600",
            "nginx.ingress.kubernetes.io/proxy-send-timeout": "3600",
        },
    },
    spec: {
        ingressClassName: "nginx",
        tls: [{
            hosts: [host],
            secretName: "bitwarden-tls",
        }],
        rules: [{
            host: host,
            http: {
                paths: [
                    {
                        path: "/",
                        pathType: "Prefix",
                        backend: {
                            service: {
                                name: "bitwarden",
                                port: { number: 80 },
                            },
                        },
                    },
                    {
                        path: "/notifications/hub",
                        pathType: "Prefix",
                        backend: {
                            service: {
                                name: "bitwarden",
                                port: { number: 3012 },
                            },
                        },
                    },
                ],
            },
        }],
    },
}, { provider: k8sProvider, dependsOn: [namespace, service] });

// Create Secret for backup S3 credentials
const backupSecret = new k8s.core.v1.Secret("backup-secret", {
    metadata: {
        name: "backup-credentials",
        namespace: "bitwarden",
    },
    type: "Opaque",
    stringData: {
        AWS_ACCESS_KEY_ID: backupConfig.requireSecret("s3AccessKey"),
        AWS_SECRET_ACCESS_KEY: backupConfig.requireSecret("s3SecretKey"),
    },
}, { provider: k8sProvider, dependsOn: [namespace] });

// Create CronJob for weekly SQLite backup to S3
const backupCronJob = new k8s.batch.v1.CronJob("bitwarden-backup", {
    metadata: {
        name: "bitwarden-backup",
        namespace: "bitwarden",
    },
    spec: {
        schedule: "0 3 * * 0", // Every Sunday at 3 AM UTC
        concurrencyPolicy: "Forbid",
        successfulJobsHistoryLimit: 3,
        failedJobsHistoryLimit: 3,
        jobTemplate: {
            spec: {
                template: {
                    spec: {
                        containers: [{
                            name: "backup",
                            image: "alpine:latest",
                            command: ["/bin/sh", "-c"],
                            args: [
                                `set -e && \
                                apk add --no-cache sqlite aws-cli && \
                                BACKUP_FILE="bitwarden-$(date +%Y%m%d-%H%M%S).sqlite.gz" && \
                                sqlite3 /data/db.sqlite3 ".backup '/tmp/backup.sqlite'" && \
                                gzip -c /tmp/backup.sqlite > /tmp/$BACKUP_FILE && \
                                aws s3 cp /tmp/$BACKUP_FILE s3://${s3Bucket}/$BACKUP_FILE --endpoint-url=${s3Endpoint} && \
                                aws s3 cp /tmp/$BACKUP_FILE s3://${s3Bucket}/bitwarden-latest.sqlite.gz --endpoint-url=${s3Endpoint} && \
                                echo "Backup completed: $BACKUP_FILE (also copied to bitwarden-latest.sqlite.gz)"`
                            ],
                            envFrom: [{ secretRef: { name: "backup-credentials" } }],
                            volumeMounts: [{
                                name: "data",
                                mountPath: "/data",
                                readOnly: true,
                            }],
                            resources: {
                                requests: {
                                    memory: "64Mi",
                                    cpu: "50m",
                                },
                                limits: {
                                    memory: "128Mi",
                                    cpu: "200m",
                                },
                            },
                        }],
                        restartPolicy: "OnFailure",
                        volumes: [{
                            name: "data",
                            persistentVolumeClaim: {
                                claimName: "bitwarden-data",
                            },
                        }],
                    },
                },
            },
        },
    },
}, { provider: k8sProvider, dependsOn: [namespace, pvc, backupSecret] });

// Create ConfigMap with restore script
const restoreConfigMap = new k8s.core.v1.ConfigMap("restore-config", {
    metadata: {
        name: "restore-config",
        namespace: "bitwarden",
    },
    data: {
        "restore.sh": `#!/bin/sh
set -e

BACKUP_FILE=\${BACKUP_FILE:-bitwarden-latest.sqlite.gz}

echo "Installing dependencies..."
apk add --no-cache sqlite aws-cli

echo "Downloading backup: $BACKUP_FILE"
aws s3 cp s3://${s3Bucket}/$BACKUP_FILE /tmp/backup.sqlite.gz --endpoint-url=${s3Endpoint}

echo "Decompressing backup..."
gunzip /tmp/backup.sqlite.gz

echo "Backing up current database..."
if [ -f /data/db.sqlite3 ]; then
    cp /data/db.sqlite3 /data/db.sqlite3.pre-restore
    echo "Current database backed up to db.sqlite3.pre-restore"
fi

echo "Restoring database..."
cp /tmp/backup.sqlite /data/db.sqlite3

echo "Restore completed successfully!"
echo "Remember to scale up the bitwarden deployment:"
echo "  kubectl scale deployment bitwarden -n bitwarden --replicas=1"
`,
    },
}, { provider: k8sProvider, dependsOn: [namespace] });

// Create restore Job (suspended by default - run manually)
const restoreJob = new k8s.batch.v1.Job("bitwarden-restore", {
    metadata: {
        name: "bitwarden-restore",
        namespace: "bitwarden",
        annotations: {
            "pulumi.com/skipAwait": "true",  // Don't wait for suspended job
        },
    },
    spec: {
        suspend: true,  // Job is suspended - must be manually unsuspended to run
        backoffLimit: 1,
        template: {
            spec: {
                containers: [{
                    name: "restore",
                    image: "alpine:latest",
                    command: ["/bin/sh", "/scripts/restore.sh"],
                    env: [{
                        name: "BACKUP_FILE",
                        value: "bitwarden-latest.sqlite.gz",
                    }],
                    envFrom: [{ secretRef: { name: "backup-credentials" } }],
                    volumeMounts: [
                        {
                            name: "data",
                            mountPath: "/data",
                        },
                        {
                            name: "scripts",
                            mountPath: "/scripts",
                        },
                    ],
                }],
                restartPolicy: "Never",
                volumes: [
                    {
                        name: "data",
                        persistentVolumeClaim: {
                            claimName: "bitwarden-data",
                        },
                    },
                    {
                        name: "scripts",
                        configMap: {
                            name: "restore-config",
                            defaultMode: 0o755,
                        },
                    },
                ],
            },
        },
    },
}, { provider: k8sProvider, dependsOn: [namespace, pvc, backupSecret, restoreConfigMap] });

// Exports
export const k8sNamespace = namespace.metadata.name;
export const k8sDeployment = deployment.metadata.name;
export const k8sImage = image;
export const k8sIngressHost = host;
export const k8sUrl = `https://${host}`;
export const k8sPvcSize = storageSize;
export const k8sBackupCronJob = backupCronJob.metadata.name;
export const k8sBackupSchedule = "Weekly (Sunday 3 AM UTC)";
export const k8sRestoreJob = restoreJob.metadata.name;
export const k8sRestoreInstructions = `
To restore from the latest backup:

1. Scale down bitwarden:
   kubectl scale deployment bitwarden -n bitwarden --replicas=0

2. Run restore job:
   kubectl patch job bitwarden-restore -n bitwarden -p '{"spec":{"suspend":false}}'

3. Watch logs:
   kubectl logs -n bitwarden job/bitwarden-restore -f

4. Scale up bitwarden:
   kubectl scale deployment bitwarden -n bitwarden --replicas=1

5. Reset job for next use:
   kubectl delete job bitwarden-restore -n bitwarden
   pulumi up

To restore a specific backup, edit the job first:
   kubectl patch job bitwarden-restore -n bitwarden --type='json' -p='[{"op":"replace","path":"/spec/template/spec/containers/0/env/0/value","value":"bitwarden-YYYYMMDD-HHMMSS.sqlite.gz"}]'
`;
