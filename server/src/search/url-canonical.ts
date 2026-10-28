import type { AtsProvider } from "@jobpilot/shared";

/** Query params that only track where a click came from. */
const TRACKING_PARAMS = new Set(["gh_src", "ref", "source", "src", "lever-source", "lever-origin", "gclid", "fbclid", "mc_cid", "mc_eid"]);
const isTrackingParam = (name: string) => name.startsWith("utm_") || TRACKING_PARAMS.has(name);

export interface AtsJobRef {
  provider: AtsProvider;
  /** Board token / site name, lowercased (all three providers treat it case-insensitively). */
  slug: string;
  jobId: string;
}

// EU instances use different, unverified API hosts, so their URLs are treated as plain company URLs.
const GREENHOUSE_HOSTS = /^(boards|job-boards)\.greenhouse\.io$/;
const LEVER_HOSTS = /^jobs\.lever\.co$/;
const ASHBY_HOST = "jobs.ashbyhq.com";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Recognise a job URL on one of the supported ATS boards (formats verified against live responses):
 * - Greenhouse: {boards|job-boards}.greenhouse.io/{token}/jobs/{id}, or /embed/job_app?for={token}&token={id}
 * - Lever:      jobs.lever.co/{site}/{uuid}[/apply]
 * - Ashby:      jobs.ashbyhq.com/{board}/{uuid}[/application]
 */
export function parseAtsJobUrl(input: string | URL): AtsJobRef | null {
  let url: URL;
  try {
    url = typeof input === "string" ? new URL(input) : input;
  } catch {
    return null;
  }
  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  const parts = url.pathname.split("/").filter(Boolean);

  if (GREENHOUSE_HOSTS.test(host)) {
    if (parts[0] === "embed" && parts[1] === "job_app") {
      const slug = url.searchParams.get("for");
      const jobId = url.searchParams.get("token");
      return slug && jobId && /^\d+$/.test(jobId) ? { provider: "GREENHOUSE", slug: slug.toLowerCase(), jobId } : null;
    }
    const [slug, jobs, jobId] = parts;
    if (slug && jobs === "jobs" && jobId && /^\d+$/.test(jobId)) return { provider: "GREENHOUSE", slug: slug.toLowerCase(), jobId };
    return null;
  }
  if (LEVER_HOSTS.test(host)) {
    const [slug, jobId] = parts;
    return slug && jobId && UUID.test(jobId) ? { provider: "LEVER", slug: slug.toLowerCase(), jobId: jobId.toLowerCase() } : null;
  }
  if (host === ASHBY_HOST) {
    const [slug, jobId] = parts;
    return slug && jobId && UUID.test(jobId) ? { provider: "ASHBY", slug: decodeURIComponent(slug).toLowerCase(), jobId: jobId.toLowerCase() } : null;
  }
  return null;
}

/** The one URL we store for an ATS job, whatever variant it was found under. */
export function atsCanonicalUrl(ref: AtsJobRef): string {
  switch (ref.provider) {
    case "GREENHOUSE":
      // boards.greenhouse.io now 301-redirects here.
      return `https://job-boards.greenhouse.io/${ref.slug}/jobs/${ref.jobId}`;
    case "LEVER":
      return `https://jobs.lever.co/${ref.slug}/${ref.jobId}`;
    case "ASHBY":
      return `https://jobs.ashbyhq.com/${encodeURIComponent(ref.slug)}/${ref.jobId}`;
  }
}

/**
 * Canonical form used for dedupe: https, lowercase host without www, no default port,
 * no tracking params or fragment, no trailing slash, sorted query; ATS job URLs map to one form.
 * Returns null for anything that is not an http(s) URL.
 */
export function canonicalizeUrl(input: string): string | null {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;

  const ats = parseAtsJobUrl(url);
  if (ats) return atsCanonicalUrl(ats);

  url.protocol = "https:";
  url.hostname = url.hostname.toLowerCase().replace(/^www\./, "");
  url.port = url.port === "80" || url.port === "443" ? "" : url.port;
  url.hash = "";
  url.username = "";
  url.password = "";

  const kept = [...url.searchParams.entries()].filter(([k]) => !isTrackingParam(k.toLowerCase()));
  kept.sort(([a, av], [b, bv]) => (a === b ? av.localeCompare(bv) : a.localeCompare(b)));
  url.search = new URLSearchParams(kept).toString();

  let path = url.pathname.replace(/\/{2,}/g, "/");
  if (path.length > 1) path = path.replace(/\/+$/, "");
  url.pathname = path;

  const out = url.toString();
  // URL keeps a bare "/" path; drop it so https://a.com and https://a.com/ match.
  return url.pathname === "/" && !url.search ? out.replace(/\/$/, "") : out;
}

/** Domains we never ingest (no scraping LinkedIn, Naukri or Indeed, even via search results). */
const BLOCKED_DOMAINS = ["linkedin.com", "naukri.com", "indeed.com", "indeed.co.in"];

export function isBlockedDomain(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return BLOCKED_DOMAINS.some((d) => host === d || host.endsWith(`.${d}`));
  } catch {
    return true;
  }
}
