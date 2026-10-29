import type { SalaryDto } from "@jobpilot/shared";

const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ["year", 365 * 24 * 3600],
  ["month", 30 * 24 * 3600],
  ["week", 7 * 24 * 3600],
  ["day", 24 * 3600],
  ["hour", 3600],
  ["minute", 60],
];

export function relativeTime(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return "never";
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "unknown";
  const diff = (t - now) / 1000;
  for (const [unit, secs] of UNITS) {
    if (Math.abs(diff) >= secs) return rtf.format(Math.round(diff / secs), unit);
  }
  return "just now";
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

function money(n: number, currency: string | null): string {
  if (currency && /^[A-Z]{3}$/i.test(currency)) {
    try {
      return new Intl.NumberFormat(undefined, {
        style: "currency",
        currency: currency.toUpperCase(),
        notation: n >= 100_000 ? "compact" : "standard",
        maximumFractionDigits: n >= 100_000 ? 1 : 0,
      }).format(n);
    } catch {
      // unknown currency code
    }
  }
  return new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 }).format(n);
}

const PERIOD: Record<NonNullable<SalaryDto["period"]>, string> = {
  hour: "/hr",
  day: "/day",
  week: "/wk",
  month: "/mo",
  year: "/yr",
};

export function formatSalary(s: SalaryDto | null): string | null {
  if (!s || (s.min === null && s.max === null)) return null;
  const suffix = s.period ? PERIOD[s.period] : "";
  if (s.min !== null && s.max !== null && s.min !== s.max) {
    return `${money(s.min, s.currency)} – ${money(s.max, s.currency)}${suffix}`;
  }
  const v = (s.min ?? s.max) as number;
  return `${s.min === null ? "up to " : ""}${money(v, s.currency)}${suffix}`;
}

export function formatMs(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) return "—";
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)} s`;
}

export function formatUsd(n: number | null | undefined): string {
  if (n === null || n === undefined) return "—";
  return `$${n < 0.01 && n > 0 ? n.toFixed(4) : n.toFixed(2)}`;
}

export function formatYears(y: number): string {
  const r = Math.round(y * 10) / 10;
  return `${r} ${r === 1 ? "year" : "years"}`;
}

/** Turns zod-style issues into `{ field: message }` (first message per top-level field). */
export function issuesToFieldErrors(
  issues: { path: PropertyKey[] | string; message: string }[] | undefined,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of issues ?? []) {
    const parts = Array.isArray(issue.path) ? issue.path.map(String) : String(issue.path).split(".");
    // Server issues for nested preferences arrive as "preferences.desiredRole".
    const key = parts[0] === "preferences" && parts[1] ? parts[1] : (parts[0] ?? "");
    if (!(key in out)) out[key] = issue.message;
  }
  return out;
}
