/**
 * INV-12 Maturity Received — Investor Lifecycle.
 *
 * Charter §4.3.2 trigger spec:
 *   "Confirm maturity proceeds received from insurer and settlement to investor."
 *   Channels: SMS, Email, WhatsApp — immediate.
 *   Cadence:  Single-shot.
 *   Quiet hours: NOT applied — settlement is a financial confirmation event;
 *                investor wants to know the moment funds land regardless of hour.
 *
 * Sender identity: TPE Investments.
 *
 * Two-stage event in real life — (1) insurer disbursed maturity proceeds to
 * TPE escrow, (2) TPE settled to investor's bank. The Charter spec treats
 * stage (2) as the trigger; payload.stage flips body content if needed.
 */
import { workflow } from '@novu/framework';
import { z } from 'zod';

import {
  tpeBasePayload, taggedAs, dispatch, dispatchOutput,
  templateEnvKeyFor, resolveTransactionId,
  pickByLocale, resolveLocale, inAppSkipUnlessEnabled,
} from '../../lib';

const SMS_TEMPLATE_ID = process.env[templateEnvKeyFor('INV-12', 'sms')] ?? '';
const WHATSAPP_TEMPLATE_NAME =
  process.env[templateEnvKeyFor('INV-12', 'whatsapp')] ?? 'dynamictemp2';

export const invMaturityReceived = workflow(
  'inv-12-maturity-received',
  async ({ step, payload, subscriber }) => {
    const wfId = 'inv-12-maturity-received';
    const triggerId = 'INV-12';
    const audienceGroup = 'INV' as const;
    const txn = resolveTransactionId(payload);
    const locale = resolveLocale({ forceLocale: payload.forceLocale, subscriber });

    const stageLabel = pickByLocale(locale, {
      en: payload.stage === 'received-from-insurer'
            ? 'received from the insurer'
            : 'settled to your bank account',
      hi: payload.stage === 'received-from-insurer'
            ? 'बीमाकर्ता से प्राप्त हुआ'
            : 'आपके बैंक खाते में जमा कर दिया गया',
    });

    await step.inApp('inbox-maturity', async () => ({
      subject: pickByLocale(locale, {
        en: 'Maturity proceeds received',
        hi: 'परिपक्वता राशि प्राप्त',
      }),
      body: pickByLocale(locale, {
        en: `Maturity proceeds of ${payload.amount ?? '(amount on file)'} ` +
            `for policy ${payload.policyNumber ?? '(on file)'} ` +
            `have been ${stageLabel}.`,
        hi: `पॉलिसी ${payload.policyNumber ?? '(फ़ाइल में)'} की ` +
            `${payload.amount ?? '(राशि फ़ाइल में)'} परिपक्वता राशि ${stageLabel}।`,
      }),
    }), { skip: inAppSkipUnlessEnabled });

    await step.custom('sms-maturity', async () => dispatchOutput(
      await dispatch({
        channel: 'sms', triggerId, audienceGroup, workflowId: wfId,
        transactionId: txn, subscriber, payload,
        content: { channel: 'sms', sms: {
          templateId: SMS_TEMPLATE_ID,
          vars: {
            var1: payload.amount ?? '',
            amount: payload.amount ?? '',
            policy: payload.policyNumber ?? '',
            bankLast4: payload.bankLast4 ?? '',
          },
        }},
      })));

    await step.custom('whatsapp-maturity', async () => dispatchOutput(
      await dispatch({
        channel: 'whatsapp', triggerId, audienceGroup, workflowId: wfId,
        transactionId: txn, subscriber, payload,
        content: { channel: 'whatsapp', whatsapp: {
          templateName: WHATSAPP_TEMPLATE_NAME,
          languageCode: locale,
          buttonUrlParam: payload.policyNumber ?? payload.investor_id ?? 'maturity',
          opaqueCallback: `inv-12:${payload.policyNumber ?? 'no-policy'}:` +
                          `${payload.stage ?? 'settled'}`,
        }},
      })));

    await step.custom('email-maturity', async () => dispatchOutput(
      await dispatch({
        channel: 'email', triggerId, audienceGroup, workflowId: wfId,
        transactionId: txn, subscriber, payload,
        content: { channel: 'email', email: {
          subject: pickByLocale(locale, {
            en: `Maturity proceeds — policy ${payload.policyNumber ?? ''}`,
            hi: `परिपक्वता राशि — पॉलिसी ${payload.policyNumber ?? ''}`,
          }),
          htmlBody: pickByLocale(locale, {
            en: `<p>Hello${subscriber.firstName ? ' ' + subscriber.firstName : ''},</p>` +
                `<p>Maturity proceeds of <strong>${payload.amount ?? '(amount on file)'}</strong> ` +
                `for policy <strong>${payload.policyNumber ?? '(on file)'}</strong> ` +
                `have been <strong>${stageLabel}</strong>.</p>` +
                (payload.bankLast4
                  ? `<p>Account: ****${payload.bankLast4}</p>` : '') +
                (payload.utrNumber
                  ? `<p>Reference (UTR): ${payload.utrNumber}</p>` : '') +
                (payload.taxDocsAvailable
                  ? `<p>Form 16A and other tax documents will be issued ` +
                    `quarterly per the regulator schedule (see INV-14).</p>` : '') +
                `<p style="color:#888;font-size:12px;">— TPE Investments</p>`,
            hi: `<p>नमस्ते${subscriber.firstName ? ' ' + subscriber.firstName : ''},</p>` +
                `<p>पॉलिसी <strong>${payload.policyNumber ?? '(फ़ाइल में)'}</strong> की ` +
                `<strong>${payload.amount ?? '(राशि फ़ाइल में)'}</strong> ` +
                `परिपक्वता राशि <strong>${stageLabel}</strong>।</p>` +
                `<p style="color:#888;font-size:12px;">— TPE Investments</p>`,
          }),
        }},
      })));
  },
  {
    payloadSchema: tpeBasePayload.extend({
      stage: z.enum(['received-from-insurer', 'settled-to-investor']).default('settled-to-investor'),
      amount: z.string().optional(),
      policyNumber: z.string().optional(),
      bankLast4: z.string().optional(),
      utrNumber: z.string().optional(),
      taxDocsAvailable: z.boolean().optional(),
      investor_id: z.string().optional(),
    }),
    tags: taggedAs('INV', 'INV-12', 'transactional', 'maturity', 'settlement'),
  },
);
