import { describe, expect, it } from "vitest";
import { yearsOfExperience } from "../../src/resume/experience.js";
import { normalizeSkill, normalizeSkills, skillsInText } from "../../src/resume/skills.js";

const item = (start: string | null, end: string | null) => ({ company: null, title: null, start, end, summary: null });

describe("yearsOfExperience", () => {
  const now = new Date("2026-10-15T00:00:00Z");

  it("adds up roles and merges overlaps", () => {
    // 2020-01..2021-12 (24 months) and 2021-06..2022-05 overlap → 2020-01..2022-05 = 29 months
    expect(yearsOfExperience([item("2020-01", "2021-12"), item("2021-06", "2022-05")], now)).toBe(2.4);
  });

  it("counts present roles up to now and ignores roles without a start", () => {
    expect(yearsOfExperience([item("2025-10", "present"), item(null, "2020-01")], now)).toBe(1.1);
  });

  it("accepts year-only dates and ignores nonsense", () => {
    expect(yearsOfExperience([item("2019", "2020"), item("garbage", "2021-01"), item("2023-05", "2022-01")], now)).toBe(1.1);
  });
});

describe("skills", () => {
  it("normalizes aliases", () => {
    expect(normalizeSkill("NodeJS")).toBe("node.js");
    expect(normalizeSkill("Node")).toBe("node.js");
    expect(normalizeSkill("k8s")).toBe("kubernetes");
    expect(normalizeSkill("Rust")).toBe("rust");
    expect(normalizeSkill("Some Niche Tool")).toBe("some niche tool");
    expect(normalizeSkills(["React.js", "reactjs", "React"])).toEqual(["react"]);
  });

  it("matches skills with symbols on word boundaries", () => {
    const text = "Experience with C++, C#, .NET Core and node.js; React-Native and Java are a plus.";
    expect(skillsInText(["c++", "c#", ".net", "node.js", "react native", "java"], text)).toEqual(["c++", "c#", ".net", "node.js", "react native", "java"]);
    expect(skillsInText(["rust"], "trusted tools")).toEqual([]);
    expect(skillsInText(["typescript"], "TypeScript")).toEqual(["typescript"]);
    expect(skillsInText(["sql"], "We use NoSQL")).toEqual([]);
  });
});
