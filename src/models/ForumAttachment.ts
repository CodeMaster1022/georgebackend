import mongoose, { Schema, type InferSchemaType } from "mongoose";

export type ForumAttachmentParentType = "article" | "comment";
export type ForumAttachmentStatus = "pending" | "approved" | "rejected";
export type ForumAttachmentProvider = "cloudinary";

const ForumAttachmentSchema = new Schema(
  {
    parentType: { type: String, enum: ["article", "comment"], required: true },
    parentId: { type: Schema.Types.ObjectId, required: true },
    uploaderUserId: { type: Schema.Types.ObjectId, ref: "User", required: true },

    status: { type: String, enum: ["pending", "approved", "rejected"], required: true, default: "pending" },
    reviewedByUserId: { type: Schema.Types.ObjectId, ref: "User" },
    reviewedAt: { type: Date },
    rejectReason: { type: String, trim: true, default: "" },

    provider: { type: String, enum: ["cloudinary"], required: true, default: "cloudinary" },
    cloudinary: {
      publicId: { type: String, trim: true, required: true },
      assetId: { type: String, trim: true, default: "" },
      resourceType: { type: String, trim: true, default: "image" }, // image|video|raw
      deliveryType: { type: String, trim: true, default: "authenticated" }, // authenticated|upload|private
      format: { type: String, trim: true, default: "" },
      bytes: { type: Number, default: 0 },
      width: { type: Number, default: 0 },
      height: { type: Number, default: 0 },
      originalFilename: { type: String, trim: true, default: "" },
    },
  },
  { timestamps: true }
);

ForumAttachmentSchema.index({ parentType: 1, parentId: 1, createdAt: 1 });
ForumAttachmentSchema.index({ status: 1, createdAt: -1 });
ForumAttachmentSchema.index({ uploaderUserId: 1, createdAt: -1 });
ForumAttachmentSchema.index({ "cloudinary.publicId": 1 }, { unique: true });

export type ForumAttachment = InferSchemaType<typeof ForumAttachmentSchema>;

export const ForumAttachmentModel =
  mongoose.models.ForumAttachment || mongoose.model("ForumAttachment", ForumAttachmentSchema);

