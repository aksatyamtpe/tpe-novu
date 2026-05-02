# Production Cutover Plan — Sandbox 3.15.4 → Live

**Document:** TPE-CUTOVER-2026-001
**Owner:** Ashish Kumar Satyam · TPE Engineering · Fairvalue Insuretech
**Status:** DRAFT — pending stakeholder review
**Date drafted:** 2026-05-02
**Target cutover window:** TBD — recommend after Niharika UAT sign-off
**Prerequisite reading:** `memory/sandbox_315_primary.md`, `memory/q2e_full_crud_2026_05_02.md`, `memory/workflow_wipe_2026-05-01.md`

---

## 1. Why this cutover, why now

| Status quo (2026-05-02) | What's wrong with it |
|---|---|
| Live Novu CE 2.3.0 at port `:80` of VPS 103.138.96.180 — workflows MongoDB collection wiped on 2026-05-01 (per `workflow_wipe_2026-05-01.md`); novu-bridge container stopped to prevent re-sync | Live is non-functional for operators. Anyone who hits port 80 sees an empty workflows list. |
| Sandbox Novu CE 3.15.4 at port `:8080` — fully working, 18 charter workflows synced, MSG91 + ICPaaS verified end-to-end, Q2=E Full CRUD live, login-loop fixed, browser-tested | This is where work actually happens. But it's labeled "sandbox" in DNS / docs / operator mental model. |

**Two viable paths forward:**

- **Path A — Promote sandbox in place.** Rename ports, swap port 80 binding, retire 2.3.0. Sandbox becomes live.
- **Path B — Migrate sandbox state into live.** Mongo dump from sandbox, restore into live's database, swap dashboard image on live, decommission sandbox stack.

This document recommends **Path A** because:
1. The 3.15.4 stack on sandbox is the latest tested known-good image
2. Port 80 → 8080 swap is simpler than database-cross-host migration
3. Less risk of DB schema drift (sandbox is 3.15.4 schema, live was 2.3.0 schema — restoring 3.15.4 dump into live would require migration runs anyway)
4. Reversible — keep the 2.3.0 stack stopped-but-present for rollback

## 2. Decision matrix — what stakeholders need to agree

| Question | Recommendation | Sign-off needed |
|---|---|---|
| Path A or Path B? | A | CTO + Eng Lead |
| Acceptable downtime window? | 30 minutes within a maintenance window | Operations Lead |
| Cutover time? | Recommend Sat 2026-05-04 22:00–22:30 IST (lowest INV-08 traffic) | Operations + CX Leads |
| Rollback gate? | Auto-rollback if smoke test fails 3 consecutive times | Eng Lead |
| Q2=E flag — keep on for production? | YES (matches sandbox state) | Project Owner |
| DNS / public URL strategy? | Port 80 binds to sandbox stack; no DNS changes | Infra Lead |

## 3. Pre-flight checklist (T-24 hours before cutover)

| # | Item | Owner | Verified by |
|---|---|---|---|
| 1 | Sandbox passing UAT with Niharika sign-off | Engineering | Email confirmation |
| 2 | Mongo backup taken from BOTH live + sandbox (full dump including config) | Operations | `ls -la /opt/novu-backups/` shows files dated within 24h |
| 3 | Live 2.3.0 compose file backed up to `sandbox-compose-live-2.3.0.yml.bak.<date>` | Engineering | File exists on VPS |
| 4 | sandbox-compose.yml frozen — no in-flight commits | Engineering | `git log` clean |
| 5 | All 18 charter workflows triggering successfully on sandbox | Bridge owner | `make smoke` passes |
| 6 | Roll-forward plan signed off | CTO + Eng Lead | Doc reviewed |
| 7 | Rollback plan (§6) signed off | CTO + Eng Lead | Doc reviewed |
| 8 | All on-call ack'd for the cutover window | Operations | PagerDuty schedule confirmed |
| 9 | Slack #tpe-comms-cutover channel created with stakeholders | Engineering | Channel exists |
| 10 | Bridge code in main branch matches what's running on sandbox | Engineering | Diff is empty |

## 4. Cutover steps (T-0 → T+30)

### Phase 1 — Pre-cutover snapshot (T-0 → T+5)

