/**
 * PH-09 Investor Matched — Policyholder Lifecycle.
 *
 * Charter §4.3.1 trigger spec:
 *   "Notify the policyholder that a buyer has been found / confirmed for
 *    their policy."
 *   Channels: WhatsApp (primary), Email (full-detail confirmation).
 *   Cadence:  Immediate. Single-shot. No drip, no delays.
 *   Quiet hours: NOT applied — this is a status-change confirmation, treated
 *                as transactional under DLT/IRDAI guidance.
 *
 * The dual-audience pattern (notify the matched investor too) is handled by
 * the corresponding INV-* workflow (out of scope for this exemplar). The
 * upstream orchestrator fires both triggers when the match lands.
 *
 * Stage testing — minimum required payload:
 *   { ph_id: 'test-ph-001', policyNumber: 'POL-12345',
 *     investorName: 'A. Investor', matchId: 'mtch_abc' }
 */
import { workflow } from '@novu/framework';
import { z } from 'zod';

import {
  tpeBasePayload,
  taggedAs,
  dispatch,
  dispatchOutput,
  templateEnvKeyFor,
  resolveTransactionId,
  pickByLocale,
  resolveLocale, inAppSkipUnlessEnabled,
} from '../../lib';

// Per-trigger templates via the standard convention.
// `dynamictemp2` is the only Meta-approved WhatsApp template on stage today;
// when a real PH-09 template is approved, set ICPAAS_TEMPLATE_PH_09_WHATSAPP.
const WHATSAPP_TEMPLATE_NAME =
  process.env[templateEnvKeyFor('PH-09', 'whatsapp')]
  ?? 'dynamictemp2';

export const phInvestorMatched = workflow(
  'ph-09-investor-matched',
  async ({ step, payload, subscriber }) => {

    const wfId = 'ph-09-investor-matched';
    const triggerId = 'PH-09';
    const audienceGroup = 'PH' as const;
    const txn = resolveTransactionId(payload);

    // Resolve locale once for the in-app body — dispatch resolves it again
    // per send (cheap; ensures audit row is locale-correct even if subscriber
    // attributes change between steps in the future).
    const locale = resolveLocale({
      forceLocale: payload.forceLocale,
      subscriber,
    });

    // -----------------------------------------------------------------------
    // Step 1 — In-app inbox copy.
    // -----------------------------------------------------------------------
    await step.inApp('inbox-investor-matched', async () => ({
      subject: pickByLocale(locale, {
        en: 'Buyer found for your policy',
        hi: 'आपकी पॉलिसी के लिए खरीदार मिल गया है',
      }),
      body: pickByLocale(locale, {
        en: `Good news — we've matched a buyer for policy ` +
            `${payload.policyNumber ?? 'on file'}. ` +
            `Check the offer details and respond before it expires.`,
        hi: `अच्छी खबर — हमने पॉलिसी ` +
            `${payload.policyNumber ?? 'आपकी फ़ाइल में'} के लिए एक खरीदार ` +
            `ढूंढ लिया है। ऑफ़र विवरण देखें और समाप्त होने से पहले जवाब दें।`,
      }),
    }), { skip: inAppSkipUnlessEnabled });

    // -----------------------------------------------------------------------
    // Step 2 — WhatsApp confirmation (primary channel for PH-09).
    // -----------------------------------------------------------------------
    await step.custom('whatsapp-investor-matched', async () => dispatchOutput(
      await dispatch({
        channel: 'whatsapp',
        triggerId,
        audienceGroup,
        workflowId: wfId,
        transactionId: txn,
        subscriber,
        payload,
        content: {
          channel: 'whatsapp',
          whatsapp: {
            templateName: WHATSAPP_TEMPLATE_NAME,
            languageCode: locale,
            // Deeplink param routes the policyholder to the offer-detail page.
            buttonUrlParam: payload.matchId ?? payload.ph_id ?? 'match',
            opaqueCallback: `ph-09:${payload.ph_id ?? 'unknown'}:` +
                            `${payload.matchId ?? 'no-match-id'}`,
          },
        },
      }),
    ));

    // -----------------------------------------------------------------------
    // Step 3 — Email confirmation (full detail; complements the short WA).
    //   Skips gracefully when SES creds are missing (stage today).
    // -----------------------------------------------------------------------
    await step.custom('email-investor-matched', async () => dispatchOutput(
      await dispatch({
        channel: 'email',
        triggerId,
        audienceGroup,
        workflowId: wfId,
        transactionId: txn,
        subscriber,
        payload,
        content: {
          channel: 'email',
          email: {
            subject: pickByLocale(locale, {
              en: `Buyer matched: policy ${payload.policyNumber ?? ''}`,
              hi: `खरीदार मिला: पॉलिसी ${payload.policyNumber ?? ''}`,
            }),
            htmlBody: pickByLocale(locale, {
              en: `<p>Hello${subscriber.firstName ? ' ' + subscriber.firstName : ''},</p>` +
                  `<p>We've matched a buyer for your policy ` +
                  `<strong>${payload.policyNumber ?? '(on file)'}</strong>.</p>` +
                  (payload.investorName
                    ? `<p>Investor: <strong>${payload.investorName}</strong></p>`
                    : '') +
                  `<p>Review the full offer in your TPE dashboard. ` +
                  `Offers expire if not responded to within the validity window.</p>` +
                  `<p style="color:#888;font-size:12px;">— TPE Customer Care</p>`,
              hi: `<p>नमस्ते${subscriber.firstName ? ' ' + subscriber.firstName : ''},</p>` +
                  `<p>हमने आपकी पॉलिसी ` +
                  `<strong>${payload.policyNumber ?? '(फ़ाइल में)'}</strong> ` +
                  `के लिए एक खरीदार ढूंढ लिया है।</p>` +
                  (payload.investorName
                    ? `<p>निवेशक: <strong>${payload.investorName}</strong></p>`
                    : '') +
                  `<p>पूरा ऑफ़र अपने TPE डैशबोर्ड में देखें। ` +
                  `यदि वैधता अवधि के भीतर जवाब नहीं दिया गया तो ऑफ़र समाप्त हो जाते हैं।</p>` +
                  `<p style="color:#888;font-size:12px;">— TPE Customer Care</p>`,
            }),
          },
        },
      }),
    ));
  },
  {
    payloadSchema: tpeBasePayload.extend({
      /** Application-side policyholder ID (subscriber correlation). */
      ph_id: z.string().optional(),
      /** Policy number for body content + email subject. */
      policyNumber: z.string().optional(),
      /** Display name of the matched investor. */
      investorName: z.string().optional(),
      /** Match correlation ID — drives the WhatsApp button deeplink. */
      matchId: z.string().optional(),
    }),
    tags: taggedAs('PH', 'PH-09', 'transactional', 'lifecycle', 'match'),
  },
);
