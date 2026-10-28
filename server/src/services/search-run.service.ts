import {
  generatedQueriesSchema,
  searchQuerySchema,
  type ProfileData,
  type SearchQuery,
  type SearchRunDto,
  type SearchRunLogEntry,
  type SerperCreditInfo,
  type StartSearchRunRequest,
} from "@jobpilot/shared";
import { z } from "zod";
import { env } from "../config/env.js";
import { prisma } from "../db/prisma.js";
import { Prisma, type SearchRun } from "../generated/prisma/client.js";
import { HttpError } from "../lib/http-error.js";
import { logger } from "../lib/logger.js";
import { structuredCall } from "../llm/client.js";
import { SEARCH_QUERIES_SYSTEM, searchQueriesUserPrompt } from "../llm/prompts/searchQueries.prompt.js";
import { getBoss, QUEUES, type SearchRunJob } from "../queue/boss.js";
import { atsAdapters, type AtsAdapters } from "../search/ats/index.js";
import { candidateFromAtsJob, candidateFromHit, type JobCandidate } from "../search/candidate.js";
import { jobFingerprint } from "../search/fingerprint.js";
import { matchLocation } from "../search/location.js";
import { SearchProviderError, type SearchProvider } from "../search/provider.js";
import { dedupeQueries, fallbackQueries, locationOptions, normalizeSiteGroup, sanitizeLocation } from "../search/queries.js";
import { SerperProvider } from "../search/serper.provider.js";
import { titleMatchesTargets } from "../search/title-match.js";
import { isBlockedDomain } from "../search/url-canonical.js";
import { requireSearchReadyProfile } from "./profile.service.js";

const queriesSchema = z.array(searchQuerySchema);

function toDto(r: SearchRun): SearchRunDto {
  return {
    id: r.id,
    status: r.status,
    queries: queriesSchema.catch([]).parse(r.queries),
    queryGenerator: r.queryGenerator,
    includeAts: r.includeAts,
    createdAt: r.createdAt.toISOString(),
    startedAt: r.startedAt?.toISOString() ?? null,
    finishedAt: r.finishedAt?.toISOString() ?? null,
    newJobsCount: r.newJobsCount,
    resultsCount: r.resultsCount,
    duplicateUrlCount: r.duplicateUrlCount,
    blockedCount: r.blockedCount,
    serperCalls: r.serperCalls,
    serperCredits: r.serperCredits,
    atsCalls: r.atsCalls,
    error: r.error,
    log: (Array.isArray(r.log) ? r.log : []) as unknown as SearchRunLogEntry[],
  };
}

export async function getCreditInfo(): Promise<SerperCreditInfo> {
  const agg = await prisma.searchRun.aggregate({ _sum: { serperCredits: true } });
  const used = agg._sum.serperCredits ?? 0;
  return {
    total: env.SERPER_CREDITS_TOTAL,
    used,
    estimatedRemaining: Math.max(0, env.SERPER_CREDITS_TOTAL - used),
    lowWarningThreshold: env.SERPER_LOW_CREDIT_WARNING,
    maxQueriesPerRun: env.SERPER_MAX_QUERIES_PER_RUN,
    configured: !!env.SERPER_API_KEY,
  };
}

export async function getSearchRun(id: string): Promise<SearchRunDto> {
  const run = await prisma.searchRun.findUnique({ where: { id } });
  if (!run) throw new HttpError(404, "NOT_FOUND", "Search run not found");
  return toDto(run);
}

export async function getLatestSearchRun(): Promise<SearchRunDto | null> {
  const run = await prisma.searchRun.findFirst({ orderBy: { createdAt: "desc" } });
  return run ? toDto(run) : null;
}

