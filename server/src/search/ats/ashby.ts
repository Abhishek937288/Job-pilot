import type { RemoteType } from "@jobpilot/shared";
import { z } from "zod";
import { getJson, HttpStatusError, type GetJsonOptions } from "../../lib/http.js";
import { atsCanonicalUrl } from "../url-canonical.js";
import type { AtsAdapter, AtsBoard, AtsJob } from "./types.js";

/**
 * Ashby public job posting API (developers.ashbyhq.com/docs/public-job-posting-api), no auth:
 *   GET https://api.ashbyhq.com/posting-api/job-board/{JOB_BOARD_NAME}
 * Verified live: jobs carry an `id` (not in the docs); the board name is case-insensitive both in the API and
 * on jobs.ashbyhq.com, and `jobUrl` echoes whatever case was requested, so slugs are lowercased here;
 * unknown board -> 404 with plain-text "Not Found" (not JSON).
 * There is no documented single-job endpoint, so fetchJob reads the board (cached briefly per slug).
 */
const API = "https://api.ashbyhq.com/posting-api/job-board";
const BOARD_CACHE_MS = 10 * 60_000;

const ashbyJob = z.object({
  id: z.string(),
  title: z.string(),
  location: z.string().nullish(),
  secondaryLocations: z.array(z.object({ location: z.string().nullish() })).nullish(),
  workplaceType: z.string().nullish(),
  isRemote: z.boolean().nullish(),
  isListed: z.boolean().nullish(),
  employmentType: z.string().nullish(),
  department: z.string().nullish(),
  team: z.string().nullish(),
  jobUrl: z.string(),
  applyUrl: z.string().nullish(),
  publishedAt: z.string().nullish(),
  descriptionPlain: z.string().nullish(),
});
const ashbyBoard = z.object({ jobs: z.array(ashbyJob) });

function remoteTypeOf(workplaceType: string | null | undefined, isRemote: boolean | null | undefined): RemoteType {
  // isRemote is true for Remote *and* Hybrid, so workplaceType decides.
  if (workplaceType === "Remote") return "REMOTE";
  if (workplaceType === "Hybrid") return "HYBRID";
  if (workplaceType === "OnSite") return "ONSITE";
  return isRemote ? "REMOTE" : "UNKNOWN";
}

function toAtsJob(slug: string, j: z.infer<typeof ashbyJob>): AtsJob {
  const location = j.location?.trim() || null;
  const allLocations = [...new Set([...(location ? [location] : []), ...(j.secondaryLocations ?? []).map((s) => s.location ?? "").filter(Boolean)])];
  const jobId = j.id.toLowerCase();
  return {
    provider: "ASHBY",
    slug,
    jobId,
    title: j.title.trim(),
    companyName: null,
    location,
    allLocations,
    remoteType: remoteTypeOf(j.workplaceType, j.isRemote),
    canonicalUrl: atsCanonicalUrl({ provider: "ASHBY", slug, jobId }),
    applyUrl: j.applyUrl ?? `${j.jobUrl}/application`,
    postedAt: j.publishedAt ? new Date(j.publishedAt) : null,
    descriptionText: j.descriptionPlain?.trim() || null,
    raw: { workplaceType: j.workplaceType, employmentType: j.employmentType, department: j.department, team: j.team, isListed: j.isListed },
  };
}

const boardCache = new Map<string, { at: number; board: AtsBoard }>();

async function loadBoard(rawSlug: string, opts?: GetJsonOptions): Promise<AtsBoard> {
  const slug = rawSlug.toLowerCase();
  const key = slug;
  const hit = boardCache.get(key);
  if (hit && Date.now() - hit.at < BOARD_CACHE_MS) return hit.board;
  const body = ashbyBoard.parse(await getJson(`${API}/${encodeURIComponent(slug)}`, opts));
  // Unlisted postings are only meant to be reachable by direct link; keep them out of board results.
  const board = { companyName: null, jobs: body.jobs.filter((j) => j.isListed !== false).map((j) => toAtsJob(slug, j)) };
  boardCache.set(key, { at: Date.now(), board });
  return board;
}

export function clearAshbyCache(): void {
  boardCache.clear();
}

export const ashbyAdapter: AtsAdapter = {
  provider: "ASHBY",

  parseBoardUrl(url) {
    if (url.hostname.toLowerCase() !== "jobs.ashbyhq.com") return null;
    const slug = url.pathname.split("/").filter(Boolean)[0];
    return slug ? decodeURIComponent(slug).toLowerCase() : null;
  },

  fetchBoard: loadBoard,

  async fetchJob(ref, opts?: GetJsonOptions) {
    try {
      const board = await loadBoard(ref.slug, opts);
      return board.jobs.find((j) => j.jobId === ref.jobId.toLowerCase()) ?? null;
    } catch (err) {
      if (err instanceof HttpStatusError && err.status === 404) return null;
      throw err;
    }
  },
};
