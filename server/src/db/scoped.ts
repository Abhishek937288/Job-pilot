import { isValidObjectId, Types } from "mongoose";
import type { JobStatus } from "@jobpilot/shared";
import { JobMatch, type JobMatchDoc } from "./models/jobMatch.js";
import { Profile, type ProfileDoc } from "./models/profile.js";
import { SearchRun, type SearchRunDoc } from "./models/searchRun.js";

const oid = (id: string) => new Types.ObjectId(id);

/**
 * The only way route handlers and the worker read or change per-user data. Every query carries the
 * userId taken from the verified session (or the job payload), never from the request body or URL,
 * and lookups by id return null for both "missing" and "someone else's", so callers answer 404.
 */
export function scoped(userId: string | Types.ObjectId) {
  const uid = typeof userId === "string" ? oid(userId) : userId;

  return {
    userId: uid,

    async profile(id: string): Promise<ProfileDoc | null> {
      if (!isValidObjectId(id)) return null;
      return Profile.findOne({ _id: oid(id), userId: uid });
    },

    profiles(): Promise<ProfileDoc[]> {
      return Profile.find({ userId: uid }).sort({ createdAt: -1 });
    },

    countProfiles(): Promise<number> {
      return Profile.countDocuments({ userId: uid });
    },

    async jobMatch(id: string): Promise<JobMatchDoc | null> {
      if (!isValidObjectId(id)) return null;
      return JobMatch.findOne({ _id: oid(id), userId: uid });
    },

    jobMatches(profileId: Types.ObjectId, filter: { status?: JobStatus | { $ne: JobStatus }; minScore?: number } = {}) {
      const q: Record<string, unknown> = { userId: uid, profileId };
      if (filter.status) q.status = filter.status;
      if (filter.minScore && filter.minScore > 0) q["match.score"] = { $gte: filter.minScore };
      return JobMatch.find(q).sort({ "match.score": -1, firstSeenAt: -1 });
    },

    async jobCounts(profileIds: Types.ObjectId[]): Promise<Map<string, Record<JobStatus, number>>> {
      const rows = await JobMatch.aggregate<{ _id: { p: Types.ObjectId; s: JobStatus }; n: number }>([
        { $match: { userId: uid, profileId: { $in: profileIds } } },
        { $group: { _id: { p: "$profileId", s: "$status" }, n: { $sum: 1 } } },
      ]);
      const out = new Map<string, Record<JobStatus, number>>();
      for (const id of profileIds) out.set(String(id), { new: 0, done: 0, deleted: 0 });
      for (const r of rows) out.get(String(r._id.p))![r._id.s] = r.n;
      return out;
    },

    async run(id: string): Promise<SearchRunDoc | null> {
      if (!isValidObjectId(id)) return null;
      return SearchRun.findOne({ _id: oid(id), userId: uid });
    },

    runs(profileId: Types.ObjectId, limit = 20): Promise<SearchRunDoc[]> {
      return SearchRun.find({ userId: uid, profileId }).sort({ createdAt: -1 }).limit(limit);
    },

    activeRun(profileId: Types.ObjectId): Promise<SearchRunDoc | null> {
      return SearchRun.findOne({ userId: uid, profileId, status: { $in: ["queued", "running"] } });
    },

    /** Hard delete: the profile and every job and run that belongs to it. */
    async deleteProfile(profileId: Types.ObjectId): Promise<void> {
      await Promise.all([
        JobMatch.deleteMany({ userId: uid, profileId }),
        SearchRun.deleteMany({ userId: uid, profileId }),
      ]);
      await Profile.deleteOne({ _id: profileId, userId: uid });
    },

    /** Every row the user owns (account deletion). */
    async deleteAll(): Promise<void> {
      await Promise.all([
        JobMatch.deleteMany({ userId: uid }),
        SearchRun.deleteMany({ userId: uid }),
        Profile.deleteMany({ userId: uid }),
      ]);
    },
  };
}

export type Scoped = ReturnType<typeof scoped>;
