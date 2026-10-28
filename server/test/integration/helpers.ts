import type { ApplicationStatus, ProfileData } from "@jobpilot/shared";
import { prisma } from "../../src/db/prisma.js";
import { jobFingerprint } from "../../src/search/fingerprint.js";
import { matchLocation } from "../../src/search/location.js";

export const PREFS = ["Mumbai", "Navi Mumbai"];

export const READY_PROFILE: ProfileData = {
  name: "Test User",
  headline: null,
  totalYearsExperience: 3,
  skills: [{ name: "TypeScript", proficiency: "ADVANCED" }],
  roles: [],
  companies: [],
  education: [],
  projects: [],
  targetTitles: ["Backend Developer", "Software Developer"],
  preferredLocations: PREFS,
  remotePreference: "ANY",
  noticePeriod: null,
  expectedSalary: null,
};

export async function resetSearchTables(): Promise<void> {
  await prisma.$executeRaw`TRUNCATE "JobStatus", "Job", "SearchRun", "AtsCompany", "ResumeVersion", "Profile", "Resume" CASCADE`;
}

export async function seedProfile(): Promise<void> {
  await prisma.profile.create({ data: { ...READY_PROFILE, isActive: true } });
}

export interface JobSeed {
  url: string;
  company?: string;
  title?: string;
  location?: string | null;
  status?: ApplicationStatus;
  expired?: boolean;
  fitScore?: number | null;
  applyMethod?: "GREENHOUSE" | "LEVER" | "ASHBY" | "UNKNOWN";
  firstSeenAt?: Date;
}

export async function seedJob(s: JobSeed) {
  const company = s.company ?? "Acme";
  const title = s.title ?? "Backend Developer";
  const location = s.location === undefined ? "Mumbai" : s.location;
  const job = await prisma.job.create({
    data: {
      canonicalUrl: s.url,
      fingerprint: jobFingerprint({ company, title, location, remoteType: "UNKNOWN", canonicalUrl: s.url }),
      company,
      title,
      location,
      locationMatch: matchLocation([location], "UNKNOWN", PREFS),
      applyMethod: s.applyMethod ?? "UNKNOWN",
      source: "SERPER",
      expired: s.expired ?? false,
      fitScore: s.fitScore ?? null,
      ...(s.firstSeenAt ? { firstSeenAt: s.firstSeenAt } : {}),
    },
  });
  if (s.status) await prisma.jobStatus.create({ data: { jobId: job.id, status: s.status } });
  return job;
}
