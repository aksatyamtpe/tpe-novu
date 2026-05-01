/**
 * Single-entry dispatch layer for the 49 TPE workflows.
 *
 * Every workflow's channel step calls `dispatch({ channel, ... })` instead of
 * inlining the provider fetch. This collapses three concerns into one place:
 *
 *   1. COMPLIANCE GATE  — `assertCompliance()` per Charter §4.6.
 *   2. LOCALE RESOLVE   — `resolveLocale()` per Charter §4.4.
 *   3. PROVIDER ROUTE   — channel → provider helper.
 *   4. AUDIT EMIT       — `emitAuditRow()` per Charter §4.8 with provider
 *                         message-id correlation.
 *
 * NotConfigured errors (MSG91 template missing, SES not wired) become
 * `{ ok: false, errorReason }` rather than thrown exceptions. This keeps a
 * partially-configured stage triggerable end-to-end while the user is still
 * gathering DLT template_ids and SES creds.
 *
 * Runtime errors (network failure, Meta rejection, etc.) are logged + recorded
 * in the audit row as `status: 'failed'` and ALSO returned to the caller so
 * the workflow body can decide whether to fall through to a different channel.
 */

import type { AudienceGroup, Channel, TpeBasePayload } from './types';
import { assertCompliance } from './compliance';
import { resolveLocale, type SupportedLocale } from './locale';
import { emitAuditRow, tokenizePii } from './audit';
import { isChannelEnabled } from './channel-gating';
import {
  sendSmsViaFlow,
  Msg91NotConfigured,
} from './providers/msg91';
import {
  sendWhatsAppTemplate,
  IcpaasNotConfigured,
} from './providers/icpaas';
import {
  sendEmailViaSes,
  SesNotConfigured,
} from './providers/email-ses';

// ---------------------------------------------------------------------------
// Subscriber + content shapes the workflow passes in.
// ---------------------------------------------------------------------------

export interface DispatchSubscriber {
  subscriberId?: string;
  email?: string | null;
  phone?: string | null;
  data?: { locale?: string; [k: string]: unknown } | null;
  [k: string]: unknown;
}

/**
 * Channel-specific content. Use the discriminated union so TS forces the
 * right shape per channel at the call site.
 */
export type DispatchContent =
  | { channel: 'sms'; sms: SmsContent }
  | { channel: 'whatsapp'; whatsapp: WhatsAppContent }
  | { channel: 'email'; email: EmailContent };

export interface SmsContent {
  /**
   * DLT-approved MSG91 template_id. Workflows usually pass an env-var lookup,
   * e.g. `templateId: process.env.MSG91_OTP_TEMPLATE_ID || ''`. Empty value
   * triggers the graceful `no template` skip.
   */
  templateId: string;
  /** Variable substitutions matching the DLT template's `{#var#}` slots. */
  vars?: Record<string, string>;
  /** Falls back to `subscriber.phone` when omitted. */
  toMobile?: string;
}

export interface WhatsAppContent {
  /** Meta-approved BSP template name (e.g. 'dynamictemp2'). */
  templateName: string;
  languageCode?: 'en' | 'hi';
  buttonUrlParam?: string;
  /** Falls back to `subscriber.phone`. */
  toMobile?: string;
  opaqueCallback?: string;
}

export interface EmailContent {
  subject: string;
  htmlBody: string;
  textBody?: string;
  replyTo?: string;
  /** Falls back to `subscriber.email`. */
  toEmail?: string;
}

// ---------------------------------------------------------------------------
// Dispatch input + result.
// ---------------------------------------------------------------------------

export interface DispatchOptions {
  channel: Channel;
  /** Charter §4.3 trigger ID — e.g. 'PH-02', 'INV-08'. */
  triggerId: string;
  audienceGroup: AudienceGroup;
  /** Workflow function ID — e.g. 'ph-02-registration'. */
  workflowId: string;
  subscriber: DispatchSubscriber;
  /** Whatever the upstream caller forwarded. */
  payload: TpeBasePayload & Record<string, unknown>;
  /** Channel-specific body. The discriminator must match `channel`. */
  content: DispatchContent;
  /** Optional Novu transactionId for audit correlation. */
  transactionId?: string;
  /** Optional provider override hooks (failover, sandbox routing, etc.). */
  providerHints?: {
    /** Override the SMS provider env-var key — defaults to triggerId-based. */
    smsTemplateEnvKey?: string;
    /** Override the WhatsApp template name. */
    whatsappTemplateName?: string;
  };
}

