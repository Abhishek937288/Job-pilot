import { Schema, model, type HydratedDocument, type InferSchemaType } from "mongoose";
import { JOB_SOURCES, JOB_STATUSES, REMOTE_TYPES, VERDICTS } from "@jobpilot/shared";

const applyLinkSchema = new Schema({ url: String, source: String, isDirect: Boolean }, { _id: false });

/** One row per job per profile. The unique (profileId, jobKey) index makes duplicates impossible. */
const jobMatchSchema = new Schema({
  userId: { type: Schema.Types.ObjectId, required: true },
  profileId: { type: Schema.Types.ObjectId, required: true },
  jobKey: { type: String, required: true },
  /** SHA-1 of normalized title|company|city: merges the same job arriving from different sources. */
  fingerprint: { type: String, required: true },
  job: {
    title: { type: String, required: true },
    company: { type: String, required: true },
    location: { type: String, default: null },
    city: { type: String, default: null },
    country: { type: String, default: null },
    remote: { type: String, enum: REMOTE_TYPES, default: "unknown" },
    salary: {
      type: new Schema({ min: Number, max: Number, currency: String, period: String }, { _id: false }),
      default: null,
    },
    applyLinks: { type: [applyLinkSchema], default: [] },
    postedAt: { type: Date, default: null },
    source: { type: String, enum: JOB_SOURCES, required: true },
    sources: { type: [String], default: [] },
    snippet: { type: String, default: null },
    employmentType: { type: String, default: null },
    closedAt: { type: Date, default: null },
  },
  match: {
    type: new Schema(
      {
        score: Number,
        scores: { skills: Number, seniority: Number, location: Number, salary: { type: Number, default: null } },
        matchedSkills: [String],
        missingSkills: [String],
        reason: String,
        verdict: { type: String, enum: VERDICTS },
        redFlags: [String],
        explained: { type: Boolean, default: false },
        profileHash: String,
        scoredAt: Date,
      },
      { _id: false },
    ),
    default: null,
  },
  status: { type: String, enum: JOB_STATUSES, required: true, default: "new" },
  doneAt: { type: Date, default: null },
  deletedAt: { type: Date, default: null },
  firstSeenAt: { type: Date, required: true },
  lastSeenAt: { type: Date, required: true },
  timesSeen: { type: Number, required: true, default: 1 },
  expiresAt: { type: Date, default: null },
});

jobMatchSchema.index({ profileId: 1, jobKey: 1 }, { unique: true });
jobMatchSchema.index({ userId: 1, status: 1, "match.score": -1 });
jobMatchSchema.index({ profileId: 1, status: 1, "match.score": -1 });
jobMatchSchema.index({ profileId: 1, fingerprint: 1 });
jobMatchSchema.index({ jobKey: 1 });
jobMatchSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export type JobMatchDoc = HydratedDocument<InferSchemaType<typeof jobMatchSchema>>;
export const JobMatch = model("JobMatch", jobMatchSchema);
