"use client";

import type { ResumeDto, UploadResumeResponse } from "@jobpilot/shared";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { api, ApiError, errorMessage } from "@/lib/api";

const MAX_BYTES = 5 * 1024 * 1024;
const POLL_MS = 2000;

const STATUS_LABEL: Record<ResumeDto["extractionStatus"], string> = {
  PENDING: "Extracting profile…",
  SUCCEEDED: "Profile extracted",
  NEEDS_REVIEW: "Needs review",
  FAILED: "Failed",
};

export default function ResumePage() {
  const [resume, setResume] = useState<ResumeDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    api<ResumeDto>("/resumes/latest")
      .then(setResume)
      .catch((err) => {
        if (!(err instanceof ApiError && err.status === 404)) setError(errorMessage(err));
      })
      .finally(() => setLoading(false));
  }, []);

  // Poll while the worker is extracting.
  const resumeId = resume?.id;
  const pending = resume?.extractionStatus === "PENDING";
  useEffect(() => {
    if (!resumeId || !pending) return;
    const t = setInterval(() => {
      api<ResumeDto>(`/resumes/${resumeId}`).then(setResume).catch((err) => setError(errorMessage(err)));
    }, POLL_MS);
    return () => clearInterval(t);
  }, [resumeId, pending]);

  const onSubmit = useCallback(
    async (e: FormEvent) => {
      e.preventDefault();
      if (!file) return;
      setError(null);
      setNotice(null);
      if (file.size > MAX_BYTES) {
        setError("File is larger than the 5 MB limit.");
        return;
      }
      setUploading(true);
      try {
        const form = new FormData();
        form.append("file", file);
        const res = await api<UploadResumeResponse>("/resumes", { method: "POST", body: form });
        setResume(res.resume);
        if (res.duplicate) setNotice("This exact file was already uploaded; showing its existing result.");
        setFile(null);
        if (inputRef.current) inputRef.current.value = "";
      } catch (err) {
        setError(errorMessage(err));
      } finally {
        setUploading(false);
      }
    },
    [file],
  );

  async function retry() {
    if (!resume) return;
    setError(null);
    try {
      setResume(await api<ResumeDto>(`/resumes/${resume.id}/reextract`, { method: "POST" }));
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Resume</h1>
        <p className="text-sm text-muted-foreground">Upload your resume (PDF or DOCX, up to 5 MB). Your profile is extracted from it automatically.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Upload</CardTitle>
          <CardDescription>The original file is stored unchanged; tailored versions are always separate copies.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSubmit} className="flex flex-col gap-3 sm:flex-row">
            <Input
              ref={inputRef}
              type="file"
              accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
            <Button type="submit" disabled={!file || uploading}>
              {uploading ? "Uploading…" : "Upload"}
            </Button>
          </form>
        </CardContent>
      </Card>

      {error && (
        <Alert variant="destructive">
          <AlertTitle>Error</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      {notice && (
        <Alert>
          <AlertDescription>{notice}</AlertDescription>
        </Alert>
      )}

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : resume ? (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between gap-2">
              <CardTitle className="truncate">{resume.fileName}</CardTitle>
              <Badge variant={resume.extractionStatus === "SUCCEEDED" ? "default" : resume.extractionStatus === "PENDING" ? "secondary" : "destructive"}>
                {STATUS_LABEL[resume.extractionStatus]}
              </Badge>
            </div>
            <CardDescription>
              Uploaded {new Date(resume.uploadedAt).toLocaleString()} · {(resume.sizeBytes / 1024).toFixed(0)} KB ·{" "}
              {resume.extractedTextLength.toLocaleString()} characters of text
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {resume.extractionStatus === "PENDING" && <p className="text-sm text-muted-foreground">Reading your resume. This usually takes 10–30 seconds…</p>}

            {(resume.extractionStatus === "NEEDS_REVIEW" || resume.extractionStatus === "FAILED") && resume.extractionError && (
              <Alert variant={resume.extractionStatus === "FAILED" ? "destructive" : "default"}>
                <AlertTitle>{resume.extractionStatus === "FAILED" ? "Extraction failed" : "Couldn't extract your profile automatically"}</AlertTitle>
                <AlertDescription>{resume.extractionError}</AlertDescription>
              </Alert>
            )}

            <div className="flex flex-wrap gap-2">
              {resume.extractionStatus !== "PENDING" && (
                <Button asChild variant={resume.extractionStatus === "SUCCEEDED" ? "default" : "outline"}>
                  <Link href="/profile">{resume.extractionStatus === "SUCCEEDED" ? "Review profile" : "Fill in profile manually"}</Link>
                </Button>
              )}
              {resume.extractionStatus === "FAILED" && resume.extractedTextLength > 0 && (
                <Button variant="outline" onClick={retry}>
                  Retry extraction
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
      ) : (
        <p className="text-sm text-muted-foreground">No resume uploaded yet.</p>
      )}
    </div>
  );
}
