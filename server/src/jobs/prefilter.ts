import type { Preferences } from "@jobpilot/shared";
import { skillsInText } from "../resume/skills.js";
import { annualSalaryCeiling, locationMatches } from "./location.js";
import type { NormalizedJob } from "./types.js";

export type DropReason = "status" | "closed" | "stale" | "location" | "remote" | "salary" | "seniority" | "skills";

export interface PrefilterProfile {
  skills: string[];
  yearsExperience: number;
  preferences: Preferences;
}

export interface PrefilterOptions {
  /** jobKeys and fingerprints of jobs the user marked done or deleted. */
  excluded: Set<string>;
  maxAgeDays: number;
  now?: Date;
}

export interface PrefilterResult {
  kept: { job: NormalizedJob; matchedSkills: string[] }[];
  dropped: Partial<Record<DropReason, number>>;
}

/** 0 intern, 1 junior, 2 mid, 3 senior, 4 staff/lead, 5 director+. */
export function seniorityOfTitle(title: string): number {
  const t = title.toLowerCase();
  if (/\b(intern|internship|trainee|apprentice)\b/.test(t)) return 0;
  if (/\b(director|vp|vice president|head of|chief|cto|ceo)\b/.test(t)) return 5;
  if (/\b(staff|principal|lead|architect|distinguished)\b/.test(t)) return 4;
  if (/\b(senior|sr\.?|iii|level 3)\b/.test(t)) return 3;
  if (/\b(junior|jr\.?|entry|graduate|fresher|associate|i)\b/.test(t)) return 1;
  return 2;
}

export function seniorityOfYears(years: number): number {
  if (years < 1) return 0;
  if (years < 3) return 1;
  if (years < 6) return 2;
  if (years < 9) return 3;
  return 4;
}

const MIN_DESCRIPTION_FOR_SKILL_CHECK = 200;

/**
 * Hard rules applied in code before any LLM call. Missing data never drops a job: a job with no stated
 * location, salary or description is kept and left to the ranking model.
 */
export function prefilter(jobs: NormalizedJob[], profile: PrefilterProfile, opts: PrefilterOptions): PrefilterResult {
  const now = opts.now ?? new Date();
  const cutoff = now.getTime() - opts.maxAgeDays * 86_400_000;
  const pref = profile.preferences;
  const candidateLevel = seniorityOfYears(profile.yearsExperience);
  const dropped: PrefilterResult["dropped"] = {};
  const kept: PrefilterResult["kept"] = [];
  const drop = (r: DropReason) => {
    dropped[r] = (dropped[r] ?? 0) + 1;
  };

  for (const job of jobs) {
    if (opts.excluded.has(job.jobKey) || opts.excluded.has(job.fingerprint)) {
      drop("status");
      continue;
    }
    if (job.postedAt && job.postedAt.getTime() < cutoff) {
      drop("stale");
      continue;
    }

    // Remote preference.
    if (pref.remote === "remote" && (job.remote === "onsite" || job.remote === "hybrid")) {
      drop("remote");
      continue;
    }
    if (pref.remote === "onsite" && job.remote === "remote") {
      drop("remote");
      continue;
    }

    // Location: remote jobs pass unless the candidate wants onsite; unknown locations pass.
    const hasLocation = Boolean(job.location || job.city || job.country);
    const remoteOk = job.remote === "remote" && pref.remote !== "onsite";
    if (pref.locations.length > 0 && hasLocation && !remoteOk && !locationMatches(pref.locations, [job.location, job.city, job.region, job.country])) {
      drop("location");
      continue;
    }

    // Salary floor, only when currencies are comparable.
    const ceiling = annualSalaryCeiling(job.salary);
    const sameCurrency = !pref.salaryCurrency || !job.salary?.currency || job.salary.currency.toUpperCase() === pref.salaryCurrency;
    if (pref.minSalary && ceiling != null && sameCurrency && ceiling < pref.minSalary) {
      drop("salary");
      continue;
    }

    // Seniority: far too senior, or far too junior.
    const jobLevel = seniorityOfTitle(job.title);
    const requiredYears = job.requiredExperienceMonths != null ? job.requiredExperienceMonths / 12 : null;
    if (jobLevel - candidateLevel >= 2 || candidateLevel - jobLevel >= 3 || (requiredYears != null && requiredYears > profile.yearsExperience + 3)) {
      drop("seniority");
      continue;
    }

    // Zero skill overlap, judged only when there is a real description to look at.
    const text = `${job.title}\n${job.description ?? ""}`;
    const matchedSkills = skillsInText(profile.skills, text);
    if (matchedSkills.length === 0 && (job.description?.length ?? 0) >= MIN_DESCRIPTION_FOR_SKILL_CHECK && profile.skills.length > 0) {
      drop("skills");
      continue;
    }

    kept.push({ job, matchedSkills });
  }
  return { kept, dropped };
}
