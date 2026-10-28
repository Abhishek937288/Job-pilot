import { describe, expect, it, vi } from "vitest";
import type { FetchLike } from "../src/lib/http.js";
import { SearchProviderError } from "../src/search/provider.js";
import { SerperProvider } from "../src/search/serper.provider.js";

function respond(status: number, body: unknown): Response {
  return new Response(typeof body === "string" ? body : JSON.stringify(body), { status });
}

const ok = { organic: [{ title: "A", link: "https://jobs.lever.co/a/1", snippet: "s", position: 1 }], credits: 1 };

// vi.fn() mocks are loosely typed; the cast keeps test bodies free of generics.
function provider(fetchImpl: unknown) {
  return new SerperProvider({ apiKey: "k", gl: "in", fetchImpl: fetchImpl as FetchLike, retryDelayMs: 0 });
}

describe("SerperProvider", () => {
  it("sends gl, location, one page of 10 and the API key", async () => {
    const fetchImpl = vi.fn(async () => respond(200, ok));
    const res = await provider(fetchImpl).search({ q: "backend developer", location: "Mumbai, Maharashtra, India" });
    expect(res).toMatchObject({ requests: 1, credits: 1 });
    expect(res.hits[0]).toMatchObject({ url: "https://jobs.lever.co/a/1", title: "A" });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://google.serper.dev/search");
    expect((init.headers as Record<string, string>)["X-API-KEY"]).toBe("k");
    expect(JSON.parse(init.body as string)).toEqual({ q: "backend developer", gl: "in", location: "Mumbai, Maharashtra, India", num: 10, page: 1 });
  });

  it("omits location when null", async () => {
    const fetchImpl = vi.fn(async () => respond(200, ok));
    await provider(fetchImpl).search({ q: "x remote", location: null });
    const [, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(init.body as string)).not.toHaveProperty("location");
  });

  it("retries a 5xx exactly once", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(respond(503, "busy")).mockResolvedValueOnce(respond(200, ok));
    const res = await provider(fetchImpl).search({ q: "x", location: null });
    expect(res.requests).toBe(2);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("never retries more than once", async () => {
    const fetchImpl = vi.fn(async () => respond(500, "down"));
    const err = await provider(fetchImpl).search({ q: "x", location: null }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SearchProviderError);
    expect((err as SearchProviderError).requests).toBe(2);
    expect((err as SearchProviderError).fatal).toBe(false);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("retries a network error once", async () => {
    const fetchImpl = vi.fn().mockRejectedValueOnce(new Error("ECONNRESET")).mockResolvedValueOnce(respond(200, ok));
    expect((await provider(fetchImpl).search({ q: "x", location: null })).requests).toBe(2);
  });

  it("does not retry a 400 (e.g. bad location)", async () => {
    const fetchImpl = vi.fn(async () => respond(400, { message: "Invalid location" }));
    const err = (await provider(fetchImpl).search({ q: "x", location: "Nowhere" }).catch((e: unknown) => e)) as SearchProviderError;
    expect(err.requests).toBe(1);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("treats a rejected key as fatal and does not retry", async () => {
    const fetchImpl = vi.fn(async () => respond(403, { message: "Unauthorized" }));
    const err = (await provider(fetchImpl).search({ q: "x", location: null }).catch((e: unknown) => e)) as SearchProviderError;
    expect(err.fatal).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("defaults credits to 1 when the response omits it", async () => {
    const fetchImpl = vi.fn(async () => respond(200, { organic: [] }));
    expect((await provider(fetchImpl).search({ q: "x", location: null })).credits).toBe(1);
  });
});
