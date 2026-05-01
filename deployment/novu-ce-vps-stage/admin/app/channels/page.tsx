// /admin/channels — operator-managed channel allowlist.
// Four checkboxes (SMS / WhatsApp / Email / In-app). Save persists to Mongo
// `tpe_channel_gating`. The Bridge container reads the same doc with a 10s
// cache, so a checkbox change propagates to dispatch within 10 seconds without
// any container restart.
'use client';

import React, { useEffect, useState } from 'react';
import {
  Smartphone, MessageSquare, Mail, Inbox, Loader2, Save, ShieldAlert, RotateCcw,
} from 'lucide-react';
import { toast } from 'sonner';
import { Shell } from '@/components/Shell';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { fmtDateTime } from '@/lib/utils';

type Channel = 'sms' | 'whatsapp' | 'email' | 'in_app';

type Gating = {
  enabled: Record<Channel, boolean>;
  updatedAt: string;
  updatedBy: string;
};

const CHANNEL_META: Record<
  Channel,
  { label: string; provider: string; icon: React.ElementType; blurb: string }
> = {
  sms: {
    label: 'SMS',
    provider: 'MSG91 v5 Flow',
    icon: Smartphone,
    blurb: 'Direct DLT-registered SMS via MSG91. India-resident, opt-in.',
  },
  whatsapp: {
    label: 'WhatsApp',
    provider: 'ICPaaS Cloud API',
    icon: MessageSquare,
    blurb: 'Meta-approved templates via ICPaaS WhatsApp Business.',
  },
  email: {
    label: 'Email',
    provider: 'Amazon SES (ap-south-1)',
    icon: Mail,
    blurb: 'Currently deferred — SES creds pending production access.',
  },
  in_app: {
    label: 'In-app',
    provider: 'Novu native inbox',
    icon: Inbox,
    blurb: 'Internal Novu Inbox widget; appears in dashboard subscriber feed.',
  },
};

