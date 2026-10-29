import { Schema, model, type HydratedDocument, type InferSchemaType } from "mongoose";
import { ATS_TYPES } from "@jobpilot/shared";

/** The shared watchlist. Holds no user data; `addedBy` only controls who may delete an entry. */
const companySchema = new Schema(
  {
    name: { type: String, required: true },
    careerUrl: { type: String, required: true },
    atsType: { type: String, enum: ATS_TYPES, required: true },
    /** Board token for ATS types; null for jsonld (the careerUrl is fetched instead). */
    atsToken: { type: String, default: null },
    lastCheckedAt: { type: Date, default: null },
    lastError: { type: String, default: null },
    openJobs: { type: Number, default: 0 },
    discoveredBy: { type: String, enum: ["user", "web_search"], required: true },
    addedBy: { type: Schema.Types.ObjectId, default: null },
  },
  { timestamps: true },
);

companySchema.index(
  { atsType: 1, atsToken: 1 },
  { unique: true, partialFilterExpression: { atsToken: { $type: "string" } } },
);
companySchema.index({ careerUrl: 1 }, { unique: true });

export type CompanyDoc = HydratedDocument<InferSchemaType<typeof companySchema>>;
export const Company = model("Company", companySchema);
