import type { AtsProvider } from "@jobpilot/shared";
import { ashbyAdapter } from "./ashby.js";
import { greenhouseAdapter } from "./greenhouse.js";
import { leverAdapter } from "./lever.js";
import type { AtsAdapter } from "./types.js";

export type AtsAdapters = Record<AtsProvider, AtsAdapter>;

/** To add an ATS: implement AtsAdapter in its own module and register it here. */
export const atsAdapters: AtsAdapters = {
  GREENHOUSE: greenhouseAdapter,
  LEVER: leverAdapter,
  ASHBY: ashbyAdapter,
};

/** Accepts a board URL (any provider) or a bare slug plus explicit provider. */
export function parseBoardInput(input: string, provider: AtsProvider | null): { provider: AtsProvider; slug: string } | null {
  const trimmed = input.trim();
  const asUrl = /^https?:\/\//i.test(trimmed) ? trimmed : /\.(greenhouse\.io|lever\.co|ashbyhq\.com)\//i.test(trimmed) ? `https://${trimmed}` : null;
  if (asUrl) {
    let url: URL;
    try {
      url = new URL(asUrl);
    } catch {
      return null;
    }
    for (const adapter of Object.values(atsAdapters)) {
      const slug = adapter.parseBoardUrl(url);
      if (slug && (!provider || provider === adapter.provider)) return { provider: adapter.provider, slug };
    }
    return null;
  }
  if (!provider || !/^[A-Za-z0-9._-]{1,100}$/.test(trimmed)) return null;
  return { provider, slug: trimmed.toLowerCase() };
}

export type { AtsAdapter, AtsBoard, AtsJob } from "./types.js";
