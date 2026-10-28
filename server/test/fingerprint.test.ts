import { describe, expect, it } from "vitest";
import { jobFingerprint, type FingerprintInput } from "../src/search/fingerprint.js";
import { locationKey } from "../src/search/location.js";
import { normalizeCompany, normalizeTitle } from "../src/search/normalize.js";

const base: FingerprintInput = {
  company: "Acme",
  title: "Backend Developer",
  location: "Mumbai",
  remoteType: "UNKNOWN",
  canonicalUrl: "https://jobs.lever.co/acme/11111111-1111-1111-1111-111111111111",
};
const fp = (o: Partial<FingerprintInput>) => jobFingerprint({ ...base, ...o });

describe("jobFingerprint", () => {
  it("is the same for the same posting under a different URL", () => {
    expect(fp({ canonicalUrl: "https://acme.com/careers/backend-developer" })).toBe(fp({}));
  });

  it("ignores case, punctuation, legal suffixes and common abbreviations", () => {
    const a = fp({ company: "ACME Pvt. Ltd.", title: "Sr. Back-End Developer", location: "Mumbai, Maharashtra, India" });
    const b = fp({ company: "acme", title: "Senior Backend Developer", location: "mumbai" });
    expect(a).toBe(b);
  });

  it("treats city aliases as the same city", () => {
    expect(fp({ location: "Bengaluru, Karnataka" })).toBe(fp({ location: "Bangalore" }));
    expect(fp({ location: "Bombay" })).toBe(fp({ location: "Mumbai, India" }));
  });

  it("does NOT merge the same company + title in two different cities", () => {
    expect(fp({ location: "Mumbai" })).not.toBe(fp({ location: "Pune" }));
    expect(fp({ location: "Mumbai" })).not.toBe(fp({ location: "Navi Mumbai" }));
  });

  it("distinguishes different titles and companies", () => {
    expect(fp({ title: "Frontend Developer" })).not.toBe(fp({}));
    expect(fp({ company: "Globex" })).not.toBe(fp({}));
  });

  it("scopes the fingerprint to the URL when the location is unknown (never merges on title alone)", () => {
    const a = fp({ location: null, canonicalUrl: "https://a.com/jobs/1" });
    const b = fp({ location: null, canonicalUrl: "https://b.com/jobs/1" });
    expect(a).not.toBe(b);
    expect(a).toBe(fp({ location: null, canonicalUrl: "https://a.com/jobs/1" }));
  });

  it("remote is part of the location", () => {
    expect(fp({ location: "Remote" })).toBe(fp({ location: "Remote - India" }));
    expect(fp({ location: "Remote" })).not.toBe(fp({ location: "Mumbai" }));
    expect(fp({ location: null, remoteType: "REMOTE" })).toBe(fp({ location: "Remote" }));
  });

  it("multi-city postings are order-independent", () => {
    expect(fp({ location: "Mumbai / Pune" })).toBe(fp({ location: "Pune; Mumbai" }));
  });
});

describe("normalizers", () => {
  it("normalizeCompany", () => {
    expect(normalizeCompany("PhonePe Private Limited")).toBe("phonepe");
    expect(normalizeCompany("Phone Pe")).toBe("phonepe");
    expect(normalizeCompany("Société Générale")).toBe("societegenerale");
    expect(normalizeCompany("Co")).toBe("co");
  });
  it("normalizeTitle", () => {
    expect(normalizeTitle("Sr. Full-Stack Dev (Next.js)")).toBe("senior fullstack developer nextjs");
  });
  it("locationKey", () => {
    expect(locationKey("Mumbai, Maharashtra, India", "UNKNOWN")).toBe("mumbai");
    expect(locationKey("India", "UNKNOWN")).toBeNull();
    expect(locationKey(null, "UNKNOWN")).toBeNull();
  });
});
