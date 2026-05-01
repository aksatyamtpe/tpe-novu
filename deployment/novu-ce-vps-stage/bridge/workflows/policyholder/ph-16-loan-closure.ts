/**
 * PH-16 Loan Closure — Policyholder Lifecycle.
 *
 * Charter §4.3.1 trigger spec:
 *   "Notify the policyholder that their loan account has been closed
 *    (final EMI paid, NOC issued)."
 *   Channels: Email primary (NOC attachment), WhatsApp + in-app nudges,
 *             SMS for the closure SMS receipt.
 *   Cadence:  Single-shot. Not a multi-stage trigger.
 *   Quiet hours: NOT applied — financial closure is good news; user wants
 *                to hear immediately.
 *
 * This is the final-state trigger of the loan track:
 *   PH-12 (application) → PH-13 (approval) → PH-14 (disbursement)
 *                       → PH-15 (EMI reminders) → **PH-16 (closure)**
 *
 * Sender identity: TPE Customer Care (Charter §4.2 — Policyholder audience).
 *
 * Tone: celebratory but practical. The body emphasises (a) the loan is
 *       closed, (b) NOC has been issued, (c) the underlying policy is
 *       no longer encumbered.
 */
import { workflow } from '@novu/framework';
import { z } from 'zod';
import {
  tpeBasePayload, taggedAs, dispatch, dispatchOutput,
  templateEnvKeyFor, resolveTransactionId, pickByLocale, resolveLocale, inAppSkipUnlessEnabled,
} from '../../lib';

const SMS_TEMPLATE_ID = process.env[templateEnvKeyFor('PH-16', 'sms')] ?? '';
const WHATSAPP_TEMPLATE_NAME =
  process.env[templateEnvKeyFor('PH-16', 'whatsapp')] ?? 'dynamictemp2';

export const phLoanClosure = workflow(
  'ph-16-loan-closure',
  async ({ step, payload, subscriber }) => {
    const wfId = 'ph-16-loan-closure';
    const triggerId = 'PH-16';
    const audienceGroup = 'PH' as const;
    const txn = resolveTransactionId(payload);
    const locale = resolveLocale({ forceLocale: payload.forceLocale, subscriber });

    await step.inApp('inbox-loan-closed', async () => ({
      subject: pickByLocale(locale, {
        en: `Loan closed — ${payload.loanAccount ?? ''}`,
        hi: `ऋण बंद — ${payload.loanAccount ?? ''}`,
      }),
      body: pickByLocale(locale, {
        en: `Your loan ${payload.loanAccount ?? '(on file)'} has been ` +
            `fully repaid and the account is now closed. The No-Objection ` +
            `Certificate (NOC) has been issued.`,
        hi: `आपका ऋण ${payload.loanAccount ?? '(फ़ाइल में)'} पूरी तरह से चुका ` +
            `दिया गया है और खाता बंद कर दिया गया है। NOC जारी कर दिया गया है।`,
      }),
    }), { skip: inAppSkipUnlessEnabled });

    await step.custom('sms-loan-closed', async () => dispatchOutput(
      await dispatch({
        channel: 'sms', triggerId, audienceGroup, workflowId: wfId,
        transactionId: txn, subscriber, payload,
        content: { channel: 'sms', sms: {
          templateId: SMS_TEMPLATE_ID,
          vars: {
            var1: payload.loanAccount ?? '',
            loan: payload.loanAccount ?? '',
            closedAt: payload.closedAt ?? '',
          },
        }},
      })));

    await step.custom('whatsapp-loan-closed', async () => dispatchOutput(
      await dispatch({
        channel: 'whatsapp', triggerId, audienceGroup, workflowId: wfId,
        transactionId: txn, subscriber, payload,
        content: { channel: 'whatsapp', whatsapp: {
          templateName: WHATSAPP_TEMPLATE_NAME,
          languageCode: locale,
          buttonUrlParam:
            payload.nocUrl ??
            payload.loanAccount ??
            payload.ph_id ??
            'loan-closed',
          opaqueCallback: `ph-16:closed:${payload.loanAccount ?? 'no-loan'}`,
        }},
      })));

    await step.custom('email-loan-closed', async () => dispatchOutput(
      await dispatch({
        channel: 'email', triggerId, audienceGroup, workflowId: wfId,
        transactionId: txn, subscriber, payload,
        content: { channel: 'email', email: {
          subject: pickByLocale(locale, {
            en: `Your loan is closed — NOC issued`,
            hi: `आपका ऋण बंद है — NOC जारी`,
          }),
          htmlBody: pickByLocale(locale, {
            en: `<p>Hello${subscriber.firstName ? ' ' + subscriber.firstName : ''},</p>` +
                `<p>Congratulations — your loan ` +
                `<strong>${payload.loanAccount ?? '(on file)'}</strong> has been ` +
                `fully repaid and the account is now closed.</p>` +
                (payload.totalRepaid
                  ? `<p>Total amount repaid: <strong>${payload.totalRepaid}</strong></p>` : '') +
                (payload.closedAt
                  ? `<p>Closure date: <strong>${payload.closedAt}</strong></p>` : '') +
                `<p>The No-Objection Certificate (NOC) has been issued. The ` +
                `underlying policy is no longer encumbered, and the original ` +
                `assignee has been formally released.</p>` +
                (payload.nocUrl
                  ? `<p style="margin:16px 0;">` +
                    `<a href="${payload.nocUrl}" style="background:#1B3A5C;color:#fff;` +
                    `padding:10px 22px;text-decoration:none;border-radius:4px;` +
                    `display:inline-block;font-weight:500;">Download NOC</a></p>`
                  : `<p>The NOC document will be sent to your registered email separately.</p>`) +
                `<p>Thank you for completing your obligations on time. ` +
                `If you'd like to start a new loan against another policy, ` +
                `the application form is available in your portal.</p>` +
                `<p style="color:#888;font-size:12px;">— TPE Customer Care</p>`,
            hi: `<p>नमस्ते${subscriber.firstName ? ' ' + subscriber.firstName : ''},</p>` +
                `<p>बधाई हो — आपका ऋण ` +
                `<strong>${payload.loanAccount ?? '(फ़ाइल में)'}</strong> पूरी तरह ` +
                `चुका दिया गया है और खाता बंद कर दिया गया है।</p>` +
                `<p>NOC जारी कर दिया गया है और आधारभूत पॉलिसी अब ` +
                `मुक्त है।</p>` +
                `<p style="color:#888;font-size:12px;">— TPE ग्राहक सेवा</p>`,
          }),
        }},
      })));
  },
  {
    payloadSchema: tpeBasePayload.extend({
      loanAccount: z.string(),
      totalRepaid: z.string().optional(),
      closedAt: z.string().optional(),
      nocUrl: z.string().url().optional(),
      ph_id: z.string().optional(),
    }),
    tags: taggedAs('PH', 'PH-16', 'transactional', 'loan', 'closure'),
  },
);
