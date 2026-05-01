/**
 * INV-07 Investment Confirmed — Investor Lifecycle.
 *
 * Charter §4.3.2 trigger spec:
 *   "Confirm assignment is in progress and then confirm completion with
 *    certificate issuance."
 *   Channels: Email (primary, with assignment letter / certificate attachment),
 *             WhatsApp (concise nudge with download link).
 *   Cadence:  Single-shot per stage. Two stages controlled by `payload.stage`:
 *               'in-progress'   — assignment has begun
 *               'completed'     — certificate issued, settled
 *   Quiet hours: NOT applied — investor wants the moment-of-confirmation send.
 */
import { workflow } from '@novu/framework';
import { z } from 'zod';
import {
  tpeBasePayload, taggedAs, dispatch, dispatchOutput,
  templateEnvKeyFor, resolveTransactionId, pickByLocale, resolveLocale, inAppSkipUnlessEnabled,
} from '../../lib';

const WHATSAPP_TEMPLATE_NAME =
  process.env[templateEnvKeyFor('INV-07', 'whatsapp')] ?? 'dynamictemp2';

export const invInvestmentConfirmed = workflow(
  'inv-07-investment-confirmed',
  async ({ step, payload, subscriber }) => {
    const wfId = 'inv-07-investment-confirmed';
    const triggerId = 'INV-07';
    const audienceGroup = 'INV' as const;
    const txn = resolveTransactionId(payload);
    const locale = resolveLocale({ forceLocale: payload.forceLocale, subscriber });

    const stageLabel = pickByLocale(locale, {
      en: payload.stage === 'in-progress'
            ? 'in progress'
            : 'confirmed and the certificate is ready',
      hi: payload.stage === 'in-progress'
            ? 'प्रगति पर है'
            : 'पुष्टि हो गई है और प्रमाणपत्र तैयार है',
    });

    await step.inApp('inbox-investment-confirmed', async () => ({
      subject: pickByLocale(locale, {
        en: payload.stage === 'in-progress'
              ? 'Assignment in progress'
              : 'Investment confirmed — certificate ready',
        hi: payload.stage === 'in-progress'
              ? 'असाइनमेंट प्रगति पर है'
              : 'निवेश पुष्ट — प्रमाणपत्र तैयार',
      }),
      body: pickByLocale(locale, {
        en: `Your investment of ${payload.investAmount ?? '(amount on file)'} ` +
            `in policy ${payload.policyNumber ?? '(on file)'} ` +
            `is ${stageLabel}.`,
        hi: `पॉलिसी ${payload.policyNumber ?? '(फ़ाइल में)'} में आपका ` +
            `${payload.investAmount ?? '(राशि फ़ाइल में)'} का निवेश ${stageLabel}।`,
      }),
    }), { skip: inAppSkipUnlessEnabled });

    await step.custom('whatsapp-investment-confirmed', async () => dispatchOutput(
      await dispatch({
        channel: 'whatsapp', triggerId, audienceGroup, workflowId: wfId,
        transactionId: txn, subscriber, payload,
        content: { channel: 'whatsapp', whatsapp: {
          templateName: WHATSAPP_TEMPLATE_NAME,
          languageCode: locale,
          buttonUrlParam: payload.policyNumber ?? payload.investor_id ?? 'investment',
          opaqueCallback: `inv-07:${payload.stage}:${payload.policyNumber ?? 'no-policy'}`,
        }},
      })));

    await step.custom('email-investment-confirmed', async () => dispatchOutput(
      await dispatch({
        channel: 'email', triggerId, audienceGroup, workflowId: wfId,
        transactionId: txn, subscriber, payload,
        content: { channel: 'email', email: {
          subject: pickByLocale(locale, {
            en: payload.stage === 'in-progress'
                  ? `Assignment in progress — ${payload.policyNumber ?? ''}`
                  : `Investment confirmed — ${payload.policyNumber ?? ''}`,
            hi: payload.stage === 'in-progress'
                  ? `असाइनमेंट प्रगति पर — ${payload.policyNumber ?? ''}`
                  : `निवेश पुष्ट — ${payload.policyNumber ?? ''}`,
          }),
          htmlBody: pickByLocale(locale, {
            en: `<p>Hello${subscriber.firstName ? ' ' + subscriber.firstName : ''},</p>` +
                `<p>Your investment of <strong>${payload.investAmount ?? '(amount on file)'}</strong> ` +
                `in policy <strong>${payload.policyNumber ?? '(on file)'}</strong> ` +
                `is <strong>${stageLabel}</strong>.</p>` +
                (payload.stage === 'completed' && payload.certificateUrl
                  ? `<p>Download your investment certificate: ` +
                    `<a href="${payload.certificateUrl}">Investment Certificate</a></p>` : '') +
                (payload.stage === 'in-progress' && payload.expectedCompletionDays
                  ? `<p>Expected completion: ${payload.expectedCompletionDays} working days.</p>` : '') +
                `<p>Your premium reminders for this policy will start on the next ` +
                `due-date cycle (INV-08).</p>` +
                `<p style="color:#888;font-size:12px;">— TPE Investments</p>`,
            hi: `<p>नमस्ते${subscriber.firstName ? ' ' + subscriber.firstName : ''},</p>` +
                `<p>पॉलिसी <strong>${payload.policyNumber ?? '(फ़ाइल में)'}</strong> में ` +
                `आपका <strong>${payload.investAmount ?? '(राशि फ़ाइल में)'}</strong> ` +
                `का निवेश <strong>${stageLabel}</strong>।</p>` +
                `<p style="color:#888;font-size:12px;">— TPE Investments</p>`,
          }),
        }},
      })));
  },
  {
    payloadSchema: tpeBasePayload.extend({
      stage: z.enum(['in-progress', 'completed']).default('completed'),
      investAmount: z.string().optional(),
      policyNumber: z.string().optional(),
      certificateUrl: z.string().url().optional(),
      expectedCompletionDays: z.number().optional(),
      investor_id: z.string().optional(),
    }),
    tags: taggedAs('INV', 'INV-07', 'transactional', 'investment', 'confirmation'),
  },
);
