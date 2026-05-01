// /admin/campaigns/new — single-page campaign builder.
//
// Flow:
//   1) Pick the source table  the columns load + a 5-row preview shows
//   2) (optional) Add filters — column + operator + value
//   3) Click "Refresh preview" — see audience size + sample rows
//   4) Pick the target workflow from the live Novu list
//   5) Map columns to subscriberId / email / phone / firstName + payload fields
//   6) Save  redirects back to /campaigns
//
// Phase 1A keeps everything on a single page. Phase 1B may split into steps.
'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Database, Filter, Wand2, Save, Loader2, Plus, X, Eye, ListChecks, Megaphone,
} from 'lucide-react';
import { toast } from 'sonner';
import { Shell } from '@/components/Shell';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';

type ColumnInfo = { name: string; dataType: string; isNullable: boolean };
type TableInfo = { name: string; columns: ColumnInfo[]; approxRows: number };
type Workflow = { workflowId: string; name: string };
type FilterRow = { id: string; column: string; op: string; value: string };

const OPS = ['=', '!=', '>', '>=', '<', '<=', 'ILIKE', 'IS NULL', 'IS NOT NULL'] as const;

// Suggested subscriberId / email / phone columns when an operator picks a table.
// Pure UX nicety  the operator can override.
const SUGGESTIONS: Record<string, {
  subscriberIdColumn?: string;
  emailColumn?: string;
  phoneColumn?: string;
  firstNameColumn?: string;
}> = {
  tbl_allocation: {
    subscriberIdColumn: 'POLICY_NUMBER',
    emailColumn: 'EMAIL_ID',
    phoneColumn: 'PHONE_1',
    firstNameColumn: 'CUSTOMER_NAME',
  },
  data_allocation: {
    subscriberIdColumn: 'POLICY_REF',
    phoneColumn: 'MOBILE_NO',
    firstNameColumn: 'POLICY_HOLDER',
  },
  tbl_lapsedata_apr: {
    subscriberIdColumn: 'CHDRNUM',
  },
  final_table: {
    subscriberIdColumn: 'policy_number',
  },
  policy_data: {
    subscriberIdColumn: 'policy_no',
  },
};

