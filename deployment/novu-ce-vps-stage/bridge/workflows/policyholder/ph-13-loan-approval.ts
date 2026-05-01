/**
 * PH-13 Loan Approval — Policyholder Lifecycle.
 *
 * Charter §4.3.1 trigger spec:
 *   "Communicate loan approval, conditional approval, or rejection."
 *   Channels: Email, WhatsApp, SMS — immediate.
 *   Cadence:  Single-shot per status transition.
 *   Quiet hours: NOT applied — status-change confirmation is transactional.
 *
 * Status branches (driven by `payload.status`):
 *   - "approved"     → "Loan approved" body
 *   - "conditional"  → "Conditional approval — additional docs required" body
 *   - "rejected"     → "Loan request not approved" body, with reason
 */
import { workflow } from '@novu/framework';
import { z } from 'zod';

import {
  tpeBasePayload, taggedAs, dispatch, dispatchOutput,
  templateEnvKeyFor, resolveTransactionId,
  pickByLocale, resolveLocale, inAppSkipUnlessEnabled,
} from '../../lib';

const SMS_TEMPLATE_ID = process.env[templateEnvKeyFor('PH-13', 'sms')] ?? '';
const WHATSAPP_TEMPLATE_NAME =
  process.env[templateEnvKeyFor('PH-13', 'whatsapp')] ?? 'dynamictemp2';

export const phLoanApproval = workflow(
  'ph-13-loan-approval',
  async ({ step, payload, subscriber }) => {
    const wfId = 'ph-13-loan-approval';
    const triggerId = 'PH-13';
    const audienceGroup = 'PH' as const;
    const txn = resolveTransactionId(payload);
    const locale = resolveLocale({ forceLocale: payload.forceLocale, subscriber });

    const statusLabel = pickByLocale(locale, {
      en: { approved: 'approved', conditional: 'conditionally approved', rejected: 'not approved' }[payload.status],
      hi: { approved: 'स्वीकृत', conditional: 'शर्त पर स्वीकृत', rejected: 'अस्वीकृत' }[payload.status],
    });

    await step.inApp('inbox-loan-status', async () => ({
      subject: pickByLocale(locale, {
        en: `Loan ${statusLabel}`,
        hi: `ऋण ${statusLabel}`,
      }),
      body: pickByLocale(locale, {
        en: `Your loan request for ${payload.loanAmount ?? 'the requested amount'} ` +
            `has been ${statusLabel}. ` +
            (payload.status === 'rejected' && payload.rejectionReason
              ? `Reason: ${payload.rejectionReason}.` : ''),
        hi: `आपका ${payload.loanAmount ?? 'अनुरोधित राशि'} का ऋण अनुरोध ` +
            `${statusLabel} किया गया है।`,
      }),
    }), { skip: inAppSkipUnlessEnabled });

    await step.custom('sms-loan-status', async () => dispatchOutput(
      await dispatch({
        channel: 'sms', triggerId, audienceGroup, workflowId: wfId,
        transactionId: txn, subscriber, payload,
        content: { channel: 'sms', sms: {
          templateId: SMS_TEMPLATE_ID,
          vars: { var1: statusLabel, status: payload.status, amount: payload.loanAmount ?? '' },
        }},
      })));

    await step.custom('whatsapp-loan-status', async () => dispatchOutput(
      await dispatch({
        channel: 'whatsapp', triggerId, audienceGroup, workflowId: wfId,
        transactionId: txn, subscriber, payload,
        content: { channel: 'whatsapp', whatsapp: {
          templateName: WHATSAPP_TEMPLATE_NAME,
          languageCode: locale,
          buttonUrlParam: payload.loanId ?? payload.ph_id ?? 'loan',
          opaqueCallback: `ph-13:${payload.status}:${payload.loanId ?? 'no-id'}`,
        }},
      })));

    await step.custom('email-loan-status', async () => dispatchOutput(
      await dispatch({
        channel: 'email', triggerId, audienceGroup, workflowId: wfId,
        transactionId: txn, subscriber, payload,
        content: { channel: 'email', email: {
          subject: pickByLocale(locale, {
            en: `Your TPE loan request: ${statusLabel}`,
            hi: `आपका TPE ऋण अनुरोध: ${statusLabel}`,
          }),
          htmlBody: pickByLocale(locale, {
            en: `<p>Hello${subscriber.firstName ? ' ' + subscriber.firstName : ''},</p>` +
                `<p>Your loan request for <strong>${payload.loanAmount ?? '(amount on file)'}</strong> ` +
                `has been <strong>${statusLabel}</strong>.</p>` +
                (payload.status === 'rejected' && payload.rejectionReason
                  ? `<p>Reason: ${payload.rejectionReason}</p>` : '') +
                (payload.status === 'conditional' && payload.conditions
                  ? `<p>Required to proceed: ${payload.conditions}</p>` : '') +
                `<p>Review next steps in your TPE dashboard.</p>` +
                `<p style="color:#888;font-size:12px;">— TPE Customer Care</p>`,
            hi: `<p>नमस्ते${subscriber.firstName ? ' ' + subscriber.firstName : ''},</p>` +
                `<p>आपका <strong>${payload.loanAmount ?? '(राशि फ़ाइल में)'}</strong> का ऋण अनुरोध ` +
                `<strong>${statusLabel}</strong> किया गया है।</p>` +
                `<p style="color:#888;font-size:12px;">— TPE Customer Care</p>`,
          }),
        }},
      })));
  },
  {
    payloadSchema: tpeBasePayload.extend({
      status: z.enum(['approved', 'conditional', 'rejected']),
      loanAmount: z.string().optional(),
      loanId: z.string().optional(),
      ph_id: z.string().optional(),
      rejectionReason: z.string().optional(),
      conditions: z.string().optional(),
    }),
    tags: taggedAs('PH', 'PH-13', 'transactional', 'loan'),
  },
);
