"use client";

import type { ProfileDto } from "@jobpilot/shared";
import { FileUp, Plus } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { ProfileListItem } from "@/components/profile-list-item";
import { ButtonLink } from "@/components/ui/button";
import { Alert, EmptyState, PageHeader, PageLoader } from "@/components/ui/feedback";
import { api, errorMessage } from "@/lib/api";
import { useRequireSession } from "@/lib/session";

export default function ProfilesPage() {
  const session = useRequireSession();
  const [profiles, setProfiles] = useState<ProfileDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setProfiles(await api<ProfileDto[]>("/profiles"));
      setError(null);
    } catch (err) {
      setError(errorMessage(err));
    }
  }, []);

  useEffect(() => {
    if (session.status === "authenticated") void load();
  }, [session.status, load]);

  if (session.status !== "authenticated") return <PageLoader />;

  const max = session.user?.limits.maxProfiles ?? Infinity;
  const atLimit = profiles !== null && profiles.length >= max;

  async function remove(id: string) {
    try {
      await api(`/profiles/${id}`, { method: "DELETE" });
      setProfiles((ps) => ps?.filter((p) => p.id !== id) ?? null);
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  return (
    <>
      <PageHeader
        title="Profiles"
        subtitle={
          profiles && Number.isFinite(max)
            ? `${profiles.length} of ${max} profiles. Each profile is one resume with its own preferences and jobs.`
            : "Each profile is one resume with its own preferences and jobs."
        }
        actions={
          atLimit ? (
            <span className="text-sm text-zinc-500">Profile limit reached — delete one to add another.</span>
          ) : (
            <ButtonLink href="/profiles/new">
              <Plus className="size-4" aria-hidden="true" /> New profile
            </ButtonLink>
          )
        }
      />
      {error && (
        <Alert tone="error" className="mb-4">
          {error}
        </Alert>
      )}
      {profiles === null ? (
        !error && <PageLoader label="Loading profiles…" />
      ) : profiles.length === 0 ? (
        <EmptyState icon={<FileUp className="size-8" />} title="No profiles yet">
          <p>Upload a resume to start. We parse it, search for jobs and rank them for you.</p>
          <ButtonLink href="/profiles/new" className="mt-4">
            Upload a resume
          </ButtonLink>
        </EmptyState>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {profiles.map((p) => (
            <ProfileListItem key={p.id} profile={p} onDelete={() => remove(p.id)} />
          ))}
        </div>
      )}
    </>
  );
}
