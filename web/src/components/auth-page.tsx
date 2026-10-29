"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { useRedirectIfSignedIn } from "@/lib/session";
import { AuthForm } from "./auth-form";
import { Alert, Card, PageLoader } from "./ui/feedback";

/** Shared shell for /login and /signup. Guests may use both (their data moves to the account). */
export function AuthPage({ mode, notice }: { mode: "login" | "signup"; notice?: ReactNode }) {
  const session = useRedirectIfSignedIn("/profiles", true);
  const router = useRouter();

  if (session.status === "loading" || (session.user && !session.user.isGuest)) return <PageLoader />;
  const isGuest = session.user?.isGuest ?? false;

  return (
    <div className="mx-auto w-full max-w-sm py-6">
      <h1 className="mb-1 text-2xl font-semibold tracking-tight">
        {mode === "login" ? "Log in to JobPilot" : "Create your account"}
      </h1>
      <p className="mb-6 text-sm text-zinc-500 dark:text-zinc-400">
        {mode === "login" ? (
          <>
            No account?{" "}
            <Link href="/signup" className="font-medium text-indigo-600 hover:underline dark:text-indigo-400">
              Sign up
            </Link>
          </>
        ) : (
          <>
            Already have one?{" "}
            <Link href="/login" className="font-medium text-indigo-600 hover:underline dark:text-indigo-400">
              Log in
            </Link>
          </>
        )}
      </p>
      {notice}
      {isGuest && (
        <Alert tone="info" className="mb-4">
          {mode === "signup"
            ? "You're using a guest session. Signing up keeps your profiles and jobs."
            : "You're using a guest session. Logging in moves your guest profiles and jobs into that account."}
        </Alert>
      )}
      <Card className="p-5">
        <AuthForm
          mode={mode}
          onSuccess={(user) => {
            session.setUser(user);
            router.replace("/profiles");
          }}
        />
      </Card>
    </div>
  );
}
