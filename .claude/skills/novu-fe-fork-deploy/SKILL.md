---
name: novu-fe-fork-deploy
description: Build the locally-vendored Novu CE 3.15 dashboard fork and deploy it as a custom Docker image to the VPS sandbox. Use when iterating on TPE-specific dashboard features (Q2=E Full CRUD already shipped 2026-05-02), pulling upstream Novu version bumps, or rebuilding after auth / config changes. Replaces the upstream ghcr.io/novuhq/novu/dashboard image with our customized tpe-novu-dashboard:<version>-tpe-<feature> image. Includes the two foot-guns we hit: the better-auth/self-hosted module-side-effect collision (login loop) and the Q2=E origin-coercion flag.
---

# Build + deploy Novu dashboard fork to VPS sandbox

## When to use this

- You modified files in `novu-ce-fork/apps/dashboard/src/` and want to see your changes on the VPS sandbox at http://103.138.96.180:8080
- You pulled an upstream Novu version bump (e.g. 3.15.0 → 3.15.4) and want the deployed image updated
- You're rebuilding after touching auth flow / config flags / origin coercion
- The deployed dashboard container needs replacing for any reason

## Pre-flight

- [ ] You're in the project root: `/Users/aksatyam/SelfWork/TPE_WORK/Projetcs/novu-notification-system/`
- [ ] Workspace deps installed + built: `novu-ce-fork/node_modules/` exists; `novu-ce-fork/packages/shared/dist/` exists
- [ ] If first time: `pnpm install --filter "@novu/dashboard..."` AND `pnpm --filter "@novu/dashboard^..." --filter "!@novu/dashboard" build`
- [ ] SSH key exists: `~/.ssh/id_novu_vps`
- [ ] At least 1.5 GB free disk on Mac for production build
- [ ] Decide an image tag: `tpe-novu-dashboard:<version>-tpe-<feature>` — e.g. `3.15.4-tpe-q2e`. **Never reuse a tag** — the prior build is your rollback target.

## CRITICAL — env vars that MUST be correct before you build

Stored in `novu-ce-fork/apps/dashboard/.env.production` (committed). These are MODE flags, not secrets — safe to commit. Vite reads them at build time via `loadEnv()`. Wrong values cause silent breakage.

```bash
VITE_SELF_HOSTED=true                 # Forces vite alias for self-hosted Clerk shim
VITE_NOVU_ENTERPRISE=false            # Keeps isCommunitySelHosted=true (alias path A)
VITE_EE_AUTH_PROVIDER=                # MUST BE EMPTY — see foot-gun below
VITE_FULL_CRUD_ENABLED=true           # Q2=E flag — current default for TPE
VITE_API_HOSTNAME=http://localhost:3000      # Build-time placeholder; runtime injection
VITE_WEBSOCKET_HOSTNAME=http://localhost:3002
VITE_DASHBOARD_URL=http://localhost:4201
```

### Foot-gun #1 — the better-auth module-side-effect collision (login loop)

If `VITE_EE_AUTH_PROVIDER=better-auth` (build-time OR runtime via container env):
- The dashboard imports `utils/better-auth/index.tsx` indirectly (via pages/settings.tsx, pages/forgot-password.tsx, pages/sso-sign-in.tsx)
- That module has a top-level side effect: `if (EE_AUTH_PROVIDER === 'better-auth') window.Clerk = { session: ... }` — **with no `loggedIn` getter**
- It runs AFTER `utils/self-hosted/index.tsx` writes its OWN `window.Clerk = { session, loggedIn: <getter> }`
- Better-auth's overwrite wins → `window.Clerk.loggedIn === undefined` → `RedirectToSignIn` bounces every authed pageview back to /auth/sign-in
- Login appears to succeed (JWT stored) then loops back

**Fix:** keep `VITE_EE_AUTH_PROVIDER=` empty in BOTH:
1. `apps/dashboard/.env.production` (build-time fallback gets baked into the JS as a literal)
2. `/opt/novu-next/sandbox/sandbox-compose.yml` (runtime override via window._env_)