/** Generate queries with the LLM (fallback: deterministic) and save them as a DRAFT. Spends no Serper credits. */
export async function createDraftRun(): Promise<SearchRunDto> {
  const profile = (await requireSearchReadyProfile()).data;
  const max = env.SERPER_MAX_QUERIES_PER_RUN;
  const options = locationOptions(profile);

  let generator = "llm";
  let queries: SearchQuery[] = [];
  const result = await structuredCall({
    name: "search_queries",
    schema: generatedQueriesSchema,
    system: SEARCH_QUERIES_SYSTEM,
    user: searchQueriesUserPrompt(profile, options, max),
    tier: "cheap",
  });
  if (result.ok) {
    queries = result.data.queries
      .map((q) => ({ q: normalizeSiteGroup(q.q), location: sanitizeLocation(q.location, options) }))
      .filter((q) => searchQuerySchema.safeParse(q).success);
  }
  if (queries.length === 0) {
    generator = "fallback";
    logger.warn({ reason: result.ok ? "no usable queries" : result.message }, "query generation fell back to deterministic queries");
    queries = fallbackQueries(profile, max);
  }

  const run = await prisma.searchRun.create({
    data: { status: "DRAFT", queries: dedupeQueries(queries).queries.slice(0, max), queryGenerator: generator },
  });
  return toDto(run);
}

/** Confirm (possibly edited) queries and queue the run. This is the only path that spends credits. */
export async function startRun(id: string, req: StartSearchRunRequest): Promise<SearchRunDto> {
  const run = await prisma.searchRun.findUnique({ where: { id } });
  if (!run) throw new HttpError(404, "NOT_FOUND", "Search run not found");
  if (run.status !== "DRAFT") throw new HttpError(409, "NOT_DRAFT", "This run was already started");

  const { queries, removed } = dedupeQueries(req.queries);
  const max = env.SERPER_MAX_QUERIES_PER_RUN;
  if (queries.length > max) {
    throw new HttpError(422, "TOO_MANY_QUERIES", `At most ${max} queries per run (got ${queries.length} after removing duplicates)`);
  }
  if (queries.length === 0 && !req.includeAts) throw new HttpError(422, "NOTHING_TO_RUN", "Add at least one query or include ATS boards");
  if (queries.length > 0 && !env.SERPER_API_KEY) throw new HttpError(409, "SERPER_NOT_CONFIGURED", "SERPER_API_KEY is not set in .env");
  await requireSearchReadyProfile();

  const active = await prisma.searchRun.findFirst({ where: { status: { in: ["QUEUED", "RUNNING"] } }, select: { id: true } });
  if (active) throw new HttpError(409, "RUN_IN_PROGRESS", "Another search is already running");

  const updated = await prisma.searchRun.update({
    where: { id },
    data: {
      status: "QUEUED",
      queries,
      includeAts: req.includeAts,
      log: [{ at: new Date().toISOString(), level: "info", msg: `Queued ${queries.length} queries${removed ? ` (${removed} duplicates removed)` : ""}` }],
    },
  });
  const boss = await getBoss();
  const data: SearchRunJob = { searchRunId: id };
  await boss.send(QUEUES.searchRun, data);
  return toDto(updated);
}

// ---------------------------------------------------------------- execution (worker)

export interface SearchDeps {
  provider: SearchProvider | null;
  ats: AtsAdapters;
  enrichAtsHits: boolean;
}

export function defaultSearchDeps(): SearchDeps {
  return {
    provider: env.SERPER_API_KEY ? new SerperProvider({ apiKey: env.SERPER_API_KEY, gl: env.SERPER_GL }) : null,
    ats: atsAdapters,
    enrichAtsHits: env.ATS_ENRICH_SERPER_HITS,
  };
}

async function appendLog(runId: string, level: SearchRunLogEntry["level"], msg: string): Promise<void> {
  logger[level]({ searchRunId: runId }, msg);
  const entry: SearchRunLogEntry = { at: new Date().toISOString(), level, msg };
  await prisma.$executeRaw`UPDATE "SearchRun" SET log = log || ${JSON.stringify([entry])}::jsonb WHERE id = ${runId}`;
}

const toJson = (v: Record<string, unknown>) => JSON.parse(JSON.stringify(v)) as Prisma.InputJsonValue;

