import { env } from "../config/env.js";
import { ALLOW_ALL, DISALLOW_ALL, parseRobots, type RobotsRules } from "./robots.js";

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

export class RobotsDisallowedError extends Error {
  constructor(
    readonly url: string,
    readonly unreachable = false,
  ) {
    super(unreachable ? `site unreachable (robots.txt could not be fetched) for ${url}` : `robots.txt disallows ${url}`);
    this.name = "RobotsDisallowedError";
  }
}

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Spaces out requests per host with a minimum gap between them (polite API and page use). */
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

export interface RequestOptions {
  fetchImpl?: FetchLike;
  throttle?: HostThrottle;
  timeoutMs?: number;
  /** Retries for network errors, 429 and 5xx. Default 1. */
  retries?: number;
  retryDelayMs?: number;
  headers?: Record<string, string>;
}

function retryable(err: unknown): boolean {
  if (err instanceof HttpStatusError) return err.status === 429 || err.status >= 500;
  return !(err instanceof SyntaxError); // network error or timeout
}

async function requestText(url: string, init: RequestInit, opts: RequestOptions): Promise<{ res: Response; text: string }> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const throttle = opts.throttle ?? defaultThrottle;
  const retries = opts.retries ?? 1;
  for (let attempt = 0; ; attempt++) {
    try {
      await throttle.wait(url);
      const res = await fetchImpl(url, {
        ...init,
        headers: { "user-agent": env.HTTP_USER_AGENT, ...(init.headers as Record<string, string>), ...opts.headers },
        signal: AbortSignal.timeout(opts.timeoutMs ?? 20_000),
      });
      const text = await res.text();
      if (!res.ok) throw new HttpStatusError(res.status, url, text);
      return { res, text };
    } catch (err) {
      if (attempt >= retries || !retryable(err)) throw err;
      await sleep((opts.retryDelayMs ?? 1000) * 2 ** attempt);
    }
  }
}

/** GET a JSON document. Throws HttpStatusError on non-2xx (404 included; callers decide). */
export async function getJson<T = unknown>(url: string, opts: RequestOptions = {}): Promise<T> {
  const { text } = await requestText(url, { method: "GET", headers: { accept: "application/json" } }, opts);
  return JSON.parse(text) as T;
}

export async function postJson<T = unknown>(url: string, body: unknown, opts: RequestOptions = {}): Promise<T> {
  const { text } = await requestText(
    url,
    { method: "POST", headers: { accept: "application/json", "content-type": "application/json" }, body: JSON.stringify(body) },
    opts,
  );
  return JSON.parse(text) as T;
}

// ------------------------------------------------------------------ pages (robots.txt aware)

const ROBOTS_TTL_MS = 6 * 60 * 60_000;
const robotsCache = new Map<string, { at: number; rules: RobotsRules; unreachable: boolean }>();

async function robotsFor(origin: string, opts: RequestOptions): Promise<{ rules: RobotsRules; unreachable: boolean }> {
  const hit = robotsCache.get(origin);
  if (hit && Date.now() - hit.at < ROBOTS_TTL_MS) return hit;
  let rules: RobotsRules;
  let unreachable = false;
  try {
    const { text } = await requestText(`${origin}/robots.txt`, { method: "GET" }, { ...opts, retries: 0, timeoutMs: 10_000 });
    rules = parseRobots(text, env.HTTP_USER_AGENT);
  } catch (err) {
    // RFC 9309: 4xx means no restrictions; an unreachable robots.txt means assume full disallow.
    unreachable = !(err instanceof HttpStatusError && err.status >= 400 && err.status < 500);
    rules = unreachable ? DISALLOW_ALL : ALLOW_ALL;
  }
  const entry = { at: Date.now(), rules, unreachable };
  robotsCache.set(origin, entry);
  return entry;
}

export function clearRobotsCache(): void {
  robotsCache.clear();
}

export interface FetchedPage {
  url: string;
  finalUrl: string;
  status: number;
  contentType: string;
  html: string;
}

/**
 * GET an HTML page for a direct fetch (career pages, web-search verification). Checks robots.txt for
 * every URL in the redirect chain and rate-limits per host. Throws on non-2xx.
 */
export async function fetchPage(url: string, opts: RequestOptions = {}): Promise<FetchedPage> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  let current = url;
  for (let hop = 0; hop < 5; hop++) {
    const u = new URL(current);
    if (u.protocol !== "https:" && u.protocol !== "http:") throw new Error(`unsupported protocol: ${u.protocol}`);
    const robots = await robotsFor(u.origin, opts);
    if (!robots.rules.isAllowed(u.pathname + u.search)) throw new RobotsDisallowedError(current, robots.unreachable);

    const { res, text } = await requestText(
      current,
      { method: "GET", redirect: "manual", headers: { accept: "text/html,application/xhtml+xml" } },
      { ...opts, fetchImpl: async (input, init) => {
        const r = await fetchImpl(input, init);
        // Let redirects through requestText's ok-check by handling them here.
        return r.status >= 300 && r.status < 400 ? new Response("", { status: 200, headers: { "x-redirect": r.headers.get("location") ?? "" } }) : r;
      } },
    );
    const redirect = res.headers.get("x-redirect");
    if (redirect) {
      current = new URL(redirect, current).toString();
      continue;
    }
    return { url, finalUrl: current, status: res.status, contentType: res.headers.get("content-type") ?? "", html: text };
  }
  throw new Error(`too many redirects for ${url}`);
}
