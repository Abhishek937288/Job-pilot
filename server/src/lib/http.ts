import { env } from "../config/env.js";

export class HttpStatusError extends Error {
  constructor(
    readonly status: number,
    readonly url: string,
    readonly bodySnippet: string,
  ) {
    super(`HTTP ${status} from ${new URL(url).host}: ${bodySnippet.slice(0, 120)}`);
    this.name = "HttpStatusError";
  }
}

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Serializes requests per host with a minimum gap between them (polite scraping/API use). */
export class HostThrottle {
  private readonly nextSlot = new Map<string, number>();
  constructor(private readonly minIntervalMs: number) {}

  async wait(url: string): Promise<void> {
    const host = new URL(url).host;
    const now = Date.now();
    const slot = Math.max(now, this.nextSlot.get(host) ?? 0);
    this.nextSlot.set(host, slot + this.minIntervalMs);
    if (slot > now) await sleep(slot - now);
  }
}

export const defaultThrottle = new HostThrottle(env.HTTP_MIN_INTERVAL_MS);

export interface GetJsonOptions {
  fetchImpl?: FetchLike;
  throttle?: HostThrottle;
  timeoutMs?: number;
  /** Retries for network errors, 429 and 5xx. Default 1. */
  retries?: number;
  retryDelayMs?: number;
}

function retryable(err: unknown): boolean {
  if (err instanceof HttpStatusError) return err.status === 429 || err.status >= 500;
  return true; // network error / timeout
}

/** GET a JSON document. Throws HttpStatusError on non-2xx (404 included, callers decide). */
export async function getJson<T = unknown>(url: string, opts: GetJsonOptions = {}): Promise<T> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const throttle = opts.throttle ?? defaultThrottle;
  const retries = opts.retries ?? 1;

  for (let attempt = 0; ; attempt++) {
    try {
      await throttle.wait(url);
      const res = await fetchImpl(url, {
        headers: { accept: "application/json", "user-agent": "JobPilot/0.1 (personal job search assistant)" },
        signal: AbortSignal.timeout(opts.timeoutMs ?? 20_000),
      });
      const text = await res.text();
      if (!res.ok) throw new HttpStatusError(res.status, url, text);
      return JSON.parse(text) as T;
    } catch (err) {
      if (attempt >= retries || !retryable(err)) throw err;
      await sleep((opts.retryDelayMs ?? 1000) * 2 ** attempt);
    }
  }
}
