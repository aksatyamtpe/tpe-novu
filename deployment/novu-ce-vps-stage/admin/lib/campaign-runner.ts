// =============================================================================
// Shared campaign fan-out runner.
//
// Used by:
//   - app/api/campaigns/[id]/dispatch-now/route.ts   (manual fire)
//   - app/api/campaigns/[id]/retry-run/[runId]/route (retry errored rows)
//   - worker/index.ts                                (scheduled fire)
//
// All three paths used to duplicate the same loop. This module owns the
// canonical version: stream rows, fire one trigger per row, throttle, record
// a run doc, return summary. Callers pass the campaign and any filter
// overrides; everything else is identical.
// =============================================================================
import { randomUUID } from 'node:crypto';
import { ObjectId } from 'mongodb';
import { streamRows, type AllowedTable, type PreviewFilter } from './analytics-db';
import { recordRun, type CampaignDoc } from './campaigns';

const NOVU_API_URL = process.env.NOVU_API_URL || 'http://api:3000';
const NOVU_API_KEY = process.env.NOVU_API_KEY || process.env.NOVU_SECRET_KEY || '';
const TRIGGER_THROTTLE_MS = 100;
const MAX_ROWS_PER_RUN = 200;

export interface PerRowResult {
  subscriberId: string;
  status: 'sent' | 'skipped' | 'errored';
  reason?: string;
  novuTransactionId?: string;
}

export interface RunInput {
  campaign: CampaignDoc;
  /**
   * Optional filter override. When set, replaces campaign.filters for THIS
   * run only — used by the retry route which scopes to specific subscriberIds.
   */
  filterOverride?: PreviewFilter[];
  /** Free-form metadata persisted on the run doc (e.g. 'triggeredBy'). */
  metadata?: Record<string, unknown>;
}

export interface RunResult {
  runId: ObjectId;
  rowCount: number;
  triggered: number;
  skipped: number;
  errored: number;
  perRow: PerRowResult[];
}

export class NovuKeyMissing extends Error {
  constructor() { super('NOVU_API_KEY env missing'); this.name = 'NovuKeyMissing'; }
}

export async function runCampaignFanout(input: RunInput): Promise<RunResult> {
  if (!NOVU_API_KEY) throw new NovuKeyMissing();

  const { campaign } = input;
  const filters = input.filterOverride ?? campaign.filters;
  const startedAt = new Date().toISOString();

  let rowCount = 0, triggered = 0, skipped = 0, errored = 0;
  const perRow: PerRowResult[] = [];

  for await (const row of streamRows({
    table: campaign.sourceTable as AllowedTable,
    filters,
    limit: MAX_ROWS_PER_RUN,
  })) {
    rowCount++;
    const r = await fireRow(campaign, row);
    perRow.push(r);
    if (r.status === 'sent')         triggered++;
    else if (r.status === 'skipped') skipped++;
    else                              errored++;
    await sleep(TRIGGER_THROTTLE_MS);
  }

  const finishedAt = new Date().toISOString();
  const runId = await recordRun({
    campaignId: campaign._id!,
    startedAt,
    finishedAt,
    rowCount,
    triggered,
    skipped,
    errored,
    perRow: perRow.slice(0, 200),
    ...(input.metadata as any),
  });

  return { runId, rowCount, triggered, skipped, errored, perRow };
}

/**
 * Compute the campaign's terminal status from a run summary.
 * Single source of truth — used by every caller after runCampaignFanout().
 */
export function deriveCampaignStatus(r: { rowCount: number; triggered: number; errored: number }):
  'fired_empty' | 'failed' | 'fired_partial' | 'fired_complete' | 'fired_once' {
  if (r.rowCount === 0)                      return 'fired_empty';
  if (r.errored > 0 && r.triggered === 0)    return 'failed';
  if (r.errored > 0)                         return 'fired_partial';
  if (r.triggered > 0)                       return 'fired_complete';
  return 'fired_once';
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

async function fireRow(c: CampaignDoc, row: Record<string, unknown>): Promise<PerRowResult> {
  const fm = c.fieldMap;
  const rawId = row[fm.subscriberIdColumn];
  if (rawId == null || rawId === '') {
    return { subscriberId: '(empty)', status: 'skipped', reason: 'subscriberIdColumn empty for this row' };
  }
  const subscriberId = `${c.sourceTable}_${String(rawId)}`;

  const subscriber: Record<string, unknown> = { subscriberId };
  if (fm.emailColumn && row[fm.emailColumn])         subscriber.email = String(row[fm.emailColumn]);
  if (fm.phoneColumn && row[fm.phoneColumn])         subscriber.phone = normalizePhone(row[fm.phoneColumn]);
  if (fm.firstNameColumn && row[fm.firstNameColumn]) subscriber.firstName = String(row[fm.firstNameColumn]);

  const payload: Record<string, unknown> = {
    triggerInstanceId: randomUUID(),
    campaignId: c._id!.toString(),
  };
  for (const [pkey, scol] of Object.entries(fm.payload)) {
    if (row[scol] != null) payload[pkey] = String(row[scol]);
  }

  try {
    const res = await fetch(`${NOVU_API_URL}/v1/events/trigger`, {
      method: 'POST',
      headers: {
        Authorization: `ApiKey ${NOVU_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ name: c.targetWorkflow, to: subscriber, payload }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      return {
        subscriberId,
        status: 'errored',
        reason: `Novu ${res.status}: ${body?.message || JSON.stringify(body).slice(0, 120)}`,
      };
    }
    return { subscriberId, status: 'sent', novuTransactionId: body?.data?.transactionId };
  } catch (e: any) {
    return { subscriberId, status: 'errored', reason: e?.message || 'fetch failed' };
  }
}

function normalizePhone(v: unknown): string {
  const s = String(v).replace(/[^0-9]/g, '');
  if (s.length === 10) return `+91${s}`;
  if (s.length === 12 && s.startsWith('91')) return `+${s}`;
  return s ? `+${s}` : '';
}

function sleep(ms: number): Promise<void> {
  return new Promise((res) => setTimeout(res, ms));
}
