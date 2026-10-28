import { describe, expect, it } from "vitest";
import { canonicalizeUrl, isBlockedDomain, parseAtsJobUrl } from "../src/search/url-canonical.js";

describe("canonicalizeUrl: general rules", () => {
  it.each([
    ["lowercases host and drops www", "https://WWW.Example.COM/Careers/Job-1", "https://example.com/Careers/Job-1"],
    ["strips utm_* params", "https://example.com/jobs/1?utm_source=google&utm_medium=cpc&utm_campaign=x", "https://example.com/jobs/1"],
    ["strips gh_src, ref, source", "https://example.com/jobs/1?gh_src=abc&ref=hn&source=linkedin", "https://example.com/jobs/1"],
    ["keeps meaningful params, sorted", "https://example.com/jobs?id=7&b=2&utm_term=x&a=1", "https://example.com/jobs?a=1&b=2&id=7"],
    ["keeps gh_jid (job id on custom domains)", "https://stripe.com/jobs/search?gh_jid=8172508&gh_src=x", "https://stripe.com/jobs/search?gh_jid=8172508"],
    ["drops fragment", "https://example.com/jobs/1#apply", "https://example.com/jobs/1"],
    ["drops trailing slashes", "https://example.com/jobs/1///", "https://example.com/jobs/1"],
    ["root with and without slash match", "https://example.com/", "https://example.com"],
    ["upgrades http and drops default port", "http://example.com:80/jobs/1", "https://example.com/jobs/1"],
    ["collapses duplicate slashes", "https://example.com//jobs//1", "https://example.com/jobs/1"],
  ])("%s", (_name, input, expected) => {
    expect(canonicalizeUrl(input)).toBe(expected);
  });

  it("rejects non-http URLs and garbage", () => {
    expect(canonicalizeUrl("mailto:jobs@example.com")).toBeNull();
    expect(canonicalizeUrl("javascript:alert(1)")).toBeNull();
    expect(canonicalizeUrl("not a url")).toBeNull();
  });
});

describe("canonicalizeUrl: ATS patterns map to one form", () => {
  const gh = "https://job-boards.greenhouse.io/stripe/jobs/8172508";
  it.each([
    "https://boards.greenhouse.io/stripe/jobs/8172508",
    "https://boards.greenhouse.io/Stripe/jobs/8172508?gh_src=abc&utm_source=x",
    "http://job-boards.greenhouse.io/stripe/jobs/8172508/",
    "https://boards.greenhouse.io/embed/job_app?for=stripe&token=8172508",
    "https://job-boards.greenhouse.io/stripe/jobs/8172508#app",
  ])("Greenhouse %s", (input) => {
    expect(canonicalizeUrl(input)).toBe(gh);
  });

  const lever = "https://jobs.lever.co/leverdemo/ad208490-4052-4f91-a57e-433f2d1e484b";
  it.each([
    "https://jobs.lever.co/leverdemo/ad208490-4052-4f91-a57e-433f2d1e484b/apply",
    "https://jobs.lever.co/LeverDemo/AD208490-4052-4F91-A57E-433F2D1E484B?lever-source=linkedin",
    "https://jobs.lever.co/leverdemo/ad208490-4052-4f91-a57e-433f2d1e484b/",
  ])("Lever %s", (input) => {
    expect(canonicalizeUrl(input)).toBe(lever);
  });

  const ashby = "https://jobs.ashbyhq.com/ashby/7458d4e9-da2e-47bd-98cb-adfda43d42b2";
  it.each([
    "https://jobs.ashbyhq.com/Ashby/7458d4e9-da2e-47bd-98cb-adfda43d42b2/application",
    "https://jobs.ashbyhq.com/Ashby/7458d4e9-da2e-47bd-98cb-adfda43d42b2?utm_source=x&src=careers",
    "https://jobs.ashbyhq.com/ASHBY/7458D4E9-DA2E-47BD-98CB-ADFDA43D42B2",
  ])("Ashby %s", (input) => {
    expect(canonicalizeUrl(input)).toBe(ashby);
  });

  it("does not treat ATS board index pages as job URLs", () => {
    expect(parseAtsJobUrl("https://jobs.lever.co/leverdemo")).toBeNull();
    expect(parseAtsJobUrl("https://boards.greenhouse.io/stripe")).toBeNull();
    expect(parseAtsJobUrl("https://jobs.ashbyhq.com/Ashby")).toBeNull();
    expect(parseAtsJobUrl("https://jobs.lever.co/leverdemo/not-a-uuid")).toBeNull();
  });

  it("leaves EU instances (unverified API hosts) as plain URLs", () => {
    expect(parseAtsJobUrl("https://jobs.eu.lever.co/acme/ad208490-4052-4f91-a57e-433f2d1e484b")).toBeNull();
    expect(canonicalizeUrl("https://jobs.eu.lever.co/acme/ad208490-4052-4f91-a57e-433f2d1e484b/?utm_source=x")).toBe(
      "https://jobs.eu.lever.co/acme/ad208490-4052-4f91-a57e-433f2d1e484b",
    );
  });
});

describe("isBlockedDomain", () => {
  it("blocks LinkedIn, Naukri and Indeed including subdomains", () => {
    expect(isBlockedDomain("https://www.linkedin.com/jobs/view/123")).toBe(true);
    expect(isBlockedDomain("https://in.linkedin.com/jobs/view/123")).toBe(true);
    expect(isBlockedDomain("https://www.naukri.com/job-listings-x")).toBe(true);
    expect(isBlockedDomain("https://in.indeed.com/viewjob?jk=1")).toBe(true);
    expect(isBlockedDomain("https://notlinkedin.com/jobs")).toBe(false);
    expect(isBlockedDomain("https://jobs.lever.co/acme/x")).toBe(false);
  });
});
