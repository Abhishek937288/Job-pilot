import type { RemoteType } from "@jobpilot/shared";
import { z } from "zod";
import { getJson, HttpStatusError, type GetJsonOptions } from "../../lib/http.js";
import { isRemoteText } from "../location.js";
import { atsCanonicalUrl } from "../url-canonical.js";
import type { AtsAdapter, AtsJob } from "./types.js";

/**
 * Lever Postings API (github.com/lever/postings-api), no auth for reading published postings:
 *   GET https://api.lever.co/v0/postings/{site}?mode=json&skip=N&limit=M   (EU instance not supported yet)
 *   GET https://api.lever.co/v0/postings/{site}/{id}
 * Verified live: list is a bare JSON array; unknown site -> 404 {"ok":false,"error":"Document not found"};
 * `createdAt` (epoch ms) is returned although the README doesn't list it; no company name is returned.
 */
const PAGE = 100;

const leverPosting = z.object({
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
  categories: z
    .object({
      location: z.string().nullish(),
      allLocations: z.array(z.string()).nullish(),
      commitment: z.string().nullish(),
      team: z.string().nullish(),
      department: z.string().nullish(),
    })
    .nullish(),
});

function remoteTypeOf(workplaceType: string | null | undefined, location: string | null): RemoteType {
  switch (workplaceType) {
    case "remote":
      return "REMOTE";
    case "hybrid":
      return "HYBRID";
    case "on-site": // documented spelling
    case "onsite": // spelling the live API actually returns
      return "ONSITE";
    default:
      return isRemoteText(location) ? "REMOTE" : "UNKNOWN";
  }
}

function toAtsJob(slug: string, p: z.infer<typeof leverPosting>): AtsJob {
  const location = p.categories?.location?.trim() || null;
  const allLocations = [...new Set([...(location ? [location] : []), ...(p.categories?.allLocations ?? [])])];
  const listText = (p.lists ?? []).map((l) => `${l.text ?? ""}\n${(l.content ?? "").replace(/<[^>]+>/g, " ")}`).join("\n");
  const jobId = p.id.toLowerCase();
  return {
    provider: "LEVER",
    slug,
    jobId,
    title: p.text.trim(),
    companyName: null,
    location,
    allLocations,
    remoteType: remoteTypeOf(p.workplaceType, location),
    canonicalUrl: atsCanonicalUrl({ provider: "LEVER", slug, jobId }),
    applyUrl: p.applyUrl ?? `${p.hostedUrl}/apply`,
    postedAt: p.createdAt ? new Date(p.createdAt) : null,
    descriptionText: [p.descriptionPlain, listText, p.additionalPlain].filter(Boolean).join("\n\n").trim() || null,
    raw: { hostedUrl: p.hostedUrl, country: p.country, workplaceType: p.workplaceType, categories: p.categories },
  };
}

const API = "https://api.lever.co/v0/postings";

export const leverAdapter: AtsAdapter = {
  provider: "LEVER",

  parseBoardUrl(url) {
    if (!/^jobs\.lever\.co$/.test(url.hostname.toLowerCase())) return null;
    const slug = url.pathname.split("/").filter(Boolean)[0];
    return slug ? slug.toLowerCase() : null;
  },

  async fetchBoard(slug, opts?: GetJsonOptions) {
    const jobs: AtsJob[] = [];
    for (let skip = 0; ; skip += PAGE) {
      const page = z.array(leverPosting).parse(await getJson(`${API}/${encodeURIComponent(slug)}?mode=json&skip=${skip}&limit=${PAGE}`, opts));
      jobs.push(...page.map((p) => toAtsJob(slug, p)));
      if (page.length < PAGE) break;
    }
    return { companyName: null, jobs };
  },

  async fetchJob(ref, opts?: GetJsonOptions) {
    try {
      return toAtsJob(ref.slug, leverPosting.parse(await getJson(`${API}/${encodeURIComponent(ref.slug)}/${ref.jobId}`, opts)));
    } catch (err) {
      if (err instanceof HttpStatusError && err.status === 404) return null;
      throw err;
    }
  },
};
