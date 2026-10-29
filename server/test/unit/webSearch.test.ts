import { describe, expect, it } from "vitest";
import type { Response as OpenAIResponse } from "openai/resources/responses/responses";
import { HostThrottle, type FetchLike } from "../../src/lib/http.js";
import { citedUrls, pageContainsTitle, verifyCandidate } from "../../src/sources/webSearch.js";

const throttle = new HostThrottle(0);
const page = (title: string) => `<html><head><title>${title} - Acme</title></head><body><h1>${title}</h1><p>Apply now</p></body></html>`;

function site(pages: Record<string, { status: number; body?: string; location?: string }>, robots = "User-agent: *\nDisallow: /private\n"): FetchLike {
  return async (url) => {
    if (url.endsWith("/robots.txt")) return new Response(robots, { status: 200 });
    const p = pages[url];
    if (!p) return new Response("nope", { status: 404 });
    return new Response(p.body ?? "", { status: p.status, headers: p.location ? { location: p.location } : {} });
  };
}

describe("citedUrls", () => {
  it("collects url_citation annotations and web_search_call sources", () => {
    const response = {
      output: [
        { type: "web_search_call", action: { type: "search", sources: [{ type: "url", url: "https://jobs.lever.co/acme/1?utm_source=openai" }] } },
        { type: "message", content: [{ type: "output_text", text: "{}", annotations: [{ type: "url_citation", url: "https://boards.greenhouse.io/acme/jobs/2" }] }] },
      ],
    } as unknown as OpenAIResponse;
    expect([...citedUrls(response)].sort()).toEqual(["https://boards.greenhouse.io/acme/jobs/2", "https://jobs.lever.co/acme/1"]);
  });
});

describe("verifyCandidate", () => {
  const cited = new Set(["https://jobs.lever.co/acme/1", "https://jobs.lever.co/acme/gone", "https://jobs.lever.co/acme/moved", "https://jobs.lever.co/private/1"]);
  const fetchImpl = site({
    "https://jobs.lever.co/acme/1": { status: 200, body: page("Backend Engineer") },
    "https://jobs.lever.co/acme/gone": { status: 404 },
    "https://jobs.lever.co/acme/moved": { status: 301, location: "/acme/1" },
    "https://jobs.lever.co/private/1": { status: 200, body: page("Backend Engineer") },
  });
  const cand = (url: string, title = "Backend Engineer") => ({ title, company: "Acme", location: "Pune", url });

  it("accepts a cited URL that returns 200 and contains the title", async () => {
    const r = await verifyCandidate(cand("https://jobs.lever.co/acme/1"), cited, { fetchImpl, throttle });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.job).toMatchObject({ source: "web_search", title: "Backend Engineer", company: "Acme" });
  });

  it("rejects URLs that are not in the citations (invented)", async () => {
    expect(await verifyCandidate(cand("https://jobs.lever.co/acme/999"), cited, { fetchImpl, throttle })).toEqual({ ok: false, reason: "not_cited" });
  });

  it("rejects closed postings (non-200)", async () => {
    expect(await verifyCandidate(cand("https://jobs.lever.co/acme/gone"), cited, { fetchImpl, throttle })).toEqual({ ok: false, reason: "fetch_failed" });
  });

  it("rejects pages that don't contain the title", async () => {
    expect(await verifyCandidate(cand("https://jobs.lever.co/acme/1", "Chief Banana Officer"), cited, { fetchImpl, throttle })).toEqual({ ok: false, reason: "title_missing" });
  });

  it("follows redirects and respects robots.txt", async () => {
    expect((await verifyCandidate(cand("https://jobs.lever.co/acme/moved"), cited, { fetchImpl, throttle })).ok).toBe(true);
    expect(await verifyCandidate(cand("https://jobs.lever.co/private/1"), cited, { fetchImpl, throttle })).toEqual({ ok: false, reason: "fetch_failed" });
  });
});

describe("pageContainsTitle", () => {
  it("matches the whole normalized title only", () => {
    expect(pageContainsTitle(page("Sr. Backend Engineer (Node.js)"), "sr backend engineer node.js")).toBe(true);
    expect(pageContainsTitle(page("Backend Engineering Manager"), "Backend Engineer")).toBe(false);
  });
});
