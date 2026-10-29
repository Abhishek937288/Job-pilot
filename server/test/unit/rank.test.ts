import { describe, expect, it } from "vitest";
import { preferencesSchema } from "@jobpilot/shared";
import { normalizeQueries } from "../../src/llm/generateQueries.js";
import { sanitizeRankResults, type RankJob } from "../../src/llm/rank.js";

const jobs: RankJob[] = [
  { id: "j1", title: "A", company: "X", location: null, remote: "unknown", salary: null, postedAt: null, description: null },
  { id: "j2", title: "B", company: "Y", location: null, remote: "unknown", salary: null, postedAt: null, description: null },
];
const result = (jobId: string, skills = 70) => ({
  jobId,
  scores: { skills, seniority: 50, location: 50, salary: null },
  matchedSkills: ["a"],
  missingSkills: [],
  reason: "r".repeat(400),
  verdict: "good" as const,
  redFlags: [],
});

describe("sanitizeRankResults", () => {
  it("discards ids that were not sent (invented jobs) and duplicates", () => {
    const out = sanitizeRankResults([result("j1"), result("j9"), result("j1"), result("j2")], jobs);
    expect(out.map((r) => r.jobId)).toEqual(["j1", "j2"]);
  });

  it("clamps scores to 0-100 and caps the reason at 300 characters", () => {
    const [r] = sanitizeRankResults([result("j1", 140)], jobs);
    expect(r!.scores.skills).toBe(100);
    expect(r!.scores.salary).toBeNull();
    expect(r!.reason).toHaveLength(300);
  });
});

describe("normalizeQueries", () => {
  const prefs = preferencesSchema.parse({ desiredRole: "Backend Engineer", locations: ["Pune"], remote: "remote" });

  it("dedupes, caps at 5, forces remoteOnly for remote candidates and always includes the desired role", () => {
    const q = normalizeQueries(
      [
        { query: "Node.js Developer", location: "Pune", remoteOnly: false },
        { query: "node.js developer", location: "pune", remoteOnly: false },
        { query: "Platform Engineer", location: null, remoteOnly: true },
      ],
      prefs,
    );
    expect(q.map((x) => x.query)).toEqual(["Node.js Developer", "Platform Engineer", "Backend Engineer"]);
    expect(q.every((x) => x.remoteOnly)).toBe(true);
  });

  it("falls back to the desired role when the model returned nothing", () => {
    expect(normalizeQueries([], prefs)).toEqual([{ query: "Backend Engineer", location: "Pune", remoteOnly: true }]);
  });
});
