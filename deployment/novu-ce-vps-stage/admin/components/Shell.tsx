'use client';
// Common app chrome — collapsible sidebar with icons, top bar with operator
// dropdown. Used by every authenticated /admin page.
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import React from 'react';
import {
  LayoutDashboard,
  FileText,
  CalendarClock,
  History,
  ToggleLeft,
  Megaphone,
  Bell,
  LogOut,
  ChevronDown,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Badge } from '@/components/ui/badge';

type NavItem = {
  href: string;       // basePath-relative — Next auto-prefixes /admin
  label: string;
  key: string;
  icon: React.ElementType;
  description: string;
};

const NAV: NavItem[] = [
  { href: '/',          label: 'Dashboard', key: 'dashboard', icon: LayoutDashboard, description: 'Overview' },
  { href: '/templates', label: 'Templates', key: 'templates', icon: FileText,        description: 'Email + in-app' },
  { href: '/campaigns', label: 'Campaigns', key: 'campaigns', icon: Megaphone,       description: 'Data-driven sends' },
  { href: '/schedules', label: 'Schedules', key: 'schedules', icon: CalendarClock,   description: 'One-time triggers' },
  { href: '/history',   label: 'History',   key: 'history',   icon: History,         description: 'Recent activity' },
  { href: '/channels',  label: 'Channels',  key: 'channels',  icon: ToggleLeft,      description: 'Per-channel allowlist' },
];

export function Shell({ children, active }: { children: React.ReactNode; active?: string }) {
  const pathname = usePathname();
  // Fall back to pathname-based detection if `active` prop isn't passed.
  const activeKey =
    active ??
    NAV.find((n) => {
      // pathname includes basePath — strip /admin to compare against href
      const stripped = pathname.replace(/^\/admin/, '') || '/';
      return n.href === stripped || (n.href !== '/' && stripped.startsWith(n.href));
    })?.key ??
    'dashboard';

  return (
    <div className="flex h-full min-h-screen bg-background">
      {/* Sidebar */}
      <aside className="hidden w-64 shrink-0 flex-col border-r bg-card md:flex">
        {/* Brand */}
        <div className="flex h-14 items-center gap-2 border-b px-5">
          <div className="flex h-8 w-8 items-center justify-center rounded-md bg-primary text-primary-foreground">
            <Bell className="h-4 w-4" />
          </div>
          <div className="leading-tight">
            <div className="text-sm font-semibold tracking-tight">TPE Admin</div>
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Communication System</div>
          </div>
        </div>

        {/* Nav */}
        <nav className="flex-1 space-y-1 p-3">
          <div className="px-2 pb-1 pt-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Operator
          </div>
          {NAV.map((item) => {
            const Icon = item.icon;
            const isActive = activeKey === item.key;
            return (
              <Link
                key={item.key}
                href={item.href}
                className={cn(
                  'group flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors',
                  isActive
                    ? 'bg-primary text-primary-foreground shadow-sm'
                    : 'text-foreground/80 hover:bg-accent/10 hover:text-foreground',
                )}
              >
                <Icon className={cn('h-4 w-4 shrink-0', isActive ? 'text-primary-foreground' : 'text-muted-foreground group-hover:text-foreground')} />
                <span className="flex-1">{item.label}</span>
              </Link>
            );
          })}
        </nav>

        {/* Sidebar footer — environment badge */}
        <div className="border-t p-3">
          <div className="flex items-center justify-between rounded-md border bg-muted/40 px-3 py-2">
            <div className="text-xs">
              <div className="font-medium">Stage</div>
              <div className="text-muted-foreground">Novu CE 2.3.0</div>
            </div>
            <Badge variant="warning" className="text-[10px]">DEV</Badge>
          </div>
        </div>
      </aside>

      {/* Main column */}
      <div className="flex flex-1 flex-col">
        {/* Top bar */}
        <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b bg-card/80 px-4 backdrop-blur md:px-6">
          <div className="flex flex-1 items-center gap-2">
            <h1 className="text-sm font-medium text-muted-foreground">
              {NAV.find((n) => n.key === activeKey)?.label ?? 'TPE Admin'}
            </h1>
          </div>
          <div className="flex items-center gap-2">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" className="gap-2">
                  <div className="flex h-6 w-6 items-center justify-center rounded-full bg-primary text-primary-foreground text-[11px] font-semibold">
                    OP
                  </div>
                  <span className="hidden sm:inline">Operator</span>
                  <ChevronDown className="h-3.5 w-3.5 opacity-60" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuLabel>
                  <div className="font-medium">Shared operator</div>
                  <div className="text-xs font-normal text-muted-foreground">single-password MVP</div>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <form action="/admin/api/logout" method="post">
                  <DropdownMenuItem asChild className="text-destructive focus:text-destructive">
                    <button type="submit" className="w-full cursor-pointer">
                      <LogOut className="mr-2 h-4 w-4" />
                      Sign out
                    </button>
                  </DropdownMenuItem>
                </form>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </header>

        {/* Page content */}
        <main className="flex-1 overflow-y-auto px-4 py-6 md:px-8 md:py-8">
          <div className="mx-auto max-w-7xl">{children}</div>
        </main>

        {/* Footer */}
        <footer className="border-t bg-card/40 px-6 py-3 text-center text-xs text-muted-foreground">
          TPE Communication System  TechDigital WishTree  for The Policy Exchange
        </footer>
      </div>
    </div>
  );
}
