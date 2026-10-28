import { z } from "zod";
import type { ProfileData, RequiredProfileField } from "./profile.schema.ts";

export const loginRequestSchema = z.object({
  password: z.string().min(1).max(512),
});
export type LoginRequest = z.infer<typeof loginRequestSchema>;

export const EXTRACTION_STATUSES = ["PENDING", "SUCCEEDED", "FAILED", "NEEDS_REVIEW"] as const;
export type ExtractionStatus = (typeof EXTRACTION_STATUSES)[number];

export interface ResumeDto {
  id: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  uploadedAt: string;
  extractionStatus: ExtractionStatus;
  /** Human-readable reason when status is FAILED or NEEDS_REVIEW. */
  extractionError: string | null;
  extractedTextLength: number;
}

export interface ProfileDto {
  id: string;
  resumeId: string | null;
  data: ProfileData;
  missingRequired: RequiredProfileField[];
  readyForSearch: boolean;
  userEditedAt: string | null;
  updatedAt: string;
}

export interface UploadResumeResponse {
  resume: ResumeDto;
  profile: ProfileDto | null;
  /** True when this exact file was already uploaded; nothing new was extracted. */
  duplicate: boolean;
}

export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}
