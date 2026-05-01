/**
 * PH-12 Loan Application — Policyholder Lifecycle.
 *
 * Charter §4.3.1 trigger spec:
 *   "Drive the policyholder through a policy-loan application."
 *   Channels: All four (Email, SMS, WhatsApp, RCS) — RCS not yet wired in v1,
 *             this workflow exercises the other three.
 *   Cadence:  Standard funnel — application received → verification in progress
 *             → approval (PH-13) handles the next stage.
 *   Quiet hours: applied to non-status-change reminders only.
 *
 * Status branches (driven by `payload.status`):
 *   - "received"      — application received, ack
 *   - "in-review"     — under verification
 *   - "info-required" — missing docs / clarifications needed
 */
import { workflow } from '@novu/framework';
import { z } from 'zod';
import {
  tpeBasePayload, taggedAs, dispatch, dispatchOutput,
  templateEnvKeyFor, resolveTransactionId, pickByLocale, resolveLocale, inAppSkipUnlessEnabled,
} from '../../lib';

const SMS_TEMPLATE_ID = process.env[templateEnvKeyFor('PH-12', 'sms')] ?? '';
const WHATSAPP_TEMPLATE_NAME =
  process.env[templateEnvKeyFor('PH-12', 'whatsapp')] ?? 'dynamictemp2';

export const phLoanApplication = workflow(
  'ph-12-loan-application',
  async ({ step, payload, subscriber }) => {
    const wfId = 'ph-12-loan-application';
    const triggerId = 'PH-12';
    const audienceGroup = 'PH' as const;
    const txn = resolveTransactionId(payload);
    const locale = resolveLocale({ forceLocale: payload.forceLocale, subscriber });

    const statusLabel = pickByLocale(locale, {
      en: { received: 'received', 'in-review': 'under review', 'info-required': 'awaiting more information' }[payload.status],
      hi: { received: 'प्राप्त', 'in-review': 'समीक्षाधीन', 'info-required': 'अधिक जानकारी की प्रतीक्षा में' }[payload.status],
    });

    await step.inApp('inbox-loan-application', async () => ({
      subject: pickByLocale(locale, {
        en: `Loan application ${statusLabel}`,
        hi: `ऋण आवेदन ${statusLabel}`,
      }),
      body: pickByLocale(locale, {
        en: `Your loan application for ${payload.requestedAmount ?? 'the requested amount'} ` +
            `is ${statusLabel}.` +
            (payload.status === 'info-required' && payload.missingItems
              ? ` Missing: ${payload.missingItems}.` : ''),
        hi: `${payload.requestedAmount ?? 'अनुरोधित राशि'} के लिए आपका ऋण आवेदन ` +
            `${statusLabel} है।`,
      }),
    }), { skip: inAppSkipUnlessEnabled });

    await step.custom('sms-loan-application', async () => dispatchOutput(
      await dispatch({
        channel: 'sms', triggerId, audienceGroup, workflowId: wfId,
        transactionId: txn, subscriber, payload,
        content: { channel: 'sms', sms: {
          templateId: SMS_TEMPLATE_ID,
          vars: {
            var1: statusLabel,
            status: payload.status,
            amount: payload.requestedAmount ?? '',
            applicationId: payload.applicationId ?? '',
          },
        }},
      })));

    await step.custom('whatsapp-loan-application', async () => dispatchOutput(
      await dispatch({
        channel: 'whatsapp', triggerId, audienceGroup, workflowId: wfId,
        transactionId: txn, subscriber, payload,
        content: { channel: 'whatsapp', whatsapp: {
          templateName: WHATSAPP_TEMPLATE_NAME,
          languageCode: locale,
          buttonUrlParam: payload.applicationId ?? payload.ph_id ?? 'loan-app',
          opaqueCallback: `ph-12:${payload.status}:${payload.applicationId ?? 'no-id'}`,
        }},
      })));

    await step.custom('email-loan-application', async () => dispatchOutput(
      await dispatch({
        channel: 'email', triggerId, audienceGroup, workflowId: wfId,
        transactionId: txn, subscriber, payload,
        content: { channel: 'email', email: {
          subject: pickByLocale(locale, {
            en: `Loan application: ${statusLabel}`,
            hi: `ऋण आवेदन: ${statusLabel}`,
          }),
          htmlBody: pickByLocale(locale, {
            en: `<p>Hello${subscriber.firstName ? ' ' + subscriber.firstName : ''},</p>` +
                `<p>Your loan application for <strong>${payload.requestedAmount ?? '(amount on file)'}</strong> ` +
                `is currently <strong>${statusLabel}</strong>.</p>` +
                (payload.status === 'info-required' && payload.missingItems
                  ? `<p>Items still needed:</p><ul><li>${payload.missingItems.split(',').join('</li><li>')}</li></ul>` : '') +
                (payload.status === 'in-review' && payload.expectedDecisionDays
                  ? `<p>Expected decision: ${payload.expectedDecisionDays} working days from receipt.</p>` : '') +
                `<p>You'll get a separate notification when the decision is made (PH-13).</p>` +
                `<p style="color:#888;font-size:12px;">— TPE Customer Care</p>`,
            hi: `<p>नमस्ते${subscriber.firstName ? ' ' + subscriber.firstName : ''},</p>` +
                `<p><strong>${payload.requestedAmount ?? '(राशि फ़ाइल में)'}</strong> के लिए ` +
                `आपका ऋण आवेदन वर्तमान में <strong>${statusLabel}</strong> है।</p>` +
                `<p style="color:#888;font-size:12px;">— TPE Customer Care</p>`,
          }),
        }},
      })));
  },
  {
    payloadSchema: tpeBasePayload.extend({
      status: z.enum(['received', 'in-review', 'info-required']).default('received'),
      requestedAmount: z.string().optional(),
      applicationId: z.string().optional(),
      missingItems: z.string().optional(),
      expectedDecisionDays: z.number().optional(),
      ph_id: z.string().optional(),
    }),
    tags: taggedAs('PH', 'PH-12', 'transactional', 'loan', 'application'),
  },
);
