import mongoose, { Schema, type InferSchemaType } from "mongoose";

const TeacherAvailabilitySchema = new Schema(
  {
    teacherId: { type: Schema.Types.ObjectId, ref: "TeacherProfile", required: true },
    type: { type: String, enum: ["weekly", "override"], required: true },
    // weekly
    weekday: { type: Number, min: 0, max: 6 },
    startTime: { type: String, trim: true }, // HH:mm
    endTime: { type: String, trim: true }, // HH:mm
    timezone: { type: String, trim: true },
    // override
    startAt: { type: Date },
    endAt: { type: Date },
    status: { type: String, enum: ["available", "blocked"], default: "available" },
  },
  { timestamps: true }
);

TeacherAvailabilitySchema.index({ teacherId: 1 });
TeacherAvailabilitySchema.index({ teacherId: 1, startAt: 1 });

export type TeacherAvailability = InferSchemaType<typeof TeacherAvailabilitySchema>;

export const TeacherAvailabilityModel =
  mongoose.models.TeacherAvailability || mongoose.model("TeacherAvailability", TeacherAvailabilitySchema);

