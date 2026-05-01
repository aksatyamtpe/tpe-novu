---
name: novu-ce-upgrade
description: Upgrade Novu CE to a new version safely — backup, bump NOVU_VERSION, pull images, run migrations from source tree, recreate services, smoke. Use when the user says "upgrade novu", "bump to 2.4.x", "release upgrade", or asks how to apply Novu version updates.
---

# Upgrade Novu CE to a new release

The bundle ships `scripts/upgrade.sh`. This skill explains *what it does, what it deliberately doesn't do, and how to handle migrations* — the part that's neither in the script nor in the Docker images.

## What the script does (`scripts/upgrade.sh`)

1. Calls `scripts/backup.sh` first — non-negotiable.
2. Updates `NOVU_VERSION` in `.env`.
3. `docker compose pull api worker ws dashboard` (Bridge is built locally, not pulled).
4. **Pauses with a warning prompt** about migrations — the operator must type `YES` to continue.
5. `docker compose up -d --no-deps api worker ws dashboard`.

## What the script deliberately does NOT do

- It **does not run database migrations**. Novu's migrations live in the source repo (`apps/api/migrations/<script>.ts`), not in the published Docker images. Running migrations is a manual procedure done from a clone of the repo at the target version tag.
- It **does not rebuild Bridge**. If your Bridge code uses framework features added in the new Novu version, you'll need `docker compose up -d --build bridge` after the api/worker upgrade.
- It **does not test workflows or providers** — that's `make smoke` afterwards.
- It **does not roll back** on failure. Rollback is restore-from-backup + revert `NOVU_VERSION`.

## Pre-flight

- [ ] Read the release notes for the target version: https://github.com/novuhq/novu/releases — note any breaking changes, env additions, or migration scripts.
- [ ] Backup verified within the last 24h (`novu-ce-backup-runbook`).
- [ ] Maintenance window scheduled (~30 min for a routine bump, longer if migrations are involved).
- [ ] CI/CD freeze for the duration — no `npx novu sync` to prod during the upgrade.
- [ ] If migrations are needed: source tree is checked out at `v<NEW_VERSION>` somewhere reachable, or a migration host is ready.

## Step-by-step

### 1. Backup
```bash
cd /opt/novu/novu-ce-stack
./scripts/backup.sh
ls -lh backups/$(ls -t backups/ | head -1)/
# Confirm mongo.gz and redis-queue.rdb both have non-trivial size.
```

### 2. Run the upgrade script (it'll backup again — that's fine, idempotent)
```bash
./scripts/upgrade.sh 2.4.0
# OR via make:
make upgrade VERSION=2.4.0
```

The script pauses with the migration warning. **Stop and read the release notes before typing YES.**

### 3. If migrations are required

Per deployment guide §7. From a workstation or migration host (NOT the production EC2):

```bash
git clone https://github.com/novuhq/novu
cd novu
git checkout v2.4.0
npm install -g pnpm@8
pnpm install
pnpm build

cd apps/api
# Get the live MONGO_URL from production .env (read carefully, don't leak)
export MONGO_URL='mongodb://novu_root:****@<prod-mongo>:27017/novu-db?authSource=admin'
# Run the specific migration script(s) listed in the release notes:
npx ts-node migrations/<script-name>.ts | tee /tmp/migration-2.4.0.log
```

Verify after migration:
```bash
docker compose -f /opt/novu/novu-ce-stack/docker-compose.yml \
  exec mongodb mongosh --quiet \
  --eval "use novu-db; db.notificationtemplates.getIndexes(); db.subscribers.getIndexes(); db.messages.getIndexes()"
```

If indexes are still only `_id_`, the migration didn't actually run — re-check the log.

### 4. Resume the upgrade script

Type `YES` when prompted. The script recreates the Novu services with the new image tag.

### 5. Smoke test
```bash
make smoke
```

Plus dashboard manual checks: workflows still listed, integrations still present, recent activity intact.

### 6. Rebuild Bridge if needed

If the release notes mention `@novu/framework` API changes:

```bash
cd /opt/novu/novu-ce-stack/bridge
# Bump @novu/framework in package.json to match release notes
npm install
cd ..
docker compose up -d --build bridge
make sync
```

## Rollback (if anything is wrong)

1. Revert `NOVU_VERSION` in `.env` to the prior version.
2. `docker compose pull api worker ws dashboard`.
3. `docker compose up -d --no-deps api worker ws dashboard`.
4. **If migrations were run:** restore Mongo from the backup taken in step 1 (per `novu-ce-backup-runbook`). Migrations are not always reversible — restore is the safe path.
5. Run smoke; confirm green; then post-mortem.

## Common failures

| Symptom | Cause | Fix |
|---|---|---|
| `docker compose pull` 404 on the new tag | Wrong tag — Novu releases drop `v` prefix in ghcr.io | Use `2.4.0`, not `v2.4.0`, in `NOVU_VERSION` |
| api crash-loops on the new version | New required env var not set | Read release notes; `Appendix A — Full Environment Variable Reference` lists every Novu env |
| api healthy but workflows return "internal error" | Migration not run | Run the migration; restart api |
| Bridge fails to build after upgrade | `@novu/framework` major bump with breaking changes | Update workflow code per framework migration notes; rebuild |
| Worker stuck restarting | Redis schema change in BullMQ | Read release notes; in some versions, queues need to be flushed and re-populated — DESTRUCTIVE, do only if release notes say so |

## How to apply
- Never advise upgrading on a Friday afternoon, before a holiday, or during a known traffic spike.
- Treat **every** Novu version bump as a runbook operation, not a `docker pull`. Migrations are the asymmetric risk.
- Post-upgrade, leave the previous image tag in `.env` notes for 30 days so rollback paths stay obvious.
