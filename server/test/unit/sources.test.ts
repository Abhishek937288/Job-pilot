import { describe, expect, it, vi } from "vitest";
import { HostThrottle, type FetchLike } from "../../src/lib/http.js";
import { detectAts } from "../../src/sources/ats/index.js";
import { greenhouseAdapter } from "../../src/sources/ats/greenhouse.js";
import { leverAdapter } from "../../src/sources/ats/lever.js";
import { workableAdapter } from "../../src/sources/ats/workable.js";
import { smartRecruitersAdapter } from "../../src/sources/ats/smartrecruiters.js";
import { extractJobPostings, jobFromPosting } from "../../src/sources/ats/jsonld.js";
import { normalizeJSearchJob } from "../../src/sources/jsearch.js";
import { titleRelevance } from "../../src/sources/watchlist.js";

const throttle = new HostThrottle(0);
const jsonFetch = (routes: Record<string, unknown>): FetchLike => async (url) => {
  const key = Object.keys(routes).find((k) => url.startsWith(k));
  return key ? new Response(JSON.stringify(routes[key]), { status: 200 }) : new Response("Not Found", { status: 404 });
};

describe("detectAts", () => {
  it.each([
    ["https://boards.greenhouse.io/Stripe", "greenhouse", "stripe"],
    ["https://job-boards.greenhouse.io/anthropic/jobs/123", "greenhouse", "anthropic"],
    ["https://boards.greenhouse.io/embed/job_board?for=acme", "greenhouse", "acme"],
    ["https://jobs.lever.co/spotify/abc-def", "lever", "spotify"],
    ["https://jobs.ashbyhq.com/OpenAI", "ashby", "openai"],
    ["https://apply.workable.com/blueground/j/ABC123/", "workable", "blueground"],
    ["https://acme.workable.com/", "workable", "acme"],
    ["https://jobs.smartrecruiters.com/BoschGroup/744000158469290", "smartrecruiters", "BoschGroup"],
  ])("%s", (url, atsType, atsToken) => expect(detectAts(url)).toEqual({ atsType, atsToken }));

  it("returns null for other sites", () => {
    expect(detectAts("https://stripe.com/jobs")).toBeNull();
    expect(detectAts("not a url")).toBeNull();
  });
});

describe("ATS adapters (recorded response shapes)", () => {
  it("greenhouse: company name from the API, HTML description to text, posted date", async () => {
    const fetchImpl = jsonFetch({
      "https://boards-api.greenhouse.io/v1/boards/acme/jobs": {
        jobs: [{ id: 7, title: "Data Engineer", absolute_url: "https://acme.com/careers?gh_jid=7", first_published: "2026-10-01T00:00:00Z", company_name: "Acme", location: { name: "Remote - India" }, content: "&lt;p&gt;Spark &amp;amp; SQL&lt;/p&gt;" }],
      },
    });
    const board = await greenhouseAdapter.fetchBoard("acme", "fallback", { fetchImpl, throttle });
    expect(board.companyName).toBe("Acme");
    const j = board.jobs[0]!;
    expect(j).toMatchObject({ jobKey: "greenhouse:acme:7", company: "Acme", remote: "remote", description: "Spark & SQL" });
    expect(j.applyLinks[0]).toEqual({ url: "https://acme.com/careers?gh_jid=7", source: "greenhouse", isDirect: true });
  });

  it("lever: paginates and maps workplaceType", async () => {
    const page = (n: number, offset: number) => Array.from({ length: n }, (_, i) => ({ id: `ID${offset + i}`, text: `Role ${offset + i}`, hostedUrl: `https://jobs.lever.co/acme/${offset + i}`, workplaceType: "onsite", categories: { location: "Pune" } }));
    const calls: string[] = [];
    const fetchImpl: FetchLike = async (url) => {
      calls.push(url);
      return new Response(JSON.stringify(url.includes("skip=0") ? page(100, 0) : page(3, 100)));
    };
    const board = await leverAdapter.fetchBoard("acme", "Acme", { fetchImpl, throttle });
    expect(calls).toHaveLength(2);
    expect(board.jobs).toHaveLength(103);
    expect(board.jobs[0]).toMatchObject({ jobKey: "lever:acme:id0", remote: "onsite", company: "Acme", city: "Pune" });
  });

  it("workable: posts the search body and builds apply links", async () => {
    let body = "";
    const fetchImpl: FetchLike = async (_url, init) => {
      body = String(init?.body);
      return new Response(JSON.stringify({ results: [{ shortcode: "AB12", title: "iOS Engineer", workplace: "remote", location: { city: null, country: "Brazil", display: "Brazil" }, published: "2026-10-13T00:00:00.000Z", state: "published" }], total: 1 }));
    };
    const board = await workableAdapter.fetchBoard("blueground", "Blueground", { fetchImpl, throttle });
    expect(JSON.parse(body)).toMatchObject({ query: "" });
    expect(board.jobs[0]).toMatchObject({ jobKey: "workable:blueground:ab12", remote: "remote", country: "Brazil" });
    expect(board.jobs[0]!.applyLinks[0]!.url).toBe("https://apply.workable.com/blueground/j/AB12/");
  });

  it("smartrecruiters: company name and hybrid flag", async () => {
    const fetchImpl = jsonFetch({
      "https://api.smartrecruiters.com/v1/companies/Acme/postings": { totalFound: 1, content: [{ id: "99", name: "QA Lead", releasedDate: "2026-10-20T00:00:00Z", company: { name: "Acme Corp" }, location: { city: "Paris", country: "fr", hybrid: true, fullLocation: "Paris, , France" } }] },
    });
    const board = await smartRecruitersAdapter.fetchBoard("Acme", "x", { fetchImpl, throttle });
    expect(board.jobs[0]).toMatchObject({ company: "Acme Corp", remote: "hybrid", country: "FR", location: "Paris, France" });
  });
});

