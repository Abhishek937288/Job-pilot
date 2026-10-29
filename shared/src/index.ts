/**
 * Contracts shared by the API (`server/`) and the web app (`web/`): request schemas, enums and the
 * JSON shapes the API returns. Dates are ISO strings on the wire.
 */
import { z } from "zod";

// ------------------------------------------------------------------ enums

export const REMOTE_TYPES = ["remote", "hybrid", "onsite", "unknown"] as const;
export type RemoteType = (typeof REMOTE_TYPES)[number];

export const REMOTE_PREFERENCES = ["any", "remote", "hybrid", "onsite"] as const;
export type RemotePreference = (typeof REMOTE_PREFERENCES)[number];

export const JOB_STATUSES = ["new", "done", "deleted"] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

export const VERDICTS = ["strong", "good", "stretch", "poor"] as const;
export type Verdict = (typeof VERDICTS)[number];

export const ATS_TYPES = ["greenhouse", "lever", "ashby", "workable", "smartrecruiters", "jsonld"] as const;
export type AtsType = (typeof ATS_TYPES)[number];

export const JOB_SOURCES = ["jsearch", ...ATS_TYPES, "web_search"] as const;
export type JobSourceName = (typeof JOB_SOURCES)[number];

export const EXPORT_FORMATS = ["csv", "xlsx", "json"] as const;
export type ExportFormat = (typeof EXPORT_FORMATS)[number];

export const RUN_STATUSES = ["queued", "running", "succeeded", "failed"] as const;
export type RunStatus = (typeof RUN_STATUSES)[number];

/** Progress steps of a search run, in order. */
export const RUN_STEPS = ["queries", "fetch", "prefilter", "web_search", "rank", "explain", "done"] as const;
export type RunStep = (typeof RUN_STEPS)[number];

// ------------------------------------------------------------------ requests

export const credentialsSchema = z.object({
  email: z.email().trim().toLowerCase().max(254),
  password: z.string().min(8, "Password must be at least 8 characters").max(200),
});
export type Credentials = z.infer<typeof credentialsSchema>;

export const registerSchema = credentialsSchema.extend({
  name: z.string().trim().min(1).max(100).nullable().default(null),
});
export type RegisterInput = z.input<typeof registerSchema>;

export const preferencesSchema = z.object({
  desiredRole: z.string().trim().min(2).max(120),
  /** Cities, regions or countries. Empty means anywhere. */
  locations: z.array(z.string().trim().min(2).max(80)).max(10).default([]),
  remote: z.enum(REMOTE_PREFERENCES).default("any"),
  /** Minimum annual salary, in `salaryCurrency`. */
  minSalary: z.number().int().positive().max(1_000_000_000).nullable().default(null),
  salaryCurrency: z
    .string()
    .trim()
    .regex(/^[A-Za-z]{3}$/, "Use a 3-letter currency code")
    .transform((s) => s.toUpperCase())
    .nullable()
    .default(null),
  noticePeriodDays: z.number().int().min(0).max(365).nullable().default(null),
  /** ISO 3166-1 alpha-2 country used for job search. */
  country: z
    .string()
    .trim()
    .regex(/^[A-Za-z]{2}$/, "Use a 2-letter country code")
    .transform((s) => s.toLowerCase())
    .default("in"),
});
export type Preferences = z.infer<typeof preferencesSchema>;
export type PreferencesInput = z.input<typeof preferencesSchema>;

/**
 * Multipart fields of `POST /profiles` besides `file`:
 * `preferences` (JSON string of PreferencesInput), `consent` ("true"), optional `label`.
 */
export const createProfileFieldsSchema = z.object({
  preferences: z.string().transform((s, ctx) => {
    try {
      return JSON.parse(s) as unknown;
    } catch {
      ctx.addIssue({ code: "custom", message: "preferences must be JSON" });
      return z.NEVER;
    }
  }).pipe(preferencesSchema),
  consent: z.literal("true", { message: "Consent is required to process your resume" }),
  label: z.string().trim().min(1).max(100).optional(),
});

export const updateProfileSchema = z
  .object({
    label: z.string().trim().min(1).max(100).optional(),
    preferences: preferencesSchema.optional(),
  })
  .refine((v) => v.label !== undefined || v.preferences !== undefined, "Nothing to update");
export type UpdateProfileInput = z.input<typeof updateProfileSchema>;

export const listJobsQuerySchema = z.object({
  status: z.enum(JOB_STATUSES).default("new"),
  minScore: z.coerce.number().int().min(0).max(100).default(0),
});
export type ListJobsQuery = z.input<typeof listJobsQuerySchema>;

export const updateJobSchema = z.object({ status: z.enum(JOB_STATUSES) });
export type UpdateJobInput = z.infer<typeof updateJobSchema>;

export const exportQuerySchema = z.object({
  format: z.enum(EXPORT_FORMATS).default("csv"),
  status: z.enum(JOB_STATUSES).optional(),
});

export const createCompanySchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  /** A careers page or ATS board URL; the ATS type and token are detected from it when possible. */
  careerUrl: z.url({ protocol: /^https?$/ }).max(500),
  atsType: z.enum(ATS_TYPES).optional(),
  atsToken: z.string().trim().min(1).max(120).optional(),
});
export type CreateCompanyInput = z.infer<typeof createCompanySchema>;

// ------------------------------------------------------------------ responses

