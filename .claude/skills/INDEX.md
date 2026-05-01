# Novu CE on EC2 — Skill Index

Ten skills covering the Track B (single-EC2 pilot) deployment lifecycle for the TPE Communication System on Novu Community Edition.

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

## Scope

These skills cover **Track B only** — the single-EC2 pilot via Docker Compose. For Track A (multi-AZ ECS Fargate production), use the Terraform bundle directly (`deployment/novu-terraform.tar.gz`) and follow §5 of the Combined Deployment Guide.

## Source of truth

Every skill cross-references stable section numbers in `deployment/Novu-Combined-Deployment-Guide.docx`. Quote those numbers when handing instructions back to the user — they're the authoritative paragraph references the team uses.
