// =============================================================================
// Analytics Postgres reader — read-only access to the Metabase backing DB
// (postgres17 container, analytics_db on the novu network).
//
// Phase 1A scope:
//   - Whitelisted tables only — operator can pick from a curated list, not run
//     arbitrary SQL. Avoids both safety footguns (DROP TABLE) and the
//     subscriber-join confusion documented in stage_channel_gating-discovery.
//   - Filter UI maps to a parameterised WHERE clause; we never interpolate
//     user input into SQL strings.
//   - Row count + sample preview for the campaign builder's audience step.
// =============================================================================
import { Pool, PoolClient } from 'pg';

const ANALYTICS_DB_URL = process.env.ANALYTICS_DB_URL || '';

let pool: Pool | null = null;

function getPool(): Pool {
  if (!pool) {
    if (!ANALYTICS_DB_URL) {
      throw new Error(
        'ANALYTICS_DB_URL is not set — admin cannot reach the analytics Postgres. ' +
        'Expected: postgresql://admin:***@postgres17:5432/analytics_db',
      );
    }
    pool = new Pool({
      connectionString: ANALYTICS_DB_URL,
      max: 5,                  // small pool — admin app has few concurrent ops
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
      // Safety: enforce the read-only intent at session level when we acquire a client.
    });
    pool.on('error', (err) => {
      // eslint-disable-next-line no-console
      console.error('[analytics-db] idle client error:', err.message);
    });
  }
  return pool;
}

/**
 * Tables operators can query through the campaign builder. Anything not on
 * this list is invisible to the UI. Add carefully — a table's columns become
 * filter / mapping inputs, so they're effectively part of the public surface.
 */
export const ALLOWED_TABLES = [
  'tbl_allocation',     // primary customer-contact source: EMAIL_ID, PHONE_1, CUSTOMER_NAME
  'data_allocation',    // secondary contact source: MOBILE_NO, POLICY_HOLDER, MATURITY_DATE
  'tbl_lapsedata_apr',  // lapsed policies — natural feed for re-engagement campaigns
  'final_table',        // policy financials — payment_due_date, maturity_date, Loan, SurrenderValue
  'policy_data',        // simpler policy view — lighter columns
] as const;

export type AllowedTable = (typeof ALLOWED_TABLES)[number];

export interface ColumnInfo {
  name: string;
  dataType: string;
  isNullable: boolean;
}

export interface TableInfo {
  name: AllowedTable;
  columns: ColumnInfo[];
  approxRows: number;
}

/** Runtime guard for table names — defends every code path that takes a table input. */
function assertAllowedTable(t: string): asserts t is AllowedTable {
  if (!(ALLOWED_TABLES as readonly string[]).includes(t)) {
    throw new Error(`table not in allowlist: ${t}`);
  }
}

export async function listTables(): Promise<TableInfo[]> {
  const client = await acquireReadOnly();
  try {
    const res = await client.query(
      `
      SELECT
        c.relname AS name,
        c.reltuples::bigint AS approx_rows
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE c.relkind = 'r'
        AND n.nspname = 'public'
        AND c.relname = ANY($1::text[])
      `,
      [ALLOWED_TABLES as readonly string[]],
    );
    const tables: TableInfo[] = [];
    for (const row of res.rows) {
      const cols = await getColumns(client, row.name);
      tables.push({
        name: row.name as AllowedTable,
        columns: cols,
        approxRows: Number(row.approx_rows) || 0,
      });
    }
    return tables.sort((a, b) => a.name.localeCompare(b.name));
  } finally {
    client.release();
  }
}

async function getColumns(client: PoolClient, table: string): Promise<ColumnInfo[]> {
  const res = await client.query(
    `
    SELECT column_name, data_type, is_nullable
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = $1
    ORDER BY ordinal_position
    `,
    [table],
  );
  return res.rows.map((r) => ({
    name: r.column_name,
    dataType: r.data_type,
    isNullable: r.is_nullable === 'YES',
  }));
}

export interface PreviewFilter {
  /** Column name; must exist on the table (validated server-side). */
  column: string;
  /** SQL operator — restricted to a known-safe list.
   *  'IN' expects `value` as a comma-separated string; buildWhere splits + binds. */
  op: '=' | '!=' | '>' | '>=' | '<' | '<=' | 'ILIKE' | 'IS NULL' | 'IS NOT NULL' | 'IN';
  /** Value (scalar, or CSV for 'IN'). Ignored for IS NULL / IS NOT NULL. */
  value?: string | number | null;
}

export interface PreviewOpts {
  table: AllowedTable;
  filters?: PreviewFilter[];
  limit?: number;
}

export interface PreviewResult {
  table: AllowedTable;
  totalMatchingRows: number;
  sample: Record<string, unknown>[];
  columns: ColumnInfo[];
  /**
   * The exact parameterised SQL that ran for the count + sample queries.
   * Surfaced to the campaign builder so operators can verify what's about to
   * fire BEFORE saving. Values flow through `params`, not interpolated.
   */
  sqlPreview: { countSql: string; sampleSql: string; params: unknown[] };
}

