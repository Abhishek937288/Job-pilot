import { describe, expect, it } from "vitest";
import { escapeCell, escapeRow } from "../../src/export/escape.js";
import { parseRobots } from "../../src/lib/robots.js";

describe("export formula escaping", () => {
  it.each(["=HYPERLINK(\"x\")", "+1", "-2+3", "@SUM(A1)", "\tcmd", "\rcmd"])("prefixes %j with a quote", (v) => {
    expect(escapeCell(v)).toBe(`'${v}`);
  });

  it("leaves safe strings and non-strings alone", () => {
    expect(escapeCell("Backend Engineer")).toBe("Backend Engineer");
    expect(escapeCell(-5)).toBe(-5);
    expect(escapeRow({ a: "=1", b: 2, c: null })).toEqual({ a: "'=1", b: 2, c: null });
  });
});

describe("robots.txt", () => {
  const txt = `
User-agent: *
Disallow: /private
Allow: /private/jobs
Disallow: /*.pdf$

User-agent: JobPilotBot
Disallow: /nope
`;

  it("uses the generic group with longest-match precedence", () => {
    const r = parseRobots(txt, "SomeOtherBot/1.0");
    expect(r.isAllowed("/careers")).toBe(true);
    expect(r.isAllowed("/private/x")).toBe(false);
    expect(r.isAllowed("/private/jobs/1")).toBe(true);
    expect(r.isAllowed("/files/a.pdf")).toBe(false);
    expect(r.isAllowed("/files/a.pdf?x=1")).toBe(true);
  });

  it("uses the specific group for our user agent", () => {
    const r = parseRobots(txt, "JobPilotBot/0.1 (+x)");
    expect(r.isAllowed("/nope/a")).toBe(false);
    expect(r.isAllowed("/private/x")).toBe(true);
  });

  it("treats an empty Disallow as allow-all", () => {
    expect(parseRobots("User-agent: *\nDisallow:\n", "x").isAllowed("/anything")).toBe(true);
  });
});
