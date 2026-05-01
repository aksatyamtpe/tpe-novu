// =============================================================================
// Channel allowlist (per-channel enable / disable, operator-managed).
//
// Source of truth: the `tpe_channel_gating` Mongo collection, which holds a
// single doc keyed `_id: 'singleton'` written by the admin /admin/channels
// page. Bridge-side workflows read it through `isChannelEnabled(channel)`
// with a short in-memory cache so the dispatch hot path stays fast.
//
// Fallback chain when Mongo is unreachable / empty:
//   1. cached value (last successful read)
//   2. TPE_ENABLED_CHANNELS env var (comma-separated list)
//   3. all four channels enabled (most permissive — matches pre-feature behaviour)
//
// Cache TTL: 10s. The admin UI doesn't need millisecond freshness; an operator
// flipping a checkbox sees the change in under 10s.
// =============================================================================
import { getDb, COLL_CHANNEL_GATING } from './mongo';
import type { Channel } from './types';

export const ALL_CHANNELS = ['sms', 'whatsapp', 'email', 'in_app'] as const;
export type GateableChannel = (typeof ALL_CHANNELS)[number];

export interface ChannelGatingDoc {
  _id: 'singleton';
  /** True = channel allowed, false = blocked. Missing key = default true. */
  enabled: Partial<Record<GateableChannel, boolean>>;
  /** ISO timestamp of last operator update. */
  updatedAt?: string;
  /** Free-form note; the admin UI writes "stage default" / operator login etc. */
  updatedBy?: string;
}

const CACHE_TTL_MS = 10_000;

let cache: { value: Set<GateableChannel>; ts: number } | null = null;

/**
 * Returns the SET of channels currently allowed to dispatch.
 * Cached for `CACHE_TTL_MS` so dispatch.ts stays cheap on the hot path.
 */
export async function getEnabledChannels(): Promise<Set<GateableChannel>> {
  if (cache && Date.now() - cache.ts < CACHE_TTL_MS) {
    return cache.value;
  }
  const fresh = await loadFromMongoOrFallback();
  cache = { value: fresh, ts: Date.now() };
  return fresh;
}

/** Synchronous helper: maps the input channel string to the gating key. */
function normalize(channel: Channel | string): GateableChannel | null {
  // Novu uses 'in_app' in some surfaces and 'in-app' in others.
  if (channel === 'in-app' || channel === 'inApp') return 'in_app';
  if ((ALL_CHANNELS as readonly string[]).includes(channel)) return channel as GateableChannel;
  return null;
}

/** Returns true iff the operator has the channel enabled (or hasn't set it). */
export async function isChannelEnabled(channel: Channel | string): Promise<boolean> {
  const key = normalize(channel);
  // Unknown / unsupported channels: default permissive.
  if (!key) return true;
  const enabled = await getEnabledChannels();
  return enabled.has(key);
}

/**
 * Skip-callback for `step.inApp(name, builder, { skip: inAppSkipUnlessEnabled })`.
 * Returns true (skip the step) when the in_app channel is gated off.
 */
export async function inAppSkipUnlessEnabled(): Promise<boolean> {
  return !(await isChannelEnabled('in_app'));
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

async function loadFromMongoOrFallback(): Promise<Set<GateableChannel>> {
  // 1) Try Mongo.
  try {
    const db = await getDb();
    const doc = (await db.collection<ChannelGatingDoc>(COLL_CHANNEL_GATING)
      .findOne({ _id: 'singleton' })) as ChannelGatingDoc | null;
    if (doc?.enabled) {
      return setFromEnabledMap(doc.enabled);
    }
  } catch (e) {
    // Swallow — fall through to env / default. Don't crash dispatch on a
    // momentary Mongo blip.
    // eslint-disable-next-line no-console
    console.warn('[channel-gating] Mongo read failed, falling back to env:',
      e instanceof Error ? e.message : e);
  }

  // 2) Try env.
  const envList = (process.env.TPE_ENABLED_CHANNELS || '')
    .split(',').map((s) => s.trim()).filter(Boolean);
  if (envList.length > 0) {
    const set = new Set<GateableChannel>();
    for (const v of envList) {
      const k = normalize(v);
      if (k) set.add(k);
    }
    return set;
  }

  // 3) Permissive default.
  return new Set<GateableChannel>(ALL_CHANNELS);
}

function setFromEnabledMap(map: Partial<Record<GateableChannel, boolean>>): Set<GateableChannel> {
  const set = new Set<GateableChannel>();
  for (const ch of ALL_CHANNELS) {
    // Missing key defaults to false ONLY when the doc exists — explicit operator
    // intent. If you want a permissive default, write { sms: true, ... } from the UI.
    if (map[ch] === true) set.add(ch);
  }
  return set;
}
