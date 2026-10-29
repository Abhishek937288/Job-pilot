"use client";

import type { CompanyDto } from "@jobpilot/shared";
import { RefreshCw, Trash2 } from "lucide-react";
import { relativeTime } from "@/lib/format";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { ConfirmButton } from "./ui/confirm-button";

interface Props {
  companies: CompanyDto[];
  readOnly: boolean;
  refreshing: Set<string>;
  onRefresh: (c: CompanyDto) => void;
  onDelete: (c: CompanyDto) => Promise<void>;
}

function safeHref(url: string): string | undefined {
  return /^https?:\/\//i.test(url) ? url : undefined;
}

export function CompaniesTable({ companies, readOnly, refreshing, onRefresh, onDelete }: Props) {
  return (
    <div className="overflow-x-auto rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
      <table className="w-full min-w-[720px] text-left text-sm">
        <thead className="border-b border-zinc-200 bg-zinc-50 text-xs uppercase tracking-wide text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900/60">
          <tr>
            <th scope="col" className="px-4 py-2.5 font-medium">Company</th>
            <th scope="col" className="px-4 py-2.5 font-medium">ATS</th>
            <th scope="col" className="px-4 py-2.5 font-medium text-right">Open jobs</th>
            <th scope="col" className="px-4 py-2.5 font-medium">Last checked</th>
            <th scope="col" className="px-4 py-2.5 font-medium">Added by</th>
            {!readOnly && (
              <th scope="col" className="px-4 py-2.5 font-medium">
                <span className="sr-only">Actions</span>
              </th>
            )}
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
          {companies.map((c) => (
            <tr key={c.id} className="align-top">
              <td className="max-w-[16rem] px-4 py-3">
                <a
                  href={safeHref(c.careerUrl)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-medium hover:text-indigo-600 hover:underline dark:hover:text-indigo-400"
                >
                  {c.name}
                </a>
                <span className="block truncate text-xs text-zinc-500" title={c.careerUrl}>
                  {c.careerUrl}
                </span>
              </td>
              <td className="px-4 py-3">
                <Badge>{c.atsType}</Badge>
                {c.atsToken && <span className="mt-1 block font-mono text-xs text-zinc-500">{c.atsToken}</span>}
              </td>
              <td className="px-4 py-3 text-right tabular-nums">{c.openJobs}</td>
              <td className="px-4 py-3">
                <span className="whitespace-nowrap">{c.lastCheckedAt ? relativeTime(c.lastCheckedAt) : "Not yet"}</span>
                {c.lastError && (
                  <span className="mt-1 block max-w-[14rem] text-xs break-words text-red-600 dark:text-red-400" title={c.lastError}>
                    {c.lastError}
                  </span>
                )}
              </td>
              <td className="px-4 py-3 whitespace-nowrap text-zinc-600 dark:text-zinc-400">
                {c.discoveredBy === "web_search" ? "Web search" : c.canDelete ? "You" : "A user"}
              </td>
              {!readOnly && (
                <td className="px-4 py-3">
                  <div className="flex justify-end gap-1">
                    <Button
                      size="sm"
                      variant="ghost"
                      loading={refreshing.has(c.id)}
                      onClick={() => onRefresh(c)}
                      aria-label={`Refresh ${c.name}`}
                    >
                      {!refreshing.has(c.id) && <RefreshCw className="size-4" aria-hidden="true" />}
                    </Button>
                    {c.canDelete && (
                      <ConfirmButton onConfirm={() => onDelete(c)} confirmLabel="Remove" aria-label={`Remove ${c.name}`}>
                        <Trash2 className="size-4" aria-hidden="true" />
                      </ConfirmButton>
                    )}
                  </div>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
