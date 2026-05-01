// /admin/campaigns/[id] — campaign detail + run history.
//
// Phase 1C item 4: read-only audit pane showing every fan-out for a single
// campaign — rowCount / triggered / skipped / errored, drill-down into
// per-row outcomes, retry-from-this-run button on failed rows.
'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import {
  ArrowLeft, Megaphone, RefreshCw, Loader2, Play, RotateCcw,
  CheckCircle2, AlertTriangle, XCircle, MinusCircle,
} from 'lucide-react';
import { toast } from 'sonner';
import { Shell } from '@/components/Shell';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { fmtDateTime, fmtRelative } from '@/lib/utils';

type CampaignStatus =
  | 'draft' | 'fired_empty' | 'fired_once' | 'fired_partial' | 'fired_complete' | 'failed';

type Campaign = {
  _id: string;
  name: string;
  description?: string;
  sourceTable: string;
  targetWorkflow: string;
  filters: any[];
  fieldMap: any;
  scheduledAt?: string | null;
  status: CampaignStatus;
  createdAt: string;
  updatedAt: string;
};

type RunPerRow = {
  subscriberId: string;
  status: 'sent' | 'skipped' | 'errored';
  reason?: string;
  novuTransactionId?: string;
};

type Run = {
  _id: string;
  campaignId: string;
  startedAt: string;
  finishedAt?: string;
  rowCount: number;
  triggered: number;
  skipped: number;
  errored: number;
  perRow: RunPerRow[];
  triggeredBy?: string;
};

