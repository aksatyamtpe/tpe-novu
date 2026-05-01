---
name: novu-ce-deploy
description: Deploy the Novu CE stack to a bootstrapped EC2 host — extract the bundle, generate secrets via bootstrap.sh, edit .env + Caddyfile for the real hostname, and bring up the 11-service stack with `make up`. Use when the user says "deploy novu CE", "bring up the novu stack", "make up", "first deploy", or "extract the bundle on the host".
---

# Deploy the Novu CE stack on the EC2 host

This is **step 3 of 6** in Track B. The instance must already be bootstrapped (Docker, compose, /opt/novu).

## Pre-flight
- [ ] EC2 host bootstrapped (`docker compose version` works as `ec2-user`).
- [ ] Public DNS record for the pilot hostname (e.g. `novu-pilot.internal.example.com`) points at the host's public IP, OR the ALB in front of it.
- [ ] Ports 80 + 443 reachable from the public internet (Let's Encrypt HTTP-01 challenge).
- [ ] `novu-ce-stack.tar.gz` is uploadable to the host (via S3 + `aws s3 cp`, SSM file push, or scp through bastion).

## Step A — Get the bundle onto the host

Recommended path: stage the tarball in your team's S3 bucket and pull from the EC2 instance:
```bash
# from your laptop
aws s3 cp \
  /Users/aksatyam/SelfWork/TPE_WORK/Projetcs/novu-notification-system/deployment/novu-ce-stack.tar.gz \
  s3://your-novu-artifacts/pilot/novu-ce-stack.tar.gz

# on the EC2 host
cd /opt/novu
aws s3 cp s3://your-novu-artifacts/pilot/novu-ce-stack.tar.gz .
tar -xzf novu-ce-stack.tar.gz
cd novu-ce-stack
```

Verify file inventory: README, Makefile, docker-compose.yml, .env.example, caddy/, bridge/, scripts/, docs/.

## Step B — Generate secrets

```bash
make bootstrap
```

This idempotently:
1. Copies `.env.example` → `.env` if it doesn't exist.
2. Generates `JWT_SECRET` (64 hex), `STORE_ENCRYPTION_KEY` (**exactly 32 chars**), `NOVU_SECRET_KEY` (64 hex), Mongo password, Redis-queue password, Redis-cache password.
3. Reconstructs `MONGO_URL` to use the generated password.
4. `chmod 600 .env`.
5. Validates `STORE_ENCRYPTION_KEY` length and aborts if not 32.

> **Critical:** The first successful run is the only chance to set `STORE_ENCRYPTION_KEY` cleanly. Once the API has saved encrypted provider credentials in MongoDB, this key cannot be rotated without a re-encryption procedure (see `novu-ce-secret-rotation` skill, §30.3 of the deployment guide).

## Step C — Edit .env for the real hostname

```bash
sed -i \
  -e 's|^HOST_NAME=.*|HOST_NAME=https://novu-pilot.internal.example.com|' \
  -e 's|^API_ROOT_URL=.*|API_ROOT_URL=https://novu-pilot.internal.example.com/api|' \
  -e 's|^FRONT_BASE_URL=.*|FRONT_BASE_URL=https://novu-pilot.internal.example.com|' \
  -e 's|^WS_PUBLIC_URL=.*|WS_PUBLIC_URL=wss://novu-pilot.internal.example.com/ws|' \
  -e 's|^BRIDGE_PUBLIC_URL=.*|BRIDGE_PUBLIC_URL=https://novu-pilot.internal.example.com/bridge|' \
  .env
```

Leave `DISABLE_USER_REGISTRATION=false` for the very first sign-in. **Flip it to `true` immediately after creating the first admin** (Step F below).

## Step D — Edit caddy/Caddyfile

Replace `novu.your-domain.com` with the real hostname and `admin@your-domain.com` with the ACME contact email:

```bash
sed -i \
  -e 's|novu\.your-domain\.com|novu-pilot.internal.example.com|g' \
  -e 's|admin@your-domain\.com|platform-engineering@example.com|g' \
  caddy/Caddyfile
```

If running purely internal (no public Let's Encrypt), replace the hostname block with `:80 { ... }` and remove the `tls` directive — the deployment guide marks this as pilot-only.

## Step E — Bring the stack up

```bash
make up
```

Compose builds the Bridge image and pulls all other images. First boot takes ~60–90 seconds for health checks to settle. Watch with:

```bash
make ps
make logs        # all services
make logs-api    # api alone
```

Look for `running (healthy)` on every service. Caddy log will show ACME enrolment for the hostname.

## Step F — First sign-in & lockdown

```bash
# Browse to https://<hostname>/
# 1. Create the first admin (corporate email + password manager).
# 2. Settings → API Keys → copy the API Secret Key.
# 3. Lock down sign-up:
sed -i 's|^DISABLE_USER_REGISTRATION=.*|DISABLE_USER_REGISTRATION=true|' .env
docker compose up -d dashboard
# 4. Confirm /sign-up no longer creates accounts.
```

> Skipping step 3 is the **#1 self-host security mistake** observed in the wild — note in the bundle README. Do not move on without it.

## Verify ready for the next step

```bash
curl -fsS https://novu-pilot.internal.example.com/api/v1/health-check
# → {"status":"ok"}
curl -fsS https://novu-pilot.internal.example.com/bridge/api/novu | jq .
# → discovery payload listing the 4 sample workflows
```

## Common failures

| Symptom | Cause | Fix |
|---|---|---|
| `make bootstrap` aborts with `STORE_ENCRYPTION_KEY must be exactly 32 chars` | Manually edited `.env` and entered a non-32-char value | Delete that line; re-run `make bootstrap` to regenerate |
| Caddy logs `acme: error: 403 :: urn:ietf:params:acme:error:unauthorized` | DNS not pointing at this host yet, or port 80 blocked | Wait for DNS, confirm SG / NACL allow 80 from `0.0.0.0/0` |
| Dashboard loads but trips on `Bridge URL not reachable` | `BRIDGE_PUBLIC_URL` wrong in `.env` | Fix to `https://<hostname>/bridge` and `docker compose up -d dashboard` |
| `mongodb` keeps restarting | Existing volume from a previous attempt with a different password | Either restore the prior `MONGO_INITDB_ROOT_PASSWORD` or `make nuke` and start fresh (DESTRUCTIVE) |
| `bridge` build fails on `npm ci` | `package-lock.json` not committed in your bundle copy | The bundle ships only `package.json` — `npm install` runs as a fallback; ensure outbound 443 is open |

## Next step

Invoke **`novu-ce-providers-config`** to wire SES, MSG91/Gupshup, FCM and Slack in the dashboard, then **`novu-ce-bridge-sync`** to push the four sample workflows.
