import type { ParsedResume, Preferences } from "@jobpilot/shared";
import { env } from "../config/env.js";
import { Profile, type ProfileDoc } from "../db/models/profile.js";
import { SearchRun, type SearchRunDoc } from "../db/models/searchRun.js";
import type { UserDoc } from "../db/models/user.js";
import { scoped } from "../db/scoped.js";
import { HttpError } from "../lib/errors.js";
import { sha1, stableStringify } from "../lib/hash.js";
import { logger } from "../lib/logger.js";
import { extractResume } from "../llm/extractResume.js";
import type { Meter } from "../llm/meter.js";
import { enqueueSearch } from "../queue/queues.js";
import { yearsOfExperience } from "../resume/experience.js";
import { detectKind, extractText } from "../resume/extractText.js";
import { normalizeSkills } from "../resume/skills.js";
import { consumeSearch, refundSearch } from "./quota.js";

/** Bump when ranking inputs change meaningfully, so old scores stop being reused. */
const RANKING_VERSION = 1;

export function computeProfileHash(parsed: ParsedResume, skills: string[], years: number, prefs: Preferences): string {
  return sha1(
    stableStringify({
      v: RANKING_VERSION,
      skills,
      years,
      titles: parsed.experience.map((e) => [e.title, e.start, e.end]),
      headline: parsed.headline,
      prefs,
    }),
  );
}

export interface UploadedFile {
  buffer: Buffer;
  mimetype: string;
  originalname: string;
}

/**
 * Upload → text → structured profile. The file buffer and the extracted text live only in this
 * function's scope: neither is stored or logged.
 */
export async function parseResumeUpload(file: UploadedFile, meter?: Meter): Promise<{ parsed: ParsedResume; method: "text" | "vision"; textChars: number }> {
  const kind = detectKind(file.buffer, file.mimetype);
  const extracted = await extractText(file.buffer, kind);
  if (!extracted.scanned) {
    return { parsed: await extractResume({ text: extracted.text }, meter), method: "text", textChars: extracted.chars };
  }
  if (kind === "pdf" && env.VISION_FALLBACK_ENABLED) {
    logger.info({ chars: extracted.chars }, "little text in PDF: using the vision model");
    return { parsed: await extractResume({ pdf: { filename: "resume.pdf", buffer: file.buffer } }, meter), method: "vision", textChars: extracted.chars };
  }
  throw new HttpError(422, "This file has almost no text (is it a scan?). Upload a text-based PDF or a DOCX.");
}

export function deriveProfileFields(parsed: ParsedResume, prefs: Preferences) {
  const skills = normalizeSkills(parsed.skills);
  const yearsExperience = yearsOfExperience(parsed.experience);
  return { skills, yearsExperience, profileHash: computeProfileHash(parsed, skills, yearsExperience, prefs) };
}

export async function startSearchRun(user: UserDoc, profile: ProfileDoc, trigger: "initial" | "manual"): Promise<SearchRunDoc> {
  const repo = scoped(user._id);
  if (trigger === "manual" && (await repo.activeRun(profile._id))) throw new HttpError(409, "A search is already running for this profile");
  await consumeSearch(user);
  try {
    const run = await SearchRun.create({ userId: user._id, profileId: profile._id, status: "queued", trigger, expiresAt: user.expiresAt ?? null });
    await enqueueSearch({ userId: String(user._id), profileId: String(profile._id), runId: String(run._id) });
    return run;
  } catch (err) {
    await refundSearch(String(user._id));
    throw err;
  }
}

export async function createProfile(
  user: UserDoc,
  file: UploadedFile,
  fields: { preferences: Preferences; label?: string },
): Promise<{ profile: ProfileDoc; run: SearchRunDoc }> {
  const repo = scoped(user._id);
  if ((await repo.countProfiles()) >= env.MAX_PROFILES_PER_USER) {
    throw new HttpError(409, `You can keep at most ${env.MAX_PROFILES_PER_USER} profiles. Delete one first.`);
  }
  const { parsed, method, textChars } = await parseResumeUpload(file);
  const derived = deriveProfileFields(parsed, fields.preferences);
  const label = fields.label ?? (file.originalname.replace(/\.(pdf|docx)$/i, "").slice(0, 100) || fields.preferences.desiredRole);

  const profile = await Profile.create({
    userId: user._id,
    label,
    parsed,
    ...derived,
    preferences: fields.preferences,
    extraction: { method, textChars },
    consentAt: new Date(),
    expiresAt: user.expiresAt ?? null,
  });
  const run = await startSearchRun(user, profile, "initial");
  return { profile, run };
}

export async function updateProfile(profile: ProfileDoc, update: { label?: string; preferences?: Preferences }): Promise<ProfileDoc> {
  if (update.label) profile.label = update.label;
  if (update.preferences) {
    profile.preferences = update.preferences as never;
    const parsed = profile.toObject().parsed as unknown as ParsedResume;
    profile.profileHash = computeProfileHash(parsed, profile.skills, profile.yearsExperience, update.preferences);
  }
  await profile.save();
  return profile;
}
