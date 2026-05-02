---
name: novu-fe-fork-deploy
description: Build the locally-vendored Novu CE 3.15 dashboard fork and deploy it as a custom Docker image to the VPS sandbox. Use when iterating on TPE-specific Template + Workflow management features in the dashboard, or when refreshing the deployed image after fork updates. Replaces the upstream ghcr.io/novuhq/novu/dashboard:3.15.0 image with our customized tpe-novu-dashboard:3.15.0-tpe.
---

# Build + deploy Novu dashboard fork to VPS sandbox

## When to use this

- You modified files in `novu-ce-fork/apps/dashboard/src/` and want to see your changes on the VPS sandbox at http://103.138.96.180:8080
- You refreshed the fork from a new Novu version and want the deployed image updated
- The deployed dashboard container needs replacing for any reason

## Pre-flight

- [ ] You're in the project root: `/Users/aksatyam/SelfWork/TPE_WORK/Projetcs/novu-notification-system/`
- [ ] Workspace deps installed + built: `novu-ce-fork/node_modules/` exists; `novu-ce-fork/libs/internal-sdk/index.js` exists; `novu-ce-fork/packages/shared/dist/` exists
- [ ] If first time: ran `pnpm install --filter "@novu/dashboard..."` AND `pnpm --filter "@novu/dashboard^..." --filter "!@novu/dashboard" build`
- [ ] SSH key exists: `~/.ssh/id_novu_vps`
- [ ] At least 1.5 GB free disk on Mac for production build

## Two phases — Local build, then VPS deploy

### Phase 1 — Build production dashboard bundle locally

```bash
cd novu-ce-fork
pnpm --filter @novu/dashboard build
```

Validates: `apps/dashboard/dist/index.html` exists; `apps/dashboard/dist/assets/index-*.js` exists.

Time: ~45 seconds. Output: ~98 MB in `dist/`.

### Phase 2 — Tar, transfer, build on VPS, deploy

The whole phase as a one-liner:

```bash
cd /Users/aksatyam/SelfWork/TPE_WORK/Projetcs/novu-notification-system/novu-ce-fork

# 1. Tar the build context
tar czf /tmp/dashboard-build-context.tar.gz \
  apps/dashboard/dist \
  apps/dashboard/Dockerfile.tpe \
  apps/dashboard/docker-entrypoint.sh \
  apps/dashboard/package.json

# 2. SCP to VPS
scp -i ~/.ssh/id_novu_vps -P 7576 \
  /tmp/dashboard-build-context.tar.gz \
  root@103.138.96.180:/tmp/

# 3. Build + deploy on VPS
ssh -i ~/.ssh/id_novu_vps -p 7576 root@103.138.96.180 'bash -s' <<'EOF'
set -e
mkdir -p /tmp/dashboard-build && cd /tmp/dashboard-build
rm -rf apps
tar xzf /tmp/dashboard-build-context.tar.gz

# Build native amd64 image on VPS
docker build -f apps/dashboard/Dockerfile.tpe -t tpe-novu-dashboard:3.15.0-tpe .

# Recreate the dashboard container
cd /opt/novu-next/sandbox
docker compose -f sandbox-compose.yml up -d --no-deps dashboard

# Confirm
sleep 5
docker ps --filter name=next-dashboard --format "table {{.Names}}\t{{.Image}}\t{{.Status}}"
curl -fsS -o /dev/null http://localhost:8080/ -w "  HTTP %{http_code} | TTFB %{time_starttransfer}s\n"

# Cleanup
rm -f /tmp/dashboard-build-context.tar.gz
EOF
```

Time: ~3-5 minutes total (tar 5s + SCP 30s-2min + build 30s + deploy 5s + verify 5s).

## Verification checklist

After deploy, run:

```bash
# 1. Container status
ssh -i ~/.ssh/id_novu_vps -p 7576 root@103.138.96.180 \
  'docker ps --filter name=next-dashboard --format "{{.Names}} {{.Image}} {{.Status}}"'
# Expected: next-dashboard tpe-novu-dashboard:3.15.0-tpe Up <N> seconds (healthy)

# 2. HTTP health
curl -fsS -o /dev/null http://103.138.96.180:8080/ -w "HTTP %{http_code}\n"
# Expected: HTTP 200

# 3. Runtime env injection (proves docker-entrypoint.sh ran)
curl -fsS http://103.138.96.180:8080/ | grep -A 5 "window._env_"
# Expected: window._env_ block with VITE_API_HOSTNAME etc.

# 4. End-to-end: dashboard can call API
# Open http://103.138.96.180:8080 in browser → should see Novu dashboard with workflows list
```

## First-time setup (if `novu-ce-fork/node_modules/` doesn't exist)

```bash
cd novu-ce-fork

# Install dashboard + transitive deps (~2.7 GB)
pnpm install --filter "@novu/dashboard..."

# Build all workspace deps that dashboard imports
pnpm --filter "@novu/dashboard^..." --filter "!@novu/dashboard" build

# Verify by running dev server
pnpm --filter @novu/dashboard start
# Open http://localhost:4201 — should see local dashboard
```

## Rollback (if deploy breaks the dashboard)

```bash
ssh -i ~/.ssh/id_novu_vps -p 7576 root@103.138.96.180 'bash -s' <<'EOF'
COMPOSE=/opt/novu-next/sandbox/sandbox-compose.yml

# Restore the most recent backup (sandbox-compose.yml.bak.*)
LATEST_BACKUP=$(ls -t ${COMPOSE}.bak.* | head -1)
cp "$LATEST_BACKUP" "$COMPOSE"

# Recreate dashboard with reverted image
cd /opt/novu-next/sandbox
docker compose -f sandbox-compose.yml up -d --no-deps dashboard
EOF
```

## Common errors + fixes

| Error | Cause | Fix |
|---|---|---|
| `Failed to resolve entry for package "@novu/api"` (during build) | Workspace deps not built | Run the `pnpm --filter "@novu/dashboard^..." --filter "!@novu/dashboard" build` step |
| Container `Restarting (255)` | Architecture mismatch (arm64 image on amd64 VPS) | Build on VPS instead of locally on Mac M-series |
| Docker daemon not responding (Mac) | OrbStack/Docker Desktop not running | `open -a OrbStack` and wait 10s |
| `no such service: next-dashboard` | Used container name in docker compose | Service name is `dashboard`, container name is `next-dashboard`. Use service name. |
| Dashboard shows but workflows empty | Bridge container not running | Run `novu-ce-sandbox-bridge-recreate` skill |
| Browser shows CORS errors | API has CORS misconfigured | Check VITE_API_HOSTNAME in compose env; test with `curl -H Origin: http://localhost:4201 -X OPTIONS` |

## Related skills

- **`novu-ce-sandbox-bridge-recreate`** — recreate Bridge container with provider creds (run if dashboard shows "no workflows")
- **`novu-ce-pivot-rollback`** — bring back TPE Admin custom UI (if Studio doesn't work out)
- **`novu-ce-bridge-sync`** — sync workflow code from Bridge into Mongo (run if you added new Charter workflows)

## Related memory

- `novu_fe_fork_2026_05_02.md` — full architectural decision + fork structure
- `sandbox_315_primary.md` — why sandbox 3.15 is the primary operator surface
- `architecture_code_first_only.md` — the existing rule about workflow authoring (this fork potentially relaxes it for non-Charter workflows)
