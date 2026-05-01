# TPE Communication System — Novu CE Deployment

This directory holds the deployment artifacts and skills for the **TPE Communication System** — a self-hosted Novu Community Edition platform for The Policy Exchange (Fairvalue Insuretech) running in AWS ap-south-1 (Mumbai).

## What's here

```
.
├── docs/                           # Charter, Trigger Conditions, Solution review
├── deployment/                     # Combined Deployment Guide + 3 tarballs
│   ├── Novu-Combined-Deployment-Guide.docx
│   ├── novu-ce-stack.tar.gz        # Track B: Docker Compose bundle
│   ├── novu-terraform.tar.gz       # Track A: ECS Fargate IaC
│   └── novu-diagrams.tar.gz        # Mermaid + PNG architecture diagrams
├── tpe-stage-ekyc.pem              # SSH key for the staging eKYC server (43.205.131.196)
└── .claude/
    └── skills/                     # 10 skills for the Track B deployment lifecycle
        ├── INDEX.md                # Skill catalogue
        ├── novu-ec2-provision/
        ├── novu-ec2-bootstrap/
        ├── novu-ce-deploy/
        ├── novu-ce-providers-config/
        ├── novu-ce-bridge-sync/
        ├── novu-ce-smoke-test/
        ├── novu-ce-backup-runbook/
        ├── novu-ce-secret-rotation/
        ├── novu-ce-upgrade/
        └── novu-ce-troubleshoot/
```

## Project memory

Persistent project memory (loaded automatically by Claude Code in this directory) lives at:

`~/.claude/projects/-Users-aksatyam-SelfWork-TPE-WORK-Projetcs-novu-notification-system/memory/`

That directory contains:
- `MEMORY.md` — index of all memories
- `project_overview.md` — TPE-COMMS charter, audiences, triggers, language scope
- `architecture_tracks.md` — Track A vs Track B decision rule
- `ce_stack_components.md` — 11-service inventory, ports, the 3 critical secret formats
- `deployment_artifacts.md` — what's in each tarball + stable section numbers in the guide
- `trigger_inventory.md` — all 49 PH/INV/INS/OPS/REG triggers
- `provider_strategy.md` — Gupshup → MSG91 → Karix failover, SES/FCM/Slack setup
- `compliance_constraints.md` — DPDPA, IRDAI, audit-row-per-message, 30+ middleware lint rules
- `team_roles.md` — sign-off authorities (CTO / Eng Lead / Compliance Lead / etc.)

## Quick start (for a fresh Claude session)

1. **Read the relevant memory file(s)** before answering — the project context is in there.
2. **Pick a skill from `.claude/skills/INDEX.md`** that matches the user's request.
3. **Quote stable section numbers** from the Combined Deployment Guide (§4 Track B, §5 Track A, §7 migrations, §8 backup/DR, §29 failures, §30 secret rotation, §31 operator runbook, Appendix C smoke, Appendix E go-live checklist).

## Hard rules (override convenience)

- **India-resident data only.** No Novu Cloud, no US/EU managed services for primary stores. (DPDPA + Charter §4.12.)
- **Track A for production**, Track B for pilots/demos. Don't mix.
- **`STORE_ENCRYPTION_KEY` is exactly 32 chars** and effectively un-rotatable once integrations are saved. Treat it as a permanent project secret.
- **Migrations are not auto-run** by either deployment track. Source-tree access required at every Novu version bump.
- **Out-of-scope items** (Voice/IVR, AI runtime copy, non-India regions, channels beyond Charter §4.4) require Executive Sponsor approval + a charter revision.
