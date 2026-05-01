'use client';
// Server-rendered login card. The form posts to /admin/api/login (basePath
// does NOT auto-prefix form actions — keep the explicit /admin).
import React from 'react';
import { Bell, Lock } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';

export function LoginForm() {
  return (
    <div className="relative flex min-h-screen items-center justify-center bg-muted/40 p-4">
      <div className="absolute inset-0 bg-grid opacity-50" aria-hidden />
      <Card className="relative w-full max-w-sm shadow-lg">
        <CardHeader className="text-center">
          <div className="mx-auto mb-2 flex h-11 w-11 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <Bell className="h-5 w-5" />
          </div>
          <CardTitle>TPE Admin</CardTitle>
          <CardDescription>Sign in to the operator console</CardDescription>
        </CardHeader>
        <CardContent>
          <form action="/admin/api/login" method="post" className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="password">Shared password</Label>
              <div className="relative">
                <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  id="password"
                  name="password"
                  type="password"
                  autoFocus
                  required
                  autoComplete="current-password"
                  placeholder="Enter operator password"
                  className="pl-9"
                />
              </div>
            </div>
            <Button type="submit" className="w-full">Sign in</Button>
            <p className="text-center text-[11px] text-muted-foreground">
              Single-password MVP  v2 will replace with operator accounts and roles.
            </p>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
