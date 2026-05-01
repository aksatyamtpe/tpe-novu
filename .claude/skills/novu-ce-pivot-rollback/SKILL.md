---
name: novu-ce-pivot-rollback
description: Revert the 2026-05-01 pivot — bring TPE Admin custom UI back online and de-emphasise the Novu CE 3.15 sandbox. Use only if the team decides Studio-via-Novu-CE doesn't meet operator needs and they want the custom admin (channel allowlist, campaign builder, scheduled triggers UI) restored as primary.
---

# Roll back the sandbox-3.15-primary pivot

## When to use this

The 2026-05-01 architectural pivot promoted the Novu CE 3.15 sandbox dashboard at `:8080` to the primary operator surface and stopped the TPE Admin custom Next.js app. Use this skill if:

- Operators report Novu's dashboard is missing critical workflows the TPE Admin UI provided (channel allowlist, campaign builder, scheduled trigger UI)
- A compliance/audit need requires the campaign builder's audit-row format that Novu's dashboard doesn't replicate
- The team decides the sandbox 3.15 evaluation is unsuccessful and live 2.3.0 + TPE Admin should remain canonical

## What this rollback does NOT touch

- **Bridge dispatch architecture** — `dispatch.ts` and the per-channel custom routing stays exactly the same. This is about UI surface, not workflow code.
- **The 17 Charter §4.3 workflows** — still in `bridge/workflows/*.ts`, still synced to Novu, still callable via API.
- **MSG91 + ICPaaS provider config** — env vars unchanged, dispatch unchanged.
- **The sandbox 3.15 stack itself** — keep it running for evaluation; just not primary anymore.

## Pre-flight

- [ ] You're SSH'd to the VPS: `ssh -i ~/.ssh/id_novu_vps -p 7576 root@103.138.96.180`
- [ ] You have access to live's secrets (the live MongoDB password, the live `NOVU_SECRET_KEY`, etc. from `/opt/novu/novu-ce-vps-stage/.env`)
- [ ] You've decided what to do with the sandbox stack — keep running, stop, or fully decommission

## The rollback

### Step 1 — Restart TPE Admin containers

The pivot stopped (not removed) `tpe-admin` and `tpe-admin-worker`. Bring them back:

```bash
ssh -i ~/.ssh/id_novu_vps -p 7576 root@103.138.96.180

docker start tpe-admin tpe-admin-worker

# Verify they're up + healthy
docker ps --filter name=tpe-admin --format "table {{.Names}}\t{{.Status}}"
# Expect both showing "Up" within 10-30 seconds (admin needs Mongo + Postgres handshake)
```

### Step 2 — Verify TPE Admin dependencies are still wired

The custom admin reads from MongoDB (`tpe_*` collections) and the analytics Postgres co-tenant. Confirm both are reachable:

```bash
# MongoDB (the admin reads tpe_channel_gating, tpe_campaigns, etc.)
docker exec tpe-admin sh -c 'node -e "
  const {MongoClient} = require(\"mongodb\");
  MongoClient.connect(process.env.MONGO_URL).then(c =>
    c.db().listCollections().toArray()
  ).then(cs => console.log(cs.map(c => c.name).filter(n => n.startsWith(\"tpe_\"))))
"'
# Expect: tpe_channel_gating, tpe_campaigns, tpe_campaign_runs, tpe_scheduled_triggers, tpe_admin_templates

# Analytics Postgres (the campaign builder reads tbl_allocation, etc.)
docker exec tpe-admin sh -c 'node -e "
  const {Pool} = require(\"pg\");
  const p = new Pool({connectionString: process.env.ANALYTICS_DB_URL});
  p.query(\"SELECT COUNT(*) FROM tbl_allocation\").then(r => console.log(r.rows[0].count))
"'
# Expect: 60946 (or whatever the row count is now)
```

If either fails, see `staging_host_vps.md` for network connectivity recovery (`docker network connect novu postgres17` is a common need after `docker compose down`).

