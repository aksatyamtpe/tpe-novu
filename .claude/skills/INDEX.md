# TPE Communication System — Skill Index

Fourteen skills covering deployment lifecycle, operational tasks, the 2026-05-01 sandbox-3.15-primary pivot, the 2026-05-02 dashboard fork + custom deploy, and enterprise document generation for the TPE Communication System on Novu Community Edition.

## Build sequence (use in order for a first deployment)

| # | Skill | Trigger phrases |
|---|---|---|
| 1 | [novu-ec2-provision](novu-ec2-provision/SKILL.md) | "provision the EC2 host", "create the pilot instance", "spin up novu host" |
| 2 | [novu-ec2-bootstrap](novu-ec2-bootstrap/SKILL.md) | "harden the EC2 box", "install docker on novu host", "bootstrap the host" |
| 3 | [novu-ce-deploy](novu-ce-deploy/SKILL.md) | "deploy novu CE", "bring up the novu stack", "make up", "first deploy" |
| 4 | [novu-ce-providers-config](novu-ce-providers-config/SKILL.md) | "configure SES", "set up MSG91", "add FCM integration", "wire Slack webhook" |
| 5 | [novu-ce-bridge-sync](novu-ce-bridge-sync/SKILL.md) | "sync workflows", "push bridge to dev", "promote workflows to prod" |
| 6 | [novu-ce-smoke-test](novu-ce-smoke-test/SKILL.md) | "smoke test", "verify all CE features", "make smoke", "run e2e check" |

## Day-2 operations (use as needed)

| # | Skill | Trigger phrases |
|---|---|---|
| 7 | [novu-ce-backup-runbook](novu-ce-backup-runbook/SKILL.md) | "backup novu", "set up cron", "test restore", "configure backups" |
| 8 | [novu-ce-secret-rotation](novu-ce-secret-rotation/SKILL.md) | "rotate JWT", "rotate STORE_ENCRYPTION_KEY", "rotate provider keys" |
| 9 | [novu-ce-upgrade](novu-ce-upgrade/SKILL.md) | "upgrade novu", "bump to 2.4.x", "release upgrade" |
| 10 | [novu-ce-troubleshoot](novu-ce-troubleshoot/SKILL.md) | "caddy can't get cert", "bridge unhealthy", "queue backlog", "mongo CPU high" |

## Pivot-era skills (post 2026-05-01 architecture change)

| # | Skill | Trigger phrases |
|---|---|---|
| 11 | [novu-ce-sandbox-bridge-recreate](novu-ce-sandbox-bridge-recreate/SKILL.md) | "recreate next-bridge", "sandbox bridge has placeholder creds", "restore real MSG91 + ICPaaS env on sandbox bridge" |
| 12 | [novu-ce-pivot-rollback](novu-ce-pivot-rollback/SKILL.md) | "roll back the pivot", "bring TPE Admin back", "revert sandbox primary", "restore custom admin" |

## Documentation skills

| # | Skill | Trigger phrases |
|---|---|---|
| 13 | [tpe-enterprise-doc-generator](tpe-enterprise-doc-generator/SKILL.md) | "create enterprise document", "generate master document", "build status report", "make ADR", "create operator manual", "draft project status DOCX" |

## Fork + custom deployment skills (added 2026-05-02)

| # | Skill | Trigger phrases |
|---|---|---|
| 14 | [novu-fe-fork-deploy](novu-fe-fork-deploy/SKILL.md) | "build dashboard locally", "deploy custom dashboard to VPS", "rebuild dashboard image", "push dashboard fork to sandbox", "iterate on dashboard FE", "fix login loop", "toggle Q2=E full CRUD flag", "bump dashboard to new Novu version" |

## Scope

These skills cover **Track B only** — the single-EC2 pilot via Docker Compose. For Track A (multi-AZ ECS Fargate production), use the Terraform bundle directly (`deployment/novu-terraform.tar.gz`) and follow §5 of the Combined Deployment Guide.

The pivot-era skills (11, 12) are specific to the 2026-05-01 architecture decision documented in `memory/sandbox_315_primary.md`. They handle the operational reality that two parallel Novu stacks (live 2.3.0 + sandbox 3.15) coexist on the same VPS.

## Source of truth

Every skill cross-references stable section numbers in `deployment/Novu-Combined-Deployment-Guide.docx`. Quote those numbers when handing instructions back to the user — they're the authoritative paragraph references the team uses.

## Related project memory

- `architecture_tracks.md` — Track A vs Track B decision rule
- `architecture_code_first_only.md` — Studio UI authoring is forbidden
- `sandbox_315_primary.md` — the pivot context for skills 11+12
- `git_repo_setup.md` — GitHub repo coordinates + SSH alias map for this machine
- `novu_3x_payload_gotchas.md` — strict zod validation gotchas in 3.x
- `vkyc_repo_secret_leak.md` — security finding (related, not Novu)
