// POST /admin/api/campaigns/[id]/dispatch-now
//
// On-demand campaign fan-out. Delegates to lib/campaign-runner so the loop,
// throttling, payload assembly, and run-recording are shared with the worker
// (scheduled fire) and the retry route.
import { NextRequest, NextResponse } from 'next/server';
import { isAuthed } from '../../../../../lib/auth';
import { getCampaign, updateCampaign } from '../../../../../lib/campaigns';
import { runCampaignFanout, deriveCampaignStatus, NovuKeyMissing } from '../../../../../lib/campaign-runner';

export const dynamic = 'force-dynamic';

function unauthorized() {
  return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
}

export async function POST(req: NextRequest, ctx: { params: { id: string } }) {
  if (!isAuthed(req)) return unauthorized();

  const campaign = await getCampaign(ctx.params.id);
  if (!campaign) return NextResponse.json({ ok: false, error: 'campaign not found' }, { status: 404 });

  let result;
  try {
    result = await runCampaignFanout({
      campaign,
      metadata: { triggeredBy: 'ui-dispatch-now' },
    });
  } catch (e: any) {
    if (e instanceof NovuKeyMissing) {
      return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
    }
    return NextResponse.json(
      { ok: false, error: e?.message || 'fan-out failed' },
      { status: 500 },
    );
  }

  await updateCampaign(ctx.params.id, { status: deriveCampaignStatus(result) });

  return NextResponse.json({
    ok: true,
    runId: result.runId.toString(),
    rowCount: result.rowCount,
    triggered: result.triggered,
    skipped: result.skipped,
    errored: result.errored,
    sample: result.perRow.slice(0, 5),
  });
}
