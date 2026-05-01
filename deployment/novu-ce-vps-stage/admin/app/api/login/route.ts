// POST /admin/api/login — accepts JSON {password} or form-encoded body.
// On success: sets the HTTP-only session cookie and 302s back to /admin (so a
// browser form submit lands the operator on the dashboard).
import { NextRequest, NextResponse } from 'next/server';
import { checkPassword, setSessionCookie } from '../../../lib/auth';

export const dynamic = 'force-dynamic';

async function readPassword(req: NextRequest): Promise<string> {
  const ct = req.headers.get('content-type') || '';
  if (ct.includes('application/json')) {
    try { const b = await req.json(); return String(b?.password || ''); } catch { return ''; }
  }
  const form = await req.formData().catch(() => null);
  if (form) return String(form.get('password') || '');
  return '';
}

export async function POST(req: NextRequest) {
  const pw = await readPassword(req);
  if (!checkPassword(pw)) {
    return NextResponse.json({ ok: false, error: 'invalid password' }, { status: 401 });
  }
  setSessionCookie();
  // If the client sent JSON, give them JSON. Otherwise redirect to /admin.
  const ct = req.headers.get('content-type') || '';
  if (ct.includes('application/json')) {
    return NextResponse.json({ ok: true });
  }
  // Relative Location header — the browser resolves against the current
  // page origin, so behind a reverse-proxy this lands at the public hostname.
  // Using `new URL('/admin', req.url)` here would resolve against the Next.js
  // server's internal docker URL (0.0.0.0:3500), giving the user
  // ERR_CONNECTION_REFUSED.
  return new NextResponse(null, {
    status: 303,
    headers: { Location: '/admin' },
  });
}
