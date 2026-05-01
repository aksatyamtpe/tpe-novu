// shadcn convention: a `cn()` helper that merges Tailwind class lists, removes
// conflicts (e.g. `p-2` overrides `p-4`), and accepts truthy/falsy fragments
// for conditional classes. Every shadcn component imports this.
import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Format a JS Date or ISO string in the operator's locale, short form. */
export function fmtDateTime(input: string | Date | undefined): string {
  if (!input) return '';
  const d = typeof input === 'string' ? new Date(input) : input;
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString(undefined, {
    year: 'numeric', month: 'short', day: '2-digit',
    hour: '2-digit', minute: '2-digit',
  });
}

/** Pluck a relative time hint ("3m ago", "in 2h"). Cheap, no library. */
export function fmtRelative(input: string | Date | undefined): string {
  if (!input) return '';
  const d = typeof input === 'string' ? new Date(input) : input;
  const diffMs = d.getTime() - Date.now();
  const abs = Math.abs(diffMs);
  const min = 60 * 1000, hr = 60 * min, day = 24 * hr;
  const pick = abs < min ? [Math.round(abs / 1000), 's']
             : abs < hr  ? [Math.round(abs / min), 'm']
             : abs < day ? [Math.round(abs / hr), 'h']
             :             [Math.round(abs / day), 'd'];
  return diffMs < 0 ? `${pick[0]}${pick[1]} ago` : `in ${pick[0]}${pick[1]}`;
}
