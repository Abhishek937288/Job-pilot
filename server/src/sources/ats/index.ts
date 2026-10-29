import type { AtsType } from "@jobpilot/shared";
import { ashbyAdapter } from "./ashby.js";
import { greenhouseAdapter } from "./greenhouse.js";
import { leverAdapter } from "./lever.js";
import { smartRecruitersAdapter } from "./smartrecruiters.js";
import type { AtsAdapter } from "./types.js";
import { workableAdapter } from "./workable.js";

export const ATS_ADAPTERS: AtsAdapter[] = [greenhouseAdapter, leverAdapter, ashbyAdapter, workableAdapter, smartRecruitersAdapter];

export function adapterFor(type: AtsType): AtsAdapter | null {
  return ATS_ADAPTERS.find((a) => a.type === type) ?? null;
}

/** ATS type and board token from a board or posting URL, or null for any other site. */
export function detectAts(rawUrl: string): { atsType: Exclude<AtsType, "jsonld">; atsToken: string } | null {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }
  for (const a of ATS_ADAPTERS) {
    const token = a.parseBoardUrl(url);
    if (token) return { atsType: a.type, atsToken: token };
  }
  return null;
}
