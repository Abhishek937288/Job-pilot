import type { ApplyLink, JobSourceName, RemoteType, SalaryDto } from "@jobpilot/shared";
import { fingerprintOf, jobKeyOf } from "./keys.js";
import type { NormalizedJob } from "./types.js";

export interface JobInput {
  source: JobSourceName;
  sourceJobId?: string | null;
  title: string;
  company: string;
  location?: string | null;
  city?: string | null;
  region?: string | null;
  country?: string | null;
  remote?: RemoteType;
  salary?: SalaryDto | null;
  applyLinks: ApplyLink[];
  postedAt?: Date | null;
  description?: string | null;
  employmentType?: string | null;
  requiredExperienceMonths?: number | null;
}

const validDate = (d: Date | null | undefined) => (d && !Number.isNaN(d.getTime()) ? d : null);

/** City from "Pune, Maharashtra, India" style strings when the source has no separate field. */
export function cityFromLocation(location: string | null | undefined): string | null {
  const first = location?.split(/[,;/|]/)[0]?.trim();
  return first && !/remote|anywhere|multiple/i.test(first) ? first : null;
}

export function buildJob(i: JobInput): NormalizedJob {
  const title = i.title.trim().replace(/\s+/g, " ");
  const company = i.company.trim().replace(/\s+/g, " ") || "Unknown company";
  const city = i.city?.trim() || cityFromLocation(i.location);
  const sourceJobId = i.sourceJobId?.trim() || null;
  return {
    source: i.source,
    sourceJobId,
    jobKey: jobKeyOf(i.source, sourceJobId, title, company, city),
    fingerprint: fingerprintOf(title, company, city),
    title,
    company,
    location: i.location?.trim() || null,
    city,
    region: i.region?.trim() || null,
    country: i.country?.trim() || null,
    remote: i.remote ?? "unknown",
    salary: i.salary ?? null,
    applyLinks: i.applyLinks.filter((l) => /^https?:\/\//i.test(l.url)),
    postedAt: validDate(i.postedAt),
    description: i.description?.trim() || null,
    employmentType: i.employmentType ?? null,
    requiredExperienceMonths: i.requiredExperienceMonths ?? null,
    sources: [i.source],
  };
}
