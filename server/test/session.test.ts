import { describe, expect, it } from "vitest";
import { createSessionToken, passwordMatches, readCookie, verifySessionToken } from "../src/services/session.service.js";

const SECRET = "x".repeat(40);

describe("session tokens", () => {
  it("verifies a fresh token", () => {
    expect(verifySessionToken(createSessionToken(SECRET, 60_000), SECRET)).toBe(true);
  });

  it("rejects expired tokens", () => {
    const token = createSessionToken(SECRET, 1_000, 0);
    expect(verifySessionToken(token, SECRET, 5_000)).toBe(false);
  });

  it("rejects a token signed with another secret", () => {
    expect(verifySessionToken(createSessionToken("y".repeat(40), 60_000), SECRET)).toBe(false);
  });

  it("rejects a tampered payload", () => {
    const [, mac] = createSessionToken(SECRET, 60_000).split(".");
    const forged = Buffer.from(JSON.stringify({ iat: 0, exp: Date.now() + 1e9 })).toString("base64url");
    expect(verifySessionToken(`${forged}.${mac}`, SECRET)).toBe(false);
  });

  it("rejects garbage", () => {
    for (const t of ["", ".", "a.b.c", "abc", "%%%.###"]) expect(verifySessionToken(t, SECRET)).toBe(false);
  });
});

describe("passwordMatches", () => {
  it("matches only the exact password", () => {
    expect(passwordMatches("hunter22", "hunter22", SECRET)).toBe(true);
    expect(passwordMatches("hunter2", "hunter22", SECRET)).toBe(false);
    expect(passwordMatches("", "hunter22", SECRET)).toBe(false);
  });
});

describe("readCookie", () => {
  it("finds a named cookie among others", () => {
    expect(readCookie("a=1; jp_session=abc.def; b=2", "jp_session")).toBe("abc.def");
    expect(readCookie("a=1", "jp_session")).toBeUndefined();
    expect(readCookie(undefined, "jp_session")).toBeUndefined();
  });
});
