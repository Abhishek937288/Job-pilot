import { profileDataSchema, type ProfileData, type ProfileExtraction } from "@jobpilot/shared";

function cleanString(s: string | null): string | null {
  const t = s?.replace(/\s+/g, " ").trim() ?? "";
  return t === "" ? null : t;
}

function cleanList(list: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of list) {
    const v = cleanString(raw);
    if (!v || seen.has(v.toLowerCase())) continue;
    seen.add(v.toLowerCase());
    out.push(v);
  }
  return out;
}

function cleanYear(y: number | null): number | null {
  if (y === null || !Number.isFinite(y)) return null;
  const r = Math.round(y);
  return r >= 1900 && r <= 2100 ? r : null;
}

/** Turn raw (schema-valid) LLM output into clean, DB-ready profile data. */
export function normalizeExtraction(e: ProfileExtraction): ProfileData {
  const seenSkills = new Set<string>();
  const skills = e.skills.flatMap((s) => {
    const name = cleanString(s.name);
    if (!name || seenSkills.has(name.toLowerCase())) return [];
    seenSkills.add(name.toLowerCase());
    return [{ name, proficiency: s.proficiency }];
  });

  const years = e.totalYearsExperience;
  return profileDataSchema.parse({
    name: cleanString(e.name),
    headline: cleanString(e.headline),
    totalYearsExperience: years !== null && Number.isFinite(years) && years >= 0 && years <= 70 ? Math.round(years * 10) / 10 : null,
    skills,
    roles: cleanList(e.roles),
    companies: cleanList(e.companies),
    education: e.education.flatMap((ed) => {
      const institution = cleanString(ed.institution);
      if (!institution) return [];
      return [
        {
          institution,
          degree: cleanString(ed.degree),
          field: cleanString(ed.field),
          startYear: cleanYear(ed.startYear),
          endYear: cleanYear(ed.endYear),
        },
      ];
    }),
    projects: e.projects.flatMap((p) => {
      const name = cleanString(p.name);
      if (!name) return [];
      return [{ name, description: cleanString(p.description), technologies: cleanList(p.technologies) }];
    }),
    targetTitles: cleanList(e.targetTitles),
    preferredLocations: cleanList(e.preferredLocations),
    remotePreference: e.remotePreference,
    noticePeriod: cleanString(e.noticePeriod),
    expectedSalary: cleanString(e.expectedSalary),
  });
}

/**
 * Job-search preferences rarely appear in a resume, so when a new resume is uploaded
 * keep what I already entered unless the new resume states something.
 */
export function carryOverPreferences(next: ProfileData, previous: ProfileData | null): ProfileData {
  if (!previous) return next;
  return {
    ...next,
    targetTitles: next.targetTitles.length > 0 ? next.targetTitles : previous.targetTitles,
    preferredLocations: next.preferredLocations.length > 0 ? next.preferredLocations : previous.preferredLocations,
    remotePreference: next.remotePreference ?? previous.remotePreference,
    noticePeriod: next.noticePeriod ?? previous.noticePeriod,
    expectedSalary: next.expectedSalary ?? previous.expectedSalary,
  };
}
