"use client";

import type { ProfileDto } from "@jobpilot/shared";
import { Pencil, RefreshCw, Trash2 } from "lucide-react";
import { useState } from "react";
import { formatYears, relativeTime } from "@/lib/format";
import { ExportMenu } from "./export-menu";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Card } from "./ui/feedback";

const REMOTE_TEXT = { any: "any arrangement", remote: "remote", hybrid: "hybrid", onsite: "on-site" } as const;

interface Props {
  profile: ProfileDto;
  searching: boolean;
  searchDisabled: boolean;
  onSearch: () => void;
  onEdit: () => void;
  onDelete: () => void;
}

export function ProfileHeader({ profile, searching, searchDisabled, onSearch, onEdit, onDelete }: Props) {
  const [showAll, setShowAll] = useState(false);
  const p = profile.preferences;
  const skills = showAll ? profile.skills : profile.skills.slice(0, 14);
  const prefBits = [
    p.desiredRole,
    p.locations.length ? p.locations.join(", ") : "any location",
    REMOTE_TEXT[p.remote],
    p.minSalary !== null ? `from ${p.minSalary.toLocaleString()} ${p.salaryCurrency ?? ""}`.trim() : null,
    p.noticePeriodDays !== null ? `${p.noticePeriodDays}-day notice` : null,
    p.country.toUpperCase(),
  ].filter(Boolean);

  return (
    <Card className="p-4 sm:p-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight break-words">{profile.label}</h1>
          <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
            {[profile.parsed.name, profile.parsed.headline, formatYears(profile.yearsExperience) + " experience", profile.parsed.location]
              .filter(Boolean)
              .join(" · ")}
          </p>
          <p className="mt-1 text-xs text-zinc-500">
            Looking for: {prefBits.join(" · ")} · last search {relativeTime(profile.lastSearchAt)}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button onClick={onSearch} loading={searching} disabled={searchDisabled}>
            {!searching && <RefreshCw className="size-4" aria-hidden="true" />}
            Search again
          </Button>
          <Button variant="secondary" onClick={onEdit}>
            <Pencil className="size-4" aria-hidden="true" /> Edit
          </Button>
          <ExportMenu profileId={profile.id} />
          <Button variant="ghost" onClick={onDelete} aria-label="Delete profile">
            <Trash2 className="size-4" aria-hidden="true" />
            <span className="sm:hidden lg:inline">Delete</span>
          </Button>
        </div>
      </div>
      {profile.skills.length > 0 && (
        <ul className="mt-4 flex flex-wrap gap-1.5" aria-label="Skills">
          {skills.map((s) => (
            <li key={s}>
              <Badge>{s}</Badge>
            </li>
          ))}
          {profile.skills.length > 14 && (
            <li>
              <button
                type="button"
                className="text-xs font-medium text-indigo-600 hover:underline dark:text-indigo-400"
                onClick={() => setShowAll((v) => !v)}
              >
                {showAll ? "Show fewer" : `+${profile.skills.length - 14} more`}
              </button>
            </li>
          )}
        </ul>
      )}
    </Card>
  );
}
