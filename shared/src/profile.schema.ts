import { z } from "zod";

export const PROFICIENCIES = ["BEGINNER", "INTERMEDIATE", "ADVANCED", "EXPERT"] as const;
export const REMOTE_PREFERENCES = ["ONSITE", "HYBRID", "REMOTE", "ANY"] as const;

export const proficiencySchema = z.enum(PROFICIENCIES);
export const remotePreferenceSchema = z.enum(REMOTE_PREFERENCES);

const trimmed = z.string().trim();

export const skillSchema = z.object({
  name: trimmed.min(1),
  proficiency: proficiencySchema,
});

export const educationSchema = z.object({
  institution: trimmed.min(1),
  degree: trimmed.nullable(),
  field: trimmed.nullable(),
  startYear: z.number().int().nullable(),
  endYear: z.number().int().nullable(),
});

export const projectSchema = z.object({
  name: trimmed.min(1),
  description: trimmed.nullable(),
  technologies: z.array(trimmed.min(1)),
});

/**
 * Shape the LLM must return. OpenAI strict mode requires every key to be present,
 * so "unknown" is expressed as null / [] and never via .optional().
 */
export const profileExtractionSchema = z.object({
  name: z.string().nullable(),
  headline: z.string().nullable(),
  totalYearsExperience: z.number().nullable(),
  skills: z.array(
    z.object({
      name: z.string(),
      proficiency: proficiencySchema,
    }),
  ),
  roles: z.array(z.string()),
  companies: z.array(z.string()),
  education: z.array(
    z.object({
      institution: z.string(),
      degree: z.string().nullable(),
      field: z.string().nullable(),
      startYear: z.number().nullable(),
      endYear: z.number().nullable(),
    }),
  ),
  projects: z.array(
    z.object({
      name: z.string(),
      description: z.string().nullable(),
      technologies: z.array(z.string()),
    }),
  ),
  targetTitles: z.array(z.string()),
  preferredLocations: z.array(z.string()),
  remotePreference: remotePreferenceSchema.nullable(),
  noticePeriod: z.string().nullable(),
  expectedSalary: z.string().nullable(),
});
export type ProfileExtraction = z.infer<typeof profileExtractionSchema>;

/** Editable profile, as sent by the profile form and stored in the DB. */
export const profileDataSchema = z.object({
  name: trimmed.nullable(),
  headline: trimmed.nullable(),
  totalYearsExperience: z.number().min(0).max(70).nullable(),
  skills: z.array(skillSchema),
  roles: z.array(trimmed.min(1)),
  companies: z.array(trimmed.min(1)),
  education: z.array(educationSchema),
  projects: z.array(projectSchema),
  targetTitles: z.array(trimmed.min(1)),
  preferredLocations: z.array(trimmed.min(1)),
  remotePreference: remotePreferenceSchema.nullable(),
  noticePeriod: trimmed.nullable(),
  expectedSalary: trimmed.nullable(),
});
export type ProfileData = z.infer<typeof profileDataSchema>;

/** Fields that must be filled before a job search may run. */
export const REQUIRED_PROFILE_FIELDS = [
  "name",
  "skills",
  "targetTitles",
  "preferredLocations",
  "remotePreference",
] as const satisfies readonly (keyof ProfileData)[];
export type RequiredProfileField = (typeof REQUIRED_PROFILE_FIELDS)[number];

export function missingRequiredFields(p: ProfileData): RequiredProfileField[] {
  return REQUIRED_PROFILE_FIELDS.filter((field) => {
    const value = p[field];
    if (value === null) return true;
    if (Array.isArray(value)) return value.length === 0;
    return typeof value === "string" && value.trim() === "";
  });
}
