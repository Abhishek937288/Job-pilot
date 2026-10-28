import type { ProfileData } from "@jobpilot/shared";
import { describe, expect, it } from "vitest";
import { candidateFromHit, companyFromHost, parseResultTitle } from "../src/search/candidate.js";
import { matchLocation, toSerperLocation } from "../src/search/location.js";
import { ATS_SITE_GROUP, dedupeQueries, fallbackQueries, normalizeSiteGroup, sanitizeLocation } from "../src/search/queries.js";
import { titleMatchesTargets } from "../src/search/title-match.js";

const prefs = ["Mumbai", "Navi Mumbai"];

describe("matchLocation (flag, never drop)", () => {
  it("matches preferred cities including aliases", () => {
    expect(matchLocation(["Mumbai, Maharashtra, India"], "UNKNOWN", prefs)).toBe("MATCH");
    expect(matchLocation(["Bombay"], "ONSITE", prefs)).toBe("MATCH");
    expect(matchLocation(["Navi Mumbai"], "ONSITE", prefs)).toBe("MATCH");
  });
  it("flags other cities as MISMATCH", () => {
    expect(matchLocation(["Pune"], "ONSITE", prefs)).toBe("MISMATCH");
    expect(matchLocation(["Dublin"], "UNKNOWN", prefs)).toBe("MISMATCH");
  });
  it("remote jobs are REMOTE unless they also list a preferred city", () => {
    expect(matchLocation(["Remote - India"], "UNKNOWN", prefs)).toBe("REMOTE");
    expect(matchLocation(["Pune"], "REMOTE", prefs)).toBe("REMOTE");
    expect(matchLocation(["Remote", "Mumbai"], "REMOTE", prefs)).toBe("MATCH");
  });
  it("remote roles limited to another country are MISMATCH (seen live on Stripe's board)", () => {
    expect(matchLocation(["US-Remote, Chicago, Seattle"], "UNKNOWN", prefs)).toBe("MISMATCH");
    expect(matchLocation(["Toronto Canada, Remote in US, Remote in Canada"], "UNKNOWN", prefs)).toBe("MISMATCH");
    expect(matchLocation(["Remote - European Union"], "REMOTE", prefs)).toBe("MISMATCH");
    expect(matchLocation(["Remote - APAC"], "REMOTE", prefs)).toBe("REMOTE");
    expect(matchLocation(["Remote (US or India)"], "REMOTE", prefs)).toBe("REMOTE");
  });
  it("placeholder locations are UNKNOWN, never a match (seen live: 'N/A', 'na')", () => {
    expect(matchLocation(["N/A"], "UNKNOWN", prefs)).toBe("UNKNOWN");
    expect(matchLocation(["na"], "UNKNOWN", prefs)).toBe("UNKNOWN");
    expect(matchLocation(["TBD"], "UNKNOWN", prefs)).toBe("UNKNOWN");
    expect(matchLocation(["A"], "UNKNOWN", prefs)).toBe("UNKNOWN");
  });
  it("UNKNOWN when there is no usable location", () => {
    expect(matchLocation([null], "UNKNOWN", prefs)).toBe("UNKNOWN");
    expect(matchLocation(["India"], "UNKNOWN", prefs)).toBe("UNKNOWN");
    expect(matchLocation(["US"], "UNKNOWN", prefs)).toBe("MISMATCH");
    expect(matchLocation(["EMEA"], "UNKNOWN", prefs)).toBe("MISMATCH");
  });
  it("any of several job locations can match", () => {
    expect(matchLocation(["Bangalore", "Mumbai"], "UNKNOWN", prefs)).toBe("MATCH");
  });
});

describe("toSerperLocation", () => {
  it("maps known cities to Google location names", () => {
    expect(toSerperLocation("Mumbai")).toBe("Mumbai, Maharashtra, India");
    expect(toSerperLocation("Navi Mumbai")).toBe("Navi Mumbai, Maharashtra, India");
    expect(toSerperLocation("Bengaluru")).toBe("Bengaluru, Karnataka, India");
    expect(toSerperLocation("Remote")).toBeNull();
    expect(toSerperLocation("Nashik")).toBe("Nashik, India");
  });
});

