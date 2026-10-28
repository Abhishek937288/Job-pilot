import type { SearchQuery } from "@jobpilot/shared";

export interface SearchHit {
  title: string;
  url: string;
  snippet: string | null;
  /** Relative or absolute date string if the engine shows one ("3 days ago"). */
  date: string | null;
  position: number;
}

export interface SearchPageResult {
  hits: SearchHit[];
  /** HTTP requests sent (1, or 2 when the single retry was used). */
  requests: number;
  /** Credits the provider says it charged. */
  credits: number;
}

export class SearchProviderError extends Error {
  constructor(
    message: string,
    /** Requests already sent (and possibly billed) before failing. */
    readonly requests: number,
    /** True when retrying other queries is pointless (bad key, no credits). */
    readonly fatal: boolean,
  ) {
    super(message);
    this.name = "SearchProviderError";
  }
}

/**
 * One page of web results per call. Implementations must not paginate or retry more than once.
 * To add a provider (Brave, Tavily, …): implement this and select it in search/index.ts.
 */
export interface SearchProvider {
  readonly name: string;
  search(query: SearchQuery): Promise<SearchPageResult>;
}
