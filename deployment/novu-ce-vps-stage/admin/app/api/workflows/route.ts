// Proxies Novu /v1/workflows so the schedule-create form can pick a workflow.
import { NextRequest, NextResponse } from 'next/server';
import { isAuthed } from '../../../lib/auth';
import { novuGet } from '../../../lib/novu';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  if (!isAuthed(req)) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  const r = await novuGet('/v1/workflows', { limit: '50' });
  if (!r.ok) return NextResponse.json({ ok: false, error: 'novu api ' + r.status, body: r.body }, { status: 502 });
  const raw = r.body?.data || r.body?.workflows || r.body?.items || [];
  const items = (raw as any[]).map((w) => ({
    workflowId: w.workflowId || w.identifier || w.triggers?.[0]?.identifier || w._id,
    name: w.name || w.workflowId || '',
    _id: w._id,
  })).filter((w) => w.workflowId);
  return NextResponse.json({ ok: true, items });
}
