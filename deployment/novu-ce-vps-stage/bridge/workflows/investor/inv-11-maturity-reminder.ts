/**
 * INV-11 Maturity Reminder — Investor Lifecycle.
 *
 * Charter §4.3.2 trigger spec:
 *   "Remind the investor that an underlying policy is approaching maturity,
 *    so they can decide between rollover, full payout, or partial."
 *   Channels: Email primary (decision form), WhatsApp + SMS nudges, in-app.
 *   Cadence: 5 named stages — heads_up(T-30) → reminder(T-7) → final(T-2)
 *            → today(T-0) → action_needed(T+3 if no decision yet).
 *   Quiet hours: applied to non-urgent stages.
 *
 * Why stage-as-payload (not step.delay): same reasoning as INV-08 / PH-15 —
 * upstream scheduler owns the calendar, each invocation is independent and
 * easy to cancel mid-cadence (e.g. when investor submits the rollover form).
 *
 * Sender identity: TPE Investments (Charter §4.2 — Investor audience).
 *
 * Pairs upstream with INV-12 Maturity Received: this workflow drives the
 * pre-event decision; INV-12 confirms the post-event payout/rollover.
 *
 * NOTE on stage names: maturity uses "heads_up / reminder / final / today /
 *      action_needed", NOT INV-08's premium-due "advance / reminder / due /
 *      grace / final" — different domain vocabulary so each cadence reads
 *      naturally in the audit feed.
 */
import { workflow } from '@novu/framework';
import { z } from 'zod';
import {
  tpeBasePayload, taggedAs, dispatch, dispatchOutput,
  templateEnvKeyFor, resolveTransactionId, pickByLocale, resolveLocale, inAppSkipUnlessEnabled,
} from '../../lib';

const SMS_TEMPLATE_ID = process.env[templateEnvKeyFor('INV-11', 'sms')] ?? '';
const WHATSAPP_TEMPLATE_NAME =
  process.env[templateEnvKeyFor('INV-11', 'whatsapp')] ?? 'dynamictemp2';

type Stage = 'heads_up' | 'reminder' | 'final' | 'today' | 'action_needed';

const STAGE_LABEL = {
  en: {
    heads_up:      'approaching',
    reminder:      'in 7 days',
    final:         'in 2 days',
    today:         'today',
    action_needed: 'awaiting your decision',
  },
  hi: {
    heads_up:      'निकट',
    reminder:      '7 दिनों में',
    final:         '2 दिनों में',
    today:         'आज',
    action_needed: 'आपके निर्णय की प्रतीक्षा',
  },
} as const satisfies Record<'en' | 'hi', Record<Stage, string>>;

const CHANNELS_FOR: Record<Stage, { sms: boolean; whatsapp: boolean; email: boolean }> = {
  heads_up:      { sms: false, whatsapp: false, email: true  },     // 30-day soft heads-up
  reminder:      { sms: false, whatsapp: true,  email: true  },     // 7-day nudge
  final:         { sms: true,  whatsapp: true,  email: true  },     // 2-day full fan-out
  today:         { sms: true,  whatsapp: true,  email: true  },     // maturity day
  action_needed: { sms: true,  whatsapp: false, email: true  },     // decision overdue
};

