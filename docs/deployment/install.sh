#!/usr/bin/env bash
set -euo pipefail

# ─────────────────────────────────────────────────────────────────────────────
# kbserve — Linux Production Install Script
# Usage: bash install.sh [--dir /opt/kbserve] [--port 3090]
# ─────────────────────────────────────────────────────────────────────────────

REPO_URL="https://github.com/your-org/kbserve.git"
INSTALL_DIR="${1:-/opt/kbserve}"
KBSERVE_PORT="${2:-3090}"
KBSERVE_USER="kbserve"
KBSERVE_GROUP="kbserve"

echo "==> kbserve installer — target: $INSTALL_DIR, port: $KBSERVE_PORT"

# ── 1. Create user and directories ──────────────────────────────────────────
if ! id -u "$KBSERVE_USER" &>/dev/null; then
    echo "==> Creating user $KBSERVE_USER"
    sudo useradd --system --no-create-home --shell /usr/sbin/nologin "$KBSERVE_USER"
fi

echo "==> Creating directories"
sudo mkdir -p "$INSTALL_DIR"
sudo mkdir -p /var/lib/kbserve
sudo chown "$KBSERVE_USER:$KBSERVE_GROUP" "$INSTALL_DIR" /var/lib/kbserve

# ── 2. Install bun if missing ───────────────────────────────────────────────
if ! command -v bun &>/dev/null; then
    echo "==> Installing bun"
    curl -fsSL https://bun.sh/install | bash
    # Source it for the current session
    export BUN_INSTALL="$HOME/.bun"
    export PATH="$BUN_INSTALL/bin:$PATH"
fi

BUN_PATH="$(command -v bun)"
echo "==> bun found at: $BUN_PATH"

# ── 3. Clone / copy project ─────────────────────────────────────────────────
if [ -d "$INSTALL_DIR/.git" ]; then
    echo "==> Updating existing installation"
    cd "$INSTALL_DIR"
    sudo -u "$KBSERVE_USER" git pull --ff-only
else
    echo "==> Cloning kbserve"
    sudo git clone --depth 1 "$REPO_URL" "$INSTALL_DIR"
    sudo chown -R "$KBSERVE_USER:$KBSERVE_GROUP" "$INSTALL_DIR"
fi

cd "$INSTALL_DIR"

# ── 4. Install dependencies ─────────────────────────────────────────────────
echo "==> Installing dependencies"
sudo -u "$KBSERVE_USER" "$BUN_PATH" install --production

# ── 5. Create environment file ──────────────────────────────────────────────
if [ ! -f "$INSTALL_DIR/.env" ]; then
    echo "==> Creating .env file"
    sudo tee "$INSTALL_DIR/.env" > /dev/null <<EOF
KBSERVE_PORT=$KBSERVE_PORT
EVOLVE_HOME=/var/lib/kbserve
NODE_ENV=production
EOF
    sudo chown "$KBSERVE_USER:$KBSERVE_GROUP" "$INSTALL_DIR/.env"
    sudo chmod 600 "$INSTALL_DIR/.env"
    echo "    Edit $INSTALL_DIR/.env to customize configuration"
fi

# ── 6. Install systemd service ──────────────────────────────────────────────
echo "==> Installing systemd service"
SERVICE_SRC="docs/deployment/kbserve.service"
if [ -f "$SERVICE_SRC" ]; then
    sudo cp "$SERVICE_SRC" /etc/systemd/system/kbserve.service
    sudo sed -i "s|/opt/kbserve|$INSTALL_DIR|g" /etc/systemd/system/kbserve.service
    sudo sed -i "s|ExecStart=.*|ExecStart=$BUN_PATH serve.ts|" /etc/systemd/system/kbserve.service
    sudo systemctl daemon-reload
    sudo systemctl enable kbserve
    sudo systemctl start kbserve
    echo "==> kbserve service started"
else
    echo "==> WARNING: $SERVICE_SRC not found — service not installed"
fi

# ── 7. Configure nginx ──────────────────────────────────────────────────────
if command -v nginx &>/dev/null; then
    echo "==> Configuring nginx"
    NGINX_CONF_SRC="docs/deployment/nginx.conf"
    if [ -f "$NGINX_CONF_SRC" ]; then
        sudo cp "$NGINX_CONF_SRC" /etc/nginx/sites-available/kbserve
        if [ ! -L /etc/nginx/sites-enabled/kbserve ]; then
            sudo ln -s /etc/nginx/sites-available/kbserve /etc/nginx/sites-enabled/
        fi
        sudo nginx -t && sudo systemctl reload nginx
        echo "==> nginx configured"
    else
        echo "==> WARNING: $NGINX_CONF_SRC not found — nginx not configured"
    fi
else
    echo "==> SKIP: nginx not installed — install it and configure manually"
fi

# ── 8. Done ─────────────────────────────────────────────────────────────────
echo ""
echo "==> kbserve installation complete!"
echo "    Service:   sudo systemctl status kbserve"
echo "    Logs:      sudo journalctl -u kbserve -f"
echo "    URL:       http://$(hostname -I | awk '{print $1}'):$KBSERVE_PORT"
echo ""
echo "==> Next steps:"
echo "    1. Edit $INSTALL_DIR/.env if needed"
echo "    2. Set up HTTPS — see docs/deployment/ssl-setup.md"
echo "    3. Open the dashboard in your browser"