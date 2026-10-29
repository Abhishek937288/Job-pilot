import type { ExperienceItem } from "@jobpilot/shared";

/** Months since year 0 for "YYYY-MM" / "YYYY", or null. "present" is `now`. */
function toMonth(value: string | null, now: Date): number | null {
  if (!value) return null;
  if (value.toLowerCase() === "present") return now.getUTCFullYear() * 12 + now.getUTCMonth();
  const m = /^(\d{4})(?:-(\d{1,2}))?$/.exec(value.trim());
  if (!m) return null;
  const year = Number(m[1]);
  const month = m[2] ? Math.min(Math.max(Number(m[2]), 1), 12) - 1 : 0;
  if (year < 1950 || year > now.getUTCFullYear() + 1) return null;
  return year * 12 + month;
}

/**
 * Years of experience, computed in code from the dates (never by the LLM). Overlapping roles are merged
 * so two parallel jobs don't count twice; roles without a start date are ignored; a missing end date
 * counts as one month.
 */
export function yearsOfExperience(items: ExperienceItem[], now = new Date()): number {
  const nowMonth = now.getUTCFullYear() * 12 + now.getUTCMonth();
  const intervals: [number, number][] = [];
  for (const it of items) {
    const start = toMonth(it.start, now);
    if (start == null) continue;
    let end = toMonth(it.end, now) ?? start;
    end = Math.min(end, nowMonth);
    if (end < start) continue;
    intervals.push([start, end + 1]); // end month is inclusive
  }
  intervals.sort((a, b) => a[0] - b[0]);
  let total = 0;
  let cur: [number, number] | null = null;
  for (const iv of intervals) {
    if (cur && iv[0] <= cur[1]) cur[1] = Math.max(cur[1], iv[1]);
    else {
      if (cur) total += cur[1] - cur[0];
      cur = [...iv];
    }
  }
  if (cur) total += cur[1] - cur[0];
  return Math.round((total / 12) * 10) / 10;
}
