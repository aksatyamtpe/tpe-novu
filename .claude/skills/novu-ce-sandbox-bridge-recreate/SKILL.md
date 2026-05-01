---
name: novu-ce-sandbox-bridge-recreate
description: Recreate the sandbox `next-bridge` container with real MSG91 + ICPaaS provider creds cloned from the live `novu-bridge`. Use when the sandbox bridge is in placeholder-creds state (e.g. after a compat test) or has been wiped. Restores the canonical setup that lets the 3.15 sandbox dispatch SMS/WhatsApp end-to-end.
---

# Recreate sandbox next-bridge with real provider creds

## When to use this

- The 3.15 sandbox (`:8080`) can't fire MSG91 SMS or ICPaaS WhatsApp because `next-bridge` has placeholder env vars
- You wiped or stopped `next-bridge` and need to bring it back with the same provider config as the live `novu-bridge`
- You're recovering from a `docker rm -f next-bridge`

This is the first half of restoring the 3.15-primary architecture (the second half is syncing the 17 Charter workflows — see `novu-ce-bridge-sync`).

## Pre-flight

- [ ] You're SSH'd to the VPS: `ssh -i ~/.ssh/id_novu_vps -p 7576 root@103.138.96.180`
- [ ] Live stack is up: `docker ps --filter name=novu-` shows healthy containers
- [ ] Sandbox stack is up except bridge: `docker ps --filter name=next- | grep -v next-bridge` shows 8 containers
- [ ] You know the sandbox per-env Secret Key (from the Dashboard → Settings → API Keys → Development environment in the sandbox dashboard at `:8080`). As of 2026-05-01: `54ad9d4dd50398489413be350237bd88`

## The recipe

```bash
ssh -i ~/.ssh/id_novu_vps -p 7576 root@103.138.96.180 'bash -s' <<'REMOTE_EOF'
set -e

# 1. Clone live's full provider env (MSG91, ICPaaS, NODE_ENV)
LIVE_ENV=$(docker inspect novu-bridge --format '{{range .Config.Env}}{{println .}}{{end}}' \
  | grep -E '^(MSG91_|ICPAAS_|NODE_ENV=)')

# 2. Sandbox-specific overrides (different Mongo, different Secret Key)
SANDBOX_NOVU_SECRET_KEY=54ad9d4dd50398489413be350237bd88   # per-env, NOT cluster
SANDBOX_MONGO_URL='mongodb://novu_next_root:913a31becf9ec5b8c550b62b26089a46@mongodb:27017/novu-db?authSource=admin'

# 3. Drop any existing/placeholder container
docker rm -f next-bridge 2>/dev/null || true

# 4. Build env-file
ENV_FILE=$(mktemp)
{
  echo "$LIVE_ENV"
  echo "NOVU_SECRET_KEY=${SANDBOX_NOVU_SECRET_KEY}"
  echo "NOVU_API_URL=http://next-api:3000"
  echo "PORT=4001"
  echo "MONGO_URL=${SANDBOX_MONGO_URL}"
} > "$ENV_FILE"

# 5. Recreate
docker run -d \
  --name next-bridge \
  --network novu-next_default \
  --restart unless-stopped \
  --env-file "$ENV_FILE" \
  novu-ce-bridge:latest

rm -f "$ENV_FILE"

# 6. Verify
sleep 6
docker ps --filter name=next-bridge --format "table {{.Names}}\t{{.Status}}"
docker logs next-bridge 2>&1 | tail -10
REMOTE_EOF
```

## Verification

After recreate, `next-bridge` should:

1. Show `Status: Up` in `docker ps --filter name=next-bridge`
2. Logs end with `Ready in <Nms>`
3. Discovery endpoint responds (test from another container with curl/wget):
   ```bash
   docker exec next-worker sh -c \
     'node -e "fetch(\"http://next-bridge:4001/api/novu\").then(r=>r.text()).then(t=>console.log(t.slice(0,300)))"'
   # Expect: {"status":"ok","sdkVersion":"2.10.0",...,"discovered":{"workflows":N,"steps":M}}
   ```

## Common failures

| Symptom | Cause | Fix |
|---|---|---|
| `next-bridge` exits with `MongoServerError: bad auth` | Sandbox Mongo password rotated | Update `SANDBOX_MONGO_URL` (read fresh from `/opt/novu-next/sandbox/.env` → `MONGO_INITDB_ROOT_PASSWORD=`) |
| Bridge boots but workflow sync fails 401 | Used cluster `NOVU_SECRET_KEY` instead of per-env | Use the per-env Secret Key from Dashboard → Settings → API Keys → Development environment in the sandbox UI |
| Bridge boots but trigger returns "Workflow not found" | Recreate succeeded but sync didn't run | Run `novu-ce-bridge-sync` skill against the sandbox API URL/key |
| Bridge boots, discovery returns workflows, but trigger 400 with `Invalid uuid` or missing field | 3.x strict payload validation | See memory `novu_3x_payload_gotchas.md` |
| `getaddrinfo ENOTFOUND mongodb` | Network mismatch | The Mongo hostname `mongodb` is the alias inside `novu-next_default` network. If you forgot `--network novu-next_default` it won't resolve. |

## Why this is its own skill

Recreating the bridge is distinct from syncing workflows — they're two phases:
1. **This skill** — get the bridge container running with real provider creds
2. **`novu-ce-bridge-sync`** — push workflow definitions from bridge code into the Novu API

You almost always want to run both back-to-back, but they have different failure modes and you might just need to run one (e.g. the bridge is fine, you just added a new workflow file → only step 2).

## Architecture context (for first-time readers)

- **Bridge** is a Next.js app serving `/api/novu` — Novu's worker calls it to discover workflows and execute steps for code-first triggers
- **Live `novu-bridge`** (port 80 stack) holds the canonical provider creds via env vars set in `/opt/novu/novu-ce-vps-stage/.env`
- **Sandbox `next-bridge`** (port 8080 stack) is supposed to mirror those creds so the 3.15 stack can dispatch identically — but its own `.env` started empty (placeholder) during the original 3.15 deployment
- This skill closes that gap by cloning live's env into sandbox bridge

## Related memory

- `sandbox_315_primary.md` — why sandbox is now primary, full pivot context
- `novu_next_sandbox.md` — the original 3.15 deployment recipe
- `dispatch_architecture.md` — how `lib/dispatch.ts` uses the env vars
- `provider_strategy.md` — MSG91/ICPaaS/SES/FCM strategy

## Next step

After this skill succeeds, invoke **`novu-ce-bridge-sync`** with sandbox URLs:
- `--bridge-url http://next-bridge:4001/api/novu`
- `--api-url http://next-api:3000`
- `--secret-key 54ad9d4dd50398489413be350237bd88`
