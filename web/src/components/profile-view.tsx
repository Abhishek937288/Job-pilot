"use client";

import { JOB_STATUSES, type JobMatchDto, type JobStatus, type SearchRunDto } from "@jobpilot/shared";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useRef, useState } from "react";
import { api, errorMessage, isApiError } from "@/lib/api";
import { useSession } from "@/lib/session";
import { useProfileData } from "@/lib/use-profile-data";
import { EditPreferencesModal } from "./edit-preferences-modal";
import { JobFilters, MIN_SCORES } from "./job-filters";
import { JobList } from "./job-list";
import { ProfileHeader } from "./profile-header";
import { RunProgress } from "./run-progress";
import { StatusToast, type ToastData } from "./status-toast";
import { Button, ButtonLink } from "./ui/button";
import { Alert, EmptyState, PageLoader } from "./ui/feedback";
import { Modal } from "./ui/modal";

const MOVED: Record<JobStatus, string> = { new: "Moved back to New", done: "Marked as done", deleted: "Deleted" };

function readFilter(params: URLSearchParams) {
  const s = params.get("status");
  const status: JobStatus = (JOB_STATUSES as readonly string[]).includes(s ?? "") ? (s as JobStatus) : "new";
  const n = Number(params.get("minScore"));
  const minScore = (MIN_SCORES as readonly number[]).includes(n) ? n : 0;
  return { status, minScore };
}

export function ProfileView({ id }: { id: string }) {
  const session = useSession();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const filter = readFilter(new URLSearchParams(params.toString()));
  const data = useProfileData(id, filter, session.status === "authenticated");

  const [searching, setSearching] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [toast, setToast] = useState<ToastData | null>(null);
  const toastId = useRef(0);
  const dismissToast = useCallback(() => setToast(null), []);

  const setFilter = (next: { status?: JobStatus; minScore?: number }) => {
    const qs = new URLSearchParams(params.toString());
    const status = next.status ?? filter.status;
    const minScore = next.minScore ?? filter.minScore;
    if (status === "new") qs.delete("status");
    else qs.set("status", status);
    if (minScore === 0) qs.delete("minScore");
    else qs.set("minScore", String(minScore));
    const s = qs.toString();
    router.replace(s ? `${pathname}?${s}` : pathname, { scroll: false });
  };

  const changeStatus = async (job: JobMatchDto, status: JobStatus) => {
    const from = job.status;
    const ok = await data.setJobStatus(job, status);
    if (!ok) return;
    setToast({
      id: ++toastId.current,
      message: MOVED[status],
      action: { label: "Undo", run: () => void data.setJobStatus({ ...job, status }, from) },
    });
  };

  const latestRun: SearchRunDto | undefined = data.runs?.[0];
  const runActive = latestRun?.status === "queued" || latestRun?.status === "running";

  async function searchAgain() {
    setNotice(null);
    setSearching(true);
    try {
      const run = await api<SearchRunDto>(`/profiles/${id}/search`, { method: "POST" });
      data.addRun(run);
      void session.refresh(); // update searchesUsedToday
    } catch (err) {
      if (isApiError(err, 409)) {
        setNotice("A search is already running for this profile.");
        void data.reloadRuns();
      } else if (isApiError(err, 429)) {
        setNotice(`${err.body.error}`);
      } else {
        setNotice(errorMessage(err));
      }
    } finally {
      setSearching(false);
    }
  }

  async function deleteProfile() {
    setDeleting(true);
    try {
      await api(`/profiles/${id}`, { method: "DELETE" });
      router.replace("/profiles");
    } catch (err) {
      setDeleting(false);
      setConfirmDelete(false);
      setNotice(errorMessage(err));
    }
  }

  if (data.notFound) {
    return (
      <EmptyState title="Profile not found">
        <p>It may have been deleted, or it belongs to another account.</p>
        <ButtonLink href="/profiles" className="mt-4">
          Back to profiles
        </ButtonLink>
      </EmptyState>
    );
  }
  if (!data.profile) {
    return data.error ? <Alert tone="error">{data.error}</Alert> : <PageLoader label="Loading profile…" />;
  }

  const { profile } = data;
  const limits = session.user?.limits;
  const quotaLeft = limits ? limits.dailySearches - limits.searchesUsedToday : null;

  return (
    <div className="flex flex-col gap-5">
      <Link href="/profiles" className="inline-flex items-center gap-1 self-start text-sm text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200">
        <ArrowLeft className="size-4" aria-hidden="true" /> Profiles
      </Link>

      <ProfileHeader
        profile={profile}
        searching={searching}
        searchDisabled={runActive}
        onSearch={searchAgain}
        onEdit={() => setEditing(true)}
        onDelete={() => setConfirmDelete(true)}
      />

      {notice && (
        <Alert tone="info">
          <div className="flex justify-between gap-2">
            <span>{notice}</span>
            <button type="button" className="text-xs underline" onClick={() => setNotice(null)}>
              Dismiss
            </button>
          </div>
        </Alert>
      )}
      {data.error && (
        <Alert tone="error">
          <div className="flex justify-between gap-2">
            <span>{data.error}</span>
            <button type="button" className="text-xs underline" onClick={data.clearError}>
              Dismiss
            </button>
          </div>
        </Alert>
      )}

      {latestRun ? (
        <RunProgress run={latestRun} />
      ) : data.runs !== null ? (
        <p className="text-sm text-zinc-500">No searches yet. Click “Search again” to start one.</p>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-zinc-500">
        <span className="inline-flex items-center gap-1.5">
          <span
            className={
              data.live === "open"
                ? "size-2 rounded-full bg-emerald-500"
                : "size-2 animate-pulse rounded-full bg-amber-500"
            }
            aria-hidden="true"
          />
          {data.live === "open" ? "Live updates on" : data.live === "connecting" ? "Connecting…" : "Reconnecting…"}
        </span>
        {quotaLeft !== null && limits && (
          <span>
            {Math.max(0, quotaLeft)} of {limits.dailySearches} searches left today
          </span>
        )}
      </div>

      <JobFilters status={filter.status} minScore={filter.minScore} counts={profile.jobCounts} onChange={setFilter} />
      <div role="tabpanel" aria-label={`${filter.status} jobs`}>
        <JobList
          jobs={data.jobs}
          status={filter.status}
          minScore={filter.minScore}
          searching={runActive}
          onStatus={changeStatus}
        />
      </div>

      <EditPreferencesModal
        profile={profile}
        open={editing}
        onClose={() => setEditing(false)}
        onSaved={(p) => {
          data.setProfile(p);
          setNotice("Saved. Run “Search again” to re-score your jobs with the new preferences.");
        }}
      />
      <Modal
        open={confirmDelete}
        title="Delete this profile?"
        onClose={() => !deleting && setConfirmDelete(false)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirmDelete(false)} disabled={deleting}>
              Cancel
            </Button>
            <Button variant="danger" loading={deleting} onClick={deleteProfile}>
              Delete permanently
            </Button>
          </>
        }
      >
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          “{profile.label}”, its {profile.jobCounts.new + profile.jobCounts.done + profile.jobCounts.deleted} jobs and
          all search history will be deleted. This cannot be undone.
        </p>
      </Modal>
      <StatusToast toast={toast} onDismiss={dismissToast} />
    </div>
  );
}
