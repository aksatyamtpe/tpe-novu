// =============================================================================
// Campaign storage — Mongo CRUD on `tpe_campaigns`.
//
// A campaign captures: which table to read, how to filter it, which workflow
// to fire per row, and how to map row columns to Novu trigger payload fields.
// Phase 1A persists drafts but only fires-on-demand from /admin/campaigns/:id.
// Phase 1B will add a scheduler worker.
// =============================================================================
import { ObjectId } from 'mongodb';
import { getDb } from './mongo';
import type { AllowedTable, PreviewFilter } from './analytics-db';

export const COLL_CAMPAIGNS = 'tpe_campaigns';
export const COLL_CAMPAIGN_RUNS = 'tpe_campaign_runs';

/** Per-row mapping: how to assemble the Novu trigger from a Postgres row. */
export interface CampaignFieldMap {
  /** Source column whose value becomes Novu's subscriberId for this row.
   *  Convention: prefix with table name to keep namespaces clean
   *  (we set this in the worker, not here). */
  subscriberIdColumn: string;
  /** Optional source column for the subscriber's email. */
  emailColumn?: string;
  /** Optional source column for the subscriber's phone (E.164 / 10-digit). */
  phoneColumn?: string;
  /** Optional source column for the subscriber's first name. */
  firstNameColumn?: string;
  /** payloadFieldName -> sourceColumn — populates the workflow's payload. */
  payload: Record<string, string>;
}

export interface CampaignDoc {
  _id?: ObjectId;
  /** Operator-friendly label. */
  name: string;
  /** Optional free-text. */
  description?: string;
  /** Source data table. Validated against ALLOWED_TABLES at write time. */
  sourceTable: AllowedTable;
  /** WHERE clause filters (parameterised). */
  filters: PreviewFilter[];
  /** Bridge workflow trigger name — e.g. 'ph-17-re-engagement'. */
  targetWorkflow: string;
  /** Row → trigger payload mapping. */
  fieldMap: CampaignFieldMap;
  /** ISO 8601 future timestamp; absent / null = manual fire only (Phase 1A). */
  scheduledAt?: string | null;
  /**
   * Campaign lifecycle. Set on every run completion:
   *   - 'draft'           initial state, never fired
   *   - 'fired_empty'     ran, but the filter matched 0 rows (no triggers fired)
   *   - 'fired_complete'  at least one row succeeded, none errored
   *   - 'fired_partial'   some succeeded, some errored
   *   - 'fired_once'      rows matched but all skipped (no errors, no sends; e.g. empty subscriberId)
   *   - 'failed'          rows matched but all errored (Novu 4xx/5xx, network)
   */
  status: 'draft' | 'fired_empty' | 'fired_once' | 'fired_partial' | 'fired_complete' | 'failed';
  /** Last operator who saved/edited. Single-password MVP → just 'operator'. */
  updatedBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface CampaignRunDoc {
  _id?: ObjectId;
  campaignId: ObjectId;
  /** ISO timestamp of fire. */
  startedAt: string;
  finishedAt?: string;
  /** Total rows processed in this run. */
  rowCount: number;
  /** How many triggers Novu acknowledged. */
  triggered: number;
  /** Rows skipped — missing email/phone, mapping errors, etc. */
  skipped: number;
  /** Rows that errored — Novu 4xx/5xx, network. */
  errored: number;
  /** Bounded list of per-row outcomes (capped at 200 for Mongo doc-size sanity). */
  perRow: Array<{
    subscriberId: string;
    status: 'sent' | 'skipped' | 'errored';
    reason?: string;
    novuTransactionId?: string;
  }>;
}

export async function listCampaigns(): Promise<CampaignDoc[]> {
  const db = await getDb();
  return await db.collection<CampaignDoc>(COLL_CAMPAIGNS)
    .find({})
    .sort({ updatedAt: -1 })
    .toArray();
}

export async function getCampaign(id: string): Promise<CampaignDoc | null> {
  if (!ObjectId.isValid(id)) return null;
  const db = await getDb();
  return await db.collection<CampaignDoc>(COLL_CAMPAIGNS)
    .findOne({ _id: new ObjectId(id) });
}

export async function createCampaign(
  input: Omit<CampaignDoc, '_id' | 'status' | 'createdAt' | 'updatedAt'>,
): Promise<CampaignDoc> {
  const db = await getDb();
  const now = new Date().toISOString();
  const doc: CampaignDoc = {
    ...input,
    status: 'draft',
    createdAt: now,
    updatedAt: now,
  };
  const r = await db.collection<CampaignDoc>(COLL_CAMPAIGNS).insertOne(doc);
  return { ...doc, _id: r.insertedId };
}

export async function updateCampaign(
  id: string,
  patch: Partial<Omit<CampaignDoc, '_id' | 'createdAt'>>,
): Promise<CampaignDoc | null> {
  if (!ObjectId.isValid(id)) return null;
  const db = await getDb();
  const r = await db.collection<CampaignDoc>(COLL_CAMPAIGNS).findOneAndUpdate(
    { _id: new ObjectId(id) },
    { $set: { ...patch, updatedAt: new Date().toISOString() } },
    { returnDocument: 'after' },
  );
  return r ?? null;
}

export async function deleteCampaign(id: string): Promise<boolean> {
  if (!ObjectId.isValid(id)) return false;
  const db = await getDb();
  const r = await db.collection<CampaignDoc>(COLL_CAMPAIGNS).deleteOne({ _id: new ObjectId(id) });
  return r.deletedCount === 1;
}

export async function recordRun(run: Omit<CampaignRunDoc, '_id'>): Promise<ObjectId> {
  const db = await getDb();
  const r = await db.collection<CampaignRunDoc>(COLL_CAMPAIGN_RUNS).insertOne(run);
  return r.insertedId;
}

export async function listRecentRuns(campaignId: string, limit = 10): Promise<CampaignRunDoc[]> {
  if (!ObjectId.isValid(campaignId)) return [];
  const db = await getDb();
  return await db.collection<CampaignRunDoc>(COLL_CAMPAIGN_RUNS)
    .find({ campaignId: new ObjectId(campaignId) })
    .sort({ startedAt: -1 })
    .limit(limit)
    .toArray();
}