```bash
# 1. SSH to VPS as root
ssh -i ~/.ssh/id_novu_vps -p 7576 root@103.138.96.180

# 2. Snapshot Mongo state from sandbox
mkdir -p /opt/novu-backups/cutover-$(date +%Y%m%d-%H%M)
docker exec next-mongodb mongodump \
  --archive=/tmp/sandbox-pre-cutover.archive --gzip
docker cp next-mongodb:/tmp/sandbox-pre-cutover.archive \
  /opt/novu-backups/cutover-$(date +%Y%m%d-%H%M)/

# 3. Snapshot Mongo state from live (also)
docker exec novu-mongodb mongodump \
  --archive=/tmp/live-pre-cutover.archive --gzip
docker cp novu-mongodb:/tmp/live-pre-cutover.archive \
  /opt/novu-backups/cutover-$(date +%Y%m%d-%H%M)/

# 4. Capture compose YAMLs as they are NOW
cp /opt/novu-next/sandbox/sandbox-compose.yml \
   /opt/novu-backups/cutover-$(date +%Y%m%d-%H%M)/sandbox-compose-pre-cutover.yml
cp /opt/novu/docker-compose.yml \
   /opt/novu-backups/cutover-$(date +%Y%m%d-%H%M)/live-compose-pre-cutover.yml
```

### Phase 2 — Stop live 2.3.0 stack (T+5 → T+10)

```bash
# 1. Verify live containers BEFORE stop
docker ps --filter name=novu- --format "{{.Names}} {{.Status}}"

# 2. Graceful stop of live stack (2.3.0)
cd /opt/novu
docker compose -f docker-compose.yml stop

# 3. Confirm all stopped
docker ps --filter name=novu- --format "{{.Names}} {{.Status}}"
# Expected: all in "Exited" status
```

### Phase 3 — Rebind sandbox to port 80 (T+10 → T+15)

This is the only "swap" — change sandbox dashboard's port mapping from 8080 to 80.

```bash
cd /opt/novu-next/sandbox

# 1. Backup CURRENT sandbox compose
cp sandbox-compose.yml sandbox-compose.yml.bak.pre-cutover-$(date +%Y%m%d-%H%M)

# 2. Edit dashboard port mapping
#    Find: "8080:4000"
#    Change to: "80:4000"
sed -i.bak 's|"8080:4000"|"80:4000"|' sandbox-compose.yml

# 3. Same change for the API + WS (8081 → 3000, 8083 → 3002 → keep ports for app integrations)
#    Actually KEEP api/ws on 8081/8083 — only the dashboard moves.
#    Confirm only dashboard line changed:
grep -n ":4000\\|:3000\\|:3002" sandbox-compose.yml

# 4. Recreate just the dashboard container with new port
docker compose -f sandbox-compose.yml up -d --no-deps dashboard

# 5. Verify
docker ps --filter name=next-dashboard --format "{{.Names}} {{.Ports}}"
# Expected: ports show 0.0.0.0:80->4000/tcp
```

### Phase 4 — Smoke test on port 80 (T+15 → T+25)

```bash
# 1. Health
curl -fsS -o /dev/null http://localhost:80/ -w "HTTP %{http_code}\n"
# Expected: HTTP 200

# 2. Login flow
JWT=$(curl -s -X POST http://localhost:8081/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"sandbox@tpe-test.local","password":"SandboxStage2026!"}' \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['data']['token'])")
[ -z "$JWT" ] && echo "❌ LOGIN FAILED — START ROLLBACK" || echo "✓ Login OK"

# 3. Workflow list
DEV_ENV_ID=$(curl -s http://localhost:8081/v1/environments \
  -H "Authorization: Bearer $JWT" \
  | python3 -c "import sys,json; d=json.load(sys.stdin); print(next(e['_id'] for e in d['data'] if e['name']=='Development'))")
curl -s "http://localhost:8081/v2/workflows?limit=50" \
  -H "Authorization: Bearer $JWT" \
  -H "Novu-Environment-Id: $DEV_ENV_ID" \
  | python3 -c "import sys,json; print('totalCount:', json.load(sys.stdin)['data']['totalCount'])"
# Expected: totalCount: 19

# 4. Trigger INV-08 (highest-volume charter workflow) end-to-end
#    — the same smoke command we use in novu-ce-smoke-test skill
make -C /opt/novu-next/sandbox smoke

# 5. Browser smoke (Niharika or rep) — sign in, see workflow list, edit one
```

