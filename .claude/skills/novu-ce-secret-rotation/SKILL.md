---
name: novu-ce-secret-rotation
description: Rotate Novu secrets safely — JWT_SECRET (easy), NOVU_SECRET_KEY (medium), STORE_ENCRYPTION_KEY (the hard one — re-encrypts every saved provider credential), Mongo/Redis passwords, provider keys. Use when the user says "rotate JWT", "rotate STORE_ENCRYPTION_KEY", "rotate provider keys", "30.x rotation runbook".
---

# Secret rotation runbook for Novu CE

Rotating secrets in a self-hosted Novu deployment is **not all the same difficulty**. Three of the secrets have surgical constraints that bite if rotated naively. This skill encodes the deployment guide §30.

## Rotation matrix

| Secret | Difficulty | Rotation cadence | Touch when |
|---|---|---|---|
| `JWT_SECRET` | Easy | Annually + on suspected compromise | Any operator session leak |
| `NOVU_SECRET_KEY` | Medium | Annually | Bridge re-deploy |
| `STORE_ENCRYPTION_KEY` | **Hard — runbook procedure** | Only on confirmed compromise (avoid otherwise) | A leaked `.env` |
| `MONGO_INITDB_ROOT_PASSWORD` | Medium | Annually | Per data layer policy |
| `REDIS_PASSWORD` (queue) | Medium | Annually | Per data layer policy |
| `REDIS_CACHE_PASSWORD` | Easy | Annually | Per data layer policy |
| Provider keys (SES IAM, MSG91, Gupshup, FCM) | Easy | Annually with overlap | Provider admin policy |

## §30.2 — Rotate `JWT_SECRET` (Easy)

Effect: invalidates all operator sessions. Operators must sign in again. No data loss.

```bash
cd /opt/novu/novu-ce-stack
NEW_JWT="$(openssl rand -hex 32)"
sed -i "s|^JWT_SECRET=.*|JWT_SECRET=$NEW_JWT|" .env
docker compose up -d --no-deps api ws dashboard worker
make ps
```

Wait for health checks. Test sign-in. Done.

## §30.4 — Rotate `NOVU_SECRET_KEY` (Medium)

Effect: invalidates Bridge HMAC, breaks `npx novu sync` until Bridge restarts with the new key.

```bash
cd /opt/novu/novu-ce-stack
NEW_KEY="$(openssl rand -hex 32)"
sed -i "s|^NOVU_SECRET_KEY=.*|NOVU_SECRET_KEY=$NEW_KEY|" .env

# Restart api + worker + bridge so all read the new key:
docker compose up -d --no-deps api worker bridge

# Re-sync to confirm new key works end-to-end:
make sync
```

If you have CI workflows pinned to `NOVU_SECRET_KEY`, update the CI secret too — they'll start failing on the next run otherwise.

## §30.3 — Rotate `STORE_ENCRYPTION_KEY` (THE HARD ONE)

`STORE_ENCRYPTION_KEY` encrypts **every saved provider credential** in MongoDB (SES access keys, MSG91 auth keys, FCM JSON, Slack webhooks, etc.). Rotating naively makes them unreadable.

> **Default position: do NOT rotate `STORE_ENCRYPTION_KEY` unless you have evidence of compromise.** It costs you a maintenance window, a re-issuance of every provider credential, and a re-test of every channel.

