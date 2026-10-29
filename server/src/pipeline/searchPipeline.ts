import type { Types } from "mongoose";
import type { Preferences, RunMetrics, RunStats, RunStep, ServerEvent } from "@jobpilot/shared";
import { env } from "../config/env.js";
import { jobMatchDto, searchRunDto } from "../db/dto.js";
import { JobMatch } from "../db/models/jobMatch.js";
import type { ProfileDoc } from "../db/models/profile.js";
import { SearchRun, type SearchRunDoc } from "../db/models/searchRun.js";
import { scoped } from "../db/scoped.js";
import { logger } from "../lib/logger.js";
import { truncate } from "../lib/text.js";
import { dedupeJobs } from "../jobs/dedupe.js";
import { prefilter } from "../jobs/prefilter.js";
import { finalScore } from "../jobs/score.js";
import type { JobSource, NormalizedJob, SearchContext } from "../jobs/types.js";
import { generateQueries, type SearchQuery } from "../llm/generateQueries.js";
import { Meter } from "../llm/meter.js";
import { explainTop, rankBatch, type RankCandidate, type RankJob, type RankResult } from "../llm/rank.js";
import { publishToUser } from "../queue/events.js";
import { enqueueCompanyRefresh, type SearchJobData } from "../queue/queues.js";
import { JSearchSource } from "../sources/jsearch.js";
import { WatchlistSource } from "../sources/watchlist.js";
import { searchWebForJobs, type WebSearchResult } from "../sources/webSearch.js";
import { addDiscoveredCompanies } from "../watchlist/companies.js";

/** Everything with side effects outside MongoDB, injectable for tests and the evaluation script. */
export interface PipelineDeps {
  sources: JobSource[];
  generateQueries: (p: ProfileDoc, prefs: Preferences, meter: Meter) => Promise<SearchQuery[]>;
  rankBatch: (c: RankCandidate, jobs: RankJob[], meter: Meter) => Promise<RankResult[]>;
  explainTop: typeof explainTop;
  webSearch: ((ctx: SearchContext, candidate: { skills: string[]; yearsExperience: number }) => Promise<WebSearchResult>) | null;
  publish: (userId: string, event: ServerEvent) => Promise<void>;
  onDiscovered: (found: WebSearchResult["discovered"]) => Promise<void>;
}

export function defaultDeps(): PipelineDeps {
  return {
    sources: [new JSearchSource(), new WatchlistSource()],
    generateQueries: (p, prefs, meter) => generateQueries(profileParsed(p), p.yearsExperience, prefs, meter),
    rankBatch,
    explainTop,
    webSearch: env.WEB_SEARCH_ENABLED ? (ctx, c) => searchWebForJobs(ctx, c) : null,
    publish: publishToUser,
    onDiscovered: async (found) => {
      for (const c of await addDiscoveredCompanies(found)) await enqueueCompanyRefresh(String(c._id));
    },
  };
}

function profileParsed(p: ProfileDoc) {
  return {
    name: p.parsed?.name ?? null,
    email: p.parsed?.email ?? null,
    location: p.parsed?.location ?? null,
    headline: p.parsed?.headline ?? null,
    skills: [...(p.parsed?.skills ?? [])],
    experience: (p.parsed?.experience ?? []).map((e) => ({ company: e.company ?? null, title: e.title ?? null, start: e.start ?? null, end: e.end ?? null, summary: e.summary ?? null })),
    education: [],
  };
}

export function preferencesOf(p: ProfileDoc): Preferences {
  const pr = p.preferences!;
  return {
    desiredRole: pr.desiredRole,
    locations: [...pr.locations],
    remote: pr.remote as Preferences["remote"],
    minSalary: pr.minSalary ?? null,
    salaryCurrency: pr.salaryCurrency ?? null,
    noticePeriodDays: pr.noticePeriodDays ?? null,
    country: pr.country ?? "in",
  };
}

function salaryText(j: NormalizedJob): string | null {
  const s = j.salary;
  if (!s || (s.min == null && s.max == null)) return null;
  return `${s.min ?? "?"}-${s.max ?? "?"} ${s.currency ?? ""} per ${s.period ?? "?"}`.trim();
}

async function inBatches<T>(items: T[], size: number, parallel: number, fn: (batch: T[]) => Promise<void>): Promise<void> {
  const batches: T[][] = [];
  for (let i = 0; i < items.length; i += size) batches.push(items.slice(i, i + size));
  for (let i = 0; i < batches.length; i += parallel) await Promise.all(batches.slice(i, i + parallel).map(fn));
}

