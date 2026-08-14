# SSL/TLS Setup

## Option A: Let's Encrypt (Certbot) — Recommended

### Prerequisites

- A domain name (e.g., `kbserve.example.com`) pointing to your server's IP
- Ports 80 and 443 reachable from the internet
- nginx already installed and running

### Install Certbot

```bash
# Ubuntu / Debian
sudo apt update
sudo apt install certbot python3-certbot-nginx

# CentOS / RHEL / Fedora
sudo dnf install certbot python3-certbot-nginx
```

### Obtain and Install Certificate

```bash
sudo certbot --nginx -d kbserve.example.com
```

Certbot will automatically:
- Obtain a certificate from Let's Encrypt
- Modify your nginx config to enable HTTPS
- Set up auto-renewal via systemd timer

### Verify Auto-Renewal

```bash
sudo certbot renew --dry-run
```

The renewal is managed by a systemd timer:

```bash
systemctl status certbot.timer
```

### Nginx Config After Certbot

Certbot will uncomment the SSL lines in your nginx config and add the certificate paths. The resulting `server` block should include:

```nginx
listen 443 ssl http2;
ssl_certificate     /etc/letsencrypt/live/kbserve.example.com/fullchain.pem;
ssl_certificate_key /etc/letsencrypt/live/kbserve.example.com/privkey.pem;
ssl_protocols TLSv1.2 TLSv1.3;
ssl_ciphers HIGH:!aNULL:!MD5;
```

The HTTP (port 80) block will be set to redirect to HTTPS automatically.

---

## Option B: Self-Signed Certificate (Internal Use)

For internal/LAN deployments where a public domain is not available.

### Generate Self-Signed Certificate

```bash
sudo mkdir -p /etc/nginx/ssl
sudo openssl req -x509 -nodes -days 3650 -newkey rsa:4096 \
  -keyout /etc/nginx/ssl/kbserve.key \
  -out /etc/nginx/ssl/kbserve.crt \
  -subj "/C=CN/ST=State/L=City/O=Organization/CN=kbserve.local"
```

### Update Nginx Config

Edit `/etc/nginx/sites-available/kbserve` and uncomment the SSL lines, pointing to your self-signed cert:

```nginx
listen 443 ssl http2;
ssl_certificate     /etc/nginx/ssl/kbserve.crt;
ssl_certificate_key /etc/nginx/ssl/kbserve.key;
ssl_protocols TLSv1.2 TLSv1.3;
ssl_ciphers HIGH:!aNULL:!MD5;
```

### Restart Nginx

```bash
sudo nginx -t
sudo systemctl restart nginx
```

### Accepting Self-Signed Cert in Browser

- **Chrome/Edge**: Visit `https://kbserve.local`, click "Advanced" → "Proceed to kbserve.local (unsafe)"
- **Firefox**: Visit the URL, click "Advanced" → "Accept the Risk and Continue"
- **curl**: Use `-k` or `--insecure` flag

---

## Apply SSL to kbserve

Once nginx is configured with SSL (either Let's Encrypt or self-signed):

1. The `proxy_set_header X-Forwarded-Proto https;` line in nginx.conf ensures kbserve knows it's behind HTTPS
2. No changes needed inside kbserve itself — the app runs on plain HTTP on 127.0.0.1:3090
3. Restart nginx after SSL setup: `sudo systemctl restart nginx`

### Verify

```bash
curl -k https://kbserve.example.com/health
```

Expected response: `{"status":"ok"}` (or similar health check response from kbserve).