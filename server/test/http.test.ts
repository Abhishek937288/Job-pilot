import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { loginLimiter } from "../src/routes/auth.routes.js";

// These paths never reach the database: auth, and uploads rejected before persistence.
let server: Server;
let base: string;

beforeAll(async () => {
  server = createApp().listen(0);
  await new Promise<void>((r) => server.once("listening", () => r()));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));
beforeEach(() => loginLimiter.reset("127.0.0.1"));

function login(password: string): Promise<Response> {
  return fetch(`${base}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ password }),
  });
}

async function sessionCookie(): Promise<string> {
  const res = await login("test-password-123");
  const cookie = res.headers.get("set-cookie");
  if (!cookie) throw new Error("no cookie");
  return cookie.split(";")[0] ?? "";
}

describe("auth", () => {
  it("rejects protected routes without a session", async () => {
    expect((await fetch(`${base}/api/profile`)).status).toBe(401);
    expect((await fetch(`${base}/api/auth/me`)).status).toBe(401);
  });

  it("sets an httpOnly, non-secure (dev/test) cookie on success", async () => {
    const res = await login("test-password-123");
    expect(res.status).toBe(200);
    const cookie = res.headers.get("set-cookie") ?? "";
    expect(cookie).toMatch(/jp_session=/);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).not.toMatch(/Secure/i);
    const me = await fetch(`${base}/api/auth/me`, { headers: { cookie: cookie.split(";")[0] ?? "" } });
    expect(me.status).toBe(200);
  });

  it("rate limits after 5 failed attempts per IP", async () => {
    for (let i = 0; i < 5; i++) expect((await login("wrong-password")).status).toBe(401);
    const blocked = await login("test-password-123");
    expect(blocked.status).toBe(429);
    expect(Number(blocked.headers.get("retry-after"))).toBeGreaterThan(0);
  });

  it("uses X-Forwarded-For from the loopback proxy as the client IP", async () => {
    for (let i = 0; i < 5; i++) {
      await fetch(`${base}/api/auth/login`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-forwarded-for": "203.0.113.9" },
        body: JSON.stringify({ password: "nope-nope" }),
      });
    }
    expect(loginLimiter.retryAfterMs("203.0.113.9")).toBeGreaterThan(0);
    expect((await login("test-password-123")).status).toBe(200); // 127.0.0.1 unaffected
    loginLimiter.reset("203.0.113.9");
  });
});

describe("resume upload validation", () => {
  async function upload(bytes: Buffer, name: string, type: string): Promise<Response> {
    const form = new FormData();
    form.append("file", new Blob([new Uint8Array(bytes)], { type }), name);
    return fetch(`${base}/api/resumes`, { method: "POST", body: form, headers: { cookie: await sessionCookie() } });
  }

  it("rejects a non-PDF file that claims to be a PDF (magic bytes)", async () => {
    const res = await upload(Buffer.from("<html>hello</html>"), "resume.pdf", "application/pdf");
    expect(res.status).toBe(415);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("UNSUPPORTED_FILE");
  });

  it("rejects files over 5 MB", async () => {
    const big = Buffer.concat([Buffer.from("%PDF-1.4\n"), Buffer.alloc(5 * 1024 * 1024 + 1)]);
    const res = await upload(big, "big.pdf", "application/pdf");
    expect(res.status).toBe(413);
  });
});
