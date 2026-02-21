import mongoose, { Schema, type InferSchemaType, Types } from "mongoose";

const LessonMessageSchema = new Schema(
  {
    bookingId: { type: Schema.Types.ObjectId, ref: "Booking", required: true },
    fromUserId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    fromRole: { type: String, enum: ["student", "teacher"], required: true },
    body: { type: String, required: true, trim: true, maxlength: 5000 },
    readAt: { type: Date, default: null },
  },
  { timestamps: true }
);

LessonMessageSchema.index({ bookingId: 1, createdAt: 1 });
LessonMessageSchema.index({ fromUserId: 1, createdAt: -1 });

export type LessonMessage = InferSchemaType<typeof LessonMessageSchema> & {
  _id: Types.ObjectId;
};

export const LessonMessageModel =
  mongoose.models.LessonMessage || mongoose.model("LessonMessage", LessonMessageSchema);
