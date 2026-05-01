/**
 * PH-11 Post-Assignment Welcome — Policyholder Lifecycle.
 *
 * Charter §4.3.1 trigger spec:
 *   "Welcome the policyholder into the post-assignment relationship and set
 *    expectations."
 *   Channels: Email (primary, full content), WhatsApp (concise nudge).
 *   Cadence:  Immediate welcome on assignment completion. Quarterly newsletter
 *             handled by a separate scheduled trigger (out of scope here).
 *   Quiet hours: NOT applied — relationship-onboarding event.
 */
import { workflow } from '@novu/framework';
import { z } from 'zod';
import {
  tpeBasePayload, taggedAs, dispatch, dispatchOutput,
  templateEnvKeyFor, resolveTransactionId, pickByLocale, resolveLocale, inAppSkipUnlessEnabled,
} from '../../lib';

const WHATSAPP_TEMPLATE_NAME =
  process.env[templateEnvKeyFor('PH-11', 'whatsapp')] ?? 'dynamictemp2';

export const phPostAssignmentWelcome = workflow(
  'ph-11-post-assignment-welcome',
  async ({ step, payload, subscriber }) => {
    const wfId = 'ph-11-post-assignment-welcome';
    const triggerId = 'PH-11';
    const audienceGroup = 'PH' as const;
    const txn = resolveTransactionId(payload);
    const locale = resolveLocale({ forceLocale: payload.forceLocale, subscriber });

    await step.inApp('inbox-welcome', async () => ({
      subject: pickByLocale(locale, {
        en: 'Welcome to your post-assignment journey',
        hi: 'आपकी पॉलिसी असाइनमेंट के बाद की यात्रा में स्वागत है',
      }),
      body: pickByLocale(locale, {
        en: `Your policy ${payload.policyNumber ?? '(on file)'} has been assigned. ` +
            `You'll continue to receive premium status updates and tax documents ` +
            `here as the policy progresses to maturity.`,
        hi: `आपकी पॉलिसी ${payload.policyNumber ?? '(फ़ाइल में)'} असाइन कर दी गई है। ` +
            `परिपक्वता तक प्रीमियम स्थिति अपडेट और कर दस्तावेज़ यहाँ मिलते रहेंगे।`,
      }),
    }), { skip: inAppSkipUnlessEnabled });

    await step.custom('whatsapp-welcome', async () => dispatchOutput(
      await dispatch({
        channel: 'whatsapp', triggerId, audienceGroup, workflowId: wfId,
        transactionId: txn, subscriber, payload,
        content: { channel: 'whatsapp', whatsapp: {
          templateName: WHATSAPP_TEMPLATE_NAME,
          languageCode: locale,
          buttonUrlParam: payload.policyNumber ?? payload.ph_id ?? 'welcome',
          opaqueCallback: `ph-11:${payload.ph_id ?? 'unknown'}`,
        }},
      })));

    await step.custom('email-welcome', async () => dispatchOutput(
      await dispatch({
        channel: 'email', triggerId, audienceGroup, workflowId: wfId,
        transactionId: txn, subscriber, payload,
        content: { channel: 'email', email: {
          subject: pickByLocale(locale, {
            en: 'Your policy is now assigned — welcome',
            hi: 'आपकी पॉलिसी अब असाइन है — स्वागत है',
          }),
          htmlBody: pickByLocale(locale, {
            en: `<p>Hello${subscriber.firstName ? ' ' + subscriber.firstName : ''},</p>` +
                `<p>Your policy <strong>${payload.policyNumber ?? '(on file)'}</strong> ` +
                `has been successfully assigned${payload.investorName ? ' to ' + payload.investorName : ''}.</p>` +
                `<p>What happens next:</p>` +
                `<ul>` +
                  `<li>Premium reminders will continue to land here ahead of each due date.</li>` +
                  `<li>Quarterly portfolio statements will be issued by email.</li>` +
                  `<li>Tax documents (Form 16A, 80C statements) follow the regulator schedule.</li>` +
                  `<li>Maturity notifications start one year before policy maturity.</li>` +
                `</ul>` +
                `<p>If anything looks off, reply to this email or message TPE Customer Care.</p>` +
                `<p style="color:#888;font-size:12px;">— TPE Customer Care</p>`,
            hi: `<p>नमस्ते${subscriber.firstName ? ' ' + subscriber.firstName : ''},</p>` +
                `<p>आपकी पॉलिसी <strong>${payload.policyNumber ?? '(फ़ाइल में)'}</strong> ` +
                `सफलतापूर्वक असाइन कर दी गई है।</p>` +
                `<p>आगे क्या होगा: प्रीमियम रिमाइंडर, तिमाही पोर्टफ़ोलियो विवरण, और कर दस्तावेज़ ` +
                `नियमित रूप से प्राप्त होंगे।</p>` +
                `<p style="color:#888;font-size:12px;">— TPE Customer Care</p>`,
          }),
        }},
      })));
  },
  {
    payloadSchema: tpeBasePayload.extend({
      policyNumber: z.string().optional(),
      investorName: z.string().optional(),
      assignmentDate: z.string().optional(),
      ph_id: z.string().optional(),
    }),
    tags: taggedAs('PH', 'PH-11', 'transactional', 'onboarding', 'welcome'),
  },
);
