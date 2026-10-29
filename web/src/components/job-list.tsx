"use client";

import type { JobMatchDto, JobStatus } from "@jobpilot/shared";
import { Inbox } from "lucide-react";
import { JobCard } from "./job-card";
import { EmptyState, PageLoader } from "./ui/feedback";

const EMPTY: Record<JobStatus, { title: string; text: string }> = {
  new: { title: "No new jobs yet", text: "Jobs appear here as the search finds and scores them." },
  done: { title: "Nothing marked done", text: "Mark jobs you've applied to or handled as Done to keep them here." },
  deleted: { title: "No deleted jobs", text: "Jobs you delete are kept here and never come back in future searches." },
};

interface Props {
  jobs: JobMatchDto[] | null;
  status: JobStatus;
  minScore: number;
  searching: boolean;
  onStatus: (job: JobMatchDto, status: JobStatus) => void;
}

export function JobList({ jobs, status, minScore, searching, onStatus }: Props) {
  if (jobs === null) return <PageLoader label="Loading jobs…" />;
  if (jobs.length === 0) {
    const e = EMPTY[status];
    return (
      <EmptyState icon={<Inbox className="size-8" />} title={minScore > 0 ? `No jobs scoring ${minScore}+` : e.title}>
        {minScore > 0
          ? "Lower the minimum score to see more."
          : status === "new" && searching
            ? "The search is running — matches will show up here as they're scored."
            : e.text}
      </EmptyState>
    );
  }
  return (
    <ul className="flex flex-col gap-4">
      {jobs.map((j) => (
        <li key={j.id}>
          <JobCard job={j} onStatus={(s) => onStatus(j, s)} />
        </li>
      ))}
    </ul>
  );
}
