import { NextRequest, NextResponse } from 'next/server';
import { clearSessionCookie } from '../../../lib/auth';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  clearSessionCookie();
  // Same reasoning as /admin/api/login: a relative Location header lets the
  // browser resolve against the public origin instead of the internal docker URL.
  return new NextResponse(null, {
    status: 303,
    headers: { Location: '/admin' },
  });
}
