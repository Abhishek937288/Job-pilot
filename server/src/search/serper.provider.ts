import type { SearchQuery } from "@jobpilot/shared";
import { z } from "zod";
import type { FetchLike } from "../lib/http.js";
import { SearchProviderError, type SearchPageResult, type SearchProvider } from "./provider.js";

const ENDPOINT = "https://google.serper.dev/search";

const serperResponse = z.object({
  organic: z
    .array(
      z.object({
        title: z.string().nullish(),
        link: z.string(),
        snippet: z.string().nullish(),
        date: z.string().nullish(),
        position: z.number().nullish(),
      }),
    )
    .nullish(),
  credits: z.number().nullish(),
});

export interface SerperOptions {
  apiKey: string;
  gl: string;
  fetchImpl?: FetchLike;
  retryDelayMs?: number;
  timeoutMs?: number;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Serper.dev Google search: always 1 page of 10 results, gl fixed, at most one retry. */
export class SerperProvider implements SearchProvider {
  readonly name = "serper";
  constructor(private readonly opts: SerperOptions) {}

  async search(query: SearchQuery): Promise<SearchPageResult> {
    const body = {
      q: query.q,
      gl: this.opts.gl,
      ...(query.location ? { location: query.location } : {}),
      num: 10,
      page: 1,
    };
    const fetchImpl = this.opts.fetchImpl ?? fetch;
    let requests = 0;
    let lastError = "unknown error";

    for (let attempt = 0; attempt < 2; attempt++) {
      if (attempt > 0) await sleep(this.opts.retryDelayMs ?? 1500);
      requests++;
      let res: Response;
      try {
        res = await fetchImpl(ENDPOINT, {
          method: "POST",
          headers: { "X-API-KEY": this.opts.apiKey, "content-type": "application/json" },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(this.opts.timeoutMs ?? 20_000),
        });
      } catch (err) {
        lastError = `network error: ${err instanceof Error ? err.message : String(err)}`;
        continue; // the single retry
      }

      const text = await res.text();
      if (res.status === 401 || res.status === 403) {
        throw new SearchProviderError(`Serper rejected the API key (HTTP ${res.status}): ${text.slice(0, 150)}`, requests, true);
      }
      if (res.status === 429 || res.status >= 500) {
        lastError = `HTTP ${res.status}: ${text.slice(0, 150)}`;
        continue;
      }
      if (!res.ok) {
        // e.g. 400 for an unknown location; retrying the same request won't help.
        throw new SearchProviderError(`Serper HTTP ${res.status}: ${text.slice(0, 200)}`, requests, false);
      }

      const parsed = serperResponse.safeParse(JSON.parse(text));
      if (!parsed.success) throw new SearchProviderError("Unexpected Serper response shape", requests, false);
      return {
        requests,
        credits: parsed.data.credits ?? 1,
        hits: (parsed.data.organic ?? []).map((o, i) => ({
          title: o.title?.trim() ?? "",
          url: o.link,
          snippet: o.snippet?.trim() || null,
          date: o.date ?? null,
          position: o.position ?? i + 1,
        })),
      };
    }
    throw new SearchProviderError(`Serper failed after one retry: ${lastError}`, requests, false);
  }
}
