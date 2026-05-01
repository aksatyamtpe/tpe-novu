/**
 * INV-08 Premium Due — Investor Lifecycle (volume flagship).
 *
 * Charter §4.3.2 trigger spec:
 *   "Remind the investor that an underlying policy premium is due, then
 *    nudge with escalating urgency through the grace window."
 *   Channels: Email + WhatsApp + SMS + in-app (escalating fan-out by stage).
 *   Cadence: 5 named stages — advance(T-7) → reminder(T-2) → due(T-0)
 *            → grace(T+1) → final(T+3). Each stage is fired by the upstream
 *            scheduler as a separate invocation; this workflow handles a
 *            single stage as a single-shot dispatch (NOT step.delay-orchestrated).
 *   Quiet hours: applied to advance + reminder + grace; bypassed on due + final.
 *
 * Why stage-as-payload (instead of one workflow that step.delays through
 * all five): premium-due is the volume flagship — at scale we expect
 * interleaved cancellations (when a debit clears between stages) and fine
 * upstream control over which stage fires for which insurer. Letting the
 * scheduler own the calendar keeps each invocation independent and easy
 * to audit per-stage.
 *
 * Sender identity: TPE Investments (Charter §4.2 — Investor audience).
 */
import { workflow } from '@novu/framework';
import { z } from 'zod';
import {
  tpeBasePayload, taggedAs, dispatch, dispatchOutput,
  templateEnvKeyFor, resolveTransactionId, pickByLocale, resolveLocale, inAppSkipUnlessEnabled,
} from '../../lib';

const SMS_TEMPLATE_ID = process.env[templateEnvKeyFor('INV-08', 'sms')] ?? '';
const WHATSAPP_TEMPLATE_NAME =
  process.env[templateEnvKeyFor('INV-08', 'whatsapp')] ?? 'dynamictemp2';

type Stage = 'advance' | 'reminder' | 'due' | 'grace' | 'final';

const STAGE_LABEL = {
  en: {
    advance:  'upcoming',
    reminder: 'due soon',
    due:      'due today',
    grace:    'past due',
    final:    'final notice',
  },
  hi: {
    advance:  'आगामी',
    reminder: 'जल्द देय',
    due:      'आज देय',
    grace:    'अतिदेय',
    final:    'अंतिम सूचना',
  },
} as const satisfies Record<'en' | 'hi', Record<Stage, string>>;

/** Channel matrix per stage — escalates fan-out as urgency grows. */
const CHANNELS_FOR: Record<Stage, { sms: boolean; whatsapp: boolean; email: boolean }> = {
  advance:  { sms: false, whatsapp: false, email: true  },          // soft heads-up
  reminder: { sms: false, whatsapp: true,  email: false },          // medium nudge
  due:      { sms: true,  whatsapp: true,  email: true  },          // full fan-out
  grace:    { sms: false, whatsapp: true,  email: true  },          // escalating
  final:    { sms: true,  whatsapp: false, email: true  },          // last call
};

