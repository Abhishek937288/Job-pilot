import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import mongoose from "mongoose";
import request from "supertest";
import { PARSED, setupDb, signUp, uploadProfile } from "./helpers.js";

// External calls replaced: no OpenAI, no queue. Text extraction is faked; magic-byte checks stay real.
vi.mock("../../src/llm/extractResume.js", () => ({ extractResume: vi.fn(async () => PARSED) }));
vi.mock("../../src/resume/extractText.js", async (orig) => ({
  ...(await orig<typeof import("../../src/resume/extractText.js")>()),
  extractText: vi.fn(async () => ({ text: "resume text ".repeat(50), chars: 500, scanned: false })),
}));
const enqueued: unknown[] = [];
vi.mock("../../src/queue/queues.js", async (orig) => ({
  ...(await orig<typeof import("../../src/queue/queues.js")>()),
  enqueueSearch: vi.fn(async (d: unknown) => void enqueued.push(d)),
  enqueueCompanyRefresh: vi.fn(async () => undefined),
}));

const { createApp } = await import("../../src/app.js");
const { JobMatch } = await import("../../src/db/models/jobMatch.js");
const { Profile } = await import("../../src/db/models/profile.js");
const { User } = await import("../../src/db/models/user.js");
const { closeRedis } = await import("../../src/lib/redis.js");

const app = createApp();

async function seedJob(userId: string, profileId: string, key: string, status: "new" | "done" | "deleted" = "new") {
  const now = new Date();
  return JobMatch.create({
    userId,
    profileId,
    jobKey: key,
    fingerprint: key,
    job: { title: `Job ${key}`, company: "=cmd|' /C calc'!A0", source: "jsearch", applyLinks: [{ url: "https://x.example/1", source: "x", isDirect: false }] },
    match: { score: 80, scores: { skills: 80, seniority: 80, location: 80, salary: null }, matchedSkills: [], missingSkills: [], reason: "+fine", verdict: "good", redFlags: [], profileHash: "h", scoredAt: now },
    status,
    firstSeenAt: now,
    lastSeenAt: now,
  });
}

beforeAll(setupDb);
afterAll(async () => {
  await closeRedis();
  await mongoose.disconnect();
});

describe("profiles", () => {
  it("creates a profile from an upload without storing the file or raw text, and queues a search", async () => {
    const { agent, id } = await signUp(app, "owner@example.com");
    const res = await uploadProfile(agent);
    expect(res.status).toBe(201);
    expect(res.body.profile).toMatchObject({ label: "cv", skills: ["node.js", "postgresql", "aws"], extraction: { method: "text" } });
    expect(res.body.profile.yearsExperience).toBeGreaterThan(5);
    expect(res.body.run.status).toBe("queued");
    expect(enqueued.at(-1)).toMatchObject({ userId: id, profileId: res.body.profile.id });
    const raw = await Profile.findById(res.body.profile.id).lean();
    expect(JSON.stringify(raw)).not.toContain("resume text");
  });

  it("validates uploads: consent, file type by magic bytes", async () => {
    const { agent } = await signUp(app, "validate@example.com");
    const noConsent = await agent.post("/profiles").field("preferences", JSON.stringify({ desiredRole: "Dev" })).attach("file", Buffer.from("%PDF-1.4"), { filename: "a.pdf", contentType: "application/pdf" });
    expect(noConsent.status).toBe(400);
    const fakePdf = await agent.post("/profiles").field("preferences", JSON.stringify({ desiredRole: "Dev" })).field("consent", "true").attach("file", Buffer.from("MZ executable"), { filename: "a.pdf", contentType: "application/pdf" });
    expect(fakePdf.status).toBe(415);
    const txt = await agent.post("/profiles").field("preferences", "{}").field("consent", "true").attach("file", Buffer.from("hello"), { filename: "a.txt", contentType: "text/plain" });
    expect(txt.status).toBe(415);
  });

  it("caps profiles per user", async () => {
    const { agent } = await signUp(app, "cap@example.com");
    for (let i = 0; i < 5; i++) expect((await uploadProfile(agent)).status).toBe(201);
    expect((await uploadProfile(agent)).status).toBe(409);
  });
});

describe("user separation: user A's data is 404 for user B", () => {
  it("covers get, patch, search, runs, jobs, export, delete and job status", async () => {
    const a = await signUp(app, "a@example.com");
    const b = await signUp(app, "b@example.com");
    const profileId = (await uploadProfile(a.agent)).body.profile.id as string;
    const job = await seedJob(a.id, profileId, "k1");

    const attempts = [
      b.agent.get(`/profiles/${profileId}`),
      b.agent.patch(`/profiles/${profileId}`).send({ label: "mine now" }),
      b.agent.post(`/profiles/${profileId}/search`),
      b.agent.get(`/profiles/${profileId}/runs`),
      b.agent.get(`/profiles/${profileId}/jobs`),
      b.agent.get(`/profiles/${profileId}/export?format=json`),
      b.agent.delete(`/profiles/${profileId}`),
      b.agent.patch(`/jobs/${job.id}`).send({ status: "done" }),
      b.agent.get(`/profiles/not-an-id`),
    ];
    for (const res of await Promise.all(attempts)) expect(res.status).toBe(404);
    expect((await b.agent.get("/profiles")).body).toEqual([]);

    // Nothing changed for A.
    expect((await a.agent.get(`/profiles/${profileId}`)).body.label).toBe("cv");
    expect((await JobMatch.findById(job.id))!.status).toBe("new");
  });

  it("requires a session", async () => {
    expect((await request(app).get("/profiles")).status).toBe(401);
    expect((await request(app).get("/events")).status).toBe(401);
  });
});

