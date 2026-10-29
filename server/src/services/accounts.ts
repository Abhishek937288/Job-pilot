import type { Types } from "mongoose";
import type { UserDto } from "@jobpilot/shared";
import { env } from "../config/env.js";
import { JobMatch } from "../db/models/jobMatch.js";
import { Profile } from "../db/models/profile.js";
import { SearchRun } from "../db/models/searchRun.js";
import { User, type UserDoc } from "../db/models/user.js";
import { scoped } from "../db/scoped.js";
import { dailySearchLimit, searchesUsedToday } from "./quota.js";

export async function userDto(user: UserDoc): Promise<UserDto> {
  const providers: UserDto["authProviders"] = [];
  if (user.passwordHash) providers.push("password");
  if (user.googleId) providers.push("google");
  return {
    id: String(user._id),
    email: user.email ?? null,
    name: user.name ?? null,
    isGuest: user.isGuest,
    guestExpiresAt: user.isGuest && user.expiresAt ? user.expiresAt.toISOString() : null,
    authProviders: providers,
    limits: { maxProfiles: env.MAX_PROFILES_PER_USER, dailySearches: dailySearchLimit(user), searchesUsedToday: await searchesUsedToday(String(user._id)) },
  };
}

export async function createGuest(): Promise<UserDoc> {
  return User.create({ isGuest: true, expiresAt: new Date(Date.now() + env.GUEST_TTL_DAYS * 86_400_000) });
}

/** Removes the TTL from every row the user owns, so a guest's data is kept after signing up. */
async function clearExpiry(userId: Types.ObjectId): Promise<void> {
  await Promise.all([
    Profile.updateMany({ userId }, { $set: { expiresAt: null } }),
    JobMatch.updateMany({ userId }, { $set: { expiresAt: null } }),
    SearchRun.updateMany({ userId }, { $set: { expiresAt: null } }),
  ]);
}

/** Sign-up while a guest: the guest user becomes the account (same id), so its rows only lose the TTL. */
export async function upgradeGuest(guest: UserDoc, fields: { email?: string; passwordHash?: string; googleId?: string; name?: string | null }): Promise<UserDoc> {
  guest.set({ ...fields, isGuest: false, expiresAt: null });
  await guest.save();
  await clearExpiry(guest._id);
  return guest;
}

/** Log-in to an existing account while a guest: the guest's rows are re-assigned to the account. */
export async function mergeGuestInto(guest: UserDoc, account: UserDoc): Promise<void> {
  if (!guest.isGuest || String(guest._id) === String(account._id)) return;
  const from = { userId: guest._id };
  const to = { $set: { userId: account._id, expiresAt: null } };
  await Promise.all([Profile.updateMany(from, to), JobMatch.updateMany(from, to), SearchRun.updateMany(from, to)]);
  await guest.deleteOne();
}

/** Account deletion: every row with this userId, then the user. Existing sessions stop working. */
export async function deleteAccount(user: UserDoc): Promise<void> {
  await scoped(user._id).deleteAll();
  await user.deleteOne();
}
