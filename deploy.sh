#!/usr/bin/env bash
# ==============================================================================
# setup.sh — HexGrid deployment
#
# Project layout:
#   package.json / bun.lock  -> root-level dependencies and scripts
#   server.ts                -> server entry point
#   server/                  -> server modules (not a separate package)
#   src/ + vite.config.ts    -> Vite client
#   scripts/cron-tick.ts     -> scheduled game tick
# ==============================================================================

set -Eeuo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# ------------------------------------------------------------------------------
# Configuration (can be overridden through environment variables)
# ------------------------------------------------------------------------------
APP_NAME="${APP_NAME:-hexgrid}"
PM2_PROCESS_NAME="${PM2_PROCESS_NAME:-hexgrid}"
DEPLOY_BRANCH="${DEPLOY_BRANCH:-main}"
SERVER_ENTRY="${SERVER_ENTRY:-server.ts}"
CADDYFILE="${CADDYFILE:-/etc/caddy/Caddyfile}"

LOG_DIR="${LOG_DIR:-$SCRIPT_DIR}"
LOG_FILE="$LOG_DIR/deploy.log"
MAX_LOGS=10
LOCK_FILE="/tmp/${APP_NAME}_setup.lock"
CRON_LOG="$SCRIPT_DIR/cron.log"

mkdir -p "$LOG_DIR"

# ------------------------------------------------------------------------------
# Rotate deployment logs: deploy.log -> deploy-1.log ... deploy-10.log
# ------------------------------------------------------------------------------
for ((i=MAX_LOGS-1; i>=1; i--)); do
    if [[ -f "$LOG_DIR/deploy-$i.log" ]]; then
        mv -f -- "$LOG_DIR/deploy-$i.log" "$LOG_DIR/deploy-$((i+1)).log"
    fi
done

if [[ -f "$LOG_FILE" ]]; then
    mv -f -- "$LOG_FILE" "$LOG_DIR/deploy-1.log"
fi

rm -f -- "$LOG_DIR/deploy-$((MAX_LOGS+1)).log"

# All subsequent output goes to the new log and the terminal.
exec > >(tee -a "$LOG_FILE") 2>&1

log() {
    printf '[%s] %s\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" "$*"
}

on_error() {
    local status=$?
    log "!!! DEPLOY FAILED at line ${BASH_LINENO[0]:-unknown} with exit code ${status} !!!"
    exit "$status"
}
trap on_error ERR

# ------------------------------------------------------------------------------
# Prevent overlapping deployments
# ------------------------------------------------------------------------------
exec 200>"$LOCK_FILE"
if ! flock -n 200; then
    log "Another HexGrid deployment is already running; exiting."
    exit 0
fi

log "============================================================"
log "Starting HexGrid deployment"
log "Repository: $SCRIPT_DIR"
log "Branch: $DEPLOY_BRANCH"
log "============================================================"

# ------------------------------------------------------------------------------
# Validate project layout and required tools
# ------------------------------------------------------------------------------
for required_file in package.json bun.lock "$SERVER_ENTRY" vite.config.ts; do
    if [[ ! -f "$SCRIPT_DIR/$required_file" ]]; then
        log "ERROR: Required project file not found: $required_file"
        exit 1
    fi
done

for cmd in git bun pm2 caddy systemctl flock; do
    if ! command -v "$cmd" >/dev/null 2>&1; then
        log "ERROR: Required command '$cmd' is not installed or not in PATH."
        exit 1
    fi
done

log "Bun version: $(bun --version)"
log "Node version (if installed): $(node --version 2>/dev/null || echo 'not installed')"

# ------------------------------------------------------------------------------
# Update repository
# ------------------------------------------------------------------------------
log "--- Fetching latest repository changes ---"
git fetch origin "$DEPLOY_BRANCH"
git reset --hard "origin/$DEPLOY_BRANCH"

# Re-check files after updating the checkout.
for required_file in package.json bun.lock "$SERVER_ENTRY" vite.config.ts; do
    if [[ ! -f "$SCRIPT_DIR/$required_file" ]]; then
        log "ERROR: Required project file missing after update: $required_file"
        exit 1
    fi
done

# ------------------------------------------------------------------------------
# Install the SINGLE root-level dependency set.
# There is no server/package.json; server.ts uses the root package.
# ------------------------------------------------------------------------------
log "--- Installing root project dependencies with Bun ---"
bun install --frozen-lockfile

# ------------------------------------------------------------------------------
# Build the Vite client from the root package
# ------------------------------------------------------------------------------
log "--- Building Vite client ---"
bun run build

if [[ ! -d "$SCRIPT_DIR/dist" ]]; then
    log "ERROR: Vite build completed but the expected dist/ directory is missing."
    exit 1
fi

log "Vite production build found at: $SCRIPT_DIR/dist"

# ------------------------------------------------------------------------------
# Configure the five-minute game tick cron job
# ------------------------------------------------------------------------------
if [[ -f "$SCRIPT_DIR/scripts/cron-tick.ts" ]] && command -v crontab >/dev/null 2>&1; then
    BUN_BIN="$(command -v bun)"
    CRON_MARKER="# HexGrid game turn cycle"
    CRON_JOB="*/5 * * * * cd '$SCRIPT_DIR' && '$BUN_BIN' run scripts/cron-tick.ts >> '$CRON_LOG' 2>&1"

    CURRENT_CRON="$(crontab -l 2>/dev/null || true)"
    # Replace the prior HexGrid marker and its cron line, if present, so an
    # older npm-based entry is upgraded to the Bun command.
    UPDATED_CRON="$(printf '%s\\n' "$CURRENT_CRON" | awk -v marker="$CRON_MARKER" '
        $0 == marker { getline; next }
        { print }
    ')"
    log "--- Updating five-minute game tick cron job ---"
    {
        printf '%s\\n' "$UPDATED_CRON"
        printf '%s\\n' "$CRON_MARKER"
        printf '%s\\n' "$CRON_JOB"
    } | crontab -
else
    log "Cron not configured (cron-tick.ts or crontab is unavailable)."
fi

# ------------------------------------------------------------------------------
# Start/restart the root-level server.ts with PM2
# ------------------------------------------------------------------------------
log "--- Restarting HexGrid server with PM2 ---"
BUN_BIN="$(command -v bun)"

if pm2 describe "$PM2_PROCESS_NAME" >/dev/null 2>&1; then
    pm2 restart "$PM2_PROCESS_NAME" --update-env
else
    pm2 start "$BUN_BIN" \
        --name "$PM2_PROCESS_NAME" \
        --interpreter none \
        --cwd "$SCRIPT_DIR" \
        -- run "$SERVER_ENTRY"
fi

pm2 save

# ------------------------------------------------------------------------------
# Validate and reload the system Caddy service
# ------------------------------------------------------------------------------
log "--- Validating Caddy configuration ---"
if [[ ! -f "$CADDYFILE" ]]; then
    log "ERROR: Caddyfile not found at '$CADDYFILE'. Set CADDYFILE if it is elsewhere."
    exit 1
fi

sudo caddy validate --config "$CADDYFILE"
log "--- Reloading Caddy through systemd ---"
sudo systemctl reload caddy

log "============================================================"
log "HexGrid deployment finished successfully at $(date -u '+%Y-%m-%dT%H:%M:%SZ')"
log "PM2 process: $PM2_PROCESS_NAME"
log "Vite output: $SCRIPT_DIR/dist"
log "Deployment log: $LOG_FILE"
log "============================================================"
