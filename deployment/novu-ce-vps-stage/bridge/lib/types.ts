/**
 * Shared types + Zod schemas across the 49 TPE workflows.
 *
 * Every workflow's `payloadSchema` SHOULD extend `tpeBasePayload` so that
 * multi-tenant routing, audit correlation, and compliance context propagate
 * uniformly across the system.
 */
import { z } from 'zod';

// ---------------------------------------------------------------------------
// Audience groups — match the Charter §4.3 trigger inventory.
// ---------------------------------------------------------------------------
export type AudienceGroup = 'PH' | 'INV' | 'INS' | 'OPS' | 'REG';

export const AUDIENCE_GROUPS: Record<AudienceGroup, string> = {
  PH: 'Policyholder Lifecycle',
  INV: 'Investor Lifecycle',
  INS: 'Insurance Partner / B2B',
  OPS: 'Internal Operations',
  REG: 'Regulatory / Statutory',
};

// ---------------------------------------------------------------------------
// Channel keys — Charter §4.4
// ---------------------------------------------------------------------------
export type Channel = 'email' | 'sms' | 'whatsapp' | 'rcs' | 'inApp' | 'chat';

// ---------------------------------------------------------------------------
// Base payload — every TPE workflow extends this.
// ---------------------------------------------------------------------------
export const tpeBasePayload = z.object({
  // Multi-tenant routing (Charter §4.7) — required for all INS-* workflows,
  // optional elsewhere because PH/INV/REG/OPS workflows aren't always insurer-bound.
  insurerId: z.string().optional(),

  // App-side correlation ID for the audit trail (Charter §4.8).
  // Set by the upstream system that calls /v1/events/trigger.
  triggerInstanceId: z.string().uuid().optional(),

  // Locale override — usually resolved from subscriber.data.locale, but the
  // upstream caller can force a specific locale (e.g. "send the IRDAI filing
  // in English regardless of subscriber preference").
  forceLocale: z.enum(['en', 'hi']).optional(),
});

export type TpeBasePayload = z.infer<typeof tpeBasePayload>;

// ---------------------------------------------------------------------------
// Subscriber custom data shape — what TPE stores under subscriber.data.
// ---------------------------------------------------------------------------
export type TpeSubscriberData = {
  locale?: 'en' | 'hi';
  ph_id?: string;
  ph_state?:
    | 'lead' | 'contacted' | 'qualified' | 'disqualified'
    | 'registered' | 'kyc_pending' | 'kyc_complete'
    | 'active' | 'closed';
  investor_id?: string;
  investor_state?:
    | 'lead' | 'registered' | 'kyc_pending'
    | 'active' | 'matured' | 'closed';
  insurer_id?: string;
  preferences?: Partial<Record<Channel, boolean>>;
};

// ---------------------------------------------------------------------------
// Tags — every workflow gets a uniform tag set so the dashboard filter is useful.
// Use `taggedAs(group, triggerId, ...extra)` when constructing workflow options.
// ---------------------------------------------------------------------------
export function taggedAs(group: AudienceGroup, triggerId: string, ...extra: string[]): string[] {
  return [group, triggerId, ...extra];
}
