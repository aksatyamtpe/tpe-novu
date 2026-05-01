/**
 * PH-08 Assignment Paperwork — Policyholder Lifecycle.
 *
 * Charter §4.3.1 trigger spec:
 *   "Drive the policyholder through e-Sign of assignment documents (or
 *    physical paperwork fallback)."
 *   Channels: Email, WhatsApp, SMS — primary path is e-Sign link via email
 *             with WhatsApp + SMS nudges.
 *   Cadence:  e-Sign reminders at T+1 day and T+3 days after the initial send,
 *             then escalate to Operations (OPS-03) if still unsigned.
 *   Quiet hours: 21:00–09:00 IST suppressed for the reminders, NOT the initial
 *             send (which fires immediately on payload.status='requested').
 */
import { workflow } from '@novu/framework';
import { z } from 'zod';
import {
  tpeBasePayload, taggedAs, dispatch, dispatchOutput,
  templateEnvKeyFor, resolveTransactionId, pickByLocale, resolveLocale, inAppSkipUnlessEnabled,
} from '../../lib';

const SMS_TEMPLATE_ID = process.env[templateEnvKeyFor('PH-08', 'sms')] ?? '';
const WHATSAPP_TEMPLATE_NAME =
  process.env[templateEnvKeyFor('PH-08', 'whatsapp')] ?? 'dynamictemp2';

const REMINDER_DELAYS = {
  prod: { firstAt: { amount: 1, unit: 'days' as const },
          secondAt: { amount: 2, unit: 'days' as const } },
  test: { firstAt: { amount: 5, unit: 'seconds' as const },
          secondAt: { amount: 10, unit: 'seconds' as const } },
};

