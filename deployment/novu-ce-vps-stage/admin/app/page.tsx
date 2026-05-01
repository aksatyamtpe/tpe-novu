// /admin — login + dashboard. Server-rendered: if no session, render the
// login form; if session present, fan out to Mongo + Novu API for live
// metric values and render the dashboard.
import Link from 'next/link';
import { isAuthed } from '@/lib/auth';
import { Shell } from '@/components/Shell';
import { LoginForm } from '@/components/LoginForm';
import { getDashboardStats } from '@/lib/dashboard-stats';
import { getChannelGating, type GateableChannel } from '@/lib/channel-gating';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import {
  FileText,
  CalendarClock,
  History,
  Activity,
  Mail,
  MessageSquare,
  Smartphone,
  Inbox,
  ArrowRight,
  AlertTriangle,
} from 'lucide-react';

export const dynamic = 'force-dynamic';

export default async function AdminHome() {
  if (!isAuthed()) return <LoginForm />;

  // Fan out for the dashboard reads in parallel; allSettled-ish via try/catch
  // inside getDashboardStats. getChannelGating throws on Mongo failure — wrap it
  // so a Mongo blip doesn't 500 the whole dashboard.
  const stats = await getDashboardStats();
  let gating: Awaited<ReturnType<typeof getChannelGating>> | null = null;
  try {
    gating = await getChannelGating();
  } catch {
    /* keep gating null; ChannelRow falls back to "unknown" */
  }
  const isOn = (ch: GateableChannel) => gating?.enabled?.[ch] ?? false;

  return (
    <Shell active="dashboard">
      {/* Hero header */}
      <div className="relative mb-8 overflow-hidden rounded-xl border bg-gradient-to-br from-primary to-primary/80 p-8 text-primary-foreground">
        <div className="absolute inset-0 bg-grid opacity-10" aria-hidden />
        <div className="relative">
          <Badge variant="secondary" className="mb-3 bg-white/15 text-white hover:bg-white/20">Phase 1  Stage</Badge>
          <h1 className="text-2xl font-semibold tracking-tight">Operator Dashboard</h1>
          <p className="mt-1 max-w-2xl text-sm text-primary-foreground/80">
            Manage templates, schedule one-time triggers, and audit recent dispatch activity across the
            TPE Communication System.
          </p>
          <div className="mt-5 flex flex-wrap gap-2">
            <Button asChild variant="secondary" size="sm" className="bg-white text-primary hover:bg-white/90">
              <Link href="/schedules">
                <CalendarClock className="mr-1.5 h-4 w-4" />
                Schedule a trigger
              </Link>
            </Button>
            <Button asChild variant="outline" size="sm" className="border-white/30 bg-transparent text-white hover:bg-white/10 hover:text-white">
              <Link href="/templates">
                <FileText className="mr-1.5 h-4 w-4" />
                New template
              </Link>
            </Button>
          </div>
        </div>
      </div>

      {/* Stale-data banner — only renders if one of the four metric reads failed. */}
      {stats.errors.length > 0 && (
        <div className="mb-4 flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/10 p-3 text-sm">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
          <div className="text-foreground/80">
            <span className="font-medium">Some metrics could not be refreshed</span>
            <span className="text-muted-foreground">  failed: {stats.errors.join(', ')}. Showing 0 for those cards.</span>
          </div>
        </div>
      )}

      {/* Metric grid */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <MetricCard
          icon={<Activity className="h-4 w-4" />}
          label="Workflows deployed"
          value={String(stats.workflows)}
          hint="Bridge code-first"
        />
        <MetricCard
          icon={<CalendarClock className="h-4 w-4" />}
          label="Scheduled (pending)"
          value={String(stats.pending)}
          hint="See /schedules"
          tone={stats.pending === 0 ? 'muted' : undefined}
        />
        <MetricCard
          icon={<History className="h-4 w-4" />}
          label="Last 24h triggers"
          value={String(stats.triggers24h)}
          hint="Recent activity"
          tone={stats.triggers24h === 0 ? 'muted' : undefined}
        />
        <MetricCard
          icon={<FileText className="h-4 w-4" />}
          label="Templates managed"
          value={String(stats.templates)}
          hint="Email + in-app"
          tone={stats.templates === 0 ? 'muted' : undefined}
        />
      </div>

      {/* Two-column section */}
      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        {/* Quick actions */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Quick actions</CardTitle>
            <CardDescription>Common operator workflows.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-2">
            <ActionTile
              href="/templates"
              icon={<FileText className="h-5 w-5 text-primary" />}
              title="Manage templates"
              blurb="Create, edit, and version operator-controlled email + in-app HTML."
            />
            <ActionTile
              href="/schedules"
              icon={<CalendarClock className="h-5 w-5 text-primary" />}
              title="Schedule a trigger"
              blurb="Queue a one-time send for any subscriber at a chosen IST timestamp."
            />
            <ActionTile
              href="/history"
              icon={<History className="h-5 w-5 text-primary" />}
              title="Review recent activity"
              blurb="Read-only view of the last triggers, with channel breakdown."
            />
            <ActionTile
              href="http://103.138.96.180/"
              external
              icon={<ArrowRight className="h-5 w-5 text-primary" />}
              title="Open Novu Studio"
              blurb="For Bridge workflow inspection, subscribers, and provider settings."
            />
          </CardContent>
        </Card>

        {/* Channel matrix */}
        <Card>
          <CardHeader>
            <CardTitle>Channels</CardTitle>
            <CardDescription>Live provider status on stage.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <ChannelRow icon={<Smartphone className="h-4 w-4" />} name="SMS"      provider="MSG91 v5 Flow"   on={isOn('sms')} />
            <Separator />
            <ChannelRow icon={<MessageSquare className="h-4 w-4" />} name="WhatsApp" provider="ICPaaS Cloud"   on={isOn('whatsapp')} />
            <Separator />
            <ChannelRow icon={<Mail className="h-4 w-4" />} name="Email"     provider="SES"           on={isOn('email')} />
            <Separator />
            <ChannelRow icon={<Inbox className="h-4 w-4" />} name="In-app"    provider="Novu native"   on={isOn('in_app')} />
            <div className="pt-2 text-[11px] text-muted-foreground">
              Toggle channels on the <Link href="/channels" className="underline underline-offset-2 hover:text-foreground">Channels</Link> page.
            </div>
          </CardContent>
        </Card>
      </div>

      <p className="mt-6 text-xs text-muted-foreground">
        SMS and WhatsApp templates are registered externally (MSG91 DLT, Meta WABA) and cannot be edited from this
        console  see the Bridge <code className="font-mono text-[11px]">.env</code> for current template IDs.
      </p>
    </Shell>
  );
}

function MetricCard({
  icon, label, value, hint, tone,
}: { icon: React.ReactNode; label: string; value: string; hint?: string; tone?: 'muted' }) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardDescription className="text-xs uppercase tracking-wide">{label}</CardDescription>
        <div className="text-muted-foreground">{icon}</div>
      </CardHeader>
      <CardContent>
        <div className={tone === 'muted' ? 'text-2xl font-semibold text-muted-foreground/60' : 'text-2xl font-semibold'}>{value}</div>
        {hint ? <p className="mt-1 text-xs text-muted-foreground">{hint}</p> : null}
      </CardContent>
    </Card>
  );
}