export default function CampaignDetailPage() {
  const params = useParams<{ id: string }>();
  const campaignId = params.id as string;

  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [runs, setRuns] = useState<Run[]>([]);
  const [loading, setLoading] = useState(true);
  const [firing, setFiring] = useState(false);
  const [retrying, setRetrying] = useState<string | null>(null);
  const [openRunId, setOpenRunId] = useState<string | null>(null);
  const [perRowFilter, setPerRowFilter] = useState<'all' | 'errored' | 'sent' | 'skipped'>('all');

  async function reload() {
    setLoading(true);
    try {
      const r = await fetch(`/admin/api/campaigns/${campaignId}`, { cache: 'no-store' });
      if (r.status === 401) { window.location.href = '/admin'; return; }
      const j = await r.json();
      if (!j.ok) throw new Error(j.error || 'failed to load');
      setCampaign(j.campaign);
      setRuns(j.runs || []);
    } catch (e: any) {
      toast.error('Failed to load campaign', { description: String(e?.message || e) });
    } finally { setLoading(false); }
  }
  useEffect(() => { reload(); }, [campaignId]);

  async function fireNow() {
    if (!campaign) return;
    setFiring(true);
    try {
      const r = await fetch(`/admin/api/campaigns/${campaignId}/dispatch-now`, { method: 'POST' });
      const j = await r.json();
      if (!r.ok || !j.ok) throw new Error(j.error || ('HTTP ' + r.status));
      toast.success(`Fired ${j.triggered} of ${j.rowCount}`, {
        description: j.skipped + j.errored > 0
          ? `Skipped ${j.skipped}, errored ${j.errored}` : 'all rows succeeded',
      });
      await reload();
    } catch (e: any) {
      toast.error('Fire failed', { description: String(e?.message || e) });
    } finally { setFiring(false); }
  }

  async function retryRun(runId: string) {
    setRetrying(runId);
    try {
      const r = await fetch(`/admin/api/campaigns/${campaignId}/retry-run/${runId}`, { method: 'POST' });
      const j = await r.json();
      if (!r.ok || !j.ok) throw new Error(j.error || ('HTTP ' + r.status));
      toast.success(
        `Retried ${j.erroredRowsTargeted} errored row${j.erroredRowsTargeted === 1 ? '' : 's'}`,
        { description: `triggered ${j.triggered}, skipped ${j.skipped}, errored ${j.errored}` },
      );
      await reload();
    } catch (e: any) {
      toast.error('Retry failed', { description: String(e?.message || e) });
    } finally { setRetrying(null); }
  }

  const openRun = runs.find((r) => r._id === openRunId);

  return (
    <Shell active="campaigns">
      <div className="mb-4">
        <Button asChild variant="ghost" size="sm" className="-ml-2 text-muted-foreground">
          <Link href="/campaigns"><ArrowLeft className="mr-1.5 h-4 w-4" />All campaigns</Link>
        </Button>
      </div>

      {loading || !campaign ? (
        <Skeleton className="h-32 w-full" />
      ) : (
        <>
          <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
            <div>
              <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-3">
                <Megaphone className="h-5 w-5 text-primary" />
                {campaign.name}
              </h1>
              {campaign.description && (
                <p className="mt-0.5 text-sm text-muted-foreground">{campaign.description}</p>
              )}
              <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                <Badge variant="secondary" className="font-mono">{campaign.sourceTable}</Badge>
                <Badge variant="outline" className="font-mono">{campaign.targetWorkflow}</Badge>
                {campaign.scheduledAt && (
                  <Badge variant="outline">scheduled {fmtRelative(campaign.scheduledAt)}</Badge>
                )}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={reload} disabled={loading}>
                <RefreshCw className="mr-1.5 h-4 w-4" />Refresh
              </Button>
              <Button onClick={fireNow} disabled={firing}>
                {firing ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Play className="mr-1.5 h-4 w-4" />}
                Fire now
              </Button>
            </div>
          </div>

          {/* Run history */}
          <Card>
            <CardHeader>
              <CardTitle>Run history</CardTitle>
              <CardDescription>
                {runs.length === 0 ? 'No runs yet — Fire now to see results.' :
                  `${runs.length} run${runs.length === 1 ? '' : 's'} (most recent first).`}
              </CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              {runs.length === 0 ? (
                <div className="px-6 py-8 text-center text-sm text-muted-foreground">
                  No runs yet — Fire now to see results.
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Started</TableHead>
                      <TableHead>Triggered by</TableHead>
                      <TableHead className="text-right">Rows</TableHead>
                      <TableHead className="text-right">Triggered</TableHead>
                      <TableHead className="text-right">Skipped</TableHead>
                      <TableHead className="text-right">Errored</TableHead>
                      <TableHead className="w-32 text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {runs.map((r) => (
                      <React.Fragment key={r._id}>
                        <TableRow
                          className="cursor-pointer"
                          onClick={() => setOpenRunId(openRunId === r._id ? null : r._id)}
                        >
                          <TableCell className="whitespace-nowrap text-xs">
                            <div>{fmtDateTime(r.startedAt)}</div>
                            <div className="text-[11px] text-muted-foreground">{fmtRelative(r.startedAt)}</div>
                          </TableCell>
                          <TableCell>
                            <Badge variant="outline" className="font-mono text-[10px]">
                              {r.triggeredBy || ''}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-right tabular-nums">{r.rowCount}</TableCell>
                          <TableCell className="text-right tabular-nums">
                            {r.triggered > 0
                              ? <span className="text-success">{r.triggered}</span>
                              : <span className="text-muted-foreground">0</span>}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">{r.skipped}</TableCell>
                          <TableCell className="text-right tabular-nums">
                            {r.errored > 0
                              ? <span className="text-destructive">{r.errored}</span>
                              : <span className="text-muted-foreground">0</span>}
                          </TableCell>
                          <TableCell className="text-right">
                            {r.errored > 0 && (
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-7 px-2 border-warning/40 text-warning"
                                disabled={retrying === r._id}
                                onClick={(e) => { e.stopPropagation(); retryRun(r._id); }}
                              >
                                {retrying === r._id
                                  ? <Loader2 className="h-3 w-3 animate-spin" />
                                  : <><RotateCcw className="mr-1 h-3 w-3" />Retry</>}
                              </Button>
                            )}
                          </TableCell>
                        </TableRow>
                        {openRunId === r._id && (
                          <TableRow>
                            <TableCell colSpan={7} className="bg-muted/30 p-4">
                              <PerRowDetail run={r} filter={perRowFilter} setFilter={setPerRowFilter} />
                            </TableCell>
                          </TableRow>
                        )}
                      </React.Fragment>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </Shell>
  );
}

function PerRowDetail({
  run, filter, setFilter,
}: { run: Run; filter: 'all' | 'errored' | 'sent' | 'skipped'; setFilter: (f: any) => void }) {
  const filtered = filter === 'all' ? run.perRow : run.perRow.filter((p) => p.status === filter);
  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <span className="text-xs font-semibold text-muted-foreground">Filter:</span>
        {(['all', 'errored', 'skipped', 'sent'] as const).map((f) => (
          <Button
            key={f}
            size="sm"
            variant={filter === f ? 'default' : 'outline'}
            className="h-7 px-2 text-xs capitalize"
            onClick={() => setFilter(f)}
          >
            {f} {f !== 'all' && <span className="ml-1 opacity-60">({run.perRow.filter((p) => p.status === f).length})</span>}
          </Button>
        ))}
        <span className="ml-auto text-xs text-muted-foreground">
          Showing {filtered.length} of {run.perRow.length}
          {run.rowCount > run.perRow.length
            ? ` (capped at first ${run.perRow.length} of ${run.rowCount} rows)` : ''}
        </span>
      </div>
      <div className="rounded-md border bg-background">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-8"></TableHead>
              <TableHead>Subscriber</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Reason / Novu txn</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.length === 0 ? (
              <TableRow>
                <TableCell colSpan={4} className="text-center text-xs text-muted-foreground py-6">
                  No rows for this filter.
                </TableCell>
              </TableRow>
            ) : filtered.map((p, i) => (
              <TableRow key={`${p.subscriberId}-${i}`}>
                <TableCell><StatusIcon s={p.status} /></TableCell>
                <TableCell className="font-mono text-xs">{p.subscriberId}</TableCell>
                <TableCell><PerRowStatusBadge s={p.status} /></TableCell>
                <TableCell className="font-mono text-xs text-muted-foreground">
                  {p.novuTransactionId || p.reason || ''}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

function StatusIcon({ s }: { s: 'sent' | 'skipped' | 'errored' }) {
  if (s === 'sent')    return <CheckCircle2 className="h-4 w-4 text-success" />;
  if (s === 'skipped') return <MinusCircle  className="h-4 w-4 text-muted-foreground" />;
  return <XCircle className="h-4 w-4 text-destructive" />;
}

function PerRowStatusBadge({ s }: { s: 'sent' | 'skipped' | 'errored' }) {
  if (s === 'sent')    return <Badge variant="success">Sent</Badge>;
  if (s === 'skipped') return <Badge variant="secondary">Skipped</Badge>;
  return <Badge variant="destructive"><AlertTriangle className="mr-1 h-3 w-3" />Errored</Badge>;
}
