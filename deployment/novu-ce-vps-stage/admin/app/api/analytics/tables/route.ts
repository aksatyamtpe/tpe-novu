// /admin/api/analytics/tables — whitelist of campaign-buildable tables.
import { NextRequest, NextResponse } from 'next/server';
import { isAuthed } from '../../../../lib/auth';
import { listTables } from '../../../../lib/analytics-db';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  if (!isAuthed(req)) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  try {
    const tables = await listTables();
    return NextResponse.json({ ok: true, tables });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || 'failed' }, { status: 500 });
  }
}
