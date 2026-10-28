import type { ApplicationStatus, JobDto, JobListQuery, JobListResponse } from "@jobpilot/shared";
import { prisma } from "../db/prisma.js";
import { Prisma } from "../generated/prisma/client.js";
import { HttpError } from "../lib/http-error.js";

type VisibleJobRow = Omit<JobDto, "postedAt" | "firstSeenAt"> & {
  postedAt: Date | null;
  firstSeenAt: Date;
  total: bigint;
};

function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/**
 * THE ONLY WAY THE JOB LIST IS FETCHED.
 *
 * Exclusion rule, enforced in SQL:
 * - only jobs whose own status is NEW or SAVED (or that have no status row);
 * - never a job that shares its canonicalUrl OR its fingerprint with any job marked DONE or IGNORED,
 *   so a job I finished stays hidden when it reappears under a different URL;
 * - never an expired job;
 * - one row per fingerprint (the same posting found under several URLs shows once, SAVED copy first).
 *
 * All filter values are bound parameters (Prisma.sql), never concatenated.
 */
export async function getVisibleJobs(filters: JobListQuery): Promise<JobListResponse> {
  const conditions: Prisma.Sql[] = [];
  if (filters.status) conditions.push(Prisma.sql`v.status = ${filters.status}`);
  if (filters.applyMethod) conditions.push(Prisma.sql`v."applyMethod" = ${filters.applyMethod}`);
  if (filters.locationMatch?.length) conditions.push(Prisma.sql`v."locationMatch" = ANY(${filters.locationMatch}::text[])`);
  if (filters.location) conditions.push(Prisma.sql`v.location ILIKE ${`%${escapeLike(filters.location)}%`} ESCAPE '\\'`);
  if (filters.minFitScore !== undefined) conditions.push(Prisma.sql`v."fitScore" >= ${filters.minFitScore}`);
  const where = conditions.length ? Prisma.sql`WHERE ${Prisma.join(conditions, " AND ")}` : Prisma.empty;

  const rows = await prisma.$queryRaw<VisibleJobRow[]>`
    WITH candidates AS (
      SELECT DISTINCT ON (j.fingerprint)
        j.id, j."canonicalUrl", j.company, j.title, j.location,
        j."locationMatch"::text AS "locationMatch", j."remoteType"::text AS "remoteType",
        j."applyMethod"::text AS "applyMethod", j."applyUrl", j."applyEmails", j.snippet,
        j."fitScore", j."needsReview", j.source::text AS source,
        COALESCE(s.status::text, 'NEW') AS status, j."postedAt", j."firstSeenAt"
      FROM "Job" j
      LEFT JOIN "JobStatus" s ON s."jobId" = j.id
      WHERE COALESCE(s.status::text, 'NEW') IN ('NEW', 'SAVED')
        AND j.expired = false
        AND NOT EXISTS (
          SELECT 1
          FROM "Job" x
          JOIN "JobStatus" xs ON xs."jobId" = x.id
          WHERE xs.status::text IN ('DONE', 'IGNORED')
            AND (x.fingerprint = j.fingerprint OR x."canonicalUrl" = j."canonicalUrl")
        )
      ORDER BY j.fingerprint, (s.status::text = 'SAVED') DESC NULLS LAST, j."firstSeenAt" ASC, j.id ASC
    )
    SELECT v.*, COUNT(*) OVER () AS total
    FROM candidates v
    ${where}
    ORDER BY v."fitScore" DESC NULLS LAST, v."firstSeenAt" DESC, v.id ASC
    LIMIT ${filters.limit} OFFSET ${filters.offset}
  `;

  return {
    total: Number(rows[0]?.total ?? 0),
    items: rows.map(({ total: _total, postedAt, firstSeenAt, ...r }) => ({
      ...r,
      postedAt: postedAt?.toISOString() ?? null,
      firstSeenAt: firstSeenAt.toISOString(),
    })),
  };
}

export async function setJobStatus(jobId: string, status: ApplicationStatus, notes?: string | null): Promise<{ jobId: string; status: ApplicationStatus }> {
  const job = await prisma.job.findUnique({ where: { id: jobId }, select: { id: true } });
  if (!job) throw new HttpError(404, "NOT_FOUND", "Job not found");
  const row = await prisma.jobStatus.upsert({
    where: { jobId },
    create: { jobId, status, notes: notes ?? null },
    update: { status, ...(notes !== undefined ? { notes } : {}) },
  });
  return { jobId: row.jobId, status: row.status };
}
