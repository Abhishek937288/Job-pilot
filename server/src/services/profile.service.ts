import { missingRequiredFields, profileDataSchema, profileExtractionSchema, type ProfileData, type ProfileDto } from "@jobpilot/shared";
import { env } from "../config/env.js";
import { prisma } from "../db/prisma.js";
import type { Profile } from "../generated/prisma/client.js";
import { HttpError } from "../lib/http-error.js";
import { logger } from "../lib/logger.js";
import { structuredCall } from "../llm/client.js";
import { EXTRACT_PROFILE_SYSTEM, extractProfileUserPrompt } from "../llm/prompts/extractProfile.prompt.js";
import { carryOverPreferences, normalizeExtraction } from "./profile-normalize.js";

export function profileRowToData(row: Profile): ProfileData {
  return profileDataSchema.parse({
    name: row.name,
    headline: row.headline,
    totalYearsExperience: row.totalYearsExperience,
    skills: row.skills,
    roles: row.roles,
    companies: row.companies,
    education: row.education,
    projects: row.projects,
    targetTitles: row.targetTitles,
    preferredLocations: row.preferredLocations,
    remotePreference: row.remotePreference,
    noticePeriod: row.noticePeriod,
    expectedSalary: row.expectedSalary,
  });
}

export function toProfileDto(row: Profile): ProfileDto {
  const data = profileRowToData(row);
  const missingRequired = missingRequiredFields(data);
  return {
    id: row.id,
    resumeId: row.resumeId,
    data,
    missingRequired,
    readyForSearch: missingRequired.length === 0,
    userEditedAt: row.userEditedAt?.toISOString() ?? null,
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function getActiveProfileRow(): Promise<Profile | null> {
  return prisma.profile.findFirst({ where: { isActive: true } });
}

export async function getActiveProfile(): Promise<ProfileDto | null> {
  const row = await getActiveProfileRow();
  return row ? toProfileDto(row) : null;
}

/** Save my edits to the active profile, creating it (linked to the latest resume) if none exists. */
export async function saveActiveProfile(data: ProfileData): Promise<ProfileDto> {
  const existing = await getActiveProfileRow();
  const fields = { ...data, userEditedAt: new Date() };
  if (existing) {
    return toProfileDto(await prisma.profile.update({ where: { id: existing.id }, data: fields }));
  }
  const latestResume = await prisma.resume.findFirst({ orderBy: { uploadedAt: "desc" }, select: { id: true } });
  return toProfileDto(await prisma.profile.create({ data: { ...fields, isActive: true, resumeId: latestResume?.id ?? null } }));
}

/** Guard for Phase 2: searches may only run with a complete profile. */
export async function requireSearchReadyProfile(): Promise<ProfileDto> {
  const profile = await getActiveProfile();
  if (!profile) throw new HttpError(409, "NO_PROFILE", "Upload a resume or fill in your profile first");
  if (!profile.readyForSearch) {
    throw new HttpError(409, "PROFILE_INCOMPLETE", "Fill in the required profile fields first", {
      missingRequired: profile.missingRequired,
    });
  }
  return profile;
}

/**
 * Queue handler: run LLM extraction for a resume and make the result the active profile.
 * Idempotent: does nothing unless the resume is still PENDING.
 */
export async function extractProfileForResume(resumeId: string): Promise<void> {
  const resume = await prisma.resume.findUnique({
    where: { id: resumeId },
    select: { id: true, extractionStatus: true, extractedText: true },
  });
  if (!resume) {
    logger.warn({ resumeId }, "extract-profile: resume not found");
    return;
  }
  if (resume.extractionStatus !== "PENDING") {
    logger.info({ resumeId, status: resume.extractionStatus }, "extract-profile: already processed, skipping");
    return;
  }

  const result = await structuredCall({
    name: "resume_profile",
    schema: profileExtractionSchema,
    system: EXTRACT_PROFILE_SYSTEM,
    user: extractProfileUserPrompt(resume.extractedText.slice(0, env.RESUME_MAX_TEXT_CHARS)),
    tier: "cheap",
  });

  if (!result.ok) {
    await prisma.resume.update({
      where: { id: resumeId },
      data: {
        extractionStatus: "NEEDS_REVIEW",
        extractionError: `Automatic profile extraction failed (${result.reason}). Please fill in your profile manually.`,
      },
    });
    logger.warn({ resumeId, reason: result.reason, message: result.message }, "extract-profile: needs review");
    return;
  }

  const extracted = normalizeExtraction(result.data);
  await prisma.$transaction(async (tx) => {
    const previous = await tx.profile.findFirst({ where: { isActive: true } });
    const data = carryOverPreferences(extracted, previous ? profileRowToData(previous) : null);
    if (previous) await tx.profile.update({ where: { id: previous.id }, data: { isActive: false } });
    await tx.profile.create({
      data: { ...data, isActive: true, resumeId, rawExtraction: result.data },
    });
    await tx.resume.update({
      where: { id: resumeId },
      data: { extractionStatus: "SUCCEEDED", extractionError: null },
    });
  });
  logger.info({ resumeId, skills: extracted.skills.length }, "extract-profile: done");
}

/** Called by the worker when the final retry of an extraction job has thrown. */
export async function markExtractionFailed(resumeId: string, err: unknown): Promise<void> {
  const message = err instanceof Error ? err.message : String(err);
  await prisma.resume.updateMany({
    where: { id: resumeId, extractionStatus: "PENDING" },
    data: {
      extractionStatus: "FAILED",
      extractionError: `Profile extraction failed after retries: ${message.slice(0, 300)}`,
    },
  });
}
