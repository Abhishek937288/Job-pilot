import { randomBytes } from "node:crypto";
import { Router } from "express";
import { z } from "zod";
import { credentialsSchema, registerSchema, type AuthConfigDto } from "@jobpilot/shared";
import { env, googleEnabled, googleRedirectUri } from "../config/env.js";
import { User } from "../db/models/user.js";
import { HttpError } from "../lib/errors.js";
import { logger } from "../lib/logger.js";
import { hashPassword, verifyPassword } from "../auth/password.js";
import { clearSessionCookie, setSessionCookie } from "../auth/session.js";
import { currentUser, requireUser } from "../middleware/auth.js";
import { parseOr400 } from "../middleware/errors.js";
import { guestLimiter, loginLimiter } from "../middleware/security.js";
import { createGuest, deleteAccount, mergeGuestInto, upgradeGuest, userDto } from "../services/accounts.js";

export const authRouter = Router();

authRouter.get("/config", (_req, res) => {
  res.json({ googleEnabled, guestEnabled: env.GUEST_ENABLED } satisfies AuthConfigDto);
});

authRouter.get("/me", requireUser, async (req, res) => {
  res.json(await userDto(currentUser(req)));
});

authRouter.post("/guest", guestLimiter, async (req, res) => {
  if (!env.GUEST_ENABLED) throw new HttpError(403, "Guest mode is disabled");
  if (req.user) {
    res.json(await userDto(req.user)); // already signed in (guest or account)
    return;
  }
  const guest = await createGuest();
  setSessionCookie(res, guest);
  res.status(201).json(await userDto(guest));
});

const isDuplicate = (err: unknown) => (err as { code?: number })?.code === 11000;

authRouter.post("/register", loginLimiter, async (req, res) => {
  const body = parseOr400(registerSchema, req.body);
  if (req.user && !req.user.isGuest) throw new HttpError(409, "You are already signed in");
  if (await User.exists({ email: body.email })) throw new HttpError(409, "An account with this email already exists");
  const passwordHash = await hashPassword(body.password);
  try {
    const user = req.user?.isGuest
      ? await upgradeGuest(req.user, { email: body.email, passwordHash, name: body.name })
      : await User.create({ email: body.email, passwordHash, name: body.name, isGuest: false });
    setSessionCookie(res, user);
    res.status(201).json(await userDto(user));
  } catch (err) {
    if (isDuplicate(err)) throw new HttpError(409, "An account with this email already exists");
    throw err;
  }
});

authRouter.post("/login", loginLimiter, async (req, res) => {
  const body = parseOr400(credentialsSchema, req.body);
  const user = await User.findOne({ email: body.email, isGuest: false });
  if (!(await verifyPassword(body.password, user?.passwordHash)) || !user) throw new HttpError(401, "Invalid email or password");
  if (req.user?.isGuest) await mergeGuestInto(req.user, user);
  setSessionCookie(res, user);
  res.json(await userDto(user));
});

authRouter.post("/logout", (_req, res) => {
  clearSessionCookie(res);
  res.status(204).end();
});

authRouter.delete("/account", requireUser, async (req, res) => {
  const user = currentUser(req);
  await deleteAccount(user);
  logger.info({ userId: String(user._id) }, "account deleted");
  clearSessionCookie(res);
  res.status(204).end();
});

// ------------------------------------------------------------------ Google OAuth (authorization code flow)

const STATE_COOKIE = "jp_oauth_state";
const stateCookieOpts = { httpOnly: true, secure: env.NODE_ENV === "production", sameSite: "lax" as const, path: "/", maxAge: 10 * 60_000 };

authRouter.get("/google", (_req, res) => {
  if (!googleEnabled) throw new HttpError(404, "Google sign-in is not configured");
  const state = randomBytes(24).toString("base64url");
  res.cookie(STATE_COOKIE, state, stateCookieOpts);
  const params = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID!,
    redirect_uri: googleRedirectUri,
    response_type: "code",
    scope: "openid email profile",
    state,
    prompt: "select_account",
  });
  res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`);
});

const tokenResponse = z.object({ access_token: z.string() });
const userInfo = z.object({ sub: z.string(), email: z.string().nullish(), email_verified: z.boolean().nullish(), name: z.string().nullish() });

authRouter.get("/google/callback", async (req, res) => {
  const fail = () => res.redirect(`${env.WEB_ORIGIN}/login?error=google`);
  const expected = req.cookies?.[STATE_COOKIE] as string | undefined;
  res.clearCookie(STATE_COOKIE, { ...stateCookieOpts, maxAge: undefined });
  const code = typeof req.query.code === "string" ? req.query.code : null;
  if (!googleEnabled || !code || !expected || req.query.state !== expected) return fail();

  try {
    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ code, client_id: env.GOOGLE_CLIENT_ID!, client_secret: env.GOOGLE_CLIENT_SECRET!, redirect_uri: googleRedirectUri, grant_type: "authorization_code" }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!tokenRes.ok) return fail();
    const { access_token } = tokenResponse.parse(await tokenRes.json());
    const infoRes = await fetch("https://openidconnect.googleapis.com/v1/userinfo", { headers: { authorization: `Bearer ${access_token}` }, signal: AbortSignal.timeout(15_000) });
    if (!infoRes.ok) return fail();
    const info = userInfo.parse(await infoRes.json());
    const email = info.email_verified && info.email ? info.email.toLowerCase() : null;

    let user = await User.findOne({ googleId: info.sub });
    if (!user && email) {
      // Link to an existing password account with the same verified email.
      user = await User.findOne({ email, isGuest: false });
      if (user) {
        user.googleId = info.sub;
        await user.save();
      }
    }
    if (!user) {
      user = req.user?.isGuest
        ? await upgradeGuest(req.user, { googleId: info.sub, email: email ?? undefined, name: info.name ?? null })
        : await User.create({ googleId: info.sub, email, name: info.name ?? null, isGuest: false });
    } else if (req.user?.isGuest) {
      await mergeGuestInto(req.user, user);
    }
    setSessionCookie(res, user);
    res.redirect(`${env.WEB_ORIGIN}/profiles`);
  } catch (err) {
    logger.warn({ err }, "google sign-in failed");
    fail();
  }
});
