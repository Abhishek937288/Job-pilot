import type { Response } from "express";
import jwt from "jsonwebtoken";
import { env } from "../config/env.js";
import type { UserDoc } from "../db/models/user.js";

export const SESSION_COOKIE = "jp_session";

interface SessionClaims {
  sub: string;
  tv: number;
}

/** Signs a session JWT and sets it as an httpOnly cookie. */
export function setSessionCookie(res: Response, user: UserDoc): void {
  const ttlMs = user.isGuest && user.expiresAt ? Math.max(user.expiresAt.getTime() - Date.now(), 60_000) : env.SESSION_TTL_DAYS * 86_400_000;
  const token = jwt.sign({ tv: user.tokenVersion } satisfies Omit<SessionClaims, "sub">, env.SESSION_SECRET, {
    subject: String(user._id),
    expiresIn: Math.floor(ttlMs / 1000),
    algorithm: "HS256",
  });
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: ttlMs,
  });
}

export function clearSessionCookie(res: Response): void {
  res.clearCookie(SESSION_COOKIE, { httpOnly: true, secure: env.NODE_ENV === "production", sameSite: "lax", path: "/" });
}

export function verifySessionToken(token: string): SessionClaims | null {
  try {
    const claims = jwt.verify(token, env.SESSION_SECRET, { algorithms: ["HS256"] }) as jwt.JwtPayload;
    if (typeof claims.sub !== "string" || typeof claims.tv !== "number") return null;
    return { sub: claims.sub, tv: claims.tv };
  } catch {
    return null;
  }
}
