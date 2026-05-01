// Server-side aggregator for the /admin dashboard metric cards.
//
// Hits Mongo (templates / scheduled-triggers) and the Novu REST API (workflows /
// notifications) in parallel so the page render stays under one round-trip
// budget. Any individual call that fails returns 0 + an `errors` flag — the UI
// shows a "stale" badge instead of crashing the whole dashboard.
import { getDb, COLL_TEMPLATES, COLL_SCHEDULES } from './mongo';
import { novuGet } from './novu';

export type DashboardStats = {
  workflows: number;
  pending: number;
  triggers24h: number;
  templates: number;
  /** Names of subsystems that failed during fetch (empty when fully healthy). */
  errors: string[];
};

const DAY_MS = 24 * 60 * 60 * 1000;

export async function getDashboardStats(): Promise<DashboardStats> {
  const errors: string[] = [];

  // All four reads fan out in parallel; settled-style so one failure
  // doesn't poison the whole page.
  const [
    templatesRes,
    pendingRes,
    workflowsRes,
    historyRes,
  ] = await Promise.allSettled([
    countTemplates(),
    countPendingSchedules(),
    novuGet('/v1/workflows', { limit: '100' }),
    novuGet('/v1/notifications', { page: '0' }),
  ]);

  const templates  = unwrap(templatesRes,  errors, 'templates');
  const pending    = unwrap(pendingRes,    errors, 'pending');

  let workflows = 0;
  if (workflowsRes.status === 'fulfilled' && workflowsRes.value?.ok) {
    const body = workflowsRes.value.body;
    // Novu's response shape varies: prefer totalCount, fall back to length.
    workflows = body?.totalCount ?? (body?.data?.length ?? body?.workflows?.length ?? 0);
  } else {
    errors.push('workflows');
  }

  let triggers24h = 0;
  if (historyRes.status === 'fulfilled' && historyRes.value?.ok) {
    const items = historyRes.value.body?.data || historyRes.value.body?.items || [];
    const cutoff = Date.now() - DAY_MS;
    triggers24h = (items as any[]).filter((n) => {
      if (!n?.createdAt) return false;
      const t = new Date(n.createdAt).getTime();
      return Number.isFinite(t) && t >= cutoff;
    }).length;
  } else {
    errors.push('triggers24h');
  }

  return { workflows, pending, triggers24h, templates, errors };
}

async function countTemplates(): Promise<number> {
  const db = await getDb();
  return db.collection(COLL_TEMPLATES).countDocuments();
}

async function countPendingSchedules(): Promise<number> {
  const db = await getDb();
  return db.collection(COLL_SCHEDULES).countDocuments({ status: 'pending' });
}

function unwrap(
  res: PromiseSettledResult<number>,
  errs: string[],
  label: string,
): number {
  if (res.status === 'fulfilled') return res.value;
  errs.push(label);
  return 0;
}
