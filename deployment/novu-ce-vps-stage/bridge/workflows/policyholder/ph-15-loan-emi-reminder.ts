/**
 * PH-15 Loan EMI Reminder — Policyholder Lifecycle.
 *
 * Charter §4.3.1 trigger spec:
 *   "Drive the policyholder through the loan-EMI reminder cadence,
 *    pairing with PH-14 Loan Disbursement upstream and tracking grace
 *    + overdue states with escalating urgency."
 *   Channels: Email, SMS, WhatsApp, in-app — escalating fan-out by stage.
 *   Cadence: 5 named stages — advance(T-5) → reminder(T-2) → due(T-0)
 *            → grace(T+1) → overdue(T+7). Each stage is fired by the
 *            upstream scheduler as a separate invocation.
 *   Quiet hours: applied to advance + reminder + grace; bypassed on due + overdue.
 *
 * Why stage-as-payload (and not step.delay-orchestrated): EMIs are monthly
 * and high-volume. Letting the scheduler own the calendar means each
 * invocation is independent and easy to cancel when an EMI clears
 * mid-cadence. Same reasoning as INV-08 Premium Due.
 *
 * Sender identity: TPE Customer Care (Charter §4.2 — Policyholder audience).
 *
 * NOTE: this is the LOAN cadence (vs INV-08's premium cadence). Differences:
 *   - shorter grace window (T+1, T+7) — lenders are stricter than insurers
 *   - "overdue" instead of "final" — lender vocabulary
 *   - copy emphasizes late-fee + credit-report risk, not policy-lapse risk
 */
import { workflow } from '@novu/framework';
import { z } from 'zod';
import {
  tpeBasePayload, taggedAs, dispatch, dispatchOutput,
  templateEnvKeyFor, resolveTransactionId, pickByLocale, resolveLocale, inAppSkipUnlessEnabled,
} from '../../lib';

const SMS_TEMPLATE_ID = process.env[templateEnvKeyFor('PH-15', 'sms')] ?? '';
const WHATSAPP_TEMPLATE_NAME =
  process.env[templateEnvKeyFor('PH-15', 'whatsapp')] ?? 'dynamictemp2';

type Stage = 'advance' | 'reminder' | 'due' | 'grace' | 'overdue';

const STAGE_LABEL = {
  en: {
    advance:  'upcoming',
    reminder: 'due soon',
    due:      'due today',
    grace:    'past due',
    overdue:  'overdue',
  },
  hi: {
    advance:  'आगामी',
    reminder: 'जल्द देय',
    due:      'आज देय',
    grace:    'अतिदेय',
    overdue:  'बकाया',
  },
} as const satisfies Record<'en' | 'hi', Record<Stage, string>>;

/** Channel matrix per stage — EMI reminders escalate harder than premiums
 *  because lenders impose late fees + credit-bureau reporting after grace. */
const CHANNELS_FOR: Record<Stage, { sms: boolean; whatsapp: boolean; email: boolean }> = {
  advance:  { sms: false, whatsapp: false, email: true  },           // soft heads-up
  reminder: { sms: false, whatsapp: true,  email: false },           // medium nudge
  due:      { sms: true,  whatsapp: true,  email: true  },           // full fan-out
  grace:    { sms: true,  whatsapp: true,  email: true  },           // late fee imminent
  overdue:  { sms: true,  whatsapp: false, email: true  },           // collections track
};

