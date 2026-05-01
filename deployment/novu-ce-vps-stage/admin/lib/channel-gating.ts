// =============================================================================
// Admin-side channel-gating helpers — read + write the singleton doc that
// the bridge consumes via its own lib/channel-gating.ts.
//
// Collection: tpe_channel_gating  (Mongo). One doc, _id: 'singleton'.
// Schema:
//   {
//     _id: 'singleton',
//     enabled: { sms: true, whatsapp: true, email: false, in_app: false },
//     updatedAt: ISO string,
//     updatedBy: 'operator' | string,
//   }
// =============================================================================
import { getDb } from './mongo';

export const COLL_CHANNEL_GATING = 'tpe_channel_gating';

export const ALL_CHANNELS = ['sms', 'whatsapp', 'email', 'in_app'] as const;
export type GateableChannel = (typeof ALL_CHANNELS)[number];

export interface ChannelGatingDoc {
  _id: 'singleton';
  enabled: Record<GateableChannel, boolean>;
  updatedAt: string;
  updatedBy: string;
}

/**
 * Stage default — what we write the first time an operator opens
 * /admin/channels and there's no doc yet. Per Charter §4.4 stage-dev policy:
 * SMS + WhatsApp on, Email + In-app off (so we don't accidentally fire to
 * real recipients via providers we haven't fully validated).
 */
export const STAGE_DEFAULT_ENABLED: Record<GateableChannel, boolean> = {
  sms: true,
  whatsapp: true,
  email: false,
  in_app: false,
};

export async function getChannelGating(): Promise<ChannelGatingDoc> {
  const db = await getDb();
  const doc = await db
    .collection<ChannelGatingDoc>(COLL_CHANNEL_GATING)
    .findOne({ _id: 'singleton' });
  if (doc) return doc;
  // No doc yet → return the stage default (do NOT write — first PUT will).
  return {
    _id: 'singleton',
    enabled: { ...STAGE_DEFAULT_ENABLED },
    updatedAt: new Date(0).toISOString(),
    updatedBy: '(default — no operator save yet)',
  };
}

/** Upsert the singleton with the operator's checkbox state. */
export async function setChannelGating(
  enabled: Partial<Record<GateableChannel, boolean>>,
  updatedBy = 'operator',
): Promise<ChannelGatingDoc> {
  const db = await getDb();
  // Coerce missing keys to false — explicit operator intent.
  const full: Record<GateableChannel, boolean> = {
    sms: !!enabled.sms,
    whatsapp: !!enabled.whatsapp,
    email: !!enabled.email,
    in_app: !!enabled.in_app,
  };
  const next: ChannelGatingDoc = {
    _id: 'singleton',
    enabled: full,
    updatedAt: new Date().toISOString(),
    updatedBy,
  };
  await db.collection<ChannelGatingDoc>(COLL_CHANNEL_GATING).updateOne(
    { _id: 'singleton' },
    { $set: next },
    { upsert: true },
  );
  return next;
}
