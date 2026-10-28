import type { AtsProvider, RemoteType } from "@jobpilot/shared";
import type { GetJsonOptions } from "../../lib/http.js";
import type { AtsJobRef } from "../url-canonical.js";

/** A job as returned by a public ATS API, normalized across providers. */
export interface AtsJob {
  provider: AtsProvider;
  slug: string;
  jobId: string;
  title: string;
  /** Company name if the API returns one (Greenhouse does; Lever and Ashby don't). */
  companyName: string | null;
  /** Primary location string as the ATS shows it. */
  location: string | null;
  /** Every location listed, including the primary one. */
  allLocations: string[];
  remoteType: RemoteType;
  canonicalUrl: string;
  applyUrl: string;
  postedAt: Date | null;
  descriptionText: string | null;
  /** Small, provider-specific extras kept for later phases (no descriptions). */
  raw: Record<string, unknown>;
}

export interface AtsBoard {
  companyName: string | null;
  jobs: AtsJob[];
}

export interface AtsAdapter {
  readonly provider: AtsProvider;
  /** Extract the board slug from a board URL like https://jobs.lever.co/acme, or null. */
  parseBoardUrl(url: URL): string | null;
  fetchBoard(slug: string, opts?: GetJsonOptions): Promise<AtsBoard>;
  /** One posting by id; null when the posting (or board) no longer exists. */
  fetchJob(ref: AtsJobRef, opts?: GetJsonOptions): Promise<AtsJob | null>;
}
