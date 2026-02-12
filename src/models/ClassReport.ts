import mongoose, { Schema, type InferSchemaType } from "mongoose";

const ClassReportSchema = new Schema(
  {
    bookingId: { type: Schema.Types.ObjectId, ref: "Booking", required: true },
    teacherId: { type: Schema.Types.ObjectId, ref: "TeacherProfile", required: true },
    studentUserId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    summary: { type: String, trim: true, default: "" },
    homework: { type: String, trim: true, default: "" },
    strengths: { type: String, trim: true, default: "" },
    createdAt: { type: Date, default: () => new Date() },
    updatedAt: { type: Date, default: () => new Date() },
  },
  { timestamps: false }
);

ClassReportSchema.index({ bookingId: 1 }, { unique: true });
ClassReportSchema.index({ studentUserId: 1, createdAt: -1 });
ClassReportSchema.index({ teacherId: 1, createdAt: -1 });

export type ClassReport = InferSchemaType<typeof ClassReportSchema>;

export const ClassReportModel =
  mongoose.models.ClassReport || mongoose.model("ClassReport", ClassReportSchema);

