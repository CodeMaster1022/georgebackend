import mongoose, { Schema, type InferSchemaType } from "mongoose";

const StudentProfileSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    nickname: { type: String, trim: true, default: "" },
    birthdate: { type: String, trim: true, default: "" }, // YYYY-MM-DD
    spanishLevel: { type: String, trim: true, default: "" },
    canRead: { type: String, enum: ["Yes", "No", ""], default: "" },
    homeschoolFunding: { type: String, enum: ["Yes", "No", ""], default: "" },
    questionnaire: { type: String, trim: true, default: "" },
    parentContact: {
      name: { type: String, trim: true, default: "" },
      phone: { type: String, trim: true, default: "" },
    },
  },
  { timestamps: true }
);

StudentProfileSchema.index({ userId: 1 }, { unique: true });

export type StudentProfile = InferSchemaType<typeof StudentProfileSchema>;

export const StudentProfileModel =
  mongoose.models.StudentProfile || mongoose.model("StudentProfile", StudentProfileSchema);

