"use client";

import { APPLY_METHODS, type ApplicationStatus, type JobDto, type JobListResponse, type LocationMatch } from "@jobpilot/shared";
import { Bookmark, BookmarkCheck, Check, ExternalLink, EyeOff, Loader2 } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { api, errorMessage } from "@/lib/api";
import { cn } from "@/lib/utils";

const PAGE = 50;
const ALL = "__all";

const LOCATION_FILTERS: { value: string; label: string }[] = [
  { value: ALL, label: "All locations" },
  { value: "MATCH,REMOTE", label: "My locations + remote" },
  { value: "MATCH", label: "My locations only" },
  { value: "REMOTE", label: "Remote" },
  { value: "MISMATCH", label: "Other locations (flagged)" },
  { value: "UNKNOWN", label: "Location unknown" },
];

const MATCH_BADGE: Record<LocationMatch, { label: string; className: string }> = {
  MATCH: { label: "Your location", className: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200" },
  REMOTE: { label: "Remote", className: "bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-200" },
  MISMATCH: { label: "Other location", className: "bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-200" },
  UNKNOWN: { label: "Location unknown", className: "bg-muted text-muted-foreground" },
};

const pretty = (s: string) => s.charAt(0) + s.slice(1).toLowerCase().replace(/_/g, " ");

interface Filters {
  locationMatch: string;
  location: string;
  applyMethod: string;
  status: string;
  minFitScore: string;
}

const DEFAULT_FILTERS: Filters = { locationMatch: "MATCH,REMOTE", location: "", applyMethod: ALL, status: ALL, minFitScore: "" };

function toQuery(f: Filters, offset: number): string {
  const p = new URLSearchParams({ limit: String(PAGE), offset: String(offset) });
  if (f.locationMatch !== ALL) p.set("locationMatch", f.locationMatch);
  if (f.location.trim()) p.set("location", f.location.trim());
  if (f.applyMethod !== ALL) p.set("applyMethod", f.applyMethod);
  if (f.status !== ALL) p.set("status", f.status);
  if (f.minFitScore.trim()) p.set("minFitScore", f.minFitScore.trim());
  return p.toString();
}

function JobCard({ job, onStatus }: { job: JobDto; onStatus: (job: JobDto, status: ApplicationStatus) => void }) {
  const match = MATCH_BADGE[job.locationMatch];
  const saved = job.status === "SAVED";
  return (
    <Card>
      <CardContent className="flex flex-col gap-3 pt-6 md:flex-row md:items-start md:justify-between">
        <div className="min-w-0 space-y-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <a href={job.canonicalUrl} target="_blank" rel="noopener noreferrer" className="font-medium hover:underline">
              {job.title}
            </a>
            {saved && <Badge variant="secondary">Saved</Badge>}
          </div>
          <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            <span className="font-medium text-foreground">{job.company}</span>
            <span>·</span>
            <span>{job.location ?? "—"}</span>
            <span className={cn("rounded px-1.5 py-0.5 text-xs", match.className)}>{match.label}</span>
          </div>
          {job.snippet && <p className="line-clamp-2 text-sm text-muted-foreground">{job.snippet}</p>}
          <div className="flex flex-wrap gap-1.5 text-xs">
            <Badge variant="outline">Apply: {pretty(job.applyMethod)}</Badge>
            <Badge variant="outline">Source: {pretty(job.source)}</Badge>
            {job.fitScore !== null && <Badge variant="outline">Fit {job.fitScore}</Badge>}
            <span className="text-muted-foreground">Found {new Date(job.firstSeenAt).toLocaleDateString()}</span>
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          <Button asChild variant="outline" size="sm">
            <a href={job.applyUrl ?? job.canonicalUrl} target="_blank" rel="noopener noreferrer">
              <ExternalLink /> Open
            </a>
          </Button>
          <Button size="sm" onClick={() => onStatus(job, "DONE")}>
            <Check /> Done
          </Button>
          <Button variant="outline" size="sm" onClick={() => onStatus(job, saved ? "NEW" : "SAVED")}>
            {saved ? <BookmarkCheck /> : <Bookmark />} {saved ? "Unsave" : "Save"}
          </Button>
          <Button variant="ghost" size="sm" onClick={() => onStatus(job, "IGNORED")}>
            <EyeOff /> Ignore
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

export default function JobsPage() {
  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS);
  const [jobs, setJobs] = useState<JobDto[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (f: Filters, offset: number) => {
    setLoading(true);
    setError(null);
    try {
      const res = await api<JobListResponse>(`/jobs?${toQuery(f, offset)}`);
      setJobs((prev) => (offset === 0 ? res.items : [...prev, ...res.items]));
      setTotal(res.total);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, []);

  // Debounce so typing in the location box doesn't fire a request per keystroke.
  useEffect(() => {
    const t = setTimeout(() => void load(filters, 0), 250);
    return () => clearTimeout(t);
  }, [filters, load]);

  /** Optimistic: Done/Ignore remove the row at once; Save/Unsave flips the badge. Rolled back on error. */
  async function changeStatus(job: JobDto, status: ApplicationStatus) {
    const snapshot = { jobs, total };
    const removes = status === "DONE" || status === "IGNORED" || (filters.status === "SAVED" && status === "NEW");
    if (removes) {
      setJobs((js) => js.filter((j) => j.id !== job.id));
      setTotal((t) => t - 1);
    } else {
      setJobs((js) => js.map((j) => (j.id === job.id ? { ...j, status: status as JobDto["status"] } : j)));
    }
    try {
      await api(`/jobs/${job.id}/status`, { method: "PATCH", body: JSON.stringify({ status }) });
    } catch (err) {
      setJobs(snapshot.jobs);
      setTotal(snapshot.total);
      setError(`Could not update "${job.title}": ${errorMessage(err)}`);
    }
  }

  const set = (patch: Partial<Filters>) => setFilters((f) => ({ ...f, ...patch }));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Jobs</h1>
          <p className="text-sm text-muted-foreground">
            {total} job{total === 1 ? "" : "s"} to look at. Jobs you mark Done or Ignore never come back, even under a different URL.
          </p>
        </div>
        <Button asChild variant="outline">
          <Link href="/search">New search</Link>
        </Button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Select value={filters.locationMatch} onValueChange={(v) => set({ locationMatch: v })}>
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {LOCATION_FILTERS.map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Input placeholder="Location contains…" value={filters.location} onChange={(e) => set({ location: e.target.value })} />
        <Select value={filters.applyMethod} onValueChange={(v) => set({ applyMethod: v })}>
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Any apply method</SelectItem>
            {APPLY_METHODS.map((m) => (
              <SelectItem key={m} value={m}>
                {pretty(m)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={filters.status} onValueChange={(v) => set({ status: v })}>
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>New + saved</SelectItem>
            <SelectItem value="NEW">New only</SelectItem>
            <SelectItem value="SAVED">Saved only</SelectItem>
          </SelectContent>
        </Select>
        <Input
          type="number"
          min={0}
          max={100}
          placeholder="Min fit score (Phase 3)"
          value={filters.minFitScore}
          onChange={(e) => set({ minFitScore: e.target.value })}
        />
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <div className="space-y-3">
        {jobs.map((j) => (
          <JobCard key={j.id} job={j} onStatus={changeStatus} />
        ))}
        {!loading && jobs.length === 0 && (
          <p className="py-8 text-center text-sm text-muted-foreground">
            No jobs match these filters.{" "}
            {filters.locationMatch !== ALL && (
              <button className="underline" onClick={() => set({ locationMatch: ALL })}>
                Show all locations
              </button>
            )}
          </p>
        )}
      </div>

      <div className="flex justify-center">
        {loading ? (
          <Loader2 className="size-5 animate-spin text-muted-foreground" />
        ) : (
          jobs.length < total && (
            <Button variant="outline" onClick={() => void load(filters, jobs.length)}>
              Load more ({total - jobs.length} left)
            </Button>
          )
        )}
      </div>
    </div>
  );
}
