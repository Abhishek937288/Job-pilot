import type { JobSourceName } from "@jobpilot/shared";
import { env } from "../config/env.js";
import { CachedJob, type CachedJobDoc } from "../db/models/cachedJob.js";
import { normalizeText } from "../lib/text.js";
import { buildJob } from "../jobs/build.js";
import type { JobSource, NormalizedJob, SearchContext } from "../jobs/types.js";

const GENERIC = new Set([
  "senior", "sr", "junior", "jr", "lead", "staff", "principal", "intern", "and", "or", "the", "of", "for", "in", "with", "a", "an",
  "remote", "hybrid", "i", "ii", "iii",
]);

const tokens = (s: string) => normalizeText(s).split(" ").filter((t) => t.length > 1 && !GENERIC.has(t));

/** Share of the query's meaningful words that appear in the title (0..1). */
export function titleRelevance(title: string, query: string): number {
  const q = tokens(query);
  if (q.length === 0) return 0;
  const t = new Set(tokens(title));
  return q.filter((w) => t.has(w)).length / q.length;
}

const MIN_RELEVANCE = 0.6;
const MAX_RESULTS = 150;

export function cachedJobToNormalized(c: CachedJobDoc): NormalizedJob {
  return buildJob({
    source: c.source as JobSourceName,
    sourceJobId: c.sourceJobId,
    title: c.title,
    company: c.company,
    location: c.location,
    city: c.city,
    region: c.region,
    country: c.country,
    remote: c.remote as NormalizedJob["remote"],
    salary: c.salary ? { min: c.salary.min ?? null, max: c.salary.max ?? null, currency: c.salary.currency ?? null, period: (c.salary.period ?? null) as never } : null,
    applyLinks: [{ url: c.applyUrl, source: c.source === "jsonld" ? "careers page" : c.source, isDirect: true }],
    postedAt: c.postedAt,
    description: c.description,
    employmentType: c.employmentType,
    requiredExperienceMonths: c.requiredExperienceMonths,
  });
}

/**
 * Watchlist jobs (ATS boards and JSON-LD career pages) from the local cache filled by the background
 * refresh. No external calls at search time.
 */
export class WatchlistSource implements JobSource {
  readonly name = "watchlist" as const;

  async fetch(ctx: SearchContext): Promise<NormalizedJob[]> {
    const phrases = [ctx.desiredRole, ...ctx.queries.map((q) => q.query)];
    const words = [...new Set(phrases.flatMap(tokens))];
    if (words.length === 0) return [];
    const cutoff = new Date(Date.now() - env.JOB_MAX_AGE_DAYS * 86_400_000);
    const candidates = await CachedJob.find(
      { $text: { $search: words.join(" ") }, closedAt: null, $or: [{ postedAt: null }, { postedAt: { $gte: cutoff } }] },
      { score: { $meta: "textScore" } },
    )
      .sort({ score: { $meta: "textScore" } })
      .limit(2000);

    return candidates
      .map((c) => ({ c, rel: Math.max(...phrases.map((p) => titleRelevance(c.title, p))) }))
      .filter((x) => x.rel >= MIN_RELEVANCE)
      .sort((a, b) => b.rel - a.rel || (b.c.postedAt?.getTime() ?? 0) - (a.c.postedAt?.getTime() ?? 0))
      .slice(0, MAX_RESULTS)
      .map((x) => cachedJobToNormalized(x.c));
  }
}
