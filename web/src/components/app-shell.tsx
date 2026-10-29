"use client";

import type { ReactNode } from "react";
import { GuestBanner } from "./guest-banner";
import { Nav } from "./nav";

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col">
      <Nav />
      <GuestBanner />
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 sm:px-6 sm:py-8">{children}</main>
      <footer className="border-t border-zinc-200 py-6 text-center text-xs text-zinc-500 dark:border-zinc-800">
        JobPilot · Your resume file is never stored; only the parsed profile is kept.
      </footer>
    </div>
  );
}
