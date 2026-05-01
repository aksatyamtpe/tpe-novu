---
name: novu-ce-troubleshoot
description: Diagnose and fix the most common Novu CE on-EC2 failures — Caddy can't get TLS, Bridge can't reach API, STORE_ENCRYPTION_KEY mismatch, queue backlog, Mongo CPU pegged, DLT template rejected. Use when the user says "caddy can't get cert", "bridge unhealthy", "queue backlog", "mongo CPU high", "dispatch failing", or describes a Novu incident.
---

# Novu CE on EC2 — incident response & known failures

This skill condenses §29 (Common failure modes) and §31 (Operator runbook) of the deployment guide. Use it as the on-call first reach.

## Severity grid (Charter §10.2 / deployment guide §31.1)

| Sev | Definition | Response | Fix |
|---|---|---|---|
| Sev-1 | Regulator-blocking, prod outage of 1+ of the 49 triggers, mass dispatch failure | 1 hour | 4 hours, business hours |
| Sev-2 | Single workflow failing, single channel down, queue backlog growing | 4 hours | Same day |
| Sev-3 | Cosmetic / non-customer-impacting | Next business day | Within sprint |

Classify before acting. Then run the matching playbook below.

---

## Symptom 1 — Caddy can't get a TLS certificate (§29.1.1)

**Logs:** `caddy` container shows `acme: error: 403 :: urn:ietf:params:acme:error:unauthorized` or `tls: failed to obtain certificate`.

