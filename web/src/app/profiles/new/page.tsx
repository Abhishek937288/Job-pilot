"use client";

import type { CreateProfileResponse } from "@jobpilot/shared";
import { ArrowLeft, FileText } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { PreferencesFields } from "@/components/preferences-fields";
import { UploadProgress } from "@/components/upload-progress";
import { Button } from "@/components/ui/button";
import { Alert, Card, PageHeader, PageLoader } from "@/components/ui/feedback";
import { describedBy, Field, Input } from "@/components/ui/field";
import { api, errorMessage, isApiError } from "@/lib/api";
import { issuesToFieldErrors } from "@/lib/format";
import { emptyPreferencesForm, parsePreferencesForm } from "@/lib/preferences-form";
import { useRequireSession } from "@/lib/session";

const MAX_BYTES = 5 * 1024 * 1024;
const ACCEPT =
  ".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document";

function checkFile(f: File | null): string | null {
  if (!f) return "Choose a PDF or DOCX file";
  if (!/\.(pdf|docx)$/i.test(f.name)) return "Only PDF and DOCX files are supported";
  if (f.size > MAX_BYTES) return "The file must be 5 MB or smaller";
  return null;
}

export default function NewProfilePage() {
  const session = useRequireSession();
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [label, setLabel] = useState("");
  const [consent, setConsent] = useState(false);
  const [prefs, setPrefs] = useState(emptyPreferencesForm);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (session.status !== "authenticated") return <PageLoader />;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setFormError(null);
    const next: Record<string, string> = {};
    const fileError = checkFile(file);
    if (fileError) next.file = fileError;
    if (!consent) next.consent = "Consent is required to process your resume";
    const p = parsePreferencesForm(prefs);
    if (!p.ok) Object.assign(next, p.errors);
    setErrors(next);
    if (Object.keys(next).length > 0 || !p.ok || !file) return;

    const form = new FormData();
    form.append("file", file);
    form.append("preferences", JSON.stringify(p.value));
    form.append("consent", "true");
    if (label.trim()) form.append("label", label.trim());

    setBusy(true);
    try {
      const res = await api<CreateProfileResponse>("/profiles", { method: "POST", form });
      void session.refresh(); // search quota changed
      router.replace(`/profiles/${res.profile.id}`);
    } catch (err) {
      setBusy(false);
      if (isApiError(err, 400) && err.body.issues?.length) setErrors(issuesToFieldErrors(err.body.issues));
      if (isApiError(err, 413) || isApiError(err, 415)) setErrors({ file: err.body.error });
      setFormError(
        isApiError(err, 422)
          ? `${err.body.error} Try a text-based PDF or a DOCX export of your resume.`
          : errorMessage(err),
      );
    }
  }

  return (
    <div className="mx-auto max-w-2xl">
      <Link href="/profiles" className="mb-4 inline-flex items-center gap-1 text-sm text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200">
        <ArrowLeft className="size-4" aria-hidden="true" /> Profiles
      </Link>
      <PageHeader title="New profile" subtitle="Upload a resume and tell us what you're looking for." />
      <Card className="p-5 sm:p-6">
        {busy ? (
          <UploadProgress />
        ) : (
          <form onSubmit={submit} noValidate className="flex flex-col gap-6">
            {formError && <Alert tone="error">{formError}</Alert>}
            <section className="flex flex-col gap-4">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">Resume</h2>
              <Field id="file" label="Resume file" error={errors.file} hint="PDF or DOCX, up to 5 MB. The file is never stored.">
                <input
                  {...describedBy("file", errors.file, true)}
                  type="file"
                  accept={ACCEPT}
                  className="peer sr-only"
                  onChange={(e) => {
                    const f = e.target.files?.[0] ?? null;
                    setFile(f);
                    const problem = f ? checkFile(f) : null;
                    setErrors((prev) => {
                      const { file: _old, ...rest } = prev;
                      return problem ? { ...rest, file: problem } : rest;
                    });
                  }}
                />
                <label
                  htmlFor="file"
                  className="flex cursor-pointer items-center gap-3 rounded-lg border-2 border-dashed border-zinc-300 px-4 py-5 hover:border-indigo-400 peer-focus-visible:border-indigo-500 peer-focus-visible:ring-2 peer-focus-visible:ring-indigo-500/40 dark:border-zinc-700"
                >
                  <FileText className="size-6 shrink-0 text-zinc-400" aria-hidden="true" />
                  <span className="min-w-0 truncate text-sm">
                    {file ? (
                      <>
                        <span className="font-medium">{file.name}</span>{" "}
                        <span className="text-zinc-500">({(file.size / 1024 / 1024).toFixed(2)} MB)</span>
                      </>
                    ) : (
                      <span className="text-zinc-500">Click to choose a file</span>
                    )}
                  </span>
                </label>
              </Field>
              <Field id="label" label="Profile name" optional hint="Defaults to your desired role.">
                <Input id="label" value={label} onChange={(e) => setLabel(e.target.value)} maxLength={100} />
              </Field>
            </section>
            <section className="flex flex-col gap-4">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">Preferences</h2>
              <PreferencesFields value={prefs} onChange={setPrefs} errors={errors} />
            </section>
            <div className="flex flex-col gap-1.5">
              <label className="flex items-start gap-3 text-sm">
                <input
                  type="checkbox"
                  checked={consent}
                  onChange={(e) => setConsent(e.target.checked)}
                  aria-invalid={errors.consent ? true : undefined}
                  aria-describedby={errors.consent ? "consent-error" : undefined}
                  className="mt-0.5 size-4 rounded border-zinc-300 accent-indigo-600"
                />
                <span>
                  I agree that JobPilot may process my resume with an AI model to extract my profile. The file is
                  discarded after reading; I can delete the profile and its jobs at any time.
                </span>
              </label>
              {errors.consent && (
                <p id="consent-error" className="pl-7 text-xs text-red-600 dark:text-red-400">
                  {errors.consent}
                </p>
              )}
            </div>
            <div className="flex justify-end">
              <Button type="submit" className="w-full sm:w-auto">
                Upload and find jobs
              </Button>
            </div>
          </form>
        )}
      </Card>
    </div>
  );
}
