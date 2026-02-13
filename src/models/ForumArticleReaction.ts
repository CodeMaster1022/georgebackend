import mongoose, { Schema, type InferSchemaType } from "mongoose";

export type ForumArticleReactionType = "like" | "dislike";

const ForumArticleReactionSchema = new Schema(
  {
    articleId: { type: Schema.Types.ObjectId, ref: "ForumArticle", required: true },
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    type: { type: String, enum: ["like", "dislike"], required: true },
  },
  { timestamps: true }
);

ForumArticleReactionSchema.index({ articleId: 1, userId: 1 }, { unique: true });
ForumArticleReactionSchema.index({ articleId: 1, type: 1 });

export type ForumArticleReaction = InferSchemaType<typeof ForumArticleReactionSchema>;

export const ForumArticleReactionModel =
  mongoose.models.ForumArticleReaction || mongoose.model("ForumArticleReaction", ForumArticleReactionSchema);
