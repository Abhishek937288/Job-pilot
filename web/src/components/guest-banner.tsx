"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { formatDate } from "@/lib/format";
import { useSession } from "@/lib/session";

export function GuestBanner() {
  const { user } = useSession();
  const pathname = usePathname();
  if (!user?.isGuest) return null;
  return (
    <div className="border-b border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-200">
      <p className="mx-auto max-w-6xl px-4 py-2 text-sm sm:px-6">
        Guest session — data expires on {formatDate(user.guestExpiresAt)}.{" "}
        {pathname !== "/signup" && (
          <Link href="/signup" className="font-semibold underline underline-offset-2">
            Sign up to keep it.
          </Link>
        )}
      </p>
    </div>
  );
}
