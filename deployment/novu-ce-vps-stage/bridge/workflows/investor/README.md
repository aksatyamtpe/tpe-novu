# Group B — Investor Lifecycle (16 triggers, **highest message volume**)

Sender identity: **TPE Investments**

| ID | Trigger | Channels (primary) | Cadence |
|---|---|---|---|
| INV-01 | Lead Captured | Email, WhatsApp | T+0,1,3,7,14 drip |
| INV-02 | Registration | Email, SMS, WhatsApp | Standard |
| INV-03 | KYC + Risk Profile | Email, WhatsApp | Standard |
| INV-04 | Investment Opportunity Push | Email, WhatsApp, RCS | Weekly digest plus alerts |
| INV-05 | Investment Soft-Commit | Email, WhatsApp | Immediate |
| INV-06 | Funds Collection | SMS, Email, WhatsApp | Pending: 24h, 48h |
| INV-07 | Investment Confirmed | Email, WhatsApp | Immediate |
| **INV-08** | **Premium Due (10–25 yr stream)** | **All four** | **T-30, T-15, T-7, T-3, T-day, +1, +7, +15 — flagship** |
| INV-09 | Premium Payment Confirmation | Email, WhatsApp | Immediate |
| INV-10 | Premium Default → Lapse Risk | All four plus call | Aggressive escalation |
| INV-11 | Maturity Approaching | Email, WhatsApp | T-12mo, T-6mo, T-3mo, T-1mo, T-7d |
| INV-12 | Maturity Received | SMS, Email, WhatsApp | Immediate |
| INV-13 | Portfolio Statement | Email | Monthly / quarterly / annual |
| INV-14 | Tax Documents (TDS / 80C / 80D) | Email | Statutory cadence |
| INV-15 | Re-investment Opportunity | Email, WhatsApp, RCS | Triggered |
| INV-16 | Account Notices | Email | Monthly + as needed |

Charter §4.3.2. **INV-08 Premium Due is the volume driver** — sizing decisions
for queue, providers, and rate limits should anchor on its fan-out across the
multi-decade horizon.

## Authoring order (recommended)

1. **INV-08 Premium Due** — second exemplar (delay step + multi-channel +
   tenancy-routed + cadence with quiet hours). Land this before fanning out
   to the other 15.
2. INV-09 Premium Payment Confirmation — single-step, pairs with INV-08.
3. INV-10 Premium Default → Lapse Risk — paired with OPS-04 escalation.
4. INV-02 Registration — same shape as PH-02.
5. INV-04 Investment Opportunity Push — RCS adoption.
6. The remaining 11 in Charter ID order.

See `../AUTHORING.md` for the workflow file template.
