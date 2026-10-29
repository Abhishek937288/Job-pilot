import {
  preferencesSchema,
  type Preferences,
  type PreferencesInput,
  type RemotePreference,
} from "@jobpilot/shared";
import { issuesToFieldErrors } from "./format";

/** Form state for preferences: every field is a string while editing. */
export interface PreferencesFormState {
  desiredRole: string;
  locations: string;
  remote: RemotePreference;
  minSalary: string;
  salaryCurrency: string;
  noticePeriodDays: string;
  country: string;
}

export const emptyPreferencesForm: PreferencesFormState = {
  desiredRole: "",
  locations: "",
  remote: "any",
  minSalary: "",
  salaryCurrency: "INR",
  noticePeriodDays: "",
  country: "in",
};

export function preferencesToForm(p: Preferences): PreferencesFormState {
  return {
    desiredRole: p.desiredRole,
    locations: p.locations.join(", "),
    remote: p.remote,
    minSalary: p.minSalary === null ? "" : String(p.minSalary),
    salaryCurrency: p.salaryCurrency ?? "",
    noticePeriodDays: p.noticePeriodDays === null ? "" : String(p.noticePeriodDays),
    country: p.country,
  };
}

function toNumber(s: string): number | null {
  const t = s.trim().replace(/[,_\s]/g, "");
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : NaN;
}

export type PreferencesResult =
  | { ok: true; value: PreferencesInput }
  | { ok: false; errors: Record<string, string> };

/** Converts the form to `PreferencesInput` and validates it with the shared schema. */
export function parsePreferencesForm(f: PreferencesFormState): PreferencesResult {
  const minSalary = toNumber(f.minSalary);
  const notice = toNumber(f.noticePeriodDays);
  const errors: Record<string, string> = {};
  if (Number.isNaN(minSalary)) errors.minSalary = "Enter a number";
  if (Number.isNaN(notice)) errors.noticePeriodDays = "Enter a number of days";

  const value: PreferencesInput = {
    desiredRole: f.desiredRole.trim(),
    locations: f.locations
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
    remote: f.remote,
    minSalary: minSalary === null || Number.isNaN(minSalary) ? null : minSalary,
    salaryCurrency: f.salaryCurrency.trim() || null,
    noticePeriodDays: notice === null || Number.isNaN(notice) ? null : notice,
    country: f.country.trim() || "in",
  };
  if (value.minSalary !== null && !value.salaryCurrency) errors.salaryCurrency = "Pick the salary currency";

  const parsed = preferencesSchema.safeParse(value);
  if (!parsed.success) Object.assign(errors, { ...issuesToFieldErrors(parsed.error.issues), ...errors });
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, value };
}
