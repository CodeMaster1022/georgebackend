import mongoose, { Schema, type InferSchemaType, Types } from "mongoose";

const LessonRatingSchema = new Schema(
  {
    bookingId: { type: Schema.Types.ObjectId, ref: "Booking", required: true },
    teacherId: { type: Schema.Types.ObjectId, ref: "TeacherProfile", required: true },
    studentUserId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    fromRole: { type: String, enum: ["teacher", "student"], required: true },
    fromUserId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    rating: { type: Number, required: true, min: 1, max: 5 },
    comment: { type: String, trim: true, default: "" },
  },
  { timestamps: true }
);

LessonRatingSchema.index({ bookingId: 1, fromRole: 1 }, { unique: true });
LessonRatingSchema.index({ teacherId: 1, fromRole: 1 });
LessonRatingSchema.index({ studentUserId: 1, fromRole: 1 });

export type LessonRating = InferSchemaType<typeof LessonRatingSchema> & { _id: Types.ObjectId };

export const LessonRatingModel =
  mongoose.models.LessonRating || mongoose.model("LessonRating", LessonRatingSchema);
