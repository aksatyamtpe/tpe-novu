# Group C — Insurance Partner / B2B (6 triggers)

Sender identity: **TPE Operations + per-carrier identity** (multi-tenant via Charter §4.7).

| ID | Trigger | Channels | Cadence |
|---|---|---|---|
| INS-01 | Assignment Intimation | Email + carrier portal | Per case |
| **INS-02** | **Premium Remittance + Allocation MIS** | Email + Excel attachment | Monthly batch — **reuses existing MIS Pipeline** |
| INS-03 | MIS Reconciliation | Email + Excel | Monthly |
| INS-04 | Query Resolution | Email | Per case |
| INS-05 | Maturity / Claim Coordination | Email | Per case |
| INS-06 | Regulatory / KYC Refresh | Email | Per cadence |

Charter §4.3.3. INS-* workflows are **always tenancy-routed** —
`payload.insurerId` is required and must resolve via `resolveInsurer()` from
the `INSURER_REGISTRY`.

## Authoring order (recommended)

1. **INS-02 Premium Remittance** — exercises Excel attachment + MIS Pipeline
   reuse + per-carrier sender identity.
2. INS-04 Query Resolution — simplest INS-* workflow, validates the routing
   pattern.
3. INS-01 Assignment Intimation — first-time-per-policy, narrow.
4. INS-03 MIS Reconciliation — discrepancy resolution flow.
5. INS-05 + INS-06 — straightforward email per case / per cadence.

## Pre-requisite

Insurer registry data (`bridge/lib/insurer-registry.ts` `INSURER_REGISTRY`)
must be populated with the eleven real partners **before** authoring any
INS-* workflow. Operations Lead is the data owner — see Charter §2.1, §4.13
(~2 days insurer-operations input).

See `../AUTHORING.md` for the workflow file template.
