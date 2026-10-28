import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { HostThrottle } from "../src/lib/http.js";
import { ashbyAdapter, clearAshbyCache } from "../src/search/ats/ashby.js";
import { greenhouseAdapter } from "../src/search/ats/greenhouse.js";
import { parseBoardInput } from "../src/search/ats/index.js";
import { leverAdapter } from "../src/search/ats/lever.js";

// Fixtures are trimmed copies of real responses captured from the live public APIs.
const fixture = (name: string) => readFileSync(new URL(`./fixtures/ats/${name}`, import.meta.url), "utf8");
const throttle = new HostThrottle(0);

function fetchReturning(status: number, body: string) {
  return vi.fn(async (_url: string) => new Response(body, { status }));
}

describe("greenhouse adapter", () => {
  it("lists a board via boards-api with content=true and builds canonical URLs from token + id", async () => {
    const fetchImpl = fetchReturning(200, fixture("greenhouse-list.json"));
    const board = await greenhouseAdapter.fetchBoard("stripe", { fetchImpl, throttle });
    expect(fetchImpl.mock.calls[0]?.[0]).toBe("https://boards-api.greenhouse.io/v1/boards/stripe/jobs?content=true");
    expect(board.companyName).toBe("Stripe");
    expect(board.jobs).toHaveLength(3);
    const j = board.jobs[0]!;
    expect(j).toMatchObject({
      provider: "GREENHOUSE",
      jobId: "8172508",
      title: "Abuse Investigator",
      location: "Dublin",
      canonicalUrl: "https://job-boards.greenhouse.io/stripe/jobs/8172508",
      // absolute_url points at the company's own site; kept as the apply URL
      applyUrl: "https://stripe.com/jobs/search?gh_jid=8172508",
    });
    expect(j.descriptionText).toMatch(/Who we are/);
    expect(j.descriptionText).not.toMatch(/&lt;|<h2>/);
  });

  it("fetchJob returns null on 404", async () => {
    const fetchImpl = fetchReturning(404, '{"status":404,"error":"Job not found"}');
    expect(await greenhouseAdapter.fetchJob({ provider: "GREENHOUSE", slug: "stripe", jobId: "1" }, { fetchImpl, throttle, retries: 0 })).toBeNull();
    expect(fetchImpl.mock.calls[0]?.[0]).toBe("https://boards-api.greenhouse.io/v1/boards/stripe/jobs/1");
  });

  it("parses board URLs", () => {
    expect(greenhouseAdapter.parseBoardUrl(new URL("https://boards.greenhouse.io/Stripe"))).toBe("stripe");
    expect(greenhouseAdapter.parseBoardUrl(new URL("https://job-boards.greenhouse.io/stripe/jobs/1"))).toBe("stripe");
    expect(greenhouseAdapter.parseBoardUrl(new URL("https://boards.greenhouse.io/embed/job_board?for=acme"))).toBe("acme");
    expect(greenhouseAdapter.parseBoardUrl(new URL("https://jobs.lever.co/x"))).toBeNull();
  });
});

