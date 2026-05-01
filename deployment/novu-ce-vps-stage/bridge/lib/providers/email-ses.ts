/**
 * Amazon SES email helper — wired to AWS SDK v2 (Node).
 *
 * Per Charter §4.4 + provider_strategy.md: SES with `no-reply@<domain>` sender,
 * DKIM/SPF/DMARC, SNS-driven bounce/complaint handling.
 *
 * Configuration (env-driven):
 *   EMAIL_SES_REGION                ap-south-1 (Mumbai — required for DPDPA residency)
 *   EMAIL_SES_ACCESS_KEY_ID         from IAM user with ses:SendEmail / ses:SendRawEmail
 *   EMAIL_SES_SECRET_ACCESS_KEY     paired secret
 *   EMAIL_SES_FROM_EMAIL            verified sender (or any *@verified-domain)
 *   EMAIL_SES_FROM_NAME             friendly display name (e.g. "TPE Customer Care")
 *
 * Sandbox caveat: until SES production access is granted, recipients must be
 * pre-verified. Verify your test inbox via SES → Verified identities → Email.
 *
 * TODO when prod-ready:
 *   - Wire SNS bounce/complaint topic → Lambda → Novu PATCH /v1/subscribers/{id}.
 *   - Move credentials from .env to AWS Secrets Manager (per Charter §11.3).
 */
import { SESv2Client, SendEmailCommand } from '@aws-sdk/client-sesv2';

const EMAIL_SES_REGION = process.env.EMAIL_SES_REGION || '';
const EMAIL_SES_ACCESS_KEY_ID = process.env.EMAIL_SES_ACCESS_KEY_ID || '';
const EMAIL_SES_SECRET_ACCESS_KEY = process.env.EMAIL_SES_SECRET_ACCESS_KEY || '';
const EMAIL_SES_FROM_EMAIL = process.env.EMAIL_SES_FROM_EMAIL || '';
const EMAIL_SES_FROM_NAME = process.env.EMAIL_SES_FROM_NAME || '';

export interface SendEmailViaSesOpts {
  to: string;
  /** Optional override of the registered From identity. */
  fromEmail?: string;
  fromName?: string;
  subject: string;
  htmlBody: string;
  /** Optional plain-text fallback. SES generates one if omitted. */
  textBody?: string;
  /** Reply-To header. Optional. */
  replyTo?: string;
  /** Tags forwarded to SES `Tags` for cost allocation. */
  tags?: Array<{ name: string; value: string }>;
}

export interface SendEmailViaSesResult {
  /** SES MessageId, format e.g. `0100018f...`. */
  messageId: string;
  raw: unknown;
}

export class SesNotConfigured extends Error {
  constructor(missing: string[]) {
    super(`SesNotConfigured: missing env ${missing.join(', ')}. ` +
      `SES creds have not been provisioned yet — see lib/providers/email-ses.ts wiring plan.`);
    this.name = 'SesNotConfigured';
  }
}

function checkConfigured(): string[] {
  const missing: string[] = [];
  if (!EMAIL_SES_REGION) missing.push('EMAIL_SES_REGION');
  if (!EMAIL_SES_ACCESS_KEY_ID) missing.push('EMAIL_SES_ACCESS_KEY_ID');
  if (!EMAIL_SES_SECRET_ACCESS_KEY) missing.push('EMAIL_SES_SECRET_ACCESS_KEY');
  if (!EMAIL_SES_FROM_EMAIL) missing.push('EMAIL_SES_FROM_EMAIL');
  return missing;
}

export function isSesConfigured(): boolean {
  return checkConfigured().length === 0;
}

/** Lazily-initialised SES client (so missing-config errors short-circuit before construction). */
let _client: SESv2Client | null = null;
function getClient(): SESv2Client {
  if (_client) return _client;
  _client = new SESv2Client({
    region: EMAIL_SES_REGION,
    credentials: {
      accessKeyId: EMAIL_SES_ACCESS_KEY_ID,
      secretAccessKey: EMAIL_SES_SECRET_ACCESS_KEY,
    },
  });
  return _client;
}

export async function sendEmailViaSes(opts: SendEmailViaSesOpts): Promise<SendEmailViaSesResult> {
  const missing = checkConfigured();
  if (missing.length > 0) {
    // eslint-disable-next-line no-console
    console.log(JSON.stringify({
      type: 'provider_request_skipped',
      provider: 'email-ses',
      reason: 'SesNotConfigured',
      missing,
      to: opts.to,
      subject: opts.subject,
    }));
    throw new SesNotConfigured(missing);
  }

  const fromEmail = opts.fromEmail ?? EMAIL_SES_FROM_EMAIL;
  const fromName = opts.fromName ?? EMAIL_SES_FROM_NAME;
  const fromHeader = fromName ? `${fromName} <${fromEmail}>` : fromEmail;

  // eslint-disable-next-line no-console
  console.log(JSON.stringify({
    type: 'provider_request',
    provider: 'email-ses',
    region: EMAIL_SES_REGION,
    from: fromEmail,
    to: opts.to,
    subject: opts.subject,
    bytes: opts.htmlBody.length,
  }));

  try {
    const cmd = new SendEmailCommand({
      FromEmailAddress: fromHeader,
      Destination: { ToAddresses: [opts.to] },
      Content: {
        Simple: {
          Subject: { Data: opts.subject, Charset: 'UTF-8' },
          Body: {
            Html: { Data: opts.htmlBody, Charset: 'UTF-8' },
            ...(opts.textBody
              ? { Text: { Data: opts.textBody, Charset: 'UTF-8' } }
              : {}),
          },
        },
      },
      ReplyToAddresses: opts.replyTo ? [opts.replyTo] : undefined,
      EmailTags: opts.tags?.map((t) => ({ Name: t.name, Value: t.value })),
    });

    const resp = await getClient().send(cmd);

    // eslint-disable-next-line no-console
    console.log(JSON.stringify({
      type: 'provider_response',
      provider: 'email-ses',
      ok: true,
      messageId: resp.MessageId ?? null,
    }));

    return { messageId: resp.MessageId ?? '', raw: resp };
  } catch (err) {
    const e = err as { name?: string; message?: string; $metadata?: { httpStatusCode?: number } };
    // eslint-disable-next-line no-console
    console.log(JSON.stringify({
      type: 'provider_response',
      provider: 'email-ses',
      ok: false,
      errorName: e?.name,
      errorMessage: e?.message,
      httpStatus: e?.$metadata?.httpStatusCode,
    }));
    throw err;
  }
}