export default function NewCampaignPage() {
  const router = useRouter();

  // Step 1 — source table
  const [tables, setTables] = useState<TableInfo[]>([]);
  const [tablesLoading, setTablesLoading] = useState(true);
  const [sourceTable, setSourceTable] = useState<string>('');

  // Step 2 — filters
  const [filters, setFilters] = useState<FilterRow[]>([]);

  // Step 3 — preview
  const [preview, setPreview] = useState<{
    totalMatchingRows: number;
    sample: any[];
    sqlPreview?: { countSql: string; sampleSql: string; params: unknown[] };
  } | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [showSql, setShowSql] = useState(false);

  // Step 4 — workflow
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [targetWorkflow, setTargetWorkflow] = useState('');

  // Step 5 — name + field map + schedule
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [subscriberIdColumn, setSubscriberIdColumn] = useState('');
  const [emailColumn, setEmailColumn] = useState('');
  const [phoneColumn, setPhoneColumn] = useState('');
  const [firstNameColumn, setFirstNameColumn] = useState('');
  const [payloadMap, setPayloadMap] = useState<Array<{ key: string; col: string }>>([
    { key: '', col: '' },
  ]);
  // Schedule mode: 'manual' = no scheduledAt, fire from /campaigns when ready.
  //                'at'     = scheduledAt set, worker auto-fires within POLL_MS.
  const [scheduleMode, setScheduleMode] = useState<'manual' | 'at'>('manual');
  const [scheduledAtLocal, setScheduledAtLocal] = useState('');

  const [saving, setSaving] = useState(false);

  // -------------------------------------------------------------------------
  // Initial loads
  // -------------------------------------------------------------------------
  useEffect(() => {
    (async () => {
      try {
        const r = await fetch('/admin/api/analytics/tables', { cache: 'no-store' });
        if (r.status === 401) { window.location.href = '/admin'; return; }
        const j = await r.json();
        setTables(j.tables || []);
      } catch (e: any) {
        toast.error('Failed to load tables', { description: String(e?.message || e) });
      } finally { setTablesLoading(false); }
    })();
    (async () => {
      try {
        const r = await fetch('/admin/api/workflows', { cache: 'no-store' });
        const j = await r.json();
        setWorkflows(j.items || []);
      } catch { /* non-fatal — operator can type the name */ }
    })();
  }, []);

  // Apply suggested mapping when source table changes.
  useEffect(() => {
    if (!sourceTable) return;
    const s = SUGGESTIONS[sourceTable] || {};
    setSubscriberIdColumn(s.subscriberIdColumn || '');
    setEmailColumn(s.emailColumn || '');
    setPhoneColumn(s.phoneColumn || '');
    setFirstNameColumn(s.firstNameColumn || '');
    setFilters([]);
    setPreview(null);
  }, [sourceTable]);

  const currentTable = useMemo(
    () => tables.find((t) => t.name === sourceTable),
    [tables, sourceTable],
  );
  const cols = currentTable?.columns ?? [];

  // -------------------------------------------------------------------------
  // Actions
  // -------------------------------------------------------------------------
  async function runPreview() {
    if (!sourceTable) return;
    setPreviewing(true);
    try {
      const filterPayload = filters
        .filter((f) => f.column && f.op)
        .map((f) => ({
          column: f.column,
          op: f.op,
          value: f.op === 'IS NULL' || f.op === 'IS NOT NULL' ? null : f.value,
        }));
      const r = await fetch('/admin/api/analytics/preview', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ table: sourceTable, filters: filterPayload, limit: 5 }),
      });
      const j = await r.json();
      if (!r.ok || !j.ok) throw new Error(j.error || ('HTTP ' + r.status));
      setPreview({
        totalMatchingRows: j.totalMatchingRows,
        sample: j.sample,
        sqlPreview: j.sqlPreview,
      });
      toast.success(`Found ${j.totalMatchingRows.toLocaleString()} matching rows.`);
    } catch (e: any) {
      toast.error('Preview failed', { description: String(e?.message || e) });
    } finally { setPreviewing(false); }
  }

  async function save() {
    if (!name.trim())          return toast.error('Campaign name is required.');
    if (!sourceTable)          return toast.error('Pick a source table.');
    if (!targetWorkflow)       return toast.error('Pick a target workflow.');
    if (!subscriberIdColumn)   return toast.error('subscriberId column is required.');

    const payload: Record<string, string> = {};
    for (const { key, col } of payloadMap) {
      if (key.trim() && col.trim()) payload[key.trim()] = col.trim();
    }

    // Validate schedule (if in 'at' mode it must be a future timestamp).
    let scheduledAt: string | null = null;
    if (scheduleMode === 'at') {
      if (!scheduledAtLocal) return toast.error('Pick a fire time, or switch to manual.');
      const at = new Date(scheduledAtLocal);
      if (Number.isNaN(at.getTime())) return toast.error('Invalid fire time.');
      if (at.getTime() <= Date.now()) return toast.error('Fire time must be in the future.');
      scheduledAt = at.toISOString();
    }

    setSaving(true);
    try {
      const filterPayload = filters
        .filter((f) => f.column && f.op)
        .map((f) => ({
          column: f.column,
          op: f.op,
          value: f.op === 'IS NULL' || f.op === 'IS NOT NULL' ? null : f.value,
        }));
      const r = await fetch('/admin/api/campaigns', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          description: description.trim() || undefined,
          sourceTable,
          filters: filterPayload,
          targetWorkflow,
          fieldMap: {
            subscriberIdColumn,
            emailColumn:     emailColumn || undefined,
            phoneColumn:     phoneColumn || undefined,
            firstNameColumn: firstNameColumn || undefined,
            payload,
          },
          scheduledAt,
        }),
      });
      const j = await r.json();
      if (!r.ok || !j.ok) throw new Error(j.error || ('HTTP ' + r.status));
      toast.success('Campaign saved.', { description: 'Find it on /campaigns to fire or schedule.' });
      router.push('/campaigns');
    } catch (e: any) {
      toast.error('Save failed', { description: String(e?.message || e) });
    } finally { setSaving(false); }
  }

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------
  return (
    <Shell active="campaigns">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">New campaign</h1>
        <p className="mt-0.5 text-sm text-muted-foreground">
          Pick a slice of the analytics DB, map its columns to a workflow's payload, and queue or fire it.
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Left column — config */}
        <div className="space-y-6 lg:col-span-2">
          {/* Step 1 — source */}
          <SectionCard
            n={1}
            icon={<Database className="h-4 w-4" />}
            title="Source table"
            blurb="Pick which analytics_db table to read from. Only contact-bearing tables are exposed."
          >
            {tablesLoading ? (
              <Skeleton className="h-9 w-full" />
            ) : (
              <Select value={sourceTable} onValueChange={setSourceTable}>
                <SelectTrigger><SelectValue placeholder="Pick a table" /></SelectTrigger>
                <SelectContent>
                  {tables.map((t) => (
                    <SelectItem key={t.name} value={t.name}>
                      {t.name}  {t.approxRows.toLocaleString()} rows  {t.columns.length} cols
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </SectionCard>

          {/* Step 2 — filters */}
          {sourceTable && (
            <SectionCard
              n={2}
              icon={<Filter className="h-4 w-4" />}
              title="Filter audience"
              blurb="Optional. Add column-level WHERE clauses to narrow the audience."
            >
              {filters.map((f, idx) => (
                <div key={f.id} className="mb-2 flex items-end gap-2">
                  <div className="flex-1">
                    <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">Column</Label>
                    <Select value={f.column} onValueChange={(v) => setFilter(idx, { column: v })}>
                      <SelectTrigger className="h-9"><SelectValue placeholder="column" /></SelectTrigger>
                      <SelectContent>
                        {cols.map((c) => (
                          <SelectItem key={c.name} value={c.name}>
                            {c.name} <span className="text-muted-foreground"> {c.dataType}</span>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="w-32">
                    <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">Op</Label>
                    <Select value={f.op} onValueChange={(v) => setFilter(idx, { op: v })}>
                      <SelectTrigger className="h-9"><SelectValue placeholder="op" /></SelectTrigger>
                      <SelectContent>
                        {OPS.map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="flex-1">
                    <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">Value</Label>
                    <Input
                      className="h-9"
                      value={f.value}
                      onChange={(e) => setFilter(idx, { value: e.target.value })}
                      disabled={f.op === 'IS NULL' || f.op === 'IS NOT NULL'}
                      placeholder={f.op === 'ILIKE' ? '%search%' : 'value'}
                    />
                  </div>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-9 px-2 text-destructive"
                    onClick={() => setFilters(filters.filter((x) => x.id !== f.id))}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              ))}
              <Button size="sm" variant="outline" className="mt-2" onClick={addFilter}>
                <Plus className="mr-1.5 h-3.5 w-3.5" />
                Add filter
              </Button>
              <Button size="sm" className="mt-2 ml-2" onClick={runPreview} disabled={previewing}>
                {previewing
                  ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                  : <Eye className="mr-1.5 h-4 w-4" />}
                Refresh preview
              </Button>

              {preview && (
                <div className="mt-4 rounded-md border bg-muted/30 px-3 py-2 text-xs">
                  <span className="font-medium">{preview.totalMatchingRows.toLocaleString()}</span>
                  {' '}matching rows. Showing first 5 below.
                </div>
              )}
            </SectionCard>
          )}

          {/* Step 4 — target workflow */}
          {preview && (
            <SectionCard
              n={3}
              icon={<Wand2 className="h-4 w-4" />}
              title="Target workflow"
              blurb="Which Bridge workflow runs once per matching row."
            >
              <Select value={targetWorkflow} onValueChange={setTargetWorkflow}>
                <SelectTrigger><SelectValue placeholder="Pick a workflow" /></SelectTrigger>
                <SelectContent>
                  {workflows.map((w) => (
                    <SelectItem key={w.workflowId} value={w.workflowId}>{w.workflowId}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </SectionCard>
          )}

          {/* Step 5 — field map + meta */}
          {preview && targetWorkflow && (
            <SectionCard
              n={4}
              icon={<ListChecks className="h-4 w-4" />}
              title="Map row  trigger"
              blurb="Which row column becomes which Novu trigger field. Suggestions pre-filled per table  override as needed."
            >
              <div className="grid gap-3 sm:grid-cols-2">
                <ColumnPicker label="Subscriber ID column (required)" value={subscriberIdColumn} onChange={setSubscriberIdColumn} cols={cols} required />
                <ColumnPicker label="Email column" value={emailColumn} onChange={setEmailColumn} cols={cols} />
                <ColumnPicker label="Phone column" value={phoneColumn} onChange={setPhoneColumn} cols={cols} />
                <ColumnPicker label="First name column" value={firstNameColumn} onChange={setFirstNameColumn} cols={cols} />
              </div>

              <div className="mt-5">
                <div className="mb-2 text-sm font-semibold">Payload mapping</div>
                <div className="text-xs text-muted-foreground mb-3">
                  Each row column you map here becomes a payload field on the Novu trigger.
                  Example: <code className="font-mono">policyNumber  POLICY_NUMBER</code>.
                </div>
                {payloadMap.map((pm, idx) => (
                  <div key={idx} className="mb-2 flex items-end gap-2">
                    <div className="flex-1">
                      <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">Payload key</Label>
                      <Input
                        className="h-9"
                        placeholder="e.g. policyNumber"
                        value={pm.key}
                        onChange={(e) => setPayloadMap(payloadMap.map((p, i) => i === idx ? { ...p, key: e.target.value } : p))}
                      />
                    </div>
                    <div className="flex-1">
                      <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">Source column</Label>
                      <Select
                        value={pm.col}
                        onValueChange={(v) => setPayloadMap(payloadMap.map((p, i) => i === idx ? { ...p, col: v } : p))}
                      >
                        <SelectTrigger className="h-9"><SelectValue placeholder="column" /></SelectTrigger>
                        <SelectContent>
                          {cols.map((c) => (<SelectItem key={c.name} value={c.name}>{c.name}</SelectItem>))}
                        </SelectContent>
                      </Select>
                    </div>
                    <Button
                      size="sm" variant="ghost" className="h-9 px-2 text-destructive"
                      onClick={() => setPayloadMap(payloadMap.filter((_, i) => i !== idx))}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
                <Button size="sm" variant="outline" className="mt-1" onClick={() => setPayloadMap([...payloadMap, { key: '', col: '' }])}>
                  <Plus className="mr-1.5 h-3.5 w-3.5" />
                  Add payload field
                </Button>
              </div>
            </SectionCard>
          )}

          {/* Save */}
          {preview && targetWorkflow && (
            <SectionCard
              n={5}
              icon={<Megaphone className="h-4 w-4" />}
              title="Save campaign"
              blurb="Saved campaigns can be fired on demand from /campaigns."
            >
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <Label htmlFor="c-name">Name</Label>
                  <Input id="c-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. May lapse-recovery push" />
                </div>
                <div>
                  <Label htmlFor="c-desc">Description (optional)</Label>
                  <Input id="c-desc" value={description} onChange={(e) => setDescription(e.target.value)} />
                </div>
              </div>

              {/* Schedule controls — Phase 1B: worker auto-fires once scheduledAt elapses. */}
              <div className="mt-5 rounded-lg border bg-muted/20 p-4">
                <div className="mb-3 text-sm font-semibold">Schedule</div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="flex cursor-pointer items-start gap-3 rounded-md border bg-background p-3 hover:border-primary/40">
                    <input
                      type="radio"
                      checked={scheduleMode === 'manual'}
                      onChange={() => setScheduleMode('manual')}
                      className="mt-1"
                    />
                    <div>
                      <div className="text-sm font-medium">Manual fire</div>
                      <div className="text-xs text-muted-foreground">
                        Save now, fire on-demand from <code className="font-mono text-[11px]">/campaigns</code> when ready.
                      </div>
                    </div>
                  </label>
                  <label className="flex cursor-pointer items-start gap-3 rounded-md border bg-background p-3 hover:border-primary/40">
                    <input
                      type="radio"
                      checked={scheduleMode === 'at'}
                      onChange={() => setScheduleMode('at')}
                      className="mt-1"
                    />
                    <div className="flex-1">
                      <div className="text-sm font-medium">Schedule for</div>
                      <div className="text-xs text-muted-foreground mb-2">
                        Worker auto-fires within ~{Math.ceil(30000 / 1000)}s of the chosen time.
                      </div>
                      <Input
                        type="datetime-local"
                        value={scheduledAtLocal}
                        onChange={(e) => setScheduledAtLocal(e.target.value)}
                        disabled={scheduleMode !== 'at'}
                        className="h-8"
                      />
                    </div>
                  </label>
                </div>
              </div>

              <div className="mt-4 flex flex-wrap items-center gap-2">
                <Button onClick={save} disabled={saving}>
                  {saving ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Save className="mr-1.5 h-4 w-4" />}
                  Save campaign
                </Button>
                <Button variant="outline" onClick={() => router.push('/campaigns')} disabled={saving}>Cancel</Button>
                <span className="ml-auto text-xs text-muted-foreground">
                  {scheduleMode === 'at' && scheduledAtLocal
                    ? `Will fire ~${formatRelative(scheduledAtLocal)}`
                    : 'Manual fire — drives from /campaigns'}
                </span>
              </div>
            </SectionCard>
          )}
        </div>

        {/* Right column — preview pane */}
        <div className="space-y-4 lg:col-span-1">
          {preview ? (
            <>
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Audience preview</CardTitle>
                  <CardDescription>{preview.totalMatchingRows.toLocaleString()} matching rows  showing first {preview.sample.length}.</CardDescription>
                </CardHeader>
                <CardContent className="p-0">
                  <Table>
                    <TableBody>
                      {preview.sample.map((row, i) => (
                        <TableRow key={i}>
                          <TableCell className="text-xs">
                            <div className="space-y-0.5">
                              {Object.entries(row).slice(0, 6).map(([k, v]) => (
                                <div key={k} className="flex items-baseline gap-2">
                                  <Badge variant="outline" className="font-mono text-[10px]">{k}</Badge>
                                  <span className="truncate max-w-[180px]">{v == null ? '' : String(v)}</span>
                                </div>
                              ))}
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>

              {/* SQL preview — Phase 1C item 2. Operator-visible, parameterised. */}
              {preview.sqlPreview && (
                <Card>
                  <CardHeader className="cursor-pointer" onClick={() => setShowSql((v) => !v)}>
                    <CardTitle className="text-base flex items-center gap-2">
                      <code className="font-mono text-[11px] rounded bg-muted px-1.5 py-0.5">SQL</code>
                      <span>Generated query</span>
                      <span className="ml-auto text-xs text-muted-foreground font-normal">
                        {showSql ? 'hide' : 'show'}
                      </span>
                    </CardTitle>
                    {!showSql && (
                      <CardDescription className="text-[11px]">
                        Click to inspect the parameterised SQL that runs on save / fire.
                      </CardDescription>
                    )}
                  </CardHeader>
                  {showSql && (
                    <CardContent className="space-y-3 text-xs">
                      <div>
                        <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Sample SQL</div>
                        <pre className="overflow-x-auto rounded-md bg-muted p-2 font-mono text-[11px]">{preview.sqlPreview.sampleSql}</pre>
                      </div>
                      <div>
                        <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Count SQL</div>
                        <pre className="overflow-x-auto rounded-md bg-muted p-2 font-mono text-[11px]">{preview.sqlPreview.countSql}</pre>
                      </div>
                      {preview.sqlPreview.params.length > 0 && (
                        <div>
                          <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Bound parameters</div>
                          <ol className="space-y-1 font-mono text-[11px]">
                            {preview.sqlPreview.params.map((p, i) => (
                              <li key={i} className="flex gap-2">
                                <span className="text-muted-foreground">${i + 1}</span>
                                <span className="rounded bg-muted px-1.5 py-0.5">{JSON.stringify(p)}</span>
                              </li>
                            ))}
                          </ol>
                        </div>
                      )}
                      <div className="text-[10px] text-muted-foreground">
                        Values are bound through pg's <code className="font-mono">$N</code> placeholders  never interpolated into the SQL string.
                      </div>
                    </CardContent>
                  )}
                </Card>
              )}
            </>
          ) : (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-10 text-center text-sm text-muted-foreground">
                <Eye className="mb-2 h-5 w-5 text-muted-foreground" />
                Pick a table and click <span className="font-mono mx-1">Refresh preview</span> to see the audience.
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </Shell>
  );

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------
  function addFilter() {
    setFilters((arr) => [...arr, { id: crypto.randomUUID(), column: '', op: '=', value: '' }]);
  }
  function setFilter(idx: number, patch: Partial<FilterRow>) {
    setFilters((arr) => arr.map((f, i) => (i === idx ? { ...f, ...patch } : f)));
  }
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function SectionCard({
  n, icon, title, blurb, children,
}: { n: number; icon: React.ReactNode; title: string; blurb: string; children: React.ReactNode }) {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary text-primary-foreground text-xs font-semibold">{n}</span>
          <span className="text-muted-foreground">{icon}</span>
          <CardTitle className="text-base">{title}</CardTitle>
        </div>
        <CardDescription>{blurb}</CardDescription>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

function formatRelative(localDateString: string): string {
  const t = new Date(localDateString).getTime();
  if (!Number.isFinite(t)) return 'soon';
  const diffMs = t - Date.now();
  const m = Math.round(diffMs / 60000);
  if (m < 1) return 'in <1 min';
  if (m < 60) return `in ${m} min`;
  const h = Math.round(m / 60);
  if (h < 24) return `in ${h}h`;
  const d = Math.round(h / 24);
  return `in ${d}d`;
}

function ColumnPicker({
  label, value, onChange, cols, required,
}: {
  label: string; value: string; onChange: (v: string) => void;
  cols: ColumnInfo[]; required?: boolean;
}) {
  return (
    <div>
      <Label>{label}{required ? ' *' : ''}</Label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger><SelectValue placeholder="" /></SelectTrigger>
        <SelectContent>
          {!required && <SelectItem value="__none__">(none)</SelectItem>}
          {cols.map((c) => (
            <SelectItem key={c.name} value={c.name}>
              {c.name} <span className="text-muted-foreground"> {c.dataType}</span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
