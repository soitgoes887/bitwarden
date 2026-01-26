import * as pulumi from "@pulumi/pulumi";
import * as k8s from "@pulumi/kubernetes";

// Configuration
const config = new pulumi.Config();
const image = config.get("vaultwardenImage") || "vaultwarden/server:latest";
const host = config.get("host") || "bitwarden.win";
const kubeconfigContext = config.get("kubeconfigContext") || "personal-k8s";
const storageSize = config.get("storageSize") || "100Mi";

// Backup configuration
const backupConfig = new pulumi.Config("backup");

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

// SMTP configuration
const smtpConfig = new pulumi.Config("smtp");

// Create Secret for sensitive configuration
const secret = new k8s.core.v1.Secret("bitwarden-secret", {
    metadata: {
        name: "bitwarden-secret",
        namespace: "bitwarden",
    },
    type: "Opaque",
    stringData: {
        ADMIN_TOKEN: config.getSecret("adminToken") || "",
        AWS_ACCESS_KEY_ID: backupConfig.get("awsAccessKeyId") || "",
        AWS_SECRET_ACCESS_KEY: backupConfig.getSecret("awsSecretAccessKey") || "",
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
        AWS_REGION: backupConfig.get("awsRegion") || "eu-west-2",
        S3_BUCKET: backupConfig.get("s3Bucket") || "",
        S3_PREFIX: "bitwarden/",
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
        type: "NodePort",
        selector: { app: "bitwarden" },
        ports: [
            {
                name: "http",
                port: 80,
                targetPort: 80,
                nodePort: 30082,
            },
            {
                name: "websocket",
                port: 3012,
                targetPort: 3012,
                nodePort: 30083,
            },
        ],
    },
}, { provider: k8sProvider, dependsOn: [namespace] });

// Create bitwarden ingress
const ingress = new k8s.networking.v1.Ingress("bitwarden-ingress", {
    metadata: {
        name: "bitwarden",
        namespace: "bitwarden",
        annotations: {
            "nginx.ingress.kubernetes.io/proxy-body-size": "100m",
            "nginx.ingress.kubernetes.io/proxy-read-timeout": "3600",
            "nginx.ingress.kubernetes.io/proxy-send-timeout": "3600",
        },
    },
    spec: {
        ingressClassName: "nginx",
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

// Create CronJob for S3 backups (runs weekly on Sunday at 2 AM)
const backupCronJob = new k8s.batch.v1.CronJob("bitwarden-backup", {
    metadata: {
        name: "bitwarden-backup",
        namespace: "bitwarden",
    },
    spec: {
        schedule: "0 2 * * 0",
        concurrencyPolicy: "Forbid",
        successfulJobsHistoryLimit: 3,
        failedJobsHistoryLimit: 3,
        jobTemplate: {
            spec: {
                template: {
                    spec: {
                        restartPolicy: "OnFailure",
                        containers: [{
                            name: "backup",
                            image: "amazon/aws-cli:latest",
                            command: ["/bin/sh", "-c"],
                            args: [`
                                set -e
                                BACKUP_FILE="/data/backup-$(date +%Y%m%d-%H%M%S).tar.gz"
                                echo "Creating backup..."
                                cd /data
                                sqlite3 db.sqlite3 ".backup db-backup.sqlite3" || true
                                tar -czf $BACKUP_FILE db-backup.sqlite3 rsa_key* attachments/ sends/ icon_cache/ 2>/dev/null || tar -czf $BACKUP_FILE db-backup.sqlite3 rsa_key* 2>/dev/null || true
                                rm -f db-backup.sqlite3
                                echo "Uploading to S3..."
                                aws s3 cp $BACKUP_FILE s3://$S3_BUCKET/$S3_PREFIX$(basename $BACKUP_FILE)
                                rm -f $BACKUP_FILE
                                echo "Backup completed!"
                            `],
                            envFrom: [
                                { configMapRef: { name: "bitwarden-config" } },
                                { secretRef: { name: "bitwarden-secret" } },
                            ],
                            volumeMounts: [{
                                name: "data",
                                mountPath: "/data",
                                readOnly: true,
                            }],
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
        },
    },
}, { provider: k8sProvider, dependsOn: [namespace, pvc, secret, configMap] });

// Exports
export const k8sNamespace = namespace.metadata.name;
export const k8sDeployment = deployment.metadata.name;
export const k8sServiceNodePort = 30082;
export const k8sWebSocketNodePort = 30083;
export const k8sIngressHost = host;
export const k8sUrl = `https://${host}`;
export const k8sPvcSize = storageSize;
