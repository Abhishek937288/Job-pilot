import { createHash } from "node:crypto";
import type { ResumeDto, UploadResumeResponse } from "@jobpilot/shared";
import { env } from "../config/env.js";
import { prisma } from "../db/prisma.js";
import type { Resume } from "../generated/prisma/client.js";
import { HttpError } from "../lib/http-error.js";
import { logger } from "../lib/logger.js";
import { getBoss, QUEUES, type ExtractProfileJob } from "../queue/boss.js";
import { getActiveProfile } from "./profile.service.js";
import { detectResumeKind, extractResumeText, meaningfulCharCount, MIME_BY_KIND } from "./resume-file.js";

type ResumeMeta = Omit<Resume, "fileData">;

export function toResumeDto(r: ResumeMeta): ResumeDto {
  return {
    id: r.id,
    fileName: r.fileName,
    mimeType: r.mimeType,
    sizeBytes: r.sizeBytes,
    uploadedAt: r.uploadedAt.toISOString(),
    extractionStatus: r.extractionStatus,
    extractionError: r.extractionError,
    extractedTextLength: r.extractedText.length,
  };
}

export function scannedPdfMessage(chars: number): string {
  return (
    `Only ${chars} readable characters were found in this file. It is probably a scanned or image-only PDF, ` +
    `so automatic profile extraction was skipped. Upload a text-based PDF or a DOCX, or fill in your profile manually.`
  );
}

async function enqueueExtraction(resumeId: string): Promise<void> {
  const boss = await getBoss();
  const data: ExtractProfileJob = { resumeId };
  // No singletonKey: the handler is idempotent (skips anything not PENDING).
  await boss.send(QUEUES.extractProfile, data);
}

export interface UploadedFile {
  originalname: string;
  buffer: Buffer;
  size: number;
}

export async function ingestResume(file: UploadedFile): Promise<UploadResumeResponse> {
  const kind = detectResumeKind(file.buffer);
  if (!kind) {
    throw new HttpError(415, "UNSUPPORTED_FILE", "Only PDF and DOCX files are accepted (file contents match neither format).");
  }

  const sha256 = createHash("sha256").update(file.buffer).digest("hex");
  const existing = await prisma.resume.findUnique({ where: { sha256 }, omit: { fileData: true } });
  if (existing) {
    return { resume: toResumeDto(existing), profile: await getActiveProfile(), duplicate: true };
  }

  let text = "";
  let status: Resume["extractionStatus"] = "PENDING";
  let error: string | null = null;
  try {
    text = await extractResumeText(file.buffer, kind);
    const chars = meaningfulCharCount(text);
    if (chars < env.RESUME_MIN_TEXT_CHARS) {
      status = "NEEDS_REVIEW";
      error = scannedPdfMessage(chars);
    }
  } catch (err) {
    logger.warn({ err, kind }, "resume text extraction failed");
    status = "FAILED";
    error = "Could not read this file. It may be corrupted or password-protected.";
  }

  const resume = await prisma.resume.create({
    data: {
      fileName: file.originalname.slice(0, 255),
      mimeType: MIME_BY_KIND[kind],
      sizeBytes: file.size,
      sha256,
      fileData: new Uint8Array(file.buffer),
      extractedText: text,
      extractionStatus: status,
      extractionError: error,
    },
    omit: { fileData: true },
  });

  if (status === "PENDING") {
    try {
      await enqueueExtraction(resume.id);
    } catch (err) {
      await prisma.resume.update({
        where: { id: resume.id },
        data: { extractionStatus: "FAILED", extractionError: "Could not queue profile extraction. Try again." },
      });
      throw err;
    }
  }

  return { resume: toResumeDto(resume), profile: await getActiveProfile(), duplicate: false };
}

export async function getResume(id: string): Promise<ResumeDto> {
  const r = await prisma.resume.findUnique({ where: { id }, omit: { fileData: true } });
  if (!r) throw new HttpError(404, "NOT_FOUND", "Resume not found");
  return toResumeDto(r);
}

export async function getLatestResume(): Promise<ResumeDto | null> {
  const r = await prisma.resume.findFirst({ orderBy: { uploadedAt: "desc" }, omit: { fileData: true } });
  return r ? toResumeDto(r) : null;
}

/** Retry LLM extraction after a FAILED/NEEDS_REVIEW result (only if there is usable text). */
export async function reextractResume(id: string): Promise<ResumeDto> {
  const r = await prisma.resume.findUnique({ where: { id }, omit: { fileData: true } });
  if (!r) throw new HttpError(404, "NOT_FOUND", "Resume not found");
  const chars = meaningfulCharCount(r.extractedText);
  if (chars < env.RESUME_MIN_TEXT_CHARS) {
    throw new HttpError(422, "TEXT_TOO_SHORT", scannedPdfMessage(chars));
  }
  if (r.extractionStatus === "PENDING") return toResumeDto(r);

  const updated = await prisma.resume.update({
    where: { id },
    data: { extractionStatus: "PENDING", extractionError: null },
    omit: { fileData: true },
  });
  await enqueueExtraction(id);
  return toResumeDto(updated);
}
