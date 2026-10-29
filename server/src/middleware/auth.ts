import type { NextFunction, Request, Response } from "express";
import { isValidObjectId } from "mongoose";
import { User, type UserDoc } from "../db/models/user.js";
import { HttpError } from "../lib/errors.js";
import { SESSION_COOKIE, verifySessionToken } from "../auth/session.js";

declare module "express-serve-static-core" {
  interface Request {
    /** Set from the verified session cookie. The only source of identity for every route. */
    user?: UserDoc;
  }
}

/** Loads the user from the session cookie when there is a valid one. Never fails the request. */
export async function loadSession(req: Request, _res: Response, next: NextFunction): Promise<void> {
  const token = req.cookies?.[SESSION_COOKIE] as string | undefined;
  const claims = token ? verifySessionToken(token) : null;
  if (claims && isValidObjectId(claims.sub)) {
    const user = await User.findById(claims.sub);
    // tokenVersion invalidates old sessions; expired guests may linger until the TTL monitor runs.
    if (user && user.tokenVersion === claims.tv && !(user.expiresAt && user.expiresAt.getTime() < Date.now())) req.user = user;
  }
  next();
}

export function requireUser(req: Request, _res: Response, next: NextFunction): void {
  if (!req.user) throw new HttpError(401, "Sign in or continue as a guest");
  next();
}

/** For actions that change shared data (the company watchlist). */
export function requireAccount(req: Request, _res: Response, next: NextFunction): void {
  if (!req.user) throw new HttpError(401, "Sign in first");
  if (req.user.isGuest) throw new HttpError(403, "Create an account to do this");
  next();
}

/** The authenticated user; use only behind requireUser. */
export function currentUser(req: Request): UserDoc {
  if (!req.user) throw new HttpError(401, "Sign in or continue as a guest");
  return req.user;
}
