// /admin/schedules — list + create one-time scheduled triggers.
'use client';
import React, { useEffect, useMemo, useState } from 'react';
import { Plus, X, Clock, Activity, CheckCircle2, AlertCircle, Loader2, CalendarClock } from 'lucide-react';
import { toast } from 'sonner';
import { Shell } from '@/components/Shell';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { fmtDateTime, fmtRelative } from '@/lib/utils';

type Status = 'pending' | 'firing' | 'fired' | 'failed';
type S = {
  _id: string;
  workflowName: string;
  subscriberId: string;
  payload: any;
  fireAt: string;
  status: Status;
  novuTransactionId?: string;
  firedAt?: string;
  errorReason?: string;
  createdAt: string;
};
type Wf = { workflowId: string; name: string };

const initialForm = {
  workflowName: '',
  subscriberId: 'test-icpaas-1',
  fireAtLocal: '',
  payloadText: '{\n  "triggerInstanceId": "uuid-here"\n}',
};

export default function SchedulesPage() {
  const [items, setItems] = useState<S[]>([]);
  const [workflows, setWorkflows] = useState<Wf[]>([]);
  const [openCreate, setOpenCreate] = useState(false);
  const [form, setForm] = useState(initialForm);
  const [cancelling, setCancelling] = useState<S | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  async function reload() {
    setLoading(true);
    try {
      const [s, w] = await Promise.all([
        fetch('/admin/api/schedules', { cache: 'no-store' }),
        fetch('/admin/api/workflows', { cache: 'no-store' }),
      ]);
      if (s.status === 401) { window.location.href = '/admin'; return; }
      const sj = await s.json();
      const wj = await w.json();
      setItems(sj.items || []);
      setWorkflows(wj.items || []);
      if (!form.workflowName && wj.items?.length) {
        setForm((f) => ({ ...f, workflowName: wj.items[0].workflowId }));
      }
    } catch (e: any) {
      toast.error('Failed to load schedules', { description: String(e?.message || e) });
    } finally { setLoading(false); }
  }
  useEffect(() => { reload(); }, []);

  const counts = useMemo(() => ({
    pending: items.filter((i) => i.status === 'pending').length,
    firing:  items.filter((i) => i.status === 'firing').length,
    fired:   items.filter((i) => i.status === 'fired').length,
    failed:  items.filter((i) => i.status === 'failed').length,
  }), [items]);

  async function create() {
    let payload: any;
    try { payload = form.payloadText.trim() ? JSON.parse(form.payloadText) : {}; }
    catch (e: any) {
      toast.error('Payload must be valid JSON', { description: e.message });
      return;
    }
    if (!form.workflowName || !form.subscriberId || !form.fireAtLocal) {
      toast.error('Workflow, subscriber, and fireAt are required.');
      return;
    }
    setBusy(true);
    try {
      const fireAt = new Date(form.fireAtLocal).toISOString();
      const r = await fetch('/admin/api/schedules', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          workflowName: form.workflowName,
          subscriberId: form.subscriberId,
          fireAt,
          payload,
        }),
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        throw new Error(j.error || ('HTTP ' + r.status));
      }
      toast.success('Scheduled.', {
        description: `${form.workflowName} will fire at ${new Date(fireAt).toLocaleString()}.`,
      });
      setOpenCreate(false);
      setForm({ ...initialForm, workflowName: form.workflowName });
      await reload();
    } catch (e: any) {
      toast.error('Schedule failed', { description: String(e?.message || e) });
    } finally { setBusy(false); }
  }

  async function cancel() {
    if (!cancelling) return;
    setBusy(true);
    try {
      const r = await fetch('/admin/api/schedules?id=' + cancelling._id, { method: 'DELETE' });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      toast.success('Cancelled scheduled trigger.');
      setCancelling(null);
      await reload();
    } catch (e: any) {
      toast.error('Cancel failed', { description: String(e?.message || e) });
    } finally { setBusy(false); }
  }

  return (
    <Shell active="schedules">
      <div className="mb-6 flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Schedules</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Queue one-time triggers to fire at a future timestamp. The schedule worker polls every minute.
          </p>
        </div>
        <Button onClick={() => setOpenCreate(true)}>
          <Plus className="mr-1.5 h-4 w-4" />
          Schedule trigger
        </Button>
      </div>

      <div className="mb-6 grid gap-3 sm:grid-cols-4">
        <StatChip icon={<Clock className="h-4 w-4" />} label="Pending"  value={loading ? '' : String(counts.pending)} tone="default" />
        <StatChip icon={<Activity className="h-4 w-4" />} label="Firing"   value={loading ? '' : String(counts.firing)}  tone="info" />
        <StatChip icon={<CheckCircle2 className="h-4 w-4" />} label="Fired"   value={loading ? '' : String(counts.fired)}   tone="success" />
        <StatChip icon={<AlertCircle className="h-4 w-4" />} label="Failed"  value={loading ? '' : String(counts.failed)}  tone="destructive" />
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
            <EmptyState onCreate={() => setOpenCreate(true)} />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Workflow</TableHead>
                  <TableHead>Subscriber</TableHead>
                  <TableHead>Fire at</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Novu transactionId</TableHead>
                  <TableHead className="w-24 text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((s) => (
                  <TableRow key={s._id}>
                    <TableCell className="font-medium">{s.workflowName}</TableCell>
                    <TableCell className="font-mono text-xs">{s.subscriberId}</TableCell>
                    <TableCell className="whitespace-nowrap text-xs">
                      <div>{fmtDateTime(s.fireAt)}</div>
                      <div className="text-[11px] text-muted-foreground">{fmtRelative(s.fireAt)}</div>
                    </TableCell>
                    <TableCell><StatusBadge status={s.status} /></TableCell>
                    <TableCell className="max-w-[16rem] truncate font-mono text-xs">
                      {s.novuTransactionId
                        ? s.novuTransactionId
                        : s.errorReason
                        ? <span className="text-destructive">{s.errorReason}</span>
                        : <span className="text-muted-foreground"></span>}
                    </TableCell>
                    <TableCell className="text-right">
                      {s.status === 'pending' && (
                        <Button size="sm" variant="ghost" className="h-8 px-2 text-destructive hover:text-destructive" onClick={() => setCancelling(s)}>
                          <X className="h-3.5 w-3.5" />
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <p className="mt-4 text-xs text-muted-foreground">
        MVP supports one-time triggers only. Recurring (cron) and audience segments are deferred to v2.
      </p>

      {/* Create dialog */}
      <Dialog open={openCreate} onOpenChange={setOpenCreate}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>Schedule a one-time trigger</DialogTitle>
            <DialogDescription>
              Queues a trigger row in MongoDB; the schedule worker will fire it via Novu Bridge at the chosen IST time.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Workflow</Label>
              <Select value={form.workflowName} onValueChange={(v) => setForm({ ...form, workflowName: v })}>
                <SelectTrigger><SelectValue placeholder="Pick a workflow" /></SelectTrigger>
                <SelectContent>
                  {workflows.length === 0 && <SelectItem value="__none__" disabled>(no workflows)</SelectItem>}
                  {workflows.map((w) => (
                    <SelectItem key={w.workflowId} value={w.workflowId}>{w.workflowId}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="s-sub">Subscriber ID</Label>
              <Input id="s-sub" value={form.subscriberId} onChange={(e) => setForm({ ...form, subscriberId: e.target.value })} />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="s-fire">Fire at (local)</Label>
              <Input
                id="s-fire"
                type="datetime-local"
                value={form.fireAtLocal}
                onChange={(e) => setForm({ ...form, fireAtLocal: e.target.value })}
              />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="s-payload">Payload (JSON)</Label>
              <Textarea
                id="s-payload"
                rows={5}
                className="font-mono text-xs"
                value={form.payloadText}
                onChange={(e) => setForm({ ...form, payloadText: e.target.value })}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpenCreate(false)} disabled={busy}>Cancel</Button>
            <Button onClick={create} disabled={busy}>
              {busy && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
              Schedule
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Cancel confirm */}
      <AlertDialog open={!!cancelling} onOpenChange={(open) => !open && setCancelling(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancel this scheduled trigger?</AlertDialogTitle>
            <AlertDialogDescription>
              {cancelling && (
                <>
                  <span className="font-medium text-foreground">{cancelling.workflowName}</span> for subscriber{' '}
                  <span className="font-mono text-foreground">{cancelling.subscriberId}</span> at{' '}
                  <span className="font-medium text-foreground">{fmtDateTime(cancelling.fireAt)}</span>.
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Keep it</AlertDialogCancel>
            <AlertDialogAction
              onClick={cancel}
              disabled={busy}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {busy && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
              Cancel trigger
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Shell>
  );
}

function StatusBadge({ status }: { status: Status }) {
  if (status === 'pending') return <Badge variant="outline">Pending</Badge>;
  if (status === 'firing')  return <Badge variant="default">Firing</Badge>;
  if (status === 'fired')   return <Badge variant="success">Fired</Badge>;
  return <Badge variant="destructive">Failed</Badge>;
}

function StatChip({ icon, label, value, tone }:
  { icon: React.ReactNode; label: string; value: string; tone: 'default' | 'info' | 'success' | 'destructive' }) {
  const toneClass =
    tone === 'success' ? 'text-success' :
    tone === 'info'    ? 'text-primary' :
    tone === 'destructive' ? 'text-destructive' :
    'text-muted-foreground';
  return (
    <div className="flex items-center gap-3 rounded-lg border bg-card px-4 py-3">
      <div className={`flex h-8 w-8 items-center justify-center rounded-md bg-muted ${toneClass}`}>{icon}</div>
      <div>
        <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</div>
        <div className="text-lg font-semibold">{value || <Skeleton className="h-5 w-8" />}</div>
      </div>
    </div>
  );
}

function EmptyState({ onCreate }: { onCreate: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-16 text-center">
      <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary">
        <CalendarClock className="h-5 w-5" />
      </div>
      <div className="text-base font-semibold">Nothing scheduled</div>
      <p className="mt-1 max-w-md text-sm text-muted-foreground">
        Queue a one-time trigger to fire any Bridge workflow at a chosen IST timestamp.
      </p>
      <Button className="mt-4" onClick={onCreate}>
        <Plus className="mr-1.5 h-4 w-4" />
        Schedule trigger
      </Button>
    </div>
  );
}
