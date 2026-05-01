// /admin/api/channel-gating — operator-managed channel allowlist.
//   GET  → returns the singleton doc (or the stage default if none exists yet)
//   PUT  → updates the singleton with `{ enabled: { sms, whatsapp, email, in_app } }`
import { NextRequest, NextResponse } from 'next/server';
import { isAuthed } from '../../../lib/auth';
import { getChannelGating, setChannelGating, ALL_CHANNELS } from '../../../lib/channel-gating';

export const dynamic = 'force-dynamic';

function unauthorized() {
  return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
}

export async function GET(req: NextRequest) {
  if (!isAuthed(req)) return unauthorized();
  try {
    const doc = await getChannelGating();
    return NextResponse.json({ ok: true, gating: doc });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || 'failed to read channel gating' },
      { status: 500 },
    );
  }
}

export async function PUT(req: NextRequest) {
  if (!isAuthed(req)) return unauthorized();
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid JSON' }, { status: 400 });
  }
  if (!body?.enabled || typeof body.enabled !== 'object') {
    return NextResponse.json(
      { ok: false, error: 'expected body shape: { enabled: { sms, whatsapp, email, in_app } }' },
      { status: 400 },
    );
  }
  // Reject any unknown keys to keep the schema tight.
  const incoming = body.enabled as Record<string, unknown>;
  for (const k of Object.keys(incoming)) {
    if (!(ALL_CHANNELS as readonly string[]).includes(k)) {
      return NextResponse.json(
        { ok: false, error: `unknown channel: ${k}` },
        { status: 400 },
      );
    }
  }
  try {
    const doc = await setChannelGating({
      sms: !!incoming.sms,
      whatsapp: !!incoming.whatsapp,
      email: !!incoming.email,
      in_app: !!incoming.in_app,
    });
    return NextResponse.json({ ok: true, gating: doc });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || 'failed to write channel gating' },
      { status: 500 },
    );
  }
}
