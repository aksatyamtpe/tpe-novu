// POST /admin/api/campaigns/[id]/retry-run/[runId]
//
// Re-fires only the rows that errored in a previous run. Pulls the failed
// subscriberIds out of `tpe_campaign_runs.perRow` (where status='errored'),
// strips the table-namespace prefix to recover the raw IDs, then runs the
// shared fan-out with an extra `IN (...)` filter on the campaign's
// subscriberIdColumn.
//
// Same throttle, same MAX_ROWS cap, same audit-row trail. The new run is
// recorded with `triggeredBy: 'retry-of-<previousRunId>'` so audit trails
// distinguish original vs retry runs.
import { NextRequest, NextResponse } from 'next/server';
import { ObjectId } from 'mongodb';
import { isAuthed } from '../../../../../../lib/auth';
import { getDb } from '../../../../../../lib/mongo';
import { getCampaign, updateCampaign, COLL_CAMPAIGN_RUNS, type CampaignRunDoc } from '../../../../../../lib/campaigns';
import { runCampaignFanout, deriveCampaignStatus, NovuKeyMissing } from '../../../../../../lib/campaign-runner';
import type { PreviewFilter } from '../../../../../../lib/analytics-db';

export const dynamic = 'force-dynamic';

const RETRY_BATCH_CAP = 200;  // matches the MAX_ROWS_PER_RUN in the runner

function unauthorized() {
  return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
}

export async function POST(
  req: NextRequest,
  ctx: { params: { id: string; runId: string } },
) {
  if (!isAuthed(req)) return unauthorized();

  const { id, runId } = ctx.params;
  if (!ObjectId.isValid(id) || !ObjectId.isValid(runId)) {
    return NextResponse.json({ ok: false, error: 'invalid id' }, { status: 400 });
  }

  // Load the campaign.
  const campaign = await getCampaign(id);
  if (!campaign) return NextResponse.json({ ok: false, error: 'campaign not found' }, { status: 404 });

  // Load the original run.
  const db = await getDb();
  const run = await db.collection<CampaignRunDoc>(COLL_CAMPAIGN_RUNS)
    .findOne({ _id: new ObjectId(runId), campaignId: new ObjectId(id) });
  if (!run) {
    return NextResponse.json({ ok: false, error: 'run not found' }, { status: 404 });
  }

  // Extract the errored subscriberIds and recover the raw ID values
  // (we strip the `${sourceTable}_` namespace prefix written by fireRow).
  const prefix = `${campaign.sourceTable}_`;
  const erroredRawIds: string[] = [];
  for (const r of run.perRow ?? []) {
    if (r.status !== 'errored' || !r.subscriberId) continue;
    if (r.subscriberId.startsWith(prefix)) {
      erroredRawIds.push(r.subscriberId.slice(prefix.length));
    }
  }
  if (erroredRawIds.length === 0) {
    return NextResponse.json(
      { ok: false, error: 'no errored rows to retry in this run' },
      { status: 400 },
    );
  }
  if (erroredRawIds.length > RETRY_BATCH_CAP) {
    return NextResponse.json(
      { ok: false, error: `too many errored rows (${erroredRawIds.length}); retry caps at ${RETRY_BATCH_CAP}` },
      { status: 400 },
    );
  }

  // Build the retry filter set: original campaign filters PLUS an IN-list
  // on the subscriberIdColumn, expressed as N OR-ed equality filters with
  // OR semantics. Since our SAFE_OPS only supports AND-joined filters,
  // emulate IN with N separate `=` ops on the same column won't work
  // (that's AND of equalities = always false). Instead we issue ONE filter
  // per call would be inefficient. Compromise: use ILIKE with regex anchored,
  // or — the cleanest — bypass the filter API and inject a single IN clause
  // through a pseudo-op. For Phase 1C, we'll keep this simple: stack an
  // OR-friendly filter by introducing a single `IN_LIST` op handled at the
  // runner. Since the runner today only knows the SAFE_OPS list, we instead
  // do the JOIN through `=` via the `value` array, which the runner
  // currently can't handle.
  //
  // Phase 1C compromise: we add a NEW operator-friendly path that accepts a
  // CSV-encoded value with op 'ILIKE' and a regex. That's hacky.
  //
  // CLEANEST SOLUTION (chosen): add a synthetic 'IN' op support to the runner
  // via a new SAFE_OPS entry; analytics-db.ts.buildWhere recognises it and
  // splits `value` (string CSV) into params. See lib/analytics-db.ts.
  const retryFilters: PreviewFilter[] = [
    ...campaign.filters,
    {
      column: campaign.fieldMap.subscriberIdColumn,
      // 'IN' is a new op added to SAFE_OPS for retry support.
      op: 'IN' as any,
      // Comma-separated list — buildWhere splits + binds per element.
      value: erroredRawIds.join(','),
    },
  ];

  // Run the fan-out with the retry filter override.
  let result;
  try {
    result = await runCampaignFanout({
      campaign,
      filterOverride: retryFilters,
      metadata: { triggeredBy: `retry-of-${runId}` },
    });
  } catch (e: any) {
    if (e instanceof NovuKeyMissing) {
      return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
    }
    return NextResponse.json(
      { ok: false, error: e?.message || 'retry failed' },
      { status: 500 },
    );
  }

  await updateCampaign(id, { status: deriveCampaignStatus(result) });

  return NextResponse.json({
    ok: true,
    runId: result.runId.toString(),
    retriedFrom: runId,
    erroredRowsTargeted: erroredRawIds.length,
    rowCount: result.rowCount,
    triggered: result.triggered,
    skipped: result.skipped,
    errored: result.errored,
    sample: result.perRow.slice(0, 5),
  });
}
