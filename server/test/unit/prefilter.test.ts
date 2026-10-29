import { describe, expect, it } from "vitest";
import { preferencesSchema } from "@jobpilot/shared";
import { buildJob, type JobInput } from "../../src/jobs/build.js";
import { prefilter, seniorityOfTitle } from "../../src/jobs/prefilter.js";

const now = new Date("2026-10-29T00:00:00Z");
const job = (over: Partial<JobInput>) =>
  buildJob({ source: "jsearch", sourceJobId: Math.random().toString(36), title: "Backend Engineer", company: "Acme", applyLinks: [], postedAt: now, ...over });
const profile = (prefs: Record<string, unknown> = {}, years = 4) => ({
  skills: ["node.js", "postgresql", "aws"],
  yearsExperience: years,
  preferences: preferencesSchema.parse({ desiredRole: "Backend Engineer", locations: ["Bangalore"], ...prefs }),
});
const run = (jobs: ReturnType<typeof job>[], p = profile(), excluded = new Set<string>()) => prefilter(jobs, p, { excluded, maxAgeDays: 30, now });

describe("prefilter", () => {
  it("keeps a matching job and reports which skills it mentions", () => {
    const r = run([job({ location: "Bengaluru, Karnataka", description: "We use Node.js and Postgres on AWS. ".repeat(10) })]);
    expect(r.kept).toHaveLength(1);
    expect(r.kept[0]!.matchedSkills.sort()).toEqual(["aws", "node.js", "postgresql"]);
  });

  it("drops jobs already marked done or deleted (by jobKey or fingerprint)", () => {
    const j = job({ location: "Bangalore" });
    expect(run([j], profile(), new Set([j.jobKey])).dropped.status).toBe(1);
    expect(run([j], profile(), new Set([j.fingerprint])).dropped.status).toBe(1);
  });

  it("drops jobs outside the preferred locations but keeps remote and unknown-location jobs", () => {
    const r = run([job({ location: "Mumbai" }), job({ location: "Anywhere", remote: "remote" }), job({ location: null })]);
    expect(r.dropped.location).toBe(1);
    expect(r.kept).toHaveLength(2);
  });

  it("enforces the remote preference", () => {
    const r = run([job({ remote: "onsite", location: "Bangalore" }), job({ remote: "hybrid", location: "Bangalore" }), job({ remote: "remote" })], profile({ remote: "remote" }));
    expect(r.dropped.remote).toBe(2);
    expect(r.kept).toHaveLength(1);
  });

  it("applies the salary floor only when the salary is known and in the same currency", () => {
    const p = profile({ minSalary: 2_000_000, salaryCurrency: "INR" });
    const r = run(
      [
        job({ location: "Bangalore", salary: { min: 50_000, max: 100_000, currency: "INR", period: "month" } }), // 1.2M/yr
        job({ location: "Bangalore", salary: { min: 200_000, max: 250_000, currency: "INR", period: "month" } }), // 3M/yr
        job({ location: "Bangalore", salary: { min: 10, max: 20, currency: "USD", period: "hour" } }),
        job({ location: "Bangalore" }),
      ],
      p,
    );
    expect(r.dropped.salary).toBe(1);
    expect(r.kept).toHaveLength(3);
  });

  it("drops jobs far above or below the candidate's level", () => {
    const r = run([job({ title: "Director of Engineering", location: "Bangalore" }), job({ title: "Software Engineering Intern", location: "Bangalore" }), job({ title: "Senior Backend Engineer", location: "Bangalore" })], profile({}, 8));
    expect(r.dropped.seniority).toBe(2);
    expect(r.kept.map((k) => k.job.title)).toEqual(["Senior Backend Engineer"]);
  });

  it("drops jobs that require far more experience than the candidate has", () => {
    expect(run([job({ location: "Bangalore", requiredExperienceMonths: 120 })], profile({}, 3)).dropped.seniority).toBe(1);
  });

  it("drops zero-skill-overlap jobs only when there is a real description", () => {
    const r = run([job({ location: "Bangalore", description: "Excel, payroll and bookkeeping. ".repeat(10) }), job({ location: "Bangalore", description: null })]);
    expect(r.dropped.skills).toBe(1);
    expect(r.kept).toHaveLength(1);
  });

  it("drops stale jobs", () => {
    expect(run([job({ location: "Bangalore", postedAt: new Date("2026-08-01") })]).dropped.stale).toBe(1);
  });
});

describe("seniorityOfTitle", () => {
  it.each([
    ["Software Engineering Intern", 0],
    ["Junior Developer", 1],
    ["Backend Engineer", 2],
    ["Sr. Backend Engineer", 3],
    ["Staff Engineer", 4],
    ["VP Engineering", 5],
  ])("%s -> %i", (title, level) => expect(seniorityOfTitle(title)).toBe(level));
});
