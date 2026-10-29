import { z } from "zod";
import type { RemoteType } from "@jobpilot/shared";
import { getJson } from "../../lib/http.js";
import { buildJob } from "../../jobs/build.js";
import { remoteFromText } from "../../jobs/location.js";
import type { AtsAdapter } from "./types.js";

/**
 * Lever Postings API (no auth): GET https://api.lever.co/v0/postings/{site}?mode=json&skip=N&limit=M
 * The list is a bare JSON array; unknown site -> 404. No company name is returned.
 */
const API = "https://api.lever.co/v0/postings";
const PAGE = 100;
const MAX_PAGES = 20;

const posting = z.object({
  id: z.string(),
  text: z.string(),
  hostedUrl: z.string(),
  applyUrl: z.string().nullish(),
  createdAt: z.number().nullish(),
  country: z.string().nullish(),
  workplaceType: z.string().nullish(),
  descriptionPlain: z.string().nullish(),
  additionalPlain: z.string().nullish(),
  lists: z.array(z.object({ text: z.string().nullish(), content: z.string().nullish() })).nullish(),
  categories: z.object({ location: z.string().nullish(), commitment: z.string().nullish() }).nullish(),
});

function remoteOf(workplaceType: string | null | undefined, location: string | null): RemoteType {
  if (workplaceType === "remote") return "remote";
  if (workplaceType === "hybrid") return "hybrid";
  if (workplaceType === "onsite" || workplaceType === "on-site") return "onsite";
  return remoteFromText(location);
}

export const leverAdapter: AtsAdapter = {
  type: "lever",

  parseBoardUrl(url) {
    if (!/^jobs\.(eu\.)?lever\.co$/.test(url.hostname.toLowerCase())) return null;
    const token = url.pathname.split("/").filter(Boolean)[0];
    return token ? token.toLowerCase() : null;
  },

  boardUrl: (token) => `https://jobs.lever.co/${token}`,

  async fetchBoard(token, companyName, opts) {
    const all: z.infer<typeof posting>[] = [];
    for (let page = 0; page < MAX_PAGES; page++) {
      const batch = z.array(posting).parse(await getJson(`${API}/${encodeURIComponent(token)}?mode=json&skip=${page * PAGE}&limit=${PAGE}`, opts));
      all.push(...batch);
      if (batch.length < PAGE) break;
    }
    return {
      companyName: null,
      jobs: all.map((p) => {
        const location = p.categories?.location?.trim() || null;
        const lists = (p.lists ?? []).map((l) => `${l.text ?? ""}\n${(l.content ?? "").replace(/<[^>]+>/g, " ")}`).join("\n");
        return buildJob({
          source: "lever",
          sourceJobId: `${token}:${p.id.toLowerCase()}`,
          title: p.text,
          company: companyName,
          location,
          country: p.country ?? null,
          remote: remoteOf(p.workplaceType, location),
          applyLinks: [{ url: p.hostedUrl, source: "lever", isDirect: true }],
          postedAt: p.createdAt ? new Date(p.createdAt) : null,
          description: [p.descriptionPlain, lists, p.additionalPlain].filter(Boolean).join("\n\n"),
          employmentType: p.categories?.commitment ?? null,
        });
      }),
    };
  },
};
