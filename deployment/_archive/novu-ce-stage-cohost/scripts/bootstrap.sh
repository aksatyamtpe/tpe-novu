#!/usr/bin/env bash
# =============================================================================
# Novu CE Stack — Bootstrap
# -----------------------------------------------------------------------------
# Generates strong secrets and copies .env.example to .env on first run.
# Idempotent: re-running will NOT overwrite an existing .env.
# =============================================================================

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
ENV_FILE="$ROOT_DIR/.env"
ENV_EXAMPLE="$ROOT_DIR/.env.example"

cd "$ROOT_DIR"

# ----- Helpers ----------------------------------------------------------------
gen_hex() { openssl rand -hex "${1:-32}"; }
gen_b64() { openssl rand -base64 "${1:-24}" | tr -d '\n=+/' | head -c "${2:-32}"; }
log()     { printf "\033[0;36m[bootstrap]\033[0m %s\n" "$*"; }
warn()    { printf "\033[0;33m[bootstrap]\033[0m %s\n" "$*"; }
die()     { printf "\033[0;31m[bootstrap]\033[0m %s\n" "$*"; exit 1; }

# ----- Pre-flight -------------------------------------------------------------
command -v openssl >/dev/null || die "openssl not found. Install it and rerun."
command -v docker  >/dev/null || die "docker not found. Install Docker and rerun."
docker compose version >/dev/null 2>&1 || die "docker compose plugin not found."

# ----- Create .env if absent --------------------------------------------------
if [[ -f "$ENV_FILE" ]]; then
  log ".env already exists — keeping existing values."
else
  log "Creating .env from .env.example"
  cp "$ENV_EXAMPLE" "$ENV_FILE"
fi

# ----- Generate secrets where placeholders remain -----------------------------
patch_if_placeholder() {
  local key="$1" value="$2"
  if grep -qE "^${key}=REPLACE_ME" "$ENV_FILE"; then
    # macOS / GNU sed compatibility
    if [[ "$(uname)" == "Darwin" ]]; then
      sed -i '' -E "s|^${key}=REPLACE_ME.*|${key}=${value}|" "$ENV_FILE"
    else
      sed -i -E "s|^${key}=REPLACE_ME.*|${key}=${value}|" "$ENV_FILE"
    fi
    log "  generated ${key}"
  fi
}

JWT_SECRET="$(gen_hex 32)"                                       # 64 hex chars
STORE_KEY="$(gen_b64 24 32)"                                     # 32 chars exact
NOVU_KEY="$(gen_hex 32)"                                         # 64 hex chars
MONGO_PWD="$(gen_b64 24 28)"                                     # 28 chars
REDIS_QUEUE_PWD="$(gen_b64 24 28)"
REDIS_CACHE_PWD="$(gen_b64 24 28)"

patch_if_placeholder "JWT_SECRET"            "$JWT_SECRET"
patch_if_placeholder "STORE_ENCRYPTION_KEY"  "$STORE_KEY"
patch_if_placeholder "NOVU_SECRET_KEY"       "$NOVU_KEY"
patch_if_placeholder "MONGO_INITDB_ROOT_PASSWORD" "$MONGO_PWD"
patch_if_placeholder "REDIS_PASSWORD"        "$REDIS_QUEUE_PWD"
patch_if_placeholder "REDIS_CACHE_PASSWORD"  "$REDIS_CACHE_PWD"

# Reconstruct MONGO_URL using the (possibly new) password
MONGO_PWD_CURRENT="$(grep -E '^MONGO_INITDB_ROOT_PASSWORD=' "$ENV_FILE" | cut -d= -f2-)"
MONGO_USER_CURRENT="$(grep -E '^MONGO_INITDB_ROOT_USERNAME=' "$ENV_FILE" | cut -d= -f2-)"
MONGO_URL_NEW="mongodb://${MONGO_USER_CURRENT}:${MONGO_PWD_CURRENT}@mongodb:27017/novu-db?authSource=admin"
if [[ "$(uname)" == "Darwin" ]]; then
  sed -i '' -E "s|^MONGO_URL=.*|MONGO_URL=${MONGO_URL_NEW}|" "$ENV_FILE"
else
  sed -i -E "s|^MONGO_URL=.*|MONGO_URL=${MONGO_URL_NEW}|" "$ENV_FILE"
fi

chmod 600 "$ENV_FILE"
log ".env ready (mode 600)."

# ----- Validation -------------------------------------------------------------
STORE_KEY_LEN="$(grep -E '^STORE_ENCRYPTION_KEY=' "$ENV_FILE" | cut -d= -f2- | tr -d '\n' | wc -c | tr -d ' ')"
[[ "$STORE_KEY_LEN" -eq 32 ]] || die "STORE_ENCRYPTION_KEY must be exactly 32 chars (got $STORE_KEY_LEN). Edit .env and re-run."

log "Pre-flight OK. Next steps:"
log "  1) Edit .env: set HOST_NAME, API_ROOT_URL, FRONT_BASE_URL for your domain"
log "  2) Edit caddy/Caddyfile: replace novu.your-domain.com"
log "  3) Run: make up"
log "  4) Sign in at the dashboard URL, set DISABLE_USER_REGISTRATION=true, restart"
