/**
 * INV-09 Premium Payment Confirmation — Investor Lifecycle.
 *
 * Charter §4.3.2 trigger spec:
 *   "Confirm a premium payment was processed to the underlying insurer."
 *   Channels: Email, WhatsApp — immediate.
 *   Cadence:  Single-shot.
 *   Pairs with INV-08 Premium Due — fires when the corresponding premium
 *             debit clears at the insurer side.
 *   Quiet hours: NOT applied — financial confirmation.
 *
 * Sender identity: TPE Investments (Charter §4.2 — Investor audience).
 *
 * Multi-tenant routing: this workflow CAN be insurer-context-aware (the
 * `payload.insurerId` field optionally drives sender identity for the
 * email From: header), but it isn't a hard requirement — a generic TPE
 * Investments sender is acceptable.
 */
import { workflow } from '@novu/framework';
import { z } from 'zod';

import {
  tpeBasePayload, taggedAs, dispatch, dispatchOutput,
  templateEnvKeyFor, resolveTransactionId,
  pickByLocale, resolveLocale, inAppSkipUnlessEnabled,
} from '../../lib';

const WHATSAPP_TEMPLATE_NAME =
  process.env[templateEnvKeyFor('INV-09', 'whatsapp')] ?? 'dynamictemp2';

export const invPremiumPaymentConfirmation = workflow(
  'inv-09-premium-payment-confirmation',
  async ({ step, payload, subscriber }) => {
    const wfId = 'inv-09-premium-payment-confirmation';
    const triggerId = 'INV-09';
    const audienceGroup = 'INV' as const;
    const txn = resolveTransactionId(payload);
    const locale = resolveLocale({ forceLocale: payload.forceLocale, subscriber });

    await step.inApp('inbox-premium-paid', async () => ({
      subject: pickByLocale(locale, {
        en: 'Premium payment confirmed',
        hi: 'प्रीमियम भुगतान की पुष्टि',
      }),
      body: pickByLocale(locale, {
        en: `Your premium payment of ${payload.amount ?? '(amount on file)'} ` +
            `for policy ${payload.policyNumber ?? '(on file)'} ` +
            `has been processed.`,
        hi: `आपकी पॉलिसी ${payload.policyNumber ?? '(फ़ाइल में)'} के लिए ` +
            `${payload.amount ?? '(राशि फ़ाइल में)'} का प्रीमियम भुगतान ` +
            `संसाधित हो गया है।`,
      }),
    }), { skip: inAppSkipUnlessEnabled });

    await step.custom('whatsapp-premium-paid', async () => dispatchOutput(
      await dispatch({
        channel: 'whatsapp', triggerId, audienceGroup, workflowId: wfId,
        transactionId: txn, subscriber, payload,
        content: { channel: 'whatsapp', whatsapp: {
          templateName: WHATSAPP_TEMPLATE_NAME,
          languageCode: locale,
          buttonUrlParam: payload.policyNumber ?? payload.investor_id ?? 'investment',
          opaqueCallback: `inv-09:${payload.policyNumber ?? 'no-policy'}:` +
                          `${payload.paymentId ?? 'no-payment-id'}`,
        }},
      })));

    await step.custom('email-premium-paid', async () => dispatchOutput(
      await dispatch({
        channel: 'email', triggerId, audienceGroup, workflowId: wfId,
        transactionId: txn, subscriber, payload,
        content: { channel: 'email', email: {
          subject: pickByLocale(locale, {
            en: `Premium payment confirmed — policy ${payload.policyNumber ?? ''}`,
            hi: `प्रीमियम भुगतान की पुष्टि — पॉलिसी ${payload.policyNumber ?? ''}`,
          }),
          htmlBody: pickByLocale(locale, {
            en: `<p>Hello${subscriber.firstName ? ' ' + subscriber.firstName : ''},</p>` +
                `<p>Premium payment of <strong>${payload.amount ?? '(amount on file)'}</strong> ` +
                `for policy <strong>${payload.policyNumber ?? '(on file)'}</strong> ` +
                `has been processed${payload.insurerName ? ' to ' + payload.insurerName : ''}.</p>` +
                (payload.paidAt
                  ? `<p>Date: ${payload.paidAt}</p>` : '') +
                (payload.utrNumber
                  ? `<p>Reference (UTR): ${payload.utrNumber}</p>` : '') +
                `<p>The next premium reminder will arrive ahead of the due date.</p>` +
                `<p style="color:#888;font-size:12px;">— TPE Investments</p>`,
            hi: `<p>नमस्ते${subscriber.firstName ? ' ' + subscriber.firstName : ''},</p>` +
                `<p>पॉलिसी <strong>${payload.policyNumber ?? '(फ़ाइल में)'}</strong> के लिए ` +
                `<strong>${payload.amount ?? '(राशि फ़ाइल में)'}</strong> का प्रीमियम ` +
                `संसाधित कर दिया गया है।</p>` +
                `<p style="color:#888;font-size:12px;">— TPE Investments</p>`,
          }),
        }},
      })));
  },
  {
    payloadSchema: tpeBasePayload.extend({
      amount: z.string().optional(),
      policyNumber: z.string().optional(),
      paidAt: z.string().optional(),
      utrNumber: z.string().optional(),
      paymentId: z.string().optional(),
      insurerName: z.string().optional(),
      investor_id: z.string().optional(),
    }),
    tags: taggedAs('INV', 'INV-09', 'transactional', 'premium', 'confirmation'),
  },
);
