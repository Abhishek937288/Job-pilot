import { z } from "zod";
import type { SalaryDto } from "@jobpilot/shared";
import { env } from "../config/env.js";
import { sha1 } from "../lib/hash.js";
import { getJson, HttpStatusError, type RequestOptions } from "../lib/http.js";
import { logger } from "../lib/logger.js";
import { cacheGet, cacheSet } from "../lib/redis.js";
import { buildJob } from "../jobs/build.js";
import type { JobSource, NormalizedJob, SearchContext } from "../jobs/types.js";
import type { SearchQuery } from "../llm/generateQueries.js";

/**
 * JSearch (Google for Jobs data, via RapidAPI or OpenWeb Ninja): GET {base}{JSEARCH_SEARCH_PATH}?query=...&page=1&num_pages=1
 * `/search-v2` returns `data: {jobs, cursor}`; the older `/search` returned `data: [...]`. Both are accepted.
 * One request per query (1 page), cached in Redis for JSEARCH_CACHE_HOURS by normalized query + location.
 * The cache is shared between users: it holds no user data.
 */
const nullish = <T extends z.ZodType>(t: T) => t.nullish();
const jsJob = z.looseObject({
  job_id: z.string(),
  job_title: z.string(),
  employer_name: nullish(z.string()),
  employer_website: nullish(z.string()),
  job_publisher: nullish(z.string()),
  job_employment_type: nullish(z.string()),
  job_apply_link: nullish(z.string()),
  job_apply_is_direct: nullish(z.boolean()),
  apply_options: nullish(z.array(z.object({ publisher: nullish(z.string()), apply_link: z.string(), is_direct: nullish(z.boolean()) }))),
  job_description: nullish(z.string()),
  job_is_remote: nullish(z.boolean()),
  job_posted_at_datetime_utc: nullish(z.string()),
  job_location: nullish(z.string()),
  job_city: nullish(z.string()),
  job_state: nullish(z.string()),
  job_country: nullish(z.string()),
  job_min_salary: nullish(z.number()),
  job_max_salary: nullish(z.number()),
  job_salary_currency: nullish(z.string()),
  job_salary_period: nullish(z.string()),
  job_required_experience: nullish(z.object({ required_experience_in_months: nullish(z.number()) })),
});
const jsResponse = z.object({
  status: z.string().nullish(),
  data: z.union([z.array(z.unknown()), z.object({ jobs: z.array(z.unknown()).default([]) }).loose()]).default([]),
});

export type JSearchJob = z.infer<typeof jsJob>;

const PERIOD: Record<string, SalaryDto["period"]> = { HOUR: "hour", DAY: "day", WEEK: "week", MONTH: "month", YEAR: "year" };

export function normalizeJSearchJob(j: JSearchJob): NormalizedJob {
  const options = j.apply_options ?? [];
  const links = [
    ...(j.job_apply_link ? [{ url: j.job_apply_link, source: j.job_publisher ?? "JSearch", isDirect: Boolean(j.job_apply_is_direct) }] : []),
    ...options.map((o) => ({ url: o.apply_link, source: o.publisher ?? "JSearch", isDirect: Boolean(o.is_direct) })),
  ];
  const hasSalary = j.job_min_salary != null || j.job_max_salary != null;
  return buildJob({
    source: "jsearch",
    sourceJobId: j.job_id,
    title: j.job_title,
    company: j.employer_name ?? "Unknown company",
    location: j.job_location ?? ([j.job_city, j.job_state, j.job_country].filter(Boolean).join(", ") || null),
    city: j.job_city ?? null,
    region: j.job_state ?? null,
    country: j.job_country ?? null,
    remote: j.job_is_remote ? "remote" : "unknown",
    salary: hasSalary
      ? { min: j.job_min_salary ?? null, max: j.job_max_salary ?? null, currency: j.job_salary_currency ?? null, period: PERIOD[(j.job_salary_period ?? "").toUpperCase()] ?? null }
      : null,
    applyLinks: links,
    postedAt: j.job_posted_at_datetime_utc ? new Date(j.job_posted_at_datetime_utc) : null,
    description: j.job_description ?? null,
    employmentType: j.job_employment_type ?? null,
    requiredExperienceMonths: j.job_required_experience?.required_experience_in_months ?? null,
  });
}

function queryText(q: SearchQuery): string {
  return q.location ? `${q.query} in ${q.location}` : q.query;
}

export function jsearchCacheKey(q: SearchQuery, country: string): string {
  const norm = `${queryText(q).toLowerCase().replace(/\s+/g, " ").trim()}|${country}|${q.remoteOnly}|${env.JSEARCH_DATE_POSTED}`;
  return `jsearch:v2:${sha1(norm)}`;
}

export class JSearchSource implements JobSource {
  readonly name = "jsearch" as const;
  constructor(private readonly opts: RequestOptions = {}) {}

  async fetch(ctx: SearchContext): Promise<NormalizedJob[]> {
    if (!env.JSEARCH_API_KEY) throw new Error("JSEARCH_API_KEY is not set");
    const perQuery = await Promise.all(ctx.queries.map((q) => this.fetchQuery(q, ctx)));
    return perQuery.flat();
  }

  private async fetchQuery(q: SearchQuery, ctx: SearchContext): Promise<NormalizedJob[]> {
    const key = jsearchCacheKey(q, ctx.preferences.country);
    let raw = await cacheGet<unknown[]>(key);
    if (!raw) {
      const params = new URLSearchParams({
        query: queryText(q),
        page: "1",
        num_pages: "1",
        country: ctx.preferences.country,
        date_posted: env.JSEARCH_DATE_POSTED,
      });
      if (q.remoteOnly) params.set("work_from_home", "true");
      const headers: Record<string, string> = env.JSEARCH_HOST
        ? { "x-rapidapi-key": env.JSEARCH_API_KEY!, "x-rapidapi-host": env.JSEARCH_HOST }
        : { "x-api-key": env.JSEARCH_API_KEY! };
      ctx.meter.jsearchRequests += 1;
      try {
        const body = jsResponse.parse(await getJson(`${env.JSEARCH_BASE_URL}${env.JSEARCH_SEARCH_PATH}?${params}`, { ...this.opts, headers, retries: 1, timeoutMs: 30_000 }));
        raw = Array.isArray(body.data) ? body.data : body.data.jobs;
      } catch (err) {
        if (err instanceof HttpStatusError && (err.status === 401 || err.status === 403)) throw new Error("JSearch rejected the API key (is the RapidAPI subscription active?)");
        if (err instanceof HttpStatusError && err.status === 404) throw new Error(`JSearch endpoint ${env.JSEARCH_SEARCH_PATH} not found (check JSEARCH_SEARCH_PATH)`);
        throw err;
      }
      await cacheSet(key, raw, env.JSEARCH_CACHE_HOURS * 3600);
    }
    const jobs: NormalizedJob[] = [];
    for (const item of raw) {
      const parsed = jsJob.safeParse(item);
      if (parsed.success) jobs.push(normalizeJSearchJob(parsed.data));
      else logger.debug({ issues: parsed.error.issues.slice(0, 3) }, "skipped malformed JSearch job");
    }
    return jobs;
  }
}
