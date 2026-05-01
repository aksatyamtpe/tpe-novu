// /admin/api/campaigns — list + create.
//   GET   → all campaigns (most recently updated first)
//   POST  → create a new campaign draft
import { NextRequest, NextResponse } from 'next/server';
import { isAuthed } from '../../../lib/auth';
import { listCampaigns, createCampaign } from '../../../lib/campaigns';
import { ALLOWED_TABLES } from '../../../lib/analytics-db';

export const dynamic = 'force-dynamic';

function unauthorized() {
  return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
}

export async function GET(req: NextRequest) {
  if (!isAuthed(req)) return unauthorized();
  try {
    const items = await listCampaigns();
    return NextResponse.json({ ok: true, items });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || 'failed' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  if (!isAuthed(req)) return unauthorized();
  let body: any;
  try { body = await req.json(); }
  catch { return NextResponse.json({ ok: false, error: 'invalid JSON' }, { status: 400 }); }

  if (!body?.name?.trim()) {
    return NextResponse.json({ ok: false, error: 'name is required' }, { status: 400 });
  }
  if (!body.sourceTable || !(ALLOWED_TABLES as readonly string[]).includes(body.sourceTable)) {
    return NextResponse.json({ ok: false, error: 'sourceTable must be one of the allowed tables' }, { status: 400 });
  }
  if (!body.targetWorkflow?.trim()) {
    return NextResponse.json({ ok: false, error: 'targetWorkflow is required' }, { status: 400 });
  }
  if (!body.fieldMap?.subscriberIdColumn) {
    return NextResponse.json({ ok: false, error: 'fieldMap.subscriberIdColumn is required' }, { status: 400 });
  }

  try {
    const created = await createCampaign({
      name: String(body.name).trim(),
      description: body.description ? String(body.description) : undefined,
      sourceTable: body.sourceTable,
      filters: Array.isArray(body.filters) ? body.filters : [],
      targetWorkflow: String(body.targetWorkflow).trim(),
      fieldMap: {
        subscriberIdColumn: String(body.fieldMap.subscriberIdColumn),
        emailColumn:        body.fieldMap.emailColumn     ? String(body.fieldMap.emailColumn) : undefined,
        phoneColumn:        body.fieldMap.phoneColumn     ? String(body.fieldMap.phoneColumn) : undefined,
        firstNameColumn:    body.fieldMap.firstNameColumn ? String(body.fieldMap.firstNameColumn) : undefined,
        payload:            body.fieldMap.payload || {},
      },
      scheduledAt: body.scheduledAt || null,
      updatedBy: 'operator',
    });
    return NextResponse.json({ ok: true, campaign: created });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || 'create failed' }, { status: 500 });
  }
}