If only one is empty, the OTHER one's `'better-auth'` value wins because of the `||` chain in `config/index.ts`:
```ts
window._env_?.VITE_EE_AUTH_PROVIDER || import.meta.env.VITE_EE_AUTH_PROVIDER || 'clerk'
```

### Foot-gun #2 — the Q2=E full-CRUD flag

`VITE_FULL_CRUD_ENABLED=true` is what unlocks Delete + Edit + step add/remove on Bridge-synced (origin=external) workflows. When the flag is true, `useFetchWorkflow(s)` coerce `origin: external → novu-cloud` at the fetch chokepoint, and all 20+ downstream gates auto-resolve.

To revert without rebuilding: flip the flag in compose to `'false'` and `docker compose up -d dashboard` — 10-second revert.

**Note:** Q2=E does NOT unlock per-step content editing (in-app body, email subject, etc.) on Bridge steps — that requires `Boolean(step.controls.uiSchema)` which Bridge steps don't ship. Workflow-level Channel Preferences DO work.

## Two phases — Local build, then VPS deploy

### Phase 1 — Build production dashboard bundle locally

```bash
cd /Users/aksatyam/SelfWork/TPE_WORK/Projetcs/novu-notification-system/novu-ce-fork
pnpm --filter @novu/dashboard exec vite build
```

> **Why `pnpm exec vite build` instead of `pnpm build`:** the latter runs tsc first, which fails on cloud-only files like `questionnaire-form.tsx` (the Vite plugin excludes them at bundle time but tsc still type-checks them). Using `vite build` directly skips tsc and uses the same Vite alias machinery the deployed bundle relies on.

Validates: `apps/dashboard/dist/index.html` exists; `apps/dashboard/dist/assets/index-*.js` exists.

Time: 1–5 minutes depending on cache. Output: ~98 MB in `dist/`. Bundle hash changes every build (`index-<hash>.js`).

**Sanity-check the bundle has the correct flags baked in:**
```bash
grep -oE 'VITE_FULL_CRUD_ENABLED:"[^"]*"' apps/dashboard/dist/assets/index-*.js | head -1
# → VITE_FULL_CRUD_ENABLED:"true"

grep -oE 'VITE_EE_AUTH_PROVIDER:"[^"]*"' apps/dashboard/dist/assets/index-*.js | head -1
# → VITE_EE_AUTH_PROVIDER:""
```

### Phase 2 — Sync to VPS, build image natively, swap container

```bash
cd /Users/aksatyam/SelfWork/TPE_WORK/Projetcs/novu-notification-system/novu-ce-fork

# Choose your image tag — never reuse one
TAG=3.15.4-tpe-q2e   # or 3.15.4-tpe-q2e-v2 next time, etc.

# 1. Rsync dist + Dockerfile.tpe + entrypoint to VPS
rsync -az --delete -e "ssh -i ~/.ssh/id_novu_vps -p 7576" \
  apps/dashboard/dist/ \
  root@103.138.96.180:/opt/novu-next/build-fixed/apps/dashboard/dist/

scp -i ~/.ssh/id_novu_vps -P 7576 \
  apps/dashboard/Dockerfile.tpe \
  apps/dashboard/package.json \
  apps/dashboard/docker-entrypoint.sh \
  apps/dashboard/.env.production \
  root@103.138.96.180:/opt/novu-next/build-fixed/apps/dashboard/

# 2. Build natively (amd64) on VPS, then swap the running container
ssh -i ~/.ssh/id_novu_vps -p 7576 root@103.138.96.180 'bash -s' <<EOF
set -e
cd /opt/novu-next/build-fixed
docker build -f apps/dashboard/Dockerfile.tpe -t tpe-novu-dashboard:$TAG .

# Bump compose to the new tag
sed -i.bak "s|image: tpe-novu-dashboard:.*|image: tpe-novu-dashboard:$TAG|" \
  /opt/novu-next/sandbox/sandbox-compose.yml

cd /opt/novu-next/sandbox
docker compose -f sandbox-compose.yml up -d dashboard
sleep 6
docker ps --filter name=next-dashboard --format "table {{.Names}}\t{{.Image}}\t{{.Status}}"
curl -fsS -o /dev/null http://localhost:8080/ -w "  HTTP %{http_code} | TTFB %{time_starttransfer}s\n"
EOF
```

