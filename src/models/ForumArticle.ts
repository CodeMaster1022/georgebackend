import mongoose, { Schema, type InferSchemaType } from "mongoose";

export type ForumArticleStatus = "pending" | "approved" | "rejected";

const ForumArticleSchema = new Schema(
  {
    authorUserId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    title: { type: String, required: true, trim: true, maxlength: 200 },
    body: { type: String, required: true, trim: true, maxlength: 20000 },
    status: { type: String, enum: ["pending", "approved", "rejected"], required: true, default: "pending" },

    reviewedByUserId: { type: Schema.Types.ObjectId, ref: "User" },
    reviewedAt: { type: Date },
    rejectReason: { type: String, trim: true, default: "" },
    adminEdited: { type: Boolean, default: false },

    commentCount: { type: Number, default: 0 },
    followerCount: { type: Number, default: 0 },
    viewCount: { type: Number, default: 0 },
    likeCount: { type: Number, default: 0 },
    dislikeCount: { type: Number, default: 0 },
  },
  { timestamps: true }
);

ForumArticleSchema.index({ status: 1, createdAt: -1 });
ForumArticleSchema.index({ authorUserId: 1, createdAt: -1 });

export type ForumArticle = InferSchemaType<typeof ForumArticleSchema>;

export const ForumArticleModel =
  mongoose.models.ForumArticle || mongoose.model("ForumArticle", ForumArticleSchema);

