// /admin/history — read-only view of recent triggers from Novu's API.
'use client';
import React, { useEffect, useMemo, useState } from 'react';
import {
  RefreshCw, History as HistoryIcon, Search, Loader2, Mail, Inbox, Smartphone, MessageSquare,
} from 'lucide-react';
import { toast } from 'sonner';
import { Shell } from '@/components/Shell';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { fmtDateTime, fmtRelative } from '@/lib/utils';

type N = {
  _id?: string;
  createdAt?: string;
  transactionId?: string;
  channels?: string[];
  templateIdentifier?: string;
  template?: { name?: string };
  _templateId?: { name?: string };
  _subscriberId?: string;
  subscriber?: { subscriberId?: string };
};

const CHANNEL_ICON: Record<string, React.ReactNode> = {
  email:    <Mail className="h-3 w-3" />,
  in_app:   <Inbox className="h-3 w-3" />,
  sms:      <Smartphone className="h-3 w-3" />,
  whatsapp: <MessageSquare className="h-3 w-3" />,
  chat:     <MessageSquare className="h-3 w-3" />,
};

export default function HistoryPage() {
  const [items, setItems] = useState<N[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');

  async function reload() {
    setLoading(true);
    try {
      const r = await fetch('/admin/api/history', { cache: 'no-store' });
      if (r.status === 401) { window.location.href = '/admin'; return; }
      const j = await r.json();
      if (!j.ok) throw new Error(j.error || 'Novu API error');
      setItems(j.items || []);
    } catch (e: any) {
      toast.error('Failed to load history', { description: String(e?.message || e) });
    } finally { setLoading(false); }
  }
  useEffect(() => { reload(); }, []);

  const filtered = useMemo(() => {
    if (!q.trim()) return items;
    const needle = q.toLowerCase();
    return items.filter((n) => {
      const wf = n._templateId?.name || n.template?.name || n.templateIdentifier || '';
      const sub = n._subscriberId || n.subscriber?.subscriberId || '';
      const txn = n.transactionId || '';
      return [wf, sub, txn].some((s) => s.toLowerCase().includes(needle));
    });
  }, [items, q]);

  return (
    <Shell active="history">
      <div className="mb-6 flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Activity</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Recent triggers as reported by Novu  read-only audit view.
          </p>
        </div>
        <Button variant="outline" onClick={reload} disabled={loading}>
          {loading ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-1.5 h-4 w-4" />}
          Refresh
        </Button>
      </div>

      {/* Filter bar */}
      <div className="mb-4 flex items-center gap-2">
        <div className="relative max-w-sm flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Filter by workflow, subscriber, transactionId"
            className="pl-9"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
        <span className="text-xs text-muted-foreground">
          {loading ? '' : `${filtered.length} ${filtered.length === 1 ? 'event' : 'events'}`}
        </span>
      </div>

      <Card>
        <CardContent className="p-0">
          {loading ? (
            <div className="space-y-2 p-6">
              <Skeleton className="h-9 w-full" />
              <Skeleton className="h-9 w-full" />
              <Skeleton className="h-9 w-full" />
              <Skeleton className="h-9 w-full" />
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center px-6 py-16 text-center">
              <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary">
                <HistoryIcon className="h-5 w-5" />
              </div>
              <div className="text-base font-semibold">No matching activity</div>
              <p className="mt-1 max-w-md text-sm text-muted-foreground">
                {q ? 'Try a different filter, or clear the search.' : 'No triggers in the last batch returned by Novu.'}
              </p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Time</TableHead>
                  <TableHead>Workflow</TableHead>
                  <TableHead>Subscriber</TableHead>
                  <TableHead>transactionId</TableHead>
                  <TableHead>Channels</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((n: N, i: number) => {
                  const wf = n._templateId?.name || n.template?.name || n.templateIdentifier || '';
                  const sub = n._subscriberId || n.subscriber?.subscriberId || '';
                  return (
                    <TableRow key={n._id || i}>
                      <TableCell className="whitespace-nowrap text-xs">
                        <div>{fmtDateTime(n.createdAt)}</div>
                        <div className="text-[11px] text-muted-foreground">{fmtRelative(n.createdAt)}</div>
                      </TableCell>
                      <TableCell className="font-medium">{wf}</TableCell>
                      <TableCell className="font-mono text-xs">{sub}</TableCell>
                      <TableCell className="max-w-[16rem] truncate font-mono text-xs">{n.transactionId}</TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-1">
                          {(n.channels || []).map((c) => (
                            <Badge key={c} variant="secondary" className="gap-1 font-normal">
                              {CHANNEL_ICON[c] || null}
                              {c}
                            </Badge>
                          ))}
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </Shell>
  );
}
