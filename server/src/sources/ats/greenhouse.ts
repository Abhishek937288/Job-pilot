import { z } from "zod";
import { getJson } from "../../lib/http.js";
import { htmlToText } from "../../lib/text.js";
import { buildJob } from "../../jobs/build.js";
import { remoteFromText } from "../../jobs/location.js";
import type { AtsAdapter } from "./types.js";

/**
 * Greenhouse Job Board API (no auth): GET https://boards-api.greenhouse.io/v1/boards/{token}/jobs?content=true
 * Unknown token -> 404. `content` is entity-escaped HTML. `absolute_url` may be the company's own careers site.
 */
const API = "https://boards-api.greenhouse.io/v1/boards";

const ghJob = z.object({
  id: z.number(),
  title: z.string(),
  absolute_url: z.string(),
  first_published: z.string().nullish(),
  updated_at: z.string().nullish(),
  company_name: z.string().nullish(),
  location: z.object({ name: z.string().nullish() }).nullish(),
  content: z.string().nullish(),
});
const ghList = z.object({ jobs: z.array(ghJob) });

export const greenhouseAdapter: AtsAdapter = {
  type: "greenhouse",

  parseBoardUrl(url) {
    if (!/^(boards|job-boards)(\.eu)?\.greenhouse\.io$/.test(url.hostname.toLowerCase())) return null;
    const token = url.searchParams.get("for") ?? url.pathname.split("/").filter(Boolean)[0];
    return token && token !== "embed" ? token.toLowerCase() : null;
  },

  boardUrl: (token) => `https://boards.greenhouse.io/${token}`,

  async fetchBoard(token, companyName, opts) {
    const body = ghList.parse(await getJson(`${API}/${encodeURIComponent(token)}/jobs?content=true`, opts));
    const name = body.jobs.find((j) => j.company_name)?.company_name?.trim() || companyName;
    return {
      companyName: name,
      jobs: body.jobs.map((j) => {
        const location = j.location?.name?.trim() || null;
        return buildJob({
          source: "greenhouse",
          sourceJobId: `${token}:${j.id}`,
          title: j.title,
          company: name,
          location,
          remote: remoteFromText(location),
          applyLinks: [{ url: j.absolute_url, source: "greenhouse", isDirect: true }],
          postedAt: j.first_published ? new Date(j.first_published) : j.updated_at ? new Date(j.updated_at) : null,
          description: htmlToText(j.content, { escaped: true }),
        });
      }),
    };
  },
};
