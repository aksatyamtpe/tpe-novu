import './globals.css';
import type { Metadata } from 'next';
import React from 'react';
import { Toaster } from '@/components/ui/sonner';

export const metadata: Metadata = {
  title: 'TPE Admin',
  description: 'TPE Communication System operator console',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="h-full">
      <body className="h-full antialiased">
        {children}
        {/* Single global toaster — `import { toast } from 'sonner'` and call from any client component. */}
        <Toaster position="top-right" />
      </body>
    </html>
  );
}
