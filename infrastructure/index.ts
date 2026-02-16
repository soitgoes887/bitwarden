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
        AWS_ACCESS_KEY_ID: backupConfig.getSecret("s3AccessKey") || "",
        AWS_SECRET_ACCESS_KEY: backupConfig.getSecret("s3SecretKey") || "",
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
                                sqlite3 /data/db.sqlite ".backup '/tmp/backup.sqlite'" && \
                                gzip -c /tmp/backup.sqlite > /tmp/$BACKUP_FILE && \
                                aws s3 cp /tmp/$BACKUP_FILE s3://${s3Bucket}/$BACKUP_FILE --endpoint-url=${s3Endpoint} && \
                                echo "Backup completed: $BACKUP_FILE"`
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

// Exports
export const k8sNamespace = namespace.metadata.name;
export const k8sDeployment = deployment.metadata.name;
export const k8sImage = image;
export const k8sIngressHost = host;
export const k8sUrl = `https://${host}`;
export const k8sPvcSize = storageSize;
export const k8sBackupCronJob = backupCronJob.metadata.name;
export const k8sBackupSchedule = "Weekly (Sunday 3 AM UTC)";
