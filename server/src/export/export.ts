import type { Response } from "express";
import ExcelJS from "exceljs";
import { StreamParser } from "@json2csv/plainjs";
import type { ExportFormat, JobMatchDto } from "@jobpilot/shared";
import { jobMatchDto } from "../db/dto.js";
import type { JobMatchDoc } from "../db/models/jobMatch.js";
import { escapeRow } from "./escape.js";

export const EXPORT_COLUMNS = [
  "score", "verdict", "status", "title", "company", "location", "remote", "salary", "postedAt", "applyUrl",
  "otherLinks", "matchedSkills", "missingSkills", "reason", "redFlags", "sources", "firstSeenAt", "closed",
] as const;
type Row = Record<(typeof EXPORT_COLUMNS)[number], string | number | null>;

function salaryText(j: JobMatchDto["job"]): string | null {
  const s = j.salary;
  if (!s || (s.min == null && s.max == null)) return null;
  const range = s.min != null && s.max != null && s.min !== s.max ? `${s.min}-${s.max}` : String(s.max ?? s.min);
  return `${range} ${s.currency ?? ""}${s.period ? ` / ${s.period}` : ""}`.trim();
}

export function toRow(d: JobMatchDto): Row {
  return {
    score: d.match?.score ?? null,
    verdict: d.match?.verdict ?? null,
    status: d.status,
    title: d.job.title,
    company: d.job.company,
    location: d.job.location,
    remote: d.job.remote,
    salary: salaryText(d.job),
    postedAt: d.job.postedAt?.slice(0, 10) ?? null,
    applyUrl: d.job.applyLinks[0]?.url ?? null,
    otherLinks: d.job.applyLinks.slice(1).map((l) => l.url).join(" "),
    matchedSkills: d.match?.matchedSkills.join(", ") ?? null,
    missingSkills: d.match?.missingSkills.join(", ") ?? null,
    reason: d.match?.reason ?? null,
    redFlags: d.match?.redFlags.join("; ") ?? null,
    sources: d.job.sources.join(", "),
    firstSeenAt: d.firstSeenAt.slice(0, 10),
    closed: d.job.closedAt ? "yes" : "",
  };
}

const CONTENT_TYPE: Record<ExportFormat, string> = {
  csv: "text/csv; charset=utf-8",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  json: "application/json; charset=utf-8",
};

/**
 * Streams the export straight from the database cursor. Nothing is written to disk or stored.
 * CSV and XLSX cells are formula-escaped; JSON is data, not a spreadsheet, and is left as is.
 */
export async function streamExport(res: Response, format: ExportFormat, filename: string, cursor: AsyncIterable<JobMatchDoc>): Promise<void> {
  res.setHeader("Content-Type", CONTENT_TYPE[format]);
  res.setHeader("Content-Disposition", `attachment; filename="${filename}.${format}"`);
  res.setHeader("Cache-Control", "no-store");

  if (format === "json") {
    res.write("[");
    let first = true;
    for await (const doc of cursor) {
      res.write(`${first ? "" : ","}\n${JSON.stringify(jobMatchDto(doc))}`);
      first = false;
    }
    res.end("\n]\n");
    return;
  }

  if (format === "csv") {
    const parser = new StreamParser<Row, Row>({ fields: [...EXPORT_COLUMNS] }, { objectMode: true });
    const done = new Promise<void>((resolve, reject) => {
      parser.onData = (chunk) => res.write(chunk);
      parser.onError = reject;
      parser.onEnd = () => resolve();
    });
    res.write("﻿"); // BOM so Excel reads UTF-8
    parser.pushHeaderIfNotWritten();
    for await (const doc of cursor) parser.write(escapeRow(toRow(jobMatchDto(doc))));
    parser.end();
    await done;
    res.end();
    return;
  }

  const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({ stream: res, useStyles: false, useSharedStrings: false });
  const sheet = workbook.addWorksheet("Jobs");
  sheet.columns = EXPORT_COLUMNS.map((key) => ({ header: key, key, width: key === "reason" ? 60 : 18 }));
  for await (const doc of cursor) sheet.addRow(escapeRow(toRow(jobMatchDto(doc)))).commit();
  sheet.commit();
  await workbook.commit();
}
