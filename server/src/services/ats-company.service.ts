import type { AtsCompanyDto, AtsProvider } from "@jobpilot/shared";
import { prisma } from "../db/prisma.js";
import type { AtsCompany } from "../generated/prisma/client.js";
import { HttpError } from "../lib/http-error.js";
import { HttpStatusError } from "../lib/http.js";
import { atsAdapters, parseBoardInput } from "../search/ats/index.js";

function toDto(c: AtsCompany): AtsCompanyDto {
  return {
    id: c.id,
    provider: c.provider,
    slug: c.slug,
    displayName: c.displayName,
    enabled: c.enabled,
    lastFetchedAt: c.lastFetchedAt?.toISOString() ?? null,
    lastJobCount: c.lastJobCount,
    lastError: c.lastError,
  };
}

export async function listAtsCompanies(): Promise<AtsCompanyDto[]> {
  return (await prisma.atsCompany.findMany({ orderBy: [{ provider: "asc" }, { slug: "asc" }] })).map(toDto);
}

/** Validates the board against the live public API before saving, so typos fail here, not mid-search. */
export async function addAtsCompany(input: string, provider: AtsProvider | null): Promise<AtsCompanyDto> {
  const parsed = parseBoardInput(input, provider);
  if (!parsed) {
    throw new HttpError(422, "BAD_BOARD", "Paste a board URL (boards.greenhouse.io/x, jobs.lever.co/x, jobs.ashbyhq.com/x) or pick a provider and enter the slug");
  }
  const existing = await prisma.atsCompany.findFirst({ where: { provider: parsed.provider, slug: { equals: parsed.slug, mode: "insensitive" } } });
  if (existing) throw new HttpError(409, "ALREADY_ADDED", `${parsed.provider} ${parsed.slug} is already in your list`);

  let board;
  try {
    board = await atsAdapters[parsed.provider].fetchBoard(parsed.slug, { retries: 0 });
  } catch (err) {
    if (err instanceof HttpStatusError && err.status === 404) {
      throw new HttpError(422, "BOARD_NOT_FOUND", `No public ${parsed.provider} board named "${parsed.slug}"`);
    }
    throw new HttpError(502, "ATS_UNAVAILABLE", `Could not reach ${parsed.provider}: ${err instanceof Error ? err.message : String(err)}`);
  }
  const row = await prisma.atsCompany.create({
    data: { provider: parsed.provider, slug: parsed.slug, displayName: board.companyName, lastFetchedAt: new Date(), lastJobCount: board.jobs.length },
  });
  return toDto(row);
}

export async function updateAtsCompany(id: string, data: { enabled?: boolean; displayName?: string | null }): Promise<AtsCompanyDto> {
  const found = await prisma.atsCompany.findUnique({ where: { id } });
  if (!found) throw new HttpError(404, "NOT_FOUND", "Company not found");
  return toDto(await prisma.atsCompany.update({ where: { id }, data }));
}

export async function deleteAtsCompany(id: string): Promise<void> {
  const { count } = await prisma.atsCompany.deleteMany({ where: { id } });
  if (count === 0) throw new HttpError(404, "NOT_FOUND", "Company not found");
}
