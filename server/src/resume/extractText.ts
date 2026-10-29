import mammoth from "mammoth";
import { PDFParse } from "pdf-parse";
import { env } from "../config/env.js";
import { HttpError } from "../lib/errors.js";

export type ResumeKind = "pdf" | "docx";

export const ALLOWED_MIME: Record<string, ResumeKind> = {
  "application/pdf": "pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
};

/** Checks the file's magic bytes too, since the browser-supplied MIME type can lie. */
export function detectKind(buffer: Buffer, mimetype: string): ResumeKind {
  const kind = ALLOWED_MIME[mimetype];
  const isPdf = buffer.subarray(0, 5).toString("latin1") === "%PDF-";
  const isZip = buffer[0] === 0x50 && buffer[1] === 0x4b; // DOCX is a zip
  if (kind === "pdf" && isPdf) return "pdf";
  if (kind === "docx" && isZip) return "docx";
  throw new HttpError(415, "Only PDF and DOCX files are supported");
}

export interface ExtractedText {
  text: string;
  /** Non-whitespace characters, before truncation. */
  chars: number;
  /** Too little text: treat as a scanned/image-only document. */
  scanned: boolean;
}

/** Plain text from the in-memory upload. Nothing is written to disk. */
export async function extractText(buffer: Buffer, kind: ResumeKind): Promise<ExtractedText> {
  let raw: string;
  try {
    if (kind === "pdf") {
      const parser = new PDFParse({ data: new Uint8Array(buffer) });
      try {
        raw = (await parser.getText()).text;
      } finally {
        await parser.destroy();
      }
    } else {
      raw = (await mammoth.extractRawText({ buffer })).value;
    }
  } catch {
    throw new HttpError(422, "The file could not be read. Is it a valid, unprotected PDF or DOCX?");
  }
  const text = raw.replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
  const chars = text.replace(/\s/g, "").length;
  return { text: text.slice(0, env.RESUME_MAX_TEXT_CHARS), chars, scanned: chars < env.RESUME_MIN_TEXT_CHARS };
}
