// =============================================================================
// Bridge-side Mongo client — singleton.
//
// Used by lib/channel-gating.ts to read the operator-managed channel-allowlist
// doc; the audit stream still goes to stdout via lib/audit.ts (Phase 0
// design). The collections we touch from the bridge are prefixed `tpe_*` and
// never overlap with Novu's own.
// =============================================================================
import { MongoClient, Db } from 'mongodb';

const MONGO_URL = process.env.MONGO_URL || '';

let cached: { client: MongoClient | null; db: Db | null } = { client: null, db: null };

export async function getDb(): Promise<Db> {
  if (cached.db) return cached.db;
  if (!MONGO_URL) {
    throw new Error('MONGO_URL is not set — bridge cannot reach Mongo.');
  }
  const client = new MongoClient(MONGO_URL, {
    minPoolSize: 1,
    maxPoolSize: 5,
  });
  await client.connect();
  const db = client.db();
  cached = { client, db };
  return db;
}

// Single shared collection for operator-managed gating config.
export const COLL_CHANNEL_GATING = 'tpe_channel_gating';
