// CRUD on tpe_admin_templates.
import { NextRequest, NextResponse } from 'next/server';
import { ObjectId } from 'mongodb';
import { isAuthed } from '../../../lib/auth';
import { getDb, COLL_TEMPLATES } from '../../../lib/mongo';

export const dynamic = 'force-dynamic';

const VALID_CHANNELS = new Set(['email', 'inApp']);
const VALID_LANGS = new Set(['en', 'hi']);

function unauthorized() {
  return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
}

function shapeOut(d: any) {
  if (!d) return d;
  const { _id, ...rest } = d;
  return { _id: String(_id), ...rest };
}

function validate(input: any): { ok: true; doc: any } | { ok: false; error: string } {
  const out: any = {};
  if (typeof input?.name !== 'string' || !input.name.trim()) return { ok: false, error: 'name required' };
  out.name = String(input.name).trim();
  if (!VALID_CHANNELS.has(input?.channel)) return { ok: false, error: 'channel must be email or inApp' };
  out.channel = input.channel;
  if (typeof input?.subject !== 'string') return { ok: false, error: 'subject required' };
  out.subject = String(input.subject);
  if (typeof input?.htmlBody !== 'string') return { ok: false, error: 'htmlBody required' };
  out.htmlBody = String(input.htmlBody);
  if (input?.textBody != null) out.textBody = String(input.textBody);
  if (!VALID_LANGS.has(input?.language)) return { ok: false, error: 'language must be en or hi' };
  out.language = input.language;
  return { ok: true, doc: out };
}

export async function GET(req: NextRequest) {
  if (!isAuthed(req)) return unauthorized();
  const db = await getDb();
  const items = await db.collection(COLL_TEMPLATES)
    .find({})
    .sort({ updatedAt: -1, _id: -1 })
    .limit(200)
    .toArray();
  return NextResponse.json({ ok: true, items: items.map(shapeOut) });
}

export async function POST(req: NextRequest) {
  if (!isAuthed(req)) return unauthorized();
  const body = await req.json().catch(() => null);
  const v = validate(body);
  if (!v.ok) return NextResponse.json({ ok: false, error: v.error }, { status: 400 });
  const now = new Date();
  const doc = { ...v.doc, createdBy: 'admin', createdAt: now, updatedAt: now };
  const db = await getDb();
  const r = await db.collection(COLL_TEMPLATES).insertOne(doc as any);
  return NextResponse.json({ ok: true, _id: String(r.insertedId), item: shapeOut({ ...doc, _id: r.insertedId }) }, { status: 201 });
}

export async function PATCH(req: NextRequest) {
  if (!isAuthed(req)) return unauthorized();
  const id = req.nextUrl.searchParams.get('id');
  if (!id) return NextResponse.json({ ok: false, error: 'id required' }, { status: 400 });
  let _id: ObjectId;
  try { _id = new ObjectId(id); } catch { return NextResponse.json({ ok: false, error: 'bad id' }, { status: 400 }); }
  const body = await req.json().catch(() => null);
  const v = validate(body);
  if (!v.ok) return NextResponse.json({ ok: false, error: v.error }, { status: 400 });
  const db = await getDb();
  const r = await db.collection(COLL_TEMPLATES).findOneAndUpdate(
    { _id },
    { $set: { ...v.doc, updatedAt: new Date() } },
    { returnDocument: 'after' },
  );
  if (!r) return NextResponse.json({ ok: false, error: 'not found' }, { status: 404 });
  return NextResponse.json({ ok: true, item: shapeOut(r) });
}

export async function DELETE(req: NextRequest) {
  if (!isAuthed(req)) return unauthorized();
  const id = req.nextUrl.searchParams.get('id');
  if (!id) return NextResponse.json({ ok: false, error: 'id required' }, { status: 400 });
  let _id: ObjectId;
  try { _id = new ObjectId(id); } catch { return NextResponse.json({ ok: false, error: 'bad id' }, { status: 400 }); }
  const db = await getDb();
  const r = await db.collection(COLL_TEMPLATES).deleteOne({ _id });
  return NextResponse.json({ ok: true, deleted: r.deletedCount });
}