interface Candidate {
  job: NormalizedJob;
  matchedSkills: string[];
  /** Existing row's jobKey when this job is already stored under another key (same fingerprint). */
  storedKey: string;
}

export interface PipelineOutcome {
  run: SearchRunDoc;
  firstResultAt: number | null;
}

/**
 * One search run for one profile. Ownership is re-checked here: the profile and run must belong to the
 * payload's userId, otherwise nothing is written.
 */
export async function runSearchPipeline(data: SearchJobData, deps: PipelineDeps = defaultDeps()): Promise<PipelineOutcome | null> {
  const repo = scoped(data.userId);
  const [profile, run] = await Promise.all([repo.profile(data.profileId), repo.run(data.runId)]);
  if (!profile || !run || String(run.profileId) !== String(profile._id)) {
    logger.warn({ ...data }, "search run skipped: profile or run not found for this user");
    return null;
  }

  const started = Date.now();
  let firstResultAt: number | null = null;
  const meter = new Meter();
  const prefs = preferencesOf(profile);
  const profileId = profile._id as Types.ObjectId;
  const stats: RunStats = { fetched: 0, afterDedupe: 0, droppedByPrefilter: {}, afterPrefilter: 0, reusedScores: 0, ranked: 0, newJobs: 0, bySource: {}, sourceErrors: {} };

  const step = async (s: RunStep, message: string) => {
    run.steps.push({ step: s, message, at: new Date() });
    await run.save();
    await deps.publish(data.userId, { type: "run.progress", runId: data.runId, profileId: data.profileId, step: s, message });
  };
  const metrics = (): RunMetrics => ({
    firstResultMs: firstResultAt ? firstResultAt - started : null,
    totalMs: Date.now() - started,
    llmInputTokens: meter.inputTokens,
    llmOutputTokens: meter.outputTokens,
    llmCostUsd: round(meter.llmCostUsd),
    jsearchRequests: meter.jsearchRequests,
    webSearchCalls: meter.webSearchCalls,
    costUsd: round(meter.costUsd),
  });

  run.status = "running";
  run.startedAt = new Date();
  run.error = null;
  await run.save();

  try {
    // 1. Queries.
    const queries = await deps.generateQueries(profile, prefs, meter);
    run.queries = queries as never;
    await step("queries", `${queries.length} queries: ${queries.map((q) => q.query).join("; ")}`);

    // 2. Fetch every source in parallel.
    const ctx: SearchContext = { queries, preferences: prefs, desiredRole: prefs.desiredRole, meter };
    const settled = await Promise.allSettled(deps.sources.map((s) => s.fetch(ctx)));
    const fetched: NormalizedJob[] = [];
    settled.forEach((r, i) => {
      const name = deps.sources[i]!.name;
      if (r.status === "fulfilled") fetched.push(...r.value);
      else {
        stats.sourceErrors[name] = (r.reason as Error)?.message?.slice(0, 200) ?? "failed";
        logger.warn({ source: name, err: (r.reason as Error)?.message }, "job source failed");
      }
    });
    for (const j of fetched) stats.bySource[j.source] = (stats.bySource[j.source] ?? 0) + 1;
    stats.fetched = fetched.length;
    let jobs = dedupeJobs(fetched);
    stats.afterDedupe = jobs.length;
    const errs = Object.keys(stats.sourceErrors);
    await step("fetch", `${fetched.length} jobs fetched, ${jobs.length} after removing duplicates${errs.length ? ` (failed: ${errs.join(", ")})` : ""}`);

    // 3. Pre-filter in code; done/deleted jobs are dropped here, before any LLM call.
    const excludedRows = await JobMatch.find({ userId: repo.userId, profileId, status: { $in: ["done", "deleted"] } }, { jobKey: 1, fingerprint: 1 });
    const excluded = new Set(excludedRows.flatMap((r) => [r.jobKey, r.fingerprint]));
    const prefProfile = { skills: profile.skills, yearsExperience: profile.yearsExperience, preferences: prefs };
    let filtered = prefilter(jobs, prefProfile, { excluded, maxAgeDays: env.JOB_MAX_AGE_DAYS });
    await step("prefilter", `${filtered.kept.length} jobs pass the hard rules`);

    // 4. Web search fallback when the regular sources found too little.
    if (deps.webSearch && filtered.kept.length < env.WEB_SEARCH_MIN_RESULTS) {
      try {
        const web = await deps.webSearch(ctx, { skills: profile.skills, yearsExperience: profile.yearsExperience });
        stats.bySource.web_search = web.jobs.length;
        jobs = dedupeJobs([...jobs, ...web.jobs]);
        stats.afterDedupe = jobs.length;
        filtered = prefilter(jobs, prefProfile, { excluded, maxAgeDays: env.JOB_MAX_AGE_DAYS });
        await deps.onDiscovered(web.discovered).catch((err) => logger.warn({ err }, "adding discovered companies failed"));
        const rejected = Object.values(web.rejected).reduce((a, b) => a + b, 0);
        await step("web_search", `${web.jobs.length} verified jobs from web search (${rejected} rejected), ${web.discovered.length} boards discovered`);
      } catch (err) {
        stats.sourceErrors.web_search = (err as Error).message.slice(0, 200);
        await step("web_search", "Web search failed; continuing with the other sources");
      }
    }
    stats.droppedByPrefilter = filtered.dropped;
    stats.afterPrefilter = filtered.kept.length;

    // 5. Match against stored rows: reuse scores that are still valid, keep stable keys across sources.
    const keys = filtered.kept.map((k) => k.job.jobKey);
    const fps = filtered.kept.map((k) => k.job.fingerprint);
    const existing = await JobMatch.find({ userId: repo.userId, profileId, $or: [{ jobKey: { $in: keys } }, { fingerprint: { $in: fps } }] });
    const byKey = new Map(existing.map((e) => [e.jobKey, e]));
    const byFp = new Map(existing.map((e) => [e.fingerprint, e]));

    const toRank: Candidate[] = [];
    const reusedKeys: string[] = [];
    for (const k of filtered.kept) {
      const row = byKey.get(k.job.jobKey) ?? byFp.get(k.job.fingerprint);
      const storedKey = row?.jobKey ?? k.job.jobKey;
      if (row && row.status === "new" && row.match?.profileHash === profile.profileHash) reusedKeys.push(storedKey);
      else if (!row || row.status === "new") toRank.push({ job: k.job, matchedSkills: k.matchedSkills, storedKey });
    }
    stats.reusedScores = reusedKeys.length;
    const now = new Date();
    const seenKeys = [...reusedKeys, ...excludedRows.filter((r) => jobs.some((j) => j.jobKey === r.jobKey)).map((r) => r.jobKey)];
    if (seenKeys.length) await JobMatch.updateMany({ userId: repo.userId, profileId, jobKey: { $in: seenKeys } }, { $set: { lastSeenAt: now }, $inc: { timesSeen: 1 } });

    // Highest pre-scores first (skill overlap, then recency), capped to control spend.
    toRank.sort((a, b) => b.matchedSkills.length - a.matchedSkills.length || (b.job.postedAt?.getTime() ?? 0) - (a.job.postedAt?.getTime() ?? 0));
    const capped = toRank.slice(0, env.RANK_MAX_JOBS);

    // 6. Rank in batches, save and stream each batch as soon as it's scored.
    const candidate: RankCandidate = {
      title: prefs.desiredRole,
      skills: profile.skills,
      yearsExperience: profile.yearsExperience,
      recentTitles: (profile.parsed?.experience ?? []).map((e) => e.title ?? null),
      preferences: prefs,
    };
    await step("rank", `Scoring ${capped.length} jobs${toRank.length > capped.length ? ` (top ${capped.length} of ${toRank.length})` : ""}, reusing ${reusedKeys.length} earlier scores`);

    await inBatches(capped, env.RANK_BATCH_SIZE, 3, async (batch) => {
      const rankJobs: RankJob[] = batch.map((c, i) => ({
        id: `j${i + 1}`,
        title: c.job.title,
        company: c.job.company,
        location: c.job.location,
        remote: c.job.remote,
        salary: salaryText(c.job),
        postedAt: c.job.postedAt?.toISOString().slice(0, 10) ?? null,
        description: c.job.description,
      }));
      const results = await deps.rankBatch(candidate, rankJobs, meter);
      const byId = new Map(results.map((r) => [r.jobId, r]));
      const scoredAt = new Date();
      const ops = batch.flatMap((c, i) => {
        const r = byId.get(`j${i + 1}`);
        if (!r) return []; // the model skipped it: try again on the next run
        return [upsertOp(repo.userId, profileId, profile.expiresAt ?? null, c, r, profile.profileHash, scoredAt)];
      });
      if (ops.length === 0) return;
      const res = await JobMatch.bulkWrite(ops, { ordered: false });
      stats.ranked += ops.length;
      stats.newJobs += res.upsertedCount;
      firstResultAt ??= Date.now();
      const saved = await JobMatch.find({ userId: repo.userId, profileId, jobKey: { $in: batch.map((c) => c.storedKey) } });
      for (const doc of saved) await deps.publish(data.userId, { type: "run.job", runId: data.runId, profileId: data.profileId, job: jobMatchDto(doc) });
    });

    // 7. Stronger-model explanations for the current top results.
    if (env.EXPLAIN_TOP_N > 0) {
      const top = await JobMatch.find({ userId: repo.userId, profileId, status: "new", "match.profileHash": profile.profileHash, "match.explained": { $ne: true }, "job.closedAt": null })
        .sort({ "match.score": -1 })
        .limit(env.EXPLAIN_TOP_N);
      const bestUnexplained = top.filter((t) => (t.match?.score ?? 0) >= 50);
      if (bestUnexplained.length) {
        await step("explain", `Writing detailed explanations for the top ${bestUnexplained.length}`);
        const jobsForModel = bestUnexplained.map((t, i) => ({
          id: `t${i + 1}`,
          title: t.job!.title,
          company: t.job!.company,
          location: t.job!.location ?? null,
          remote: t.job!.remote,
          salary: null,
          postedAt: t.job!.postedAt?.toISOString().slice(0, 10) ?? null,
          description: t.job!.snippet ?? null,
        }));
        const explained = await deps.explainTop(candidate, jobsForModel, meter);
        for (const [i, t] of bestUnexplained.entries()) {
          const e = explained.get(`t${i + 1}`);
          if (!e) continue;
          const updated = await JobMatch.findOneAndUpdate(
            { _id: t._id, userId: repo.userId },
            { $set: { "match.reason": e.reason, "match.redFlags": e.redFlags, "match.explained": true } },
            { new: true },
          );
          if (updated) await deps.publish(data.userId, { type: "run.job", runId: data.runId, profileId: data.profileId, job: jobMatchDto(updated) });
        }
      }
    }

    run.status = "succeeded";
    run.stats = stats;
    run.metrics = metrics();
    run.finishedAt = new Date();
    run.steps.push({ step: "done", message: `${stats.newJobs} new jobs, ${stats.ranked} scored`, at: new Date() });
    await run.save();
    profile.lastSearchAt = new Date();
    await profile.save();
    await deps.publish(data.userId, { type: "run.finished", run: searchRunDto(run) });
    logger.info({ userId: data.userId, runId: data.runId, ...stats, ...run.metrics }, "search run finished");
    return { run, firstResultAt };
  } catch (err) {
    logger.error({ err, userId: data.userId, runId: data.runId }, "search run failed");
    run.status = "failed";
    run.error = (err as Error).message.slice(0, 300);
    run.stats = stats;
    run.metrics = metrics();
    run.finishedAt = new Date();
    await run.save();
    await deps.publish(data.userId, { type: "run.finished", run: searchRunDto(run) });
    return { run, firstResultAt };
  }
}