export const invPremiumDue = workflow(
  'inv-08-premium-due',
  async ({ step, payload, subscriber }) => {
    const wfId = 'inv-08-premium-due';
    const triggerId = 'INV-08';
    const audienceGroup = 'INV' as const;
    const txn = resolveTransactionId(payload);
    const locale = resolveLocale({ forceLocale: payload.forceLocale, subscriber });

    // During Novu's workflow-discovery phase, payload is empty — `stage` is
    // undefined. Default to 'due' for discovery so STAGE_LABEL / CHANNELS_FOR
    // lookups don't blow up; the real stage from payload drives runtime behavior.
    const stage: Stage = (payload.stage as Stage) || 'due';
    const stageLabel = STAGE_LABEL[locale][stage] ?? STAGE_LABEL[locale].due;
    const channels = CHANNELS_FOR[stage] ?? CHANNELS_FOR.due;
    // `_isUrgent` is computed but not yet consumed — awaits quiet-hours wiring
    // in dispatch.ts. Keeping it here documents the policy decision for each
    // stage (true on 'due' + 'final').
    const _isUrgent = stage === 'due' || stage === 'final';
    void _isUrgent;

    // ---- in-app inbox — fires for every stage ----
    await step.inApp('inbox-premium-due', async () => ({
      subject: pickByLocale(locale, {
        en: `Premium ${stageLabel} — policy ${payload.policyNumber ?? ''}`,
        hi: `प्रीमियम ${stageLabel} — पॉलिसी ${payload.policyNumber ?? ''}`,
      }),
      body: pickByLocale(locale, {
        en: `Premium of ${payload.amount ?? '(amount on file)'} ` +
            `for policy ${payload.policyNumber ?? '(on file)'} ` +
            `is ${stageLabel}` +
            (payload.dueDate ? ` (due ${payload.dueDate})` : '') + `.`,
        hi: `पॉलिसी ${payload.policyNumber ?? '(फ़ाइल में)'} के लिए ` +
            `${payload.amount ?? '(राशि फ़ाइल में)'} का प्रीमियम ${stageLabel}` +
            (payload.dueDate ? ` (देय तिथि ${payload.dueDate})` : '') + `।`,
      }),
    }), { skip: inAppSkipUnlessEnabled });

    // All three step.custom calls are emitted UNCONDITIONALLY so Novu's
    // discovery phase can enumerate them. The channel-matrix gate moves
    // INSIDE each step body — when this stage doesn't include the channel,
    // the body returns a clean skipped result without calling dispatch.

    // ---- SMS ----
    await step.custom('sms-premium-due', async () => {
      if (!channels.sms) {
        return dispatchOutput({
          ok: false, channel: 'sms', status: 'skipped',
          errorReason: `stage=${stage} excludes sms (channel matrix)`,
          locale,
        });
      }
      // TODO(quiet-hours): when dispatch.ts grows a bypassQuietHours option,
      // pass `_isUrgent` here so 'due' + 'final' stages punch through 21:00–09:00.
      return dispatchOutput(await dispatch({
        channel: 'sms', triggerId, audienceGroup, workflowId: wfId,
        transactionId: txn, subscriber, payload,
        content: { channel: 'sms', sms: {
          templateId: SMS_TEMPLATE_ID,
          vars: {
            var1: stageLabel,
            stage,
            amount: payload.amount ?? '',
            policy: payload.policyNumber ?? '',
            dueDate: payload.dueDate ?? '',
          },
        }},
      }));
    });

    // ---- WhatsApp ----
    await step.custom('whatsapp-premium-due', async () => {
      if (!channels.whatsapp) {
        return dispatchOutput({
          ok: false, channel: 'whatsapp', status: 'skipped',
          errorReason: `stage=${stage} excludes whatsapp (channel matrix)`,
          locale,
        });
      }
      return dispatchOutput(await dispatch({
        channel: 'whatsapp', triggerId, audienceGroup, workflowId: wfId,
        transactionId: txn, subscriber, payload,
        content: { channel: 'whatsapp', whatsapp: {
          templateName: WHATSAPP_TEMPLATE_NAME,
          languageCode: locale,
          // Button param wires through to the payment portal where possible,
          // else falls back to policy number.
          buttonUrlParam:
            payload.paymentUrl ??
            payload.policyNumber ??
            payload.investor_id ??
            'premium-due',
          opaqueCallback:
            `inv-08:${stage}:${payload.policyNumber ?? 'no-policy'}:` +
            `${payload.paymentId ?? 'no-payment-id'}`,
        }},
      }));
    });

    // ---- Email — primary channel; carries the actual payment link ----
    await step.custom('email-premium-due', async () => {
      if (!channels.email) {
        return dispatchOutput({
          ok: false, channel: 'email', status: 'skipped',
          errorReason: `stage=${stage} excludes email (channel matrix)`,
          locale,
        });
      }
      return dispatchOutput(await dispatch({
        channel: 'email', triggerId, audienceGroup, workflowId: wfId,
        transactionId: txn, subscriber, payload,
        content: { channel: 'email', email: {
          subject: pickByLocale(locale, {
            en: emailSubject('en', stage, payload.policyNumber),
            hi: emailSubject('hi', stage, payload.policyNumber),
          }),
          htmlBody: pickByLocale(locale, {
            en: emailBodyEn(stage, payload, subscriber.firstName),
            hi: emailBodyHi(stage, payload, subscriber.firstName),
          }),
        }},
      }));
    });
  },
  {
    payloadSchema: tpeBasePayload.extend({
      stage: z.enum(['advance', 'reminder', 'due', 'grace', 'final']),
      amount: z.string(),
      policyNumber: z.string(),
      dueDate: z.string().optional(),
      insurerName: z.string().optional(),
      paymentUrl: z.string().url().optional(),
      paymentId: z.string().optional(),
      gracePeriodDays: z.number().optional(),
      investor_id: z.string().optional(),
    }),
    tags: taggedAs('INV', 'INV-08', 'transactional', 'premium', 'reminder'),
  },
);

// ---------------------------------------------------------------------------
// Email subject + body builders — kept out of the main flow for readability.
// ---------------------------------------------------------------------------

function emailSubject(lang: 'en' | 'hi', stage: Stage, policy?: string): string {
  const policyTag = policy ? ` — policy ${policy}` : '';
  if (lang === 'en') {
    if (stage === 'advance')  return `Upcoming premium due${policyTag}`;
    if (stage === 'reminder') return `Premium due in 2 days${policyTag}`;
    if (stage === 'due')      return `Action needed: premium due today${policyTag}`;
    if (stage === 'grace')    return `Past due: premium payment${policyTag}`;
    return `Final notice: premium overdue${policyTag}`;
  }
  // hi
  const policyTagHi = policy ? ` — पॉलिसी ${policy}` : '';
  if (stage === 'advance')  return `आगामी प्रीमियम${policyTagHi}`;
  if (stage === 'reminder') return `प्रीमियम 2 दिनों में देय${policyTagHi}`;
  if (stage === 'due')      return `कार्रवाई आवश्यक: आज देय प्रीमियम${policyTagHi}`;
  if (stage === 'grace')    return `अतिदेय: प्रीमियम भुगतान${policyTagHi}`;
  return `अंतिम सूचना: प्रीमियम अतिदेय${policyTagHi}`;
}

