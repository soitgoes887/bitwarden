# Bitwarden Self-Hosted Setup for Raspberry Pi

This repository contains a Docker Compose setup for running a self-hosted Bitwarden instance using [Vaultwarden](https://github.com/dani-garcia/vaultwarden) (an unofficial Bitwarden-compatible server written in Rust) on a Raspberry Pi at home.

**Configuration**: Raspberry Pi with external IP 81.96.238.148 (Virgin Media UK)

## Prerequisites

- Raspberry Pi (3B+ or newer recommended)
- Docker Engine 20.10.0 or later
- Docker Compose v2.0.0 or later
- A domain name or DDNS service (see setup below)
- Virgin Media router access for port forwarding

## Quick Start

### 0. Setup Domain Name (REQUIRED)

You need a domain name for HTTPS to work. Choose one option:

#### Option A: Free DDNS Service (Recommended for Home Use)

**DuckDNS** (easiest):
1. Go to https://www.duckdns.org
2. Sign in with your preferred account
3. Create a subdomain (e.g., `yourname.duckdns.org`)
4. Set the IP to: `81.96.238.148`
5. Note your token for automatic updates (optional)

**No-IP**:
1. Go to https://www.noip.com
2. Create a free account
3. Create a hostname pointing to `81.96.238.148`

#### Option B: Own Domain Name

Point your domain's A record to `81.96.238.148`

### 1. Clone and Configure

```bash
# Copy the example environment file
cp .env.example .env

# Generate a secure admin token
openssl rand -base64 48

# Edit the .env file with your settings
nano .env
```

**IMPORTANT**: Edit the `Caddyfile` and replace `vault.example.com` with your actual domain (e.g., `yourname.duckdns.org`)

```bash
nano Caddyfile
```

### 2. Essential Configuration

Edit `.env` and set at minimum:

- `DOMAIN`: Your full domain URL (e.g., `https://yourname.duckdns.org`)
- `ADMIN_TOKEN`: Secure token generated above
- `SIGNUPS_ALLOWED`: Set to `false` after creating your accounts

### 3. Virgin Media Router Port Forwarding (CRITICAL)

You MUST forward ports from your router to your Raspberry Pi:

1. **Find your Raspberry Pi's local IP**:
   ```bash
   hostname -I
   ```
   (e.g., `192.168.0.50`)

2. **Access Virgin Media Hub**:
   - Open browser and go to: `http://192.168.0.1`
   - Login with admin password (on the back of your router)

3. **Setup Port Forwarding**:
   - Navigate to: **Advanced Settings** → **Security** → **Port Forwarding**
   - Add TWO port forwarding rules:

   **Rule 1 - HTTPS:**
   - Service Name: `Bitwarden-HTTPS`
   - Protocol: `TCP`
   - External Port: `443`
   - Internal Port: `443`
   - Internal IP: `[Your Pi's IP, e.g., 192.168.0.50]`
   - Enable: `Yes`

   **Rule 2 - HTTP (for Let's Encrypt):**
   - Service Name: `Bitwarden-HTTP`
   - Protocol: `TCP`
   - External Port: `80`
   - Internal Port: `80`
   - Internal IP: `[Your Pi's IP, e.g., 192.168.0.50]`
   - Enable: `Yes`

4. **Save Settings** and wait for router to restart if needed

### 4. Start Bitwarden

```bash
# Start the services
docker compose up -d

# Watch the logs (especially important for first run to see SSL certificate generation)
docker compose logs -f

# Wait for "certificate obtained successfully" message from Caddy
# Press Ctrl+C to exit logs once services are running
```

### 5. Access Your Vault

- Web Vault: `https://yourname.duckdns.org` (or your domain)
- Admin Panel: `https://yourname.duckdns.org/admin` (use your ADMIN_TOKEN)

**Note**: First startup may take 1-2 minutes while Caddy obtains SSL certificates from Let's Encrypt.

## Virgin Media Specific Notes

### Router Models
Most Virgin Media customers have one of these Hub models:
- Hub 3 (white, VMDG505)
- Hub 4 (white, TG2492LG)
- Hub 5 (black, VMG8825-T50K)

All models support port forwarding via the web interface at `http://192.168.0.1`

### Common Virgin Media Issues

1. **Dynamic IP Address**: Your IP (81.96.238.148) may change if your router restarts
   - Use a DDNS service to automatically update your domain
   - Consider setting up DuckDNS auto-update on your Pi

2. **Modem Mode**: If someone has enabled "Modem Mode" on your Hub, port forwarding won't work
   - Check router interface - it should say "Router Mode"

3. **Static IP from Pi**: Set your Raspberry Pi to have a static local IP
   ```bash
   # Edit dhcpcd.conf
   sudo nano /etc/dhcpcd.conf

   # Add at the end (adjust to your network):
   interface eth0
   static ip_address=192.168.0.50/24
   static routers=192.168.0.1
   static domain_name_servers=192.168.0.1 8.8.8.8

   # Reboot
   sudo reboot
   ```

## Configuration Options

### Security Settings

After creating your initial accounts, it's recommended to:

```env
SIGNUPS_ALLOWED=false
INVITATIONS_ALLOWED=true  # Allow inviting users via admin panel
```

### SMTP Configuration (Email Support)

To enable email notifications (password resets, etc.), configure SMTP:

```env
SMTP_HOST=smtp.gmail.com
SMTP_FROM=bitwarden@example.com
SMTP_PORT=587
SMTP_SECURITY=starttls
SMTP_USERNAME=your-email@example.com
SMTP_PASSWORD=your-app-password
```

### Database Options

**SQLite (Default)**: No additional configuration needed. Data stored in `./bw-data/`

**PostgreSQL**: Uncomment the postgres service in `docker-compose.yml` and configure:

```env
DATABASE_URL=postgresql://bitwarden:password@postgres:5432/bitwarden
DB_USER=bitwarden
DB_PASSWORD=your-secure-password
DB_NAME=bitwarden
```

## HTTPS/SSL Setup

**This setup includes Caddy reverse proxy** which automatically handles SSL certificates from Let's Encrypt. No manual SSL configuration needed!

Caddy will automatically:
- Obtain SSL certificates on first startup
- Renew certificates before expiry
- Handle HTTP to HTTPS redirects

Just ensure:
1. Your domain points to 81.96.238.148
2. Ports 80 and 443 are forwarded in your Virgin Media router
3. The `Caddyfile` has your correct domain name

## Docker Commands

```bash
# Start services
docker compose up -d

# Stop services
docker compose down

# View logs
docker compose logs -f

# Restart Bitwarden
docker compose restart bitwarden

# Update to latest version
docker compose pull
docker compose up -d
```

## Backup

### Backup the data directory:

```bash
# Stop the container
docker compose down

# Backup data
tar -czf bitwarden-backup-$(date +%Y%m%d).tar.gz bw-data/

# Restart
docker compose up -d
```

### Automated backup script:

```bash
#!/bin/bash
BACKUP_DIR="./backups"
mkdir -p $BACKUP_DIR
docker compose exec bitwarden sqlite3 /data/db.sqlite3 ".backup '/data/db-backup.sqlite3'"
cp ./bw-data/db-backup.sqlite3 $BACKUP_DIR/db-$(date +%Y%m%d-%H%M%S).sqlite3
```

## Troubleshooting

### Cannot access the web vault

1. Check if containers are running: `docker compose ps`
2. Check logs: `docker compose logs -f`
3. Verify port forwarding is correct in Virgin Media router
4. Test if ports are open: https://www.yougetsignal.com/tools/open-ports/
   - Enter 81.96.238.148 and test ports 80 and 443
5. Verify domain DNS is pointing to 81.96.238.148:
   ```bash
   nslookup yourname.duckdns.org
   ```
6. Check Caddy logs specifically: `docker compose logs caddy`

### SSL Certificate Issues

1. **"certificate obtain failed"**:
   - Ensure ports 80 and 443 are forwarded correctly
   - Verify domain points to your IP
   - Check Caddy logs: `docker compose logs caddy`

2. **"connection not secure" warning**:
   - Wait 1-2 minutes for certificate generation on first start
   - Check if Let's Encrypt can reach your server

### Cannot access from outside home network

1. Verify your public IP hasn't changed:
   ```bash
   curl ifconfig.me
   ```
   Should return: `81.96.238.148`

2. If IP changed, update your DDNS service

3. Test port forwarding from outside your network (use mobile data)

### Email not working

1. Verify SMTP credentials in `.env`
2. Check logs for SMTP errors
3. For Gmail, use an [App Password](https://support.google.com/accounts/answer/185833)

### Admin panel not accessible

1. Ensure `ADMIN_TOKEN` is set in `.env`
2. Navigate to `/admin` and enter the token
3. Check that `WEB_VAULT_ENABLED=true`

## Security Best Practices

1. **Use HTTPS**: Always use SSL/TLS in production
2. **Disable Signups**: Set `SIGNUPS_ALLOWED=false` after account creation
3. **Strong Admin Token**: Use `openssl rand -base64 48`
4. **Regular Backups**: Automate database backups
5. **Update Regularly**: Run `docker compose pull` periodically
6. **Firewall**: Restrict access to ports 80/443 only
7. **2FA**: Enable two-factor authentication for all accounts

## Client Apps

Download official Bitwarden clients:

- Browser Extensions: Chrome, Firefox, Safari, Edge
- Desktop: Windows, macOS, Linux
- Mobile: iOS, Android
- CLI: `npm install -g @bitwarden/cli`

Configure clients to use your self-hosted instance by setting the server URL during login.

## Environment Variables Reference

| Variable | Default | Description |
|----------|---------|-------------|
| DOMAIN | https://vault.example.com | Public URL of your instance |
| SIGNUPS_ALLOWED | true | Allow new user registration |
| INVITATIONS_ALLOWED | true | Allow inviting users |
| ADMIN_TOKEN | - | Token for admin panel access |
| WEBSOCKET_ENABLED | true | Enable websocket notifications |
| HTTP_PORT | 80 | HTTP port mapping |
| WEBSOCKET_PORT | 3012 | WebSocket port mapping |

## Resources

- [Vaultwarden Wiki](https://github.com/dani-garcia/vaultwarden/wiki)
- [Bitwarden Help Center](https://bitwarden.com/help/)
- [Docker Documentation](https://docs.docker.com/)

## License

This configuration is provided as-is. Bitwarden and Vaultwarden are subject to their respective licenses.
