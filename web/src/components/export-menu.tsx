"use client";

import { EXPORT_FORMATS, type JobStatus } from "@jobpilot/shared";
import { ChevronDown, Download } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { buttonClass } from "./ui/button";

const SCOPES: { value: "" | JobStatus; label: string }[] = [
  { value: "", label: "All except deleted" },
  { value: "new", label: "New" },
  { value: "done", label: "Done" },
  { value: "deleted", label: "Deleted" },
];

const FORMAT_LABELS = { csv: "CSV", xlsx: "Excel (XLSX)", json: "JSON" } as const;

export function ExportMenu({ profileId }: { profileId: string }) {
  const [open, setOpen] = useState(false);
  const [scope, setScope] = useState<"" | JobStatus>("");
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const href = (format: string) => {
    const qs = new URLSearchParams({ format });
    if (scope) qs.set("status", scope);
    return `/api/profiles/${profileId}/export?${qs}`;
  };

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        className={buttonClass("secondary", "md")}
        aria-expanded={open}
        aria-haspopup="true"
        onClick={() => setOpen((o) => !o)}
      >
        <Download className="size-4" aria-hidden="true" /> Export
        <ChevronDown className="size-4" aria-hidden="true" />
      </button>
      {open && (
        <div className="absolute right-0 z-20 mt-2 w-60 rounded-xl border border-zinc-200 bg-white p-3 shadow-lg dark:border-zinc-800 dark:bg-zinc-900">
          <label htmlFor="export-scope" className="text-xs font-medium text-zinc-500">
            Jobs to include
          </label>
          <select
            id="export-scope"
            value={scope}
            onChange={(e) => setScope(e.target.value as "" | JobStatus)}
            className="mt-1 mb-3 block w-full rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-900"
          >
            {SCOPES.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
          <ul className="flex flex-col">
            {EXPORT_FORMATS.map((f) => (
              <li key={f}>
                <a
                  href={href(f)}
                  download
                  onClick={() => setOpen(false)}
                  className="block rounded-md px-2 py-1.5 text-sm hover:bg-zinc-100 dark:hover:bg-zinc-800"
                >
                  Download {FORMAT_LABELS[f]}
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
