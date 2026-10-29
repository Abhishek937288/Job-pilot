import { describe, expect, it } from "vitest";
import { finalScore } from "../../src/jobs/score.js";

describe("finalScore", () => {
  it("uses 0.5 skills + 0.2 seniority + 0.2 location + 0.1 salary", () => {
    expect(finalScore({ skills: 80, seniority: 60, location: 100, salary: 50 })).toBe(Math.round(40 + 12 + 20 + 5));
  });

  it("rescales the other weights when salary is unknown", () => {
    // (0.5*80 + 0.2*60 + 0.2*100) / 0.9 = 80
    expect(finalScore({ skills: 80, seniority: 60, location: 100, salary: null })).toBe(80);
    expect(finalScore({ skills: 100, seniority: 100, location: 100, salary: null })).toBe(100);
  });

  it("treats a salary score of 0 as known", () => {
    expect(finalScore({ skills: 100, seniority: 100, location: 100, salary: 0 })).toBe(90);
  });
});
