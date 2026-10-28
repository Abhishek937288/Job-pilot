import type { ApplyMethod, JobSource, RemoteType } from "@jobpilot/shared";
import type { AtsJob } from "./ats/types.js";
import { isRemoteText } from "./location.js";
import type { SearchHit } from "./provider.js";
import { canonicalizeUrl, parseAtsJobUrl, type AtsJobRef } from "./url-canonical.js";

/** A job ready to be stored (before fingerprinting / location matching). */
export interface JobCandidate {
  canonicalUrl: string;
  company: string;
  title: string;
  location: string | null;
  allLocations: string[];
  remoteType: RemoteType;
  applyMethod: ApplyMethod;
  applyUrl: string | null;
  snippet: string | null;
  jdText: string | null;
  source: JobSource;
  sourceQuery: string | null;
  atsRef: AtsJobRef | null;
  postedAt: Date | null;
  raw: Record<string, unknown>;
}

export function applyMethodForUrl(url: string): ApplyMethod {
  const ats = parseAtsJobUrl(url);
  if (ats) return ats.provider;
  try {
    const host = new URL(url).hostname.toLowerCase();
    if (host.endsWith("myworkdayjobs.com") || host.endsWith("myworkdaysite.com")) return "WORKDAY";
  } catch {
    // fall through
  }
  return "UNKNOWN"; // decided by page analysis in Phase 3
}

function titleCaseSlug(slug: string): string {
  return slug
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim();
}

/** "careers.acme.co.in" -> "Acme". */
export function companyFromHost(url: string): string {
  try {
    const labels = new URL(url).hostname.toLowerCase().replace(/^www\./, "").split(".");
    const skip = new Set(["careers", "career", "jobs", "job", "apply", "hiring", "work", "join", "talent"]);
    const meaningful = labels.filter((l) => !skip.has(l));
    // drop TLD parts (co.in, com, io, …)
    while (meaningful.length > 1 && (meaningful[meaningful.length - 1]?.length ?? 0) <= 3) meaningful.pop();
    return titleCaseSlug(meaningful[meaningful.length - 1] ?? labels[0] ?? "Unknown");
  } catch {
    return "Unknown";
  }
}

/**
 * Best-effort title/company from a search result title, e.g.
 *  "Job Application for Backend Engineer at Acme" (Greenhouse), "Acme - Backend Engineer" (Lever),
 *  "Backend Engineer @ Acme", "Backend Engineer | Acme Careers".
 */
export function parseResultTitle(raw: string, knownCompany: string | null): { title: string; company: string | null } {
  let s = raw.replace(/\s+/g, " ").replace(/\s*(\.\.\.|…)$/, "").trim();
  const gh = /^job application for (.+?) at (.+)$/i.exec(s);
  if (gh?.[1] && gh[2]) return { title: gh[1].trim(), company: gh[2].trim() };
  const at = /^(.+?)\s+@\s+(.+)$/.exec(s);
  if (at?.[1] && at[2]) return { title: at[1].trim(), company: at[2].trim() };

  const parts = s.split(/\s+[-|–—]\s+/).map((p) => p.trim()).filter(Boolean);
  if (parts.length >= 2) {
    const known = knownCompany?.toLowerCase();
    const companyIdx = known ? parts.findIndex((p) => p.toLowerCase().replace(/\s+careers?$/, "") === known) : -1;
    if (companyIdx >= 0) {
      const rest = parts.filter((_, i) => i !== companyIdx);
      return { title: rest[0] ?? s, company: parts[companyIdx] ?? null };
    }
    // Lever pages are "Company - Title"; most others are "Title - Company".
    s = parts[0] ?? s;
    return { title: s, company: parts[1]?.replace(/\s+careers?$/i, "") ?? null };
  }
  return { title: s, company: null };
}

/** Candidate from a raw search hit (no network). Returns null for unusable URLs. */
export function candidateFromHit(hit: SearchHit, query: string): JobCandidate | null {
  const canonicalUrl = canonicalizeUrl(hit.url);
  if (!canonicalUrl) return null;
  const atsRef = parseAtsJobUrl(canonicalUrl);
  const slugCompany = atsRef ? titleCaseSlug(atsRef.slug) : null;

  let { title, company } = parseResultTitle(hit.title, slugCompany);
  if (atsRef?.provider === "LEVER" && company && slugCompany && title.toLowerCase() === slugCompany.toLowerCase()) {
    [title, company] = [company, title];
  }
  const location = isRemoteText(hit.title) ? "Remote" : null;

  return {
    canonicalUrl,
    company: slugCompany ?? company ?? companyFromHost(canonicalUrl),
    title: title || hit.title || "Untitled",
    location,
    allLocations: location ? [location] : [],
    remoteType: location ? "REMOTE" : "UNKNOWN",
    applyMethod: applyMethodForUrl(canonicalUrl),
    applyUrl: hit.url,
    snippet: hit.snippet,
    jdText: null,
    source: "SERPER",
    sourceQuery: query,
    atsRef,
    postedAt: null,
    raw: { serp: { title: hit.title, url: hit.url, date: hit.date, position: hit.position } },
  };
}

/** Candidate from an ATS API job. `companyName` comes from the API or my saved display name. */
export function candidateFromAtsJob(job: AtsJob, companyName: string | null, source: JobSource, base?: JobCandidate): JobCandidate {
  return {
    canonicalUrl: job.canonicalUrl,
    company: job.companyName ?? companyName ?? base?.company ?? titleCaseSlug(job.slug),
    title: job.title,
    location: job.location,
    allLocations: job.allLocations,
    remoteType: job.remoteType,
    applyMethod: job.provider,
    applyUrl: job.applyUrl,
    snippet: base?.snippet ?? null,
    jdText: job.descriptionText,
    source,
    sourceQuery: base?.sourceQuery ?? null,
    atsRef: { provider: job.provider, slug: job.slug, jobId: job.jobId },
    postedAt: job.postedAt,
    raw: { ...(base?.raw ?? {}), ats: job.raw },
  };
}
