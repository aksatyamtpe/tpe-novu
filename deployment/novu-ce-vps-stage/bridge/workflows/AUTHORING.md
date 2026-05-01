# TPE Workflow Authoring Guide

How to add a new lifecycle workflow to the TPE Communication System.

## 1. Where to put the file

Group the file under the audience subdirectory:

```
bridge/workflows/
├── policyholder/   ← Group A — PH-01..PH-18
├── investor/       ← Group B — INV-01..INV-16
├── partner/        ← Group C — INS-01..INS-06
├── operations/     ← Group D — OPS-01..OPS-06
└── regulatory/     ← Group E — REG-01..REG-03
```

Filename convention: `<trigger-id-lowercase>-<short-name>.ts`
Examples:
- `policyholder/ph-02-registration.ts`
- `investor/inv-08-premium-due.ts`
- `partner/ins-02-premium-remittance.ts`

## 2. Required imports

Every workflow imports from `../../lib`:

```ts
import { workflow } from '@novu/framework';
import { z } from 'zod';
import {
  tpeBasePayload,
  taggedAs,
  resolveLocale,
  pickByLocale,
  resolveInsurer,            // only for INS-* workflows
  emitAuditRow, tokenizePii, // for audit row emission
  assertCompliance,          // mandatory at workflow head
} from '../../lib';
```

## 3. Skeleton

```ts
export const phRegistration = workflow(
  'ph-02-registration',
  async ({ step, payload, subscriber }) => {

    // 1. Compliance gate — Charter §4.6, runs first.
    assertCompliance({
      workflowId: 'ph-02-registration',
      triggerId: 'PH-02',
      audienceGroup: 'PH',
      insurerId: payload.insurerId,
    });

    // 2. Locale resolution — Charter §4.4
    const locale = resolveLocale({
      forceLocale: payload.forceLocale,
      subscriber,
    });

    // 3. Channels — sequence per Charter §4.3.6 per-trigger spec
    await step.sms('sms-otp', async () => ({
      body: pickByLocale(locale, {
        en: `Your verification code is ${payload.otp}.`,
        hi: `आपका वेरिफिकेशन कोड ${payload.otp} है।`,
      }),
    }));

    // 4. Audit emission — Charter §4.8
    emitAuditRow({
      transactionId: '?', // Novu fills via context — use the real binding
      triggerInstanceId: payload.triggerInstanceId,
      workflowId: 'ph-02-registration',
      triggerId: 'PH-02',
      audienceGroup: 'PH',
      subscriberToken: tokenizePii(subscriber.subscriberId),
      channel: 'sms',
      status: 'sent',
    });
  },
  {
    payloadSchema: tpeBasePayload.extend({
      otp: z.string().length(6),
    }),
    tags: taggedAs('PH', 'PH-02', 'authentication', 'transactional'),
  },
);
```

## 4. Register it in `workflows/index.ts`

Import and add to the `workflows` array. The Bridge framework's `serve()`
discovers everything in this list.

## 5. Test locally before sync

```bash
cd /Users/aksatyam/SelfWork/TPE_WORK/Projetcs/novu-notification-system/deployment/novu-ce-vps-stage/bridge
npm run dev   # starts Bridge on :4001 with HMR
```

Then sync to the dev environment of your stage Novu:

```bash
# from the bundle root, on the stage VPS:
make sync
```

## 6. Acceptance checklist (before PR review)

- [ ] Trigger ID matches Charter §4.3 exactly (e.g. `PH-02`).
- [ ] `payloadSchema` extends `tpeBasePayload`.
- [ ] `assertCompliance(...)` is the first thing in the workflow body.
- [ ] Locale resolution + `pickByLocale` for all user-facing copy.
- [ ] Multi-tenant routing (`resolveInsurer`) used for any INS-* or
      cross-insurer workflow.
- [ ] `emitAuditRow` called for every dispatched message — including
      skipped/failed ones, with the right `status`.
- [ ] Quiet-hours / weekend / holiday rules respected (use `step.delay` or
      conditional `skip`).
- [ ] Failover behavior matches Charter §4.5 (Gupshup → MSG91 → Karix for
      SMS/WhatsApp).
- [ ] Tags include `taggedAs(group, triggerId, ...)` for dashboard filter.
- [ ] CX, Compliance, and Brand reviewers signed off the user-facing copy.

## 7. Out-of-scope reminders (Charter §4.12)

These are NOT allowed in any workflow:
- Voice / IVR steps
- AI-generated runtime copy (AI-assisted authoring is fine)
- Languages other than English and Hindi
- Channels beyond Email / SMS / WhatsApp / RCS / Slack / Teams
- Direct PII in the audit row (always tokenize)
- Insurer routing without registry lookup