### Prerequisites
- [ ] Backup taken via `novu-ce-backup-runbook` and verified.
- [ ] Maintenance window scheduled — workflows must not run during the rotation.
- [ ] List of every Integration in Dashboard → Integrations (channel + providerId).
- [ ] All provider credentials available again (you may need to re-issue some via the provider admin UI if your password manager doesn't have them).
- [ ] Compliance Lead and Project Owner notified — this is a Sev-2 if anything goes sideways.

### Procedure (deployment guide §30.3)

```bash
cd /opt/novu/novu-ce-stack

# 1. Quiesce: stop dispatch
docker compose stop worker
sleep 5    # let in-flight jobs settle

# 2. Snapshot current integrations via API (requires NOVU_API_KEY)
curl -fsS https://<host>/api/v1/integrations \
  -H "Authorization: ApiKey $NOVU_API_KEY" \
  | jq '.data[] | {channel, providerId, _id}' \
  > /tmp/integrations-before.json

# 3. Delete each integration via the Dashboard (Settings → Integrations → … → Delete)
#    OR via API:
for id in $(jq -r '._id' /tmp/integrations-before.json); do
  curl -X DELETE -fsS https://<host>/api/v1/integrations/$id \
       -H "Authorization: ApiKey $NOVU_API_KEY"
done

# 4. Generate the new key (EXACTLY 32 chars):
NEW_STORE_KEY="$(openssl rand -base64 24 | tr -d '\n=+/' | head -c 32)"
echo -n "$NEW_STORE_KEY" | wc -c    # must print exactly 32
sed -i "s|^STORE_ENCRYPTION_KEY=.*|STORE_ENCRYPTION_KEY=$NEW_STORE_KEY|" .env

# 5. Restart api + worker + bridge:
docker compose up -d --no-deps api worker bridge

# 6. Re-add every integration through the Dashboard with fresh provider credentials.
# 7. Test send on each channel.
# 8. Resume worker if it didn't auto-restart, run `make smoke`.
```

The deployment guide also documents a **migration path** that re-encrypts in place (decrypt with old key → encrypt with new key for every credential row in `notificationintegrations` collection). It's a custom Mongo script — only attempt if rotation is mandatory and downtime cannot be tolerated. Get Engineering Lead sign-off.

## §30.5 — Rotate MongoDB password (Medium)

```bash
cd /opt/novu/novu-ce-stack
NEW_MONGO_PWD="$(openssl rand -base64 24 | tr -d '\n=+/' | head -c 28)"

# Update Mongo's user inside the container:
docker compose exec -T mongodb mongosh \
  -u novu_root -p "$(grep '^MONGO_INITDB_ROOT_PASSWORD=' .env | cut -d= -f2-)" \
  --eval "db.getSiblingDB('admin').changeUserPassword('novu_root', '$NEW_MONGO_PWD')"

# Update .env:
sed -i "s|^MONGO_INITDB_ROOT_PASSWORD=.*|MONGO_INITDB_ROOT_PASSWORD=$NEW_MONGO_PWD|" .env
NEW_URL="mongodb://novu_root:$NEW_MONGO_PWD@mongodb:27017/novu-db?authSource=admin"
sed -i "s|^MONGO_URL=.*|MONGO_URL=$NEW_URL|" .env

# Restart all services that read MONGO_URL:
docker compose up -d --no-deps api worker ws dashboard
```

If the in-container password change fails (`mongosh` connection refused), you've blocked yourself out of Mongo — restore from backup and try again. Backup first, always.

## §30.6 — Rotate provider keys (with overlap)

Never replace — always **overlap**:
1. Generate new key in the provider admin (SES IAM, MSG91, Gupshup, etc.).
2. Add a *new* Integration in Novu with the new key (don't delete the old one yet).
3. Set the new integration as **Primary** for the channel.
4. Run `make smoke` (or trigger a real test workflow per channel).
5. Watch the Activity Feed for 24h — confirm dispatches are using the new key.
6. Delete the old integration. Revoke the old key in the provider admin.

This is the only way to roll back without an outage if the new key turns out to be wrong.

## Common failures

| Symptom | Cause | Fix |
|---|---|---|
| Bootstrap aborts: `STORE_ENCRYPTION_KEY must be exactly 32 chars` | Pasted a key with a newline or extra char | Regenerate; verify with `echo -n "$KEY" \| wc -c` |
| After STORE rotation, Activity Feed shows "credentials invalid" on every send | Forgot to delete + re-add integrations after rotating the key | Re-add integrations as in step 6 above |
| After Mongo pwd rotation, api can't connect | `MONGO_URL` not regenerated with new password | Reconstruct manually; restart api/worker/ws/dashboard |
| Provider key rotation breaks dispatch | Set new key as Primary but forgot to test before deleting old | Restore old integration from your records; revoke new key; investigate |

## How to apply
- Default: don't rotate `STORE_ENCRYPTION_KEY` unless mandatory. Annual rotation of JWT, Mongo/Redis passwords, and provider keys is sufficient for most policies.
- Pair every rotation with a backup BEFORE starting and a smoke test AFTER.
- Compliance Lead must be notified before any rotation that touches the audit trail surface (provider keys, Mongo password).
