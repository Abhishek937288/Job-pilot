import { Schema, model, type HydratedDocument, type InferSchemaType } from "mongoose";
import { JOB_SOURCES, REMOTE_TYPES } from "@jobpilot/shared";

/**
 * Shared cache of jobs read from watchlist companies (ATS boards and JSON-LD career pages), refreshed in
 * the background. Searches read watchlist jobs from here instead of calling the boards.
 */
const cachedJobSchema = new Schema({
  jobKey: { type: String, required: true, unique: true },
  companyId: { type: Schema.Types.ObjectId, required: true },
  source: { type: String, enum: JOB_SOURCES, required: true },
  sourceJobId: { type: String, default: null },
  title: { type: String, required: true },
  company: { type: String, required: true },
  location: { type: String, default: null },
  city: { type: String, default: null },
  region: { type: String, default: null },
  country: { type: String, default: null },
  remote: { type: String, enum: REMOTE_TYPES, default: "unknown" },
  salary: { type: new Schema({ min: Number, max: Number, currency: String, period: String }, { _id: false }), default: null },
  applyUrl: { type: String, required: true },
  postedAt: { type: Date, default: null },
  description: { type: String, default: null },
  employmentType: { type: String, default: null },
  requiredExperienceMonths: { type: Number, default: null },
  firstSeenAt: { type: Date, required: true },
  lastSeenAt: { type: Date, required: true },
  /** Set when the job disappears from the company board on a refresh. */
  closedAt: { type: Date, default: null },
});

cachedJobSchema.index({ title: "text" }, { default_language: "none" });
cachedJobSchema.index({ companyId: 1, closedAt: 1 });

export type CachedJobDoc = HydratedDocument<InferSchemaType<typeof cachedJobSchema>>;
export const CachedJob = model("CachedJob", cachedJobSchema);
