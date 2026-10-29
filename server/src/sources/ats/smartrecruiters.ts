import { z } from "zod";
import type { RemoteType } from "@jobpilot/shared";
import { getJson } from "../../lib/http.js";
import { buildJob } from "../../jobs/build.js";
import type { AtsAdapter } from "./types.js";

/**
 * SmartRecruiters Posting API (no auth): GET https://api.smartrecruiters.com/v1/companies/{id}/postings?limit=100&offset=N
 * Unknown company -> 200 with an empty list. Company identifiers are case-sensitive. No descriptions in the
 * list; large employers have thousands of postings, so only the newest MAX_POSTINGS are read.
 */
const API = "https://api.smartrecruiters.com/v1/companies";
const PAGE = 100;
const MAX_POSTINGS = 500;

const posting = z.object({
  id: z.string(),
  name: z.string(),
  releasedDate: z.string().nullish(),
  company: z.object({ name: z.string().nullish() }).nullish(),
  location: z
    .object({
      city: z.string().nullish(),
      region: z.string().nullish(),
      country: z.string().nullish(),
      remote: z.boolean().nullish(),
      hybrid: z.boolean().nullish(),
      fullLocation: z.string().nullish(),
    })
    .nullish(),
  typeOfEmployment: z.object({ label: z.string().nullish() }).nullish(),
  experienceLevel: z.object({ id: z.string().nullish() }).nullish(),
});
const page = z.object({ totalFound: z.number(), content: z.array(posting) });

function remoteOf(l: z.infer<typeof posting>["location"]): RemoteType {
  if (l?.remote) return "remote";
  if (l?.hybrid) return "hybrid";
  return l ? "onsite" : "unknown";
}

export const smartRecruitersAdapter: AtsAdapter = {
  type: "smartrecruiters",

  parseBoardUrl(url) {
    if (!/^(jobs|careers)\.smartrecruiters\.com$/.test(url.hostname.toLowerCase())) return null;
    // Identifiers are case-sensitive: keep the case from the URL.
    return url.pathname.split("/").filter(Boolean)[0] ?? null;
  },

  boardUrl: (token) => `https://jobs.smartrecruiters.com/${token}`,

  async fetchBoard(token, companyName, opts) {
    const all: z.infer<typeof posting>[] = [];
    for (let offset = 0; offset < MAX_POSTINGS; offset += PAGE) {
      const body = page.parse(await getJson(`${API}/${encodeURIComponent(token)}/postings?limit=${PAGE}&offset=${offset}`, opts));
      all.push(...body.content);
      if (body.content.length < PAGE || all.length >= body.totalFound) break;
    }
    const name = all.find((p) => p.company?.name)?.company?.name?.trim() || null;
    return {
      companyName: name,
      jobs: all.map((p) =>
        buildJob({
          source: "smartrecruiters",
          sourceJobId: `${token}:${p.id}`,
          title: p.name,
          company: name ?? companyName,
          location: p.location?.fullLocation?.replace(/,\s*,/g, ",") ?? null,
          city: p.location?.city ?? null,
          region: p.location?.region ?? null,
          country: p.location?.country?.toUpperCase() ?? null,
          remote: remoteOf(p.location),
          applyLinks: [{ url: `https://jobs.smartrecruiters.com/${token}/${p.id}`, source: "smartrecruiters", isDirect: true }],
          postedAt: p.releasedDate ? new Date(p.releasedDate) : null,
          employmentType: p.typeOfEmployment?.label ?? null,
        }),
      ),
    };
  },
};
