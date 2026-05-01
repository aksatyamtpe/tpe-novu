// /admin/templates — list, create, and edit operator-controlled templates.
'use client';
import React, { useEffect, useState } from 'react';
import { Plus, Pencil, Trash2, Mail, Inbox, FileText, Loader2 } from 'lucide-react';
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
import { fmtDateTime } from '@/lib/utils';

type T = {
  _id: string;
  name: string;
  channel: 'email' | 'inApp';
  subject: string;
  htmlBody: string;
  textBody?: string;
  language: 'en' | 'hi';
  updatedAt?: string;
};

const blank: Partial<T> = {
  name: '',
  channel: 'email',
  subject: '',
  htmlBody: '',
  textBody: '',
  language: 'en',
};

export default function TemplatesPage() {
  const [items, setItems] = useState<T[]>([]);
  const [editing, setEditing] = useState<Partial<T> | null>(null);
  const [deleting, setDeleting] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  async function reload() {
    setLoading(true);
    try {
      const r = await fetch('/admin/api/templates', { cache: 'no-store' });
      if (r.status === 401) { window.location.href = '/admin'; return; }
      const j = await r.json();
      setItems(j.items || []);
    } catch (e: any) {
      toast.error('Failed to load templates', { description: String(e?.message || e) });
    } finally { setLoading(false); }
  }
  useEffect(() => { reload(); }, []);

  async function save() {
    if (!editing?.name?.trim() || !editing?.subject?.trim()) {
      toast.error('Name and subject are required.');
      return;
    }
    setBusy(true);
    try {
      const isUpdate = !!editing._id;
      const r = await fetch(
        '/admin/api/templates' + (isUpdate ? '?id=' + editing._id : ''),
        {
          method: isUpdate ? 'PATCH' : 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(editing),
        },
      );
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        throw new Error(j.error || ('HTTP ' + r.status));
      }
      toast.success(isUpdate ? 'Template updated.' : 'Template created.');
      setEditing(null);
      await reload();
    } catch (e: any) {
      toast.error('Save failed', { description: String(e?.message || e) });
    } finally { setBusy(false); }
  }

  async function confirmDelete() {
    if (!deleting) return;
    setBusy(true);
    try {
      const r = await fetch('/admin/api/templates?id=' + deleting._id, { method: 'DELETE' });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      toast.success('Template deleted.', { description: deleting.name });
      setDeleting(null);
      await reload();
    } catch (e: any) {
      toast.error('Delete failed', { description: String(e?.message || e) });
    } finally { setBusy(false); }
  }

  return (
    <Shell active="templates">
      {/* Page header */}
      <div className="mb-6 flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Templates</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Operator-controlled email and in-app template HTML, stored in MongoDB and pulled by Bridge workflows at runtime.
          </p>
        </div>
        <Button onClick={() => setEditing({ ...blank })}>
          <Plus className="mr-1.5 h-4 w-4" />
          New template
        </Button>
      </div>

      {/* Stats strip */}
      <div className="mb-6 grid gap-3 sm:grid-cols-3">
        <StatChip
          icon={<FileText className="h-4 w-4" />}
          label="Total templates"
          value={loading ? '' : String(items.length)}
        />
        <StatChip
          icon={<Mail className="h-4 w-4" />}
          label="Email"
          value={loading ? '' : String(items.filter((i) => i.channel === 'email').length)}
        />
        <StatChip
          icon={<Inbox className="h-4 w-4" />}
          label="In-app"
          value={loading ? '' : String(items.filter((i) => i.channel === 'inApp').length)}
        />
      </div>

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          {loading ? (
            <div className="space-y-2 p-6">
              <Skeleton className="h-9 w-full" />
              <Skeleton className="h-9 w-full" />
              <Skeleton className="h-9 w-full" />
            </div>
          ) : items.length === 0 ? (
            <EmptyState onCreate={() => setEditing({ ...blank })} />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Channel</TableHead>
                  <TableHead>Lang</TableHead>
                  <TableHead>Subject</TableHead>
                  <TableHead>Updated</TableHead>
                  <TableHead className="w-32 text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((t) => (
                  <TableRow key={t._id}>
                    <TableCell className="font-medium">{t.name}</TableCell>
                    <TableCell>
                      {t.channel === 'email'
                        ? <Badge variant="secondary"><Mail className="mr-1 h-3 w-3" />email</Badge>
                        : <Badge variant="secondary"><Inbox className="mr-1 h-3 w-3" />inApp</Badge>}
                    </TableCell>
                    <TableCell><Badge variant="outline" className="font-mono text-[10px]">{t.language}</Badge></TableCell>
                    <TableCell className="max-w-md truncate text-muted-foreground">{t.subject}</TableCell>
                    <TableCell className="whitespace-nowrap text-xs text-muted-foreground">{fmtDateTime(t.updatedAt)}</TableCell>
                    <TableCell className="text-right">
                      <Button size="sm" variant="ghost" className="h-8 px-2" onClick={() => setEditing(t)}>
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-8 px-2 text-destructive hover:text-destructive"
                        onClick={() => setDeleting(t)}
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

      {/* Edit / Create dialog */}
      <Dialog open={!!editing} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{editing?._id ? 'Edit template' : 'New template'}</DialogTitle>
            <DialogDescription>
              Operator-managed copy. Bridge workflows pull this by name at runtime.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="t-name">Name</Label>
              <Input
                id="t-name"
                value={editing?.name || ''}
                onChange={(e) => setEditing((s) => ({ ...s, name: e.target.value }))}
                placeholder="e.g. ph02-welcome-email"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Channel</Label>
              <Select
                value={editing?.channel || 'email'}
                onValueChange={(v) => setEditing((s) => ({ ...s, channel: v as any }))}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="email">Email</SelectItem>
                  <SelectItem value="inApp">In-app</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Language</Label>
              <Select
                value={editing?.language || 'en'}
                onValueChange={(v) => setEditing((s) => ({ ...s, language: v as any }))}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="en">English (en)</SelectItem>
                  <SelectItem value="hi">Hindi (hi)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="t-subject">Subject</Label>
              <Input
                id="t-subject"
                value={editing?.subject || ''}
                onChange={(e) => setEditing((s) => ({ ...s, subject: e.target.value }))}
                placeholder="Subject line"
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="t-html">HTML body</Label>
            <Textarea
              id="t-html"
              rows={8}
              className="font-mono text-xs"
              value={editing?.htmlBody || ''}
              onChange={(e) => setEditing((s) => ({ ...s, htmlBody: e.target.value }))}
              placeholder="<p>Hello {{firstName}}…</p>"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="t-text">Text body (optional)</Label>
            <Textarea
              id="t-text"
              rows={3}
              className="font-mono text-xs"
              value={editing?.textBody || ''}
              onChange={(e) => setEditing((s) => ({ ...s, textBody: e.target.value }))}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)} disabled={busy}>Cancel</Button>
            <Button onClick={save} disabled={busy}>
              {busy && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
              {editing?._id ? 'Save changes' : 'Create template'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirm */}
      <AlertDialog open={!!deleting} onOpenChange={(open) => !open && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this template?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleting && (
                <>
                  <span className="font-medium text-foreground">{deleting.name}</span> will be permanently removed.
                  Any Bridge workflow that pulls this template by name will fall back to its inline default.
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

function StatChip({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="flex items-center gap-3 rounded-lg border bg-card px-4 py-3">
      <div className="flex h-8 w-8 items-center justify-center rounded-md bg-primary/10 text-primary">{icon}</div>
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
        <FileText className="h-5 w-5" />
      </div>
      <div className="text-base font-semibold">No templates yet</div>
      <p className="mt-1 max-w-md text-sm text-muted-foreground">
        Templates here are operator-managed HTML snippets pulled by Bridge workflows at dispatch time. Create your first.
      </p>
      <Button className="mt-4" onClick={onCreate}>
        <Plus className="mr-1.5 h-4 w-4" />
        New template
      </Button>
    </div>
  );
}
