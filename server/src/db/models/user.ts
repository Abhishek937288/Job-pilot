import { Schema, model, type HydratedDocument, type InferSchemaType } from "mongoose";

const userSchema = new Schema(
  {
    email: { type: String, lowercase: true, trim: true, default: null },
    name: { type: String, default: null },
    passwordHash: { type: String, default: null },
    googleId: { type: String, default: null },
    isGuest: { type: Boolean, required: true, default: false },
    /** Guests only: the TTL index deletes the user when this passes. */
    expiresAt: { type: Date, default: null },
    /** Bumped to invalidate every session (logout everywhere, account deletion). */
    tokenVersion: { type: Number, required: true, default: 0 },
  },
  { timestamps: true },
);

userSchema.index({ email: 1 }, { unique: true, partialFilterExpression: { email: { $type: "string" } } });
userSchema.index({ googleId: 1 }, { unique: true, partialFilterExpression: { googleId: { $type: "string" } } });
userSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export type UserDoc = HydratedDocument<InferSchemaType<typeof userSchema>>;
export const User = model("User", userSchema);