function payButton(url?: string, label = 'Pay now'): string {
  if (!url) return '';
  return `<p style="margin:16px 0;">` +
         `<a href="${url}" style="background:#1B3A5C;color:#fff;` +
         `padding:10px 22px;text-decoration:none;border-radius:4px;` +
         `display:inline-block;font-weight:500;">${label}</a></p>`;
}

function emailBodyEn(stage: Stage, p: any, firstName?: string): string {
  const greet = `<p>Hello${firstName ? ' ' + firstName : ''},</p>`;
  const policyLine =
    `<p>This concerns the underlying policy ` +
    `<strong>${p.policyNumber ?? '(on file)'}</strong>` +
    (p.insurerName ? ` with ${p.insurerName}` : '') +
    `.</p>`;
  const amountLine =
    `<p>Premium amount: <strong>${p.amount ?? '(amount on file)'}</strong>` +
    (p.dueDate ? ` due on <strong>${p.dueDate}</strong>` : '') + `.</p>`;
  const footer = `<p style="color:#888;font-size:12px;">— TPE Investments</p>`;

  if (stage === 'advance') {
    return greet + policyLine + amountLine +
      `<p>This is a friendly heads-up — payment is not required yet, ` +
      `but please ensure funds are available before the due date.</p>` +
      payButton(p.paymentUrl, 'Review details') +
      footer;
  }
  if (stage === 'reminder') {
    return greet + policyLine + amountLine +
      `<p>The premium is due in <strong>2 days</strong>. Please clear ` +
      `payment before the due date to keep the policy active.</p>` +
      payButton(p.paymentUrl) +
      footer;
  }
  if (stage === 'due') {
    return greet + policyLine + amountLine +
      `<p><strong>Payment is due today.</strong> Please complete the ` +
      `transaction at your earliest convenience to avoid grace-period charges.</p>` +
      payButton(p.paymentUrl) +
      footer;
  }
  if (stage === 'grace') {
    const grace = p.gracePeriodDays ?? 5;
    return greet + policyLine + amountLine +
      `<p>This payment is now past due. You are within the ` +
      `${grace}-day grace window — please clear payment to avoid policy lapse.</p>` +
      payButton(p.paymentUrl, 'Pay now to avoid lapse') +
      footer;
  }
  // final
  return greet + policyLine + amountLine +
    `<p><strong>This is the final reminder.</strong> If payment isn't received ` +
    `in the next 24 hours, the policy may move to lapsed status — which would ` +
    `affect the underlying investment. Please contact TPE support if you need help.</p>` +
    payButton(p.paymentUrl, 'Pay immediately') +
    footer;
}

function emailBodyHi(stage: Stage, p: any, firstName?: string): string {
  const greet = `<p>नमस्ते${firstName ? ' ' + firstName : ''},</p>`;
  const policyLine =
    `<p>यह संदेश पॉलिसी <strong>${p.policyNumber ?? '(फ़ाइल में)'}</strong>` +
    (p.insurerName ? ` (${p.insurerName})` : '') + ` के बारे में है।</p>`;
  const amountLine =
    `<p>प्रीमियम राशि: <strong>${p.amount ?? '(राशि फ़ाइल में)'}</strong>` +
    (p.dueDate ? ` देय तिथि <strong>${p.dueDate}</strong>` : '') + `।</p>`;
  const footer = `<p style="color:#888;font-size:12px;">— TPE Investments</p>`;

  if (stage === 'due') {
    return greet + policyLine + amountLine +
      `<p><strong>भुगतान आज देय है।</strong> कृपया पॉलिसी सक्रिय रखने के लिए ` +
      `यथाशीघ्र भुगतान पूरा करें।</p>` +
      payButton(p.paymentUrl, 'अभी भुगतान करें') +
      footer;
  }
  if (stage === 'final') {
    return greet + policyLine + amountLine +
      `<p><strong>यह अंतिम अनुस्मारक है।</strong> 24 घंटों के भीतर भुगतान न ` +
      `मिलने पर पॉलिसी की स्थिति प्रभावित हो सकती है।</p>` +
      payButton(p.paymentUrl, 'तुरंत भुगतान करें') +
      footer;
  }
  // advance / reminder / grace share a single softer Hi body
  return greet + policyLine + amountLine +
    `<p>कृपया देय तिथि से पहले भुगतान सुनिश्चित करें।</p>` +
    payButton(p.paymentUrl, 'भुगतान करें') +
    footer;
}
