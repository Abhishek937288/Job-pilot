import { missingRequiredFields, type ProfileData, type ProfileExtraction } from "@jobpilot/shared";
import { describe, expect, it } from "vitest";
import { carryOverPreferences, normalizeExtraction } from "../src/services/profile-normalize.js";

const emptyExtraction: ProfileExtraction = {
  name: null,
  headline: null,
  totalYearsExperience: null,
  skills: [],
  roles: [],
  companies: [],
  education: [],
  projects: [],
  targetTitles: [],
  preferredLocations: [],
  remotePreference: null,
  noticePeriod: null,
  expectedSalary: null,
};

describe("normalizeExtraction", () => {
  it("trims, dedupes case-insensitively and drops empties", () => {
    const out = normalizeExtraction({
      ...emptyExtraction,
      name: "  Priya   Sharma ",
      headline: "   ",
      skills: [
        { name: "TypeScript", proficiency: "ADVANCED" },
        { name: "typescript", proficiency: "BEGINNER" },
        { name: " ", proficiency: "BEGINNER" },
      ],
      roles: ["Engineer", "engineer", ""],
      education: [{ institution: "", degree: null, field: null, startYear: null, endYear: null }],
    });
    expect(out.name).toBe("Priya Sharma");
    expect(out.headline).toBeNull();
    expect(out.skills).toEqual([{ name: "TypeScript", proficiency: "ADVANCED" }]);
    expect(out.roles).toEqual(["Engineer"]);
    expect(out.education).toEqual([]);
  });

  it("rejects implausible numbers instead of storing them", () => {
    const out = normalizeExtraction({
      ...emptyExtraction,
      totalYearsExperience: 7.46,
      education: [{ institution: "COEP", degree: "B.Tech", field: null, startYear: 13, endYear: 2017.2 }],
    });
    expect(out.totalYearsExperience).toBe(7.5);
    expect(out.education[0]).toMatchObject({ startYear: null, endYear: 2017 });
    expect(normalizeExtraction({ ...emptyExtraction, totalYearsExperience: 300 }).totalYearsExperience).toBeNull();
  });
});

describe("carryOverPreferences", () => {
  const prev: ProfileData = {
    ...normalizeExtraction(emptyExtraction),
    targetTitles: ["Staff Engineer"],
    preferredLocations: ["Berlin"],
    remotePreference: "REMOTE",
    noticePeriod: "30 days",
  };

  it("keeps previous preferences when the new resume has none", () => {
    const next = carryOverPreferences(normalizeExtraction(emptyExtraction), prev);
    expect(next).toMatchObject({ targetTitles: ["Staff Engineer"], preferredLocations: ["Berlin"], remotePreference: "REMOTE" });
  });

  it("prefers what the new resume states", () => {
    const next = carryOverPreferences(normalizeExtraction({ ...emptyExtraction, preferredLocations: ["Pune"] }), prev);
    expect(next.preferredLocations).toEqual(["Pune"]);
  });
});

describe("missingRequiredFields", () => {
  it("flags empty required fields, including target titles and locations", () => {
    const p = normalizeExtraction({ ...emptyExtraction, name: "A" });
    expect(missingRequiredFields(p)).toEqual(["skills", "targetTitles", "preferredLocations", "remotePreference"]);
  });

  it("is empty for a complete profile", () => {
    const p: ProfileData = {
      ...normalizeExtraction(emptyExtraction),
      name: "A",
      skills: [{ name: "Go", proficiency: "EXPERT" }],
      targetTitles: ["SRE"],
      preferredLocations: ["Remote"],
      remotePreference: "ANY",
    };
    expect(missingRequiredFields(p)).toEqual([]);
  });
});
