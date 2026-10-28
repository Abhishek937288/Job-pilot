import type { RequestHandler } from "express";
import { env } from "../config/env.js";
import { HttpError } from "../lib/http-error.js";
import { readCookie, SESSION_COOKIE, verifySessionToken } from "../services/session.service.js";

export function isAuthenticated(cookieHeader: string | undefined): boolean {
  const token = readCookie(cookieHeader, SESSION_COOKIE);
  return token !== undefined && verifySessionToken(token, env.SESSION_SECRET);
}

export const requireSession: RequestHandler = (req, _res, next) => {
  if (!isAuthenticated(req.headers.cookie)) {
    next(new HttpError(401, "UNAUTHENTICATED", "Login required"));
    return;
  }
  next();
};