const round = (n: number) => Math.round(n * 10_000) / 10_000;

/**
 * The upsert rule: job data, status and firstSeenAt only on insert; lastSeenAt, timesSeen and the score on
 * every run. An existing done or deleted job is never reset (its status is not in $set).
 */
function upsertOp(userId: Types.ObjectId, profileId: Types.ObjectId, expiresAt: Date | null, c: Candidate, r: RankResult, profileHash: string, now: Date) {
  const j = c.job;
  return {
    updateOne: {
      filter: { profileId, jobKey: c.storedKey },
      update: {
        $setOnInsert: {
          userId,
          fingerprint: j.fingerprint,
          job: {
            title: j.title,
            company: j.company,
            location: j.location,
            city: j.city,
            country: j.country,
            remote: j.remote,
            salary: j.salary,
            applyLinks: j.applyLinks,
            postedAt: j.postedAt,
            source: j.source,
            sources: j.sources,
            snippet: truncate(j.description, 600),
            employmentType: j.employmentType,
            closedAt: null,
          },
          status: "new",
          doneAt: null,
          deletedAt: null,
          firstSeenAt: now,
          expiresAt,
        },
        $set: {
          lastSeenAt: now,
          match: {
            score: finalScore(r.scores),
            scores: r.scores,
            matchedSkills: r.matchedSkills,
            missingSkills: r.missingSkills,
            reason: r.reason,
            verdict: r.verdict,
            redFlags: r.redFlags,
            explained: false,
            profileHash,
            scoredAt: now,
          },
        },
        $inc: { timesSeen: 1 },
      },
      upsert: true,
    },
  };
}
