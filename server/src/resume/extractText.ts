import mammoth from "mammoth";
import { env } from "../config/env.js";
import { HttpError } from "../lib/errors.js";
import { logger } from "../lib/logger.js";

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

/**
 * pdfjs touches these browser globals at import time and loads `@napi-rs/canvas` to provide them, but that
 * native package isn't bundled on serverless hosts. Text extraction never draws, so inert stand-ins are enough.
 */
function stubCanvasGlobals(): void {
  const g = globalThis as Record<string, unknown>;
  for (const name of ["DOMMatrix", "ImageData", "Path2D"]) g[name] ??= class {};
}

/**
 * pdfjs imports its worker by a computed path that bundlers and serverless tracing miss. A static import is
 * traced, and pdfjs uses `globalThis.pdfjsWorker` when set instead of importing the file itself.
 */
async function preloadPdfWorker(): Promise<void> {
  const g = globalThis as Record<string, unknown>;
  // @ts-expect-error pdfjs-dist ships no types for this deep import
  g.pdfjsWorker ??= await import("pdfjs-dist/legacy/build/pdf.worker.mjs");
}

/** Plain text from the in-memory upload. Nothing is written to disk. */
export async function extractText(buffer: Buffer, kind: ResumeKind): Promise<ExtractedText> {
  let raw: string;
  try {
    if (kind === "pdf") {
      // Loaded on demand: pdfjs needs browser globals at import time, which would crash serverless startup.
      stubCanvasGlobals();
      await preloadPdfWorker();
      const { PDFParse } = await import("pdf-parse");
      const parser = new PDFParse({ data: new Uint8Array(buffer) });
      try {
        raw = (await parser.getText()).text;
      } finally {
        await parser.destroy();
      }
    } else {
      raw = (await mammoth.extractRawText({ buffer })).value;
    }
  } catch (err) {
    logger.warn({ err, kind }, "resume text extraction failed");
    throw new HttpError(422, "The file could not be read. Is it a valid, unprotected PDF or DOCX?");
  }
  const text = raw.replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
  const chars = text.replace(/\s/g, "").length;
  return { text: text.slice(0, env.RESUME_MAX_TEXT_CHARS), chars, scanned: chars < env.RESUME_MIN_TEXT_CHARS };
}
