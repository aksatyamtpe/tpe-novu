/**
 * PH-17 Re-engagement — Policyholder Lifecycle.
 *
 * Charter §4.3.1 trigger spec:
 *   "Reach out to a dormant policyholder who hasn't engaged with the
 *    portal / app for an extended window (default 90 days)."
 *   Channels: Email primary (long-form), WhatsApp + in-app (light nudges).
 *             Deliberately NO SMS — re-engaging silent users via SMS feels
 *             intrusive and the operator-side cost-per-send doesn't justify
 *             it for marketing-style copy.
 *   Cadence:  Single-shot. Upstream scheduler may re-fire after another
 *             dormancy window if the user stays silent.
 *   Quiet hours: applied — re-engagement is never urgent.
 *   Tone:     warm + low-pressure. NOT transactional copy. We're checking
 *             in, not asking for action.
 *
 * Sender identity: TPE Customer Care.
 *
 * Why this is "transactional" tag despite the soft tone: the trigger is
 * service-level (we want them to know they have a TPE relationship), not
 * marketing pitch. DLT-wise this still classifies as Promotional in India
 * — see open question on charter §4.5 SMS template categorisation. SMS
 * skipped here keeps that ambiguity out of the picture.
 *
 * Pattern note: NOT cadence-driven. This is a single-shot trigger and
 * therefore does NOT use the channel-matrix-by-stage scaffolding from
 * INV-08 / PH-15 / INV-11.
 */
import { workflow } from '@novu/framework';
import { z } from 'zod';
import {
  tpeBasePayload, taggedAs, dispatch, dispatchOutput,
  templateEnvKeyFor, resolveTransactionId, pickByLocale, resolveLocale, inAppSkipUnlessEnabled,
} from '../../lib';

const WHATSAPP_TEMPLATE_NAME =
  process.env[templateEnvKeyFor('PH-17', 'whatsapp')] ?? 'dynamictemp2';

export const phReEngagement = workflow(
  'ph-17-re-engagement',
  async ({ step, payload, subscriber }) => {
    const wfId = 'ph-17-re-engagement';
    const triggerId = 'PH-17';
    const audienceGroup = 'PH' as const;
    const txn = resolveTransactionId(payload);
    const locale = resolveLocale({ forceLocale: payload.forceLocale, subscriber });

    // Display-friendly dormancy window — defaults to "a while" if upstream
    // doesn't provide a number.
    const dormancyDays = payload.dormancyDays ?? 90;
    const dormancyLabel = pickByLocale(locale, {
      en: dormancyDays >= 60 ? `the past ${Math.round(dormancyDays / 30)} months`
                              : `the past ${dormancyDays} days`,
      hi: dormancyDays >= 60 ? `पिछले ${Math.round(dormancyDays / 30)} महीनों`
                              : `पिछले ${dormancyDays} दिनों`,
    });

    await step.inApp('inbox-re-engagement', async () => ({
      subject: pickByLocale(locale, {
        en: `We've missed you at TPE`,
        hi: `हमने आपको TPE पर मिस किया`,
      }),
      body: pickByLocale(locale, {
        en: `It's been ${dormancyLabel} since you last visited. Drop in any ` +
            `time to review your policy status, surrender quotes, or loan ` +
            `eligibility — no action needed right now.`,
        hi: `आपकी पिछली विज़िट के बाद ${dormancyLabel} बीत चुके हैं। पॉलिसी ` +
            `स्थिति, समर्पण कोट या ऋण पात्रता देखने के लिए कभी भी आएं — अभी ` +
            `कोई कार्रवाई आवश्यक नहीं।`,
      }),
    }), { skip: inAppSkipUnlessEnabled });

    await step.custom('whatsapp-re-engagement', async () => dispatchOutput(
      await dispatch({
        channel: 'whatsapp', triggerId, audienceGroup, workflowId: wfId,
        transactionId: txn, subscriber, payload,
        content: { channel: 'whatsapp', whatsapp: {
          templateName: WHATSAPP_TEMPLATE_NAME,
          languageCode: locale,
          buttonUrlParam:
            payload.portalUrl ??
            payload.ph_id ??
            're-engage',
          opaqueCallback:
            `ph-17:dormancy-${dormancyDays}d:${payload.ph_id ?? 'no-ph'}`,
        }},
      })));

    await step.custom('email-re-engagement', async () => dispatchOutput(
      await dispatch({
        channel: 'email', triggerId, audienceGroup, workflowId: wfId,
        transactionId: txn, subscriber, payload,
        content: { channel: 'email', email: {
          subject: pickByLocale(locale, {
            en: `Quick check-in from TPE`,
            hi: `TPE से एक त्वरित चेक-इन`,
          }),
          htmlBody: pickByLocale(locale, {
            en: emailBodyEn(payload, subscriber.firstName, dormancyLabel),
            hi: emailBodyHi(payload, subscriber.firstName, dormancyLabel),
          }),
        }},
      })));
  },
  {
    payloadSchema: tpeBasePayload.extend({
      dormancyDays: z.number().int().positive().optional(),
      portalUrl: z.string().url().optional(),
      lastEvent: z.string().optional(),                 // e.g. "policy upload, 2026-02-04"
      activePolicyCount: z.number().int().nonnegative().optional(),
      ph_id: z.string().optional(),
    }),
    tags: taggedAs('PH', 'PH-17', 'transactional', 're-engagement', 'dormant'),
  },
);

