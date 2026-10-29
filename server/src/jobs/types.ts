import type { ApplyLink, JobSourceName, Preferences, RemoteType, SalaryDto } from "@jobpilot/shared";
import type { SearchQuery } from "../llm/generateQueries.js";
import type { Meter } from "../llm/meter.js";

/** The one job shape every source returns. */
export interface NormalizedJob {
  source: JobSourceName;
  /** Id in the source system, when it has one. */
  sourceJobId: string | null;
  jobKey: string;
  fingerprint: string;
  title: string;
  company: string;
  location: string | null;
  city: string | null;
  region: string | null;
  country: string | null;
  remote: RemoteType;
  salary: SalaryDto | null;
  applyLinks: ApplyLink[];
  postedAt: Date | null;
  description: string | null;
  employmentType: string | null;
  requiredExperienceMonths: number | null;
  /** Every source this job was seen in, after dedupe. */
  sources: JobSourceName[];
}

export interface SearchContext {
  queries: SearchQuery[];
  preferences: Preferences;
  desiredRole: string;
  meter: Meter;
}

/** A job source. Each returns jobs in the normalized shape; errors are reported per source. */
export interface JobSource {
  readonly name: JobSourceName | "watchlist";
  fetch(ctx: SearchContext): Promise<NormalizedJob[]>;
}
