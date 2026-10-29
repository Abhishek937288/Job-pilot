"use client";

import type { JobMatchDto, JobStatus, MatchScores, RemoteType, Verdict } from "@jobpilot/shared";
import clsx from "clsx";
import { AlertTriangle, Check, ExternalLink, RotateCcw, Trash2 } from "lucide-react";
import { formatSalary, relativeTime } from "@/lib/format";
import { Badge, type BadgeTone } from "./ui/badge";
import { Button, buttonClass } from "./ui/button";
import { Card, Spinner } from "./ui/feedback";

const VERDICT: Record<Verdict, { label: string; tone: BadgeTone; text: string }> = {
  strong: { label: "Strong match", tone: "green", text: "text-emerald-600 dark:text-emerald-400" },
  good: { label: "Good match", tone: "blue", text: "text-sky-600 dark:text-sky-400" },
  stretch: { label: "Stretch", tone: "amber", text: "text-amber-600 dark:text-amber-400" },
  poor: { label: "Poor match", tone: "red", text: "text-red-600 dark:text-red-400" },
};

const REMOTE: Record<RemoteType, { label: string; tone: BadgeTone } | null> = {
  remote: { label: "Remote", tone: "green" },
  hybrid: { label: "Hybrid", tone: "blue" },
  onsite: { label: "On-site", tone: "neutral" },
  unknown: null,
};

const DIMENSIONS: { key: keyof MatchScores; label: string }[] = [
  { key: "skills", label: "Skills" },
  { key: "seniority", label: "Seniority" },
  { key: "location", label: "Location" },
  { key: "salary", label: "Salary" },
];

/** Only http(s) URLs become links; anything else from a job feed is dropped. */
function safeHref(url: string): string | null {
  try {
    const u = new URL(url);
    return u.protocol === "http:" || u.protocol === "https:" ? u.href : null;
  } catch {
    return null;
  }
}

function barColor(v: number) {
  return v >= 75 ? "bg-emerald-500" : v >= 50 ? "bg-sky-500" : v >= 30 ? "bg-amber-500" : "bg-red-500";
}

interface JobCardProps {
  job: JobMatchDto;
  onStatus: (status: JobStatus) => void;
}

