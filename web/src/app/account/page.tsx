"use client";

import { LogOut } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";
import { AuthForm } from "@/components/auth-form";
import { Button } from "@/components/ui/button";
import { Alert, Card, PageHeader, PageLoader } from "@/components/ui/feedback";
import { Field, Input } from "@/components/ui/field";
import { api, errorMessage } from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import { useRequireSession } from "@/lib/session";

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 py-3 sm:flex-row sm:gap-4">
      <dt className="w-44 shrink-0 text-sm text-zinc-500">{label}</dt>
      <dd className="min-w-0 text-sm break-words">{children}</dd>
    </div>
  );
}

export default function AccountPage() {
  const session = useRequireSession();
  const router = useRouter();
  const [confirmText, setConfirmText] = useState("");
  const [busy, setBusy] = useState<"logout" | "delete" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [signedUp, setSignedUp] = useState(false);

  if (session.status !== "authenticated" || !session.user) return <PageLoader />;
  const { user } = session;

  async function logout() {
    setBusy("logout");
    try {
      await api("/auth/logout", { method: "POST" });
    } catch {
      // Clear the local session anyway.
    }
    session.setUser(null);
    router.replace("/");
  }

  async function deleteAccount() {
    setBusy("delete");
    setError(null);
    try {
      await api("/auth/account", { method: "DELETE" });
      session.setUser(null);
      router.replace("/");
    } catch (err) {
      setError(errorMessage(err));
      setBusy(null);
    }
  }

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6">
      <PageHeader title="Account" />
      {signedUp && <Alert tone="success">Account created. Your guest profiles and jobs are kept.</Alert>}

      <Card className="px-5">
        <dl className="divide-y divide-zinc-100 dark:divide-zinc-800">
          <Row label="Signed in as">
            {user.isGuest ? (
              <span>Guest</span>
            ) : (
              <>
                {user.name && <span className="font-medium">{user.name} · </span>}
                {user.email}
              </>
            )}
          </Row>
          {user.isGuest && <Row label="Guest data expires">{formatDateTime(user.guestExpiresAt)}</Row>}
          {!user.isGuest && user.authProviders.length > 0 && (
            <Row label="Sign-in methods">
              {user.authProviders.map((p) => (p === "google" ? "Google" : "Email and password")).join(", ")}
            </Row>
          )}
          <Row label="Searches today">
            {user.limits.searchesUsedToday} of {user.limits.dailySearches}
          </Row>
          <Row label="Profiles allowed">{user.limits.maxProfiles}</Row>
        </dl>
      </Card>

      {user.isGuest && (
        <Card className="p-5">
          <h2 className="mb-1 text-base font-semibold">Keep your data</h2>
          <p className="mb-4 text-sm text-zinc-500">
            Sign up to keep your profiles and jobs after the guest session expires. Everything you have now moves to the new
            account.
          </p>
          <AuthForm
            mode="signup"
            idPrefix="account-signup"
            onSuccess={(u) => {
              session.setUser(u);
              setSignedUp(true);
            }}
          />
        </Card>
      )}

      <Card className="flex flex-col gap-3 p-5 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-base font-semibold">Log out</h2>
          <p className="text-sm text-zinc-500">
            {user.isGuest ? "As a guest you can't log back in to this session." : "End this session on this device."}
          </p>
        </div>
        <Button variant="secondary" onClick={logout} loading={busy === "logout"}>
          <LogOut className="size-4" aria-hidden="true" /> Log out
        </Button>
      </Card>

      <Card className="border-red-200 p-5 dark:border-red-900/60">
        <h2 className="text-base font-semibold text-red-700 dark:text-red-400">Delete account</h2>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
          Permanently deletes your account and every profile, job and search run. This cannot be undone.
        </p>
        {error && (
          <Alert tone="error" className="mt-3">
            {error}
          </Alert>
        )}
        <form
          className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-end"
          onSubmit={(e) => {
            e.preventDefault();
            if (confirmText === "DELETE") void deleteAccount();
          }}
        >
          <Field id="confirm-delete" label='Type "DELETE" to confirm' className="flex-1">
            <Input
              id="confirm-delete"
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              autoComplete="off"
              spellCheck={false}
            />
          </Field>
          <Button type="submit" variant="danger" disabled={confirmText !== "DELETE"} loading={busy === "delete"}>
            Delete my account
          </Button>
        </form>
      </Card>
    </div>
  );
}