export const invMaturityReminder = workflow(
  'inv-11-maturity-reminder',
  async ({ step, payload, subscriber }) => {
    const wfId = 'inv-11-maturity-reminder';
    const triggerId = 'INV-11';
    const audienceGroup = 'INV' as const;
    const txn = resolveTransactionId(payload);
    const locale = resolveLocale({ forceLocale: payload.forceLocale, subscriber });

    // Discovery-phase guard — see channel-matrix-by-stage learning in
    // memory/phase1_status.md.
    const stage: Stage = (payload.stage as Stage) || 'reminder';
    const stageLabel = STAGE_LABEL[locale][stage] ?? STAGE_LABEL[locale].reminder;
    const channels = CHANNELS_FOR[stage] ?? CHANNELS_FOR.reminder;
    const _isUrgent = stage === 'today' || stage === 'action_needed';
    void _isUrgent;

    await step.inApp('inbox-maturity-reminder', async () => ({
      subject: pickByLocale(locale, {
        en: `Maturity ${stageLabel} — policy ${payload.policyNumber ?? ''}`,
        hi: `परिपक्वता ${stageLabel} — पॉलिसी ${payload.policyNumber ?? ''}`,
      }),
      body: pickByLocale(locale, {
        en: `Policy ${payload.policyNumber ?? '(on file)'} ` +
            `(maturity value ${payload.maturityValue ?? '(value on file)'}) ` +
            `is ${stageLabel}` +
            (payload.maturityDate ? ` — matures ${payload.maturityDate}` : '') + `. ` +
            `Choose rollover, full payout, or partial via the investor portal.`,
        hi: `पॉलिसी ${payload.policyNumber ?? '(फ़ाइल में)'} ` +
            `(परिपक्वता मूल्य ${payload.maturityValue ?? '(मूल्य फ़ाइल में)'}) ` +
            `${stageLabel}` +
            (payload.maturityDate ? ` — परिपक्वता ${payload.maturityDate}` : '') + `। ` +
            `निवेशक पोर्टल पर रोलओवर, पूर्ण भुगतान, या आंशिक चुनें।`,
      }),
    }), { skip: inAppSkipUnlessEnabled });

    await step.custom('sms-maturity-reminder', async () => {
      if (!channels.sms) {
        return dispatchOutput({
          ok: false, channel: 'sms', status: 'skipped',
          errorReason: `stage=${stage} excludes sms (channel matrix)`,
          locale,
        });
      }
      return dispatchOutput(await dispatch({
        channel: 'sms', triggerId, audienceGroup, workflowId: wfId,
        transactionId: txn, subscriber, payload,
        content: { channel: 'sms', sms: {
          templateId: SMS_TEMPLATE_ID,
          vars: {
            var1: stageLabel,
            stage,
            policy: payload.policyNumber ?? '',
            maturityDate: payload.maturityDate ?? '',
            maturityValue: payload.maturityValue ?? '',
          },
        }},
      }));
    });

    await step.custom('whatsapp-maturity-reminder', async () => {
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
            payload.decisionUrl ??
            payload.policyNumber ??
            payload.investor_id ??
            'maturity',
          opaqueCallback:
            `inv-11:${stage}:${payload.policyNumber ?? 'no-policy'}:` +
            `${payload.maturityDate ?? 'no-date'}`,
        }},
      }));
    });

    await step.custom('email-maturity-reminder', async () => {
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
      stage: z.enum(['heads_up', 'reminder', 'final', 'today', 'action_needed']),
      policyNumber: z.string(),
      maturityValue: z.string().optional(),
      maturityDate: z.string().optional(),
      insurerName: z.string().optional(),
      decisionUrl: z.string().url().optional(),
      investor_id: z.string().optional(),
    }),
    tags: taggedAs('INV', 'INV-11', 'transactional', 'maturity', 'reminder'),
  },
);

// ---------------------------------------------------------------------------
// Email subject + body builders — focused on rollover-vs-payout decision.
// ---------------------------------------------------------------------------

function emailSubject(lang: 'en' | 'hi', stage: Stage, policy?: string): string {
  const tag = policy ? ` — policy ${policy}` : '';
  if (lang === 'en') {
    if (stage === 'heads_up')      return `Policy approaching maturity${tag}`;
    if (stage === 'reminder')      return `Maturity in 7 days — choose your option${tag}`;
    if (stage === 'final')         return `Maturity in 2 days — decision needed${tag}`;
    if (stage === 'today')         return `Maturity today${tag}`;
    return `Action needed: maturity decision pending${tag}`;
  }
  const tagHi = policy ? ` — पॉलिसी ${policy}` : '';
  if (stage === 'heads_up')      return `पॉलिसी परिपक्वता निकट${tagHi}`;
  if (stage === 'reminder')      return `परिपक्वता 7 दिनों में — विकल्प चुनें${tagHi}`;
  if (stage === 'final')         return `परिपक्वता 2 दिनों में — निर्णय आवश्यक${tagHi}`;
  if (stage === 'today')         return `आज परिपक्वता${tagHi}`;
  return `कार्रवाई आवश्यक: परिपक्वता निर्णय लंबित${tagHi}`;
}

function decideButton(url?: string, label = 'Choose your option'): string {
  if (!url) return '';
  return `<p style="margin:16px 0;">` +
         `<a href="${url}" style="background:#1B3A5C;color:#fff;` +
         `padding:10px 22px;text-decoration:none;border-radius:4px;` +
         `display:inline-block;font-weight:500;">${label}</a></p>`;
}

function optionsBlock(lang: 'en' | 'hi'): string {
  if (lang === 'en') {
    return `<ul style="line-height:1.6;">` +
           `<li><strong>Rollover</strong> — reinvest the maturity proceeds into a new TPE-tracked policy.</li>` +
           `<li><strong>Full payout</strong> — receive the maturity amount to your registered bank account.</li>` +
           `<li><strong>Partial</strong> — split between payout and rollover.</li>` +
           `</ul>`;
  }
  return `<ul style="line-height:1.6;">` +
         `<li><strong>रोलओवर</strong> — परिपक्वता राशि को नई TPE-ट्रैक्ड पॉलिसी में पुनर्निवेश करें।</li>` +
         `<li><strong>पूर्ण भुगतान</strong> — पंजीकृत बैंक खाते में परिपक्वता राशि प्राप्त करें।</li>` +
         `<li><strong>आंशिक</strong> — भुगतान और रोलओवर के बीच बाँटें।</li>` +
         `</ul>`;
}

