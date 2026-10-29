import type { AtsType } from "@jobpilot/shared";
import type { RequestOptions } from "../../lib/http.js";
import type { NormalizedJob } from "../../jobs/types.js";

export interface AtsBoard {
  /** Company name if the API returns one. */
  companyName: string | null;
  jobs: NormalizedJob[];
}

export interface AtsAdapter {
  readonly type: Exclude<AtsType, "jsonld">;
  /** The board token from a board URL like https://jobs.lever.co/acme, or null. */
  parseBoardUrl(url: URL): string | null;
  boardUrl(token: string): string;
  /** All open jobs on the board. `companyName` is used when the API doesn't return one. */
  fetchBoard(token: string, companyName: string, opts?: RequestOptions): Promise<AtsBoard>;
}
