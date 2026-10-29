import { z } from "zod";
import type { RemoteType } from "@jobpilot/shared";
import { getJson } from "../../lib/http.js";
import { buildJob } from "../../jobs/build.js";
import type { AtsAdapter } from "./types.js";

/**
 * Ashby public job posting API (no auth): GET https://api.ashbyhq.com/posting-api/job-board/{name}
 * Board names are case-insensitive; unknown board -> 404 with a plain-text body.
 */
const API = "https://api.ashbyhq.com/posting-api/job-board";

const ashbyJob = z.object({
  id: z.string(),
  title: z.string(),
  location: z.string().nullish(),
  workplaceType: z.string().nullish(),
  isRemote: z.boolean().nullish(),
  isListed: z.boolean().nullish(),
  employmentType: z.string().nullish(),
  jobUrl: z.string(),
  applyUrl: z.string().nullish(),
  publishedAt: z.string().nullish(),
  descriptionPlain: z.string().nullish(),
});

function remoteOf(workplaceType: string | null | undefined, isRemote: boolean | null | undefined): RemoteType {
  // isRemote is true for remote *and* hybrid, so workplaceType decides.
  if (workplaceType === "Remote") return "remote";
  if (workplaceType === "Hybrid") return "hybrid";
  if (workplaceType === "OnSite") return "onsite";
  return isRemote ? "remote" : "unknown";
}

export const ashbyAdapter: AtsAdapter = {
  type: "ashby",

  parseBoardUrl(url) {
    if (url.hostname.toLowerCase() !== "jobs.ashbyhq.com") return null;
    const token = url.pathname.split("/").filter(Boolean)[0];
    return token ? token.toLowerCase() : null;
  },

  boardUrl: (token) => `https://jobs.ashbyhq.com/${token}`,

  async fetchBoard(token, companyName, opts) {
    const body = z.object({ jobs: z.array(ashbyJob) }).parse(await getJson(`${API}/${encodeURIComponent(token)}`, opts));
    return {
      companyName: null,
      jobs: body.jobs
        // Unlisted postings are only meant to be reachable by direct link.
        .filter((j) => j.isListed !== false)
        .map((j) =>
          buildJob({
            source: "ashby",
            sourceJobId: `${token}:${j.id.toLowerCase()}`,
            title: j.title,
            company: companyName,
            location: j.location ?? null,
            remote: remoteOf(j.workplaceType, j.isRemote),
            applyLinks: [{ url: j.jobUrl, source: "ashby", isDirect: true }],
            postedAt: j.publishedAt ? new Date(j.publishedAt) : null,
            description: j.descriptionPlain ?? null,
            employmentType: j.employmentType ?? null,
          }),
        ),
    };
  },
};