function emailBodyEn(stage: Stage, p: any, firstName?: string): string {
  const greet = `<p>Hello${firstName ? ' ' + firstName : ''},</p>`;
  const policyLine =
    `<p>The underlying policy <strong>${p.policyNumber ?? '(on file)'}</strong>` +
    (p.insurerName ? ` with ${p.insurerName}` : '') + ` is approaching maturity.</p>`;
  const valueLine =
    `<p>Maturity value: <strong>${p.maturityValue ?? '(value on file)'}</strong>` +
    (p.maturityDate ? ` — date <strong>${p.maturityDate}</strong>` : '') + `.</p>`;
  const footer = `<p style="color:#888;font-size:12px;">— TPE Investments</p>`;

  if (stage === 'heads_up') {
    return greet + policyLine + valueLine +
      `<p>This is a 30-day heads-up. You'll receive more reminders as ` +
      `the maturity date approaches. Your options:</p>` +
      optionsBlock('en') +
      decideButton(p.decisionUrl, 'Review options') +
      footer;
  }
  if (stage === 'reminder') {
    return greet + policyLine + valueLine +
      `<p>Maturity is <strong>7 days away</strong>. Please choose your option ` +
      `before the maturity date so we can execute on time.</p>` +
      optionsBlock('en') +
      decideButton(p.decisionUrl) +
      footer;
  }
  if (stage === 'final') {
    return greet + policyLine + valueLine +
      `<p>Maturity is <strong>2 days away</strong>. If no choice is registered ` +
      `by the maturity date, the proceeds will default to <strong>full payout</strong> ` +
      `to your registered bank account.</p>` +
      optionsBlock('en') +
      decideButton(p.decisionUrl, 'Choose now') +
      footer;
  }
  if (stage === 'today') {
    return greet + policyLine + valueLine +
      `<p><strong>The policy matures today.</strong> If you've already chosen ` +
      `your option, no further action is needed — INV-12 will confirm execution. ` +
      `If not, please decide within the next few hours.</p>` +
      decideButton(p.decisionUrl, 'Decide now') +
      footer;
  }
  // action_needed
  return greet + policyLine + valueLine +
    `<p><strong>The maturity date has passed without a registered decision.</strong> ` +
    `Per default, the proceeds are being processed as a full payout to your bank. ` +
    `If you wanted rollover or partial, please contact TPE Investments support today.</p>` +
    decideButton(p.decisionUrl, 'Update decision') +
    footer;
}

function emailBodyHi(stage: Stage, p: any, firstName?: string): string {
  const greet = `<p>नमस्ते${firstName ? ' ' + firstName : ''},</p>`;
  const policyLine =
    `<p>आधारभूत पॉलिसी <strong>${p.policyNumber ?? '(फ़ाइल में)'}</strong>` +
    (p.insurerName ? ` (${p.insurerName})` : '') + ` परिपक्वता के निकट है।</p>`;
  const valueLine =
    `<p>परिपक्वता मूल्य: <strong>${p.maturityValue ?? '(मूल्य फ़ाइल में)'}</strong>` +
    (p.maturityDate ? ` — तिथि <strong>${p.maturityDate}</strong>` : '') + `।</p>`;
  const footer = `<p style="color:#888;font-size:12px;">— TPE Investments</p>`;

  if (stage === 'today') {
    return greet + policyLine + valueLine +
      `<p><strong>पॉलिसी आज परिपक्व होती है।</strong> कृपया विकल्प चुनें ` +
      `या डिफ़ॉल्ट रूप से पूर्ण भुगतान निष्पादित होगा।</p>` +
      decideButton(p.decisionUrl, 'अभी निर्णय लें') +
      footer;
  }
  if (stage === 'action_needed') {
    return greet + policyLine + valueLine +
      `<p><strong>परिपक्वता तिथि बिना निर्णय के बीत गई है।</strong> राशि ` +
      `पूर्ण भुगतान के रूप में बैंक में संसाधित की जा रही है। यदि बदलाव चाहते ` +
      `हैं तो आज TPE Investments से संपर्क करें।</p>` +
      decideButton(p.decisionUrl, 'निर्णय अद्यतन करें') +
      footer;
  }
  // softer body for heads_up / reminder / final
  return greet + policyLine + valueLine +
    `<p>कृपया परिपक्वता तिथि से पहले अपना विकल्प चुनें।</p>` +
    optionsBlock('hi') +
    decideButton(p.decisionUrl, 'विकल्प चुनें') +
    footer;
}
