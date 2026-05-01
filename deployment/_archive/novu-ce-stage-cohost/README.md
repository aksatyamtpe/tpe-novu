# Novu CE Stack — Full-Feature Docker Deployment

A complete, production-shaped Docker Compose deployment of **Novu Community
Edition** that exercises every capability CE actually ships: all four runtime
services, two Redis instances (queue + cache), MongoDB, S3-compatible
storage, Bridge for code-first workflows, and Caddy for automatic HTTPS.

> **Read this first.** "Novu CE with all features" is a category mistake.
> Novu is open-core: RBAC, SAML/OIDC SSO, organization-level audit logs,
> and advanced analytics live in `apps/web/src/ee`, `apps/dashboard/src/ee`,
> and `/enterprise` under a separate commercial license. They are
> **not in CE**. This stack delivers everything CE actually has, end to end.
> See `docs/FEATURE-CHECKLIST.md` for the full list of what's in vs. out.

---

## What this stack runs

```
┌──────────────────────────────────────────────────────────────────────────┐
│  caddy (TLS, reverse proxy, ports 80/443)                                │
│   ├──/api/* ──► api (3000)                                               │
│   ├──/ws/*  ──► ws  (3002, sticky)                                       │
│   ├──/bridge/* ─► bridge (4001)                                          │
│   └──/      ──► dashboard (4000)                                         │
│                                                                          │
│  worker (no public ports) ──► consumes BullMQ jobs                       │
│                                                                          │
│  Data:                                                                   │
│   • mongodb (7.0)             — workflows, subscribers, messages         │
│   • redis-queue (7.2, AOF on) — BullMQ job durability                    │
│   • redis-cache (7.2, LRU)    — DAL cache + widget feed                  │
│   • localstack (3.8)          — S3 emulator (replace with real S3 in     │
│                                  production)                             │
└──────────────────────────────────────────────────────────────────────────┘
```

---

## Prerequisites

| Tool            | Minimum  | Notes |
|-----------------|----------|-------|
| Docker Engine   | 24.x     | `docker compose` plugin v2 required |
| openssl         | any      | For secret generation |
| curl            | any      | Smoke tests |
| (optional) make | any      | All commands wrapped in the Makefile |
| Host RAM        | 8 GiB    | 16 GiB recommended for comfortable headroom |
| Host disk       | 50 GiB   | Mongo + Redis + Caddy data |
| Hostname        | required for prod | Public DNS pointing at the host for Caddy ACME |

---

## Quick start (local / dev)

```bash
# 1. Clone or unpack this folder
cd novu-ce-stack

# 2. Generate secrets and create .env (idempotent)
make bootstrap

# 3. Start the whole stack
make up

# 4. Wait ~60s for health checks, then visit:
#    http://localhost:4000        (dashboard, before Caddy is configured)
#    OR with Caddy:
#    http://localhost             (dashboard via Caddy on :80)

# 5. Create the first admin account in the dashboard.

# 6. CRITICAL — lock down sign-up:
#    Edit .env: DISABLE_USER_REGISTRATION=true
#    docker compose up -d dashboard

# 7. Copy the API Secret Key from Dashboard → Settings → API Keys.
#    export NOVU_API_KEY=<that key>

# 8. Sync the sample workflows from Bridge into the dashboard:
make sync

# 9. Run end-to-end smoke test:
make smoke

# 10. Walk through the feature checklist:
#     docs/FEATURE-CHECKLIST.md
```

---

## Production deployment

### Single-host (Track B from the Enterprise Setup Guide)

This stack is acceptable as-is for non-production, sandbox, or pilot
environments. **Do not run regulated production workloads on a single host.**
For multi-AZ production architecture, see the Enterprise Setup Guide
(separate document).

### What to change for production-on-a-single-host

1. **Real hostname + Caddy automatic TLS**
   - Edit `caddy/Caddyfile`: replace `novu.your-domain.com` with your real
     hostname.
   - Point DNS at the host's public IP.
   - Open ports 80 and 443 on the security group / firewall.
   - Caddy obtains a Let's Encrypt certificate on first request.

