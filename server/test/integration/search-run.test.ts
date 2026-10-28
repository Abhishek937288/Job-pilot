import type { SearchQuery } from "@jobpilot/shared";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "../../src/db/prisma.js";
import { stopBoss } from "../../src/queue/boss.js";
import type { AtsAdapters } from "../../src/search/ats/index.js";
import type { AtsJob } from "../../src/search/ats/types.js";
import type { SearchHit, SearchProvider } from "../../src/search/provider.js";
import { atsCanonicalUrl } from "../../src/search/url-canonical.js";
import { getVisibleJobs, setJobStatus } from "../../src/services/jobs.service.js";
import { executeSearchRun, type SearchDeps } from "../../src/services/search-run.service.js";
import { resetSearchTables, seedProfile } from "./helpers.js";

/** Fake provider: returns canned hits per query text and counts calls. */
class FakeProvider implements SearchProvider {
  readonly name = "fake";
  calls: SearchQuery[] = [];
  constructor(private readonly hits: Record<string, SearchHit[]>) {}
  async search(query: SearchQuery) {
    this.calls.push(query);
    return { hits: this.hits[query.q] ?? [], requests: 1, credits: 1 };
  }
}

const hit = (url: string, title: string, position = 1): SearchHit => ({ url, title, snippet: "snippet", date: null, position });

function atsJob(over: Partial<AtsJob> & Pick<AtsJob, "provider" | "slug" | "jobId" | "title" | "location">): AtsJob {
  return {
    companyName: "Acme",
    allLocations: over.location ? [over.location] : [],
    remoteType: "UNKNOWN",
    canonicalUrl: atsCanonicalUrl(over),
    applyUrl: `${atsCanonicalUrl(over)}/apply`,
    postedAt: null,
    descriptionText: null,
    raw: {},
    ...over,
  };
}

function deps(provider: SearchProvider, jobsById: Record<string, AtsJob | null> = {}, boards: Record<string, AtsJob[]> = {}): SearchDeps {
  const adapter = (p: "GREENHOUSE" | "LEVER" | "ASHBY") => ({
    provider: p,
    parseBoardUrl: () => null,
    fetchBoard: vi.fn(async (slug: string) => ({ companyName: "Acme", jobs: boards[`${p}:${slug}`] ?? [] })),
    fetchJob: vi.fn(async (ref: { jobId: string }) => jobsById[ref.jobId] ?? null),
  });
  const ats: AtsAdapters = { GREENHOUSE: adapter("GREENHOUSE"), LEVER: adapter("LEVER"), ASHBY: adapter("ASHBY") };
  return { provider, ats, enrichAtsHits: true };
}

async function queuedRun(queries: SearchQuery[], includeAts = false) {
  return prisma.searchRun.create({ data: { status: "QUEUED", queries, includeAts } });
}

const LEVER_ID = "11111111-1111-4111-8111-111111111111";
const GH_ID = "8172508";
const visible = async () => (await getVisibleJobs({ limit: 50, offset: 0 })).items;

beforeEach(async () => {
  await resetSearchTables();
  await seedProfile();
});
afterAll(async () => {
  await stopBoss();
  await prisma.$disconnect();
});

