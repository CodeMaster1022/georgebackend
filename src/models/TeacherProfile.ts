import mongoose, { Schema, type InferSchemaType, Types } from "mongoose";

const TeacherProfileSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    name: { type: String, trim: true, default: "" },
    bio: { type: String, trim: true, default: "" },
    timezone: { type: String, trim: true, default: "" },
    country: { type: String, trim: true, default: "" },
    photoUrl: { type: String, trim: true, default: "" },
    phone: { type: String, trim: true, default: "" },
    social: {
      linkedin: { type: String, trim: true, default: "" },
      facebook: { type: String, trim: true, default: "" },
      instagram: { type: String, trim: true, default: "" },
      whatsapp: { type: String, trim: true, default: "" },
    },
    address: { type: String, trim: true, default: "" },
    resumeUrl: { type: String, trim: true, default: "" },
    education: [
      {
        school: { type: String, trim: true, default: "" },
        degree: { type: String, trim: true, default: "" },
        field: { type: String, trim: true, default: "" },
        startAt: { type: Date },
        endAt: { type: Date },
        description: { type: String, trim: true, default: "" },
      },
    ],
    employmentHistory: [
      {
        company: { type: String, trim: true, default: "" },
        title: { type: String, trim: true, default: "" },
        startAt: { type: Date },
        endAt: { type: Date },
        description: { type: String, trim: true, default: "" },
      },
    ],
    certificates: [
      {
        name: { type: String, trim: true, default: "" },
        issuer: { type: String, trim: true, default: "" },
        issuedAt: { type: Date },
        url: { type: String, trim: true, default: "" },
      },
    ],
    stats: {
      ratingAvg: { type: Number, default: 0 },
      ratingCount: { type: Number, default: 0 },
      followersCount: { type: Number, default: 0 },
      earnedTotal: { type: Number, default: 0 },
    },
  },
  { timestamps: true }
);

TeacherProfileSchema.index({ userId: 1 }, { unique: true });
TeacherProfileSchema.index({ country: 1 });
TeacherProfileSchema.index({ "stats.ratingAvg": -1 });

export type TeacherProfile = InferSchemaType<typeof TeacherProfileSchema> & {
  _id: Types.ObjectId;
};

export const TeacherProfileModel =
  mongoose.models.TeacherProfile || mongoose.model("TeacherProfile", TeacherProfileSchema);