describe("jobs: done, delete, undo, list and export", () => {
  it("changes status without deleting rows and filters lists", async () => {
    const { agent, id } = await signUp(app, "status@example.com");
    const profileId = (await uploadProfile(agent)).body.profile.id as string;
    const j1 = await seedJob(id, profileId, "s1");
    await seedJob(id, profileId, "s2");

    const done = await agent.patch(`/jobs/${j1.id}`).send({ status: "done" });
    expect(done.body).toMatchObject({ status: "done" });
    expect(done.body.doneAt).not.toBeNull();
    expect((await agent.get(`/profiles/${profileId}/jobs?status=new`)).body).toHaveLength(1);
    expect((await agent.get(`/profiles/${profileId}/jobs?status=done`)).body).toHaveLength(1);
    expect((await agent.get(`/profiles/${profileId}/jobs?minScore=90`)).body).toHaveLength(0);
    const undo = await agent.patch(`/jobs/${j1.id}`).send({ status: "new" });
    expect(undo.body).toMatchObject({ status: "new", doneAt: null });
    expect((await agent.patch(`/jobs/${j1.id}`).send({ status: "archived" })).status).toBe(400);
  });

  it("exports CSV with formula cells escaped, plus JSON and XLSX", async () => {
    const { agent, id } = await signUp(app, "export@example.com");
    const profileId = (await uploadProfile(agent)).body.profile.id as string;
    await seedJob(id, profileId, "e1");
    const csv = await agent.get(`/profiles/${profileId}/export?format=csv`);
    expect(csv.status).toBe(200);
    expect(csv.headers["content-disposition"]).toContain('attachment; filename="cv-all.csv"');
    expect(csv.text).toContain(`"'=cmd|' /C calc'!A0"`);
    expect(csv.text).toContain(`"'+fine"`);
    const json = await agent.get(`/profiles/${profileId}/export?format=json`);
    expect(JSON.parse(json.text)).toHaveLength(1);
    const xlsx = await agent.get(`/profiles/${profileId}/export?format=xlsx`).buffer(true).parse((res, cb) => {
      const chunks: Buffer[] = [];
      res.on("data", (c: Buffer) => chunks.push(c));
      res.on("end", () => cb(null, Buffer.concat(chunks)));
    });
    expect((xlsx.body as Buffer).subarray(0, 2).toString()).toBe("PK");
  });

  it("DELETE /profiles/:id removes the profile and every job", async () => {
    const { agent, id } = await signUp(app, "delete@example.com");
    const profileId = (await uploadProfile(agent)).body.profile.id as string;
    await seedJob(id, profileId, "d1");
    expect((await agent.delete(`/profiles/${profileId}`)).status).toBe(204);
    expect(await JobMatch.countDocuments({ profileId })).toBe(0);
    expect(await Profile.countDocuments({ _id: profileId })).toBe(0);
  });
});

describe("guest mode", () => {
  it("guest rows get a TTL that is cleared on sign-up, keeping the same data", async () => {
    const agent = request.agent(app);
    const guest = await agent.post("/auth/guest");
    expect(guest.status).toBe(201);
    expect(guest.body.isGuest).toBe(true);
    const profileId = (await uploadProfile(agent)).body.profile.id as string;
    expect((await Profile.findById(profileId))!.expiresAt).not.toBeNull();
    expect((await agent.post("/companies").send({ careerUrl: "https://jobs.lever.co/acme" })).status).toBe(403);

    const reg = await agent.post("/auth/register").send({ email: "upgraded@example.com", password: "password123" });
    expect(reg.status).toBe(201);
    expect(reg.body).toMatchObject({ id: guest.body.id, isGuest: false });
    expect((await Profile.findById(profileId))!.expiresAt).toBeNull();
  });

  it("logging in to an existing account while a guest moves the guest's rows to it", async () => {
    const { id: accountId } = await signUp(app, "existing@example.com");
    const agent = request.agent(app);
    const guestId = (await agent.post("/auth/guest")).body.id as string;
    const profileId = (await uploadProfile(agent)).body.profile.id as string;
    const login = await agent.post("/auth/login").send({ email: "existing@example.com", password: "password123" });
    expect(login.status).toBe(200);
    const moved = await Profile.findById(profileId);
    expect(String(moved!.userId)).toBe(accountId);
    expect(moved!.expiresAt).toBeNull();
    expect(await User.exists({ _id: guestId })).toBeNull();
  });

  it("rejects bad credentials and deletes accounts with all their data", async () => {
    const { agent, id } = await signUp(app, "gone@example.com");
    await uploadProfile(agent);
    expect((await request(app).post("/auth/login").send({ email: "gone@example.com", password: "wrong-password" })).status).toBe(401);
    expect((await agent.delete("/auth/account")).status).toBe(204);
    expect(await Profile.countDocuments({ userId: id })).toBe(0);
    expect((await agent.get("/profiles")).status).toBe(401);
  });
});
