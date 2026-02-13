import mongoose, { Schema, type InferSchemaType } from "mongoose";

export type ForumCreditTxType = "admin_award" | "admin_deduct";

const ForumCreditTransactionSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    type: { type: String, enum: ["admin_award", "admin_deduct"], required: true },
    amount: { type: Number, required: true }, // integer; negative means deduction
    reason: { type: String, trim: true, default: "" },
    createdByAdminUserId: { type: Schema.Types.ObjectId, ref: "User", required: true },
  },
  { timestamps: true }
);

ForumCreditTransactionSchema.index({ userId: 1, createdAt: -1 });
ForumCreditTransactionSchema.index({ type: 1, createdAt: -1 });

export type ForumCreditTransaction = InferSchemaType<typeof ForumCreditTransactionSchema>;

export const ForumCreditTransactionModel =
  mongoose.models.ForumCreditTransaction || mongoose.model("ForumCreditTransaction", ForumCreditTransactionSchema);

