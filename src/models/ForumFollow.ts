import mongoose, { Schema, type InferSchemaType } from "mongoose";

const ForumFollowSchema = new Schema(
  {
    articleId: { type: Schema.Types.ObjectId, ref: "ForumArticle", required: true },
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
  },
  { timestamps: true }
);

ForumFollowSchema.index({ articleId: 1, userId: 1 }, { unique: true });
ForumFollowSchema.index({ userId: 1, createdAt: -1 });
ForumFollowSchema.index({ articleId: 1, createdAt: -1 });

export type ForumFollow = InferSchemaType<typeof ForumFollowSchema>;

export const ForumFollowModel = mongoose.models.ForumFollow || mongoose.model("ForumFollow", ForumFollowSchema);

