import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import mongoose, { Types } from "mongoose";
import { preferencesSchema, type ServerEvent } from "@jobpilot/shared";
import { setupDb } from "./helpers.js";

const { JobMatch } = await import("../../src/db/models/jobMatch.js");
const { Profile } = await import("../../src/db/models/profile.js");
const { SearchRun } = await import("../../src/db/models/searchRun.js");
const { buildJob } = await import("../../src/jobs/build.js");
const { runSearchPipeline } = await import("../../src/pipeline/searchPipeline.js");
const { closeRedis } = await import("../../src/lib/redis.js");
type Deps = import("../../src/pipeline/searchPipeline.js").PipelineDeps;
type NormalizedJob = import("../../src/jobs/types.js").NormalizedJob;

const userId = new Types.ObjectId();
let profileId: Types.ObjectId;

const job = (id: string, over: Partial<Parameters<typeof buildJob>[0]> = {}) =>
  buildJob({ source: "jsearch", sourceJobId: id, title: `Backend Engineer ${id}`, company: `Co ${id}`, location: "Pune", applyLinks: [{ url: `https://x.example/${id}`, source: "x", isDirect: false }], postedAt: new Date(), ...over });

function deps(jobs: NormalizedJob[], events: ServerEvent[] = []) {
  const rankBatch = vi.fn<Deps["rankBatch"]>(async (_c, batch) =>
    // An extra invented id, which must be ignored.
    [...batch.map((j) => ({ jobId: j.id, scores: { skills: 90, seniority: 70, location: 100, salary: null }, matchedSkills: ["node.js"], missingSkills: [], reason: "good fit", verdict: "strong" as const, redFlags: [] })),
      { jobId: "j999", scores: { skills: 1, seniority: 1, location: 1, salary: 1 }, matchedSkills: [], missingSkills: [], reason: "", verdict: "poor" as const, redFlags: [] }],
  );
  const d: Deps = {
    sources: [{ name: "jsearch", fetch: async () => jobs }],
    generateQueries: async () => [{ query: "Backend Engineer", location: "Pune", remoteOnly: false }],
    rankBatch,
    explainTop: vi.fn<Deps["explainTop"]>(async (_c, js) => new Map(js.map((j) => [j.id, { reason: "detailed", redFlags: [] as string[] }]))),
    webSearch: null,
    publish: async (_u, e) => void events.push(e),
    onDiscovered: async () => undefined,
  };
  return { d, rankBatch, events };
}

async function newRun(uid = userId) {
  const run = await SearchRun.create({ userId: uid, profileId, status: "queued", trigger: "manual" });
  return { userId: String(uid), profileId: String(profileId), runId: String(run._id) };
}

beforeAll(setupDb);
beforeEach(async () => {
  await Promise.all([JobMatch.deleteMany({}), Profile.deleteMany({}), SearchRun.deleteMany({})]);
  const p = await Profile.create({
    userId,
    label: "cv",
    parsed: { skills: ["Node.js"], experience: [] },
    yearsExperience: 4,
    skills: ["node.js"],
    preferences: preferencesSchema.parse({ desiredRole: "Backend Engineer", locations: ["Pune"] }),
    profileHash: "hash-1",
    extraction: { method: "text", textChars: 1000 },
    consentAt: new Date(),
  });
  profileId = p._id;
});
afterAll(async () => {
  await closeRedis();
  await mongoose.disconnect();
});

