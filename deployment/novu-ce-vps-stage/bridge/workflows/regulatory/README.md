# Group E — Regulatory / Statutory (3 triggers)

Sender identity: **TPE Compliance**

| ID | Trigger | Cadence |
|---|---|---|
| REG-01 | IRDAI Filing — quarterly + annual | Per regulator schedule |
| REG-02 | TDS Certificates to Investors | Quarterly (Form 16A) |
| REG-03 | GST Invoices | Per transaction |

Charter §4.3.5. REG-* workflows are **statutory** — content templates are
audit-controlled and require Compliance Lead sign-off on every change.

## Authoring order (recommended)

1. **REG-02 TDS Certificates** — recurring per-investor email with attached
   Form 16A. Highest message volume in the group.
2. REG-03 GST Invoices — per-transaction email.
3. REG-01 IRDAI Filing — least frequent (quarterly + annual), but most
   sensitive content.

## Pre-requisite

Compliance Lead approves the body templates BEFORE authoring. Brand-voice
constraints + statutory-language requirements live in the compliance
middleware rule registry (Charter §4.6). The compliance middleware will
reject these workflows on PR merge until both:
  - The IRDAI / TDS / GST rule sets are in place under `bridge/lib/compliance.ts`
  - The Compliance Lead has signed off on the rendered content

See `../AUTHORING.md` for the workflow file template.