function ActionTile({
  href, icon, title, blurb, external,
}: { href: string; icon: React.ReactNode; title: string; blurb: string; external?: boolean }) {
  const Inner = (
    <div className="flex h-full items-start gap-3 rounded-lg border bg-card p-4 transition-colors hover:border-primary/50 hover:bg-accent/5">
      <div className="rounded-md bg-primary/10 p-2">{icon}</div>
      <div className="flex-1">
        <div className="text-sm font-semibold">{title}</div>
        <div className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{blurb}</div>
      </div>
      <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground" />
    </div>
  );
  return external ? (
    <a href={href} target="_blank" rel="noreferrer">{Inner}</a>
  ) : (
    <Link href={href}>{Inner}</Link>
  );
}

function ChannelRow({
  icon, name, provider, on,
}: { icon: React.ReactNode; name: string; provider: string; on: boolean }) {
  return (
    <div className="flex items-center justify-between text-sm">
      <div className="flex items-center gap-2.5">
        <span className="flex h-7 w-7 items-center justify-center rounded-md bg-muted text-muted-foreground">{icon}</span>
        <div>
          <div className="font-medium">{name}</div>
          <div className="text-xs text-muted-foreground">{provider}</div>
        </div>
      </div>
      {on
        ? <Badge variant="success">Enabled</Badge>
        : <Badge variant="secondary">Disabled</Badge>}
    </div>
  );
}