Time: 30s–2 min for rsync, 10–15s for image build, 6s for container restart, ~1 min total.

> **Why rsync over tar+SCP:** rsync transfers only diffs, ~3–5x faster on subsequent deploys when only a handful of files changed. For first-time deploy from scratch, tar+SCP is fine — they're equivalent.

> **Why build on VPS:** Mac M-series produces arm64 images; VPS is amd64. Cross-arch builds via `--platform=linux/amd64` work but rely on QEMU emulation (slow, occasional bugs). Native amd64 build on the VPS is faster and more reliable.

## Verification (always run after deploy)

```bash
# 1. Container status — expect "Up <N> seconds (healthy)"
ssh -i ~/.ssh/id_novu_vps -p 7576 root@103.138.96.180 \
  'docker ps --filter name=next-dashboard --format "{{.Names}} {{.Image}} {{.Status}}"'

# 2. HTTP health
curl -fsS -o /dev/null http://103.138.96.180:8080/ -w "HTTP %{http_code}\n"

# 3. Runtime env injection (proves docker-entrypoint.sh ran with current compose env)
curl -fsS http://103.138.96.180:8080/ | grep -A 8 "window._env_"
# Expect:
#   VITE_API_HOSTNAME: 'http://103.138.96.180:8081',
#   VITE_SELF_HOSTED: 'true',
#   VITE_EE_AUTH_PROVIDER: '',         ← MUST be empty
#   VITE_FULL_CRUD_ENABLED: 'true',    ← if Q2=E should be on

# 4. Bundle hash served
curl -fsS http://103.138.96.180:8080/ | grep -oE 'src="/assets/index-[^"]+\.js"' | head -1

# 5. End-to-end smoke (login)
JWT=$(curl -s -X POST http://103.138.96.180:8081/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"sandbox@tpe-test.local","password":"SandboxStage2026!"}' \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['data']['token'])")
echo "JWT length: ${#JWT}"  # expect ~408
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

Each prior build is its own tagged image — `docker images | grep tpe-novu-dashboard` shows the history. Rollback = swap compose back to a prior tag.

```bash
ssh -i ~/.ssh/id_novu_vps -p 7576 root@103.138.96.180 'bash -s' <<'EOF'
docker images --format "{{.Repository}}:{{.Tag}}\t{{.CreatedAt}}" | grep tpe-novu-dashboard | sort -k2 -r | head -5
# Pick a prior tag, then:
PRIOR_TAG=3.15.4-tpe-prod-fixed   # adjust as needed
sed -i "s|image: tpe-novu-dashboard:.*|image: tpe-novu-dashboard:$PRIOR_TAG|" \
  /opt/novu-next/sandbox/sandbox-compose.yml
cd /opt/novu-next/sandbox && docker compose -f sandbox-compose.yml up -d dashboard
EOF
```

For a backup-file-based rollback (if you also want to revert env var changes):
```bash
LATEST_BACKUP=$(ssh -i ~/.ssh/id_novu_vps -p 7576 root@103.138.96.180 \
  'ls -t /opt/novu-next/sandbox/sandbox-compose.yml.bak* | head -1')
ssh -i ~/.ssh/id_novu_vps -p 7576 root@103.138.96.180 \
  "cp $LATEST_BACKUP /opt/novu-next/sandbox/sandbox-compose.yml && \
   cd /opt/novu-next/sandbox && docker compose -f sandbox-compose.yml up -d dashboard"
```

## Q2=E flag — runtime toggle without rebuild

```bash
# Turn OFF (revert to upstream read-only behavior on Bridge workflows)
ssh -i ~/.ssh/id_novu_vps -p 7576 root@103.138.96.180 \
  "sed -i \"s|VITE_FULL_CRUD_ENABLED: 'true'|VITE_FULL_CRUD_ENABLED: 'false'|\" /opt/novu-next/sandbox/sandbox-compose.yml && \
   cd /opt/novu-next/sandbox && docker compose -f sandbox-compose.yml up -d dashboard"

