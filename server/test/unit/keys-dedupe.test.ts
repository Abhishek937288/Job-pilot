import { describe, expect, it } from "vitest";
import { buildJob } from "../../src/jobs/build.js";
import { canonicalUrl, dedupeJobs } from "../../src/jobs/dedupe.js";
import { fingerprintOf, jobKeyOf } from "../../src/jobs/keys.js";

describe("jobKey", () => {
  it("uses the source job id when there is one", () => {
    expect(jobKeyOf("jsearch", "abc123", "Dev", "Acme", "Pune")).toBe("jsearch:abc123");
  });

  it("falls back to a SHA-1 of normalized title|company|city", () => {
    const a = jobKeyOf("web_search", null, "Senior  Engineer!", "Acme Inc.", "Pune");
    const b = jobKeyOf("web_search", null, "senior engineer", "ACME", "pune");
    expect(a).toBe(b);
    expect(a).toMatch(/^fp:[0-9a-f]{40}$/);
  });

  it("fingerprints ignore company suffixes and punctuation", () => {
    expect(fingerprintOf("Backend Engineer", "Foo Technologies Pvt. Ltd.", "Bengaluru")).toBe(fingerprintOf("backend engineer", "foo", "bengaluru"));
  });
});

describe("dedupeJobs", () => {
  const gh = buildJob({
    source: "greenhouse",
    sourceJobId: "acme:1",
    title: "Backend Engineer",
    company: "Acme",
    location: "Pune, India",
    description: "short",
    applyLinks: [{ url: "https://boards.greenhouse.io/acme/jobs/1", source: "greenhouse", isDirect: true }],
  });
  const js = buildJob({
    source: "jsearch",
    sourceJobId: "zzz",
    title: "Backend Engineer",
    company: "Acme Inc",
    location: "Pune, Maharashtra, India",
    salary: { min: 1, max: 2, currency: "INR", period: "year" },
    description: "a much longer description of the job",
    applyLinks: [
      { url: "https://www.linkedin.com/jobs/view/1?utm_source=x", source: "LinkedIn", isDirect: false },
      { url: "https://boards.greenhouse.io/acme/jobs/1/", source: "Acme", isDirect: true },
    ],
  });

  it("merges the same job from different sources by fingerprint and keeps all apply links", () => {
    const out = dedupeJobs([js, gh]);
    expect(out).toHaveLength(1);
    const job = out[0]!;
    expect(job.source).toBe("greenhouse"); // the company board wins for the main record
    expect(job.jobKey).toBe("greenhouse:acme:1");
    expect(job.sources.sort()).toEqual(["greenhouse", "jsearch"]);
    expect(job.salary?.currency).toBe("INR");
    expect(job.description).toBe("a much longer description of the job");
    expect(job.applyLinks.map((l) => l.url)).toEqual(["https://boards.greenhouse.io/acme/jobs/1", "https://www.linkedin.com/jobs/view/1?utm_source=x"]);
    expect(job.applyLinks[0]!.isDirect).toBe(true);
  });

  it("merges duplicates with the same jobKey", () => {
    expect(dedupeJobs([gh, { ...gh }])).toHaveLength(1);
  });

  it("canonicalUrl drops tracking params, hash and trailing slash", () => {
    expect(canonicalUrl("https://Jobs.Lever.co/acme/1/?utm_medium=x&lever-source=y#apply")).toBe("https://jobs.lever.co/acme/1?lever-source=y");
  });
});
