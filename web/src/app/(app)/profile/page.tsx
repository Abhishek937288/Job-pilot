"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import {
  missingRequiredFields,
  PROFICIENCIES,
  profileDataSchema,
  REMOTE_PREFERENCES,
  type ProfileData,
  type ProfileDto,
  type RequiredProfileField,
} from "@jobpilot/shared";
import { Plus, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { Controller, useFieldArray, useForm, type UseFormRegisterReturn } from "react-hook-form";
import { TagListInput } from "@/components/tag-list-input";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { api, ApiError, errorMessage } from "@/lib/api";
import { cn } from "@/lib/utils";

const EMPTY: ProfileData = {
  name: null,
  headline: null,
  totalYearsExperience: null,
  skills: [],
  roles: [],
  companies: [],
  education: [],
  projects: [],
  targetTitles: [],
  preferredLocations: [],
  remotePreference: null,
  noticePeriod: null,
  expectedSalary: null,
};

const FIELD_LABEL: Record<RequiredProfileField, string> = {
  name: "Name",
  skills: "Skills",
  targetTitles: "Target job titles",
  preferredLocations: "Preferred locations",
  remotePreference: "Remote preference",
};

const REMOTE_LABEL: Record<(typeof REMOTE_PREFERENCES)[number], string> = {
  ONSITE: "On-site",
  HYBRID: "Hybrid",
  REMOTE: "Remote",
  ANY: "Any",
};

// Empty inputs map to null rather than "" / NaN so they match the nullable schema.
const nullableText = { setValueAs: (v: unknown) => (typeof v === "string" && v.trim() === "" ? null : v) };
const nullableNumber = {
  setValueAs: (v: unknown) => (v === "" || v === null || v === undefined ? null : Number(v)),
};

function Field({
  label,
  htmlFor,
  missing,
  hint,
  error,
  children,
}: {
  label: string;
  htmlFor?: string;
  missing?: boolean;
  hint?: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cn("space-y-2 rounded-md", missing && "-m-2 bg-destructive/5 p-2 ring-1 ring-destructive/40")}>
      <Label htmlFor={htmlFor} className="flex items-center gap-2">
        {label}
        {missing && <span className="text-xs font-normal text-destructive">Required before searching</span>}
      </Label>
      {children}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}

function TextInput({ reg, invalid, ...rest }: { reg: UseFormRegisterReturn; invalid?: boolean } & React.ComponentProps<typeof Input>) {
  return <Input {...rest} {...reg} aria-invalid={invalid || undefined} className={cn(invalid && "border-destructive")} />;
}

export default function ProfilePage() {
  const [loaded, setLoaded] = useState(false);
  const [saved, setSaved] = useState<ProfileDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<Date | null>(null);

  const form = useForm<ProfileData>({ resolver: zodResolver(profileDataSchema), defaultValues: EMPTY });
  const { register, control, handleSubmit, reset, watch, formState } = form;
  const skills = useFieldArray({ control, name: "skills" });
  const education = useFieldArray({ control, name: "education" });
  const projects = useFieldArray({ control, name: "projects" });

  useEffect(() => {
    api<ProfileDto>("/profile")
      .then((p) => {
        setSaved(p);
        reset(p.data);
      })
      .catch((err) => {
        if (!(err instanceof ApiError && err.status === 404)) setError(errorMessage(err));
      })
      .finally(() => setLoaded(true));
  }, [reset]);

  const values = watch();
  const missing = new Set(missingRequiredFields({ ...EMPTY, ...values }));
  const isMissing = (f: RequiredProfileField) => missing.has(f);

  const onSubmit = handleSubmit(async (data) => {
    setError(null);
    try {
      const p = await api<ProfileDto>("/profile", { method: "PUT", body: JSON.stringify(data) });
      setSaved(p);
      reset(p.data);
      setSavedAt(new Date());
    } catch (err) {
      setError(errorMessage(err));
    }
  });

  if (!loaded) return <p className="text-sm text-muted-foreground">Loading…</p>;

  const errors = formState.errors;

  return (
    <form onSubmit={onSubmit} className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Profile</h1>
          <p className="text-sm text-muted-foreground">
            {saved ? "Review what was extracted from your resume and fill in anything missing." : "No profile yet. Upload a resume, or fill this in manually."}
          </p>
        </div>
        <div className="flex items-center gap-3">
          {missing.size === 0 ? <Badge>Ready for search</Badge> : <Badge variant="destructive">{missing.size} required missing</Badge>}
          <Button type="submit" disabled={formState.isSubmitting}>
            {formState.isSubmitting ? "Saving…" : "Save profile"}
          </Button>
        </div>
      </div>

      {missing.size > 0 && (
        <Alert variant="destructive">
          <AlertTitle>Complete these before running a job search</AlertTitle>
          <AlertDescription>{[...missing].map((f) => FIELD_LABEL[f]).join(", ")}</AlertDescription>
        </Alert>
      )}
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      {savedAt && !formState.isDirty && (
        <Alert>
          <AlertDescription>Saved at {savedAt.toLocaleTimeString()}.</AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Job search preferences</CardTitle>
          <CardDescription>These drive the search queries. Resumes rarely state them, so check them carefully.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-6 md:grid-cols-2">
          <Field label="Target job titles" htmlFor="targetTitles" missing={isMissing("targetTitles")}>
            <Controller
              control={control}
              name="targetTitles"
              render={({ field }) => (
                <TagListInput id="targetTitles" value={field.value} onChange={field.onChange} invalid={isMissing("targetTitles")} placeholder="e.g. Senior Backend Engineer" />
              )}
            />
          </Field>
          <Field label="Preferred locations" htmlFor="preferredLocations" missing={isMissing("preferredLocations")} hint='Cities or regions; add "Remote" if applicable.'>
            <Controller
              control={control}
              name="preferredLocations"
              render={({ field }) => (
                <TagListInput id="preferredLocations" value={field.value} onChange={field.onChange} invalid={isMissing("preferredLocations")} placeholder="e.g. Bangalore" />
              )}
            />
          </Field>
          <Field label="Remote preference" missing={isMissing("remotePreference")}>
            <Controller
              control={control}
              name="remotePreference"
              render={({ field }) => (
                <Select value={field.value ?? ""} onValueChange={(v) => field.onChange(v === "" ? null : v)}>
                  <SelectTrigger className={cn("w-full", isMissing("remotePreference") && "border-destructive")}>
                    <SelectValue placeholder="Select…" />
                  </SelectTrigger>
                  <SelectContent>
                    {REMOTE_PREFERENCES.map((r) => (
                      <SelectItem key={r} value={r}>
                        {REMOTE_LABEL[r]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            />
          </Field>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Notice period" htmlFor="noticePeriod">
              <TextInput id="noticePeriod" reg={register("noticePeriod", nullableText)} placeholder="e.g. 30 days" />
            </Field>
            <Field label="Expected salary" htmlFor="expectedSalary">
              <TextInput id="expectedSalary" reg={register("expectedSalary", nullableText)} placeholder="e.g. ₹40L" />
            </Field>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>About you</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-6 md:grid-cols-2">
          <Field label="Name" htmlFor="name" missing={isMissing("name")}>
            <TextInput id="name" reg={register("name", nullableText)} invalid={isMissing("name")} />
          </Field>
          <Field label="Headline" htmlFor="headline">
            <TextInput id="headline" reg={register("headline", nullableText)} />
          </Field>
          <Field label="Total years of experience" htmlFor="years" error={errors.totalYearsExperience?.message}>
            <TextInput id="years" type="number" step="0.1" min="0" reg={register("totalYearsExperience", nullableNumber)} />
          </Field>
          <div />
          <Field label="Roles / titles held">
            <Controller control={control} name="roles" render={({ field }) => <TagListInput value={field.value} onChange={field.onChange} />} />
          </Field>
          <Field label="Companies">
            <Controller control={control} name="companies" render={({ field }) => <TagListInput value={field.value} onChange={field.onChange} />} />
          </Field>
        </CardContent>
      </Card>

      <Card className={cn(isMissing("skills") && "border-destructive")}>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            Skills {isMissing("skills") && <span className="text-xs font-normal text-destructive">Required before searching</span>}
          </CardTitle>
          <CardDescription>Proficiency is a rough estimate from your resume. Adjust as needed.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {skills.fields.map((f, i) => (
            <div key={f.id} className="flex gap-2">
              <TextInput reg={register(`skills.${i}.name`)} placeholder="Skill" invalid={!!errors.skills?.[i]?.name} />
              <Controller
                control={control}
                name={`skills.${i}.proficiency`}
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger className="w-44">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {PROFICIENCIES.map((p) => (
                        <SelectItem key={p} value={p}>
                          {p.charAt(0) + p.slice(1).toLowerCase()}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
              <Button type="button" variant="ghost" size="icon" aria-label="Remove skill" onClick={() => skills.remove(i)}>
                <Trash2 />
              </Button>
            </div>
          ))}
          <Button type="button" variant="outline" size="sm" onClick={() => skills.append({ name: "", proficiency: "INTERMEDIATE" })}>
            <Plus /> Add skill
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Education</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {education.fields.map((f, i) => (
            <div key={f.id} className="grid gap-2 rounded-md border p-3 md:grid-cols-[2fr_1fr_1fr_6rem_6rem_auto]">
              <TextInput reg={register(`education.${i}.institution`)} placeholder="Institution" invalid={!!errors.education?.[i]?.institution} />
              <TextInput reg={register(`education.${i}.degree`, nullableText)} placeholder="Degree" />
              <TextInput reg={register(`education.${i}.field`, nullableText)} placeholder="Field" />
              <TextInput type="number" reg={register(`education.${i}.startYear`, nullableNumber)} placeholder="Start" />
              <TextInput type="number" reg={register(`education.${i}.endYear`, nullableNumber)} placeholder="End" />
              <Button type="button" variant="ghost" size="icon" aria-label="Remove education" onClick={() => education.remove(i)}>
                <Trash2 />
              </Button>
            </div>
          ))}
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => education.append({ institution: "", degree: null, field: null, startYear: null, endYear: null })}
          >
            <Plus /> Add education
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Projects</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {projects.fields.map((f, i) => (
            <div key={f.id} className="space-y-2 rounded-md border p-3">
              <div className="flex gap-2">
                <TextInput reg={register(`projects.${i}.name`)} placeholder="Project name" invalid={!!errors.projects?.[i]?.name} />
                <Button type="button" variant="ghost" size="icon" aria-label="Remove project" onClick={() => projects.remove(i)}>
                  <Trash2 />
                </Button>
              </div>
              <Textarea {...register(`projects.${i}.description`, nullableText)} placeholder="Description" rows={2} />
              <Controller
                control={control}
                name={`projects.${i}.technologies`}
                render={({ field }) => <TagListInput value={field.value} onChange={field.onChange} placeholder="Technologies" />}
              />
            </div>
          ))}
          <Button type="button" variant="outline" size="sm" onClick={() => projects.append({ name: "", description: null, technologies: [] })}>
            <Plus /> Add project
          </Button>
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button type="submit" disabled={formState.isSubmitting}>
          {formState.isSubmitting ? "Saving…" : "Save profile"}
        </Button>
      </div>
    </form>
  );
}
