// Proxies Novu /v1/notifications. Read-only; no caching.
import { NextRequest, NextResponse } from 'next/server';
import { isAuthed } from '../../../lib/auth';
import { novuGet } from '../../../lib/novu';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  if (!isAuthed(req)) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  const r = await novuGet('/v1/notifications', { page: '0' });
  if (!r.ok) {
    return NextResponse.json({ ok: false, error: 'novu api ' + r.status, body: r.body }, { status: 502 });
  }
  // Novu's response shape: { data: [...], totalCount, pageSize, page }
  const items = r.body?.data || r.body?.items || [];
  return NextResponse.json({ ok: true, items, total: r.body?.totalCount ?? items.length });
}
