// =============================================================================
// Auth — single shared password, HTTP-only cookie session.
// MVP only; v2 should replace with JWT + roles + per-operator audit.
// =============================================================================
import { cookies } from 'next/headers';
import { NextRequest } from 'next/server';

const COOKIE_NAME = 'tpe_admin_session';
const SESSION_TTL_HOURS = 12;

function expectedPassword(): string {
  return process.env.TPE_ADMIN_PASSWORD || 'tpe-stage-2026';
}

function sessionToken(): string {
  // Static token — derived from the password so changing the env var
  // invalidates all live sessions. Good enough for MVP.
  const pw = expectedPassword();
  // simple non-crypto digest; fine for shared-password MVP
  let h = 5381;
  for (let i = 0; i < pw.length; i++) h = ((h << 5) + h) ^ pw.charCodeAt(i);
  return 'v1.' + Math.abs(h).toString(36) + '.' + Buffer.from(pw).toString('base64url').slice(0, 8);
}

export function checkPassword(input: string): boolean {
  return typeof input === 'string' && input.length > 0 && input === expectedPassword();
}

export function setSessionCookie() {
  const c = cookies();
  c.set(COOKIE_NAME, sessionToken(), {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    secure: false, // Caddy fronts plain HTTP on stage
    maxAge: SESSION_TTL_HOURS * 60 * 60,
  });
}

export function clearSessionCookie() {
  cookies().delete(COOKIE_NAME);
}

export function isAuthed(req?: NextRequest): boolean {
  const expected = sessionToken();
  if (req) {
    const got = req.cookies.get(COOKIE_NAME)?.value;
    return got === expected;
  }
  const got = cookies().get(COOKIE_NAME)?.value;
  return got === expected;
}

export const COOKIE = COOKIE_NAME;
