---
name: novu-ce-smoke-test
description: Run the bundled end-to-end smoke test against a deployed Novu CE stack — verifies every CE capability (health, subscriber CRUD, topics, workflow trigger). Use when the user says "smoke test", "verify all CE features", "make smoke", "run the e2e check", or "is the deployment ready".
---

# End-to-end smoke test for Novu CE

This is **step 6 of 6** in Track B. It exercises every CE capability the team's bundle was designed to verify. Pass = the deployment is feature-complete (within CE scope) and ready for the per-trigger workflow rollout.

## What the smoke test covers (`scripts/smoke-test.sh`)

| Stage | Verifies |
|---|---|
| 1. Health | api, ws, dashboard, bridge endpoints all return 2xx |
| 2. Subscriber CRUD | `POST /v1/subscribers`, `GET /v1/subscribers/{id}` |
| 3. Topic ops | Create topic, add subscriber, ready for broadcast |
| 4. Workflow trigger | `POST /v1/events/trigger` for `welcome-onboarding` returns `acknowledged: true` |
| 5. Cleanup | `DELETE /v1/subscribers/{id}` |

## Pre-flight
- [ ] Stack is up: `make ps` shows all 11 services healthy (use `novu-ce-deploy` if not).
- [ ] Bridge workflows have been synced: `make sync` succeeded (use `novu-ce-bridge-sync` if not).
- [ ] You have the **Development environment API Secret Key** from Dashboard → Settings → API Keys.
- [ ] You're running the test from inside the EC2 host (the script's defaults are `localhost`); for an external run, override the env vars.

## Running the smoke test

### From the EC2 host (loopback URLs)
```bash
cd /opt/novu/novu-ce-stack
export NOVU_API_KEY="novu_dev_xxxxxxxxxxxx"   # from Dashboard → Settings → API Keys
make smoke
```

### From your laptop (public Caddy URLs)
```bash
export NOVU_API_KEY="novu_dev_xxxxxxxxxxxx"
export API_URL="https://novu-pilot.internal.example.com/api"
export WS_URL="https://novu-pilot.internal.example.com/ws"
export BRIDGE_URL="https://novu-pilot.internal.example.com/bridge"
export DASHBOARD_URL="https://novu-pilot.internal.example.com"
./scripts/smoke-test.sh
```

Successful run prints the green ✓ on every step and ends with:
```
All CE feature smoke tests passed.
```

## What "passed" doesn't mean

The bundled smoke is a **feature-existence** test, not a load test or a per-trigger test. A green smoke does **not** mean:
- Provider deliverability is good (run `docs/FEATURE-CHECKLIST.md` §6/§7 for that)
- All 49 TPE workflows work (each has its own per-trigger acceptance test under Charter §10)
- Your DLT templates are accepted by the operators (you need real-message reconciliation for that)
- Compliance middleware is firing (it isn't — middleware lives in the actual TPE workflow code, not the bundled samples)

## Manual checks beyond `make smoke` (Appendix C of the deployment guide)

After `make smoke` passes, also verify:

### Liveness / readiness
```bash
curl -fsS https://<host>/api/v1/health-check     # → {"status":"ok"}
curl -fsS https://<host>/ws/health-check         # → 200
docker compose exec mongodb mongosh --quiet \
  --eval "db.adminCommand('ping').ok"            # → 1
docker compose exec redis-queue redis-cli \
  -a "$REDIS_PASSWORD" --no-auth-warning ping    # → PONG
```

### Failure-mode drills (run on first deploy + quarterly)
- Stop Mongo container — confirm api becomes unhealthy, alarms fire (or would fire if alerting were wired).
- Stop Redis-queue — confirm worker stops processing; queue depth metric grows; alarm.
- Saturate the worker with bulk triggers — confirm autoscale (Track A) or graceful queue drain (Track B).
- Rotate `JWT_SECRET` — confirm sessions invalidate; rolling restart works (see `novu-ce-secret-rotation`).

### Provider deliverability spot checks (`docs/FEATURE-CHECKLIST.md`)
- §6 Email: trigger a workflow → email arrives → headers show DKIM pass / SPF pass / DMARC aligned.
- §7 SMS: trigger a workflow → SMS arrives at a real test number → MSG91 logs show DLT template ID.
- §8 Push: register a real FCM token → trigger → device receives push → tap deep-links.
- §9 Slack: trigger an OPS workflow → message lands in the configured channel.

## Common failures

| Symptom | Cause | Fix |
|---|---|---|
| `make smoke` aborts: `Set NOVU_API_KEY` | env var not exported | `export NOVU_API_KEY="$(grep ... Settings)"` |
| Step 4 fails: `trigger failed` with `workflow not found` | Workflows not synced to dev environment | `make sync` first |
| Step 1 fails on `bridge` | Bridge container unhealthy | `make logs` → look for build / runtime errors |
| Step 4 returns 200 but `acknowledged: false` | Workflow exists but didn't validate (e.g. payload schema mismatch) | Inspect Activity Feed in dashboard |
| Random ENOTFOUND when running from outside | Public DNS not yet propagated | Wait or run from EC2 host with localhost URLs |

## Tying smoke results to acceptance

Charter §7.2 ties **deliverable acceptance** to phase exit. The smoke test is one input to Engineering Lead sign-off on the CE stack deliverable, but per-deliverable acceptance also requires:
- Backup runbook proven (`novu-ce-backup-runbook` skill)
- Restore tested at least once (Appendix E item)
- All items in `docs/FEATURE-CHECKLIST.md` §1–§20 ticked

Until those are also done, `make smoke` passing is necessary but not sufficient for go-live.

## Next step

Move into day-2 ops:
- `novu-ce-backup-runbook` — daily backups + restore drill
- `novu-ce-providers-config` — verify providers if not done already
- `novu-ce-troubleshoot` — bookmark for incident response
