/**
 * Provider helpers — barrel export.
 *
 * Each helper:
 *   - Reads creds from env at module load time.
 *   - Throws a typed `XNotConfigured` error when env is missing.
 *   - Logs structured `provider_request` / `provider_response` JSON lines
 *     (auth headers redacted) so the audit trail captures every dispatch.
 *
 * The dispatch() layer in `../dispatch.ts` routes by channel and translates
 * NotConfigured errors into graceful `DispatchResult { ok: false, ... }`
 * outcomes so a single missing template_id doesn't fail the whole workflow.
 */

export * from './msg91';
export * from './icpaas';
export * from './email-ses';
