/**
 * INV-05 Investment Soft-Commit — Investor Lifecycle.
 *
 * Charter §4.3.2 trigger spec:
 *   "Acknowledge investor's expression of interest and surface next steps."
 *   Channels: Email, WhatsApp — immediate.
 *   Cadence:  Single-shot.
 *   Quiet hours: NOT applied — interest-acknowledgement should land same-second.
 *
 * Sender identity: TPE Investments.
 *
 * Funnel relationship: pairs with INV-06 Funds Collection — INV-05 acknowledges
 * the soft-commit, INV-06 drives the actual funding flow with cadence.
 */
import { workflow } from '@novu/framework';
import { z } from 'zod';
import {
  tpeBasePayload, taggedAs, dispatch, dispatchOutput,
  templateEnvKeyFor, resolveTransactionId, pickByLocale, resolveLocale, inAppSkipUnlessEnabled,
} from '../../lib';

const WHATSAPP_TEMPLATE_NAME =
  process.env[templateEnvKeyFor('INV-05', 'whatsapp')] ?? 'dynamictemp2';

export const invInvestmentSoftCommit = workflow(
  'inv-05-investment-soft-commit',
  async ({ step, payload, subscriber }) => {
    const wfId = 'inv-05-investment-soft-commit';
    const triggerId = 'INV-05';
    const audienceGroup = 'INV' as const;
    const txn = resolveTransactionId(payload);
    const locale = resolveLocale({ forceLocale: payload.forceLocale, subscriber });

    await step.inApp('inbox-soft-commit', async () => ({
      subject: pickByLocale(locale, {
        en: 'We received your interest',
        hi: 'हमें आपकी रुचि प्राप्त हुई',
      }),
      body: pickByLocale(locale, {
        en: `Thanks for committing ${payload.commitAmount ?? '(amount on file)'} ` +
            `to ${payload.opportunityName ?? 'this investment'}. ` +
            `We'll surface the funding window next.`,
        hi: `${payload.opportunityName ?? 'इस निवेश'} में ` +
            `${payload.commitAmount ?? '(राशि फ़ाइल में)'} की प्रतिबद्धता के लिए धन्यवाद। ` +
            `हम जल्द ही फंडिंग विवरण साझा करेंगे।`,
      }),
    }), { skip: inAppSkipUnlessEnabled });

    await step.custom('whatsapp-soft-commit', async () => dispatchOutput(
      await dispatch({
        channel: 'whatsapp', triggerId, audienceGroup, workflowId: wfId,
        transactionId: txn, subscriber, payload,
        content: { channel: 'whatsapp', whatsapp: {
          templateName: WHATSAPP_TEMPLATE_NAME,
          languageCode: locale,
          buttonUrlParam: payload.commitId ?? payload.investor_id ?? 'commit',
          opaqueCallback: `inv-05:${payload.commitId ?? 'no-id'}`,
        }},
      })));

    await step.custom('email-soft-commit', async () => dispatchOutput(
      await dispatch({
        channel: 'email', triggerId, audienceGroup, workflowId: wfId,
        transactionId: txn, subscriber, payload,
        content: { channel: 'email', email: {
          subject: pickByLocale(locale, {
            en: `Soft-commit acknowledged — ${payload.opportunityName ?? 'investment'}`,
            hi: `सॉफ्ट-कमिट स्वीकृत — ${payload.opportunityName ?? 'निवेश'}`,
          }),
          htmlBody: pickByLocale(locale, {
            en: `<p>Hello${subscriber.firstName ? ' ' + subscriber.firstName : ''},</p>` +
                `<p>We've recorded your interest in <strong>${payload.opportunityName ?? '(opportunity on file)'}</strong> ` +
                `for <strong>${payload.commitAmount ?? '(amount on file)'}</strong>.</p>` +
                (payload.expectedYield
                  ? `<p>Expected yield: ${payload.expectedYield}</p>` : '') +
                `<p>You'll receive a funding-window notification (INV-06) within ` +
                `${payload.fundingWindowHours ?? '24'} hours. The committed amount is reserved ` +
                `until then; if funds are not received in time, the soft-commit is released.</p>` +
                `<p style="color:#888;font-size:12px;">— TPE Investments</p>`,
            hi: `<p>नमस्ते${subscriber.firstName ? ' ' + subscriber.firstName : ''},</p>` +
                `<p>हमने <strong>${payload.opportunityName ?? '(अवसर फ़ाइल में)'}</strong> ` +
                `में आपकी <strong>${payload.commitAmount ?? '(राशि फ़ाइल में)'}</strong> ` +
                `की रुचि दर्ज कर ली है।</p>` +
                `<p>आपको ${payload.fundingWindowHours ?? '24'} घंटों के भीतर फंडिंग विंडो ` +
                `सूचना मिलेगी। प्रतिबद्ध राशि तब तक आरक्षित है।</p>` +
                `<p style="color:#888;font-size:12px;">— TPE Investments</p>`,
          }),
        }},
      })));
  },
  {
    payloadSchema: tpeBasePayload.extend({
      opportunityName: z.string().optional(),
      commitAmount: z.string().optional(),
      commitId: z.string().optional(),
      expectedYield: z.string().optional(),
      fundingWindowHours: z.number().optional(),
      investor_id: z.string().optional(),
    }),
    tags: taggedAs('INV', 'INV-05', 'transactional', 'investment', 'soft-commit'),
  },
);
