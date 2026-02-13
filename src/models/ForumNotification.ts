import mongoose, { Schema, type InferSchemaType } from "mongoose";

export type ForumNotificationType =
  | "comment_on_followed_article"
  | "article_approved"
  | "article_rejected";

const ForumNotificationSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    type: {
      type: String,
      enum: ["comment_on_followed_article", "article_approved", "article_rejected"],
      required: true,
    },
    articleId: { type: Schema.Types.ObjectId, ref: "ForumArticle", required: true },
    commentId: { type: Schema.Types.ObjectId, ref: "ForumComment" },
    readAt: { type: Date },
  },
  { timestamps: true }
);

ForumNotificationSchema.index({ userId: 1, createdAt: -1 });
ForumNotificationSchema.index({ userId: 1, readAt: 1, createdAt: -1 });
ForumNotificationSchema.index({ articleId: 1, createdAt: -1 });

export type ForumNotification = InferSchemaType<typeof ForumNotificationSchema>;

export const ForumNotificationModel =
  mongoose.models.ForumNotification || mongoose.model("ForumNotification", ForumNotificationSchema);

