import type { Types } from "mongoose";
import type { AtsType, CreateCompanyInput } from "@jobpilot/shared";
import { CachedJob } from "../db/models/cachedJob.js";
import { Company, type CompanyDoc } from "../db/models/company.js";
import { JobMatch } from "../db/models/jobMatch.js";
import { HttpError } from "../lib/errors.js";
import { logger } from "../lib/logger.js";
import { adapterFor, detectAts } from "../sources/ats/index.js";
import { fetchJsonLdJobs } from "../sources/ats/jsonld.js";
import type { NormalizedJob } from "../jobs/types.js";

function nameFromUrl(url: string, token: string | null): string {
  if (token) return token.replace(/[-_]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  const host = new URL(url).hostname.replace(/^(www|careers|jobs)\./, "");
  const base = host.split(".")[0] ?? host;
  return base.charAt(0).toUpperCase() + base.slice(1);
}

function isDuplicateKey(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { code?: number }).code === 11000;
}

/** Resolves ATS type/token from the input (explicit values win over detection from the URL). */
export function resolveCompanyInput(input: CreateCompanyInput): { atsType: AtsType; atsToken: string | null; careerUrl: string; name: string } {
  const detected = detectAts(input.careerUrl);
  const atsType = input.atsType ?? detected?.atsType ?? "jsonld";
  const atsToken = atsType === "jsonld" ? null : (input.atsToken ?? (detected?.atsType === atsType ? detected.atsToken : null));
  if (atsType !== "jsonld" && !atsToken) throw new HttpError(400, `Could not find the ${atsType} board token in the URL; pass atsToken`);
  const adapter = atsType === "jsonld" ? null : adapterFor(atsType);
  const careerUrl = adapter && atsToken ? adapter.boardUrl(atsToken) : new URL(input.careerUrl).toString();
  return { atsType, atsToken, careerUrl, name: input.name ?? nameFromUrl(input.careerUrl, atsToken) };
}

export async function createCompany(input: CreateCompanyInput, addedBy: Types.ObjectId): Promise<CompanyDoc> {
  const resolved = resolveCompanyInput(input);
  try {
    return await Company.create({ ...resolved, discoveredBy: "user", addedBy });
  } catch (err) {
    if (isDuplicateKey(err)) throw new HttpError(409, "This company is already on the watchlist");
    throw err;
  }
}

/** Adds boards found by web search. Existing entries are left alone. Returns the new ones. */
export async function addDiscoveredCompanies(found: { atsType: Exclude<AtsType, "jsonld">; atsToken: string; company: string | null }[]): Promise<CompanyDoc[]> {
  const created: CompanyDoc[] = [];
  for (const f of found) {
    const adapter = adapterFor(f.atsType);
    if (!adapter) continue;
    const exists = await Company.exists({ atsType: f.atsType, atsToken: f.atsToken });
    if (exists) continue;
    try {
      created.push(
        await Company.create({
          name: f.company ?? nameFromUrl(adapter.boardUrl(f.atsToken), f.atsToken),
          careerUrl: adapter.boardUrl(f.atsToken),
          atsType: f.atsType,
          atsToken: f.atsToken,
          discoveredBy: "web_search",
          addedBy: null,
        }),
      );
    } catch (err) {
      if (!isDuplicateKey(err)) throw err; // raced with another run
    }
  }
  return created;
}

async function fetchCompanyJobs(c: CompanyDoc): Promise<{ jobs: NormalizedJob[]; companyName: string | null }> {
  if (c.atsType === "jsonld") return { jobs: await fetchJsonLdJobs(c.careerUrl, c.name), companyName: null };
  const adapter = adapterFor(c.atsType as AtsType);
  if (!adapter || !c.atsToken) throw new Error(`no adapter for ${c.atsType}`);
  return adapter.fetchBoard(c.atsToken, c.name);
}

export interface RefreshResult {
  open: number;
  added: number;
  closed: number;
}

/**
 * Reads the company's board into the shared CachedJob collection. Jobs missing from the board since the
 * last refresh are marked closed, both in the cache and on every user's matching JobMatch row.
 */
export async function refreshCompany(companyId: Types.ObjectId | string): Promise<RefreshResult | null> {
  const company = await Company.findById(companyId);
  if (!company) return null;
  const now = new Date();
  try {
    const { jobs, companyName } = await fetchCompanyJobs(company);
    if (companyName && company.discoveredBy === "web_search" && company.name !== companyName) company.name = companyName;

    const unique = new Map(jobs.map((j) => [j.jobKey, j]));
    const ops = [...unique.values()].map((j) => ({
      updateOne: {
        filter: { jobKey: j.jobKey },
        update: {
          $set: {
            companyId: company._id,
            source: j.source,
            sourceJobId: j.sourceJobId,
            title: j.title,
            company: j.company,
            location: j.location,
            city: j.city,
            region: j.region,
            country: j.country,
            remote: j.remote,
            salary: j.salary,
            applyUrl: j.applyLinks[0]?.url ?? company.careerUrl,
            postedAt: j.postedAt,
            description: j.description,
            employmentType: j.employmentType,
            requiredExperienceMonths: j.requiredExperienceMonths,
            lastSeenAt: now,
            closedAt: null,
          },
          $setOnInsert: { firstSeenAt: now },
        },
        upsert: true,
      },
    }));
    const res = ops.length ? await CachedJob.bulkWrite(ops, { ordered: false }) : null;

    const goneKeys = (await CachedJob.find({ companyId: company._id, closedAt: null, lastSeenAt: { $lt: now } }, { jobKey: 1 })).map((d) => d.jobKey);
    if (goneKeys.length) {
      await CachedJob.updateMany({ jobKey: { $in: goneKeys } }, { $set: { closedAt: now } });
      await JobMatch.updateMany({ jobKey: { $in: goneKeys }, "job.closedAt": null }, { $set: { "job.closedAt": now } });
    }
    // A job that reappears is open again.
    if (unique.size) await JobMatch.updateMany({ jobKey: { $in: [...unique.keys()] }, "job.closedAt": { $ne: null } }, { $set: { "job.closedAt": null } });

    company.lastCheckedAt = now;
    company.lastError = null;
    company.openJobs = unique.size;
    await company.save();
    const result = { open: unique.size, added: res?.upsertedCount ?? 0, closed: goneKeys.length };
    logger.info({ company: company.name, atsType: company.atsType, ...result }, "watchlist company refreshed");
    return result;
  } catch (err) {
    company.lastCheckedAt = now;
    company.lastError = (err as Error).message.slice(0, 300);
    await company.save();
    throw err;
  }
}

export async function deleteCompany(company: CompanyDoc): Promise<void> {
  await CachedJob.deleteMany({ companyId: company._id });
  await company.deleteOne();
}
