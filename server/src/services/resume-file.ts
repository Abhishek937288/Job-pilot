import mammoth from "mammoth";
import { PDFParse } from "pdf-parse";

export type ResumeKind = "pdf" | "docx";

export const MIME_BY_KIND: Record<ResumeKind, string> = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
};

const PDF_MAGIC = Buffer.from("%PDF-");
const ZIP_MAGIC = Buffer.from([0x50, 0x4b, 0x03, 0x04]);

/**
 * Identify the file from its bytes, ignoring the client-supplied mime type and extension.
 * DOCX is a ZIP whose entry names are stored uncompressed, so a real .docx must contain
 * both "[Content_Types].xml" and "word/document.xml" in its headers.
 */
export function detectResumeKind(buf: Buffer): ResumeKind | null {
  if (buf.subarray(0, PDF_MAGIC.length).equals(PDF_MAGIC)) return "pdf";
  if (buf.subarray(0, ZIP_MAGIC.length).equals(ZIP_MAGIC)) {
    if (buf.includes("[Content_Types].xml") && buf.includes("word/document.xml")) return "docx";
  }
  return null;
}

/** Collapse whitespace noise and drop pdf-parse page separators ("-- 1 of 2 --"). */
export function normalizeResumeText(raw: string): string {
  return raw
    .replace(/\r\n?/g, "\n")
    .replace(/^\s*--\s*\d+\s+of\s+\d+\s*--\s*$/gm, "")
    .replace(/[\t\f\v ]+/g, " ")
    .replace(/ +\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function meaningfulCharCount(text: string): number {
  return text.replace(/\s/g, "").length;
}

export async function extractResumeText(buf: Buffer, kind: ResumeKind): Promise<string> {
  if (kind === "pdf") {
    const parser = new PDFParse({ data: new Uint8Array(buf) });
    try {
      const result = await parser.getText();
      return normalizeResumeText(result.text);
    } finally {
      await parser.destroy();
    }
  }
  const result = await mammoth.extractRawText({ buffer: buf });
  return normalizeResumeText(result.value);
}