export function JobCard({ job: jm, onStatus }: JobCardProps) {
  const { job, match } = jm;
  const salary = formatSalary(job.salary);
  const remote = REMOTE[job.remote];
  const links = [...job.applyLinks]
    .sort((a, b) => Number(b.isDirect) - Number(a.isDirect))
    .map((l) => ({ ...l, href: safeHref(l.url) }))
    .filter((l): l is typeof l & { href: string } => l.href !== null);
  const verdict = match ? VERDICT[match.verdict] : null;

  return (
    <Card className={clsx("p-4 sm:p-5", job.closedAt && "opacity-75")}>
      <article aria-labelledby={`job-${jm.id}-title`} className="flex flex-col gap-4">
        <div className="flex items-start gap-4">
          <div className="min-w-0 flex-1">
            <h3 id={`job-${jm.id}-title`} className="text-base font-semibold leading-snug break-words">
              {job.title}
            </h3>
            <p className="mt-0.5 text-sm text-zinc-600 dark:text-zinc-400 break-words">
              <span className="font-medium text-zinc-800 dark:text-zinc-200">{job.company}</span>
              {job.location && <> · {job.location}</>}
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs">
              {remote && <Badge tone={remote.tone}>{remote.label}</Badge>}
              {job.closedAt && <Badge tone="red">Closed</Badge>}
              {job.employmentType && <Badge>{job.employmentType}</Badge>}
              {salary && <Badge tone="indigo">{salary}</Badge>}
              {job.postedAt && (
                <time dateTime={job.postedAt} className="text-zinc-500">
                  Posted {relativeTime(job.postedAt)}
                </time>
              )}
            </div>
          </div>
          <div className="flex shrink-0 flex-col items-end gap-1 text-right">
            {match && verdict ? (
              <>
                <span className={clsx("text-3xl font-bold leading-none tabular-nums", verdict.text)} aria-label={`Score ${Math.round(match.score)} out of 100`}>
                  {Math.round(match.score)}
                </span>
                <Badge tone={verdict.tone}>{verdict.label}</Badge>
              </>
            ) : (
              <span className="flex items-center gap-1.5 text-xs text-zinc-500" role="status">
                <Spinner className="size-3.5" /> Scoring…
              </span>
            )}
          </div>
        </div>

        {match && (
          <>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-4">
              {DIMENSIONS.map(({ key, label }) => {
                const v = match.scores[key];
                return (
                  <div key={key}>
                    <div className="flex justify-between text-xs">
                      <dt className="text-zinc-500">{label}</dt>
                      <dd className="font-medium tabular-nums">{v === null ? "n/a" : v}</dd>
                    </div>
                    <div className="mt-1 h-1.5 rounded-full bg-zinc-100 dark:bg-zinc-800" aria-hidden="true">
                      {v !== null && <div className={clsx("h-full rounded-full", barColor(v))} style={{ width: `${Math.max(2, Math.min(100, v))}%` }} />}
                    </div>
                  </div>
                );
              })}
            </dl>

            {match.reason && <p className="text-sm text-zinc-700 dark:text-zinc-300">{match.reason}</p>}

            {(match.matchedSkills.length > 0 || match.missingSkills.length > 0) && (
              <div className="flex flex-col gap-2 text-xs">
                {match.matchedSkills.length > 0 && (
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-zinc-500">Matched:</span>
                    {match.matchedSkills.map((s) => (
                      <Badge key={s} tone="green">
                        {s}
                      </Badge>
                    ))}
                  </div>
                )}
                {match.missingSkills.length > 0 && (
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-zinc-500">Missing:</span>
                    {match.missingSkills.map((s) => (
                      <Badge key={s} tone="red" className="bg-transparent dark:bg-transparent">
                        {s}
                      </Badge>
                    ))}
                  </div>
                )}
              </div>
            )}

            {match.redFlags.length > 0 && (
              <ul className="flex flex-col gap-1 text-sm text-amber-700 dark:text-amber-400" aria-label="Red flags">
                {match.redFlags.map((f) => (
                  <li key={f} className="flex items-start gap-1.5">
                    <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
                    {f}
                  </li>
                ))}
              </ul>
            )}
          </>
        )}

        {job.snippet && (
          <details className="text-sm">
            <summary className="cursor-pointer text-xs text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-300">
              Description
            </summary>
            <p className="mt-2 whitespace-pre-line text-zinc-600 dark:text-zinc-400">{job.snippet}</p>
          </details>
        )}

        <div className="flex flex-col gap-3 border-t border-zinc-100 pt-3 sm:flex-row sm:items-center sm:justify-between dark:border-zinc-800">
          <div className="flex flex-wrap gap-2">
            {links.length === 0 && <span className="text-xs text-zinc-500">No apply link</span>}
            {links.map((l, i) => (
              <a
                key={`${i}:${l.href}`}
                href={l.href}
                target="_blank"
                rel="noopener noreferrer"
                className={buttonClass(i === 0 && l.isDirect ? "primary" : "secondary", "sm")}
              >
                {l.isDirect ? "Apply" : "View"} on {l.source}
                <ExternalLink className="size-3.5" aria-hidden="true" />
                <span className="sr-only">(opens in a new tab)</span>
              </a>
            ))}
          </div>
          <div className="flex items-center justify-between gap-2 sm:justify-end">
            <span className="text-xs text-zinc-400 sm:hidden">via {job.sources.join(", ")}</span>
            <div className="flex gap-1">
              {jm.status === "new" ? (
                <Button size="sm" variant="secondary" onClick={() => onStatus("done")}>
                  <Check className="size-4" aria-hidden="true" /> Done
                </Button>
              ) : (
                <Button size="sm" variant="secondary" onClick={() => onStatus("new")}>
                  <RotateCcw className="size-4" aria-hidden="true" /> Undo
                </Button>
              )}
              {jm.status !== "deleted" && (
                <Button size="sm" variant="ghost" onClick={() => onStatus("deleted")} aria-label={`Delete ${job.title}`}>
                  <Trash2 className="size-4" aria-hidden="true" />
                  <span className="hidden sm:inline">Delete</span>
                </Button>
              )}
            </div>
          </div>
        </div>
        <p className="-mt-2 hidden text-xs text-zinc-400 sm:block">
          Sources: {job.sources.join(", ")}
          {jm.timesSeen > 1 && ` · seen in ${jm.timesSeen} searches`}
        </p>
      </article>
    </Card>
  );
}
