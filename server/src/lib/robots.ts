/**
 * Minimal robots.txt support (RFC 9309): groups by user-agent, Allow/Disallow with `*` and `$`,
 * longest match wins and Allow wins ties.
 */
export interface RobotsRules {
  isAllowed(path: string): boolean;
}

interface Rule {
  allow: boolean;
  pattern: string;
  regex: RegExp;
}

function toRegex(pattern: string): RegExp {
  const anchored = pattern.endsWith("$");
  const body = (anchored ? pattern.slice(0, -1) : pattern)
    .split("*")
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
    .join(".*");
  return new RegExp(`^${body}${anchored ? "$" : ""}`);
}

export function parseRobots(txt: string, userAgent: string): RobotsRules {
  const ua = userAgent.toLowerCase();
  const groups: { agents: string[]; rules: Rule[] }[] = [];
  let current: { agents: string[]; rules: Rule[] } | null = null;
  let lastWasAgent = false;

  for (const raw of txt.split(/\r?\n/)) {
    const line = raw.replace(/#.*/, "").trim();
    const m = /^([A-Za-z-]+)\s*:\s*(.*)$/.exec(line);
    if (!m) continue;
    const key = m[1]!.toLowerCase();
    const value = m[2]!.trim();
    if (key === "user-agent") {
      if (!current || !lastWasAgent) {
        current = { agents: [], rules: [] };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
      continue;
    }
    lastWasAgent = false;
    if (!current || (key !== "allow" && key !== "disallow")) continue;
    if (key === "disallow" && value === "") continue; // "Disallow:" allows everything
    current.rules.push({ allow: key === "allow", pattern: value, regex: toRegex(value) });
  }

  const specific = groups.filter((g) => g.agents.some((a) => a !== "*" && ua.includes(a)));
  const chosen = specific.length ? specific : groups.filter((g) => g.agents.includes("*"));
  const rules = chosen.flatMap((g) => g.rules);

  return {
    isAllowed(path: string) {
      let best: Rule | null = null;
      for (const r of rules) {
        if (!r.regex.test(path)) continue;
        if (!best || r.pattern.length > best.pattern.length || (r.pattern.length === best.pattern.length && r.allow)) best = r;
      }
      return best ? best.allow : true;
    },
  };
}

export const ALLOW_ALL: RobotsRules = { isAllowed: () => true };
export const DISALLOW_ALL: RobotsRules = { isAllowed: () => false };