describe("JSON-LD", () => {
  const html = `<html><head>
<script type="application/ld+json">{"@context":"https://schema.org","@graph":[{"@type":"Organization","name":"Acme"},
 {"@type":"JobPosting","title":"Platform Engineer","datePosted":"2026-10-10","validThrough":"2099-01-01",
  "hiringOrganization":{"@type":"Organization","name":"Acme"},"jobLocationType":"TELECOMMUTE",
  "identifier":{"@type":"PropertyValue","value":"PE-1"},"url":"/jobs/pe-1",
  "baseSalary":{"@type":"MonetaryAmount","currency":"EUR","value":{"@type":"QuantitativeValue","minValue":60000,"maxValue":80000,"unitText":"YEAR"}},
  "description":"<p>Kubernetes &amp; Go</p>"}]}</script>
<script type="application/ld+json">{ broken json </script>
<script type="application/ld+json">{"@type":"JobPosting","title":"Old Job","validThrough":"2020-01-01"}</script>
</head></html>`;

  it("finds postings inside @graph, skips broken blocks, drops expired postings", () => {
    const posts = extractJobPostings(html);
    expect(posts).toHaveLength(2);
    const jobs = posts.map((p) => jobFromPosting(p, "https://acme.com/careers", "Fallback"));
    expect(jobs[1]).toBeNull();
    expect(jobs[0]).toMatchObject({
      title: "Platform Engineer",
      company: "Acme",
      remote: "remote",
      jobKey: "jsonld:acme.com:PE-1",
      salary: { min: 60000, max: 80000, currency: "EUR", period: "year" },
      description: "Kubernetes & Go",
    });
    expect(jobs[0]!.applyLinks[0]!.url).toBe("https://acme.com/jobs/pe-1");
  });
});

describe("JSearch normalization", () => {
  it("maps fields, keeps every apply option and marks direct links", () => {
    const j = normalizeJSearchJob({
      job_id: "abc==",
      job_title: "SDE II",
      employer_name: "Acme",
      job_publisher: "LinkedIn",
      job_apply_link: "https://linkedin.com/jobs/1",
      job_apply_is_direct: false,
      apply_options: [{ publisher: "Acme Careers", apply_link: "https://acme.com/jobs/1", is_direct: true }],
      job_is_remote: false,
      job_city: "Pune",
      job_state: "MH",
      job_country: "IN",
      job_min_salary: 100,
      job_max_salary: 200,
      job_salary_period: "MONTH",
      job_posted_at_datetime_utc: "2026-10-20T00:00:00.000Z",
      job_required_experience: { required_experience_in_months: 36 },
    });
    expect(j).toMatchObject({ jobKey: "jsearch:abc==", city: "Pune", location: "Pune, MH, IN", requiredExperienceMonths: 36, salary: { period: "month" } });
    expect(j.applyLinks.map((l) => l.isDirect)).toEqual([false, true]);
  });
});

describe("watchlist title relevance", () => {
  it("ignores seniority words and requires most query words", () => {
    expect(titleRelevance("Senior Backend Engineer, Payments", "Backend Engineer")).toBe(1);
    expect(titleRelevance("Frontend Engineer", "Backend Engineer")).toBe(0.5);
    expect(titleRelevance("Anything", "Senior")).toBe(0);
  });
});

describe("JSearchSource response shapes", () => {
  it("reads jobs from /search-v2 (data.jobs) and the older /search (data array)", async () => {
    const { env } = await import("../../src/config/env.js");
    const { JSearchSource } = await import("../../src/sources/jsearch.js");
    const { Meter } = await import("../../src/llm/meter.js");
    const { preferencesSchema } = await import("@jobpilot/shared");
    (env as { JSEARCH_API_KEY?: string }).JSEARCH_API_KEY = "test-key";
    env.JSEARCH_CACHE_HOURS = 0; // never touch Redis here
    const one = { job_id: "a1", job_title: "Backend Developer", employer_name: "Acme", job_city: "Pune" };
    const ctx = { queries: [{ query: "Backend Developer", location: "Pune", remoteOnly: false }], preferences: preferencesSchema.parse({ desiredRole: "Dev" }), desiredRole: "Dev", meter: new Meter() };
    const cacheless = (data: unknown) => {
      const urls: string[] = [];
      const src = new JSearchSource({ throttle, fetchImpl: async (url) => (urls.push(url), new Response(JSON.stringify({ status: "OK", data }))) });
      return { src, urls };
    };
    vi.spyOn(await import("../../src/lib/redis.js"), "cacheGet").mockResolvedValue(null);
    const v2 = cacheless({ jobs: [one], cursor: "x" });
    expect((await v2.src.fetch(ctx)).map((j) => j.jobKey)).toEqual(["jsearch:a1"]);
    expect(v2.urls[0]).toContain("/search-v2?");
    const v1 = cacheless([one]);
    expect(await v1.src.fetch(ctx)).toHaveLength(1);
  });
});
