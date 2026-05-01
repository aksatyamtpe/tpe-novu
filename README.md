# TPE Communication System — Self-hosted Novu CE

**A code-first notification platform** for The Policy Exchange (Fairvalue Insuretech) running on a single VPS in Mumbai. Carries 49 Charter §4.3 lifecycle triggers across 5 audiences (policyholders, investors, insurers, ops, regulators) — currently 17/49 implemented and live on stage.

---

## At a glance

| | |
|---|---|
| **Platform** | Self-hosted [Novu Community Edition](https://github.com/novuhq/novu) |
| **Versions in production** | Live: 2.3.0 (port 80) · Sandbox: 3.15.0 (port 8080) — **sandbox is now primary** |
| **Hosting** | CentOS 9 VPS at `103.138.96.180:7576` (Mumbai, ap-south-1 region equivalent) |
| **Workflow authoring** | Code-first only — `bridge/workflows/*.ts` synced via `npx novu sync`. **No Studio UI authoring.** |
| **SMS provider** | MSG91 v5 Flow API (DLT-template registered, 7 templates live) |
| **WhatsApp provider** | ICPaaS Cloud API (Bearer auth) |
| **Email provider** | AWS SES (deferred — not configured yet) |
| **In-app** | Novu's native Inbox (channel allowlist gates this in stage) |
| **Compliance** | DPDPA + IRDAI + DLT (India-resident PII; audit row per dispatched message; 30+ middleware lint rules) |

---

## Why this exists

TPE runs notification-heavy lifecycle journeys for insurance customers (policy onboarding, premium dues, maturity reminders, KYC, etc.). The Charter mandates:

1. **49 lifecycle triggers** — all versioned in source control, reviewable by CX + Compliance leads before merge
2. **India-resident data only** — no Novu Cloud, no US/EU managed services for primary stores (DPDPA + Charter §4.12)
3. **Per-message audit trail** — every dispatch attempt produces an audit row with channel + status + locale + skip-reason
4. **Multi-channel failover** — SMS via MSG91 (with Gupshup/Karix as planned fallback), WhatsApp via ICPaaS, email via SES, in-app via native Inbox

Off-the-shelf Novu Cloud meets none of those. Self-hosted CE on India infrastructure does.

---

## Architecture in one diagram

```
                     ┌─────────────────────────────────────────┐
                     │  Novu CE Dashboard (3.15) — port 8080   │  ← operators
                     │  • View workflows                       │
                     │  • Trigger workflows                    │
                     │  • Activity feed (audit trail)          │
                     └──────────┬──────────────────────────────┘
                                │ /v1/events/trigger
                                ▼
                     ┌────────────────────────────┐
                     │  next-api (Novu API)       │
                     │  next-worker (job runner)  │
                     │  next-mongodb              │
                     │  next-redis                │
                     └──────────┬─────────────────┘
                                │ HTTP /api/novu (Bridge protocol)
                                ▼
                     ┌────────────────────────────────────┐
                     │  next-bridge (custom code-first)   │
                     │  bridge/workflows/*.ts             │
                     │  bridge/lib/dispatch.ts            │
                     │     ↓                              │
                     │  bridge/lib/providers/             │
                     │   ├─ msg91.ts    → MSG91 v5/Flow   │ ───▶ ☎ MSG91 SMS API
                     │   ├─ icpaas.ts   → WhatsApp Cloud  │ ───▶ 💬 ICPaaS WA API
                     │   └─ email-ses.ts → SES (deferred) │ ───▶ ✉ AWS SES (later)
                     │                                    │
                     │  bridge/lib/channel-gating.ts      │ ◀── tpe_channel_gating doc
                     │     (operator allowlist)           │     (Mongo, 10s cache)
                     └────────────────────────────────────┘
```

**Why the Bridge layer exists**: Novu CE 2.3.0/3.15.0 worker doesn't ship MSG91 or ICPaaS as built-in providers. Our `dispatch.ts` is a custom shim that handles channel routing, audit emission, channel-gating, locale resolution, and DLT-compliant template_id+vars sends. Studio-authored workflows can't reach this — that's why all Charter workflows must remain code-first.

---

## Repository structure

```
novu-notification-system/
│
├── README.md                            ← you are here
├── CLAUDE.md                            ← project instructions for Claude Code sessions
├── .gitignore                           ← keeps secrets + node_modules out
│
├── docs/                                ← human-facing deliverables
│   ├── TPE_Communication_System_Charter_v1.0.docx
│   ├── TPE_Communication_System_Charter_Addendum_v1.1.docx
│   ├── TPE_Communication_System_Trigger_Conditions_v2.0.docx
│   ├── TPE_Communication_System_End_User_Guide_v1.0.docx
│   ├── TPE_Communication_System_Novu_Solution_v1.0_turn1_review.docx
│   ├── topology_diagram.svg
│   ├── archive/                         ← SOW v3..v5 (history)
│   ├── generate_charter_addendum.py     ← Python generators for the DOCX deliverables
│   └── generate_end_user_guide.py
│
├── deployment/                          ← deployable artifacts
│   ├── Novu-Combined-Deployment-Guide.docx   ← THE source-of-truth runbook
│   ├── novu-ce-stack.tar.gz             ← Track B (single-EC2 / Docker Compose) bundle
│   ├── novu-terraform.tar.gz            ← Track A (multi-AZ ECS Fargate) IaC
│   ├── novu-diagrams.tar.gz             ← Mermaid + PNG architecture diagrams
│   ├── novu-ce-vps-stage/               ← live stack source tree (the active deployment)
│   │   ├── docker-compose.yml           ← 11-service compose: Novu core + Bridge + Admin + co-tenants
│   │   ├── .env.example                 ← env-var template (real .env never committed)
│   │   ├── Makefile                     ← make ps / make logs / make sync / make smoke
│   │   ├── bridge/                      ← code-first workflow source
│   │   │   ├── workflows/
│   │   │   │   ├── policyholder/        ← PH-02..17 (10 workflows)
│   │   │   │   ├── investor/            ← INV-02, 05, 07..12 (7 workflows)
│   │   │   │   ├── _test/               ← multichannel test fixture
│   │   │   │   ├── _bundle-samples-archived/  ← upstream Novu samples (excluded from sync)
│   │   │   │   ├── welcome-onboarding-minimal.ts
│   │   │   │   └── index.ts             ← workflow registry
│   │   │   ├── lib/
│   │   │   │   ├── dispatch.ts          ← THE channel router (audit, gating, locale)
│   │   │   │   ├── channel-gating.ts    ← Mongo-backed allowlist with 10s cache
│   │   │   │   ├── providers/           ← MSG91, ICPaaS, SES adapters
│   │   │   │   └── types.ts             ← tpeBasePayload + Channel enum
│   │   │   └── ...
│   │   └── admin/                       ← TPE custom Next.js admin (sunsetted; see memory)
│   └── _archive/
│       └── novu-ce-stage-cohost/        ← retired eKYC co-host arrangement
│
└── .claude/
    └── skills/                          ← operational runbooks (slash-command friendly)
        ├── INDEX.md                     ← skill catalogue
        ├── novu-ec2-provision/SKILL.md
        ├── novu-ec2-bootstrap/SKILL.md
        ├── novu-ce-deploy/SKILL.md
        ├── novu-ce-providers-config/SKILL.md
        ├── novu-ce-bridge-sync/SKILL.md
        ├── novu-ce-smoke-test/SKILL.md
        ├── novu-ce-backup-runbook/SKILL.md
        ├── novu-ce-secret-rotation/SKILL.md
        ├── novu-ce-upgrade/SKILL.md
        └── novu-ce-troubleshoot/SKILL.md
```

---

## Quick reference — operational URLs (stage VPS)

| Surface | URL | Purpose |
|---|---|---|
| **Novu Dashboard (PRIMARY)** | http://103.138.96.180:8080 | Operator UI — workflows, subscribers, triggering, activity feed |
| Sandbox Novu API | http://103.138.96.180:8081 | `POST /v1/events/trigger` for upstream services |
| Sandbox WebSocket | ws://103.138.96.180:8083 | `<Inbox/>` widget connections |
| Live Novu Dashboard (de-emphasised) | http://103.138.96.180/ | Legacy 2.3.0 stack, kept running for redundancy |
| Live Novu API | http://103.138.96.180/api | Legacy API endpoint |
| TPE Admin (deprecated) | ~~http://103.138.96.180/admin~~ | Sunsetted 2026-05-01; containers stopped, code preserved |
| SSH | `ssh -i ~/.ssh/id_novu_vps -p 7576 root@103.138.96.180` | Server access (use the VPS-specific key, not `tpe-stage-ekyc.pem` which is legacy) |

---

## The 17 Charter §4.3 workflows currently live

| Audience | Trigger ID | What it does |
|---|---|---|
| Policyholder | `ph-02-registration` | OTP for registration (SMS+WA+Email+InApp) |
| Policyholder | `ph-08-assignment-paperwork` | E-Sign nudge after policy assignment |
| Policyholder | `ph-09-investor-matched` | Notify PH when an investor matches their policy |
| Policyholder | `ph-11-post-assignment-welcome` | Onboarding after investor accepts assignment |
| Policyholder | `ph-12-loan-application` | Loan application acknowledgement |
| Policyholder | `ph-13-loan-approval` | Loan approval notice |
| Policyholder | `ph-14-loan-disbursement` | Funds disbursed |
| Policyholder | `ph-15-loan-emi-reminder` | EMI cadence (channel-matrix-by-stage) |
| Policyholder | `ph-16-loan-closure` | Loan closed confirmation |
| Policyholder | `ph-17-re-engagement` | Reactivation for dormant accounts |
| Investor | `inv-02-registration` | OTP for registration |
| Investor | `inv-05-investment-soft-commit` | Soft-commit captured |
| Investor | `inv-07-investment-confirmed` | Investment confirmed + receipt |
| Investor | `inv-08-premium-due` | **Highest-volume flagship** — premium-due cadence |
| Investor | `inv-09-premium-payment-confirmation` | Payment receipt |
| Investor | `inv-11-maturity-reminder` | Maturity-approaching cadence |
| Investor | `inv-12-maturity-received` | Maturity payout receipt |

**Remaining 32** (INS-* insurer workflows, OPS-* operations workflows, REG-* regulator workflows): planned in subsequent phases.

---

## Hard rules (these override convenience)

| Rule | Why |
|---|---|
| **Code-first authoring only** | All workflows live in `bridge/workflows/*.ts`, version-controlled, PR-reviewed. Studio UI authoring is forbidden — it bypasses Git, compliance middleware lint, and DLT template enforcement. |
| **India-resident data only** | DPDPA + Charter §4.12. No Novu Cloud, no US/EU regions for any primary store. |
| **Track A for production, Track B for stage/pilot** | Don't mix. Track A = multi-AZ ECS Fargate. Track B = single-EC2/VPS via Docker Compose. |
| **`STORE_ENCRYPTION_KEY` is exactly 32 chars** | Effectively un-rotatable once integrations are saved. Treat it as a permanent project secret. |
| **Migrations are not auto-run** | Source-tree access required at every Novu version bump (e.g. 2.x → 3.x had migrations). |
| **MSG91 is not in Novu's catalog** | Cannot be configured via Integration Store. SMS dispatch goes through Bridge. **Always.** |
| **`tpe-stage-ekyc.pem` is legacy** | The current VPS uses `~/.ssh/id_novu_vps`. The eKYC host (43.205.131.196) was retired 2026-04-30. |

---

## Common operations

### Add a new workflow

```bash
# 1. Create the file
vim deployment/novu-ce-vps-stage/bridge/workflows/policyholder/ph-NN-foo.ts

# 2. Register in the index
vim deployment/novu-ce-vps-stage/bridge/workflows/index.ts
#    add: import { phNN } from './policyholder/ph-NN-foo';
#    add to workflows array

# 3. Rebuild bridge
ssh -i ~/.ssh/id_novu_vps -p 7576 root@103.138.96.180
cd /opt/novu-next/sandbox
docker compose up -d --build next-bridge

# 4. Sync to sandbox API
docker exec next-bridge sh -c 'cd /app && npx --yes novu@latest sync \
  --bridge-url http://next-bridge:4001/api/novu \
  --api-url http://next-api:3000 \
  --secret-key 54ad9d4dd50398489413be350237bd88'

# 5. Smoke-trigger from the dashboard or via curl
curl -X POST http://103.138.96.180:8081/v1/events/trigger \
  -H "Authorization: ApiKey 54ad9d4dd50398489413be350237bd88" \
  -H "Content-Type: application/json" \
  -d '{"name":"ph-NN-foo","to":{"subscriberId":"test"},"payload":{...}}'
```

### Check why a trigger didn't deliver

```bash
ssh -i ~/.ssh/id_novu_vps -p 7576 root@103.138.96.180

# 1. Bridge audit log (per-channel send/skip detail)
docker logs next-bridge --since 5m | grep -E "(audit|MSG91|ICPaaS|wamid|status|reason)"

# 2. Sandbox jobs collection (was the workflow even queued?)
docker exec next-mongodb mongosh --quiet \
  -u novu_next_root -p <SANDBOX_MONGO_PW> --authenticationDatabase admin \
  novu-db --eval 'db.jobs.find({transactionId:"txn_xxx"}).toArray()'

# 3. Worker log (Bridge HTTP errors land here)
docker logs next-worker --since 5m | grep "txn_xxx"

# 4. Live activity feed
http://103.138.96.180:8080 → Activity → search by transactionId
```

### Restart a service

```bash
ssh -i ~/.ssh/id_novu_vps -p 7576 root@103.138.96.180
docker restart next-bridge next-worker        # restart specific services
docker compose -f /opt/novu-next/sandbox/sandbox-compose.yml ps   # see all sandbox services
```

---

## Skills (operational runbooks)

Ten skills under `.claude/skills/` cover the deployment lifecycle. Use them by invoking the slash-command-style trigger phrase:

| # | Skill | Trigger phrases |
|---|---|---|
| 1 | `novu-ec2-provision` | "provision the EC2 host", "spin up novu host" |
| 2 | `novu-ec2-bootstrap` | "harden the EC2 box", "bootstrap the host" |
| 3 | `novu-ce-deploy` | "deploy novu CE", "make up", "first deploy" |
| 4 | `novu-ce-providers-config` | "configure SES", "set up MSG91", "wire Slack webhook" |
| 5 | `novu-ce-bridge-sync` | "sync workflows", "promote workflows to prod" |
| 6 | `novu-ce-smoke-test` | "smoke test", "make smoke" |
| 7 | `novu-ce-backup-runbook` | "backup novu", "test restore", "set up cron" |
| 8 | `novu-ce-secret-rotation` | "rotate JWT", "rotate provider keys" |
| 9 | `novu-ce-upgrade` | "upgrade novu", "bump to 2.4.x" |
| 10 | `novu-ce-troubleshoot` | "bridge unhealthy", "queue backlog", "mongo CPU high" |

Stable section numbers in `deployment/Novu-Combined-Deployment-Guide.docx` — quote them when handing instructions back: §4 Track B, §5 Track A, §7 migrations, §8 backup/DR, §29 failures, §30 secret rotation, §31 operator runbook, Appendix C smoke, Appendix E go-live.

---

## Project memory (for Claude Code sessions)

Persistent notes live in `~/.claude/projects/-Users-aksatyam-SelfWork-TPE-WORK-Projetcs-novu-notification-system/memory/` and are auto-loaded when working in this directory. Key files:

| File | Captures |
|---|---|
| `MEMORY.md` | Index of all memories |
| `project_overview.md` | TPE-COMMS charter, audiences, triggers, language scope |
| `architecture_tracks.md` | Track A vs Track B decision rule |
| `ce_stack_components.md` | 11-service inventory, ports, the 3 critical secret formats |
| `provider_strategy.md` | Failover Gupshup → MSG91 → Karix; SES; FCM/APNs; DLT mandatory before SMS |
| `compliance_constraints.md` | DPDPA, IRDAI, audit-row-per-message, middleware lint rules |
| `staging_host_vps.md` | Active stage host details, container inventory |
| `dispatch_architecture.md` | The `lib/dispatch.ts` pattern + provider adapters |
| `phase1_status.md` | 17/49 workflows live; channel-matrix-by-stage trio (INV-08, PH-15, INV-11) |
| `stage_channel_gating.md` | 4-checkbox allowlist + Bridge cache + dispatch.ts gate |
| `campaigns_phase1a.md` | Campaign builder phases 1A→1C (legacy, sunsetted with TPE Admin) |
| `novu_next_sandbox.md` | 3.15 sandbox deployment + 3.x env-var changes |
| `workflow_wipe_2026-05-01.md` | Wipe + restore commands for both stacks |
| `sandbox_315_primary.md` | **The pivot**: sandbox 3.15 promoted to primary, TPE Admin sunsetted |
| `novu_3x_payload_gotchas.md` | 3.x strict zod validation gotchas (otp not otpCode, real UUIDs, txn_ prefix) |

---

## Team roles

| Role | Owner | Signs off on |
|---|---|---|
| Executive Sponsor | TPE leadership | Charter changes, scope expansion (Voice/IVR, AI runtime copy, non-India regions) |
| Project Owner / CTO | Fairvalue Insuretech CTO | Architecture, vendor choices, milestone gates |
| Engineering Lead | (Eng) | Bridge code, workflow PRs, CI gate config |
| Compliance Lead | (Compliance) | Middleware lint rules, DPDPA/IRDAI/DLT review, audit-row format |
| CX Lead | (CX) | Copy review, language localisation, A/B variants |
| Operations Lead | (Ops) | Subscriber management, campaign launches, SLA monitoring |
| Infrastructure Lead | (Infra) | VPS, networking, SSL/TLS, secrets vaulting |
| Quality Lead | (QA) | Smoke tests, e2e fixtures, regression checks |

---

## License

Proprietary — Fairvalue Insuretech / The Policy Exchange. Not for redistribution.

Built on [Novu Community Edition](https://github.com/novuhq/novu) (MIT-licensed).