# Turn ON
ssh -i ~/.ssh/id_novu_vps -p 7576 root@103.138.96.180 \
  "sed -i \"s|VITE_FULL_CRUD_ENABLED: 'false'|VITE_FULL_CRUD_ENABLED: 'true'|\" /opt/novu-next/sandbox/sandbox-compose.yml && \
   cd /opt/novu-next/sandbox && docker compose -f sandbox-compose.yml up -d dashboard"
```

The flag is read by every page load via `window._env_.VITE_FULL_CRUD_ENABLED`. No bundle rebuild needed because the bundle has both branches; the runtime check decides at module-load time.

## Common errors + fixes

| Error | Cause | Fix |
|---|---|---|
| Login loops back to `/auth/sign-in` after submit | `VITE_EE_AUTH_PROVIDER=better-auth` is set somewhere → better-auth module overwrites `window.Clerk` and removes the `loggedIn` getter | Set to empty in BOTH `.env.production` and compose runtime env. Rebuild + redeploy. |
| `Failed to resolve entry for package "@novu/api"` (during build) | Workspace deps not built | Run `pnpm --filter "@novu/dashboard^..." --filter "!@novu/dashboard" build` |
| `error TS2305: Module ... has no exported member` (e.g. questionnaire-form) | Stale `dist/` in workspace dep that's been overlaid from upstream prod branch | Rebuild affected workspace deps: `pnpm --filter "@novu/dashboard^..." --filter "!@novu/dashboard" build` |
| Container `Restarting (255)` after deploy | Architecture mismatch (arm64 image on amd64 VPS) | Build on VPS instead of locally on Mac M-series |
| Docker daemon not responding (Mac) | OrbStack/Docker Desktop not running | `open -a OrbStack` and wait 10s; OR build directly on VPS |
| `no such service: next-dashboard` | Used container name in `docker compose up` | Service name is `dashboard`, container name is `next-dashboard`. Use service name. |
| Dashboard renders but workflows list is empty | Bridge container not running | Run `novu-ce-sandbox-bridge-recreate` skill |
| Browser shows CORS errors | API has CORS misconfigured | Check `VITE_API_HOSTNAME` in compose env; test with `curl -H "Origin: http://localhost:4201" -X OPTIONS http://103.138.96.180:8081/v1/...` |
| Q2=E "Delete workflow" still disabled in UI after deploy | Browser cached old bundle | Hard reload (Cmd+Shift+R) or use Incognito; verify `<script src="/assets/index-<hash>.js">` matches latest deployed hash |
| `Cannot GET /v2/ai/workflow-suggestions` toast | AI features not in self-hosted CE | Harmless — ignore. Toast goes away on dashboard restart. |

## Per-step content editor still shows "No editor available"

This is **expected behavior** for Bridge-synced steps even with Q2=E on. The check is:

```ts
// step-editor-context.tsx:70
const isNovuCloud = workflow.origin === ResourceOriginEnum.NOVU_CLOUD && Boolean(uiSchema);
```

Coercion handles the origin half. The `Boolean(uiSchema)` half stays false because Bridge steps declare their controls in TypeScript code, not as a JSON-schema/uiSchema pair. To unlock per-step content editing too, see the Q2=E v2 candidates in the `q2e_full_crud_2026_05_02.md` memory.

## Related skills

- **`novu-ce-sandbox-bridge-recreate`** — recreate Bridge container with provider creds (run if dashboard shows "no workflows")
- **`novu-ce-pivot-rollback`** — bring back TPE Admin custom UI (full architectural rollback)
- **`novu-ce-bridge-sync`** — sync workflow code from Bridge into Mongo (run after adding new Charter workflows)

## Related memory

- **`novu_fe_fork_2026_05_02.md`** — initial fork architecture + first 3.15.0 deploy
- **`q2e_full_crud_2026_05_02.md`** — login-loop fix + Q2=E implementation + E2E browser test results
- `sandbox_315_primary.md` — why sandbox 3.15 is the primary operator surface
- `architecture_code_first_only.md` — original code-first rule (Q2=E formally relaxes it for non-Charter workflows when the flag is on)
