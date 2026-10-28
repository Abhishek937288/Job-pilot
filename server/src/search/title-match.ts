import { normalizeTitle } from "./normalize.js";

const ROLE_WORDS = new Set(["developer", "engineer", "sde", "swe", "programmer", "architect"]);
const GENERIC = new Set([
  ...ROLE_WORDS,
  "senior",
  "junior",
  "lead",
  "staff",
  "principal",
  "associate",
  "intern",
  "trainee",
  "i",
  "ii",
  "iii",
  "iv",
  "1",
  "2",
  "3",
  "the",
  "and",
  "of",
  "for",
  "a",
  "an",
  "role",
  "position",
]);

/**
 * Relevance gate for whole-board ATS results (a board can list hundreds of unrelated roles).
 * A job title matches when it contains a role word (developer/engineer/...) and shares at
 * least one significant word with one of my target titles, e.g. "Software Engineer, Backend"
 * matches "Backend Developer". Search-engine hits are not filtered: their queries were targeted.
 */
export function titleMatchesTargets(jobTitle: string, targetTitles: string[]): boolean {
  const tokens = new Set(normalizeTitle(jobTitle).split(" "));
  if (![...tokens].some((t) => ROLE_WORDS.has(t))) return false;

  return targetTitles.some((target) => {
    const significant = normalizeTitle(target)
      .split(" ")
      .filter((t) => t && !GENERIC.has(t));
    return significant.length === 0 || significant.some((t) => tokens.has(t));
  });
}
