"use client";

import { Check } from "lucide-react";
import { useEffect, useState } from "react";
import { Spinner } from "./ui/feedback";

const PHASES = [
  { after: 0, label: "Uploading your resume" },
  { after: 2, label: "Extracting the text" },
  { after: 5, label: "Reading your skills and experience" },
  { after: 15, label: "Almost there — setting up your job search" },
];

/** Shown while POST /profiles runs (5–30 s). The phases are time-based hints, not server events. */
export function UploadProgress() {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, []);
  const current = PHASES.reduce((acc, p, i) => (seconds >= p.after ? i : acc), 0);

  return (
    <div role="status" aria-live="polite" className="flex flex-col items-center gap-5 py-10 text-center">
      <Spinner className="size-8 text-indigo-600" />
      <div>
        <p className="text-lg font-semibold">Reading your resume…</p>
        <p className="mt-1 text-sm text-zinc-500">This usually takes 5 to 30 seconds. Please keep this tab open.</p>
      </div>
      <ol className="flex w-full max-w-xs flex-col gap-2 text-left text-sm">
        {PHASES.map((p, i) => (
          <li
            key={p.label}
            className={i < current ? "text-zinc-500" : i === current ? "font-medium" : "text-zinc-400 dark:text-zinc-600"}
          >
            <span className="mr-2 inline-flex size-4 items-center justify-center align-middle">
              {i < current ? <Check className="size-4 text-emerald-600" aria-hidden="true" /> : i === current ? <Spinner className="size-3.5" /> : "·"}
            </span>
            {p.label}
          </li>
        ))}
      </ol>
      <p className="text-xs text-zinc-400">{seconds}s</p>
    </div>
  );
}
