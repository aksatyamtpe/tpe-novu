/**
 * Compliance middleware (Charter §4.6).
 *
 * Two-layer enforcement:
 *   1. RUNTIME — `assertCompliance(ctx)` runs at the head of every workflow's
 *      execution. Failure throws and aborts dispatch; emits a violation event
 *      to the audit trail.
 *   2. CI — same rule set wired as a lint pass on every PR. PR fails if a
 *      workflow definition would violate any rule.
 *
 * Minimum 30 rules across 7 regimes (Charter §4.6):
 *   - DLT (India SMS template registration)
 *   - IRDAI (insurance regulator)
 *   - WA-BSP (WhatsApp Business Solution Provider, Meta)
 *   - DPDPA (Digital Personal Data Protection Act 2023)
 *   - FATCA
 *   - TDS
 *   - Brand-voice
 *
 * PHASE 0: passthrough. Returns ok for everything. The shape is locked
 * here so the call sites in workflows don't change when the real rules land.
 *
 * REAL IMPL: rule registry per regime, severity classifications (block / warn),
 * insurer-aware overrides via the insurer registry's brandVoice block.
 */

import { AudienceGroup, Channel } from './types';

export interface ComplianceContext {
  workflowId: string;
  triggerId: string;
  audienceGroup: AudienceGroup;
  insurerId?: string;
  channel?: Channel;
  subscriberLocale?: 'en' | 'hi';
  /** Body content or template variables — used by brand-voice + banned-words rules. */
  contentSample?: string;
}

export type ComplianceRegime =
  | 'DLT'
  | 'IRDAI'
  | 'WA-BSP'
  | 'DPDPA'
  | 'FATCA'
  | 'TDS'
  | 'BRAND_VOICE';

export interface ComplianceViolation {
  regime: ComplianceRegime;
  rule: string;
  reason: string;
  severity: 'block' | 'warn';
}

export interface ComplianceResult {
  ok: boolean;
  violations: ComplianceViolation[];
}

/**
 * PHASE 0 STUB — always returns { ok: true, violations: [] }.
 */
export function runComplianceCheck(_ctx: ComplianceContext): ComplianceResult {
  return { ok: true, violations: [] };
}

/**
 * Throws if any blocking violation is present. Emits warnings to stderr.
 */
export function assertCompliance(ctx: ComplianceContext): void {
  const result = runComplianceCheck(ctx);

  // Always emit warnings, even when ok.
  for (const v of result.violations) {
    if (v.severity === 'warn') {
      // eslint-disable-next-line no-console
      console.warn(JSON.stringify({
        type: 'compliance_warning',
        triggerId: ctx.triggerId,
        regime: v.regime,
        rule: v.rule,
        reason: v.reason,
      }));
    }
  }

  const blocking = result.violations.filter((v) => v.severity === 'block');
  if (blocking.length > 0) {
    const summary = blocking.map((v) => `[${v.regime}/${v.rule}] ${v.reason}`).join('; ');
    throw new Error(
      `ComplianceViolation: ${summary}. Workflow ${ctx.workflowId} aborted; ` +
      `see Charter §4.6 for the rule registry.`
    );
  }
}