export interface DispatchResult {
  ok: boolean;
  channel: Channel;
  /** Provider's message ID — `request_id` (MSG91), `wamid` (Meta), `MessageId` (SES). */
  providerMessageId?: string;
  /** Mirrors the audit row's `status` field. */
  status: 'sent' | 'failed' | 'skipped' | 'queued';
  /** Free-text — populated when `ok: false`. */
  errorReason?: string;
  /** Resolved locale at dispatch time (for downstream caller logging). */
  locale: SupportedLocale;
  /** Raw provider response, when present. Useful for activity-feed display. */
  providerRaw?: unknown;
}

// ---------------------------------------------------------------------------
// dispatch() — the function workflows actually call.
// ---------------------------------------------------------------------------

export async function dispatch(opts: DispatchOptions): Promise<DispatchResult> {
  // 0. Operator-managed channel allowlist. Reads the `tpe_channel_gating`
  //    Mongo doc (10s cache); if the operator has unticked this channel in
  //    /admin/channels we short-circuit with an audited skip BEFORE any
  //    provider work happens. See lib/channel-gating.ts.
  const allowed = await isChannelEnabled(opts.channel);
  if (!allowed) {
    const localeForSkip = resolveLocale({
      forceLocale: opts.payload.forceLocale,
      subscriber: opts.subscriber,
    });
    emitAuditRow({
      transactionId: opts.transactionId ?? resolveTransactionId(opts.payload),
      triggerInstanceId: opts.payload.triggerInstanceId,
      workflowId: opts.workflowId,
      triggerId: opts.triggerId,
      audienceGroup: opts.audienceGroup,
      subscriberToken: tokenizePii(opts.subscriber.subscriberId ?? ''),
      insurerId: opts.payload.insurerId,
      channel: opts.channel,
      status: 'skipped',
      reason: `channel '${opts.channel}' disabled in /admin/channels (operator allowlist)`,
    });
    return {
      ok: false,
      channel: opts.channel,
      status: 'skipped',
      errorReason: `channel '${opts.channel}' disabled in /admin/channels (operator allowlist)`,
      locale: localeForSkip,
    };
  }

  // 1. Compliance gate. Throws on blocking violations.
  assertCompliance({
    workflowId: opts.workflowId,
    triggerId: opts.triggerId,
    audienceGroup: opts.audienceGroup,
    insurerId: opts.payload.insurerId,
    channel: opts.channel,
  });

  // 2. Locale resolve.
  const locale = resolveLocale({
    forceLocale: opts.payload.forceLocale,
    subscriber: opts.subscriber,
  });

  // 3. Provider route + 4. Audit emit happen per channel.
  const subscriberToken = tokenizePii(opts.subscriber.subscriberId ?? '');
  const auditCommon = {
    // Workflows should pass transactionId from `resolveTransactionId(payload)`
    // at the top of the workflow body. This stitches every dispatch in one
    // workflow execution under the same correlation key in the audit trail.
    transactionId: opts.transactionId ?? resolveTransactionId(opts.payload),
    triggerInstanceId: opts.payload.triggerInstanceId,
    workflowId: opts.workflowId,
    triggerId: opts.triggerId,
    audienceGroup: opts.audienceGroup,
    subscriberToken,
    insurerId: opts.payload.insurerId,
  };

  try {
    switch (opts.channel) {
      case 'sms': {
        if (opts.content.channel !== 'sms') {
          throw new Error(`dispatch: channel=sms but content.channel=${opts.content.channel}`);
        }
        const sms = opts.content.sms;
        const toMobile = (sms.toMobile ?? opts.subscriber.phone ?? '').replace(/[^0-9]/g, '');
        if (!toMobile) {
          emitAuditRow({ ...auditCommon, channel: 'sms', status: 'skipped', reason: 'no mobile number on subscriber' });
          return { ok: false, channel: 'sms', status: 'skipped', errorReason: 'no mobile number on subscriber', locale };
        }
        if (!sms.templateId) {
          // Graceful skip — keeps the workflow runnable while the user is
          // still picking a DLT template_id from the MSG91 dashboard.
          // eslint-disable-next-line no-console
          console.warn(JSON.stringify({
            type: 'dispatch_skipped',
            reason: 'MSG91 template_id not configured',
            triggerId: opts.triggerId,
            channel: 'sms',
            wouldHaveSentTo: subscriberToken,
            varsKeys: Object.keys(sms.vars ?? {}),
          }));
          emitAuditRow({ ...auditCommon, channel: 'sms', status: 'skipped', reason: 'MSG91_OTP_TEMPLATE_ID not configured' });
          return {
            ok: false,
            channel: 'sms',
            status: 'skipped',
            errorReason: 'MSG91_OTP_TEMPLATE_ID not configured',
            locale,
          };
        }

        const result = await sendSmsViaFlow({
          templateId: sms.templateId,
          recipients: [{ mobile: toMobile, vars: sms.vars }],
        });

        emitAuditRow({
          ...auditCommon,
          channel: 'sms',
          status: result.ok ? 'sent' : 'failed',
          reason: result.ok ? undefined : `MSG91 http ${result.httpStatus}`,
        });

        return {
          ok: result.ok,
          channel: 'sms',
          status: result.ok ? 'sent' : 'failed',
          providerMessageId: result.requestId,
          providerRaw: result.raw,
          locale,
          errorReason: result.ok ? undefined : `MSG91 http ${result.httpStatus}`,
        };
      }

      case 'whatsapp': {
        if (opts.content.channel !== 'whatsapp') {
          throw new Error(`dispatch: channel=whatsapp but content.channel=${opts.content.channel}`);
        }
        const wa = opts.content.whatsapp;
        const toMobile = (wa.toMobile ?? opts.subscriber.phone ?? '').replace(/[^0-9]/g, '');
        if (!toMobile) {
          emitAuditRow({ ...auditCommon, channel: 'whatsapp', status: 'skipped', reason: 'no mobile number on subscriber' });
          return { ok: false, channel: 'whatsapp', status: 'skipped', errorReason: 'no mobile number on subscriber', locale };
        }

        const result = await sendWhatsAppTemplate({
          to: toMobile,
          templateName: opts.providerHints?.whatsappTemplateName ?? wa.templateName,
          languageCode: wa.languageCode ?? locale,
          buttonUrlParam: wa.buttonUrlParam,
          opaqueCallback: wa.opaqueCallback,
        });

        emitAuditRow({
          ...auditCommon,
          channel: 'whatsapp',
          status: result.ok ? 'sent' : 'failed',
          reason: result.ok ? undefined : `ICPaaS http ${result.httpStatus}`,
        });

        return {
          ok: result.ok,
          channel: 'whatsapp',
          status: result.ok ? 'sent' : 'failed',
          providerMessageId: result.wamid,
          providerRaw: result.raw,
          locale,
          errorReason: result.ok ? undefined : `ICPaaS http ${result.httpStatus}`,
        };
      }

      case 'email': {
        if (opts.content.channel !== 'email') {
          throw new Error(`dispatch: channel=email but content.channel=${opts.content.channel}`);
        }
        const em = opts.content.email;
        const toEmail = em.toEmail ?? opts.subscriber.email ?? '';
        if (!toEmail) {
          emitAuditRow({ ...auditCommon, channel: 'email', status: 'skipped', reason: 'no email on subscriber' });
          return { ok: false, channel: 'email', status: 'skipped', errorReason: 'no email on subscriber', locale };
        }

        const result = await sendEmailViaSes({
          to: toEmail,
          subject: em.subject,
          htmlBody: em.htmlBody,
          textBody: em.textBody,
          replyTo: em.replyTo,
          tags: [
            { name: 'triggerId', value: opts.triggerId },
            { name: 'audienceGroup', value: opts.audienceGroup },
          ],
        });

        emitAuditRow({ ...auditCommon, channel: 'email', status: 'sent' });
        return {
          ok: true,
          channel: 'email',
          status: 'sent',
          providerMessageId: result.messageId,
          providerRaw: result.raw,
          locale,
        };
      }

      default:
        throw new Error(`dispatch: channel '${opts.channel}' not yet routed.`);
    }
  } catch (err) {
    // NotConfigured errors → graceful skip with a typed reason.
    if (err instanceof Msg91NotConfigured) {
      emitAuditRow({ ...auditCommon, channel: opts.channel, status: 'skipped', reason: err.message });
      return { ok: false, channel: opts.channel, status: 'skipped', errorReason: 'Msg91NotConfigured', locale };
    }
    if (err instanceof IcpaasNotConfigured) {
      emitAuditRow({ ...auditCommon, channel: opts.channel, status: 'skipped', reason: err.message });
      return { ok: false, channel: opts.channel, status: 'skipped', errorReason: 'IcpaasNotConfigured', locale };
    }
    if (err instanceof SesNotConfigured) {
      emitAuditRow({ ...auditCommon, channel: opts.channel, status: 'skipped', reason: err.message });
      return { ok: false, channel: opts.channel, status: 'skipped', errorReason: 'SesNotConfigured', locale };
    }

    // Anything else → failed audit, surface the message to the caller.
    const reason = err instanceof Error ? err.message : String(err);
    emitAuditRow({ ...auditCommon, channel: opts.channel, status: 'failed', reason });
    // eslint-disable-next-line no-console
    console.error(JSON.stringify({
      type: 'dispatch_failed',
      triggerId: opts.triggerId,
      channel: opts.channel,
      reason,
    }));
    return { ok: false, channel: opts.channel, status: 'failed', errorReason: reason, locale };
  }
}

