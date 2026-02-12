import mongoose, { Schema, type InferSchemaType } from "mongoose";

export type UserRole = "student" | "teacher" | "admin";
export type UserStatus = "active" | "disabled";

const UserSchema = new Schema(
  {
    role: { type: String, enum: ["student", "teacher", "admin"], required: true },
    email: { type: String, required: true, trim: true, lowercase: true },
    passwordHash: { type: String, required: true },
    status: { type: String, enum: ["active", "disabled"], required: true, default: "active" },
    verifiedEmail: { type: Boolean, default: false },
    lastLoginAt: { type: Date },
    integrations: {
      googleCalendar: {
        connected: { type: Boolean, default: false },
        googleUserEmail: { type: String, trim: true, lowercase: true, default: "" },
        // Store refresh token encrypted at rest (do NOT store plaintext tokens).
        refreshTokenEncrypted: { type: String, trim: true, default: "" },
        scopes: [{ type: String, trim: true }],
        tokenExpiry: { type: Date },
        calendarId: { type: String, trim: true, default: "" },
        lastSyncedAt: { type: Date },
      },
    },
  },
  { timestamps: true }
);

UserSchema.index({ email: 1 }, { unique: true });
UserSchema.index({ role: 1, status: 1 });
UserSchema.index({ "integrations.googleCalendar.connected": 1 });

export type User = InferSchemaType<typeof UserSchema>;

export const UserModel = mongoose.models.User || mongoose.model("User", UserSchema);

