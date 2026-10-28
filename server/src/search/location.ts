import type { LocationMatch, RemoteType } from "@jobpilot/shared";
import { basicNormalize } from "./normalize.js";

const CITY_ALIASES: Record<string, string> = {
  bombay: "mumbai",
  "greater mumbai": "mumbai",
  "mumbai metropolitan region": "mumbai",
  bengaluru: "bangalore",
  "bangalore urban": "bangalore",
  gurugram: "gurgaon",
  "new delhi": "delhi",
  "delhi ncr": "delhi",
  ncr: "delhi",
  madras: "chennai",
  calcutta: "kolkata",
  "new bombay": "navi mumbai",
  thane: "thane",
};

/** Words that describe a region/country/workplace rather than a city. */
const NON_CITY = new Set([
  "india",
  "in",
  "maharashtra",
  "karnataka",
  "telangana",
  "tamil nadu",
  "haryana",
  "uttar pradesh",
  "west bengal",
  "gujarat",
  "kerala",
  "apac",
  "asia",
  "office",
  "hq",
  "onsite",
  "on site",
  "hybrid",
  "in office",
  "usa",
  "us",
  "united states",
  "uk",
  "united kingdom",
  "european union",
  "eu",
  "emea",
  "americas",
  "global",
  "worldwide",
]);

const REMOTE_RE = /\b(remote|work from home|wfh|anywhere|distributed)\b/i;

export function isRemoteText(s: string | null | undefined): boolean {
  return !!s && REMOTE_RE.test(s);
}

/** Placeholder values ATS boards use for "no location" (seen live: "N/A", "na"). */
const PLACEHOLDER_RE = /^\s*(n\/?a|na|none|tbd|tba|various|multiple( locations)?|flexible|unknown|-+)\s*$/i;

/** Canonical city key, e.g. "Bengaluru, Karnataka" -> "bangalore". */
export function cityKey(part: string): string | null {
  const n = basicNormalize(part.replace(/\(.*?\)/g, " "));
  if (n.length < 2 || NON_CITY.has(n) || REMOTE_RE.test(n)) return null;
  return CITY_ALIASES[n] ?? n;
}

/**
 * Split a location string into city keys. Separators: , / ; | • " - " and " or ".
 * State/country/workplace words are dropped, so "Mumbai, Maharashtra, India" -> ["mumbai"] while
 * Greenhouse-style "Seattle, San Francisco, New York City" -> three cities.
 */
export function locationCityKeys(location: string | null | undefined): string[] {
  if (!location || PLACEHOLDER_RE.test(location)) return [];
  const keys = new Set<string>();
  for (const piece of location.split(/\s*(?:[,/;|•]|\s[-–]\s|\bor\b)\s*/i)) {
    const k = cityKey(piece);
    if (k) keys.add(k);
  }
  return [...keys].sort();
}

/** Stable location component for fingerprints, or null when nothing is known. */
export function locationKey(location: string | null | undefined, remoteType: RemoteType): string | null {
  const cities = locationCityKeys(location);
  const remote = remoteType === "REMOTE" || isRemoteText(location);
  if (cities.length === 0 && !remote) return null;
  return [...(remote ? ["remote"] : []), ...cities].join("|");
}

/** Whole-word containment, so "navi mumbai" matches "mumbai" but "a" matches nothing. */
function cityMatches(a: string, b: string): boolean {
  const wa = ` ${a} `;
  const wb = ` ${b} `;
  return wa.includes(wb) || wb.includes(wa);
}

/** Remote roles restricted to somewhere else ("US-Remote", "Remote in Canada", "Remote - EU"). */
const FOREIGN_REGION_RE =
  /\b(us|usa|united states|canada|uk|united kingdom|eu|europe|european union|emea|americas|latam|north america|south america|germany|france|spain|italy|netherlands|ireland|poland|portugal|australia|singapore|japan|brazil|mexico)\b/i;
const HOME_REGION_RE = /\b(india|apac|asia|anywhere|worldwide|global)\b/i;

function remoteIsForeignOnly(locations: (string | null | undefined)[]): boolean {
  const text = locations.filter(Boolean).join(" | ");
  return FOREIGN_REGION_RE.test(text) && !HOME_REGION_RE.test(text);
}

/**
 * Compare a job's locations with my preferred locations. Never used to drop jobs, only to flag them.
 * Remote jobs are REMOTE (unless they also list a preferred city, which is a MATCH) — except remote
 * roles limited to another country/region, which are MISMATCH since I can't take them from India.
 */
export function matchLocation(
  jobLocations: (string | null | undefined)[],
  remoteType: RemoteType,
  preferredLocations: string[],
): LocationMatch {
  const preferred = preferredLocations.flatMap((p) => locationCityKeys(p));
  const cities = [...new Set(jobLocations.flatMap((l) => locationCityKeys(l)))];
  const remote = remoteType === "REMOTE" || jobLocations.some((l) => isRemoteText(l));

  if (cities.some((c) => preferred.some((p) => cityMatches(c, p)))) return "MATCH";
  if (remote) return remoteIsForeignOnly(jobLocations) ? "MISMATCH" : "REMOTE";
  // Country/region only ("US", "EMEA"): another country is a mismatch; "India" alone stays unknown.
  if (cities.length === 0) return remoteIsForeignOnly(jobLocations) ? "MISMATCH" : "UNKNOWN";
  return "MISMATCH";
}

const SERPER_LOCATIONS: Record<string, string> = {
  mumbai: "Mumbai, Maharashtra, India",
  "navi mumbai": "Navi Mumbai, Maharashtra, India",
  thane: "Thane, Maharashtra, India",
  pune: "Pune, Maharashtra, India",
  bangalore: "Bengaluru, Karnataka, India",
  hyderabad: "Hyderabad, Telangana, India",
  chennai: "Chennai, Tamil Nadu, India",
  delhi: "New Delhi, Delhi, India",
  gurgaon: "Gurugram, Haryana, India",
  noida: "Noida, Uttar Pradesh, India",
  kolkata: "Kolkata, West Bengal, India",
  ahmedabad: "Ahmedabad, Gujarat, India",
};

/** Map a preferred location to a Google/Serper location name; null for "Remote" or unknown cities. */
export function toSerperLocation(preferred: string): string | null {
  if (isRemoteText(preferred)) return null;
  const key = locationCityKeys(preferred)[0];
  if (!key) return null;
  return SERPER_LOCATIONS[key] ?? (preferred.includes(",") ? preferred.trim() : `${preferred.trim()}, India`);
}