// ---------------------------------------------------------------------------
// Email body builders — warm, low-pressure tone.
// ---------------------------------------------------------------------------

function ctaButton(url?: string, label = 'Open TPE portal'): string {
  if (!url) return '';
  return `<p style="margin:16px 0;">` +
         `<a href="${url}" style="background:#1B3A5C;color:#fff;` +
         `padding:10px 22px;text-decoration:none;border-radius:4px;` +
         `display:inline-block;font-weight:500;">${label}</a></p>`;
}

function emailBodyEn(p: any, firstName: string | undefined, dormancyLabel: string): string {
  const greet = `<p>Hello${firstName ? ' ' + firstName : ''},</p>`;
  const open =
    `<p>It's been ${dormancyLabel} since you last visited the TPE portal.` +
    (p.lastEvent ? ` (Your last activity: <em>${p.lastEvent}</em>.)` : '') +
    ` We're not here to push anything — just a quick check-in.</p>`;

  const portfolioLine = p.activePolicyCount && p.activePolicyCount > 0
    ? `<p>You have <strong>${p.activePolicyCount}</strong> active ` +
      `${p.activePolicyCount === 1 ? 'policy' : 'policies'} on file with us.</p>`
    : '';

  const optionsList =
    `<p>If you'd like, the portal lets you:</p>` +
    `<ul style="line-height:1.6;">` +
    `<li>Review the current status of any TPE-tracked policy.</li>` +
    `<li>Get a refreshed surrender-value quote.</li>` +
    `<li>Check loan eligibility against an existing policy.</li>` +
    `<li>Update your contact preferences (including opting out of these check-ins).</li>` +
    `</ul>`;

  const footer = `<p>No reply needed — and there's nothing time-sensitive in this email. ` +
                 `We'll be here whenever you're ready.</p>` +
                 `<p style="color:#888;font-size:12px;">— TPE Customer Care</p>`;

  return greet + open + portfolioLine + optionsList +
         ctaButton(p.portalUrl) +
         footer;
}

function emailBodyHi(p: any, firstName: string | undefined, dormancyLabel: string): string {
  const greet = `<p>नमस्ते${firstName ? ' ' + firstName : ''},</p>`;
  const open =
    `<p>आपकी पिछली TPE विज़िट के बाद ${dormancyLabel} बीत चुके हैं। ` +
    `यह सिर्फ एक त्वरित चेक-इन है — कोई कार्रवाई आवश्यक नहीं।</p>`;
  const optionsList =
    `<p>जब चाहें, पोर्टल में आप:</p>` +
    `<ul style="line-height:1.6;">` +
    `<li>अपनी पॉलिसी की स्थिति देख सकते हैं।</li>` +
    `<li>नया समर्पण मूल्य कोट प्राप्त कर सकते हैं।</li>` +
    `<li>ऋण पात्रता जाँच सकते हैं।</li>` +
    `<li>संपर्क प्राथमिकताएँ अपडेट कर सकते हैं।</li>` +
    `</ul>`;
  const footer = `<p>उत्तर आवश्यक नहीं। जब आप तैयार हों, हम यहाँ हैं।</p>` +
                 `<p style="color:#888;font-size:12px;">— TPE ग्राहक सेवा</p>`;
  return greet + open + optionsList +
         ctaButton(p.portalUrl, 'TPE पोर्टल खोलें') +
         footer;
}