export const phAssignmentPaperwork = workflow(
  'ph-08-assignment-paperwork',
  async ({ step, payload, subscriber }) => {
    const wfId = 'ph-08-assignment-paperwork';
    const triggerId = 'PH-08';
    const audienceGroup = 'PH' as const;
    const txn = resolveTransactionId(payload);
    const locale = resolveLocale({ forceLocale: payload.forceLocale, subscriber });

    await step.inApp('inbox-esign-requested', async () => ({
      subject: pickByLocale(locale, {
        en: 'Sign the assignment documents',
        hi: 'असाइनमेंट दस्तावेज़ों पर हस्ताक्षर करें',
      }),
      body: pickByLocale(locale, {
        en: `Your assignment documents are ready. Click the e-Sign link in our ` +
            `email to complete the signing.`,
        hi: `आपके असाइनमेंट दस्तावेज़ तैयार हैं। हस्ताक्षर पूरा करने के लिए ` +
            `हमारे ईमेल में e-Sign लिंक पर क्लिक करें।`,
      }),
    }), { skip: inAppSkipUnlessEnabled });

    // Initial send — Email primary (carries the e-Sign link), WhatsApp nudge.
    await step.custom('email-esign-request', async () => dispatchOutput(
      await dispatch({
        channel: 'email', triggerId, audienceGroup, workflowId: wfId,
        transactionId: txn, subscriber, payload,
        content: { channel: 'email', email: {
          subject: pickByLocale(locale, {
            en: 'e-Sign required: assignment documents',
            hi: 'e-Sign आवश्यक: असाइनमेंट दस्तावेज़',
          }),
          htmlBody: pickByLocale(locale, {
            en: `<p>Hello${subscriber.firstName ? ' ' + subscriber.firstName : ''},</p>` +
                `<p>Your assignment documents for policy ` +
                `<strong>${payload.policyNumber ?? '(on file)'}</strong> are ready for e-Sign.</p>` +
                (payload.esignUrl
                  ? `<p><a href="${payload.esignUrl}" style="background:#0066cc;color:#fff;padding:10px 20px;text-decoration:none;border-radius:4px;">Open e-Sign portal</a></p>`
                  : `<p>e-Sign portal link will be sent shortly.</p>`) +
                `<p>If you'd prefer physical paperwork instead, reply to this email and ` +
                `our Operations team will switch the workflow.</p>` +
                `<p>This link expires in 7 days.</p>` +
                `<p style="color:#888;font-size:12px;">— TPE Customer Care</p>`,
            hi: `<p>नमस्ते${subscriber.firstName ? ' ' + subscriber.firstName : ''},</p>` +
                `<p>पॉलिसी <strong>${payload.policyNumber ?? '(फ़ाइल में)'}</strong> के ` +
                `असाइनमेंट दस्तावेज़ e-Sign के लिए तैयार हैं।</p>` +
                `<p style="color:#888;font-size:12px;">— TPE Customer Care</p>`,
          }),
        }},
      })));

    await step.custom('whatsapp-esign-request', async () => dispatchOutput(
      await dispatch({
        channel: 'whatsapp', triggerId, audienceGroup, workflowId: wfId,
        transactionId: txn, subscriber, payload,
        content: { channel: 'whatsapp', whatsapp: {
          templateName: WHATSAPP_TEMPLATE_NAME,
          languageCode: locale,
          buttonUrlParam: payload.esignToken ?? payload.policyNumber ?? 'esign',
          opaqueCallback: `ph-08:initial:${payload.policyNumber ?? 'no-policy'}`,
        }},
      })));

    // T+1 day reminder
    const cad = payload.testMode ? REMINDER_DELAYS.test : REMINDER_DELAYS.prod;
    await step.delay('wait-1d-or-test', async () => cad.firstAt);

    await step.custom('sms-esign-reminder-1d', async () => dispatchOutput(
      await dispatch({
        channel: 'sms', triggerId, audienceGroup, workflowId: wfId,
        transactionId: txn, subscriber, payload,
        content: { channel: 'sms', sms: {
          templateId: SMS_TEMPLATE_ID,
          vars: {
            var1: payload.policyNumber ?? '',
            policy: payload.policyNumber ?? '',
          },
        }},
      })));

    // T+3 day final reminder + flag for OPS escalation
    await step.delay('wait-2d-or-test', async () => cad.secondAt);

    await step.custom('email-esign-reminder-3d', async () => dispatchOutput(
      await dispatch({
        channel: 'email', triggerId, audienceGroup, workflowId: wfId,
        transactionId: txn, subscriber, payload,
        content: { channel: 'email', email: {
          subject: pickByLocale(locale, {
            en: 'Final reminder: e-Sign assignment documents',
            hi: 'अंतिम अनुस्मारक: e-Sign असाइनमेंट दस्तावेज़',
          }),
          htmlBody: pickByLocale(locale, {
            en: `<p>This is the final reminder. If you haven't signed by tomorrow, ` +
                `our Operations team will reach out by phone to assist or switch ` +
                `to physical paperwork.</p>` +
                (payload.esignUrl ? `<p><a href="${payload.esignUrl}">Open e-Sign portal</a></p>` : '') +
                `<p style="color:#888;font-size:12px;">— TPE Customer Care</p>`,
            hi: `<p>यह अंतिम अनुस्मारक है। यदि आपने कल तक हस्ताक्षर नहीं किए, तो ` +
                `हमारी ऑपरेशंस टीम फ़ोन पर संपर्क करेगी।</p>` +
                `<p style="color:#888;font-size:12px;">— TPE Customer Care</p>`,
          }),
        }},
      })));
  },
  {
    payloadSchema: tpeBasePayload.extend({
      status: z.enum(['requested', 'reminded', 'signed', 'escalated']).default('requested'),
      policyNumber: z.string().optional(),
      esignUrl: z.string().url().optional(),
      esignToken: z.string().optional(),
      ph_id: z.string().optional(),
      testMode: z.boolean().optional(),
    }),
    tags: taggedAs('PH', 'PH-08', 'transactional', 'esign', 'paperwork'),
  },
);
