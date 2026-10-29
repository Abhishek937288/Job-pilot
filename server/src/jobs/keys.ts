import type { JobSourceName } from "@jobpilot/shared";
import { sha1 } from "../lib/hash.js";
import { normalizeCompany, normalizeText } from "../lib/text.js";

/** SHA-1 of the normalized title|company|city. Identifies the same job across sources. */
export function fingerprintOf(title: string, company: string, city: string | null): string {
  return sha1(`${normalizeText(title)}|${normalizeCompany(company)}|${normalizeText(city)}`);
}

/** The source job id when there is one (namespaced by source), otherwise the fingerprint. */
export function jobKeyOf(source: JobSourceName, sourceJobId: string | null, title: string, company: string, city: string | null): string {
  return sourceJobId ? `${source}:${sourceJobId}` : `fp:${fingerprintOf(title, company, city)}`;
}