If any of 1-4 fail → IMMEDIATE rollback (Phase 6).

### Phase 5 — Decommission live 2.3.0 (T+25 → T+30)

```bash
# 1. Tag the 2.3.0 compose file as retired
mv /opt/novu/docker-compose.yml /opt/novu/docker-compose.yml.retired-$(date +%Y%m%d)

# 2. Update the systemd unit (if any) so 2.3.0 doesn't restart on reboot
systemctl disable novu-2.3.0 2>/dev/null || true

# 3. KEEP the volumes + Mongo data — DO NOT delete; needed for rollback
docker ps -a --filter name=novu- --format "{{.Names}}"
# Containers persist; they're stopped but recoverable
```

## 5. Post-cutover (T+30 → T+24h)

| Check | Frequency | Owner |
|---|---|---|
| HTTP 200 on port 80 | every 5 min for first 2h | Operations |
| `/v2/workflows` returns >= 19 | every 15 min for first 2h | Operations |
| INV-08 firing rate matches pre-cutover baseline (within ±10%) | every hour for 24h | Bridge owner |
| Mongo CPU < 60% sustained | every 30 min | Operations |
| Redis memory < 70% | every 30 min | Operations |
| No new entries in error tracking | every 4 hours | Engineering |
| Niharika / operator team sign-off | once at T+1h | CX Lead |

## 6. Rollback procedure

Triggered if:
- Smoke test fails (Phase 4)
- HTTP 500 sustained > 5 minutes
- Login fails for any operator
- Workflow trigger rate drops > 50%

```bash
ssh -i ~/.ssh/id_novu_vps -p 7576 root@103.138.96.180 'bash -s' <<'EOF'
set -e
TS=$(date +%Y%m%d-%H%M)
echo "[$TS] ROLLBACK initiated"

# 1. Restore sandbox compose port from 80 back to 8080
cd /opt/novu-next/sandbox
cp sandbox-compose.yml.bak.pre-cutover-* sandbox-compose.yml
docker compose -f sandbox-compose.yml up -d --no-deps dashboard

# 2. Restart live 2.3.0 stack
mv /opt/novu/docker-compose.yml.retired-* /opt/novu/docker-compose.yml 2>/dev/null
cd /opt/novu
docker compose -f docker-compose.yml up -d

# 3. Verify
sleep 10
echo "Sandbox dashboard (back on 8080):"
curl -fsS -o /dev/null http://localhost:8080/ -w "  HTTP %{http_code}\n"
echo "Live 2.3.0 dashboard (back on 80):"
curl -fsS -o /dev/null http://localhost:80/ -w "  HTTP %{http_code}\n"

echo "[$TS] ROLLBACK complete — investigate failure root cause before retry"
EOF
```

Time to rollback: ~2 minutes.

## 7. Communication plan

**Who knows what + when:**

| When | Audience | What | Channel |
|---|---|---|---|
| T-7d | Internal eng + ops + CX team | "Cutover scheduled for <date>" with link to this doc | Slack #tpe-comms |
| T-24h | Same | Reminder + final pre-flight checklist status | Slack |
| T-1h | Niharika (UAT signer) | Final ack — UAT still passes | DM |
| T-0 | All | "Cutover starting now" | Slack #tpe-comms-cutover |
| T+30 | All | "Cutover successful" or "Rolling back" | Slack |
| T+24h | All | 24-hour stability report | Slack |
| T+1w | CTO + Project Owner | Post-mortem doc (lessons learned) | Email |

## 8. Risk register

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Port-80 conflict with another service on VPS | Low | High | `lsof -i :80` check in pre-flight; verify no Caddy/nginx listening |
| Mongo schema mismatch surfaces only on first PATCH | Low | Medium | Smoke test includes a PATCH workflow op |
| Q2=E flag accidentally off after recreate | Low | Medium | Compose env grep verification in smoke test |
| Caddy/reverse-proxy still pointing at retired live container | Medium | High | Verify Caddy config in pre-flight; update if needed |
| Dispatch.ts using stale Mongo connection string | Low | High | Bridge healthcheck verifies Mongo write before declaring healthy |
| Niharika unavailable for go-live UAT | Medium | Low | Have a backup operator sign-off path |
| MSG91 / ICPaaS rate limits hit during smoke surge | Low | Low | Smoke test uses a dedicated test phone number |

