// POST /admin/api/analytics/preview — count + sample rows for a candidate
// audience. Body: { table, filters?: PreviewFilter[], limit? }
import { NextRequest, NextResponse } from 'next/server';
import { isAuthed } from '../../../../lib/auth';
import { previewRows, ALLOWED_TABLES, type AllowedTable } from '../../../../lib/analytics-db';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  if (!isAuthed(req)) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  let body: any;
  try { body = await req.json(); }
  catch { return NextResponse.json({ ok: false, error: 'invalid JSON' }, { status: 400 }); }

  const table = body?.table;
  if (!table || !(ALLOWED_TABLES as readonly string[]).includes(table)) {
    return NextResponse.json({ ok: false, error: 'table not in allowlist' }, { status: 400 });
  }
  try {
    const result = await previewRows({
      table: table as AllowedTable,
      filters: Array.isArray(body.filters) ? body.filters : [],
      limit: typeof body.limit === 'number' ? body.limit : 25,
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || 'preview failed' },
      { status: 500 },
    );
  }
}
