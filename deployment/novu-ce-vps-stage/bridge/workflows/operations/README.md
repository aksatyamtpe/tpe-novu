# Group D — Internal Operations (6 triggers)

Sender identity: **TPE System Bot**

| ID | Trigger | Channels | Cadence |
|---|---|---|---|
| OPS-01 | New Lead Allocated | Slack / Teams + Email | Real-time |
| OPS-02 | Daily Standup Briefing | Slack + Email | Daily 09:00 IST |
| OPS-03 | High-Value Escalation | Slack + SMS | Real-time |
| OPS-04 | Premium Default Alert | Slack + Email | Real-time (paired with INV-10) |
| OPS-05 | KYC Stuck (>7 days) | Slack | Daily digest |
| OPS-06 | Compliance Deadline | Email + Calendar | Pre-deadline |

Charter §4.3.4. OPS-* workflows are **internal-only** — they don't go to
subscribers (policyholders/investors), they go to TPE staff via Slack/Teams
chat channels. The audience is defined by the OPS team's subscriber list.

## Authoring order (recommended)

1. **OPS-04 Premium Default Alert** — pairs with INV-10, simplest internal
   real-time alert.
2. OPS-01 New Lead Allocated — basic Slack + email per-event.
3. OPS-02 Daily Standup Briefing — digest pattern.
4. OPS-05 KYC Stuck — daily-digest pattern.
5. OPS-03 High-Value Escalation — Slack + SMS dual path.
6. OPS-06 Compliance Deadline — pre-deadline reminder pattern.

See `../AUTHORING.md` for the workflow file template.