/** Insert new jobs (URL-deduped by the DB) and return how many new postings (fingerprints) were added. */
export async function persistCandidates(
  runId: string | null,
  candidates: JobCandidate[],
  profile: ProfileData,
): Promise<{ inserted: number; newPostings: number; alreadyKnown: number }> {
  if (candidates.length === 0) return { inserted: 0, newPostings: 0, alreadyKnown: 0 };
  const rows = candidates.map((c) => {
    const fingerprint = jobFingerprint({ company: c.company, title: c.title, location: c.location, remoteType: c.remoteType, canonicalUrl: c.canonicalUrl });
    return {
      canonicalUrl: c.canonicalUrl,
      fingerprint,
      company: c.company,
      title: c.title,
      location: c.location,
      locationMatch: matchLocation(c.allLocations.length ? c.allLocations : [c.location], c.remoteType, profile.preferredLocations),
      remoteType: c.remoteType,
      applyMethod: c.applyMethod,
      applyUrl: c.applyUrl,
      applyEmails: [],
      snippet: c.snippet,
      jdText: c.jdText,
      source: c.source,
      sourceQuery: c.sourceQuery,
      atsProvider: c.atsRef?.provider ?? null,
      atsSlug: c.atsRef?.slug ?? null,
      atsJobId: c.atsRef?.jobId ?? null,
      postedAt: c.postedAt,
      raw: toJson(c.raw),
      firstSearchRunId: runId,
    };
  });

  const urls = rows.map((r) => r.canonicalUrl);
  const [existingUrls, existingFps] = await Promise.all([
    prisma.job.findMany({ where: { canonicalUrl: { in: urls } }, select: { canonicalUrl: true } }),
    prisma.job.findMany({ where: { fingerprint: { in: rows.map((r) => r.fingerprint) } }, select: { fingerprint: true }, distinct: ["fingerprint"] }),
  ]);
  const known = new Set(existingUrls.map((e) => e.canonicalUrl));
  const knownFps = new Set(existingFps.map((e) => e.fingerprint));
  const fresh = rows.filter((r) => !known.has(r.canonicalUrl));

  const { count } = await prisma.job.createMany({ data: fresh, skipDuplicates: true });
  if (known.size) await prisma.job.updateMany({ where: { canonicalUrl: { in: [...known] } }, data: { lastSeenAt: new Date() } });

  const newPostings = new Set(fresh.filter((r) => !knownFps.has(r.fingerprint)).map((r) => r.fingerprint)).size;
  return { inserted: count, newPostings, alreadyKnown: known.size };
}

