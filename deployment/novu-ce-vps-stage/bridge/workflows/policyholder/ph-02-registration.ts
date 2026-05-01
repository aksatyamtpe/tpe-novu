/**
 * PH-02 Registration — Policyholder Lifecycle.
 *
 * Charter §4.3.1 trigger spec
 *   Statuses: Started → OTP Sent → Verified | Abandoned
 *   Channels: SMS (primary, OTP), WhatsApp (abandoned-flow nudge), Email
 *             (confirmation + abandoned reminder), in-app (inbox copy)
 *   Cadence:  OTP immediate (10-min validity); resend max 3 in 30 min
 *             (handled at app layer, not here);
 *             abandoned reminders 1h / 24h / 72h after OTP Sent without
 *             Verified — quiet hours apply to reminders only, NOT to OTP.
 *
 * The 49 real workflows funnel every channel send through `dispatch()` so
 * compliance + locale + audit + provider-routing happen in ONE place.
 *
 * Stage testing: pass `payload.testMode = true` to collapse the 1h/24h/72h
 * delays into seconds for a fast end-to-end verification cycle.
 */
import { workflow } from '@novu/framework';
import { z } from 'zod';

import {
  tpeBasePayload,
  taggedAs,
  dispatch,
  dispatchOutput,
  templateEnvKeyFor,
  resolveTransactionId, inAppSkipUnlessEnabled,
} from '../../lib';

// Env-driven template lookups via the standard naming convention
// (MSG91_TEMPLATE_PH_02_SMS, ICPAAS_TEMPLATE_PH_02_WHATSAPP). Each falls back
// to the legacy single-name env var so existing host configs keep working.
// The dispatch layer translates an empty templateId into a graceful "skipped —
// no template" result, so unsetting these doesn't break the workflow run.
const SMS_TEMPLATE_ID =
  process.env[templateEnvKeyFor('PH-02', 'sms')]
  ?? process.env.MSG91_OTP_TEMPLATE_ID
  ?? '';
const WHATSAPP_TEMPLATE_NAME =
  process.env[templateEnvKeyFor('PH-02', 'whatsapp')]
  ?? process.env.ICPAAS_PHTPL_REGISTRATION_NUDGE
  ?? 'dynamictemp2';

// In testMode, collapse the 1h/24h/72h cadence to seconds so a stage trigger
// finishes in a couple of minutes without losing the shape of the flow.
const REMINDER_DELAYS = {
  prod: { firstAt: { amount: 1, unit: 'hours' as const },
          secondAt: { amount: 24, unit: 'hours' as const },
          thirdAt:  { amount: 72, unit: 'hours' as const } },
  test: { firstAt: { amount: 5, unit: 'seconds' as const },
          secondAt: { amount: 10, unit: 'seconds' as const },
          thirdAt:  { amount: 15, unit: 'seconds' as const } },
};

export const phRegistration = workflow(
  'ph-02-registration',
  async ({ step, payload, subscriber }) => {

    const wfId = 'ph-02-registration';
    const triggerId = 'PH-02';
    const audienceGroup = 'PH' as const;
    // One transactionId per workflow execution — every audit row from this run
    // is correlatable. Falls back to a generated id when the upstream caller
    // didn't pass `payload.triggerInstanceId`.
    const txn = resolveTransactionId(payload);

    // -----------------------------------------------------------------------
    // Step 1 — In-app inbox copy (always fires; no provider).
    // The `inApp` step uses Novu's native channel, not dispatch().
    // -----------------------------------------------------------------------
    await step.inApp('inbox-otp-sent', async () => ({
      subject: 'Verify your TPE account',
      body: `Your registration verification code has been sent to your phone. ` +
        `It is valid for 10 minutes.`,
    }), { skip: inAppSkipUnlessEnabled });

    // -----------------------------------------------------------------------
    // Step 2 — SMS OTP (primary). MSG91 v5 Flow with DLT template.
    // -----------------------------------------------------------------------
    await step.custom('sms-otp', async () => dispatchOutput(
      await dispatch({
        channel: 'sms',
        triggerId,
        audienceGroup,
        workflowId: wfId,
        transactionId: txn,
        subscriber,
        payload,
        content: {
          channel: 'sms',
          sms: {
            templateId: SMS_TEMPLATE_ID,
            // DLT templates use named slots `{#var#}`; align with the
            // template registered in MSG91 dashboard. Convention: `var1`
            // for the OTP digits.
            vars: { var1: payload.otp, OTP: payload.otp },
          },
        },
      }),
    ));

    // -----------------------------------------------------------------------
    // Step 3 — Email confirmation (gracefully skipped until SES creds land).
    // -----------------------------------------------------------------------
    await step.custom('email-confirmation', async () => dispatchOutput(
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
            subject: 'Welcome to The Policy Exchange — verify your account',
            htmlBody: `<p>Hello,</p>` +
              `<p>Your verification code is <strong>${payload.otp}</strong>.</p>` +
              `<p>This code is valid for 10 minutes.</p>` +
              `<p style="color:#888;font-size:12px;">— TPE Customer Care</p>`,
          },
        },
      }),
    ));

    // -----------------------------------------------------------------------
    // Step 4..6 — Abandoned-flow nudges via WhatsApp at 1h / 24h / 72h.
    // Quiet hours apply here; in stage testMode we collapse delays.
    // -----------------------------------------------------------------------
    const cad = payload.testMode ? REMINDER_DELAYS.test : REMINDER_DELAYS.prod;

    await step.delay('wait-1h-or-test', async () => cad.firstAt);
    await step.custom('whatsapp-nudge-1h', async () => dispatchOutput(
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
            languageCode: 'en',
            // The dynamictemp2 template's URL button takes a single text
            // param; reuse `ph_id` as a deeplink fragment for the resume
            // landing page.
            buttonUrlParam: payload.ph_id ?? 'resume',
            opaqueCallback: `ph-02:${payload.ph_id ?? 'unknown'}:1h`,
          },
        },
      }),
    ));

    await step.delay('wait-24h-or-test', async () => cad.secondAt);
    await step.custom('whatsapp-nudge-24h', async () => dispatchOutput(
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
            languageCode: 'en',
            buttonUrlParam: payload.ph_id ?? 'resume',
            opaqueCallback: `ph-02:${payload.ph_id ?? 'unknown'}:24h`,
          },
        },
      }),
    ));

    await step.delay('wait-72h-or-test', async () => cad.thirdAt);
    await step.custom('email-nudge-72h', async () => dispatchOutput(
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
            subject: 'Still want to register with TPE? Your code expired',
            htmlBody: `<p>We held your registration for 72 hours.</p>` +
              `<p>If you still want to verify, restart from the link in our last message.</p>` +
              `<p style="color:#888;font-size:12px;">— TPE Customer Care</p>`,
          },
        },
      }),
    ));
  },
  {
    payloadSchema: tpeBasePayload.extend({
      /** 6-digit OTP — generated upstream by the registration service. */
      otp: z.string().length(6),
      /** Application-side policyholder ID for deeplink + correlation. */
      ph_id: z.string().optional(),
      /** Used to short-circuit the 1h/24h/72h cadence on stage. */
      testMode: z.boolean().optional(),
      /** Charter §4.3.1 abandoned-flow timer; informational here. */
      abandonedAfterMinutes: z.number().optional(),
    }),
    tags: taggedAs('PH', 'PH-02', 'authentication', 'transactional'),
  },
);
