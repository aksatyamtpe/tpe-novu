---
name: novu-ce-bridge-sync
description: Sync the Bridge code-first workflows into Novu CE — `npx novu sync` for dev, plus the production environment promotion path. Use when the user says "sync workflows", "push bridge to dev", "promote workflows to prod", "update bridge workflows", or asks how to register code-first workflows.
---

# Sync Bridge workflows into Novu CE

This is **step 5 of 6** in Track B. The CE stack is up, providers are configured, but the dashboard is still showing the demo workflows badge — sync from Bridge fixes that.

The four bundled sample workflows together exercise every CE step type (`inApp`, `email`, `sms`, `push`, `chat`, `digest`, `delay`, `custom`, plus `controlSchema`, `payloadSchema`, conditional `skip`, external API calls):

| Workflow id | File | Demonstrates |
|---|---|---|
| `welcome-onboarding` | `bridge/workflows/welcome-onboarding.ts` | in-app + email + push, payload + control schemas |
| `otp-verification` | `bridge/workflows/otp-verification.ts` | SMS, email fallback, conditional skip |
| `daily-activity-digest` | `bridge/workflows/daily-digest.ts` | digest engine (event batching) |
| `policy-update` | `bridge/workflows/policy-update.ts` | email + in-app + delay + custom + Slack escalation |

These also serve as scaffolding for the 49 TPE workflows that come later — drop new workflow files under `bridge/workflows/`, export from `index.ts`, sync.

## Pre-flight
- [ ] Stack is running on the EC2 host: `make ps` shows `bridge` healthy.
- [ ] You have the `NOVU_SECRET_KEY` from `.env` (or the equivalent API Secret Key from Dashboard → Settings → API Keys for the Development environment).
- [ ] Bridge endpoint responds: `curl -fsS https://<host>/bridge/api/novu | jq .` returns the workflow discovery payload.

## Step A — Sync to Development environment

The `make sync` target wraps the CLI:

```bash
cd /opt/novu/novu-ce-stack
make sync
```

Equivalent raw command:
```bash
. ./.env && cd bridge && \
  npx novu@latest sync \
    --bridge-url http://localhost:4001/api/novu \
    --api-url    http://localhost:3000 \
    --secret-key "$NOVU_SECRET_KEY"
```

> **Why localhost URLs in `make sync`?** The make target runs *on the EC2 host* where `bridge` and `api` are reachable on loopback. From a laptop, you'd point `--bridge-url` at the public Caddy URL and `--api-url` at the public `/api` URL.

## Step B — Verify in dashboard

Dashboard → **Workflows**. The four synced workflows appear with a small **read-only / code-first** badge (you cannot edit them in the UI; they round-trip via Bridge code).

If the dashboard still shows the **"demo workflows"** badge → sync hasn't run successfully.

## Step C — Promote workflows to Production environment

Dev and Production are separate Novu environments with separate API keys. Two paths:

### Path 1 — Dashboard-driven promotion (recommended for first prod cutover)
- Dashboard → **Changes** (or "Promote" tab depending on Novu version).
- Select the dev workflow versions to promote.
- Apply.
- Verify in Production environment that workflows appear, then run an end-to-end test against the prod API key.

### Path 2 — Sync directly to production (for CI-driven flows later)

```bash
# Get the prod API key from Dashboard → switch to Production → Settings → API Keys
PROD_API_KEY=novu_prod_xxxxxxxxxx

cd /opt/novu/novu-ce-stack/bridge
npx novu@latest sync \
  --bridge-url https://novu-pilot.internal.example.com/bridge/api/novu \
  --api-url    https://novu-pilot.internal.example.com/api \
  --secret-key "$PROD_API_KEY"
```

The Makefile has `make sync-prod` ready for this — you must export `PROD_API_KEY` and `BRIDGE_PUBLIC_URL` / `API_ROOT_URL`.

## Workflow authoring loop (for adding the 49 TPE triggers)

```bash
# 1. Add a workflow file
vim bridge/workflows/ph-02-registration.ts

# 2. Export it from the registry
vim bridge/workflows/index.ts
# add: import { phRegistration } from './ph-02-registration';
# add: phRegistration to the workflows array

# 3. Rebuild the bridge container so the new workflow is served
docker compose up -d --build bridge

# 4. Sync to dev
make sync

# 5. Test trigger
curl -X POST https://<host>/api/v1/events/trigger \
  -H "Authorization: ApiKey $DEV_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"name":"ph-02-registration","to":{"subscriberId":"test"},"payload":{...}}'

# 6. When approved by CX + Compliance leads → promote to prod
```

## Common failures

| Symptom | Cause | Fix |
|---|---|---|
| `npx novu sync` → 401 / auth error | `NOVU_SECRET_KEY` env doesn't match the dashboard API Secret Key for the target environment | Copy from Dashboard → Settings → API Keys → make sure you're on the right environment (dev vs prod) |
| `npx novu sync` → talking to `api.novu.co` not your self-host | Missing `--api-url` flag | Always pass `--api-url`; `make sync` does it for you |
| Workflows show in dashboard but trigger returns "workflow not found" | Workflow synced to dev but you're using the prod API key (or vice versa) | Match API key to the environment that holds the synced workflow |
| Bridge endpoint healthy but discovery is empty | New workflow file not exported from `bridge/workflows/index.ts` | Export it; rebuild bridge container |
| `make sync` from inside the host fails with `connect ECONNREFUSED 127.0.0.1:4001` | Bridge container isn't healthy | `make logs` and look for build / runtime errors in `bridge` |

## Why Bridge over Dashboard-authored workflows

The Charter's Engineering Objective E1 is "All forty-nine lifecycle triggers live as Novu workflows in production" — those workflows must be **versioned in source control, pass the compliance middleware CI gate, and be reviewable by CX / Compliance leads before merge**. Dashboard-authored workflows can't carry that discipline. Bridge is therefore the default authoring path for TPE.

## Next step

Invoke **`novu-ce-smoke-test`** to run the bundled `scripts/smoke-test.sh` end-to-end (subscriber CRUD → topic → workflow trigger → cleanup) and confirm the deployment is dispatching messages correctly.
