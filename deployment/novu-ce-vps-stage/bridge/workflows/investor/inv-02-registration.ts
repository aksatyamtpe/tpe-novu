/**
 * INV-02 Registration — Investor Lifecycle.
 *
 * Charter §4.3.2 trigger spec:
 *   "Drive investor through registration and account verification."
 *   Channels: Email, SMS, WhatsApp — same shape as PH-02 but with TPE
 *             Investments sender identity and investor-flavored copy.
 *   Cadence:  OTP immediate (10-min validity); abandoned reminders 1h/24h/72h
 *             after OTP Sent without Verified.
 *
 * Stage testing: pass `payload.testMode = true` to collapse delays.
 */
import { workflow } from '@novu/framework';
import { z } from 'zod';
import {
  tpeBasePayload, taggedAs, dispatch, dispatchOutput,
  templateEnvKeyFor, resolveTransactionId, pickByLocale, resolveLocale, inAppSkipUnlessEnabled,
} from '../../lib';

const SMS_TEMPLATE_ID =
  process.env[templateEnvKeyFor('INV-02', 'sms')]
  ?? process.env.MSG91_OTP_TEMPLATE_ID
  ?? '';
const WHATSAPP_TEMPLATE_NAME =
  process.env[templateEnvKeyFor('INV-02', 'whatsapp')] ?? 'dynamictemp2';

const REMINDER_DELAYS = {
  prod: { firstAt: { amount: 1, unit: 'hours' as const },
          secondAt: { amount: 24, unit: 'hours' as const },
          thirdAt:  { amount: 72, unit: 'hours' as const } },
  test: { firstAt: { amount: 5, unit: 'seconds' as const },
          secondAt: { amount: 10, unit: 'seconds' as const },
          thirdAt:  { amount: 15, unit: 'seconds' as const } },
};

export const invRegistration = workflow(
  'inv-02-registration',
  async ({ step, payload, subscriber }) => {
    const wfId = 'inv-02-registration';
    const triggerId = 'INV-02';
    const audienceGroup = 'INV' as const;
    const txn = resolveTransactionId(payload);
    const locale = resolveLocale({ forceLocale: payload.forceLocale, subscriber });

    await step.inApp('inbox-otp-sent', async () => ({
      subject: pickByLocale(locale, {
        en: 'Verify your TPE Investments account',
        hi: 'अपने TPE Investments खाते को सत्यापित करें',
      }),
      body: pickByLocale(locale, {
        en: `Your verification code has been sent to your phone. ` +
            `Valid for 10 minutes.`,
        hi: `आपका सत्यापन कोड आपके फ़ोन पर भेजा गया है। 10 मिनट तक मान्य।`,
      }),
    }), { skip: inAppSkipUnlessEnabled });

    await step.custom('sms-otp', async () => dispatchOutput(
      await dispatch({
        channel: 'sms', triggerId, audienceGroup, workflowId: wfId,
        transactionId: txn, subscriber, payload,
        content: { channel: 'sms', sms: {
          templateId: SMS_TEMPLATE_ID,
          vars: { var1: payload.otp, OTP: payload.otp },
        }},
      })));

    await step.custom('email-confirmation', async () => dispatchOutput(
      await dispatch({
        channel: 'email', triggerId, audienceGroup, workflowId: wfId,
        transactionId: txn, subscriber, payload,
        content: { channel: 'email', email: {
          subject: pickByLocale(locale, {
            en: 'Welcome to TPE Investments — verify your account',
            hi: 'TPE Investments में आपका स्वागत है — अपना खाता सत्यापित करें',
          }),
          htmlBody: pickByLocale(locale, {
            en: `<p>Hello,</p>` +
                `<p>Your verification code is <strong>${payload.otp}</strong>. ` +
                `This code is valid for 10 minutes.</p>` +
                `<p>Once verified, you'll see TPE's curated investment opportunities ` +
                `tailored to your risk profile.</p>` +
                `<p style="color:#888;font-size:12px;">— TPE Investments</p>`,
            hi: `<p>नमस्ते,</p>` +
                `<p>आपका सत्यापन कोड <strong>${payload.otp}</strong> है। ` +
                `यह कोड 10 मिनट तक मान्य है।</p>` +
                `<p style="color:#888;font-size:12px;">— TPE Investments</p>`,
          }),
        }},
      })));

    const cad = payload.testMode ? REMINDER_DELAYS.test : REMINDER_DELAYS.prod;

    await step.delay('wait-1h-or-test', async () => cad.firstAt);
    await step.custom('whatsapp-nudge-1h', async () => dispatchOutput(
      await dispatch({
        channel: 'whatsapp', triggerId, audienceGroup, workflowId: wfId,
        transactionId: txn, subscriber, payload,
        content: { channel: 'whatsapp', whatsapp: {
          templateName: WHATSAPP_TEMPLATE_NAME,
          languageCode: locale,
          buttonUrlParam: payload.investor_id ?? 'resume',
          opaqueCallback: `inv-02:${payload.investor_id ?? 'unknown'}:1h`,
        }},
      })));

    await step.delay('wait-24h-or-test', async () => cad.secondAt);
    await step.custom('whatsapp-nudge-24h', async () => dispatchOutput(
      await dispatch({
        channel: 'whatsapp', triggerId, audienceGroup, workflowId: wfId,
        transactionId: txn, subscriber, payload,
        content: { channel: 'whatsapp', whatsapp: {
          templateName: WHATSAPP_TEMPLATE_NAME,
          languageCode: locale,
          buttonUrlParam: payload.investor_id ?? 'resume',
          opaqueCallback: `inv-02:${payload.investor_id ?? 'unknown'}:24h`,
        }},
      })));

    await step.delay('wait-72h-or-test', async () => cad.thirdAt);
    await step.custom('email-nudge-72h', async () => dispatchOutput(
      await dispatch({
        channel: 'email', triggerId, audienceGroup, workflowId: wfId,
        transactionId: txn, subscriber, payload,
        content: { channel: 'email', email: {
          subject: pickByLocale(locale, {
            en: 'Still want to register with TPE Investments?',
            hi: 'क्या आप अभी भी TPE Investments के साथ रजिस्टर करना चाहते हैं?',
          }),
          htmlBody: pickByLocale(locale, {
            en: `<p>We held your registration for 72 hours. ` +
                `Restart from the link in our last message if you'd still like to verify.</p>` +
                `<p style="color:#888;font-size:12px;">— TPE Investments</p>`,
            hi: `<p>हमने आपका पंजीकरण 72 घंटों के लिए रोक रखा था।</p>` +
                `<p style="color:#888;font-size:12px;">— TPE Investments</p>`,
          }),
        }},
      })));
  },
  {
    payloadSchema: tpeBasePayload.extend({
      otp: z.string().length(6),
      investor_id: z.string().optional(),
      testMode: z.boolean().optional(),
      abandonedAfterMinutes: z.number().optional(),
    }),
    tags: taggedAs('INV', 'INV-02', 'authentication', 'transactional'),
  },
);
