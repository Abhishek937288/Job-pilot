import type { ProfileData, SearchQuery } from "@jobpilot/shared";
import { toSerperLocation } from "./location.js";

export const ATS_SITE_GROUP = "(site:job-boards.greenhouse.io OR site:boards.greenhouse.io OR site:jobs.lever.co OR site:jobs.ashbyhq.com)";
export const EXCLUDED_SITES = "-site:linkedin.com -site:naukri.com -site:indeed.com -site:indeed.co.in";

export interface LocationOption {
  /** As I typed it in my profile. */
  preferred: string;
  /** Google/Serper location name sent as `location`, null for remote/none. */
  serper: string | null;
}

export function locationOptions(profile: ProfileData): LocationOption[] {
  return profile.preferredLocations.map((p) => ({ preferred: p, serper: toSerperLocation(p) }));
}

export function queryKey(q: SearchQuery): string {
  return `${q.q.toLowerCase().replace(/\s+/g, " ").trim()}|${(q.location ?? "").toLowerCase().trim()}`;
}

/** Case/whitespace-insensitive dedupe on (query text, location), keeping first occurrence. */
export function dedupeQueries(queries: SearchQuery[]): { queries: SearchQuery[]; removed: number } {
  const seen = new Set<string>();
  const out: SearchQuery[] = [];
  for (const q of queries) {
    const cleaned = { q: q.q.replace(/\s+/g, " ").trim(), location: q.location?.trim() || null };
    const key = queryKey(cleaned);
    if (!cleaned.q || seen.has(key)) continue;
    seen.add(key);
    out.push(cleaned);
  }
  return { queries: out, removed: queries.length - out.length };
}

/**
 * LLM-proposed locations must be one of the allowed Serper names (or null). Anything else is
 * mapped through toSerperLocation so a typo can't burn a credit on a 400.
 */
export function sanitizeLocation(loc: string | null, options: LocationOption[]): string | null {
  if (!loc) return null;
  const allowed = options.map((o) => o.serper).filter((s): s is string => !!s);
  const exact = allowed.find((a) => a.toLowerCase() === loc.toLowerCase().trim());
  return exact ?? toSerperLocation(loc);
}

/**
 * The LLM sometimes garbles the site group (seen live: "site:boards.greenhouse.co"). Any query that
 * targets ATS boards gets its site: terms replaced by the exact canonical group.
 */
export function normalizeSiteGroup(q: string): string {
  if (!/greenhouse|lever\.co|ashbyhq/i.test(q)) return q.replace(/\s+/g, " ").trim();
  const stripped = q
    .replace(/\((?:\s*(?:OR\s+)?site:\S+?\s*)+\)/gi, " ")
    .replace(/(?:^|\s)(?:OR\s+)?site:\S+/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  return `${stripped} ${ATS_SITE_GROUP}`;
}

/** Deterministic queries used when the LLM call fails: titles x locations on ATS boards, then careers pages. */
export function fallbackQueries(profile: ProfileData, max: number): SearchQuery[] {
  const opts = locationOptions(profile);
  const locs: LocationOption[] = opts.length ? opts : [{ preferred: "", serper: null }];
  const wantsRemote = profile.remotePreference === "REMOTE" || profile.remotePreference === "ANY";
  const out: SearchQuery[] = [];
  for (const title of profile.targetTitles) {
    for (const l of locs) {
      const city = l.serper ? ` ${l.preferred}` : "";
      out.push({ q: `"${title}"${city} ${ATS_SITE_GROUP}`, location: l.serper });
    }
    if (wantsRemote) out.push({ q: `"${title}" remote India ${ATS_SITE_GROUP}`, location: null });
  }
  for (const title of profile.targetTitles) {
    for (const l of locs) {
      out.push({ q: `"${title}" ${l.preferred} careers apply ${EXCLUDED_SITES}`.replace(/\s+/g, " "), location: l.serper });
    }
  }
  return dedupeQueries(out).queries.slice(0, max);
}
