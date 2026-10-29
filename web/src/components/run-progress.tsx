"use client";

import { RUN_STEPS, type RunStep, type SearchRunDto } from "@jobpilot/shared";
import clsx from "clsx";
import { Check, Circle, Minus, X } from "lucide-react";
import { formatMs, formatUsd, relativeTime } from "@/lib/format";
import { Badge, type BadgeTone } from "./ui/badge";
import { Card, Spinner } from "./ui/feedback";

const STEP_LABELS: Record<RunStep, string> = {
  queries: "Generating search queries",
  fetch: "Fetching jobs from sources",
  prefilter: "Filtering by your preferences",
  web_search: "Searching the web",
  rank: "Scoring matches",
  explain: "Writing explanations",
  done: "Done",
};

const STATUS: Record<SearchRunDto["status"], { label: string; tone: BadgeTone }> = {
  queued: { label: "Queued", tone: "neutral" },
  running: { label: "Running", tone: "indigo" },
  succeeded: { label: "Finished", tone: "green" },
  failed: { label: "Failed", tone: "red" },
};

type StepState = "done" | "current" | "pending" | "skipped" | "failed";

function stepStates(run: SearchRunDto): { step: RunStep; state: StepState; message: string | null }[] {
  const lastMsg = new Map<RunStep, string>();
  for (const s of run.steps) lastMsg.set(s.step, s.message);
  const reachedIdx = run.steps.reduce((max, s) => Math.max(max, RUN_STEPS.indexOf(s.step)), -1);
  const finished = run.status === "succeeded" || run.status === "failed";

  return RUN_STEPS.map((step, i) => {
    const reached = lastMsg.has(step);
    let state: StepState;
    if (run.status === "succeeded") state = reached || step === "done" ? "done" : "skipped";
    else if (i < reachedIdx) state = reached ? "done" : "skipped";
    else if (i === reachedIdx) state = run.status === "failed" ? "failed" : finished ? "done" : "current";
    else state = "pending";
    return { step, state, message: lastMsg.get(step) ?? null };
  });
}

function StepIcon({ state }: { state: StepState }) {
  const cls = "size-4";
  switch (state) {
    case "done":
      return <Check className={clsx(cls, "text-emerald-600")} aria-hidden="true" />;
    case "current":
      return <Spinner className={clsx(cls, "text-indigo-600")} />;
    case "failed":
      return <X className={clsx(cls, "text-red-600")} aria-hidden="true" />;
    case "skipped":
      return <Minus className={clsx(cls, "text-zinc-400")} aria-hidden="true" />;
    default:
      return <Circle className={clsx(cls, "text-zinc-300 dark:text-zinc-600")} aria-hidden="true" />;
  }
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-lg bg-zinc-50 px-3 py-2 dark:bg-zinc-800/60">
      <dt className="text-xs text-zinc-500">{label}</dt>
      <dd className="text-base font-semibold tabular-nums">{value}</dd>
    </div>
  );
}

export function RunProgress({ run }: { run: SearchRunDto }) {
  const active = run.status === "queued" || run.status === "running";
  const status = STATUS[run.status];
  const steps = stepStates(run);
  const { stats, metrics } = run;
  const sourceErrors = Object.entries(stats?.sourceErrors ?? {});
  const bySource = Object.entries(stats?.bySource ?? {});
  const dropped = Object.entries(stats?.droppedByPrefilter ?? {}).filter(([, n]) => n > 0);

  const stepList = (
    <ol className="mt-3 grid gap-2 sm:grid-cols-2" aria-label="Search steps">
      {steps.map(({ step, state, message }) => (
        <li key={step} className="flex items-start gap-2 text-sm">
          <span className="mt-0.5">
            <StepIcon state={state} />
          </span>
          <span className="min-w-0">
            <span className={clsx(state === "pending" || state === "skipped" ? "text-zinc-400" : "font-medium")}>
              {STEP_LABELS[step]}
              {state === "skipped" && <span className="ml-1 text-xs">(skipped)</span>}
            </span>
            {message && <span className="block break-words text-xs text-zinc-500">{message}</span>}
          </span>
        </li>
      ))}
    </ol>
  );

  return (
    <Card className="p-4 sm:p-5">
      <div aria-live="polite" className="flex flex-wrap items-center gap-2">
        <h2 className="text-sm font-semibold">{run.trigger === "initial" ? "First search" : "Latest search"}</h2>
        <Badge tone={status.tone}>
          {active && <Spinner className="size-3" />}
          {status.label}
        </Badge>
        <span className="text-xs text-zinc-500">
          started {relativeTime(run.createdAt)}
          {run.finishedAt && ` · finished ${relativeTime(run.finishedAt)}`}
        </span>
      </div>

      {run.error && <p className="mt-2 text-sm text-red-600 dark:text-red-400">{run.error}</p>}

      {active ? (
        stepList
      ) : (
        <details className="mt-2 group">
          <summary className="cursor-pointer text-xs text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-300">
            Show steps{run.queries.length > 0 && " and queries"}
          </summary>
          {stepList}
          {run.queries.length > 0 && (
            <ul className="mt-3 flex flex-col gap-1 text-xs text-zinc-600 dark:text-zinc-400">
              {run.queries.map((q, i) => (
                <li key={i}>
                  “{q.query}”{q.location && ` in ${q.location}`}
                  {q.remoteOnly && " (remote only)"}
                </li>
              ))}
            </ul>
          )}
        </details>
      )}

      {stats && (
        <dl className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
          <Stat label="Jobs found" value={stats.fetched} />
          <Stat label="After dedupe" value={stats.afterDedupe} />
          <Stat label="Passed filters" value={stats.afterPrefilter} />
          <Stat label="New jobs" value={stats.newJobs} />
          <Stat label="Cost" value={formatUsd(metrics?.costUsd)} />
          <Stat label="Total time" value={formatMs(metrics?.totalMs)} />
        </dl>
      )}

      {(bySource.length > 0 || metrics || dropped.length > 0) && (
        <div className="mt-3 flex flex-col gap-1 text-xs text-zinc-500">
          {bySource.length > 0 && (
            <p>
              By source: {bySource.map(([s, n]) => `${s} ${n}`).join(" · ")}
              {stats && ` · scored ${stats.ranked}, reused ${stats.reusedScores}`}
            </p>
          )}
          {dropped.length > 0 && <p>Filtered out: {dropped.map(([r, n]) => `${r.replace(/_/g, " ")} ${n}`).join(" · ")}</p>}
          {metrics && (
            <p>
              First result {formatMs(metrics.firstResultMs)} · LLM {metrics.llmInputTokens.toLocaleString()} in /{" "}
              {metrics.llmOutputTokens.toLocaleString()} out tokens ({formatUsd(metrics.llmCostUsd)}) · JSearch{" "}
              {metrics.jsearchRequests} · web search {metrics.webSearchCalls}
            </p>
          )}
        </div>
      )}

      {sourceErrors.length > 0 && (
        <ul className="mt-2 flex flex-col gap-0.5 text-xs text-amber-700 dark:text-amber-400">
          {sourceErrors.map(([s, msg]) => (
            <li key={s}>
              {s}: {msg}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