export const phLoanEmiReminder = workflow(
  'ph-15-loan-emi-reminder',
  async ({ step, payload, subscriber }) => {
    const wfId = 'ph-15-loan-emi-reminder';
    const triggerId = 'PH-15';
    const audienceGroup = 'PH' as const;
    const txn = resolveTransactionId(payload);
    const locale = resolveLocale({ forceLocale: payload.forceLocale, subscriber });

    // Discovery-phase guard — see channel-matrix-by-stage learning in
    // memory/phase1_status.md (INV-08 was where we hit this first).
    const stage: Stage = (payload.stage as Stage) || 'due';
    const stageLabel = STAGE_LABEL[locale][stage] ?? STAGE_LABEL[locale].due;
    const channels = CHANNELS_FOR[stage] ?? CHANNELS_FOR.due;
    const _isUrgent = stage === 'due' || stage === 'overdue';
    void _isUrgent;

    // Display-friendly EMI position: "EMI 7 of 24" or "EMI 7" if total unknown.
    const emiPosition =
      payload.emiNumber && payload.totalEmis
        ? `${payload.emiNumber} of ${payload.totalEmis}`
        : payload.emiNumber
        ? `${payload.emiNumber}`
        : '';

    // ---- in-app inbox — fires for every stage ----
    await step.inApp('inbox-emi-reminder', async () => ({
      subject: pickByLocale(locale, {
        en: `EMI ${stageLabel} — loan ${payload.loanAccount ?? ''}`,
        hi: `EMI ${stageLabel} — ऋण ${payload.loanAccount ?? ''}`,
      }),
      body: pickByLocale(locale, {
        en: `EMI of ${payload.emiAmount ?? '(amount on file)'} ` +
            (emiPosition ? `(${emiPosition}) ` : '') +
            `for loan ${payload.loanAccount ?? '(on file)'} ` +
            `is ${stageLabel}` +
            (payload.dueDate ? ` (due ${payload.dueDate})` : '') + `.`,
        hi: `ऋण ${payload.loanAccount ?? '(फ़ाइल में)'} के लिए ` +
            `${payload.emiAmount ?? '(राशि फ़ाइल में)'} की EMI ${stageLabel}` +
            (payload.dueDate ? ` (देय तिथि ${payload.dueDate})` : '') + `।`,
      }),
    }), { skip: inAppSkipUnlessEnabled });

    // All three step.custom calls are emitted UNCONDITIONALLY so Novu's
    // discovery phase enumerates them. Channel-matrix gate is INSIDE each.

    // ---- SMS ----
    await step.custom('sms-emi-reminder', async () => {
      if (!channels.sms) {
        return dispatchOutput({
          ok: false, channel: 'sms', status: 'skipped',
          errorReason: `stage=${stage} excludes sms (channel matrix)`,
          locale,
        });
      }
      // TODO(quiet-hours): pass `_isUrgent` once dispatch.ts grows the option.
      return dispatchOutput(await dispatch({
        channel: 'sms', triggerId, audienceGroup, workflowId: wfId,
        transactionId: txn, subscriber, payload,
        content: { channel: 'sms', sms: {
          templateId: SMS_TEMPLATE_ID,
          vars: {
            var1: stageLabel,
            stage,
            amount: payload.emiAmount ?? '',
            loan: payload.loanAccount ?? '',
            dueDate: payload.dueDate ?? '',
            emiNumber: String(payload.emiNumber ?? ''),
          },
        }},
      }));
    });

    // ---- WhatsApp ----
    await step.custom('whatsapp-emi-reminder', async () => {
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
          buttonUrlParam:
            payload.payNowUrl ??
            payload.loanAccount ??
            payload.ph_id ??
            'emi-reminder',
          opaqueCallback:
            `ph-15:${stage}:${payload.loanAccount ?? 'no-loan'}:` +
            `${payload.emiNumber ?? 'no-emi'}`,
        }},
      }));
    });

    // ---- Email — primary channel; carries the actual pay-now link ----
    await step.custom('email-emi-reminder', async () => {
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
            en: emailSubject('en', stage, payload.loanAccount, emiPosition),
            hi: emailSubject('hi', stage, payload.loanAccount, emiPosition),
          }),
          htmlBody: pickByLocale(locale, {
            en: emailBodyEn(stage, payload, subscriber.firstName, emiPosition),
            hi: emailBodyHi(stage, payload, subscriber.firstName, emiPosition),
          }),
        }},
      }));
    });
  },
  {
    payloadSchema: tpeBasePayload.extend({
      stage: z.enum(['advance', 'reminder', 'due', 'grace', 'overdue']),
      emiAmount: z.string(),
      loanAccount: z.string(),
      dueDate: z.string().optional(),
      emiNumber: z.number().int().positive().optional(),
      totalEmis: z.number().int().positive().optional(),
      lateFee: z.string().optional(),
      payNowUrl: z.string().url().optional(),
      ph_id: z.string().optional(),
    }),
    tags: taggedAs('PH', 'PH-15', 'transactional', 'loan', 'emi'),
  },
);

// ---------------------------------------------------------------------------
// Email subject + body builders.
// ---------------------------------------------------------------------------

function emailSubject(lang: 'en' | 'hi', stage: Stage, loan?: string, emiPos?: string): string {
  const loanTag = loan ? ` — loan ${loan}` : '';
  const posTag = emiPos ? ` (EMI ${emiPos})` : '';
  if (lang === 'en') {
    if (stage === 'advance')  return `Upcoming EMI${posTag}${loanTag}`;
    if (stage === 'reminder') return `EMI due in 2 days${posTag}${loanTag}`;
    if (stage === 'due')      return `Action needed: EMI due today${posTag}${loanTag}`;
    if (stage === 'grace')    return `Past due: EMI payment${posTag}${loanTag}`;
    return `Overdue: please pay your EMI${posTag}${loanTag}`;
  }
  // hi
  const loanTagHi = loan ? ` — ऋण ${loan}` : '';
  if (stage === 'advance')  return `आगामी EMI${loanTagHi}`;
  if (stage === 'reminder') return `EMI 2 दिनों में देय${loanTagHi}`;
  if (stage === 'due')      return `कार्रवाई आवश्यक: आज देय EMI${loanTagHi}`;
  if (stage === 'grace')    return `अतिदेय: EMI भुगतान${loanTagHi}`;
  return `बकाया: कृपया अपनी EMI चुकाएं${loanTagHi}`;
}

