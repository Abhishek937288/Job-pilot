import type { RemoteType, SalaryDto } from "@jobpilot/shared";
import { normalizeText } from "../lib/text.js";

const REMOTE_RE = /\b(remote|work from home|wfh|anywhere|distributed)\b/i;
const HYBRID_RE = /\bhybrid\b/i;

export function remoteFromText(...texts: (string | null | undefined)[]): RemoteType {
  const t = texts.filter(Boolean).join(" ");
  if (HYBRID_RE.test(t)) return "hybrid";
  if (REMOTE_RE.test(t)) return "remote";
  return "unknown";
}

/** City spellings that should match each other. */
const CITY_ALIASES: string[][] = [
  ["bengaluru", "bangalore"],
  ["gurugram", "gurgaon"],
  ["mumbai", "bombay"],
  ["chennai", "madras"],
  ["kolkata", "calcutta"],
  ["delhi", "new delhi", "ncr", "delhi ncr"],
  ["noida", "ncr", "delhi ncr"],
  ["pune", "poona"],
  ["new york", "nyc", "new york city"],
  ["san francisco", "sf", "bay area"],
  ["united states", "usa", "us"],
  ["united kingdom", "uk", "england"],
  ["india", "in"],
];

function variants(pref: string): string[] {
  const p = normalizeText(pref);
  const group = CITY_ALIASES.find((g) => g.includes(p));
  return group ? [...new Set([p, ...group])] : [p];
}

/** True when any preferred location appears in the job's location fields (whole-word match). */
export function locationMatches(preferred: string[], jobLocations: (string | null)[]): boolean {
  const hay = ` ${jobLocations.filter(Boolean).map((l) => normalizeText(l)).join(" | ")} `;
  if (!hay.trim()) return false;
  return preferred.some((pref) => variants(pref).some((v) => v.length >= 2 && hay.includes(` ${v} `)));
}

const PERIOD_FACTOR: Record<string, number> = { hour: 2080, day: 260, week: 52, month: 12, year: 1 };

/** Annual max (or min when there is no max) in the job's currency, or null when unknown. */
export function annualSalaryCeiling(s: SalaryDto | null): number | null {
  if (!s) return null;
  const v = s.max ?? s.min;
  if (v == null || !s.period) return null;
  return v * (PERIOD_FACTOR[s.period] ?? 1);
}
