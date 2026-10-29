"use client";

import { JOB_STATUSES, type JobStatus, type ProfileDto } from "@jobpilot/shared";
import clsx from "clsx";

const TAB_LABELS: Record<JobStatus, string> = { new: "New", done: "Done", deleted: "Deleted" };
export const MIN_SCORES = [0, 50, 70, 85] as const;

interface Props {
  status: JobStatus;
  minScore: number;
  counts: ProfileDto["jobCounts"];
  onChange: (next: { status?: JobStatus; minScore?: number }) => void;
}

export function JobFilters({ status, minScore, counts, onChange }: Props) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div role="tablist" aria-label="Job status" className="inline-flex rounded-lg bg-zinc-100 p-1 dark:bg-zinc-800/80">
        {JOB_STATUSES.map((s) => (
          <button
            key={s}
            type="button"
            role="tab"
            aria-selected={s === status}
            onClick={() => onChange({ status: s })}
            className={clsx(
              "flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition-colors sm:flex-none",
              s === status
                ? "bg-white text-zinc-900 shadow-sm dark:bg-zinc-950 dark:text-zinc-50"
                : "text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100",
            )}
          >
            {TAB_LABELS[s]}
            <span className="ml-1.5 text-xs tabular-nums text-zinc-500">{counts[s]}</span>
          </button>
        ))}
      </div>
      <div className="flex items-center gap-2">
        <label htmlFor="min-score" className="text-sm text-zinc-600 dark:text-zinc-400">
          Minimum score
        </label>
        <select
          id="min-score"
          value={minScore}
          onChange={(e) => onChange({ minScore: Number(e.target.value) })}
          className="rounded-lg border border-zinc-300 bg-white px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-900"
        >
          {MIN_SCORES.map((n) => (
            <option key={n} value={n}>
              {n === 0 ? "Any" : `${n}+`}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}
