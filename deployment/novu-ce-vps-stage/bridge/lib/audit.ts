/**
 * Per-message audit row emitter (Charter §4.8 & E3).
 *
 * Every dispatched message produces ONE append-only audit row with PII
 * tokenized. Retention 12 months hot, 5 years warm, 8 years cold (Income
 * Tax + Insurance Act). The subject-access export endpoint must return
 * within 60 seconds (success metric E3).
 *
 * PHASE 0: structured stdout log line tagged `type: "audit"`. The runtime
 * collector (CloudWatch agent / Loki / whatever the team picks) routes
 * `type=audit` lines to the long-term audit store.
 *
 * REAL IMPL (planned): writes directly to a `tpe_audit` Mongo collection
 * (or external store) via a separate transport — never blocks the workflow
 * step. If the audit transport fails, emit Sev-2 to OPS-04.
 */

import { AudienceGroup, Channel } from './types';

export interface AuditRow {
  /** Novu's transactionId from /v1/events/trigger response. */
  transactionId: string;

  /** App-side correlation ID set by the upstream caller. */
  triggerInstanceId?: string;

  /** Workflow function ID — e.g. "ph-02-registration". */
  workflowId: string;

  /** Charter trigger ID — e.g. "PH-02". */
  triggerId: string;

  audienceGroup: AudienceGroup;

  /** Tokenized — never raw PII. */
  subscriberToken: string;

  channel: Channel;

  /** Multi-tenant routing context. Required for INS-* workflows. */
  insurerId?: string;

  status: 'sent' | 'failed' | 'skipped' | 'queued';

  /** Free-text reason — e.g. "quiet hours", "DLT rejected", "opt-out". */
  reason?: string;

  /** ISO timestamp. */
  ts: string;
}

/**
 * PHASE 0 tokenizer — Buffer.from + base64 + truncate.
 * REAL IMPL: HMAC-SHA256 with a project-specific key from Secrets Manager.
 */
export function tokenizePii(value: string | undefined | null): string {
  if (!value) return 'tok_empty';
  return `tok_${Buffer.from(String(value)).toString('base64').replace(/[+/=]/g, '').slice(0, 16)}`;
}

export function emitAuditRow(row: Omit<AuditRow, 'ts'>): void {
  const fullRow: AuditRow = { ...row, ts: new Date().toISOString() };
  // The `type: "audit"` discriminator is the collector's filter.
  // eslint-disable-next-line no-console
  console.log(JSON.stringify({ type: 'audit', ...fullRow }));
}