// ---------------------------------------------------------------------------
// Helpers — workflows import these alongside `dispatch`.
// ---------------------------------------------------------------------------

/**
 * Convert a `DispatchResult` into a small, JSON-stable object suitable as a
 * Novu `step.custom` return value. Drops `providerRaw` (can be large) and
 * keeps the audit-friendly fields. Use at every step.custom call site:
 *
 *   await step.custom('sms-otp', async () =>
 *     dispatchOutput(await dispatch({ ... })));
 */
export function dispatchOutput(r: DispatchResult) {
  return {
    ok: r.ok,
    channel: r.channel,
    status: r.status,
    providerMessageId: r.providerMessageId ?? null,
    errorReason: r.errorReason ?? null,
    locale: r.locale,
  };
}

/**
 * Convention-based env-var name resolver for per-trigger templates.
 *
 *   templateEnvKeyFor('PH-02', 'sms')      → 'MSG91_TEMPLATE_PH_02_SMS'
 *   templateEnvKeyFor('PH-09', 'whatsapp') → 'ICPAAS_TEMPLATE_PH_09_WHATSAPP'
 *   templateEnvKeyFor('REG-02', 'email')   → 'SES_TEMPLATE_REG_02_EMAIL' (reserved; SES doesn't use template IDs but the slot is uniform)
 *
 * The 49 workflows pull their channel-specific template/template_id by env
 * var name, so DLT registrations + Meta-approved templates can be added,
 * rotated, or moved between sandboxes without code changes.
 */
export function templateEnvKeyFor(triggerId: string, channel: 'sms' | 'whatsapp' | 'email'): string {
  const norm = triggerId.replace(/-/g, '_').toUpperCase();
  const prefix =
    channel === 'sms' ? 'MSG91_TEMPLATE'
    : channel === 'whatsapp' ? 'ICPAAS_TEMPLATE'
    : 'SES_TEMPLATE';
  return `${prefix}_${norm}_${channel.toUpperCase()}`;
}

/**
 * Resolve a stable transaction-id for the workflow execution.
 *
 * Resolution order:
 *   1. `payload.triggerInstanceId` — set by the upstream system at trigger time
 *      (preferred — gives cross-system correlation between TPE app + Novu audit).
 *   2. Generated `tpe_<ts>_<random>` ID — workflow-local correlation only.
 *
 * Workflows call this ONCE at the top of the body and pass the result to
 * every `dispatch({ transactionId })` call:
 *
 *   const txn = resolveTransactionId(payload);
 *   await step.custom('sms', async () =>
 *     dispatchOutput(await dispatch({ ..., transactionId: txn })));
 */
export function resolveTransactionId(payload: TpeBasePayload): string {
  if (payload.triggerInstanceId) return payload.triggerInstanceId;
  return `tpe_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}