export interface ApiError {
  error: string;
  /** Field-level messages for 400 responses. */
  issues?: { path: string; message: string }[];
}

export interface UserDto {
  id: string;
  email: string | null;
  name: string | null;
  isGuest: boolean;
  /** When guest data is deleted automatically. */
  guestExpiresAt: string | null;
  authProviders: ("password" | "google")[];
  limits: { maxProfiles: number; dailySearches: number; searchesUsedToday: number };
}

export interface AuthConfigDto {
  googleEnabled: boolean;
  guestEnabled: boolean;
}

export interface ExperienceItem {
  company: string | null;
  title: string | null;
  /** "YYYY-MM" or null. */
  start: string | null;
  /** "YYYY-MM", "present" or null. */
  end: string | null;
  summary: string | null;
}

export interface EducationItem {
  institution: string | null;
  degree: string | null;
  field: string | null;
  start: string | null;
  end: string | null;
}

export interface ParsedResume {
  name: string | null;
  email: string | null;
  location: string | null;
  headline: string | null;
  skills: string[];
  experience: ExperienceItem[];
  education: EducationItem[];
}

export interface ProfileDto {
  id: string;
  label: string;
  parsed: ParsedResume;
  /** Computed in code from experience dates (overlaps merged). */
  yearsExperience: number;
  /** Skills after alias normalization ("nodejs" -> "node.js"). */
  skills: string[];
  preferences: Preferences;
  extraction: { method: "text" | "vision"; textChars: number };
  consentAt: string;
  createdAt: string;
  updatedAt: string;
  lastSearchAt: string | null;
  expiresAt: string | null;
  jobCounts: Record<JobStatus, number>;
}

export interface ApplyLink {
  url: string;
  /** Publisher or ATS, e.g. "LinkedIn", "greenhouse". */
  source: string;
  /** True for the company's own careers page or ATS. Direct links are listed first. */
  isDirect: boolean;
}

export interface SalaryDto {
  min: number | null;
  max: number | null;
  currency: string | null;
  period: "hour" | "day" | "week" | "month" | "year" | null;
}

export interface JobDto {
  title: string;
  company: string;
  location: string | null;
  city: string | null;
  country: string | null;
  remote: RemoteType;
  salary: SalaryDto | null;
  applyLinks: ApplyLink[];
  postedAt: string | null;
  source: JobSourceName;
  /** Every source this job was seen in. */
  sources: JobSourceName[];
  /** First ~600 characters of the description, plain text. */
  snippet: string | null;
  employmentType: string | null;
  closedAt: string | null;
}

export interface MatchScores {
  skills: number;
  seniority: number;
  location: number;
  salary: number | null;
}

export interface MatchDto {
  /** 0-100, computed in code: 0.5 skills + 0.2 seniority + 0.2 location + 0.1 salary (rescaled when salary is null). */
  score: number;
  scores: MatchScores;
  matchedSkills: string[];
  missingSkills: string[];
  reason: string;
  verdict: Verdict;
  redFlags: string[];
  /** True when the reason was rewritten by the stronger model (top results only). */
  explained: boolean;
  scoredAt: string;
}

export interface JobMatchDto {
  id: string;
  profileId: string;
  jobKey: string;
  job: JobDto;
  match: MatchDto | null;
  status: JobStatus;
  doneAt: string | null;
  deletedAt: string | null;
  firstSeenAt: string;
  lastSeenAt: string;
  timesSeen: number;
}

export interface RunStats {
  fetched: number;
  afterDedupe: number;
  droppedByPrefilter: Record<string, number>;
  afterPrefilter: number;
  reusedScores: number;
  ranked: number;
  newJobs: number;
  bySource: Partial<Record<JobSourceName, number>>;
  /** Source name ("jsearch", "watchlist", "web_search") -> error message. */
  sourceErrors: Record<string, string>;
}

export interface RunMetrics {
  /** Milliseconds from the run starting to the first job being saved. */
  firstResultMs: number | null;
  totalMs: number | null;
  llmInputTokens: number;
  llmOutputTokens: number;
  llmCostUsd: number;
  jsearchRequests: number;
  webSearchCalls: number;
  /** LLM + JSearch + web search, estimated from configured prices. */
  costUsd: number;
}

export interface RunStepDto {
  step: RunStep;
  message: string;
  at: string;
}

export interface SearchRunDto {
  id: string;
  profileId: string;
  status: RunStatus;
  trigger: "initial" | "manual";
  queries: { query: string; location: string | null; remoteOnly: boolean }[];
  steps: RunStepDto[];
  stats: RunStats | null;
  metrics: RunMetrics | null;
  error: string | null;
  createdAt: string;
  finishedAt: string | null;
}

export interface CompanyDto {
  id: string;
  name: string;
  careerUrl: string;
  atsType: AtsType;
  atsToken: string | null;
  lastCheckedAt: string | null;
  lastError: string | null;
  openJobs: number;
  discoveredBy: "user" | "web_search";
  /** The current user added it and may delete it. */
  canDelete: boolean;
}

export interface CreateProfileResponse {
  profile: ProfileDto;
  run: SearchRunDto;
}

// ------------------------------------------------------------------ server-sent events (GET /events)

export type ServerEvent =
  | { type: "run.progress"; runId: string; profileId: string; step: RunStep; message: string }
  | { type: "run.job"; runId: string; profileId: string; job: JobMatchDto }
  | { type: "run.finished"; run: SearchRunDto };