describe("search run end to end (fake Serper + fake ATS)", () => {
  it("a job marked Done does not come back when it reappears under a different URL with the same fingerprint", async () => {
    const q1 = { q: "backend developer mumbai", location: "Mumbai, Maharashtra, India" };
    // Run 1: found on Lever.
    const leverJob = atsJob({ provider: "LEVER", slug: "acme", jobId: LEVER_ID, title: "Backend Developer", location: "Mumbai, Maharashtra, India" });
    const run1 = await queuedRun([q1]);
    await executeSearchRun(run1.id, deps(new FakeProvider({ [q1.q]: [hit(`https://jobs.lever.co/acme/${LEVER_ID}/apply?lever-source=google`, "Acme - Backend Developer")] }), { [LEVER_ID]: leverJob }));

    const first = await visible();
    expect(first).toHaveLength(1);
    expect(first[0]).toMatchObject({ canonicalUrl: leverJob.canonicalUrl, location: "Mumbai, Maharashtra, India", locationMatch: "MATCH" });
    await setJobStatus(first[0]!.id, "DONE");

    // Run 2: the same posting shows up on Greenhouse (different URL, same company/title/city),
    // plus the same title in another city, which must NOT be treated as a duplicate.
    const ghSame = atsJob({ provider: "GREENHOUSE", slug: "acme", jobId: GH_ID, title: "Backend Developer", location: "Mumbai" });
    const ghPune = atsJob({ provider: "GREENHOUSE", slug: "acme", jobId: "8172999", title: "Backend Developer", location: "Pune" });
    const run2 = await queuedRun([q1]);
    await executeSearchRun(
      run2.id,
      deps(
        new FakeProvider({
          [q1.q]: [
            hit(`https://boards.greenhouse.io/acme/jobs/${GH_ID}?gh_src=x`, "Job Application for Backend Developer at Acme"),
            hit("https://boards.greenhouse.io/acme/jobs/8172999", "Job Application for Backend Developer at Acme", 2),
            hit(`https://jobs.lever.co/acme/${LEVER_ID}`, "Acme - Backend Developer", 3), // the Done URL itself
          ],
        }),
        { [GH_ID]: ghSame, "8172999": ghPune },
      ),
    );

    // Both new Greenhouse URLs were stored...
    expect(await prisma.job.count()).toBe(3);
    // ...but only the Pune one is visible: the Mumbai one shares the Done job's fingerprint.
    const after = await visible();
    expect(after.map((j) => j.canonicalUrl)).toEqual([ghPune.canonicalUrl]);
    expect(after[0]?.locationMatch).toBe("MISMATCH"); // flagged, not dropped

    const r2 = await prisma.searchRun.findUniqueOrThrow({ where: { id: run2.id } });
    expect(r2).toMatchObject({ status: "SUCCEEDED", serperCalls: 1, serperCredits: 1, newJobsCount: 1 });
  });

  it("same company posting the same title in two cities = two jobs", async () => {
    const q = { q: "query-a", location: null };
    const mumbai = atsJob({ provider: "GREENHOUSE", slug: "acme", jobId: "1", title: "Software Developer", location: "Mumbai" });
    const bangalore = atsJob({ provider: "GREENHOUSE", slug: "acme", jobId: "2", title: "Software Developer", location: "Bengaluru" });
    const run = await queuedRun([q]);
    await executeSearchRun(
      run.id,
      deps(new FakeProvider({ "query-a": [hit("https://boards.greenhouse.io/acme/jobs/1", "x"), hit("https://boards.greenhouse.io/acme/jobs/2", "x", 2)] }), { "1": mumbai, "2": bangalore }),
    );
    const jobs = await visible();
    expect(jobs).toHaveLength(2);
    const fps = await prisma.job.findMany({ select: { fingerprint: true } });
    expect(new Set(fps.map((f) => f.fingerprint)).size).toBe(2);

    await setJobStatus(jobs.find((j) => j.location === "Mumbai")!.id, "DONE");
    expect((await visible()).map((j) => j.location)).toEqual(["Bengaluru"]);
  });

  it("dedupes result URLs (tracking params, ATS variants) before inserting, and logs Serper calls", async () => {
    const qs = [
      { q: "one", location: null },
      { q: "two", location: null },
    ];
    const provider = new FakeProvider({
      one: [hit("https://careers.globex.com/jobs/42?utm_source=google", "Backend Developer - Globex"), hit("https://www.linkedin.com/jobs/view/1", "Blocked")],
      two: [hit("https://careers.globex.com/jobs/42/#apply", "Backend Developer - Globex"), hit("https://careers.globex.com/jobs/42", "dup")],
    });
    const run = await queuedRun(qs);
    await executeSearchRun(run.id, deps(provider));

    expect(provider.calls).toHaveLength(2);
    expect(await prisma.job.count()).toBe(1);
    const row = await prisma.searchRun.findUniqueOrThrow({ where: { id: run.id } });
    expect(row).toMatchObject({ serperCalls: 2, serperCredits: 2, resultsCount: 4, duplicateUrlCount: 2, blockedCount: 1, newJobsCount: 1 });
    const job = await prisma.job.findFirstOrThrow();
    expect(job).toMatchObject({ canonicalUrl: "https://careers.globex.com/jobs/42", company: "Globex", locationMatch: "UNKNOWN", jdText: null });
  });

  it("re-running the same search inserts nothing new and doesn't re-query ATS for known URLs", async () => {
    const q = { q: "query-a", location: null };
    const lever = atsJob({ provider: "LEVER", slug: "acme", jobId: LEVER_ID, title: "Backend Developer", location: "Mumbai" });
    const d1 = deps(new FakeProvider({ "query-a": [hit(`https://jobs.lever.co/acme/${LEVER_ID}`, "Acme - Backend Developer")] }), { [LEVER_ID]: lever });
    await executeSearchRun((await queuedRun([q])).id, d1);
    const d2 = deps(new FakeProvider({ "query-a": [hit(`https://jobs.lever.co/acme/${LEVER_ID}`, "Acme - Backend Developer")] }), { [LEVER_ID]: lever });
    const run2 = await queuedRun([q]);
    await executeSearchRun(run2.id, d2);

    expect(await prisma.job.count()).toBe(1);
    expect(d2.ats.LEVER.fetchJob).not.toHaveBeenCalled();
    expect((await prisma.searchRun.findUniqueOrThrow({ where: { id: run2.id } })).newJobsCount).toBe(0);
  });

  it("ATS boards from Settings: title-filtered, location mismatches flagged not dropped", async () => {
    await prisma.atsCompany.create({ data: { provider: "GREENHOUSE", slug: "acme" } });
    const board = [
      atsJob({ provider: "GREENHOUSE", slug: "acme", jobId: "10", title: "Senior Backend Engineer", location: "Dublin" }),
      atsJob({ provider: "GREENHOUSE", slug: "acme", jobId: "11", title: "Software Engineer", location: "Navi Mumbai" }),
      atsJob({ provider: "GREENHOUSE", slug: "acme", jobId: "12", title: "Account Executive", location: "Mumbai" }),
    ];
    const run = await queuedRun([], true);
    await executeSearchRun(run.id, deps(new FakeProvider({}), {}, { "GREENHOUSE:acme": board }));

    const jobs = await prisma.job.findMany({ orderBy: { atsJobId: "asc" } });
    expect(jobs.map((j) => [j.title, j.locationMatch, j.source])).toEqual([
      ["Senior Backend Engineer", "MISMATCH", "GREENHOUSE"],
      ["Software Engineer", "MATCH", "GREENHOUSE"],
    ]);
    const co = await prisma.atsCompany.findFirstOrThrow();
    expect(co).toMatchObject({ lastJobCount: 3, lastError: null, displayName: "Acme" });
  });

  it("a fatal provider error stops further queries but keeps what was found", async () => {
    const qs = [
      { q: "ok query", location: null },
      { q: "bad query", location: null },
      { q: "never query", location: null },
    ];
    const { SearchProviderError } = await import("../../src/search/provider.js");
    const provider: SearchProvider = {
      name: "flaky",
      search: vi.fn(async (query: SearchQuery) => {
        if (query.q === "bad query") throw new SearchProviderError("key rejected", 1, true);
        return { hits: [hit("https://careers.globex.com/jobs/1", "Backend Developer - Globex")], requests: 1, credits: 1 };
      }),
    };
    const run = await queuedRun(qs);
    await executeSearchRun(run.id, deps(provider));
    expect(provider.search).toHaveBeenCalledTimes(2);
    const row = await prisma.searchRun.findUniqueOrThrow({ where: { id: run.id } });
    expect(row).toMatchObject({ status: "FAILED", serperCalls: 2, serperCredits: 1, error: "key rejected" });
    expect(await prisma.job.count()).toBe(1);
  });

  it("ignores runs that are not QUEUED (e.g. a DRAFT is never executed)", async () => {
    const provider = new FakeProvider({});
    const draft = await prisma.searchRun.create({ data: { status: "DRAFT", queries: [{ q: "x", location: null }] } });
    await executeSearchRun(draft.id, deps(provider));
    expect(provider.calls).toHaveLength(0);
  });
});
