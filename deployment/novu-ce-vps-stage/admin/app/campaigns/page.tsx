// /admin/campaigns — list of saved campaigns + "New campaign" button.
'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  Megaphone, Plus, Loader2, Play, AlertTriangle, CheckCircle2, Trash2, Clock, RotateCcw,
} from 'lucide-react';
import { toast } from 'sonner';
import { Shell } from '@/components/Shell';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { fmtDateTime, fmtRelative } from '@/lib/utils';

type Campaign = {
  _id: string;
  name: string;
  description?: string;
  sourceTable: string;
  targetWorkflow: string;
  filters: any[];
  scheduledAt?: string | null;
  status: 'draft' | 'fired_empty' | 'fired_once' | 'fired_partial' | 'fired_complete' | 'failed';
  updatedAt: string;
  createdAt: string;
};

export default function CampaignsPage() {
  const [items, setItems] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [firing, setFiring] = useState<string | null>(null);
  const [retrying, setRetrying] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<Campaign | null>(null);
  const [busy, setBusy] = useState(false);

  async function reload() {
    setLoading(true);
    try {
      const r = await fetch('/admin/api/campaigns', { cache: 'no-store' });
      if (r.status === 401) { window.location.href = '/admin'; return; }
      const j = await r.json();
      setItems(j.items || []);
    } catch (e: any) {
      toast.error('Failed to load campaigns', { description: String(e?.message || e) });
    } finally { setLoading(false); }
  }
  useEffect(() => { reload(); }, []);

  async function fireNow(c: Campaign) {
    setFiring(c._id);
    try {
      const r = await fetch(`/admin/api/campaigns/${c._id}/dispatch-now`, { method: 'POST' });
      const j = await r.json();
      if (!r.ok || !j.ok) throw new Error(j.error || ('HTTP ' + r.status));
      toast.success(`Fired ${j.triggered} of ${j.rowCount}`, {
        description: j.skipped + j.errored > 0
          ? `Skipped ${j.skipped}, errored ${j.errored}`
          : 'all rows succeeded',
      });
      await reload();
    } catch (e: any) {
      toast.error('Fire failed', { description: String(e?.message || e) });
    } finally { setFiring(null); }
  }

  async function retryLastErrored(c: Campaign) {
    setRetrying(c._id);
    try {
      // Look up the most recent run of this campaign to find the runId.
      const r = await fetch(`/admin/api/campaigns/${c._id}`, { cache: 'no-store' });
      const j = await r.json();
      if (!r.ok || !j.ok) throw new Error(j.error || ('HTTP ' + r.status));
      const runs = j.runs || [];
      if (runs.length === 0) {
        toast.error('No runs to retry', { description: 'Fire the campaign first.' });
        return;
      }
      // Find the most recent run with errored > 0.
      const target = runs.find((run: any) => (run.errored || 0) > 0);
      if (!target) {
        toast.success('Nothing to retry', { description: 'No errored rows in recent runs.' });
        return;
      }
      const retryRes = await fetch(
        `/admin/api/campaigns/${c._id}/retry-run/${target._id}`,
        { method: 'POST' },
      );
      const retryJson = await retryRes.json();
      if (!retryRes.ok || !retryJson.ok) {
        throw new Error(retryJson.error || ('HTTP ' + retryRes.status));
      }
      toast.success(
        `Retried ${retryJson.erroredRowsTargeted} errored row${retryJson.erroredRowsTargeted === 1 ? '' : 's'}`,
        {
          description: `triggered ${retryJson.triggered}, skipped ${retryJson.skipped}, errored ${retryJson.errored}`,
        },
      );
      await reload();
    } catch (e: any) {
      toast.error('Retry failed', { description: String(e?.message || e) });
    } finally { setRetrying(null); }
  }

  async function confirmDelete() {
    if (!deleting) return;
    setBusy(true);
    try {
      const r = await fetch(`/admin/api/campaigns/${deleting._id}`, { method: 'DELETE' });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      toast.success('Campaign deleted', { description: deleting.name });
      setDeleting(null);
      await reload();
    } catch (e: any) {
      toast.error('Delete failed', { description: String(e?.message || e) });
    } finally { setBusy(false); }
  }

  return (
    <Shell active="campaigns">
      <div className="mb-6 flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Campaigns</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Pick a data slice from the analytics DB, map fields to a workflow trigger, and fire it.
            Channel allowlist on <Link href="/channels" className="underline underline-offset-2 hover:text-foreground">/channels</Link> still applies.
          </p>
        </div>
        <Button asChild>
          <Link href="/campaigns/new">
            <Plus className="mr-1.5 h-4 w-4" />
            New campaign
          </Link>
        </Button>
      </div>

      <Card>
        <CardContent className="p-0">
          {loading ? (
            <div className="space-y-2 p-6">
              <Skeleton className="h-9 w-full" />
              <Skeleton className="h-9 w-full" />
              <Skeleton className="h-9 w-full" />
            </div>
          ) : items.length === 0 ? (
            <Empty />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Source table</TableHead>
                  <TableHead>Workflow</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Updated</TableHead>
                  <TableHead className="w-32 text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((c) => (
                  <TableRow key={c._id}>
                    <TableCell>
                      <Link
                        href={`/campaigns/${c._id}`}
                        className="font-medium hover:underline underline-offset-2"
                      >
                        {c.name}
                      </Link>
                      {c.description ? (
                        <div className="text-xs text-muted-foreground">{c.description}</div>
                      ) : null}
                    </TableCell>
                    <TableCell><Badge variant="secondary" className="font-mono">{c.sourceTable}</Badge></TableCell>
                    <TableCell><Badge variant="outline" className="font-mono">{c.targetWorkflow}</Badge></TableCell>
                    <TableCell><StatusChip status={c.status} /></TableCell>
                    <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                      <div>{fmtDateTime(c.updatedAt)}</div>
                      <div className="text-[11px]">{fmtRelative(c.updatedAt)}</div>
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-8 px-2 mr-1"
                        title="Fire now"
                        onClick={() => fireNow(c)}
                        disabled={firing === c._id || retrying === c._id}
                      >
                        {firing === c._id
                          ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          : <Play className="h-3.5 w-3.5" />}
                      </Button>
                      {(c.status === 'failed' || c.status === 'fired_partial') && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-8 px-2 mr-1 border-warning/40 text-warning hover:bg-warning/10"
                          title="Retry errored rows from the last run"
                          onClick={() => retryLastErrored(c)}
                          disabled={firing === c._id || retrying === c._id}
                        >
                          {retrying === c._id
                            ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            : <RotateCcw className="h-3.5 w-3.5" />}
                        </Button>
                      )}
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-8 px-2 text-destructive hover:text-destructive"
                        onClick={() => setDeleting(c)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <AlertDialog open={!!deleting} onOpenChange={(o) => !o && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this campaign?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleting && (
                <>
                  <span className="font-medium text-foreground">{deleting.name}</span> will be permanently removed.
                  Past runs in <code className="font-mono text-[11px]">tpe_campaign_runs</code> are kept for audit.
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmDelete}
              disabled={busy}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {busy && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Shell>
  );
}

function Empty() {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-16 text-center">
      <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary">
        <Megaphone className="h-5 w-5" />
      </div>
      <div className="text-base font-semibold">No campaigns yet</div>
      <p className="mt-1 max-w-md text-sm text-muted-foreground">
        Build your first campaign  pick a data slice from the analytics DB, map columns to a workflow trigger, and fire it for the matching audience.
      </p>
      <Button className="mt-4" asChild>
        <Link href="/campaigns/new">
          <Plus className="mr-1.5 h-4 w-4" />
          New campaign
        </Link>
      </Button>
    </div>
  );
}

function StatusChip({ status }: { status: Campaign['status'] }) {
  if (status === 'draft')          return <Badge variant="secondary"><Clock className="mr-1 h-3 w-3" />Draft</Badge>;
  if (status === 'fired_complete') return <Badge variant="success"><CheckCircle2 className="mr-1 h-3 w-3" />Fired</Badge>;
  if (status === 'fired_partial')  return <Badge variant="warning">Partial</Badge>;
  if (status === 'failed')         return <Badge variant="destructive"><AlertTriangle className="mr-1 h-3 w-3" />Failed</Badge>;
  if (status === 'fired_empty')    return <Badge variant="outline" className="text-muted-foreground">Empty audience</Badge>;
  return <Badge variant="outline">Fired (all skipped)</Badge>;  // fired_once
}
