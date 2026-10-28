import { loginRequestSchema } from "@jobpilot/shared";
import { Router, type CookieOptions } from "express";
import { env, isProduction } from "../config/env.js";
import { HttpError } from "../lib/http-error.js";
import { logger } from "../lib/logger.js";
import { SlidingWindowLimiter } from "../lib/rate-limiter.js";
import { isAuthenticated } from "../middleware/auth.js";
import { createSessionToken, passwordMatches, SESSION_COOKIE } from "../services/session.service.js";

const ttlMs = env.SESSION_TTL_HOURS * 3_600_000;

const cookieOptions: CookieOptions = {
  httpOnly: true,
  sameSite: "lax",
  secure: isProduction,
  path: "/",
};

// Counts failed attempts per IP; a successful login clears the counter.
export const loginLimiter = new SlidingWindowLimiter(env.LOGIN_MAX_ATTEMPTS, env.LOGIN_WINDOW_MINUTES * 60_000);
setInterval(() => loginLimiter.sweep(), 60_000).unref();

export const authRouter = Router();

authRouter.post("/login", (req, res) => {
  // Normalize IPv4-mapped IPv6 ("::ffff:1.2.3.4") so one client maps to one limiter key.
  const ip = (req.ip ?? "unknown").replace(/^::ffff:/, "");
  const retryAfter = loginLimiter.retryAfterMs(ip);
  if (retryAfter > 0) {
    res.setHeader("Retry-After", Math.ceil(retryAfter / 1000).toString());
    throw new HttpError(429, "TOO_MANY_ATTEMPTS", "Too many login attempts. Try again later.");
  }

  const { password } = loginRequestSchema.parse(req.body);
  if (!passwordMatches(password, env.APP_PASSWORD, env.SESSION_SECRET)) {
    loginLimiter.hit(ip);
    logger.warn({ ip }, "failed login");
    throw new HttpError(401, "INVALID_PASSWORD", "Incorrect password");
  }

  loginLimiter.reset(ip);
  res.cookie(SESSION_COOKIE, createSessionToken(env.SESSION_SECRET, ttlMs), { ...cookieOptions, maxAge: ttlMs });
  res.json({ authenticated: true });
});

authRouter.post("/logout", (_req, res) => {
  res.clearCookie(SESSION_COOKIE, cookieOptions);
  res.json({ authenticated: false });
});

authRouter.get("/me", (req, res) => {
  if (!isAuthenticated(req.headers.cookie)) throw new HttpError(401, "UNAUTHENTICATED", "Login required");
  res.json({ authenticated: true });
});
