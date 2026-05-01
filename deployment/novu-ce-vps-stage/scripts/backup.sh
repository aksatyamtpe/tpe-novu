#!/usr/bin/env bash
# =============================================================================
# Novu CE — Backup script
# -----------------------------------------------------------------------------
# Dumps MongoDB and triggers Redis RDB save, archives to ./backups/<timestamp>/.
# Optional S3 upload if BACKUP_S3_BUCKET is set.
# Cron suggestion (daily 02:30):
#   30 2 * * *  cd /opt/novu-ce-stack && ./scripts/backup.sh >> backup.log 2>&1
# =============================================================================

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
TS="$(date -u +%Y%m%dT%H%M%SZ)"
BACKUP_DIR="$ROOT_DIR/backups/$TS"
mkdir -p "$BACKUP_DIR"

# shellcheck disable=SC1091
set -a; source "$ROOT_DIR/.env"; set +a

cd "$ROOT_DIR"

echo "[backup] $TS  ->  $BACKUP_DIR"

# ----- Mongo dump --------------------------------------------------------
echo "[backup] mongodump..."
docker compose exec -T mongodb \
  mongodump \
    --uri="$MONGO_URL" \
    --gzip \
    --archive=/tmp/dump.gz
docker compose cp mongodb:/tmp/dump.gz "$BACKUP_DIR/mongo.gz"
docker compose exec -T mongodb rm -f /tmp/dump.gz
echo "[backup]   mongo.gz $(du -h "$BACKUP_DIR/mongo.gz" | cut -f1)"

# ----- Redis (queue) snapshot --------------------------------------------
echo "[backup] redis BGSAVE..."
docker compose exec -T redis-queue redis-cli -a "$REDIS_PASSWORD" --no-auth-warning BGSAVE
sleep 3
# Wait for save completion
until [ "$(docker compose exec -T redis-queue redis-cli -a "$REDIS_PASSWORD" --no-auth-warning LASTSAVE)" \
        != "$(docker compose exec -T redis-queue redis-cli -a "$REDIS_PASSWORD" --no-auth-warning LASTSAVE)" ]; do
  sleep 1
done
docker compose cp redis-queue:/data/dump.rdb "$BACKUP_DIR/redis-queue.rdb"
docker compose cp redis-queue:/data/appendonlydir "$BACKUP_DIR/redis-queue-aof" 2>/dev/null || true
echo "[backup]   redis-queue snapshot saved"

# ----- env snapshot (sanitized) ------------------------------------------
grep -vE '^(JWT_SECRET|STORE_ENCRYPTION_KEY|NOVU_SECRET_KEY|.*PASSWORD|MONGO_URL)=' .env \
  > "$BACKUP_DIR/env.sanitized" || true

# ----- Optional S3 upload -------------------------------------------------
if [[ -n "${BACKUP_S3_BUCKET:-}" ]]; then
  echo "[backup] uploading to s3://$BACKUP_S3_BUCKET/novu-ce/$TS/"
  aws s3 cp --recursive "$BACKUP_DIR" "s3://$BACKUP_S3_BUCKET/novu-ce/$TS/"
fi

# ----- Local retention (keep 14 days) ------------------------------------
find "$ROOT_DIR/backups" -maxdepth 1 -type d -name '20*' -mtime +14 -exec rm -rf {} + 2>/dev/null || true

echo "[backup] done"