**Root causes (most common first):**
1. **DNS not pointing at this host yet** — Let's Encrypt's HTTP-01 challenge calls back to your hostname; if it doesn't resolve to the host, ACME fails.
2. **Port 80 not reachable from the public internet** — security group / NACL / corporate firewall blocks `0.0.0.0/0:80`.
3. **Hostname is `localhost` or an IP** — Let's Encrypt won't issue. Use a real domain.
4. **Rate limit hit** — too many failed attempts in the last hour (Let's Encrypt: 5 failures/hour/account).

**Fix:**
```bash
# Confirm DNS:
dig +short novu-pilot.internal.example.com
# → must equal the EC2 public IP

# Confirm port 80 reachable from outside (run from your laptop, not the host):
curl -I -m 5 http://novu-pilot.internal.example.com/
# → expect a 308 redirect to https from Caddy

# If hit by rate limit, switch Caddy to staging ACME until you've fixed the cause:
# In caddy/Caddyfile add: `acme_ca https://acme-staging-v02.api.letsencrypt.org/directory`
docker compose restart caddy
```

For local-only / no-public-DNS pilots, replace the hostname block with `:80 { ... }` and remove the `tls` directive — but flag in the Charter notes that this isn't TLS-secured.

---

## Symptom 2 — Bridge container can't reach the API (§29.1.2)

**Logs:** `bridge` shows `ECONNREFUSED` against `http://api:3000` or `http://host.docker.internal:3000`.

**Root cause:** Docker network mismatch. In the bundled compose, `api` and `bridge` share the `novu` network — `bridge` reaches `api` at `http://api:3000`. If you've moved Bridge out of compose (running it on the host directly, or in a separate compose project), the resolution breaks.

**Fix:**
- If Bridge is in the same compose: confirm both services list `networks: [novu]` and the Bridge env has `NOVU_API_URL=http://api:3000`.
- If Bridge runs on the host: `NOVU_API_URL=http://host.docker.internal:3000` plus `extra_hosts: ["host.docker.internal:host-gateway"]` on the api service (Linux/Windows; Mac handles natively).
- If Bridge runs in a separate compose project: connect both projects to a shared external network.

---

## Symptom 3 — Provider credentials decrypt fails after restart (§29.1.3)

**Logs:** Activity Feed shows `Failed: failed to decrypt credentials` for every dispatch.

**Root cause:** `STORE_ENCRYPTION_KEY` changed since the credentials were saved. MongoDB still holds AES-encrypted credentials with the old key.

**Fix paths:**
1. **Restore the old key value** in `.env` and restart api/worker. (Possible if you have the old key — check Secrets Manager, password manager, prior backup's `env.sanitized` won't have it because the script strips it.)
2. **Re-add all integrations** — see `novu-ce-secret-rotation` §30.3. Pragmatic if old key is unrecoverable.
3. **In-place migration** — custom Mongo script that decrypts with old key + encrypts with new. Engineering Lead sign-off only.

**Prevention:** treat `STORE_ENCRYPTION_KEY` as a permanent project secret. Store in AWS Secrets Manager from day 1, never edit `.env` by hand for this var.

---

## Symptom 4 — `npx novu sync` fails with auth error (README troubleshooting)

Two common causes:
1. `NOVU_SECRET_KEY` env var doesn't match the dashboard API Secret Key for the target environment. `make sync` reads from `.env`; the CLI checks against the dashboard.
2. CLI is hitting `api.novu.co` (the cloud) instead of your self-host. Always pass `--api-url` explicitly. `make sync` does this; ad-hoc `npx novu sync` invocations may forget.

**Fix:**
```bash
# Verify which environment your key corresponds to:
curl -fsS https://<host>/api/v1/environments/me \
  -H "Authorization: ApiKey $NOVU_SECRET_KEY" | jq .name
# → "Development" or "Production"

# Re-sync with explicit api-url:
cd /opt/novu/novu-ce-stack/bridge
npx novu sync \
  --bridge-url http://localhost:4001/api/novu \
  --api-url    http://localhost:3000 \
  --secret-key "$NOVU_SECRET_KEY"
```

---

## Symptom 5 — DLT template rejected mid-day (§29.1.4)

**Logs:** MSG91 dashboard shows "DLT template not registered" rejection. Activity Feed shows `Failed`. Operations gets paged via OPS-04 / OPS-05 escalation.

**Root cause options:**
1. Template was rejected by the DLT operator (TRAI / VIL / Jio / etc.) — happens on content reviews, especially for promotional category.
2. Template content drifted from the registered version (variable formatting `{#var#}` mismatch, header changed, etc.).
3. Sender ID was de-registered or moved.

**Immediate response (Sev-2, dispatch failing):**
```bash
# 1. Failover to the next provider in the chain (Gupshup → MSG91 → Karix).
#    In Novu Dashboard → Integrations, set Gupshup-MSG91-Karix priority order;
#    Operations can flip "Primary" without code changes.
# 2. Notify Operations Lead immediately (this is a customer-impacting incident).
# 3. Open a ticket with the DLT operator to learn rejection reason.
```

**Recovery:**
- Re-register the template under the correct DLT category.
- Update the template ID in the workflow payload mapping.
- Test with a single SMS before re-enabling the original provider as primary.

**Prevention:** the daily reconciliation report (PROVIDERS.md best practice 3) catches this within 24h. <95% delivery over 24h = P2.

---

## Symptom 6 — MongoDB primary CPU pegged (README + §29)

**Symptoms:** api 5xx rate climbs, worker queue depth climbs, dashboard slow.

**Diagnose:**
```bash
docker compose exec mongodb mongosh --quiet --eval "db.currentOp({\"active\":true})" \
  | jq '.inprog[] | {ns, op, secs_running, planSummary}'
```

Look for `COLLSCAN` planSummary — that's a missing index.

**Common cause after an upgrade:** new collections / indexes that the migration was supposed to create but didn't run. Per upgrade guide:

```bash
docker compose exec mongodb mongosh --quiet --eval "
  use novu-db;
  db.notificationtemplates.getIndexes();
  db.subscribers.getIndexes();
  db.messages.getIndexes();"
```

If only `_id_` indexes exist on those collections, run the migration scripts (see `novu-ce-upgrade`).

---

## Symptom 7 — BullMQ queue backlog growing

**Symptoms:** `redis-queue` Memory used climbing; api triggers return 200 but Activity Feed shows long delays before dispatch.

**Diagnose:**
```bash
docker compose exec redis-queue redis-cli -a "$REDIS_PASSWORD" --no-auth-warning \
  --eval - 0 <<<'return redis.call("KEYS", "bull:*:wait")' \
  | head -20

docker compose logs --tail=200 worker | grep -E "ERROR|FATAL"
```

**Common causes:**
1. Worker container OOM-killed (check `docker compose ps`; `Exited (137)` = OOM).
2. A provider is timing out on every call → worker waits.
3. Worker stop-grace not honoured — jobs stuck in "active" state.

**Fix:**
- Restart worker: `docker compose up -d --no-deps worker`. The `stop_grace_period: 60s` handles drain.
- If OOM-killed: increase the host's RAM (t3.xlarge → t3.2xlarge), or add `mem_limit` to compose to fail fast.
- If a provider is the culprit: failover (see Symptom 5).

---

## Symptom 8 — Dashboard shows "demo workflows" badge

Bridge workflows haven't been synced. Run `make sync` (see `novu-ce-bridge-sync`).

---

## Quick triage checklist (when paged at 3 AM)

```bash
cd /opt/novu/novu-ce-stack
make ps                              # all healthy?
make logs --tail=100                 # any obvious errors?
curl -fsS https://<host>/api/v1/health-check
docker compose exec mongodb mongosh --quiet --eval "db.adminCommand('ping').ok"
docker compose exec redis-queue redis-cli -a "$REDIS_PASSWORD" --no-auth-warning ping
```

If all four return green and the user reports issues, the problem is **outside** the stack (DNS, ALB, security group, provider, network).

## How to apply
- Always classify by severity *before* picking the fix — avoids spending Sev-1 effort on Sev-3 issues.
- Always read **logs first**, hypothesise second. Novu container logs are remarkably informative.
- For any Sev-1 / Sev-2 customer-impacting fix, post a brief incident note in the team Slack + open the post-incident review template (deployment guide §31.3).