### Step 3 — Verify TPE Admin UI is accessible

```bash
curl -fI http://localhost/admin/ 2>&1 | head -3
# Expect: HTTP/1.1 200 OK
```

Then on your laptop:
```
open http://103.138.96.180/admin
```

Login: `tpe-stage-2026` (the MVP single-password gate).

### Step 4 — Re-seed channel allowlist if it was wiped

The channel allowlist (`tpe_channel_gating` Mongo doc) gates SMS/WhatsApp/Email/InApp dispatch. If sandbox migration deleted it:

```bash
LIVE_MONGO_PW=$(grep '^MONGO_INITDB_ROOT_PASSWORD=' /opt/novu/novu-ce-vps-stage/.env | cut -d= -f2)
docker exec novu-mongodb mongosh --quiet \
  -u novu_root -p "$LIVE_MONGO_PW" --authenticationDatabase admin novu-db --eval '
    db.tpe_channel_gating.replaceOne(
      {_id: "singleton"},
      {_id: "singleton", sms: true, whatsapp: true, email: false, inApp: false, updatedAt: new Date()},
      {upsert: true}
    )
'
```

The default re-seeded above (SMS+WA on, Email+InApp off) matches stage's pre-pivot config. Adjust per your needs via `/admin/channels` after restart.

### Step 5 — Decide what to do with the sandbox 3.15 stack

| Option | When to use | Commands |
|---|---|---|
| **Keep running** (recommended for short-term post-rollback) | You want the 3.15 sandbox available for future evaluation; it doesn't affect live | (do nothing) |
| **Stop containers** | Reduce VPS load while keeping data intact for later resume | `cd /opt/novu-next/sandbox && docker compose stop` |
| **Stop + remove containers + keep volumes** | Aggressive cleanup but data is preserved | `cd /opt/novu-next/sandbox && docker compose down` |
| **Full decommission** | Decided the 3.15 evaluation is permanently abandoned | `cd /opt/novu-next/sandbox && docker compose down -v` (⚠ destroys sandbox Mongo + Redis volumes) |

### Step 6 — Update operator-facing communications

After rollback, send to the ops team:
- New primary URL: `http://103.138.96.180/admin` (TPE Admin)
- Login: `tpe-stage-2026`
- Sandbox URL (if kept): `http://103.138.96.180:8080` — only for evaluation, not for daily ops

### Step 7 — Update memory

Edit (or supersede) the `sandbox_315_primary.md` memory file with a "ROLLED BACK <date>" header so the next session doesn't follow stale instructions. Add a new memory file `pivot_rollback_<date>.md` documenting the rollback decision.

## Verification

| Check | Expected |
|---|---|
| `docker ps --filter name=tpe-admin` shows 2 containers Up | ✓ |
| `curl -fI http://localhost/admin/` returns 200 | ✓ |
| `/admin/channels` page renders 4 checkboxes with correct toggles | ✓ |
| `/admin/campaigns` page lists existing campaigns | ✓ |
| Fire-now on an existing campaign produces a `tpe_campaign_runs` doc with sane perRow array | ✓ |
| `/admin/scheduled` page lists scheduled triggers | ✓ |

## Rollback of the rollback (i.e. restoring the pivot)

If you decide TPE Admin still doesn't meet needs and want sandbox-primary back:
- Run `docker stop tpe-admin tpe-admin-worker`
- Re-run `novu-ce-sandbox-bridge-recreate` skill (idempotent)
- Re-run `novu-ce-bridge-sync` for the sandbox API
- Operators flip back to `:8080`

The two architectures are functionally swappable on the same VPS — just point operators at one URL or the other.

## Related memory

- `sandbox_315_primary.md` — what the pivot did and why
- `staging_host_vps.md` — VPS container inventory + network topology
- `stage_channel_gating.md` — the channel allowlist semantics + Bridge cache
- `campaigns_phase1a.md` — the campaign builder feature set being restored
- `architecture_code_first_only.md` — the rule that survives both architectures (workflows are still code-first)
