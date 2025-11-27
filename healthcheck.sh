#!/bin/sh
set -e

# Trap errors and send failure notification
trap 'if [ -n "${HEALTHCHECK_URL}" ]; then curl -m 10 --retry 5 -s "${HEALTHCHECK_URL}/fail" || true; fi' ERR

echo "[$(date)] Starting health check..."

# Ping healthcheck start
if [ -n "${HEALTHCHECK_URL}" ]; then
    curl -m 10 --retry 5 -s "${HEALTHCHECK_URL}/start" || true
fi

# Configuration
BITWARDEN_URL="http://bitwarden:80/"
CADDY_ADMIN_URL="http://caddy:80/"
ALL_HEALTHY=true

# Check Bitwarden
echo "[$(date)] Checking Bitwarden at ${BITWARDEN_URL}..."
if curl -f -s -m 5 --retry 2 "${BITWARDEN_URL}" > /dev/null 2>&1; then
    echo "[$(date)] ✓ Bitwarden is healthy"
else
    echo "[$(date)] ✗ Bitwarden health check FAILED"
    ALL_HEALTHY=false
fi

# Check Caddy (expect 403 "Access denied" - means Caddy is running correctly)
echo "[$(date)] Checking Caddy at ${CADDY_ADMIN_URL}..."
CADDY_RESPONSE=$(curl -s -o /dev/null -w "%{http_code}" -m 5 --retry 2 "${CADDY_ADMIN_URL}" 2>&1)
if [ "${CADDY_RESPONSE}" = "403" ] || [ "${CADDY_RESPONSE}" = "200" ]; then
    echo "[$(date)] ✓ Caddy is healthy (HTTP ${CADDY_RESPONSE})"
else
    echo "[$(date)] ✗ Caddy health check FAILED (HTTP ${CADDY_RESPONSE})"
    ALL_HEALTHY=false
fi

# Report results
if [ "${ALL_HEALTHY}" = "true" ]; then
    echo "[$(date)] All services are healthy!"

    # Ping healthcheck success
    if [ -n "${HEALTHCHECK_URL}" ]; then
        curl -m 10 --retry 5 -s "${HEALTHCHECK_URL}" || true
    fi
else
    echo "[$(date)] Some services are unhealthy!"

    # Ping healthcheck failure
    if [ -n "${HEALTHCHECK_URL}" ]; then
        curl -m 10 --retry 5 -s "${HEALTHCHECK_URL}/fail" || true
    fi

    exit 1
fi

echo "[$(date)] Health check complete!"
