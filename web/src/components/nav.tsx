"use client";

import clsx from "clsx";
import { Briefcase } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSession } from "@/lib/session";
import { buttonClass } from "./ui/button";

const LINKS = [
  { href: "/profiles", label: "Profiles" },
  { href: "/companies", label: "Companies" },
  { href: "/account", label: "Account" },
] as const;

export function Nav() {
  const { status } = useSession();
  const pathname = usePathname();
  const signedIn = status === "authenticated";

  return (
    <header className="sticky top-0 z-30 border-b border-zinc-200 bg-white/85 backdrop-blur dark:border-zinc-800 dark:bg-zinc-950/85">
      <div className="mx-auto flex h-14 w-full max-w-6xl items-center gap-2 px-4 sm:px-6">
        <Link href={signedIn ? "/profiles" : "/"} className="mr-2 flex items-center gap-2 font-semibold sm:mr-4">
          <span className="flex size-7 items-center justify-center rounded-lg bg-indigo-600 text-white">
            <Briefcase className="size-4" aria-hidden="true" />
          </span>
          <span className="hidden min-[400px]:inline">JobPilot</span>
        </Link>
        {signedIn ? (
          <nav aria-label="Main" className="flex min-w-0 items-center gap-1">
            {LINKS.map((l) => {
              const active = pathname === l.href || pathname.startsWith(`${l.href}/`);
              return (
                <Link
                  key={l.href}
                  href={l.href}
                  aria-current={active ? "page" : undefined}
                  className={clsx(
                    "rounded-md px-2.5 py-1.5 text-sm font-medium transition-colors sm:px-3",
                    active
                      ? "bg-zinc-100 text-zinc-900 dark:bg-zinc-800 dark:text-zinc-50"
                      : "text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100",
                  )}
                >
                  {l.label}
                </Link>
              );
            })}
          </nav>
        ) : status === "anonymous" ? (
          <div className="ml-auto flex items-center gap-2">
            <Link href="/login" className={buttonClass("ghost", "sm")}>
              Log in
            </Link>
            <Link href="/signup" className={buttonClass("primary", "sm")}>
              Sign up
            </Link>
          </div>
        ) : null}
      </div>
    </header>
  );
}
