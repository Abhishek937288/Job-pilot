"use client";

import { REMOTE_PREFERENCES, type RemotePreference } from "@jobpilot/shared";
import type { PreferencesFormState } from "@/lib/preferences-form";
import { describedBy, Field, Input, Select } from "./ui/field";

const REMOTE_LABELS: Record<RemotePreference, string> = {
  any: "Any",
  remote: "Remote",
  hybrid: "Hybrid",
  onsite: "On-site",
};

const CURRENCIES = ["INR", "USD", "EUR", "GBP", "CAD", "AUD", "SGD", "AED"];

interface Props {
  value: PreferencesFormState;
  onChange: (v: PreferencesFormState) => void;
  errors: Record<string, string>;
  disabled?: boolean;
  idPrefix?: string;
}

export function PreferencesFields({ value, onChange, errors, disabled, idPrefix = "pref" }: Props) {
  const set = <K extends keyof PreferencesFormState>(k: K, v: PreferencesFormState[K]) => onChange({ ...value, [k]: v });
  const id = (f: string) => `${idPrefix}-${f}`;
  const currencyOptions = value.salaryCurrency && !CURRENCIES.includes(value.salaryCurrency.toUpperCase())
    ? [value.salaryCurrency.toUpperCase(), ...CURRENCIES]
    : CURRENCIES;

  return (
    <fieldset disabled={disabled} className="grid gap-4 sm:grid-cols-2">
      <legend className="sr-only">Job preferences</legend>
      <Field id={id("role")} label="Desired role" error={errors.desiredRole} className="sm:col-span-2" hint="e.g. Senior Backend Engineer">
        <Input
          {...describedBy(id("role"), errors.desiredRole, true)}
          value={value.desiredRole}
          onChange={(e) => set("desiredRole", e.target.value)}
          required
          maxLength={120}
        />
      </Field>
      <Field
        id={id("locations")}
        label="Locations"
        optional
        error={errors.locations}
        hint="Comma-separated, e.g. Bengaluru, Pune. Leave empty for anywhere."
        className="sm:col-span-2"
      >
        <Input
          {...describedBy(id("locations"), errors.locations, true)}
          value={value.locations}
          onChange={(e) => set("locations", e.target.value)}
        />
      </Field>
      <Field id={id("remote")} label="Work arrangement" error={errors.remote}>
        <Select
          {...describedBy(id("remote"), errors.remote)}
          value={value.remote}
          onChange={(e) => set("remote", e.target.value as RemotePreference)}
        >
          {REMOTE_PREFERENCES.map((r) => (
            <option key={r} value={r}>
              {REMOTE_LABELS[r]}
            </option>
          ))}
        </Select>
      </Field>
      <Field id={id("country")} label="Search country" error={errors.country} hint="2-letter code, e.g. in, us, gb">
        <Input
          {...describedBy(id("country"), errors.country, true)}
          value={value.country}
          onChange={(e) => set("country", e.target.value)}
          maxLength={2}
          autoCapitalize="none"
          className="lowercase"
        />
      </Field>
      <div className="grid grid-cols-[1fr_7rem] gap-2">
        <Field id={id("salary")} label="Min annual salary" optional error={errors.minSalary}>
          <Input
            {...describedBy(id("salary"), errors.minSalary)}
            inputMode="numeric"
            value={value.minSalary}
            onChange={(e) => set("minSalary", e.target.value)}
            placeholder="1500000"
          />
        </Field>
        <Field id={id("currency")} label="Currency" error={errors.salaryCurrency}>
          <Select
            {...describedBy(id("currency"), errors.salaryCurrency)}
            value={value.salaryCurrency.toUpperCase()}
            onChange={(e) => set("salaryCurrency", e.target.value)}
          >
            <option value="">—</option>
            {currencyOptions.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <Field id={id("notice")} label="Notice period (days)" optional error={errors.noticePeriodDays}>
        <Input
          {...describedBy(id("notice"), errors.noticePeriodDays)}
          inputMode="numeric"
          value={value.noticePeriodDays}
          onChange={(e) => set("noticePeriodDays", e.target.value)}
          placeholder="30"
        />
      </Field>
    </fieldset>
  );
}