## 9. Out of scope for this cutover

- DNS / public URL changes (kept simple)
- TLS certificate refresh (sandbox uses HTTP only — separate hardening pass)
- Adding new charter workflows (current 18 + Welcome stay as-is)
- Provider config changes (MSG91/ICPaaS/SES envs are unchanged)
- Touching the live 2.3.0 Mongo data (preserved for rollback)

## 10. Open questions for stakeholders

1. **Q2=E flag default for production:** stay on (current sandbox default) or off-by-default with operator opt-in? (Recommendation: **on** — matches what UAT will sign off against.)
2. **Backup retention:** the cutover-day backups, keep 30 days or 90? (Recommendation: **90** — past first month-end-close.)
3. **Live 2.3.0 retention:** stop-but-keep for how long? 30 days? 90? (Recommendation: **30** — long enough to catch latent bugs, short enough to free disk.)
4. **Operator role mapping:** sandbox has `sandbox@tpe-test.local` as admin; production needs proper operator accounts. Plan that as a follow-up before public-traffic exposure?
5. **DLT / India SMS compliance:** is the stage-DLT entity registered for production traffic? (Provider Strategy memory says yes for stage; needs formal confirm before > 10K SMS/day.)

## 11. Approval

| Role | Name | Sign-off (date) |
|---|---|---|
| CTO / Project Owner | _____ | _____ |
| Eng Lead | _____ | _____ |
| Compliance Lead | _____ | _____ |
| Operations Lead | _____ | _____ |
| CX Lead | _____ | _____ |
| Infrastructure Lead | _____ | _____ |

---

## Appendix A — VPS service inventory at T-0

(Captured 2026-05-02 14:30 IST)

```
=== Live (2.3.0) — port 80 ===
novu-api          (Up, healthy)
novu-worker       (Up, healthy)
novu-ws           (Up, healthy)
novu-dashboard    (Up, healthy)  ← public traffic point
novu-mongodb      (Up, healthy)
novu-redis        (Up, healthy)
novu-bridge       (STOPPED — manually stopped 2026-05-01 to prevent workflow re-sync)

=== Sandbox (3.15.4) — port 8080 ===
next-api          (Up, healthy)  port 8081
next-worker       (Up, healthy)
next-ws           (Up, healthy)  port 8083
next-dashboard    (Up, healthy)  port 8080  ← target of port-swap
next-bridge       (Up)
next-admin        (Up)
next-mongodb      (Up, healthy)
next-localstack   (Up, healthy)
next-redis        (Up, healthy)

=== Co-tenants on the same VPS (DO NOT TOUCH) ===
metabase          (Up)            port unknown — Metabase team owns
postgres17        (Up)            unrelated to Novu
```

## Appendix B — What happens to the existing tpe-admin custom UI

The custom-built TPE Admin UI (per `memory/sandbox_315_primary.md`) was sunsetted on 2026-05-01 and the `tpe-admin` + `tpe-admin-worker` containers were stopped. They remain ON DISK with their volumes intact. If an operator workflow surfaces in the next 30 days that the Novu CE dashboard CANNOT handle, the rollback path is:

1. Bring TPE Admin back: see `novu-ce-pivot-rollback` skill
2. This is a separate decision from this cutover and not blocked by it
3. The custom admin's `/admin/channels` (channel gating) and `/admin/campaigns` UIs are still in source — preserved for operator return

## Appendix C — Why we didn't pick Path B (migrate sandbox state into live)

| Path B step | Why it's harder than Path A |
|---|---|
| `mongorestore` from sandbox (3.15.4 schema) into live (2.3.0 collections) | Schema versions differ — would need to either run all migrations from 2.3.0 → 3.15.4 OR drop & recreate; both add risk |
| Update live's compose to use 3.15.4 images | Same image swap as Path A but with the additional Mongo cross-load step |
| Live's Mongo + Redis volumes have 2.3.0 indexes; restored 3.15.4 data may not match | Risk of failed reads until indexes rebuilt |
| Net win over Path A | None for this scenario — Path A's port swap is much cleaner |

If we ever need to migrate state cross-host (e.g., move from VPS to ECS Fargate later), then Path B's approach becomes necessary — but for this co-tenant scenario, Path A is strictly safer.
