import { z } from "zod";
import { getJson, HttpStatusError, type GetJsonOptions } from "../../lib/http.js";
import { isRemoteText } from "../location.js";
import { atsCanonicalUrl } from "../url-canonical.js";
import { htmlToText } from "./html-text.js";
import type { AtsAdapter, AtsJob } from "./types.js";

/**
 * Greenhouse Job Board API (docs.greenhouse.io/job-board.html), no auth:
 *   GET https://boards-api.greenhouse.io/v1/boards/{token}/jobs?content=true
 *   GET https://boards-api.greenhouse.io/v1/boards/{token}/jobs/{id}
 * Verified live: unknown token -> 404 {"status":404,"error":"Job not found"}; `absolute_url` may be the
 * company's own careers site (e.g. stripe.com/jobs/search?gh_jid=…), so the canonical URL is built from
 * token + id; `content` is entity-escaped HTML; list items already carry company_name/first_published.
 */
const API = "https://boards-api.greenhouse.io/v1/boards";

const ghJob = z.object({
  id: z.number(),
  title: z.string(),
  absolute_url: z.string(),
  updated_at: z.string().nullish(),
  first_published: z.string().nullish(),
  company_name: z.string().nullish(),
  location: z.object({ name: z.string().nullish() }).nullish(),
  content: z.string().nullish(),
  offices: z.array(z.object({ name: z.string().nullish(), location: z.string().nullish() })).nullish(),
  departments: z.array(z.object({ name: z.string().nullish() })).nullish(),
});
const ghList = z.object({ jobs: z.array(ghJob) });

function toAtsJob(slug: string, j: z.infer<typeof ghJob>): AtsJob {
  const location = j.location?.name?.trim() || null;
  const officeLocations = (j.offices ?? []).map((o) => o.location ?? o.name ?? "").filter(Boolean);
  const allLocations = [...new Set([...(location ? [location] : []), ...officeLocations])];
  const jobId = String(j.id);
  return {
    provider: "GREENHOUSE",
    slug,
    jobId,
    title: j.title.trim(),
    companyName: j.company_name?.trim() || null,
    location,
    allLocations,
    remoteType: isRemoteText(location) ? "REMOTE" : "UNKNOWN",
    canonicalUrl: atsCanonicalUrl({ provider: "GREENHOUSE", slug, jobId }),
    applyUrl: j.absolute_url,
    postedAt: j.first_published ? new Date(j.first_published) : null,
    descriptionText: htmlToText(j.content, { escaped: true }),
    raw: { absolute_url: j.absolute_url, updated_at: j.updated_at, departments: (j.departments ?? []).map((d) => d.name) },
  };
}

export const greenhouseAdapter: AtsAdapter = {
  provider: "GREENHOUSE",

  parseBoardUrl(url) {
    if (!/^(boards|job-boards)\.greenhouse\.io$/.test(url.hostname.toLowerCase())) return null;
    const slug = url.searchParams.get("for") ?? url.pathname.split("/").filter(Boolean)[0];
    return slug && slug !== "embed" ? slug.toLowerCase() : null;
  },

  async fetchBoard(slug, opts?: GetJsonOptions) {
    const body = ghList.parse(await getJson(`${API}/${encodeURIComponent(slug)}/jobs?content=true`, opts));
    const jobs = body.jobs.map((j) => toAtsJob(slug, j));
    return { companyName: jobs.find((j) => j.companyName)?.companyName ?? null, jobs };
  },

  async fetchJob(ref, opts?: GetJsonOptions) {
    try {
      return toAtsJob(ref.slug, ghJob.parse(await getJson(`${API}/${encodeURIComponent(ref.slug)}/jobs/${ref.jobId}`, opts)));
    } catch (err) {
      if (err instanceof HttpStatusError && err.status === 404) return null;
      throw err;
    }
  },
};
