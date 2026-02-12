import mongoose, { Schema, type InferSchemaType } from "mongoose";

export type CreditTxType = "purchase" | "spend" | "refund" | "admin_adjust" | "share_out" | "share_in";

const CreditTransactionSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    type: {
      type: String,
      enum: ["purchase", "spend", "refund", "admin_adjust", "share_out", "share_in"],
      required: true,
    },
    amount: { type: Number, required: true }, // spend should be negative
    currency: { type: String, enum: ["credits"], default: "credits", required: true },
    meta: {
      method: { type: String, trim: true, default: "" },
      referralCode: { type: String, trim: true, default: "" },
    },
    related: {
      bookingId: { type: Schema.Types.ObjectId, ref: "Booking" },
      sessionId: { type: Schema.Types.ObjectId, ref: "ClassSession" },
      paymentId: { type: Schema.Types.ObjectId },
      shareId: { type: Schema.Types.ObjectId },
    },
  },
  { timestamps: true }
);

CreditTransactionSchema.index({ userId: 1, createdAt: -1 });
CreditTransactionSchema.index({ type: 1, createdAt: -1 });

export type CreditTransaction = InferSchemaType<typeof CreditTransactionSchema>;

export const CreditTransactionModel =
  mongoose.models.CreditTransaction || mongoose.model("CreditTransaction", CreditTransactionSchema);

