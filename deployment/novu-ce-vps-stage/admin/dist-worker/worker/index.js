"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// =============================================================================
// tpe-admin-worker — polls two Mongo collections and fires due work:
//   1. tpe_scheduled_triggers  → one-off Novu triggers (legacy)
//   2. tpe_campaigns           → data-driven fan-outs (Phase 1B)
//
// Lives in its own container so a Next.js admin restart never delays sends.
// Both ticks are atomic via findOneAndUpdate; idempotent under restart.
// =============================================================================
const mongodb_1 = require("mongodb");
const campaign_runner_1 = require("../lib/campaign-runner");
const MONGO_URL = process.env.MONGO_URL || '';
const NOVU_API_URL = process.env.NOVU_API_URL || 'http://api:3000';
const NOVU_API_KEY = process.env.NOVU_API_KEY || '';
const POLL_MS = Number(process.env.POLL_MS || 30000);
const COLL_SCHEDULES = 'tpe_scheduled_triggers';
const COLL_CAMPAIGNS = 'tpe_campaigns';
if (!MONGO_URL) {
    console.error(JSON.stringify({ type: 'admin_worker_fatal', reason: 'MONGO_URL not set' }));
    process.exit(2);
}
let mongo = null;
async function db() {
    if (!mongo) {
        mongo = new mongodb_1.MongoClient(MONGO_URL, { minPoolSize: 1, maxPoolSize: 3 });
        await mongo.connect();
        log('admin_worker_mongo_connected', {});
    }
    return mongo.db();
}
// Postgres pool is encapsulated inside lib/analytics-db.ts; the worker
// just imports streamRows() via lib/campaign-runner. ANALYTICS_DB_URL must
// still be set in this container's env (verified at lib init time).
function log(type, extra) {
    console.log(JSON.stringify({ ts: new Date().toISOString(), type, ...extra }));
}
// ============================================================================
// Schedules tick — unchanged from prior version
// ============================================================================
async function fireScheduledTrigger(doc) {
    const id = doc._id;
    const workflowName = doc.workflowName;
    const subscriberId = doc.subscriberId;
    const payload = doc.payload || {};
    try {
        const res = await fetch(`${NOVU_API_URL}/v1/events/trigger`, {
            method: 'POST',
            headers: {
                'content-type': 'application/json',
                Authorization: `ApiKey ${NOVU_API_KEY}`,
            },
            body: JSON.stringify({ name: workflowName, to: { subscriberId }, payload }),
        });
        const text = await res.text();
        let body = null;
        try {
            body = text ? JSON.parse(text) : null;
        }
        catch {
            body = { raw: text };
        }
        if (!res.ok)
            throw new Error(`novu HTTP ${res.status}: ${(body && (body.message || body.error)) || text}`);
        const transactionId = body?.data?.transactionId ||
            body?.transactionId ||
            (body?.data?.acknowledged && body?.data?.transactionId);
        const d = await db();
        await d.collection(COLL_SCHEDULES).updateOne({ _id: id }, { $set: { status: 'fired', firedAt: new Date(), novuTransactionId: transactionId || null } });
        log('admin_schedule_fired', { _id: String(id), workflowName, subscriberId, transactionId, fireAt: doc.fireAt });
    }
    catch (e) {
        const reason = String(e?.message || e);
        const d = await db();
        await d.collection(COLL_SCHEDULES).updateOne({ _id: id }, { $set: { status: 'failed', firedAt: new Date(), errorReason: reason } });
        log('admin_schedule_failed', { _id: String(id), workflowName, subscriberId, reason });
    }
}
async function tickSchedules() {
    const d = await db();
    for (;;) {
        const r = await d.collection(COLL_SCHEDULES).findOneAndUpdate({ status: 'pending', fireAt: { $lte: new Date() } }, { $set: { status: 'firing' } }, { returnDocument: 'after', sort: { fireAt: 1 } });
        if (!r)
            break;
        await fireScheduledTrigger(r);
    }
}
// ============================================================================
// Campaigns tick — NEW (Phase 1B)
// ============================================================================
async function fanoutCampaign(campaign) {
    log('admin_campaign_fanout_start', {
        _id: String(campaign._id),
        name: campaign.name,
        sourceTable: campaign.sourceTable,
        targetWorkflow: campaign.targetWorkflow,
    });
    let result;
    try {
        result = await (0, campaign_runner_1.runCampaignFanout)({
            campaign,
            metadata: { triggeredBy: 'worker' },
        });
    }
    catch (e) {
        log('admin_campaign_fanout_error', { _id: String(campaign._id), reason: e?.message });
        const d = await db();
        await d.collection(COLL_CAMPAIGNS).updateOne({ _id: campaign._id }, { $set: { status: 'failed', updatedAt: new Date().toISOString() } });
        return;
    }
    const d = await db();
    await d.collection(COLL_CAMPAIGNS).updateOne({ _id: campaign._id }, { $set: { status: (0, campaign_runner_1.deriveCampaignStatus)(result), updatedAt: new Date().toISOString() } });
    log('admin_campaign_fanout_done', {
        _id: String(campaign._id),
        rowCount: result.rowCount,
        triggered: result.triggered,
        skipped: result.skipped,
        errored: result.errored,
    });
}
async function tickCampaigns() {
    const d = await db();
    for (;;) {
        // Atomically claim ONE due-and-draft campaign by flipping status to 'firing'.
        // scheduledAt must exist + be <= now. (Manual-fire campaigns have no scheduledAt.)
        const r = await d.collection(COLL_CAMPAIGNS).findOneAndUpdate({
            status: 'draft',
            scheduledAt: { $exists: true, $ne: null, $lte: new Date().toISOString() },
        }, { $set: { status: 'firing', updatedAt: new Date().toISOString() } }, { returnDocument: 'after', sort: { scheduledAt: 1 } });
        if (!r)
            break;
        await fanoutCampaign(r);
    }
}
// ============================================================================
// Main loop
// ============================================================================
async function main() {
    log('admin_worker_boot', {
        pollMs: POLL_MS,
        novuUrl: NOVU_API_URL,
        pgConfigured: !!process.env.ANALYTICS_DB_URL,
    });
    // Initial run + interval.
    const tickAll = async () => {
        await tickSchedules().catch((e) => log('admin_worker_schedules_tick_error', { reason: String(e?.message || e) }));
        await tickCampaigns().catch((e) => log('admin_worker_campaigns_tick_error', { reason: String(e?.message || e) }));
    };
    await tickAll();
    setInterval(tickAll, POLL_MS);
}
main().catch((e) => {
    log('admin_worker_fatal', { reason: String(e?.message || e) });
    process.exit(1);
});