export default function ChannelsPage() {
  const [enabled, setEnabled] = useState<Record<Channel, boolean> | null>(null);
  const [meta, setMeta] = useState<{ updatedAt: string; updatedBy: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  // Snapshot from server, used by Reset.
  const [serverState, setServerState] = useState<Record<Channel, boolean> | null>(null);

  async function reload() {
    setLoading(true);
    try {
      const r = await fetch('/admin/api/channel-gating', { cache: 'no-store' });
      if (r.status === 401) { window.location.href = '/admin'; return; }
      const j = await r.json();
      if (!j.ok) throw new Error(j.error || 'failed to load');
      const gating: Gating = j.gating;
      setEnabled({ ...gating.enabled });
      setServerState({ ...gating.enabled });
      setMeta({ updatedAt: gating.updatedAt, updatedBy: gating.updatedBy });
      setDirty(false);
    } catch (e: any) {
      toast.error('Failed to load channel settings', { description: String(e?.message || e) });
    } finally { setLoading(false); }
  }

  useEffect(() => { reload(); }, []);

  function toggle(channel: Channel, next: boolean) {
    if (!enabled) return;
    const updated = { ...enabled, [channel]: next };
    setEnabled(updated);
    setDirty(serverState ? !shallowEqual(updated, serverState) : true);
  }

  function reset() {
    if (!serverState) return;
    setEnabled({ ...serverState });
    setDirty(false);
  }

  async function save() {
    if (!enabled) return;
    setSaving(true);
    try {
      const r = await fetch('/admin/api/channel-gating', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ enabled }),
      });
      const j = await r.json();
      if (!r.ok || !j.ok) throw new Error(j.error || ('HTTP ' + r.status));
      const gating: Gating = j.gating;
      setServerState({ ...gating.enabled });
      setMeta({ updatedAt: gating.updatedAt, updatedBy: gating.updatedBy });
      setDirty(false);
      toast.success('Channel settings saved.', {
        description: `Bridge picks up the change within 10s (cache TTL).`,
      });
    } catch (e: any) {
      toast.error('Save failed', { description: String(e?.message || e) });
    } finally { setSaving(false); }
  }

  // Has the operator turned everything off? Worth warning about.
  const noneEnabled = enabled && !Object.values(enabled).some(Boolean);

  return (
    <Shell active="channels">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Channels</h1>
        <p className="mt-0.5 text-sm text-muted-foreground">
          Operator-managed channel allowlist. Anything unticked is refused at the dispatch layer
          with an audited skip; nothing reaches the provider.
        </p>
      </div>

      {/* Stage banner */}
      <div className="mb-6 flex items-start gap-3 rounded-lg border border-warning/30 bg-warning/10 p-4 text-sm">
        <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
        <div className="text-foreground/80">
          <span className="font-medium">Stage Dev policy:</span>{' '}
          SMS + WhatsApp on, Email + In-app off by default. Toggle any channel below to
          test other paths; changes persist in MongoDB and propagate to the Bridge worker
          within ~10 seconds.
        </div>
      </div>

      {loading || !enabled ? (
        <Card>
          <CardContent className="space-y-3 p-6">
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>Enabled channels</CardTitle>
            <CardDescription>
              Untick to immediately suppress all dispatches on that channel  workflows continue
              to run, but the channel step gets a clean <code className="font-mono text-[11px]">status:&nbsp;skipped</code>.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="divide-y rounded-lg border">
              {(Object.keys(CHANNEL_META) as Channel[]).map((ch) => {
                const meta = CHANNEL_META[ch];
                const Icon = meta.icon;
                const isOn = enabled[ch];
                return (
                  <div key={ch} className="flex items-start gap-4 p-4">
                    <Checkbox
                      id={`ch-${ch}`}
                      checked={isOn}
                      onCheckedChange={(v) => toggle(ch, v === true)}
                      className="mt-1"
                    />
                    <div className="flex-1">
                      <Label
                        htmlFor={`ch-${ch}`}
                        className="flex cursor-pointer items-center gap-2 text-sm font-semibold"
                      >
                        <span className="flex h-7 w-7 items-center justify-center rounded-md bg-primary/10 text-primary">
                          <Icon className="h-3.5 w-3.5" />
                        </span>
                        {meta.label}
                        {isOn ? (
                          <Badge variant="success" className="ml-1 text-[10px]">Enabled</Badge>
                        ) : (
                          <Badge variant="secondary" className="ml-1 text-[10px]">Disabled</Badge>
                        )}
                      </Label>
                      <div className="mt-0.5 text-xs text-muted-foreground">
                        <span className="font-mono">{meta.provider}</span>  {meta.blurb}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Save bar */}
            <div className="mt-6 flex flex-wrap items-center gap-3">
              <Button onClick={save} disabled={!dirty || saving}>
                {saving ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Save className="mr-1.5 h-4 w-4" />}
                Save changes
              </Button>
              <Button variant="outline" onClick={reset} disabled={!dirty || saving}>
                <RotateCcw className="mr-1.5 h-4 w-4" />
                Discard
              </Button>
              <div className="ml-auto text-xs text-muted-foreground">
                {meta && meta.updatedAt && new Date(meta.updatedAt).getTime() > 0 ? (
                  <>
                    Last saved {fmtDateTime(meta.updatedAt)}
                    {meta.updatedBy ? <> by <span className="font-mono">{meta.updatedBy}</span></> : null}
                  </>
                ) : (
                  <>Showing stage defaults  click Save to commit.</>
                )}
              </div>
            </div>

            {noneEnabled && (
              <div className="mt-4 flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-xs">
                <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
                <div className="text-destructive">
                  Every channel is currently unticked. After saving, no workflow will dispatch
                  anywhere  every step will be marked skipped.
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </Shell>
  );
}

function shallowEqual<T extends Record<string, any>>(a: T, b: T): boolean {
  for (const k of Object.keys(a)) if (a[k] !== b[k]) return false;
  for (const k of Object.keys(b)) if (a[k] !== b[k]) return false;
  return true;
}
