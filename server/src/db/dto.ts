import type { CompanyDto, JobMatchDto, JobStatus, ProfileDto, SearchRunDto } from "@jobpilot/shared";
import type { CompanyDoc } from "./models/company.js";
import type { JobMatchDoc } from "./models/jobMatch.js";
import type { ProfileDoc } from "./models/profile.js";
import type { SearchRunDoc } from "./models/searchRun.js";

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);

export function profileDto(p: ProfileDoc, jobCounts: Record<JobStatus, number> = { new: 0, done: 0, deleted: 0 }): ProfileDto {
  const pref = p.preferences!;
  return {
    id: String(p._id),
    label: p.label,
    parsed: {
      name: p.parsed?.name ?? null,
      email: p.parsed?.email ?? null,
      location: p.parsed?.location ?? null,
      headline: p.parsed?.headline ?? null,
      skills: [...(p.parsed?.skills ?? [])],
      experience: (p.parsed?.experience ?? []).map((e) => ({
        company: e.company ?? null,
        title: e.title ?? null,
        start: e.start ?? null,
        end: e.end ?? null,
        summary: e.summary ?? null,
      })),
      education: (p.parsed?.education ?? []).map((e) => ({
        institution: e.institution ?? null,
        degree: e.degree ?? null,
        field: e.field ?? null,
        start: e.start ?? null,
        end: e.end ?? null,
      })),
    },
    yearsExperience: p.yearsExperience,
    skills: [...p.skills],
    preferences: {
      desiredRole: pref.desiredRole,
      locations: [...pref.locations],
      remote: pref.remote as ProfileDto["preferences"]["remote"],
      minSalary: pref.minSalary ?? null,
      salaryCurrency: pref.salaryCurrency ?? null,
      noticePeriodDays: pref.noticePeriodDays ?? null,
      country: pref.country ?? "in",
    },
    extraction: { method: p.extraction!.method as "text" | "vision", textChars: p.extraction!.textChars },
    consentAt: p.consentAt.toISOString(),
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
    lastSearchAt: iso(p.lastSearchAt),
    expiresAt: iso(p.expiresAt),
    jobCounts,
  };
}

export function jobMatchDto(j: JobMatchDoc): JobMatchDto {
  const job = j.job!;
  const m = j.match;
  return {
    id: String(j._id),
    profileId: String(j.profileId),
    jobKey: j.jobKey,
    job: {
      title: job.title,
      company: job.company,
      location: job.location ?? null,
      city: job.city ?? null,
      country: job.country ?? null,
      remote: job.remote as JobMatchDto["job"]["remote"],
      salary: job.salary
        ? {
            min: job.salary.min ?? null,
            max: job.salary.max ?? null,
            currency: job.salary.currency ?? null,
            period: (job.salary.period ?? null) as NonNullable<JobMatchDto["job"]["salary"]>["period"],
          }
        : null,
      applyLinks: job.applyLinks.map((l) => ({ url: l.url!, source: l.source ?? "", isDirect: Boolean(l.isDirect) })),
      postedAt: iso(job.postedAt),
      source: job.source as JobMatchDto["job"]["source"],
      sources: job.sources as JobMatchDto["job"]["sources"],
      snippet: job.snippet ?? null,
      employmentType: job.employmentType ?? null,
      closedAt: iso(job.closedAt),
    },
    match:
      m && m.score != null
        ? {
            score: m.score,
            scores: {
              skills: m.scores?.skills ?? 0,
              seniority: m.scores?.seniority ?? 0,
              location: m.scores?.location ?? 0,
              salary: m.scores?.salary ?? null,
            },
            matchedSkills: [...(m.matchedSkills ?? [])],
            missingSkills: [...(m.missingSkills ?? [])],
            reason: m.reason ?? "",
            verdict: (m.verdict ?? "poor") as NonNullable<JobMatchDto["match"]>["verdict"],
            redFlags: [...(m.redFlags ?? [])],
            explained: Boolean(m.explained),
            scoredAt: iso(m.scoredAt) ?? new Date(0).toISOString(),
          }
        : null,
    status: j.status as JobStatus,
    doneAt: iso(j.doneAt),
    deletedAt: iso(j.deletedAt),
    firstSeenAt: j.firstSeenAt.toISOString(),
    lastSeenAt: j.lastSeenAt.toISOString(),
    timesSeen: j.timesSeen,
  };
}

export function searchRunDto(r: SearchRunDoc): SearchRunDto {
  return {
    id: String(r._id),
    profileId: String(r.profileId),
    status: r.status as SearchRunDto["status"],
    trigger: r.trigger as SearchRunDto["trigger"],
    queries: r.queries.map((q) => ({ query: q.query ?? "", location: q.location ?? null, remoteOnly: Boolean(q.remoteOnly) })),
    steps: r.steps.map((s) => ({ step: s.step as SearchRunDto["steps"][number]["step"], message: s.message ?? "", at: iso(s.at)! })),
    stats: (r.stats ?? null) as SearchRunDto["stats"],
    metrics: (r.metrics ?? null) as SearchRunDto["metrics"],
    error: r.error ?? null,
    createdAt: r.createdAt.toISOString(),
    finishedAt: iso(r.finishedAt),
  };
}

export function companyDto(c: CompanyDoc, currentUserId: string | null): CompanyDto {
  return {
    id: String(c._id),
    name: c.name,
    careerUrl: c.careerUrl,
    atsType: c.atsType as CompanyDto["atsType"],
    atsToken: c.atsToken ?? null,
    lastCheckedAt: iso(c.lastCheckedAt),
    lastError: c.lastError ?? null,
    openJobs: c.openJobs ?? 0,
    discoveredBy: c.discoveredBy as CompanyDto["discoveredBy"],
    canDelete: Boolean(currentUserId && c.addedBy && String(c.addedBy) === currentUserId),
  };
}