describe("titleMatchesTargets (ATS board relevance)", () => {
  const targets = ["Backend Developer", "Next.js Developer", "MERN Stack Developer", "Software Developer"];
  it.each([
    ["Software Engineer, Backend", true],
    ["Senior Backend Engineer", true],
    ["Full Stack Developer (MERN)", true],
    ["Frontend Engineer - Next.js", true],
    ["Software Engineer II", true],
    ["Account Executive", false],
    ["Backend Product Manager", false],
    ["Abuse Investigator", false],
  ])("%s -> %s", (title, expected) => {
    expect(titleMatchesTargets(title, targets)).toBe(expected);
  });
});

describe("queries", () => {
  it("dedupes case- and whitespace-insensitively on (query, location)", () => {
    const { queries, removed } = dedupeQueries([
      { q: '"Backend Developer" Mumbai', location: "Mumbai, Maharashtra, India" },
      { q: '"backend developer"   mumbai ', location: "mumbai, maharashtra, india" },
      { q: '"backend developer" mumbai', location: null },
    ]);
    expect(removed).toBe(1);
    expect(queries).toHaveLength(2);
  });

  it("repairs a garbled ATS site group from the LLM", () => {
    const garbled = '"Next.js developer" Mumbai (site:job-boards.greenhouse.io OR site:boards.greenhouse.co OR site:jobs.lever.co)';
    expect(normalizeSiteGroup(garbled)).toBe(`"Next.js developer" Mumbai ${ATS_SITE_GROUP}`);
    expect(normalizeSiteGroup(`x ${ATS_SITE_GROUP}`)).toBe(`x ${ATS_SITE_GROUP}`);
    expect(normalizeSiteGroup('"dev" careers -site:linkedin.com')).toBe('"dev" careers -site:linkedin.com');
  });

  it("sanitizes LLM locations to allowed Serper names", () => {
    const opts = [{ preferred: "Mumbai", serper: "Mumbai, Maharashtra, India" }];
    expect(sanitizeLocation("mumbai, maharashtra, india", opts)).toBe("Mumbai, Maharashtra, India");
    expect(sanitizeLocation("Bombay", opts)).toBe("Mumbai, Maharashtra, India");
    expect(sanitizeLocation(null, opts)).toBeNull();
  });

  it("fallback queries respect the cap and include the ATS site group", () => {
    const profile = {
      targetTitles: ["Backend Developer", "Software Developer"],
      preferredLocations: ["Mumbai", "Navi Mumbai"],
      remotePreference: "ANY",
    } as ProfileData;
    const qs = fallbackQueries(profile, 5);
    expect(qs).toHaveLength(5);
    expect(qs[0]?.q).toContain(ATS_SITE_GROUP);
    expect(qs[0]?.location).toBe("Mumbai, Maharashtra, India");
  });
});

describe("search result parsing (Phase 2 stores only what the result contains)", () => {
  it("parses common ATS result titles", () => {
    expect(parseResultTitle("Job Application for Backend Engineer at Acme", null)).toEqual({ title: "Backend Engineer", company: "Acme" });
    expect(parseResultTitle("Backend Engineer @ Acme", null)).toEqual({ title: "Backend Engineer", company: "Acme" });
    expect(parseResultTitle("Acme - Backend Engineer", "Acme")).toEqual({ title: "Backend Engineer", company: "Acme" });
    expect(parseResultTitle("Backend Engineer | Acme Careers", null)).toEqual({ title: "Backend Engineer", company: "Acme" });
  });

  it("builds a candidate from a Lever hit", () => {
    const c = candidateFromHit(
      { title: "Leverdemo - Backend Engineer", url: "https://jobs.lever.co/leverdemo/AD208490-4052-4f91-a57e-433f2d1e484b/apply?lever-source=x", snippet: "Build APIs", date: null, position: 1 },
      "q",
    );
    expect(c).toMatchObject({
      canonicalUrl: "https://jobs.lever.co/leverdemo/ad208490-4052-4f91-a57e-433f2d1e484b",
      company: "Leverdemo",
      title: "Backend Engineer",
      applyMethod: "LEVER",
      source: "SERPER",
      location: null,
      snippet: "Build APIs",
    });
  });

  it("derives company from careers hosts", () => {
    expect(companyFromHost("https://careers.acme.co.in/jobs/1")).toBe("Acme");
    expect(companyFromHost("https://jobs.globex.com/x")).toBe("Globex");
  });
});
