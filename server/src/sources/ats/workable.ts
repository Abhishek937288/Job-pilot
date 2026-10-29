import { z } from "zod";
import type { RemoteType } from "@jobpilot/shared";
import { postJson } from "../../lib/http.js";
import { buildJob } from "../../jobs/build.js";
import type { AtsAdapter } from "./types.js";

/**
 * Workable careers API (no auth), as used by apply.workable.com:
 *   POST https://apply.workable.com/api/v3/accounts/{account}/jobs  body {query:"", ...}  -> {results, total, nextPage?}
 * Unknown account -> 404. The list has no descriptions; pages are followed with the `token` field.
 */
const API = "https://apply.workable.com/api/v3/accounts";
const MAX_PAGES = 20;

const wJob = z.object({
  id: z.number().nullish(),
  shortcode: z.string(),
  title: z.string(),
  remote: z.boolean().nullish(),
  workplace: z.string().nullish(),
  location: z
    .object({ city: z.string().nullish(), region: z.string().nullish(), country: z.string().nullish(), display: z.string().nullish() })
    .nullish(),
  published: z.string().nullish(),
  type: z.string().nullish(),
  state: z.string().nullish(),
});
const wPage = z.object({ results: z.array(wJob), total: z.number().nullish(), nextPage: z.string().nullish() });

function remoteOf(workplace: string | null | undefined, remote: boolean | null | undefined): RemoteType {
  if (workplace === "remote") return "remote";
  if (workplace === "hybrid") return "hybrid";
  if (workplace === "on_site") return "onsite";
  return remote ? "remote" : "unknown";
}

export const workableAdapter: AtsAdapter = {
  type: "workable",

  parseBoardUrl(url) {
    const host = url.hostname.toLowerCase();
    if (host === "apply.workable.com") {
      const token = url.pathname.split("/").filter(Boolean)[0];
      return token && token !== "api" && token !== "j" ? token.toLowerCase() : null;
    }
    const m = /^([a-z0-9-]+)\.workable\.com$/.exec(host);
    return m && m[1] !== "www" && m[1] !== "apply" ? m[1]! : null;
  },

  boardUrl: (token) => `https://apply.workable.com/${token}/`,

  async fetchBoard(token, companyName, opts) {
    const all: z.infer<typeof wJob>[] = [];
    let next: string | null | undefined;
    for (let page = 0; page < MAX_PAGES; page++) {
      const body = wPage.parse(
        await postJson(`${API}/${encodeURIComponent(token)}/jobs`, { query: "", location: [], department: [], worktype: [], remote: [], ...(next ? { token: next } : {}) }, opts),
      );
      all.push(...body.results);
      next = body.nextPage;
      if (!next || body.results.length === 0) break;
    }
    return {
      companyName: null,
      jobs: all
        .filter((j) => !j.state || j.state === "published")
        .map((j) =>
          buildJob({
            source: "workable",
            sourceJobId: `${token}:${j.shortcode.toLowerCase()}`,
            title: j.title,
            company: companyName,
            location: j.location?.display ?? null,
            city: j.location?.city ?? null,
            region: j.location?.region ?? null,
            country: j.location?.country ?? null,
            remote: remoteOf(j.workplace, j.remote),
            applyLinks: [{ url: `https://apply.workable.com/${token}/j/${j.shortcode}/`, source: "workable", isDirect: true }],
            postedAt: j.published ? new Date(j.published) : null,
            employmentType: j.type ?? null,
          }),
        ),
    };
  },
};
