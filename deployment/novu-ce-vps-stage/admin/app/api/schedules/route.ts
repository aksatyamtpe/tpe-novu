// CRUD on tpe_scheduled_triggers (PATCH not in MVP; cancel via DELETE pre-fire).
import { NextRequest, NextResponse } from 'next/server';
import { ObjectId } from 'mongodb';
import { isAuthed } from '../../../lib/auth';
import { getDb, COLL_SCHEDULES } from '../../../lib/mongo';

export const dynamic = 'force-dynamic';

function unauthorized() { return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 }); }

function shapeOut(d: any) {
  if (!d) return d;
  const { _id, fireAt, firedAt, createdAt, ...rest } = d;
  return {
    _id: String(_id),
    ...rest,
    fireAt: fireAt instanceof Date ? fireAt.toISOString() : fireAt,
    firedAt: firedAt instanceof Date ? firedAt.toISOString() : firedAt,
    createdAt: createdAt instanceof Date ? createdAt.toISOString() : createdAt,
  };
}

export async function GET(req: NextRequest) {
  if (!isAuthed(req)) return unauthorized();
  const db = await getDb();
  const items = await db.collection(COLL_SCHEDULES)
    .find({})
    .sort({ fireAt: -1 })
    .limit(200)
    .toArray();
  return NextResponse.json({ ok: true, items: items.map(shapeOut) });
}

export async function POST(req: NextRequest) {
  if (!isAuthed(req)) return unauthorized();
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== 'object') return NextResponse.json({ ok: false, error: 'body required' }, { status: 400 });
  if (typeof body.workflowName !== 'string' || !body.workflowName.trim())
    return NextResponse.json({ ok: false, error: 'workflowName required' }, { status: 400 });
  if (typeof body.subscriberId !== 'string' || !body.subscriberId.trim())
    return NextResponse.json({ ok: false, error: 'subscriberId required' }, { status: 400 });
  if (!body.fireAt) return NextResponse.json({ ok: false, error: 'fireAt required' }, { status: 400 });
  const fireAt = new Date(body.fireAt);
  if (Number.isNaN(fireAt.getTime())) return NextResponse.json({ ok: false, error: 'fireAt must be ISO date' }, { status: 400 });
  const payload = (body.payload && typeof body.payload === 'object') ? body.payload : {};
  const doc: any = {
    workflowName: body.workflowName.trim(),
    subscriberId: body.subscriberId.trim(),
    payload,
    fireAt,
    status: 'pending',
    createdBy: 'admin',
    createdAt: new Date(),
  };
  const db = await getDb();
  const r = await db.collection(COLL_SCHEDULES).insertOne(doc);
  return NextResponse.json({ ok: true, _id: String(r.insertedId), item: shapeOut({ ...doc, _id: r.insertedId }) }, { status: 201 });
}

export async function DELETE(req: NextRequest) {
  if (!isAuthed(req)) return unauthorized();
  const id = req.nextUrl.searchParams.get('id');
  if (!id) return NextResponse.json({ ok: false, error: 'id required' }, { status: 400 });
  let _id: ObjectId;
  try { _id = new ObjectId(id); } catch { return NextResponse.json({ ok: false, error: 'bad id' }, { status: 400 }); }
  const db = await getDb();
  // Only cancel if still pending; otherwise return current state for inspection.
  const r = await db.collection(COLL_SCHEDULES).deleteOne({ _id, status: 'pending' });
  return NextResponse.json({ ok: true, deleted: r.deletedCount });
}
