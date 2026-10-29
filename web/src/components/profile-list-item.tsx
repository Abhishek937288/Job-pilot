"use client";

import type { ProfileDto } from "@jobpilot/shared";
import { Trash2 } from "lucide-react";
import Link from "next/link";
import { formatYears, relativeTime } from "@/lib/format";
import { Badge } from "./ui/badge";
import { ConfirmButton } from "./ui/confirm-button";
import { Card } from "./ui/feedback";

export function ProfileListItem({ profile, onDelete }: { profile: ProfileDto; onDelete: () => Promise<void> }) {
  const skills = profile.skills.slice(0, 6);
  return (
    <Card className="flex flex-col gap-4 p-5 transition-shadow hover:shadow-md">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <Link
            href={`/profiles/${profile.id}`}
            className="block truncate text-lg font-semibold hover:text-indigo-600 dark:hover:text-indigo-400"
          >
            {profile.label}
          </Link>
          <p className="truncate text-sm text-zinc-500 dark:text-zinc-400">
            {[profile.parsed.name, profile.preferences.desiredRole, formatYears(profile.yearsExperience)]
              .filter(Boolean)
              .join(" · ")}
          </p>
        </div>
        <ConfirmButton onConfirm={onDelete} aria-label={`Delete profile ${profile.label}`} confirmLabel="Delete">
          <Trash2 className="size-4" aria-hidden="true" />
        </ConfirmButton>
      </div>
      {skills.length > 0 && (
        <ul className="flex flex-wrap gap-1.5" aria-label="Top skills">
          {skills.map((s) => (
            <li key={s}>
              <Badge>{s}</Badge>
            </li>
          ))}
          {profile.skills.length > skills.length && (
            <li className="text-xs text-zinc-500 self-center">+{profile.skills.length - skills.length} more</li>
          )}
        </ul>
      )}
      <div className="mt-auto flex flex-wrap items-center justify-between gap-2 border-t border-zinc-100 pt-3 text-sm dark:border-zinc-800">
        <div className="flex gap-3">
          <span>
            <strong className="font-semibold">{profile.jobCounts.new}</strong>{" "}
            <span className="text-zinc-500">new</span>
          </span>
          <span>
            <strong className="font-semibold">{profile.jobCounts.done}</strong>{" "}
            <span className="text-zinc-500">done</span>
          </span>
        </div>
        <span className="text-xs text-zinc-500">Last search {relativeTime(profile.lastSearchAt)}</span>
      </div>
    </Card>
  );
}
