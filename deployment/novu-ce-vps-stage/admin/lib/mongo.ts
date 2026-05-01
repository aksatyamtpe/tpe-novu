// =============================================================================
// Mongo singleton — reused by every API route.
// We talk to the Bridge's Mongo directly; collections are prefixed `tpe_admin_`
// so we never touch Novu's own collections.
// =============================================================================
import { MongoClient, Db } from 'mongodb';

const MONGO_URL = process.env.MONGO_URL || '';

let cached: { client: MongoClient | null; db: Db | null } = { client: null, db: null };

export async function getDb(): Promise<Db> {
  if (cached.db) return cached.db;
  if (!MONGO_URL) {
    throw new Error('MONGO_URL is not set — admin cannot reach Mongo.');
  }
  const client = new MongoClient(MONGO_URL, {
    minPoolSize: 1,
    maxPoolSize: 5,
  });
  await client.connect();
  // The Mongo URL points at the `novu-db` database (Bridge convention).
  const db = client.db();
  cached = { client, db };
  return db;
}

export const COLL_TEMPLATES = 'tpe_admin_templates';
export const COLL_SCHEDULES = 'tpe_scheduled_triggers';
