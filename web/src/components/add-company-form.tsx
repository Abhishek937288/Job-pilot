"use client";

import { createCompanySchema, type CompanyDto } from "@jobpilot/shared";
import { Plus } from "lucide-react";
import { useState, type FormEvent } from "react";
import { api, errorMessage, isApiError } from "@/lib/api";
import { issuesToFieldErrors } from "@/lib/format";
import { Button } from "./ui/button";
import { Alert } from "./ui/feedback";
import { describedBy, Field, Input } from "./ui/field";

export function AddCompanyForm({ onAdded }: { onAdded: (c: CompanyDto) => void }) {
  const [url, setUrl] = useState("");
  const [name, setName] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setFormError(null);
    const parsed = createCompanySchema.safeParse({ careerUrl: url.trim(), name: name.trim() || undefined });
    if (!parsed.success) {
      setErrors(issuesToFieldErrors(parsed.error.issues));
      return;
    }
    setErrors({});
    setBusy(true);
    try {
      const company = await api<CompanyDto>("/companies", { method: "POST", json: parsed.data });
      onAdded(company);
      setUrl("");
      setName("");
    } catch (err) {
      if (isApiError(err, 400)) setErrors(issuesToFieldErrors(err.body.issues));
      setFormError(isApiError(err, 409) ? "That board is already on the watchlist." : errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-3">
      {formError && <Alert tone="error">{formError}</Alert>}
      <div className="grid gap-3 sm:grid-cols-[2fr_1fr_auto] sm:items-start">
        <Field
          id="company-url"
          label="Careers page or job board URL"
          error={errors.careerUrl}
          hint="e.g. https://boards.greenhouse.io/acme or https://jobs.lever.co/acme"
        >
          <Input
            {...describedBy("company-url", errors.careerUrl, true)}
            type="url"
            inputMode="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://"
            required
          />
        </Field>
        <Field id="company-name" label="Company name" optional error={errors.name}>
          <Input {...describedBy("company-name", errors.name)} value={name} onChange={(e) => setName(e.target.value)} maxLength={120} />
        </Field>
        <Button type="submit" loading={busy} className="sm:mt-6.5">
          {!busy && <Plus className="size-4" aria-hidden="true" />} Add
        </Button>
      </div>
    </form>
  );
}
