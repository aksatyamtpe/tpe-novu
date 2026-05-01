#!/usr/bin/env bash
# =============================================================================
# Novu CE — Upgrade procedure
# -----------------------------------------------------------------------------
# Usage:
#   ./scripts/upgrade.sh <new-version>
#
# What it does:
#   1) Backs up Mongo + Redis
#   2) Updates NOVU_VERSION in .env
#   3) Pulls new images
#   4) Reminds the operator to run migrations (NOT automatic — see Section 7
#      of the Enterprise Setup Guide)
#   5) Recreates services in dependency order
# =============================================================================

set -euo pipefail

NEW_VERSION="${1:-}"
[[ -n "$NEW_VERSION" ]] || { echo "Usage: $0 <new-version>"; exit 1; }

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

echo "[upgrade] backing up first..."
./scripts/backup.sh

CURRENT="$(grep -E '^NOVU_VERSION=' .env | cut -d= -f2-)"
echo "[upgrade] $CURRENT → $NEW_VERSION"

if [[ "$(uname)" == "Darwin" ]]; then
  sed -i '' -E "s|^NOVU_VERSION=.*|NOVU_VERSION=$NEW_VERSION|" .env
else
  sed -i -E "s|^NOVU_VERSION=.*|NOVU_VERSION=$NEW_VERSION|" .env
fi

echo "[upgrade] pulling images..."
docker compose pull api worker ws dashboard

cat <<'WARN'

  ┌───────────────────────────────────────────────────────────────────────┐
  │  MIGRATIONS                                                           │
  │  Novu does NOT auto-run database migrations on container start.       │
  │  Migration scripts ship in the source repo, not the docker images.    │
  │                                                                       │
  │  Before continuing:                                                   │
  │    1) Read the release notes for the target version.                  │
  │    2) If migrations are required:                                     │
  │       git clone https://github.com/novuhq/novu                        │
  │       cd novu && git checkout v<NEW_VERSION>                          │
  │       npm install -g pnpm@8 && pnpm install && pnpm build             │
  │       cd apps/api                                                     │
  │       export MONGO_URL=...   (from .env)                              │
  │       npx ts-node migrations/<script>.ts | tee /tmp/migration.log     │
  │    3) Verify document counts and indexes via mongosh.                 │
  └───────────────────────────────────────────────────────────────────────┘

WARN

read -r -p "Migrations complete (or not required)? Type YES to continue: " ACK
[[ "$ACK" == "YES" ]] || { echo "[upgrade] aborted by operator"; exit 1; }

echo "[upgrade] recreating services..."
docker compose up -d --no-deps api worker ws dashboard

echo "[upgrade] waiting for health checks..."
sleep 15
docker compose ps

echo "[upgrade] done. Run ./scripts/smoke-test.sh to verify."
