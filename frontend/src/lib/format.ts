import type { DataMode } from '../api/types';

export const UNAVAILABLE = 'Unavailable';

export const MODE_LABEL: Record<DataMode, string> = {
  historical_file: 'Uploaded historical',
  synthetic: 'Synthetic demo',
  unknown: 'Unknown',
};

const numberFormat = (maximumFractionDigits: number) => new Intl.NumberFormat('en-IN', {
  maximumFractionDigits,
});

function finite(value: number | null | undefined): value is number {
  return value != null && Number.isFinite(value);
}

export function fmtNum(value: number | null | undefined, maximumFractionDigits = 2): string {
  return finite(value) ? numberFormat(maximumFractionDigits).format(value) : UNAVAILABLE;
}

export function fmtInt(value: number | null | undefined): string {
  return finite(value) ? new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 }).format(value) : UNAVAILABLE;
}

export function fmtSigned(value: number | null | undefined, maximumFractionDigits = 2): string {
  if (!finite(value)) return UNAVAILABLE;
  const formatted = numberFormat(maximumFractionDigits).format(Math.abs(value));
  return value > 0 ? `+${formatted}` : value < 0 ? `-${formatted}` : formatted;
}

export function fmtPct(value: number | null | undefined): string {
  return finite(value) ? `${fmtNum(value)}%` : UNAVAILABLE;
}

export function fmtRatioPct(value: number | null | undefined): string {
  return finite(value) ? `${fmtNum(value * 100)}%` : UNAVAILABLE;
}

export function fmtInr(value: number | null | undefined): string {
  return finite(value)
    ? `₹${new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2 }).format(value)}`
    : UNAVAILABLE;
}

function parseDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function fmtDate(value: string | null | undefined): string {
  const date = parseDate(value);
  return date
    ? new Intl.DateTimeFormat('en-IN', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(date)
    : UNAVAILABLE;
}

export function fmtDateTime(value: string | null | undefined): string {
  const date = parseDate(value);
  return date
    ? new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' }).format(date)
    : UNAVAILABLE;
}
