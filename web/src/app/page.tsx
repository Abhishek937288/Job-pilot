"use client";

import type { UserDto } from "@jobpilot/shared";
import { FileText, ListChecks, Sparkles } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button, ButtonLink } from "@/components/ui/button";
import { Alert, PageLoader } from "@/components/ui/feedback";
import { api, errorMessage } from "@/lib/api";
import { useAuthConfig, useRedirectIfSignedIn } from "@/lib/session";

const STEPS = [
  { icon: FileText, title: "Upload your resume", text: "PDF or DOCX. We read it, then drop the file — only the parsed profile is kept." },
  { icon: Sparkles, title: "Set your preferences", text: "Role, locations, remote, salary floor. We search job boards and company career pages." },
  { icon: ListChecks, title: "Review ranked matches", text: "Every job is scored on skills, seniority, location and salary, with the reasons why." },
];

export default function LandingPage() {
  const session = useRedirectIfSignedIn("/profiles");
  const config = useAuthConfig();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (session.status !== "anonymous") return <PageLoader />;

  async function startGuest() {
    setBusy(true);
    setError(null);
    try {
      const user = await api<UserDto>("/auth/guest", { method: "POST" });
      session.setUser(user);
      router.replace("/profiles");
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto flex max-w-3xl flex-col items-center py-10 text-center sm:py-16">
      <span className="mb-4 rounded-full bg-indigo-50 px-3 py-1 text-xs font-medium text-indigo-700 dark:bg-indigo-950/60 dark:text-indigo-300">
        Resume-to-job matcher
      </span>
      <h1 className="text-4xl font-semibold tracking-tight text-balance sm:text-5xl">
        Find jobs that actually fit your resume.
      </h1>
      <p className="mt-4 max-w-xl text-base text-zinc-600 text-pretty dark:text-zinc-400">
        JobPilot reads your resume, searches Google for Jobs, company ATS boards and the web, removes duplicates and
        ranks every job against your experience. Mark jobs done or dismiss them — they never come back.
      </p>
      {error && (
        <Alert tone="error" className="mt-6 w-full max-w-md text-left">
          {error}
        </Alert>
      )}
      <div className="mt-8 flex w-full flex-col gap-3 sm:w-auto sm:flex-row">
        {config?.guestEnabled !== false && (
          <Button onClick={startGuest} loading={busy} className="h-11 px-6">
            Continue as guest
          </Button>
        )}
        <ButtonLink href="/signup" variant="secondary" className="h-11 px-6">
          Sign up
        </ButtonLink>
        <ButtonLink href="/login" variant="ghost" className="h-11 px-6">
          Log in
        </ButtonLink>
      </div>
      <ol className="mt-14 grid w-full gap-4 text-left sm:grid-cols-3">
        {STEPS.map((s, i) => (
          <li key={s.title} className="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
            <s.icon className="mb-3 size-5 text-indigo-600 dark:text-indigo-400" aria-hidden="true" />
            <h2 className="font-medium">
              {i + 1}. {s.title}
            </h2>
            <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">{s.text}</p>
          </li>
        ))}
      </ol>
    </div>
  );
}
