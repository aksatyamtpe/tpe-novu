/**
 * MSG91 v5 Flow API helper.
 *
 * Why v5 not v2:
 *   The earlier `tpe-multichannel-test` workflow uses MSG91's `/api/v2/sendsms`
 *   endpoint — that path silently drops sends whose body doesn't match a DLT-
 *   registered template. The v5 Flow API requires a `template_id` referencing
 *   a pre-approved DLT template, so the success/failure mode is explicit
 *   instead of "tracking ID returned, no SMS ever delivered".
 *
 * Endpoint: POST {MSG91_BASE_URL_V5}/api/v5/flow/
 * Auth header: `authkey: $MSG91_AUTH_KEY`
 *
 * Charter mapping:
 *   - DLT template_id is sourced per-trigger via env (e.g. MSG91_OTP_TEMPLATE_ID
 *     for PH-02). The dispatch layer picks the right env var based on triggerId.
 *   - Per Charter §4.5 the failover order is Gupshup → MSG91 → Karix; this
 *     module is the MSG91 leg. Failover orchestration belongs in dispatch().
 */

const MSG91_BASE_URL_V5 = process.env.MSG91_BASE_URL_V5 || 'https://control.msg91.com';
const MSG91_AUTH_KEY = process.env.MSG91_AUTH_KEY || '';

export interface Msg91Recipient {
  /** Country-code-prefixed digits, e.g. '919465185365'. */
  mobile: string;
  /** Template variable substitutions: `{ var1: '123456', name: 'Aman' }`. */
  vars?: Record<string, string>;
}

export interface SendSmsViaFlowOpts {
  /** DLT-approved MSG91 template_id (from MSG91 dashboard → Flows). */
  templateId: string;
  recipients: Msg91Recipient[];
  /** Optional MSG91 short-URL service flag. */
  shortUrl?: '0' | '1';
  /** Idempotency key for retry-safe sends; MSG91 supports this header. */
  idempotencyKey?: string;
}

export interface SendSmsViaFlowResult {
  /** MSG91-issued request_id; primary correlation key for status lookups. */
  requestId?: string;
  /** Raw response body (parsed JSON when possible, else { raw: text }). */
  raw: unknown;
  httpStatus: number;
  ok: boolean;
}

export interface Msg91DeliveryStatus {
  requestId: string;
  status: string;
  raw: unknown;
}

export class Msg91NotConfigured extends Error {
  constructor(missing: string[]) {
    super(`MSG91NotConfigured: missing env ${missing.join(', ')}. ` +
      `Set in .env on the bridge container — see deployment guide §16.`);
    this.name = 'Msg91NotConfigured';
  }
}

function assertConfigured(): void {
  const missing: string[] = [];
  if (!MSG91_AUTH_KEY) missing.push('MSG91_AUTH_KEY');
  if (missing.length > 0) throw new Msg91NotConfigured(missing);
}

/**
 * Dispatch one or more SMS messages through MSG91's v5 Flow endpoint.
 *
 * @throws Msg91NotConfigured if MSG91_AUTH_KEY is unset.
 * @throws Error on network failure (fetch reject).
 */
export async function sendSmsViaFlow(opts: SendSmsViaFlowOpts): Promise<SendSmsViaFlowResult> {
  assertConfigured();

  if (!opts.templateId) {
    throw new Error('sendSmsViaFlow: opts.templateId is required (DLT template_id from MSG91 dashboard).');
  }
  if (!opts.recipients || opts.recipients.length === 0) {
    throw new Error('sendSmsViaFlow: opts.recipients must be a non-empty array.');
  }

  const url = `${MSG91_BASE_URL_V5}/api/v5/flow/`;
  const body = {
    template_id: opts.templateId,
    short_url: opts.shortUrl ?? '0',
    recipients: opts.recipients.map((r) => ({
      mobiles: String(r.mobile).replace(/[^0-9]/g, ''),
      ...(r.vars ?? {}),
    })),
  };

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    accept: 'application/json',
    authkey: MSG91_AUTH_KEY,
  };
  if (opts.idempotencyKey) headers['x-idempotency-key'] = opts.idempotencyKey;

  // Structured pre-send log (auth header redacted).
  // eslint-disable-next-line no-console
  console.log(JSON.stringify({
    type: 'provider_request',
    provider: 'msg91',
    endpoint: 'v5/flow',
    url,
    templateId: opts.templateId,
    recipientCount: opts.recipients.length,
    idempotencyKey: opts.idempotencyKey ?? null,
  }));

  const resp = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });

  const respText = await resp.text();
  let parsed: unknown;
  try { parsed = JSON.parse(respText); }
  catch { parsed = { raw: respText.slice(0, 500) }; }

  const requestId =
    typeof parsed === 'object' && parsed !== null && 'request_id' in parsed
      ? String((parsed as Record<string, unknown>).request_id)
      : undefined;

  // Structured post-send log.
  // eslint-disable-next-line no-console
  console.log(JSON.stringify({
    type: 'provider_response',
    provider: 'msg91',
    endpoint: 'v5/flow',
    httpStatus: resp.status,
    ok: resp.ok,
    requestId: requestId ?? null,
  }));

  return { requestId, raw: parsed, httpStatus: resp.status, ok: resp.ok };
}

/**
 * Look up delivery status for a previously sent message by request_id.
 * Uses MSG91 v5 reports endpoint.
 */
export async function lookupDeliveryStatus(requestId: string): Promise<Msg91DeliveryStatus> {
  assertConfigured();
  if (!requestId) throw new Error('lookupDeliveryStatus: requestId is required.');

  const url = `${MSG91_BASE_URL_V5}/api/v5/report/${encodeURIComponent(requestId)}/`;
  const resp = await fetch(url, {
    method: 'GET',
    headers: {
      accept: 'application/json',
      authkey: MSG91_AUTH_KEY,
    },
  });

  const respText = await resp.text();
  let parsed: unknown;
  try { parsed = JSON.parse(respText); }
  catch { parsed = { raw: respText.slice(0, 500) }; }

  const status =
    typeof parsed === 'object' && parsed !== null && 'status' in parsed
      ? String((parsed as Record<string, unknown>).status)
      : `http_${resp.status}`;

  return { requestId, status, raw: parsed };
}
