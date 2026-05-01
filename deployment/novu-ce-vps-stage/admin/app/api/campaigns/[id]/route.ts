// /admin/api/campaigns/[id] — single-campaign GET / PATCH / DELETE.
import { NextRequest, NextResponse } from 'next/server';
import { isAuthed } from '../../../../lib/auth';
import {
  getCampaign, updateCampaign, deleteCampaign, listRecentRuns,
} from '../../../../lib/campaigns';

export const dynamic = 'force-dynamic';

function unauthorized() {
  return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
}

export async function GET(req: NextRequest, ctx: { params: { id: string } }) {
  if (!isAuthed(req)) return unauthorized();
  try {
    const campaign = await getCampaign(ctx.params.id);
    if (!campaign) return NextResponse.json({ ok: false, error: 'not found' }, { status: 404 });
    // Default 25 — enough for the run-history page; the campaigns list only
    // peeks at runs[0] anyway.
    const runs = await listRecentRuns(ctx.params.id, 25);
    return NextResponse.json({ ok: true, campaign, runs });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || 'failed' }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest, ctx: { params: { id: string } }) {
  if (!isAuthed(req)) return unauthorized();
  let body: any;
  try { body = await req.json(); }
  catch { return NextResponse.json({ ok: false, error: 'invalid JSON' }, { status: 400 }); }
  try {
    const updated = await updateCampaign(ctx.params.id, { ...body, updatedBy: 'operator' });
    if (!updated) return NextResponse.json({ ok: false, error: 'not found' }, { status: 404 });
    return NextResponse.json({ ok: true, campaign: updated });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || 'update failed' }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, ctx: { params: { id: string } }) {
  if (!isAuthed(req)) return unauthorized();
  try {
    const ok = await deleteCampaign(ctx.params.id);
    if (!ok) return NextResponse.json({ ok: false, error: 'not found' }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || 'delete failed' }, { status: 500 });
  }
}