describe("search pipeline", () => {
  it("scores, saves and streams jobs; the final score is computed in code; invented ids are ignored", async () => {
    const { d, events } = deps([job("1"), job("2"), job("3", { location: "Mumbai" })]);
    const out = await runSearchPipeline(await newRun(), d);
    expect(out!.run.status).toBe("succeeded");
    const rows = await JobMatch.find({ profileId });
    expect(rows).toHaveLength(2); // Mumbai dropped by the pre-filter
    expect(rows[0]!.match!.score).toBe(Math.round((0.5 * 90 + 0.2 * 70 + 0.2 * 100) / 0.9));
    expect(rows.every((r) => r.match!.explained && r.match!.reason === "detailed")).toBe(true);
    expect(events.filter((e) => e.type === "run.job").length).toBeGreaterThanOrEqual(2);
    expect(events.at(-1)).toMatchObject({ type: "run.finished", run: { status: "succeeded", stats: { newJobs: 2, droppedByPrefilter: { location: 1 } } } });
    expect(out!.run.metrics).toMatchObject({ firstResultMs: expect.any(Number) });
  });

  it("re-runs add only new jobs, never reset done/deleted, and reuse scores", async () => {
    await runSearchPipeline(await newRun(), deps([job("1"), job("2"), job("3")]).d);
    await JobMatch.updateOne({ profileId, jobKey: "jsearch:1" }, { $set: { status: "done" } });
    await JobMatch.updateOne({ profileId, jobKey: "jsearch:2" }, { $set: { status: "deleted" } });

    const second = deps([job("1"), job("2"), job("3"), job("4")]);
    const out = await runSearchPipeline(await newRun(), second.d);
    expect(out!.run.stats).toMatchObject({ newJobs: 1, reusedScores: 1, ranked: 1, droppedByPrefilter: { status: 2 } });
    // Only the new job went to the LLM.
    expect(second.rankBatch.mock.calls.flatMap((c) => c[1].map((j) => j.title))).toEqual(["Backend Engineer 4"]);
    const byKey = Object.fromEntries((await JobMatch.find({ profileId })).map((r) => [r.jobKey, r]));
    expect(Object.keys(byKey)).toHaveLength(4);
    expect(byKey["jsearch:1"]!.status).toBe("done");
    expect(byKey["jsearch:2"]!.status).toBe("deleted");
    expect(byKey["jsearch:3"]!.timesSeen).toBe(2);
  });

  it("re-scores when the profile or preferences change", async () => {
    await runSearchPipeline(await newRun(), deps([job("1")]).d);
    await Profile.updateOne({ _id: profileId }, { $set: { profileHash: "hash-2" } });
    const again = deps([job("1")]);
    const out = await runSearchPipeline(await newRun(), again.d);
    expect(again.rankBatch).toHaveBeenCalledTimes(1);
    expect(out!.run.stats).toMatchObject({ newJobs: 0, ranked: 1 });
    expect((await JobMatch.findOne({ profileId }))!.match!.profileHash).toBe("hash-2");
  });

  it("stores the same job from another source under the existing key (no duplicate)", async () => {
    await runSearchPipeline(await newRun(), deps([job("1")]).d);
    const sameJobOtherSource = buildJob({ source: "greenhouse", sourceJobId: "co:77", title: "Backend Engineer 1", company: "Co 1", location: "Pune", applyLinks: [{ url: "https://boards.greenhouse.io/co/jobs/77", source: "greenhouse", isDirect: true }] });
    await runSearchPipeline(await newRun(), deps([sameJobOtherSource]).d);
    expect(await JobMatch.countDocuments({ profileId })).toBe(1);
  });

  it("re-checks ownership: a payload with another userId writes nothing", async () => {
    const intruder = new Types.ObjectId();
    const run = await SearchRun.create({ userId: intruder, profileId, status: "queued", trigger: "manual" });
    const out = await runSearchPipeline({ userId: String(intruder), profileId: String(profileId), runId: String(run._id) }, deps([job("1")]).d);
    expect(out).toBeNull();
    expect(await JobMatch.countDocuments({})).toBe(0);
  });

  it("records a failed source and still finishes; a crash marks the run failed", async () => {
    const { d } = deps([job("1")]);
    d.sources.push({ name: "watchlist", fetch: async () => Promise.reject(new Error("boom")) });
    const ok = await runSearchPipeline(await newRun(), d);
    expect(ok!.run.status).toBe("succeeded");
    expect(ok!.run.stats).toMatchObject({ sourceErrors: { watchlist: "boom" } });

    const bad = deps([job("9")]); // unscored, so the ranker must run
    bad.d.rankBatch = async () => Promise.reject(new Error("openai down"));
    const failed = await runSearchPipeline(await newRun(), bad.d);
    expect(failed!.run).toMatchObject({ status: "failed", error: "openai down" });
  });
});
