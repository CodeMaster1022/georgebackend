import mongoose, { Schema, type InferSchemaType } from "mongoose";

const EmailVerificationCodeSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    email: { type: String, required: true, trim: true, lowercase: true, index: true },
    codeHash: { type: String, required: true },
    expiresAt: { type: Date, required: true, index: true },
    attempts: { type: Number, required: true, default: 0 },
    lastSentAt: { type: Date, required: true, default: () => new Date() },
  },
  { timestamps: true }
);

// TTL cleanup
EmailVerificationCodeSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
EmailVerificationCodeSchema.index({ userId: 1 }, { unique: true });

export type EmailVerificationCode = InferSchemaType<typeof EmailVerificationCodeSchema>;

export const EmailVerificationCodeModel =
  mongoose.models.EmailVerificationCode || mongoose.model("EmailVerificationCode", EmailVerificationCodeSchema);

