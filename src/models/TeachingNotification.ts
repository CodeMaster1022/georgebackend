import mongoose, { Schema, type InferSchemaType, Types } from "mongoose";

export type TeachingNotificationType =
  | "new_booking"
  | "booking_cancelled"
  | "session_cancelled"
  | "class_report_submitted"
  | "lesson_completed";

const TeachingNotificationSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    type: {
      type: String,
      enum: ["new_booking", "booking_cancelled", "session_cancelled", "class_report_submitted", "lesson_completed"],
      required: true,
    },
    readAt: { type: Date },
    payload: { type: Schema.Types.Mixed, default: {} },
  },
  { timestamps: true }
);

TeachingNotificationSchema.index({ userId: 1, createdAt: -1 });
TeachingNotificationSchema.index({ userId: 1, readAt: 1, createdAt: -1 });

export type TeachingNotification = InferSchemaType<typeof TeachingNotificationSchema> & {
  _id: Types.ObjectId;
};

export const TeachingNotificationModel =
  mongoose.models.TeachingNotification ||
  mongoose.model("TeachingNotification", TeachingNotificationSchema);
