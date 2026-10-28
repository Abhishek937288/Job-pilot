import { describe, expect, it } from "vitest";
import { detectResumeKind, extractResumeText, meaningfulCharCount, normalizeResumeText } from "../src/services/resume-file.js";
import { fakeDocxHeader, makePdf, RESUME_LINES } from "./fixtures.js";

describe("detectResumeKind (magic bytes)", () => {
  it("detects PDF and DOCX from content", () => {
    expect(detectResumeKind(makePdf(["hi"]))).toBe("pdf");
    expect(detectResumeKind(fakeDocxHeader())).toBe("docx");
  });

  it("rejects other files regardless of what they claim to be", () => {
    expect(detectResumeKind(Buffer.from("<html>not a pdf</html>"))).toBeNull();
    expect(detectResumeKind(Buffer.from([0x89, 0x50, 0x4e, 0x47]))).toBeNull(); // PNG
    // A ZIP that is not a Word document (e.g. .xlsx or a plain archive)
    const zip = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.from("xl/workbook.xml")]);
    expect(detectResumeKind(zip)).toBeNull();
    expect(detectResumeKind(Buffer.alloc(0))).toBeNull();
  });
});

describe("extractResumeText", () => {
  it("extracts text from a text-based PDF", async () => {
    const text = await extractResumeText(makePdf(RESUME_LINES), "pdf");
    expect(text).toContain("Kubernetes");
    expect(meaningfulCharCount(text)).toBeGreaterThan(200);
  });

  it("returns (near) nothing for an image-only/blank PDF", async () => {
    const text = await extractResumeText(makePdf([]), "pdf");
    expect(meaningfulCharCount(text)).toBeLessThan(200);
  });
});

describe("normalizeResumeText", () => {
  it("strips page markers and collapses whitespace", () => {
    expect(normalizeResumeText("a\t\tb  \r\n\n\n\n-- 1 of 2 --\nc")).toBe("a b\n\nc");
  });
});
