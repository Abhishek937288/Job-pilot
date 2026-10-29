"use client";

import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { AuthPage } from "@/components/auth-page";
import { Alert, PageLoader } from "@/components/ui/feedback";

function LoginInner() {
  const params = useSearchParams();
  const notice =
    params.get("error") === "google" ? (
      <Alert tone="error" className="mb-4">
        Google sign-in failed or was cancelled. Please try again, or use your email and password.
      </Alert>
    ) : undefined;
  return <AuthPage mode="login" notice={notice} />;
}

export default function LoginPage() {
  return (
    <Suspense fallback={<PageLoader />}>
      <LoginInner />
    </Suspense>
  );
}
