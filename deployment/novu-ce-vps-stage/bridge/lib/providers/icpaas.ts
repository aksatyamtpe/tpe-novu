/**
 * ICPaaS WhatsApp Cloud API helper.
 *
 * Wraps the proven send pattern from `_test/tpe-multichannel-test.ts` so
 * dispatch() can call a single function instead of inlining the fetch in
 * every workflow.
 *
 * Endpoint: POST {ICPAAS_BASE_URL}/v23.0/{ICPAAS_PHONE_NUMBER_ID}/messages
 * Auth: `Authorization: Bearer <token>` (or doubled "Bearer Bearer" if
 *       ICPAAS_BEARER_DOUBLE=1, matching the provider's curl example).
 *
 * Charter mapping:
 *   - Per Charter §4.4 WhatsApp is a permitted channel; templates must be
 *     registered with Meta via the BSP (ICPaaS).
 *   - Currently `dynamictemp2` is the only template approved for the test
 *     subscriber `+919465185365` — its URL button requires a single text
 *     parameter, captured here as `buttonUrlParam`.
 */

const ICPAAS_BASE_URL = process.env.ICPAAS_BASE_URL || 'http://www.icpaas.in';
const ICPAAS_PHONE_NUMBER_ID = process.env.ICPAAS_PHONE_NUMBER_ID || '';
const ICPAAS_API_TOKEN = process.env.ICPAAS_API_TOKEN || '';
const ICPAAS_BEARER_DOUBLE = process.env.ICPAAS_BEARER_DOUBLE === '1';

export interface IcpaasComponentParam {
  type: 'text' | 'currency' | 'date_time' | 'image' | 'document';
  text?: string;
  [k: string]: unknown;
}

export interface IcpaasComponent {
  type: 'header' | 'body' | 'button';
  sub_type?: 'url' | 'quick_reply' | 'phone_number';
  index?: string;
  parameters?: IcpaasComponentParam[];
}

export interface SendWhatsAppTemplateOpts {
  /** Country-code-prefixed digits, e.g. '919465185365'. */
  to: string;
  /** Meta-approved template name, e.g. 'dynamictemp2'. */
  templateName: string;
  /** Defaults to 'en'. Per Charter §4.4 only 'en' / 'hi' are in scope. */
  languageCode?: 'en' | 'hi' | string;
  /** Override the default `[{type:'body', parameters:[]}]` component list. */
  components?: IcpaasComponent[];
  /**
   * Convenience: if templates use a single URL-button text param (the case
   * for `dynamictemp2`), pass it here to skip building components manually.
   */
  buttonUrlParam?: string;
  /** Forwarded to Meta as `biz_opaque_callback_data`. */
  opaqueCallback?: string;
}

export interface SendWhatsAppTemplateResult {
  /** Meta `wamid.*` returned by the BSP — primary correlation key. */
  wamid?: string;
  raw: unknown;
  httpStatus: number;
  ok: boolean;
}

export class IcpaasNotConfigured extends Error {
  constructor(missing: string[]) {
    super(`IcpaasNotConfigured: missing env ${missing.join(', ')}. ` +
      `Set in .env on the bridge container — see deployment guide §16.`);
    this.name = 'IcpaasNotConfigured';
  }
}

function assertConfigured(): void {
  const missing: string[] = [];
  if (!ICPAAS_API_TOKEN) missing.push('ICPAAS_API_TOKEN');
  if (!ICPAAS_PHONE_NUMBER_ID) missing.push('ICPAAS_PHONE_NUMBER_ID');
  if (missing.length > 0) throw new IcpaasNotConfigured(missing);
}

/**
 * Send a Meta-approved WhatsApp template via ICPaaS.
 *
 * @throws IcpaasNotConfigured if env is missing.
 * @throws Error on network failure.
 */
export async function sendWhatsAppTemplate(
  opts: SendWhatsAppTemplateOpts,
): Promise<SendWhatsAppTemplateResult> {
  assertConfigured();

  if (!opts.to) throw new Error('sendWhatsAppTemplate: opts.to is required.');
  if (!opts.templateName) throw new Error('sendWhatsAppTemplate: opts.templateName is required.');

  // Build components: explicit override > buttonUrlParam shorthand > default body-only.
  let components: IcpaasComponent[];
  if (opts.components) {
    components = opts.components;
  } else {
    components = [{ type: 'body', parameters: [] }];
    if (opts.buttonUrlParam) {
      components.push({
        type: 'button',
        sub_type: 'url',
        index: '0',
        parameters: [{ type: 'text', text: opts.buttonUrlParam }],
      });
    }
  }

  const auth = ICPAAS_BEARER_DOUBLE
    ? `Bearer Bearer ${ICPAAS_API_TOKEN}`
    : `Bearer ${ICPAAS_API_TOKEN}`;

  const url = `${ICPAAS_BASE_URL}/v23.0/${ICPAAS_PHONE_NUMBER_ID}/messages`;

  const body = {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: String(opts.to).replace(/[^0-9]/g, ''),
    type: 'template',
    template: {
      name: opts.templateName,
      language: { code: opts.languageCode ?? 'en' },
      components,
    },
    biz_opaque_callback_data: opts.opaqueCallback ?? '',
  };

  // eslint-disable-next-line no-console
  console.log(JSON.stringify({
    type: 'provider_request',
    provider: 'icpaas',
    endpoint: 'whatsapp/template',
    url,
    templateName: opts.templateName,
    languageCode: opts.languageCode ?? 'en',
    componentCount: components.length,
  }));

  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: auth,
    },
    body: JSON.stringify(body),
  });

  const respText = await resp.text();
  let parsed: unknown;
  try { parsed = JSON.parse(respText); }
  catch { parsed = { raw: respText.slice(0, 500) }; }

  // Meta-style success: `messages: [{ id: 'wamid.HBg...' }]`.
  let wamid: string | undefined;
  if (typeof parsed === 'object' && parsed !== null) {
    const messages = (parsed as Record<string, unknown>).messages;
    if (Array.isArray(messages) && messages.length > 0) {
      const first = messages[0] as Record<string, unknown>;
      if (typeof first.id === 'string') wamid = first.id;
    }
  }

  // eslint-disable-next-line no-console
  console.log(JSON.stringify({
    type: 'provider_response',
    provider: 'icpaas',
    endpoint: 'whatsapp/template',
    httpStatus: resp.status,
    ok: resp.ok,
    wamid: wamid ?? null,
  }));

  if (!resp.ok && !wamid) {
    // Surface error body in the thrown message so debugging is one-step.
    const summary = typeof parsed === 'object'
      ? JSON.stringify(parsed).slice(0, 300)
      : String(parsed).slice(0, 300);
    throw new Error(`IcpaasSendFailed: http ${resp.status} — ${summary}`);
  }

  return { wamid, raw: parsed, httpStatus: resp.status, ok: resp.ok };
}
