/**
 * Locale resolver. Charter §4.4 — English + Hindi for v1.
 * Regional Indian languages are a v2 initiative (out of scope per §4.12).
 *
 * Resolution order:
 *   1. payload.forceLocale (explicit upstream override)
 *   2. subscriber.data.locale (subscriber preference)
 *   3. 'en' (default)
 */

export type SupportedLocale = 'en' | 'hi';

export const SUPPORTED_LOCALES: readonly SupportedLocale[] = ['en', 'hi'] as const;

export function isSupportedLocale(x: unknown): x is SupportedLocale {
  return x === 'en' || x === 'hi';
}

export function resolveLocale(opts: {
  forceLocale?: string;
  subscriber?: {
    data?: { locale?: string; [k: string]: unknown } | null;
    locale?: string | null;
    [k: string]: unknown;
  } | null;
}): SupportedLocale {
  if (isSupportedLocale(opts.forceLocale)) return opts.forceLocale;
  const subDataLocale = opts.subscriber?.data?.locale;
  if (isSupportedLocale(subDataLocale)) return subDataLocale;
  // Some Novu CE bindings put locale at the top level of the subscriber.
  const subLocale = opts.subscriber?.locale;
  if (isSupportedLocale(subLocale)) return subLocale;
  return 'en';
}

/**
 * Look up a localized string from a small map. Falls back to `en` if the
 * locale entry is missing.
 *
 * Usage:
 *   const greeting = pickByLocale(locale, {
 *     en: `Hello, ${name}`,
 *     hi: `नमस्ते, ${name}`,
 *   });
 */
export function pickByLocale<T>(
  locale: SupportedLocale,
  map: Record<SupportedLocale, T>,
): T {
  return map[locale] ?? map.en;
}
