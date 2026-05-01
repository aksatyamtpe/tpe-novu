"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.COLL_CAMPAIGN_RUNS = exports.COLL_CAMPAIGNS = void 0;
exports.listCampaigns = listCampaigns;
exports.getCampaign = getCampaign;
exports.createCampaign = createCampaign;
exports.updateCampaign = updateCampaign;
exports.deleteCampaign = deleteCampaign;
exports.recordRun = recordRun;
exports.listRecentRuns = listRecentRuns;
// =============================================================================
// Campaign storage — Mongo CRUD on `tpe_campaigns`.
//
// A campaign captures: which table to read, how to filter it, which workflow
// to fire per row, and how to map row columns to Novu trigger payload fields.
// Phase 1A persists drafts but only fires-on-demand from /admin/campaigns/:id.
// Phase 1B will add a scheduler worker.
// =============================================================================
const mongodb_1 = require("mongodb");
const mongo_1 = require("./mongo");
exports.COLL_CAMPAIGNS = 'tpe_campaigns';
exports.COLL_CAMPAIGN_RUNS = 'tpe_campaign_runs';
async function listCampaigns() {
    const db = await (0, mongo_1.getDb)();
    return await db.collection(exports.COLL_CAMPAIGNS)
        .find({})
        .sort({ updatedAt: -1 })
        .toArray();
}
async function getCampaign(id) {
    if (!mongodb_1.ObjectId.isValid(id))
        return null;
    const db = await (0, mongo_1.getDb)();
    return await db.collection(exports.COLL_CAMPAIGNS)
        .findOne({ _id: new mongodb_1.ObjectId(id) });
}
async function createCampaign(input) {
    const db = await (0, mongo_1.getDb)();
    const now = new Date().toISOString();
    const doc = {
        ...input,
        status: 'draft',
        createdAt: now,
        updatedAt: now,
    };
    const r = await db.collection(exports.COLL_CAMPAIGNS).insertOne(doc);
    return { ...doc, _id: r.insertedId };
}
async function updateCampaign(id, patch) {
    if (!mongodb_1.ObjectId.isValid(id))
        return null;
    const db = await (0, mongo_1.getDb)();
    const r = await db.collection(exports.COLL_CAMPAIGNS).findOneAndUpdate({ _id: new mongodb_1.ObjectId(id) }, { $set: { ...patch, updatedAt: new Date().toISOString() } }, { returnDocument: 'after' });
    return r ?? null;
}
async function deleteCampaign(id) {
    if (!mongodb_1.ObjectId.isValid(id))
        return false;
    const db = await (0, mongo_1.getDb)();
    const r = await db.collection(exports.COLL_CAMPAIGNS).deleteOne({ _id: new mongodb_1.ObjectId(id) });
    return r.deletedCount === 1;
}
async function recordRun(run) {
    const db = await (0, mongo_1.getDb)();
    const r = await db.collection(exports.COLL_CAMPAIGN_RUNS).insertOne(run);
    return r.insertedId;
}
async function listRecentRuns(campaignId, limit = 10) {
    if (!mongodb_1.ObjectId.isValid(campaignId))
        return [];
    const db = await (0, mongo_1.getDb)();
    return await db.collection(exports.COLL_CAMPAIGN_RUNS)
        .find({ campaignId: new mongodb_1.ObjectId(campaignId) })
        .sort({ startedAt: -1 })
        .limit(limit)
        .toArray();
}
