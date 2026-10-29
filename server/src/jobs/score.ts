import type { MatchScores } from "@jobpilot/shared";

export const WEIGHTS = { skills: 0.5, seniority: 0.2, location: 0.2, salary: 0.1 } as const;

/**
 * The final score, always computed in code: 0.5 skills + 0.2 seniority + 0.2 location + 0.1 salary.
 * When salary is unknown its weight is dropped and the others are rescaled to sum to 1.
 */
export function finalScore(s: MatchScores): number {
  let total = WEIGHTS.skills * s.skills + WEIGHTS.seniority * s.seniority + WEIGHTS.location * s.location;
  let weight = WEIGHTS.skills + WEIGHTS.seniority + WEIGHTS.location;
  if (s.salary != null) {
    total += WEIGHTS.salary * s.salary;
    weight += WEIGHTS.salary;
  }
  return Math.round(total / weight);
}
