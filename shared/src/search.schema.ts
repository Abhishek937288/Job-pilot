import { z } from "zod";

export const APPLY_METHODS = [
  "EMAIL",
  "GREENHOUSE",
  "LEVER",
  "ASHBY",
  "WORKDAY",
  "COMPANY_PORTAL",
  "LINKEDIN_EASY_APPLY",
  "REFERRAL_ONLY",
  "UNKNOWN",
] as const;
export type ApplyMethod = (typeof APPLY_METHODS)[number];

export const REMOTE_TYPES = ["ONSITE", "HYBRID", "REMOTE", "UNKNOWN"] as const;
export type RemoteType = (typeof REMOTE_TYPES)[number];

export const LOCATION_MATCHES = ["MATCH", "REMOTE", "MISMATCH", "UNKNOWN"] as const;
export type LocationMatch = (typeof LOCATION_MATCHES)[number];

export const JOB_SOURCES = ["SERPER", "GREENHOUSE", "LEVER", "ASHBY"] as const;
export type JobSource = (typeof JOB_SOURCES)[number];

export const ATS_PROVIDERS = ["GREENHOUSE", "LEVER", "ASHBY"] as const;
export type AtsProvider = (typeof ATS_PROVIDERS)[number];

export const APPLICATION_STATUSES = ["NEW", "DONE", "IGNORED", "SAVED"] as const;
export type ApplicationStatus = (typeof APPLICATION_STATUSES)[number];
/** The only statuses the job list can ever show. */
export const VISIBLE_STATUSES = ["NEW", "SAVED"] as const satisfies readonly ApplicationStatus[];

export const SEARCH_RUN_STATUSES = ["DRAFT", "QUEUED", "RUNNING", "SUCCEEDED", "FAILED"] as const;
export type SearchRunStatus = (typeof SEARCH_RUN_STATUSES)[number];

/** One Serper query. `location` is the Serper/Google location name, or null for none. */
export const searchQuerySchema = z.object({
  q: z.string().trim().min(3).max(400),
  location: z.string().trim().min(2).max(120).nullable(),
});
export type SearchQuery = z.infer<typeof searchQuerySchema>;

/** LLM output for query generation (strict-mode compatible: no optionals). */
export const generatedQueriesSchema = z.object({
  queries: z.array(
    z.object({
      q: z.string(),
      location: z.string().nullable(),
    }),
  ),
});

export const startSearchRunSchema = z.object({
  queries: z.array(searchQuerySchema).max(100),
  includeAts: z.boolean(),
});
export type StartSearchRunRequest = z.infer<typeof startSearchRunSchema>;

export interface SearchRunLogEntry {
  at: string;
  level: "info" | "warn" | "error";
  msg: string;
}

export interface SerperCreditInfo {
  /** Estimate: SERPER_CREDITS_TOTAL minus credits logged on all runs. */
  estimatedRemaining: number;
  total: number;
  used: number;
  lowWarningThreshold: number;
  maxQueriesPerRun: number;
  configured: boolean;
}

export interface SearchRunDto {
  id: string;
  status: SearchRunStatus;
  queries: SearchQuery[];
  queryGenerator: string;
  includeAts: boolean;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  newJobsCount: number;
  resultsCount: number;
  duplicateUrlCount: number;
  blockedCount: number;
  serperCalls: number;
  serperCredits: number;
  atsCalls: number;
  error: string | null;
  log: SearchRunLogEntry[];
}

export const jobListQuerySchema = z.object({
  status: z.enum(VISIBLE_STATUSES).optional(),
  applyMethod: z.enum(APPLY_METHODS).optional(),
  locationMatch: z
    .string()
    .transform((s) => s.split(",").filter(Boolean))
    .pipe(z.array(z.enum(LOCATION_MATCHES)))
    .optional(),
  location: z.string().trim().max(100).optional(),
  minFitScore: z.coerce.number().int().min(0).max(100).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});
export type JobListQuery = z.infer<typeof jobListQuerySchema>;

export interface JobDto {
  id: string;
  canonicalUrl: string;
  company: string;
  title: string;
  location: string | null;
  locationMatch: LocationMatch;
  remoteType: RemoteType;
  applyMethod: ApplyMethod;
  applyUrl: string | null;
  applyEmails: string[];
  snippet: string | null;
  fitScore: number | null;
  needsReview: boolean;
  source: JobSource;
  status: (typeof VISIBLE_STATUSES)[number];
  postedAt: string | null;
  firstSeenAt: string;
}

export interface JobListResponse {
  items: JobDto[];
  total: number;
}

export const setJobStatusSchema = z.object({
  status: z.enum(APPLICATION_STATUSES),
  notes: z.string().trim().max(2000).nullable().optional(),
});

export const addAtsCompanySchema = z.object({
  /** A board URL (boards.greenhouse.io/x, jobs.lever.co/x, jobs.ashbyhq.com/x) or a bare slug. */
  input: z.string().trim().min(1).max(300),
  provider: z.enum(ATS_PROVIDERS).nullable(),
});

export interface AtsCompanyDto {
  id: string;
  provider: AtsProvider;
  slug: string;
  displayName: string | null;
  enabled: boolean;
  lastFetchedAt: string | null;
  lastJobCount: number | null;
  lastError: string | null;
}
