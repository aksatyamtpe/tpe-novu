# Group A — Policyholder Lifecycle (18 triggers)

Sender identity: **TPE Customer Care**

| ID | Trigger | Channels (primary) | Cadence |
|---|---|---|---|
| PH-01 | Lead Captured | Email, WhatsApp | T+0,1,3,7 drip |
| PH-02 | Registration | SMS, WhatsApp, Email | Abandoned: 1h, 24h, 72h |
| PH-03 | KYC | All four | Pending: weekly × 4, monthly × 4, then close |
| PH-04 | Policy Document Upload | Email, WhatsApp | Per status |
| PH-05 | Policy Verification | WhatsApp, Email | Update every 48 hours |
| PH-06 | Surrender Value Quote | Email, WhatsApp | T+0, T+2, T+5, T-1 pre-expiry |
| PH-07 | Offer Decision | Email, WhatsApp | Silent: 3d, 7d |
| PH-08 | Assignment Paperwork | Email, WhatsApp, SMS | e-Sign: T+1, T+3 |
| PH-09 | Investor Matched | WhatsApp, Email | Immediate |
| PH-10 | Disbursement | SMS, WhatsApp, Email | Per status |
| PH-11 | Post-Assignment Welcome | Email, WhatsApp | Welcome + quarterly newsletter |
| PH-12 | Loan Application | All four | Standard |
| PH-13 | Loan Approval | Email, WhatsApp, SMS | Immediate |
| PH-14 | Loan Disbursement | SMS, WhatsApp | Immediate |
| PH-15 | Loan EMI Reminder | SMS, WhatsApp, Email | T-7, T-3, T-day, +1, +7, +15, +30 |
| PH-16 | Loan Closure | Email, WhatsApp | Per event |
| PH-17 | Re-engagement | Email, WhatsApp | Decay drip at 30d, 90d, 6m, 1y |
| PH-18 | Referral Program | WhatsApp, Email | Per event |

Charter §4.3.1. Per-trigger details (statuses, sequencing, fallbacks, failure
handling) live in §4.3.6 of the Charter and are summarized in the project memory
file `trigger_inventory.md`.

## Authoring order (recommended — simplest first)

1. **PH-02 Registration** — exemplar (SMS + email fallback + skip + payloadSchema).
2. PH-09 Investor Matched — single-step transactional, no cadence.
3. PH-01 Lead Captured — drip cadence with quiet hours.
4. PH-15 Loan EMI Reminder — multi-step delay-based cadence.
5. PH-06 Surrender Value Quote — multi-channel + attachment + expiry race.
6. The remaining 13 in Charter ID order.

See `../AUTHORING.md` for the workflow file template.
