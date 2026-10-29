"use client";

import type { ProfileDto } from "@jobpilot/shared";
import { useState } from "react";
import { api, errorMessage, isApiError } from "@/lib/api";
import { issuesToFieldErrors } from "@/lib/format";
import { parsePreferencesForm, preferencesToForm } from "@/lib/preferences-form";
import { PreferencesFields } from "./preferences-fields";
import { Button } from "./ui/button";
import { Alert } from "./ui/feedback";
import { describedBy, Field, Input } from "./ui/field";
import { Modal } from "./ui/modal";

interface Props {
  profile: ProfileDto;
  open: boolean;
  onClose: () => void;
  onSaved: (p: ProfileDto) => void;
}

export function EditPreferencesModal(props: Props) {
  // Remount the form each time it opens so it starts from the saved values.
  return (
    <Modal open={props.open} title="Edit profile" onClose={props.onClose}>
      {props.open && <EditForm {...props} />}
    </Modal>
  );
}

function EditForm({ profile, onClose, onSaved }: Props) {
  const [label, setLabel] = useState(profile.label);
  const [prefs, setPrefs] = useState(() => preferencesToForm(profile.preferences));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function save() {
    setFormError(null);
    const p = parsePreferencesForm(prefs);
    const next: Record<string, string> = p.ok ? {} : { ...p.errors };
    if (!label.trim()) next.label = "Give the profile a name";
    setErrors(next);
    if (!p.ok || Object.keys(next).length > 0) return;
    setBusy(true);
    try {
      const updated = await api<ProfileDto>(`/profiles/${profile.id}`, {
        method: "PATCH",
        json: { label: label.trim(), preferences: p.value },
      });
      onSaved(updated);
      onClose();
    } catch (err) {
      if (isApiError(err, 400)) setErrors(issuesToFieldErrors(err.body.issues));
      setFormError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
      className="flex flex-col gap-4"
    >
      <Alert tone="info">Changing preferences re-scores your jobs on the next search.</Alert>
      {formError && <Alert tone="error">{formError}</Alert>}
      <Field id="edit-label" label="Profile name" error={errors.label}>
        <Input {...describedBy("edit-label", errors.label)} value={label} onChange={(e) => setLabel(e.target.value)} maxLength={100} />
      </Field>
      <PreferencesFields value={prefs} onChange={setPrefs} errors={errors} disabled={busy} idPrefix="edit" />
      <div className="flex justify-end gap-2 pt-2">
        <Button variant="ghost" onClick={onClose} disabled={busy}>
          Cancel
        </Button>
        <Button type="submit" loading={busy}>
          Save
        </Button>
      </div>
    </form>
  );
}
