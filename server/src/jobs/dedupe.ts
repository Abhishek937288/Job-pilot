import type { ApplyLink, JobSourceName } from "@jobpilot/shared";
import type { NormalizedJob } from "./types.js";

/** Lower is preferred for the main record: company boards first, aggregators next, web search last. */
const SOURCE_RANK: Record<JobSourceName, number> = {
  greenhouse: 0,
  lever: 0,
  ashby: 0,
  workable: 0,
  smartrecruiters: 0,
  jsonld: 1,
  jsearch: 2,
  web_search: 3,
};

export function canonicalUrl(url: string): string {
  try {
    const u = new URL(url);
    u.hash = "";
    for (const k of [...u.searchParams.keys()]) if (/^(utm_|gh_src|ref$|source$|src$)/i.test(k)) u.searchParams.delete(k);
    u.hostname = u.hostname.toLowerCase();
    if (u.pathname.length > 1) u.pathname = u.pathname.replace(/\/+$/, "");
    return u.toString().replace(/\/$/, "");
  } catch {
    return url;
  }
}

/** Direct (company) links first, then by source preference; duplicates by canonical URL removed. */
export function mergeApplyLinks(links: ApplyLink[]): ApplyLink[] {
  const seen = new Set<string>();
  const out: ApplyLink[] = [];
  for (const l of links) {
    const key = canonicalUrl(l.url);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(l);
  }
  return out.sort((a, b) => Number(b.isDirect) - Number(a.isDirect));
}

function merge(a: NormalizedJob, b: NormalizedJob): NormalizedJob {
  const [main, other] = SOURCE_RANK[b.source] < SOURCE_RANK[a.source] ? [b, a] : [a, b];
  return {
    ...main,
    location: main.location ?? other.location,
    city: main.city ?? other.city,
    region: main.region ?? other.region,
    country: main.country ?? other.country,
    remote: main.remote !== "unknown" ? main.remote : other.remote,
    salary: main.salary ?? other.salary,
    postedAt: main.postedAt ?? other.postedAt,
    description: (main.description?.length ?? 0) >= (other.description?.length ?? 0) ? main.description : other.description,
    employmentType: main.employmentType ?? other.employmentType,
    requiredExperienceMonths: main.requiredExperienceMonths ?? other.requiredExperienceMonths,
    applyLinks: mergeApplyLinks([...main.applyLinks, ...other.applyLinks]),
    sources: [...new Set([...main.sources, ...other.sources])],
  };
}

/**
 * Merges duplicates inside one search: same jobKey, or same fingerprint (title|company|city) from
 * different sources. All apply links are kept.
 */
export function dedupeJobs(jobs: NormalizedJob[]): NormalizedJob[] {
  const byKey = new Map<string, NormalizedJob>();
  const keyByFingerprint = new Map<string, string>();
  for (const job of jobs) {
    const key = byKey.has(job.jobKey) ? job.jobKey : keyByFingerprint.get(job.fingerprint);
    if (key) {
      const merged = merge(byKey.get(key)!, job);
      byKey.delete(key);
      byKey.set(merged.jobKey, merged);
      keyByFingerprint.set(merged.fingerprint, merged.jobKey);
    } else {
      byKey.set(job.jobKey, { ...job, applyLinks: mergeApplyLinks(job.applyLinks) });
      keyByFingerprint.set(job.fingerprint, job.jobKey);
    }
  }
  return [...byKey.values()];
}
