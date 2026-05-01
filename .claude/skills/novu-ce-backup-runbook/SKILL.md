---
name: novu-ce-backup-runbook
description: Daily Mongo + Redis backups for Novu CE — enable cron, ship to S3 with retention, and prove the restore. Use when the user says "backup novu", "set up cron", "test restore", "configure backups", or "8.x backup runbook".
---

# Backup, off-host upload, and restore drill

The bundle ships `scripts/backup.sh`. This skill operationalises it: daily cron, S3 off-host, sanitised env snapshot, and the restore drill that turns the backup from "exists" to "actually works".

Charter §10 + Appendix E both require **proven** backup before phase exit, not just configured backup.

## What the backup script captures

| Artefact | Method | Where |
|---|---|---|
| MongoDB dump | `mongodump --gzip --archive` inside the container, then `docker compose cp` | `backups/<UTC-timestamp>/mongo.gz` |
| Redis-queue snapshot | `BGSAVE` then copy `/data/dump.rdb` + `appendonlydir` | `backups/<UTC-timestamp>/redis-queue.rdb` (+ AOF dir) |
| Sanitised env | `grep -v` to strip secrets, passwords, JWT keys | `backups/<UTC-timestamp>/env.sanitized` |
| (optional) S3 upload | `aws s3 cp --recursive` if `BACKUP_S3_BUCKET` set | `s3://<bucket>/novu-ce/<timestamp>/` |
| Local retention | 14 days, older folders auto-deleted | `backups/` |

> **Redis-cache is intentionally not backed up** — it's an LRU cache by design; warm-up on restore is fast and acceptable.

## Step A — Daily cron

```bash
# On the EC2 host as ec2-user:
crontab -e
```

Add the deployment guide §8.2-recommended schedule:
```
30 2 * * *  cd /opt/novu/novu-ce-stack && ./scripts/backup.sh >> backup.log 2>&1
```

02:30 UTC ≈ 08:00 IST — runs after the lowest-traffic window, before business hours.

## Step B — Off-host S3 upload

Put the bucket name in `.env`:
```bash
echo 'BACKUP_S3_BUCKET=tpe-novu-backups-prd' >> /opt/novu/novu-ce-stack/.env
```

The IAM instance profile attached in `novu-ec2-provision` must include S3 write to that bucket:
```json
{
  "Effect": "Allow",
  "Action": ["s3:PutObject", "s3:PutObjectAcl"],
  "Resource": "arn:aws:s3:::tpe-novu-backups-prd/novu-ce/*"
}
```

Add a **bucket lifecycle rule** in S3 to age out old backups (30d → IA, 90d → Glacier, 7y delete). Do that in the bucket config — `backup.sh` doesn't manage S3 retention.

## Step C — Verify after first run

```bash
ls -la /opt/novu/novu-ce-stack/backups/
# Expect: 20260430T020000Z/  (today's run)

ls /opt/novu/novu-ce-stack/backups/2026*/
# Expect: env.sanitized, mongo.gz, redis-queue-aof/, redis-queue.rdb

aws s3 ls s3://tpe-novu-backups-prd/novu-ce/ --recursive | tail -10
# Expect: today's UTC folder with the same artefacts
```

`mongo.gz` should be at least a few MiB even on an empty pilot. If it's <100 KB, mongodump probably failed silently — check the cron `backup.log`.

## Step D — The restore drill (Appendix C, "Failure Mode Drills")

A backup that hasn't been restored once is not a backup; it's a wish. Run this on a **sandbox EC2 instance**, never on the live box.

```bash
# 1. Spin up a sandbox: novu-ec2-provision + novu-ec2-bootstrap, get to /opt/novu.
# 2. Download the latest production backup:
aws s3 cp --recursive s3://tpe-novu-backups-prd/novu-ce/<latest-ts>/ ./restore/
# 3. Bring the stack up empty:
make bootstrap     # generates fresh secrets — that's fine for a drill
make up

# 4. Restore Mongo:
docker compose cp ./restore/mongo.gz mongodb:/tmp/mongo.gz
docker compose exec mongodb mongorestore --gzip --archive=/tmp/mongo.gz --drop \
    --uri="$(grep '^MONGO_URL=' .env | cut -d= -f2-)"

# 5. Restore Redis-queue (stop redis first):
docker compose stop redis-queue
docker compose cp ./restore/redis-queue.rdb redis-queue:/data/dump.rdb
docker compose start redis-queue

# 6. Verify in dashboard: workflows, subscribers, integrations all back.
# 7. Run `make smoke` — should pass.
```

If you used a fresh `STORE_ENCRYPTION_KEY` in the sandbox (because `make bootstrap` regenerated it), **the saved provider integration credentials in the restored Mongo will not decrypt** — that's expected. To do a faithful restore, copy the original `STORE_ENCRYPTION_KEY` from the source `.env` into the sandbox `.env` *before* starting the stack.

This is the single biggest restore-drill gotcha. See `novu-ce-secret-rotation` for context.

## Step E — Document and date the drill

Open `docs/RESTORE-DRILL-LOG.md` (project-local) and append:

```
| Date       | Source backup | Sandbox host | Result | Notes |
|------------|---------------|--------------|--------|-------|
| 2026-04-30 | 20260430T0200 | i-xxx (eph)  | PASS   | smoke green; 1m 47s mongorestore |
```

Charter Appendix E acceptance: at least one successful restore drill before go-live, and quarterly thereafter.

## Common failures

| Symptom | Cause | Fix |
|---|---|---|
| `backup.log` shows `mongodump: command not found` | Used `docker exec` outside compose | Use `docker compose exec` (script already does — check working directory) |
| `mongo.gz` 0 bytes | Wrong `MONGO_URL` (auth failure) | Confirm `.env` `MONGO_URL` matches Mongo container env |
| S3 upload silent fail | Bucket region ≠ instance region without `--region` flag | Add `--region ap-south-1` in `backup.sh` aws CLI call (or set env) |
| Restore Mongo: integrations show "credentials invalid" | `STORE_ENCRYPTION_KEY` differs between source and sandbox | Copy the source key before starting the sandbox stack |
| Redis-queue restored but BullMQ jobs vanished | Redis started before `dump.rdb` was placed (RDB only loads on cold start) | Stop redis, copy file, start — never copy into a running redis |

## Next step

After backup is proven, the deployment is **operationally ready**. Move on to:
- `novu-ce-secret-rotation` — review the rotation matrix even before you need it.
- `novu-ce-upgrade` — bookmark for the next Novu version bump.
- `novu-ce-troubleshoot` — bookmark for incident response.