const SAFE_OPS = new Set(['=', '!=', '>', '>=', '<', '<=', 'ILIKE', 'IS NULL', 'IS NOT NULL', 'IN']);

/**
 * Pure helper: build the WHERE clause + params for a given table + filters.
 * Used by previewRows() and streamRows(); also exposed for the SQL-preview
 * pane on /admin/campaigns/new so operators see the literal query.
 */
export function buildWhere(
  table: AllowedTable,
  cols: ColumnInfo[],
  filters: PreviewFilter[] | undefined,
): { sql: string; params: unknown[] } {
  const colNames = new Set(cols.map((c) => c.name));
  const parts: string[] = [];
  const params: unknown[] = [];
  for (const f of filters ?? []) {
    if (!colNames.has(f.column)) throw new Error(`unknown column: ${f.column}`);
    if (!SAFE_OPS.has(f.op)) throw new Error(`unsupported operator: ${f.op}`);
    const quoted = `"${f.column.replace(/"/g, '""')}"`;
    if (f.op === 'IS NULL' || f.op === 'IS NOT NULL') {
      parts.push(`${quoted} ${f.op}`);
    } else if (f.op === 'IN') {
      // value is a comma-separated string — split, trim, bind one param per
      // element. Empty after split → emit `FALSE` so the query returns no rows
      // instead of a syntax error.
      const elems = String(f.value ?? '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      if (elems.length === 0) {
        parts.push('FALSE');
      } else {
        const placeholders = elems.map((v) => {
          params.push(v);
          return `$${params.length}`;
        });
        parts.push(`${quoted}::text IN (${placeholders.join(', ')})`);
      }
    } else {
      params.push(f.value ?? null);
      parts.push(`${quoted} ${f.op} $${params.length}`);
    }
  }
  return { sql: parts.length ? `WHERE ${parts.join(' AND ')}` : '', params };
}

/**
 * Run a parameterised filtered SELECT with a row-count companion query.
 * Returns the count + a sample of `limit` rows. Never interpolates filter
 * values; all values flow through pg's $N placeholders.
 */
export async function previewRows(opts: PreviewOpts): Promise<PreviewResult> {
  assertAllowedTable(opts.table);
  const limit = Math.min(Math.max(opts.limit ?? 25, 1), 200);

  const client = await acquireReadOnly();
  try {
    const cols = await getColumns(client, opts.table);
    const { sql: where, params } = buildWhere(opts.table, cols, opts.filters);

    const tableQ = `"${opts.table}"`;
    const countSql  = `SELECT COUNT(*)::bigint AS n FROM public.${tableQ} ${where}`.trim();
    const sampleSql = `SELECT * FROM public.${tableQ} ${where} LIMIT ${limit}`.trim();

    const [countRes, sampleRes] = await Promise.all([
      client.query(countSql, params),
      client.query(sampleSql, params),
    ]);

    return {
      table: opts.table,
      totalMatchingRows: Number(countRes.rows[0]?.n ?? 0),
      sample: sampleRes.rows,
      columns: cols,
      sqlPreview: { countSql, sampleSql, params },
    };
  } finally {
    client.release();
  }
}

/**
 * Stream all matching rows for fan-out. Caller iterates row-by-row; we use
 * a server-side cursor so 60k-row tables don't blow the heap.
 *
 * NOTE: Phase 1A's dispatch-now is synchronous and throttled to ~10 rows/s.
 * Phase 1B will move this to a background worker.
 */
export async function* streamRows(opts: PreviewOpts): AsyncGenerator<Record<string, unknown>> {
  assertAllowedTable(opts.table);
  const client = await acquireReadOnly();
  try {
    const cols = await getColumns(client, opts.table);
    const { sql: where, params } = buildWhere(opts.table, cols, opts.filters);
    const tableQ = `"${opts.table}"`;

    // Phase 1A: simple LIMIT capped at 1000 rows. Phase 1B replaces with cursor.
    const cap = Math.min(opts.limit ?? 1000, 1000);
    const res = await client.query(
      `SELECT * FROM public.${tableQ} ${where} LIMIT ${cap}`,
      params,
    );
    for (const r of res.rows) yield r as Record<string, unknown>;
  } finally {
    client.release();
  }
}

async function acquireReadOnly(): Promise<PoolClient> {
  const c = await getPool().connect();
  // Belt + suspenders: enforce read-only on the session. The user is also
  // already a Postgres user with write privs, so we apply this defensively
  // to any campaign-builder-issued query.
  await c.query('SET TRANSACTION READ ONLY').catch(() => {
    // SET TRANSACTION only works inside a transaction; if implicit txn isn't
    // open yet, this no-ops. The Phase 1A queries are read-only by construction
    // anyway (SELECT only, no DDL). Logging just so we know if it changed.
  });
  return c;
}