describe("lever adapter", () => {
  it("lists with mode=json and paging, maps workplaceType incl. the live 'onsite' spelling", async () => {
    const fetchImpl = fetchReturning(200, fixture("lever-list.json"));
    const board = await leverAdapter.fetchBoard("leverdemo", { fetchImpl, throttle });
    expect(fetchImpl.mock.calls[0]?.[0]).toBe("https://api.lever.co/v0/postings/leverdemo?mode=json&skip=0&limit=100");
    expect(fetchImpl).toHaveBeenCalledTimes(1); // fewer than a full page -> stop
    expect(board.companyName).toBeNull(); // Lever doesn't return one
    expect(board.jobs.map((j) => j.remoteType)).toEqual(["HYBRID", "ONSITE", "ONSITE"]);
    expect(board.jobs[0]).toMatchObject({
      jobId: "ad208490-4052-4f91-a57e-433f2d1e484b",
      title: "Customer Success Manager",
      location: "Atlanta, Georgia",
      canonicalUrl: "https://jobs.lever.co/leverdemo/ad208490-4052-4f91-a57e-433f2d1e484b",
      applyUrl: "https://jobs.lever.co/leverdemo/ad208490-4052-4f91-a57e-433f2d1e484b/apply",
    });
    expect(board.jobs[0]?.postedAt).toBeInstanceOf(Date);
  });

  it("pages until a short page", async () => {
    const one = JSON.parse(fixture("lever-list.json"))[0];
    const full = JSON.stringify(Array.from({ length: 100 }, (_, i) => ({ ...one, id: `ad208490-4052-4f91-a57e-${String(i).padStart(12, "0")}` })));
    const fetchImpl = vi.fn().mockResolvedValueOnce(new Response(full)).mockResolvedValueOnce(new Response("[]"));
    const board = await leverAdapter.fetchBoard("x", { fetchImpl, throttle });
    expect(board.jobs).toHaveLength(100);
    expect(fetchImpl.mock.calls[1]?.[0]).toContain("skip=100");
  });

  it("fetchJob returns null on 404", async () => {
    const fetchImpl = fetchReturning(404, '{"ok":false,"error":"Document not found"}');
    expect(await leverAdapter.fetchJob({ provider: "LEVER", slug: "x", jobId: "ad208490-4052-4f91-a57e-433f2d1e484b" }, { fetchImpl, throttle, retries: 0 })).toBeNull();
  });
});

describe("ashby adapter", () => {
  beforeEach(() => clearAshbyCache());

  it("reads the posting API, lowercases the board slug, drops unlisted jobs", async () => {
    const fetchImpl = fetchReturning(200, fixture("ashby-board.json"));
    const board = await ashbyAdapter.fetchBoard("Ashby", { fetchImpl, throttle });
    expect(fetchImpl.mock.calls[0]?.[0]).toBe("https://api.ashbyhq.com/posting-api/job-board/ashby");
    expect(board.jobs).toHaveLength(3); // the isListed:false job is excluded
    expect(board.jobs[0]).toMatchObject({
      slug: "ashby",
      jobId: "7458d4e9-da2e-47bd-98cb-adfda43d42b2",
      location: "Remote - European Union",
      remoteType: "REMOTE",
      canonicalUrl: "https://jobs.ashbyhq.com/ashby/7458d4e9-da2e-47bd-98cb-adfda43d42b2",
    });
    expect(board.jobs[0]?.allLocations.length).toBeGreaterThan(1);
  });

  it("fetchJob reads the (cached) board since there is no single-job endpoint", async () => {
    const fetchImpl = fetchReturning(200, fixture("ashby-board.json"));
    const ref = { provider: "ASHBY" as const, slug: "Ashby", jobId: "f40ef345-82a8-4956-9150-193b4fdf8183" };
    expect((await ashbyAdapter.fetchJob(ref, { fetchImpl, throttle }))?.title).toBe("Senior Product Designer");
    expect(await ashbyAdapter.fetchJob({ ...ref, jobId: "11111111-1111-4111-8111-111111111111" }, { fetchImpl, throttle })).toBeNull();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("treats the plain-text 404 as a missing board", async () => {
    const fetchImpl = fetchReturning(404, "Not Found");
    expect(await ashbyAdapter.fetchJob({ provider: "ASHBY", slug: "nope", jobId: "x" }, { fetchImpl, throttle, retries: 0 })).toBeNull();
  });
});

describe("parseBoardInput", () => {
  it("accepts board URLs for any provider", () => {
    expect(parseBoardInput("https://boards.greenhouse.io/stripe", null)).toEqual({ provider: "GREENHOUSE", slug: "stripe" });
    expect(parseBoardInput("jobs.lever.co/leverdemo", null)).toEqual({ provider: "LEVER", slug: "leverdemo" });
    expect(parseBoardInput("https://jobs.ashbyhq.com/Ashby", null)).toEqual({ provider: "ASHBY", slug: "ashby" });
  });
  it("accepts a bare slug only with a provider", () => {
    expect(parseBoardInput("Stripe", "GREENHOUSE")).toEqual({ provider: "GREENHOUSE", slug: "stripe" });
    expect(parseBoardInput("stripe", null)).toBeNull();
    expect(parseBoardInput("bad slug!", "LEVER")).toBeNull();
  });
});
