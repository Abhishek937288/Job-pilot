import { Schema, model, type HydratedDocument, type InferSchemaType } from "mongoose";
import { REMOTE_PREFERENCES } from "@jobpilot/shared";

const experienceSchema = new Schema(
  { company: String, title: String, start: String, end: String, summary: String },
  { _id: false },
);
const educationSchema = new Schema(
  { institution: String, degree: String, field: String, start: String, end: String },
  { _id: false },
);

/** The parsed resume and preferences. The uploaded file and its raw text are never stored. */
const profileSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, required: true, index: true },
    label: { type: String, required: true },
    parsed: {
      name: { type: String, default: null },
      email: { type: String, default: null },
      location: { type: String, default: null },
      headline: { type: String, default: null },
      skills: { type: [String], default: [] },
      experience: { type: [experienceSchema], default: [] },
      education: { type: [educationSchema], default: [] },
    },
    yearsExperience: { type: Number, required: true, default: 0 },
    /** Canonical skills after alias normalization. */
    skills: { type: [String], default: [] },
    preferences: {
      desiredRole: { type: String, required: true },
      locations: { type: [String], default: [] },
      remote: { type: String, enum: REMOTE_PREFERENCES, default: "any" },
      minSalary: { type: Number, default: null },
      salaryCurrency: { type: String, default: null },
      noticePeriodDays: { type: Number, default: null },
      country: { type: String, default: "in" },
    },
    /** Hash of parsed resume + preferences. Stored scores are reused only while it matches. */
    profileHash: { type: String, required: true },
    extraction: {
      method: { type: String, enum: ["text", "vision"], required: true },
      textChars: { type: Number, required: true },
    },
    consentAt: { type: Date, required: true },
    lastSearchAt: { type: Date, default: null },
    expiresAt: { type: Date, default: null },
  },
  { timestamps: true },
);

profileSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export type ProfileDoc = HydratedDocument<InferSchemaType<typeof profileSchema>>;
export const Profile = model("Profile", profileSchema);
