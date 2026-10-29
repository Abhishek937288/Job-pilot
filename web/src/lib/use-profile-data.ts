"use client";

import type { JobMatchDto, JobStatus, ProfileDto, SearchRunDto, ServerEvent } from "@jobpilot/shared";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, errorMessage, isApiError } from "./api";
import { useServerEvents, type EventsState } from "./use-events";

export interface JobFilter {
  status: JobStatus;
  minScore: number;
}

function compareJobs(a: JobMatchDto, b: JobMatchDto): number {
  if (a.match && b.match) return b.match.score - a.match.score || b.firstSeenAt.localeCompare(a.firstSeenAt);
  if (a.match) return -1;
  if (b.match) return 1;
  return b.firstSeenAt.localeCompare(a.firstSeenAt);
}

function matches(job: JobMatchDto, f: JobFilter): boolean {
  if (job.status !== f.status) return false;
  if (f.minScore <= 0) return true;
  return job.match !== null && job.match.score >= f.minScore;
}

/** Inserts, replaces or removes `job` in a sorted list depending on whether it passes the filter. */
function upsert(list: JobMatchDto[], job: JobMatchDto, f: JobFilter): JobMatchDto[] {
  const rest = list.filter((j) => j.id !== job.id);
  if (!matches(job, f)) return rest.length === list.length ? list : rest;
  return [...rest, job].sort(compareJobs);
}

function adjustCounts(p: ProfileDto, from: JobStatus, to: JobStatus): ProfileDto {
  if (from === to) return p;
  const c = { ...p.jobCounts };
  c[from] = Math.max(0, c[from] - 1);
  c[to] += 1;
  return { ...p, jobCounts: c };
}

export interface ProfileData {
  profile: ProfileDto | null;
  setProfile: (p: ProfileDto) => void;
  notFound: boolean;
  jobs: JobMatchDto[] | null;
  runs: SearchRunDto[] | null;
  error: string | null;
  clearError: () => void;
  live: EventsState;
  /** Optimistically moves a job to `status`; resolves with false if the server refused. */
  setJobStatus: (job: JobMatchDto, status: JobStatus) => Promise<boolean>;
  addRun: (run: SearchRunDto) => void;
  reloadRuns: () => Promise<void>;
}

export function useProfileData(id: string, filter: JobFilter, enabled: boolean): ProfileData {
  const [profile, setProfile] = useState<ProfileDto | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [jobs, setJobs] = useState<JobMatchDto[] | null>(null);
  const [runs, setRuns] = useState<SearchRunDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const filterRef = useRef(filter);
  filterRef.current = filter;
  const runsRef = useRef(runs);
  runsRef.current = runs;
  const jobsSeq = useRef(0);
  /** Status changes not yet confirmed by the server; applied over incoming `run.job` events. */
  const pending = useRef(new Map<string, JobStatus>());

  const fail = useCallback((err: unknown) => {
    if (isApiError(err, 404)) setNotFound(true);
    else setError(errorMessage(err));
  }, []);

  const loadProfile = useCallback(async () => {
    try {
      setProfile(await api<ProfileDto>(`/profiles/${id}`));
    } catch (err) {
      fail(err);
    }
  }, [id, fail]);

  const loadRuns = useCallback(async () => {
    try {
      setRuns(await api<SearchRunDto[]>(`/profiles/${id}/runs`));
    } catch (err) {
      fail(err);
    }
  }, [id, fail]);

  const loadJobs = useCallback(async () => {
    const seq = ++jobsSeq.current;
    const f = filterRef.current;
    try {
      const qs = new URLSearchParams({ status: f.status, minScore: String(f.minScore) });
      const list = await api<JobMatchDto[]>(`/profiles/${id}/jobs?${qs}`);
      if (seq !== jobsSeq.current) return; // a newer request (e.g. a tab switch) superseded this one
      const withPending = list.map((j) => {
        const s = pending.current.get(j.id);
        return s ? { ...j, status: s } : j;
      });
      setJobs(withPending.filter((j) => matches(j, f)).sort(compareJobs));
    } catch (err) {
      if (seq === jobsSeq.current) fail(err);
    }
  }, [id, fail]);

  useEffect(() => {
    if (!enabled) return;
    void loadProfile();
    void loadRuns();
  }, [enabled, loadProfile, loadRuns]);

  useEffect(() => {
    if (!enabled) return;
    setJobs(null);
    void loadJobs();
  }, [enabled, loadJobs, filter.status, filter.minScore]);

  const onEvent = (e: ServerEvent) => {
    if (e.type === "run.progress") {
      if (e.profileId !== id) return;
      if (!runsRef.current?.some((r) => r.id === e.runId)) {
        void loadRuns(); // a run started elsewhere (e.g. another tab)
        return;
      }
      setRuns((rs) =>
        rs?.map((r) =>
          r.id === e.runId
            ? {
                ...r,
                status: "running",
                steps: [...r.steps, { step: e.step, message: e.message, at: new Date().toISOString() }],
              }
            : r,
        ) ?? rs,
      );
    } else if (e.type === "run.job") {
      if (e.profileId !== id) return;
      const s = pending.current.get(e.job.id);
      const job = s ? { ...e.job, status: s } : e.job;
      setJobs((list) => (list ? upsert(list, job, filterRef.current) : list));
    } else if (e.type === "run.finished") {
      if (e.run.profileId !== id) return;
      setRuns((rs) => (rs ? [e.run, ...rs.filter((r) => r.id !== e.run.id)] : [e.run]));
      void loadJobs();
      void loadRuns();
      void loadProfile();
    }
  };

  const live = useServerEvents(enabled, onEvent, () => {
    void loadJobs();
    void loadRuns();
  });

  const setJobStatus = useCallback(
    async (job: JobMatchDto, status: JobStatus) => {
      const from = job.status;
      if (from === status) return true;
      pending.current.set(job.id, status);
      setJobs((list) => (list ? upsert(list, { ...job, status }, filterRef.current) : list));
      setProfile((p) => (p ? adjustCounts(p, from, status) : p));
      try {
        const updated = await api<JobMatchDto>(`/jobs/${job.id}`, { method: "PATCH", json: { status } });
        if (pending.current.get(job.id) === status) pending.current.delete(job.id);
        setJobs((list) => (list ? upsert(list, updated, filterRef.current) : list));
        return true;
      } catch (err) {
        if (pending.current.get(job.id) === status) pending.current.delete(job.id);
        setJobs((list) => (list ? upsert(list, job, filterRef.current) : list));
        setProfile((p) => (p ? adjustCounts(p, status, from) : p));
        setError(`Could not update "${job.job.title}": ${errorMessage(err)}`);
        return false;
      }
    },
    [],
  );

  const addRun = useCallback((run: SearchRunDto) => {
    setRuns((rs) => [run, ...(rs ?? []).filter((r) => r.id !== run.id)]);
  }, []);

  return {
    profile,
    setProfile,
    notFound,
    jobs,
    runs,
    error,
    clearError: () => setError(null),
    live,
    setJobStatus,
    addRun,
    reloadRuns: loadRuns,
  };
}
