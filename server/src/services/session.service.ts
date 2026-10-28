import { createHmac, timingSafeEqual } from "node:crypto";

export const SESSION_COOKIE = "jp_session";

interface SessionPayload {
  /** Issued-at, epoch ms */
  iat: number;
  /** Expiry, epoch ms */
  exp: number;
}

function sign(data: string, secret: string): string {
  return createHmac("sha256", secret).update(data).digest("base64url");
}

/** Stateless session token: base64url(payload).base64url(hmac). Single user, so no store needed. */
export function createSessionToken(secret: string, ttlMs: number, now = Date.now()): string {
  const payload: SessionPayload = { iat: now, exp: now + ttlMs };
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${body}.${sign(body, secret)}`;
}

export function verifySessionToken(token: string, secret: string, now = Date.now()): boolean {
  const [body, mac, ...rest] = token.split(".");
  if (!body || !mac || rest.length > 0) return false;

  const expected = Buffer.from(sign(body, secret));
  const actual = Buffer.from(mac);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return false;

  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as Partial<SessionPayload>;
    return typeof payload.exp === "number" && payload.exp > now;
  } catch {
    return false;
  }
}

/** Constant-time password comparison (hash both sides so lengths match). */
export function passwordMatches(candidate: string, expected: string, secret: string): boolean {
  const a = createHmac("sha256", secret).update(candidate).digest();
  const b = createHmac("sha256", secret).update(expected).digest();
  return timingSafeEqual(a, b);
}

export function readCookie(header: string | undefined, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    if (part.slice(0, idx).trim() === name) {
      try {
        return decodeURIComponent(part.slice(idx + 1).trim());
      } catch {
        return undefined;
      }
    }
  }
  return undefined;
}
