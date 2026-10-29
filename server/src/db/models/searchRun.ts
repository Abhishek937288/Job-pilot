import { Schema, model, type HydratedDocument, type InferSchemaType } from "mongoose";
import { RUN_STATUSES, RUN_STEPS } from "@jobpilot/shared";

/** One search run, with progress steps and the latency/cost measurements. */
const searchRunSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, required: true },
    profileId: { type: Schema.Types.ObjectId, required: true },
    status: { type: String, enum: RUN_STATUSES, required: true, default: "queued" },
    trigger: { type: String, enum: ["initial", "manual"], required: true },
    queries: {
      type: [new Schema({ query: String, location: String, remoteOnly: Boolean }, { _id: false })],
      default: [],
    },
    steps: {
      type: [new Schema({ step: { type: String, enum: RUN_STEPS }, message: String, at: Date }, { _id: false })],
      default: [],
    },
    stats: { type: Schema.Types.Mixed, default: null },
    metrics: { type: Schema.Types.Mixed, default: null },
    error: { type: String, default: null },
    startedAt: { type: Date, default: null },
    finishedAt: { type: Date, default: null },
    expiresAt: { type: Date, default: null },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

searchRunSchema.index({ profileId: 1, createdAt: -1 });
searchRunSchema.index({ userId: 1 });
searchRunSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export type SearchRunDoc = HydratedDocument<InferSchemaType<typeof searchRunSchema>>;
export const SearchRun = model("SearchRun", searchRunSchema);
