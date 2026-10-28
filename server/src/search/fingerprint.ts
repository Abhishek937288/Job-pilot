import { createHash } from "node:crypto";
import type { RemoteType } from "@jobpilot/shared";
import { locationKey } from "./location.js";
import { normalizeCompany, normalizeTitle } from "./normalize.js";

export interface FingerprintInput {
  company: string;
  title: string;
  location: string | null;
  remoteType: RemoteType;
  /** Used only when the location is unknown. */
  canonicalUrl: string;
}

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

/**
 * Hash of normalized company + title + location, so the same posting found under different
 * URLs collides. When the location is unknown the fingerprint is scoped to the URL instead:
 * merging on company + title alone would wrongly collapse the same role in two cities.
 */
export function jobFingerprint(j: FingerprintInput): string {
  const loc = locationKey(j.location, j.remoteType);
  const company = normalizeCompany(j.company);
  const title = normalizeTitle(j.title);
  if (loc === null) return sha256(`url\n${j.canonicalUrl}`);
  return sha256(`v1\n${company}\n${title}\n${loc}`);
}
