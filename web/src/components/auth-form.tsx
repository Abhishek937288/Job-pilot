"use client";

import { credentialsSchema, registerSchema, type UserDto } from "@jobpilot/shared";
import { useState, type FormEvent } from "react";
import { api, errorMessage, isApiError } from "@/lib/api";
import { issuesToFieldErrors } from "@/lib/format";
import { useAuthConfig } from "@/lib/session";
import { Button } from "./ui/button";
import { Alert } from "./ui/feedback";
import { describedBy, Field, Input } from "./ui/field";

interface AuthFormProps {
  mode: "login" | "signup";
  onSuccess: (user: UserDto) => void;
  /** Prefix for element ids, so two forms can share a page. */
  idPrefix?: string;
}

export function AuthForm({ mode, onSuccess, idPrefix = mode }: AuthFormProps) {
  const config = useAuthConfig();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setFormError(null);
    const parsed =
      mode === "signup"
        ? registerSchema.safeParse({ email, password, name: name.trim() || null })
        : credentialsSchema.safeParse({ email, password });
    if (!parsed.success) {
      setErrors(issuesToFieldErrors(parsed.error.issues));
      return;
    }
    setErrors({});
    setBusy(true);
    try {
      const user = await api<UserDto>(mode === "signup" ? "/auth/register" : "/auth/login", {
        method: "POST",
        json: parsed.data,
      });
      onSuccess(user);
    } catch (err) {
      if (isApiError(err, 400)) setErrors(issuesToFieldErrors(err.body.issues));
      if (isApiError(err, 401)) setFormError("Wrong email or password.");
      else if (isApiError(err, 409)) setErrors({ email: "An account with this email already exists. Log in instead." });
      else setFormError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const id = (f: string) => `${idPrefix}-${f}`;

  return (
    <div className="flex flex-col gap-5">
      {config?.googleEnabled && (
        <>
          {/* A plain link: the API answers with a 302 to Google. */}
          <a
            href="/api/auth/google"
            className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-zinc-300 bg-white text-sm font-medium hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-900 dark:hover:bg-zinc-800"
          >
            <GoogleMark />
            Continue with Google
          </a>
          <div className="flex items-center gap-3 text-xs text-zinc-500">
            <span className="h-px flex-1 bg-zinc-200 dark:bg-zinc-800" />
            or with email
            <span className="h-px flex-1 bg-zinc-200 dark:bg-zinc-800" />
          </div>
        </>
      )}
      <form onSubmit={submit} noValidate className="flex flex-col gap-4">
        {formError && <Alert tone="error">{formError}</Alert>}
        {mode === "signup" && (
          <Field id={id("name")} label="Name" optional error={errors.name}>
            <Input
              {...describedBy(id("name"), errors.name)}
              autoComplete="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={100}
            />
          </Field>
        )}
        <Field id={id("email")} label="Email" error={errors.email}>
          <Input
            {...describedBy(id("email"), errors.email)}
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </Field>
        <Field
          id={id("password")}
          label="Password"
          error={errors.password}
          hint={mode === "signup" ? "At least 8 characters." : undefined}
        >
          <Input
            {...describedBy(id("password"), errors.password, mode === "signup")}
            type="password"
            autoComplete={mode === "signup" ? "new-password" : "current-password"}
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </Field>
        <Button type="submit" loading={busy} className="w-full">
          {mode === "signup" ? "Create account" : "Log in"}
        </Button>
      </form>
    </div>
  );
}

function GoogleMark() {
  return (
    <svg viewBox="0 0 48 48" className="size-4" aria-hidden="true">
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
      <path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
    </svg>
  );
}
