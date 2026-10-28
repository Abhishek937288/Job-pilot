import type { ProfileData, ProfileExtraction } from "@jobpilot/shared";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "../../src/db/prisma.js";
import { PGBOSS_SCHEMA, QUEUES, getBoss, stopBoss } from "../../src/queue/boss.js";
import { extractProfileForResume, getActiveProfile, saveActiveProfile } from "../../src/services/profile.service.js";
import { ingestResume } from "../../src/services/resume.service.js";
import { makePdf, RESUME_LINES } from "../fixtures.js";

// The LLM is mocked; this suite covers DB + queue behaviour. `npm run llm:smoke` covers the real call.
const llm = vi.hoisted(() => ({ result: null as unknown }));
vi.mock("../../src/llm/client.js", () => ({
  structuredCall: vi.fn(async () => llm.result),
}));

const extraction: ProfileExtraction = {
  name: "Priya Sharma",
  headline: "Senior Backend Engineer",
  totalYearsExperience: 7.5,
  skills: [{ name: "TypeScript", proficiency: "ADVANCED" }],
  roles: ["Senior Software Engineer"],
  companies: ["Acme Payments"],
  education: [],
  projects: [],
  targetTitles: [],
  preferredLocations: [],
  remotePreference: null,
  noticePeriod: null,
  expectedSalary: null,
};

function pdfUpload(lines: string[], name = "resume.pdf") {
  const buffer = makePdf(lines);
  return { originalname: name, buffer, size: buffer.length };
}

async function queuedJobs(resumeId: string): Promise<number> {
  const rows = await prisma.$queryRawUnsafe<{ n: bigint }[]>(
    `SELECT count(*) AS n FROM "${PGBOSS_SCHEMA}".job WHERE name = $1 AND data->>'resumeId' = $2`,
    QUEUES.extractProfile,
    resumeId,
  );
  return Number(rows[0]?.n ?? 0);
}

beforeEach(async () => {
  await prisma.$executeRaw`TRUNCATE "JobStatus", "Job", "SearchRun", "AtsCompany", "ResumeVersion", "Profile", "Resume" CASCADE`;
  await getBoss();
  llm.result = { ok: true, data: extraction, usage: [], attempts: 1 };
});

afterAll(async () => {
  await stopBoss();
  await prisma.$disconnect();
});

describe("resume ingestion", () => {
  it("stores a text PDF as PENDING and enqueues extraction", async () => {
    const res = await ingestResume(pdfUpload(RESUME_LINES));
    expect(res.duplicate).toBe(false);
    expect(res.resume.extractionStatus).toBe("PENDING");
    expect(await queuedJobs(res.resume.id)).toBe(1);
  });

  it("marks a scanned/blank PDF NEEDS_REVIEW and never enqueues an LLM job", async () => {
    const res = await ingestResume(pdfUpload([]));
    expect(res.resume.extractionStatus).toBe("NEEDS_REVIEW");
    expect(res.resume.extractionError).toMatch(/scanned or image-only/);
    expect(await queuedJobs(res.resume.id)).toBe(0);
  });

  it("treats the same file uploaded twice as a duplicate", async () => {
    const first = await ingestResume(pdfUpload(RESUME_LINES));
    const second = await ingestResume(pdfUpload(RESUME_LINES, "renamed.pdf"));
    expect(second.duplicate).toBe(true);
    expect(second.resume.id).toBe(first.resume.id);
    expect(await prisma.resume.count()).toBe(1);
  });

  it("keeps the original file bytes unchanged", async () => {
    const upload = pdfUpload(RESUME_LINES);
    const res = await ingestResume(upload);
    const row = await prisma.resume.findUniqueOrThrow({ where: { id: res.resume.id } });
    expect(Buffer.from(row.fileData).equals(upload.buffer)).toBe(true);
  });
});

describe("profile extraction", () => {
  it("creates the active profile and flags missing search preferences", async () => {
    const { resume } = await ingestResume(pdfUpload(RESUME_LINES));
    await extractProfileForResume(resume.id);

    const profile = await getActiveProfile();
    expect(profile?.data.name).toBe("Priya Sharma");
    expect(profile?.missingRequired).toEqual(["targetTitles", "preferredLocations", "remotePreference"]);
    expect((await prisma.resume.findUniqueOrThrow({ where: { id: resume.id } })).extractionStatus).toBe("SUCCEEDED");
  });

  it("is idempotent: a second run for the same resume does nothing", async () => {
    const { resume } = await ingestResume(pdfUpload(RESUME_LINES));
    await extractProfileForResume(resume.id);
    await extractProfileForResume(resume.id);
    expect(await prisma.profile.count()).toBe(1);
  });

  it("marks NEEDS_REVIEW when the LLM output fails validation twice", async () => {
    llm.result = { ok: false, reason: "validation", message: "bad", usage: [], attempts: 2 };
    const { resume } = await ingestResume(pdfUpload(RESUME_LINES));
    await extractProfileForResume(resume.id);
    const row = await prisma.resume.findUniqueOrThrow({ where: { id: resume.id } });
    expect(row.extractionStatus).toBe("NEEDS_REVIEW");
    expect(await getActiveProfile()).toBeNull();
  });

  it("a new resume becomes active, keeps one active row, and carries over my preferences", async () => {
    const first = await ingestResume(pdfUpload(RESUME_LINES));
    await extractProfileForResume(first.resume.id);
    const edited: ProfileData = {
      ...(await getActiveProfile())!.data,
      targetTitles: ["Staff Engineer"],
      preferredLocations: ["Bangalore"],
      remotePreference: "HYBRID",
    };
    await saveActiveProfile(edited);

    const second = await ingestResume(pdfUpload([...RESUME_LINES, "Also: Go, gRPC, Terraform."]));
    await extractProfileForResume(second.resume.id);

    expect(await prisma.profile.count({ where: { isActive: true } })).toBe(1);
    const active = await getActiveProfile();
    expect(active?.resumeId).toBe(second.resume.id);
    expect(active?.data).toMatchObject({ targetTitles: ["Staff Engineer"], preferredLocations: ["Bangalore"], remotePreference: "HYBRID" });
    expect(active?.readyForSearch).toBe(true);
  });

  it("the database rejects a second active profile", async () => {
    await prisma.profile.create({ data: { isActive: true } });
    await expect(prisma.profile.create({ data: { isActive: true } })).rejects.toThrow();
    await expect(prisma.profile.create({ data: { isActive: false } })).resolves.toBeTruthy();
  });

  it("saving without any profile creates one (manual entry after a scanned PDF)", async () => {
    await ingestResume(pdfUpload([]));
    const saved = await saveActiveProfile({
      ...extraction,
      targetTitles: ["SRE"],
      preferredLocations: ["Remote"],
      remotePreference: "REMOTE",
    });
    expect(saved.readyForSearch).toBe(true);
    expect(saved.userEditedAt).not.toBeNull();
  });
});