function payButton(url?: string, label = 'Pay EMI now'): string {
  if (!url) return '';
  return `<p style="margin:16px 0;">` +
         `<a href="${url}" style="background:#1B3A5C;color:#fff;` +
         `padding:10px 22px;text-decoration:none;border-radius:4px;` +
         `display:inline-block;font-weight:500;">${label}</a></p>`;
}

function emailBodyEn(stage: Stage, p: any, firstName?: string, emiPos?: string): string {
  const greet = `<p>Hello${firstName ? ' ' + firstName : ''},</p>`;
  const loanLine =
    `<p>This concerns your loan account <strong>${p.loanAccount ?? '(on file)'}</strong>` +
    (emiPos ? ` (EMI ${emiPos})` : '') + `.</p>`;
  const amountLine =
    `<p>EMI amount: <strong>${p.emiAmount ?? '(amount on file)'}</strong>` +
    (p.dueDate ? ` due on <strong>${p.dueDate}</strong>` : '') + `.</p>`;
  const footer = `<p style="color:#888;font-size:12px;">— TPE Customer Care</p>`;

  if (stage === 'advance') {
    return greet + loanLine + amountLine +
      `<p>This is a friendly heads-up — payment is not required yet, ` +
      `but please ensure funds are available before the due date to keep ` +
      `your loan in good standing.</p>` +
      payButton(p.payNowUrl, 'Review EMI details') +
      footer;
  }
  if (stage === 'reminder') {
    return greet + loanLine + amountLine +
      `<p>Your EMI is due in <strong>2 days</strong>. Please clear ` +
      `payment before the due date to avoid late fees.</p>` +
      payButton(p.payNowUrl) +
      footer;
  }
  if (stage === 'due') {
    return greet + loanLine + amountLine +
      `<p><strong>Payment is due today.</strong> Please complete the ` +
      `transaction at your earliest convenience to avoid late charges.</p>` +
      payButton(p.payNowUrl) +
      footer;
  }
  if (stage === 'grace') {
    const fee = p.lateFee ?? 'a late fee';
    return greet + loanLine + amountLine +
      `<p>This EMI is now past due. ${fee} may apply, and continued ` +
      `non-payment will be reported to the credit bureau. Please pay today.</p>` +
      payButton(p.payNowUrl, 'Pay now to avoid late fee') +
      footer;
  }
  // overdue
  return greet + loanLine + amountLine +
    `<p><strong>Your EMI is overdue.</strong> Late fees have been applied ` +
    `and your loan is at risk of being escalated to collections. Please pay ` +
    `today, or contact TPE Customer Care to discuss a payment arrangement.</p>` +
    payButton(p.payNowUrl, 'Pay overdue EMI') +
    footer;
}

function emailBodyHi(stage: Stage, p: any, firstName?: string, emiPos?: string): string {
  const greet = `<p>नमस्ते${firstName ? ' ' + firstName : ''},</p>`;
  const loanLine =
    `<p>यह संदेश आपके ऋण खाते <strong>${p.loanAccount ?? '(फ़ाइल में)'}</strong>` +
    (emiPos ? ` (EMI ${emiPos})` : '') + ` के बारे में है।</p>`;
  const amountLine =
    `<p>EMI राशि: <strong>${p.emiAmount ?? '(राशि फ़ाइल में)'}</strong>` +
    (p.dueDate ? ` देय तिथि <strong>${p.dueDate}</strong>` : '') + `।</p>`;
  const footer = `<p style="color:#888;font-size:12px;">— TPE Customer Care</p>`;

  if (stage === 'due') {
    return greet + loanLine + amountLine +
      `<p><strong>भुगतान आज देय है।</strong> कृपया विलंब शुल्क से बचने के ` +
      `लिए यथाशीघ्र भुगतान पूरा करें।</p>` +
      payButton(p.payNowUrl, 'अभी EMI भुगतान करें') +
      footer;
  }
  if (stage === 'overdue') {
    return greet + loanLine + amountLine +
      `<p><strong>आपकी EMI बकाया है।</strong> विलंब शुल्क लागू हो गया है। ` +
      `कृपया आज भुगतान करें या भुगतान व्यवस्था के लिए ग्राहक सेवा से ` +
      `संपर्क करें।</p>` +
      payButton(p.payNowUrl, 'बकाया EMI चुकाएं') +
      footer;
  }
  // advance / reminder / grace share a softer Hi body
  return greet + loanLine + amountLine +
    `<p>कृपया देय तिथि से पहले भुगतान सुनिश्चित करें।</p>` +
    payButton(p.payNowUrl, 'EMI भुगतान करें') +
    footer;
}
