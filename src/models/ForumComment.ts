import mongoose, { Schema, type InferSchemaType } from "mongoose";

const ForumCommentSchema = new Schema(
  {
    articleId: { type: Schema.Types.ObjectId, ref: "ForumArticle", required: true },
    authorUserId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    body: { type: String, required: true, trim: true, maxlength: 5000 },
  },
  { timestamps: true }
);

ForumCommentSchema.index({ articleId: 1, createdAt: 1 });
ForumCommentSchema.index({ authorUserId: 1, createdAt: -1 });

export type ForumComment = InferSchemaType<typeof ForumCommentSchema>;

export const ForumCommentModel =
  mongoose.models.ForumComment || mongoose.model("ForumComment", ForumCommentSchema);

