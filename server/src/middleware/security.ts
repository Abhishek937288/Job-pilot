import type { NextFunction, Request, Response } from "express";
import { ipKeyGenerator, rateLimit } from "express-rate-limit";
import { env } from "../config/env.js";
import { HttpError } from "../lib/errors.js";

const SAFE = new Set(["GET", "HEAD", "OPTIONS"]);
const allowedOrigins = new Set([new URL(env.WEB_ORIGIN).origin]);

/**
 * CSRF defence on top of SameSite=Lax cookies: a state-changing request that carries an Origin header must
 * come from the web app. (Requests without Origin, e.g. curl, carry no ambient browser cookies.)
 */
export function originCheck(req: Request, _res: Response, next: NextFunction): void {
  const origin = req.headers.origin;
  if (!SAFE.has(req.method) && origin && !allowedOrigins.has(origin)) throw new HttpError(403, "Cross-origin request blocked");
  next();
}

const message = (msg: string) => ({ error: msg });

/** Per IP, for everything. */
export const ipLimiter = rateLimit({
  windowMs: 60_000,
  limit: env.RATE_LIMIT_PER_MINUTE * 2,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: message("Too many requests, slow down"),
});

/** Per user (not only per IP) on authenticated routes. */
export const userLimiter = rateLimit({
  windowMs: 60_000,
  limit: env.RATE_LIMIT_PER_MINUTE,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  keyGenerator: (req) => (req.user ? `u:${String(req.user._id)}` : `ip:${ipKeyGenerator(req.ip ?? "")}`),
  message: message("Too many requests, slow down"),
});

/** Uploads and searches cost money: a tighter per-user burst limit on top of the daily quota. */
export const expensiveLimiter = rateLimit({
  windowMs: 60_000,
  limit: 6,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  keyGenerator: (req) => (req.user ? `u:${String(req.user._id)}` : `ip:${ipKeyGenerator(req.ip ?? "")}`),
  message: message("Too many uploads or searches in a short time, wait a minute"),
});

/** Failed logins and sign-ups per IP. */
export const loginLimiter = rateLimit({
  windowMs: env.LOGIN_WINDOW_MINUTES * 60_000,
  limit: env.LOGIN_MAX_ATTEMPTS,
  skipSuccessfulRequests: true,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: message("Too many attempts. Try again later."),
});

/** Guest sessions create database rows: limit how fast one IP can make them. */
export const guestLimiter = rateLimit({
  windowMs: 60 * 60_000,
  limit: 20,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: message("Too many guest sessions from this address"),
});