2. **Real S3 (not LocalStack)**
   ```env
   S3_LOCAL_STACK=
   S3_BUCKET_NAME=novu-prd-attachments
   S3_REGION=ap-south-1
   AWS_ACCESS_KEY_ID=AKIA...
   AWS_SECRET_ACCESS_KEY=...
   ```
   Then remove the `localstack` service from `docker-compose.yml` (or leave
   it running — it just won't be used).

3. **External MongoDB and Redis** (recommended)
   - Move MongoDB to a managed service (Atlas M20+ in `ap-south-1`, or
     DocumentDB).
   - Move Redis to ElastiCache (two replication groups: queue + cache).
   - Update `MONGO_URL`, `REDIS_HOST`, `REDIS_CACHE_SERVICE_HOST` in `.env`.
   - Stop and remove the in-stack `mongodb`, `redis-queue`, `redis-cache`
     services from compose.

4. **Backup automation**
   ```cron
   30 2 * * *  cd /opt/novu-ce-stack && ./scripts/backup.sh >> backup.log 2>&1
   ```
   Set `BACKUP_S3_BUCKET=...` in env to upload off-host.

5. **Observability**
   - Forward container logs to CloudWatch / Datadog / ELK using the Docker
     log driver of your choice. The compose uses `json-file` with rotation
     by default.
   - Set `SENTRY_DSN` for application-level error tracking.

6. **Bridge endpoint exposure**
   - In production, Bridge should only be reachable from the Novu API
     container. Either (a) remove the bridge route from Caddy and rely on
     the internal Docker network, or (b) restrict the route with Caddy's
     `@allowed remote_ip` matcher.

---

## Folder structure

```
novu-ce-stack/
├── README.md                    ← you are here
├── Makefile                     ← all common operations
├── docker-compose.yml           ← service definitions
├── .env.example                 ← environment template (copy to .env)
├── caddy/
│   └── Caddyfile                ← reverse proxy + TLS
├── bridge/                      ← code-first workflow application
│   ├── package.json
│   ├── next.config.js
│   ├── tsconfig.json
│   ├── Dockerfile
│   ├── app/api/novu/route.ts    ← Bridge HTTP endpoint
│   └── workflows/
│       ├── welcome-onboarding.ts
│       ├── otp-verification.ts
│       ├── daily-digest.ts
│       ├── policy-update.ts
│       └── index.ts
├── scripts/
│   ├── bootstrap.sh             ← generate secrets, prepare .env
│   ├── smoke-test.sh            ← end-to-end CE feature test
│   ├── backup.sh                ← Mongo dump + Redis snapshot
│   └── upgrade.sh               ← version upgrade with migration prompt
└── docs/
    ├── PROVIDERS.md             ← per-channel integration guide
    └── FEATURE-CHECKLIST.md     ← exercise every CE capability
```

---

## Sample workflows shipped in `bridge/workflows/`

| Workflow                  | Demonstrates                                        |
|---------------------------|-----------------------------------------------------|
| `welcome-onboarding`      | In-app + email + push, payload + control schemas    |
| `otp-verification`        | SMS, email fallback, conditional skip               |
| `daily-activity-digest`   | Digest engine (event batching with digest key)      |
| `policy-update`           | Email + in-app + delay + custom step + Slack escalation |

Together they exercise every step type CE supports: `inApp`, `email`, `sms`,
`push`, `chat`, `digest`, `delay`, `custom`, plus `controlSchema`,
`payloadSchema`, conditional `skip`, and external API calls.

---

## Common Makefile targets

```
make help          show all targets
make bootstrap     generate secrets, prepare .env (idempotent)
make up            start all services
make down          stop services (volumes preserved)
make logs          tail logs from all services
make ps            show service status
make sync          sync Bridge workflows to dev environment
make smoke         run end-to-end feature smoke test
make backup        Mongo dump + Redis snapshot to ./backups/
make upgrade VERSION=2.4.0   upgrade to a new Novu version
make nuke          DESTRUCTIVE — delete all data volumes
```

---

## Troubleshooting

### Dashboard shows "demo workflows" badge

You haven't synced your Bridge workflows yet.
```bash
make sync
```

### Bridge container can't reach the API

In compose, the API is reachable at `http://api:3000`. The Bridge container's
`NOVU_API_URL` is set to that. If you've moved Bridge out of compose, use
`http://host.docker.internal:3000` (and add `extra_hosts:` to the api
service on Linux/Windows).

### Provider credentials decrypt fails after restart

`STORE_ENCRYPTION_KEY` changed. The credentials in MongoDB were encrypted
with the old key. Either restore the old key value, or delete and re-add
all integrations.

### `npx novu sync` fails with auth error

Two common causes:
1. `NOVU_SECRET_KEY` env doesn't match the dashboard API Secret Key. The
   `make sync` target reads from `.env`. The CLI checks against the
   dashboard.
2. The CLI is hitting `api.novu.co` instead of your self-host. Pass
   `--api-url` explicitly (the `make sync` target already does).

### MongoDB primary CPU pegged

Check indexes via `mongosh`:
```js
use novu-db
db.notificationtemplates.getIndexes()
db.subscribers.getIndexes()
db.messages.getIndexes()
```
If these show only `_id_`, run the migration scripts (see
`scripts/upgrade.sh`).

### Caddy can't get TLS cert

- DNS isn't pointing at this host yet (most common).
- Port 80 isn't reachable from the public internet (security group, ISP).
- Hostname is `localhost` or an IP — Let's Encrypt won't issue. Use a real
  domain, or remove the `tls` directive from the Caddyfile for local-only.

---

## Pre-go-live checklist (single-host production)

- [ ] `.env` secrets are project-specific, not the bootstrap defaults
- [ ] `DISABLE_USER_REGISTRATION=true`, dashboard restarted
- [ ] First admin uses corporate email + password manager
- [ ] Caddy successfully obtained a TLS certificate (check `docker compose logs caddy`)
- [ ] Real S3 bucket configured; LocalStack disabled
- [ ] At least one provider integration tested end-to-end per channel
- [ ] Workflows synced from Bridge to both Development and Production environments
- [ ] `./scripts/backup.sh` runs cleanly; restore tested at least once
- [ ] Backup cron job installed
- [ ] Container logs forwarded to a central log system (CloudWatch/ELK/Datadog)
- [ ] Alerts wired for: api 5xx > 1%, queue waiting > 10k, MongoDB CPU > 75%
- [ ] All items in `docs/FEATURE-CHECKLIST.md` (sections 1–20) checked

---

## What this deployment does not solve

It is single-host. It is therefore not multi-AZ. It does not give you HA at
the data tier. It does not pass an IRDAI BCP audit on its own. For
production deployments handling regulated data, use the Enterprise
Reference Architecture from the Enterprise Setup Guide (Track A).

It is open-core CE. RBAC, SSO, audit logs, advanced analytics are not
present. Either license Enterprise Edition or document compensating
controls.

It is your responsibility to keep the Novu version current and run the
migrations that ship with each release.