/** Worker entry point. Never retried automatically (a retry would spend credits again). */
export async function executeSearchRun(runId: string, deps: SearchDeps = defaultSearchDeps()): Promise<void> {
  const run = await prisma.searchRun.findUnique({ where: { id: runId } });
  if (!run || run.status !== "QUEUED") {
    logger.warn({ runId, status: run?.status }, "search run not QUEUED, skipping");
    return;
  }
  await prisma.searchRun.update({ where: { id: runId }, data: { status: "RUNNING", startedAt: new Date() } });

  const counters = { serperCalls: 0, serperCredits: 0, atsCalls: 0, resultsCount: 0, duplicateUrlCount: 0, blockedCount: 0 };
  const saveCounters = () => prisma.searchRun.update({ where: { id: runId }, data: counters });
  let fatal: string | null = null;

  try {
    const profile = (await requireSearchReadyProfile()).data;
    const queries = queriesSchema.parse(run.queries);
    const byUrl = new Map<string, JobCandidate>();

    // 1. Search provider: one page per query, sequential, spend logged after every call.
    if (queries.length > 0 && !deps.provider) throw new Error("No search provider configured (SERPER_API_KEY missing)");
    for (const [i, query] of queries.entries()) {
      if (fatal) break;
      await appendLog(runId, "info", `Query ${i + 1}/${queries.length}: ${query.q}${query.location ? ` [${query.location}]` : ""}`);
      try {
        const page = await deps.provider!.search(query);
        counters.serperCalls += page.requests;
        counters.serperCredits += page.credits;
        let added = 0;
        for (const hit of page.hits) {
          counters.resultsCount++;
          if (isBlockedDomain(hit.url)) {
            counters.blockedCount++;
            continue;
          }
          const c = candidateFromHit(hit, query.q);
          if (!c) continue;
          if (byUrl.has(c.canonicalUrl)) counters.duplicateUrlCount++;
          else {
            byUrl.set(c.canonicalUrl, c);
            added++;
          }
        }
        await appendLog(runId, "info", `  ${page.hits.length} results, ${added} new URLs${page.requests > 1 ? " (after 1 retry)" : ""}`);
      } catch (err) {
        if (!(err instanceof SearchProviderError)) throw err;
        counters.serperCalls += err.requests;
        await appendLog(runId, err.fatal ? "error" : "warn", `  failed: ${err.message}`);
        if (err.fatal) fatal = err.message;
      }
      await saveCounters();
    }

    // 2. Enrich ATS hits via their public JSON API (exact title/location), skipping URLs already stored.
    const existing = new Set(
      (await prisma.job.findMany({ where: { canonicalUrl: { in: [...byUrl.keys()] } }, select: { canonicalUrl: true } })).map((j) => j.canonicalUrl),
    );
    if (deps.enrichAtsHits) {
      const toEnrich = [...byUrl.values()].filter((c) => c.atsRef && !existing.has(c.canonicalUrl));
      if (toEnrich.length) await appendLog(runId, "info", `Looking up ${toEnrich.length} ATS postings for exact title/location`);
      for (const c of toEnrich) {
        const ref = c.atsRef!;
        counters.atsCalls++;
        try {
          const job = await deps.ats[ref.provider].fetchJob(ref);
          if (!job) {
            byUrl.delete(c.canonicalUrl);
            await appendLog(runId, "info", `  closed/removed, skipped: ${c.canonicalUrl}`);
            continue;
          }
          const enriched = candidateFromAtsJob(job, null, "SERPER", c);
          byUrl.delete(c.canonicalUrl);
          byUrl.set(enriched.canonicalUrl, enriched);
        } catch (err) {
          await appendLog(runId, "warn", `  ATS lookup failed for ${c.canonicalUrl}: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
      await saveCounters();
    }

    // 3. Direct ATS boards from Settings.
    if (run.includeAts) {
      const companies = await prisma.atsCompany.findMany({ where: { enabled: true }, orderBy: { createdAt: "asc" } });
      if (companies.length === 0) await appendLog(runId, "info", "No ATS companies enabled in Settings");
      for (const co of companies) {
        counters.atsCalls++;
        try {
          const board = await deps.ats[co.provider].fetchBoard(co.slug);
          const relevant = board.jobs.filter((j) => titleMatchesTargets(j.title, profile.targetTitles));
          let added = 0;
          for (const job of relevant) {
            const c = candidateFromAtsJob(job, co.displayName ?? board.companyName, co.provider);
            if (byUrl.has(c.canonicalUrl)) counters.duplicateUrlCount++;
            else added++;
            byUrl.set(c.canonicalUrl, c); // ATS board data is the richest version
          }
          await prisma.atsCompany.update({
            where: { id: co.id },
            data: { lastFetchedAt: new Date(), lastJobCount: board.jobs.length, lastError: null, displayName: co.displayName ?? board.companyName },
          });
          await appendLog(runId, "info", `${co.provider} ${co.slug}: ${board.jobs.length} open, ${relevant.length} match your titles, ${added} new URLs`);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          await prisma.atsCompany.update({ where: { id: co.id }, data: { lastError: msg.slice(0, 500) } });
          await appendLog(runId, "warn", `${co.provider} ${co.slug}: failed: ${msg}`);
        }
      }
    }

    // 4. Store.
    const { inserted, newPostings, alreadyKnown } = await persistCandidates(runId, [...byUrl.values()], profile);
    await appendLog(runId, "info", `Stored ${inserted} new URLs (${newPostings} new postings); ${alreadyKnown} were already known`);

    await prisma.searchRun.update({
      where: { id: runId },
      data: {
        ...counters,
        newJobsCount: newPostings,
        status: fatal ? "FAILED" : "SUCCEEDED",
        error: fatal,
        finishedAt: new Date(),
      },
    });
    await appendLog(runId, fatal ? "error" : "info", fatal ? "Stopped early; results found before the error were saved" : "Done");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await prisma.searchRun.update({ where: { id: runId }, data: { ...counters, status: "FAILED", error: msg, finishedAt: new Date() } });
    await appendLog(runId, "error", `Run failed: ${msg}`);
    throw err;
  }
}

/** A worker restart mid-run leaves a RUNNING row behind; close it so new runs aren't blocked. */
export async function failInterruptedRuns(): Promise<number> {
  const { count } = await prisma.searchRun.updateMany({
    where: { status: "RUNNING" },
    data: { status: "FAILED", error: "Worker restarted while this run was in progress", finishedAt: new Date() },
  });
  return count;
}
