import mongoose, { Schema, type InferSchemaType } from "mongoose";

export type ClassSessionStatus = "open" | "booked" | "cancelled";

const ClassSessionSchema = new Schema(
  {
    teacherId: { type: Schema.Types.ObjectId, ref: "TeacherProfile", required: true },
    startAt: { type: Date, required: true },
    endAt: { type: Date, required: true },
    status: { type: String, enum: ["open", "booked", "cancelled"], default: "open", required: true },
    priceCredits: { type: Number, required: true, min: 1 },
    meetingLink: { type: String, trim: true, default: "" },
  },
  { timestamps: true }
);

ClassSessionSchema.index({ teacherId: 1, startAt: 1 });
ClassSessionSchema.index({ status: 1, startAt: 1 });

export type ClassSession = InferSchemaType<typeof ClassSessionSchema>;

export const ClassSessionModel =
  mongoose.models.ClassSession || mongoose.model("ClassSession", ClassSessionSchema);

