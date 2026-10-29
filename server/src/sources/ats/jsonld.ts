import * as cheerio from "cheerio";
import type { SalaryDto } from "@jobpilot/shared";
import { fetchPage, type RequestOptions } from "../../lib/http.js";
import { logger } from "../../lib/logger.js";
import { htmlToText } from "../../lib/text.js";
import { buildJob } from "../../jobs/build.js";
import type { NormalizedJob } from "../../jobs/types.js";

type Json = Record<string, unknown>;
const isObj = (v: unknown): v is Json => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : typeof v === "number" ? String(v) : null);
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : v == null ? [] : [v]);

function isJobPosting(o: Json): boolean {
  return arr(o["@type"]).some((t) => t === "JobPosting");
}

/** Every JobPosting object in a JSON-LD value, including inside @graph and ItemList. */
function collectPostings(value: unknown, out: Json[] = []): Json[] {
  for (const item of arr(value)) {
    if (!isObj(item)) continue;
    if (isJobPosting(item)) out.push(item);
    if (item["@graph"]) collectPostings(item["@graph"], out);
    if (item.itemListElement) collectPostings(arr(item.itemListElement).map((e) => (isObj(e) && e.item ? e.item : e)), out);
  }
  return out;
}

export function extractJobPostings(html: string): Json[] {
  const $ = cheerio.load(html);
  const out: Json[] = [];
  $('script[type="application/ld+json"]').each((_, el) => {
    const raw = $(el).text().trim();
    if (!raw) return;
    try {
      collectPostings(JSON.parse(raw), out);
    } catch {
      // Malformed JSON-LD is common; skip the block.
    }
  });
  return out;
}

const UNIT: Record<string, SalaryDto["period"]> = { HOUR: "hour", DAY: "day", WEEK: "week", MONTH: "month", YEAR: "year" };

function salaryOf(p: Json): SalaryDto | null {
  const base = p.baseSalary;
  if (!isObj(base)) return null;
  const value = isObj(base.value) ? base.value : null;
  const min = Number(value?.minValue ?? value?.value ?? (typeof base.value === "number" ? base.value : NaN));
  const max = Number(value?.maxValue ?? value?.value ?? NaN);
  if (!Number.isFinite(min) && !Number.isFinite(max)) return null;
  return {
    min: Number.isFinite(min) ? min : null,
    max: Number.isFinite(max) ? max : null,
    currency: str(base.currency),
    period: UNIT[String(value?.unitText ?? base.unitText ?? "").toUpperCase()] ?? null,
  };
}

/** One JSON-LD JobPosting as a normalized job, or null when it's unusable or expired. */
export function jobFromPosting(p: Json, pageUrl: string, fallbackCompany: string, now = new Date()): NormalizedJob | null {
  const title = str(p.title);
  if (!title) return null;
  const validThrough = str(p.validThrough);
  if (validThrough && new Date(validThrough).getTime() < now.getTime()) return null;

  const org = arr(p.hiringOrganization).find(isObj);
  const place = arr(p.jobLocation).find(isObj);
  const address = place && isObj(place.address) ? place.address : null;
  const country = address ? (isObj(address.addressCountry) ? str(address.addressCountry.name) : str(address.addressCountry)) : null;
  const city = address ? str(address.addressLocality) : null;
  const region = address ? str(address.addressRegion) : null;
  const remote = arr(p.jobLocationType).some((t) => String(t).toUpperCase() === "TELECOMMUTE") ? "remote" : place ? "onsite" : "unknown";
  const url = str(p.url) ?? pageUrl;
  const identifier = isObj(p.identifier) ? str(p.identifier.value) : str(p.identifier);

  return buildJob({
    source: "jsonld",
    sourceJobId: identifier ? `${new URL(url, pageUrl).host}:${identifier}` : null,
    title,
    company: (org ? str(org.name) : null) ?? fallbackCompany,
    location: [city, region, country].filter(Boolean).join(", ") || null,
    city,
    region,
    country,
    remote,
    salary: salaryOf(p),
    applyLinks: [{ url: new URL(url, pageUrl).toString(), source: "careers page", isDirect: true }],
    postedAt: str(p.datePosted) ? new Date(str(p.datePosted)!) : null,
    description: htmlToText(str(p.description)),
    employmentType: arr(p.employmentType).map(String).join(", ") || null,
  });
}

const JOB_LINK_RE = /\/(jobs?|careers?|positions?|openings?|vacanc(y|ies)|roles?)\/[^/?#]+/i;
const MAX_DETAIL_PAGES = 25;

/**
 * Reads JobPosting markup from a careers page. When the listing page has none, follows same-site links that
 * look like job pages (up to MAX_DETAIL_PAGES). Every fetch honours robots.txt and the per-host rate limit.
 */
export async function fetchJsonLdJobs(careerUrl: string, companyName: string, opts: RequestOptions = {}): Promise<NormalizedJob[]> {
  const page = await fetchPage(careerUrl, opts);
  const direct = extractJobPostings(page.html)
    .map((p) => jobFromPosting(p, page.finalUrl, companyName))
    .filter((j): j is NormalizedJob => j !== null);
  if (direct.length > 0) return direct;

  const base = new URL(page.finalUrl);
  const $ = cheerio.load(page.html);
  const links = new Set<string>();
  $("a[href]").each((_, a) => {
    try {
      const u = new URL($(a).attr("href")!, base);
      u.hash = "";
      if (u.host === base.host && JOB_LINK_RE.test(u.pathname) && u.toString() !== base.toString()) links.add(u.toString());
    } catch {
      // ignore bad hrefs
    }
  });

  const jobs: NormalizedJob[] = [];
  for (const link of [...links].slice(0, MAX_DETAIL_PAGES)) {
    try {
      const detail = await fetchPage(link, opts);
      for (const p of extractJobPostings(detail.html)) {
        const job = jobFromPosting(p, detail.finalUrl, companyName);
        if (job) jobs.push(job);
      }
    } catch (err) {
      logger.debug({ err: (err as Error).message, link }, "job page fetch failed");
    }
  }
  return jobs;
}
