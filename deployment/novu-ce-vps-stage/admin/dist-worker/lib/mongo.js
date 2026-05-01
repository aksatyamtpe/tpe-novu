"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.COLL_SCHEDULES = exports.COLL_TEMPLATES = void 0;
exports.getDb = getDb;
// =============================================================================
// Mongo singleton — reused by every API route.
// We talk to the Bridge's Mongo directly; collections are prefixed `tpe_admin_`
// so we never touch Novu's own collections.
// =============================================================================
const mongodb_1 = require("mongodb");
const MONGO_URL = process.env.MONGO_URL || '';
let cached = { client: null, db: null };
async function getDb() {
    if (cached.db)
        return cached.db;
    if (!MONGO_URL) {
        throw new Error('MONGO_URL is not set — admin cannot reach Mongo.');
    }
    const client = new mongodb_1.MongoClient(MONGO_URL, {
        minPoolSize: 1,
        maxPoolSize: 5,
    });
    await client.connect();
    // The Mongo URL points at the `novu-db` database (Bridge convention).
    const db = client.db();
    cached = { client, db };
    return db;
}
exports.COLL_TEMPLATES = 'tpe_admin_templates';
exports.COLL_SCHEDULES = 'tpe_scheduled_triggers';
