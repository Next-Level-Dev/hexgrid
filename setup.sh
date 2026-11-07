#!/usr/bin/env bash
# ==============================================================================
# setup.sh — Automated Deployment & Update Script
# Conforms to Master Specification Section 17
# ==============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

CONFIG_FILE="$SCRIPT_DIR/deploy.config.json"
LOG_FILE="$SCRIPT_DIR/deploy.log"
LOCK_FILE="/tmp/hexgrid_setup.lock"

log() {
  local msg="[$(date -u +"%Y-%m-%dT%H:%M:%SZ")] $1"
  echo "$msg"
  echo "$msg" >> "$LOG_FILE"
}

# Prevent concurrent runs of setup.sh
exec 200>"$LOCK_FILE"
if ! flock -n 200; then
  log "Another instance of setup.sh is already executing. Terminating duplicate instance."
  exit 0
fi

log "=== Starting Deployment / Setup Process ==="

# 1. Load configuration
if [[ -f "$CONFIG_FILE" ]]; then
  log "Loading configuration from $CONFIG_FILE"
else
  log "Warning: $CONFIG_FILE not found, creating default"
  cat <<'EOF' > "$CONFIG_FILE"
{
  "appName": "hexgrid-tactics",
  "port": 3000,
  "nodeEnv": "production",
  "pm2ProcessName": "hexgrid-tactics",
  "useCaddy": false,
  "caddyDomain": "game.local"
}
EOF
fi

# 2. Check Git and ensure current setup halts if updated version exists on GitHub
if [[ -d ".git" ]]; then
  log "Checking git remote for updates..."
  git fetch origin 2>/dev/null || true
  REMOTE_BRANCH=$(git rev-parse --abbrev-ref --symbolic-full-name @{u} 2>/dev/null || echo "origin/main")
  
  # Check if setup.sh differs from upstream
  SETUP_UPDATED=$(git diff --name-only HEAD "$REMOTE_BRANCH" 2>/dev/null | grep "^setup.sh$" || true)
  if [[ -n "$SETUP_UPDATED" ]]; then
    log "A newer version of setup.sh is available on GitHub! Pulling changes and stopping current execution..."
    git pull --ff-only origin "$REMOTE_BRANCH" 2>/dev/null || git merge --ff-only "$REMOTE_BRANCH" 2>/dev/null || true
    chmod +x "$SCRIPT_DIR/setup.sh"
    log "Spawning updated setup.sh and halting old execution immediately..."
    flock -u 200 2>/dev/null || true
    exec "$SCRIPT_DIR/setup.sh" "$@"
    exit 0 # Guarantee that old script never continues under any circumstance
  fi

  # Pull other repository changes
  git pull --ff-only 2>/dev/null || log "Git working tree is up to date"
fi

# 3. Check required software dependencies
check_cmd() {
  if ! command -v "$1" &> /dev/null; then
    log "ERROR: Required command '$1' is not installed."
    return 1
  fi
}

check_cmd "node" || { log "Node.js is required."; exit 1; }
check_cmd "npm" || { log "npm is required."; exit 1; }

NODE_VER=$(node -v)
log "Found Node.js version: $NODE_VER"

# 4. Install PM2 if needed
if ! command -v pm2 &> /dev/null; then
  log "PM2 not found. Checking local node_modules or installing global/local..."
  if ! npm list pm2 &> /dev/null; then
    log "Installing pm2 locally as fallback..."
    npm install pm2 --no-save || true
  fi
fi

# 5. Install application dependencies
log "Installing dependencies (npm install)..."
npm install --prefer-offline --no-audit

# 6. Ensure scripts directory exists and make cron script executable
if [[ -f "$SCRIPT_DIR/scripts/cron-tick.ts" ]]; then
  chmod +x "$SCRIPT_DIR/scripts/cron-tick.ts"
fi

# 7. Configure cron job (runs every 5 minutes to check phase expiration and calculate round)
CRON_JOB="*/5 * * * * cd $SCRIPT_DIR && npm run cron >> $SCRIPT_DIR/cron.log 2>&1"
log "Checking scheduled game engine cron configuration..."
if command -v crontab &> /dev/null; then
  CURRENT_CRON=$(crontab -l 2>/dev/null || echo "")
  if [[ "$CURRENT_CRON" != *"$SCRIPT_DIR"* ]]; then
    log "Adding cron entry for turn cycle updates ($CRON_JOB)..."
    (echo "$CURRENT_CRON"; echo "# HexGrid game turn cycle"; echo "$CRON_JOB") | crontab - 2>/dev/null || log "Could not update crontab (non-critical)"
  else
    log "Crontab entry already configured."
  fi
else
  log "Note: crontab command not available in this environment. The Node.js in-process scheduler will handle cycle ticks."
fi

# 8. Verify Caddy / Webhook if configured
USE_CADDY=$(grep -o '"useCaddy": *true' "$CONFIG_FILE" || echo "")
if [[ -n "$USE_CADDY" ]] && command -v caddy &> /dev/null; then
  log "Configuring Caddy reverse proxy..."
  if [[ -f "$SCRIPT_DIR/Caddyfile" ]]; then
    caddy validate --config "$SCRIPT_DIR/Caddyfile" || log "Caddyfile validation failed"
    caddy reload --config "$SCRIPT_DIR/Caddyfile" 2>/dev/null || log "Caddy reload skipped"
  fi
fi

# 9. Build the application
log "Building application..."
npm run build

# 10. Start / restart application via PM2 or Node
PM2_APP_NAME="hexgrid-tactics"
if command -v pm2 &> /dev/null; then
  log "Managing process with PM2 ($PM2_APP_NAME)..."
  if pm2 describe "$PM2_APP_NAME" &> /dev/null; then
    log "Restarting existing PM2 process..."
    pm2 restart "$PM2_APP_NAME"
  else
    log "Starting new PM2 process..."
    pm2 start "npm run dev" --name "$PM2_APP_NAME"
  fi
  pm2 save 2>/dev/null || true
else
  log "PM2 not available in path, verifying dev/start commands are ready."
fi

log "=== Deployment finished successfully ==="
