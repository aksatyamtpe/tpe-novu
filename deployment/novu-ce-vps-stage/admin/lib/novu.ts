// =============================================================================
// Thin wrapper for the Novu REST API used by /api/history and /api/workflows.
// Only GETs from the UI process; the worker does its own POST /v1/events/trigger.
// =============================================================================
const API_URL = process.env.NOVU_API_URL || 'http://api:3000';
const API_KEY = process.env.NOVU_API_KEY || '';

function authHeaders(): Record<string, string> {
  return {
    Authorization: `ApiKey ${API_KEY}`,
    'Content-Type': 'application/json',
  };
}

export async function novuGet(path: string, qs?: Record<string, string>): Promise<any> {
  const url = new URL(API_URL + path);
  if (qs) for (const [k, v] of Object.entries(qs)) url.searchParams.set(k, v);
  const res = await fetch(url.toString(), { headers: authHeaders(), cache: 'no-store' });
  const text = await res.text();
  let body: any = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = { raw: text }; }
  if (!res.ok) {
    return { ok: false, status: res.status, body };
  }
  return { ok: true, status: res.status, body };
}
