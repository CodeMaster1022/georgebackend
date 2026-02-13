import { Router } from "express";
import { Types } from "mongoose";
import { z } from "zod";

import { requireAuth, requireRole } from "../middleware/auth";
import { asyncHandler } from "../utils/asyncHandler";
import { ForumArticleModel } from "../models/ForumArticle";
import { ForumAttachmentModel } from "../models/ForumAttachment";
import { ForumCreditTransactionModel } from "../models/ForumCreditTransaction";
import { ForumNotificationModel } from "../models/ForumNotification";
import { UserModel } from "../models/User";

export const adminForumRouter = Router();

adminForumRouter.use(requireAuth, requireRole("admin"));

adminForumRouter.get(
  "/articles/pending",
  asyncHandler(async (req, res) => {
    const page = Math.max(1, parseInt(String(req.query.page || "1")));
    const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit || "50"))));
    const skip = (page - 1) * limit;

    const [rows, totalCount] = await Promise.all([
      ForumArticleModel.find({ status: "pending" })
        .sort({ createdAt: 1 })
        .skip(skip)
        .limit(limit)
        .populate({ path: "authorUserId", select: "email role status" })
        .lean(),
      ForumArticleModel.countDocuments({ status: "pending" }),
    ]);

    return res.json({
      articles: rows.map((a: any) => ({
        id: String(a._id),
        title: String(a.title || ""),
        bodyPreview: String(a.body || "").slice(0, 240),
        createdAt: a.createdAt,
        author: a.authorUserId
          ? {
              id: String(a.authorUserId._id),
              email: String(a.authorUserId.email || ""),
              role: String(a.authorUserId.role || ""),
              status: String(a.authorUserId.status || ""),
            }
          : null,
      })),
      pagination: {
        page,
        limit,
        totalCount,
        totalPages: Math.ceil(totalCount / limit),
        hasNextPage: page < Math.ceil(totalCount / limit),
        hasPrevPage: page > 1,
      },
    });
  })
);

const PatchArticleSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  body: z.string().trim().min(1).max(20000).optional(),
});

adminForumRouter.patch(
  "/articles/:id",
  asyncHandler(async (req, res) => {
    const id = String(req.params.id || "");
    if (!Types.ObjectId.isValid(id)) return res.status(400).json({ error: "Invalid id" });
    const parsed = PatchArticleSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Invalid input", details: parsed.error.flatten() });

    const set: any = {};
    if (parsed.data.title != null) set.title = parsed.data.title;
    if (parsed.data.body != null) set.body = parsed.data.body;
    if (!Object.keys(set).length) return res.json({ ok: true });

    set.adminEdited = true;

    const updated = await ForumArticleModel.findOneAndUpdate(
      { _id: new Types.ObjectId(id), status: "pending" },
      { $set: set },
      { new: true }
    ).lean();
    if (!updated) return res.status(404).json({ error: "Not found" });

    return res.json({ ok: true });
  })
);

adminForumRouter.post(
  "/articles/:id/approve",
  asyncHandler(async (req, res) => {
    const id = String(req.params.id || "");
    if (!Types.ObjectId.isValid(id)) return res.status(400).json({ error: "Invalid id" });

    const articleId = new Types.ObjectId(id);
    const adminId = new Types.ObjectId(req.user!.id);

    const article = await ForumArticleModel.findById(articleId).lean();
    if (!article) return res.status(404).json({ error: "Not found" });
    if (String((article as any).status) !== "pending") return res.status(409).json({ error: "Not pending" });

    await ForumArticleModel.updateOne(
      { _id: articleId },
      {
        $set: {
          status: "approved",
          reviewedByUserId: adminId,
          reviewedAt: new Date(),
          rejectReason: "",
        },
      }
    );

    // Approve all attachments for this article as part of post approval
    await ForumAttachmentModel.updateMany(
      { parentType: "article", parentId: articleId, status: "pending" },
      { $set: { status: "approved", reviewedByUserId: adminId, reviewedAt: new Date(), rejectReason: "" } }
    );

    const authorId = String((article as any).authorUserId || "");
    if (Types.ObjectId.isValid(authorId)) {
      await ForumNotificationModel.create({
        userId: new Types.ObjectId(authorId),
        type: "article_approved",
        articleId,
      });
    }

    return res.json({ ok: true });
  })
);

const RejectSchema = z.object({
  reason: z.string().trim().min(1).max(500),
});

adminForumRouter.post(
  "/articles/:id/reject",
  asyncHandler(async (req, res) => {
    const id = String(req.params.id || "");
    if (!Types.ObjectId.isValid(id)) return res.status(400).json({ error: "Invalid id" });
    const parsed = RejectSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Invalid input", details: parsed.error.flatten() });

    const articleId = new Types.ObjectId(id);
    const adminId = new Types.ObjectId(req.user!.id);

    const article = await ForumArticleModel.findById(articleId).lean();
    if (!article) return res.status(404).json({ error: "Not found" });
    if (String((article as any).status) !== "pending") return res.status(409).json({ error: "Not pending" });

    await ForumArticleModel.updateOne(
      { _id: articleId },
      {
        $set: {
          status: "rejected",
          reviewedByUserId: adminId,
          reviewedAt: new Date(),
          rejectReason: parsed.data.reason,
        },
      }
    );

    await ForumAttachmentModel.updateMany(
      { parentType: "article", parentId: articleId, status: "pending" },
      { $set: { status: "rejected", reviewedByUserId: adminId, reviewedAt: new Date(), rejectReason: "Rejected with post" } }
    );

    const authorId = String((article as any).authorUserId || "");
    if (Types.ObjectId.isValid(authorId)) {
      await ForumNotificationModel.create({
        userId: new Types.ObjectId(authorId),
        type: "article_rejected",
        articleId,
      });
    }

    return res.json({ ok: true });
  })
);

const AwardCreditsSchema = z.object({
  userId: z.string().min(1),
  amount: z.number().int().min(1).max(100),
  reason: z.string().trim().max(200).optional(),
});

adminForumRouter.post(
  "/credits/award",
  asyncHandler(async (req, res) => {
    const parsed = AwardCreditsSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Invalid input", details: parsed.error.flatten() });
    const { userId, amount, reason } = parsed.data;
    if (!Types.ObjectId.isValid(userId)) return res.status(400).json({ error: "Invalid userId" });

    const user = await UserModel.findById(new Types.ObjectId(userId)).lean();
    if (!user) return res.status(404).json({ error: "User not found" });

    await ForumCreditTransactionModel.create({
      userId: new Types.ObjectId(userId),
      type: "admin_award",
      amount,
      reason: reason ?? "",
      createdByAdminUserId: new Types.ObjectId(req.user!.id),
    });

    return res.status(201).json({ ok: true });
  })
);

adminForumRouter.post(
  "/users/:id/ban",
  asyncHandler(async (req, res) => {
    const id = String(req.params.id || "");
    if (!Types.ObjectId.isValid(id)) return res.status(400).json({ error: "Invalid id" });
    await UserModel.updateOne({ _id: new Types.ObjectId(id) }, { $set: { status: "disabled" } });
    return res.json({ ok: true });
  })
);

adminForumRouter.post(
  "/users/:id/unban",
  asyncHandler(async (req, res) => {
    const id = String(req.params.id || "");
    if (!Types.ObjectId.isValid(id)) return res.status(400).json({ error: "Invalid id" });
    await UserModel.updateOne({ _id: new Types.ObjectId(id) }, { $set: { status: "active" } });
    return res.json({ ok: true });
  })
);

adminForumRouter.get(
  "/attachments/pending",
  asyncHandler(async (req, res) => {
    const page = Math.max(1, parseInt(String(req.query.page || "1")));
    const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit || "50"))));
    const skip = (page - 1) * limit;

    const parentType = String((req.query as any)?.parentType || "").trim();
    const q: any = { status: "pending" };
    if (parentType === "article" || parentType === "comment") q.parentType = parentType;

    const [rows, totalCount] = await Promise.all([
      ForumAttachmentModel.find(q).sort({ createdAt: 1 }).skip(skip).limit(limit).lean(),
      ForumAttachmentModel.countDocuments(q),
    ]);

    return res.json({
      attachments: rows.map((a: any) => ({
        id: String(a._id),
        parentType: String(a.parentType || ""),
        parentId: String(a.parentId || ""),
        status: String(a.status || ""),
        createdAt: a.createdAt,
        cloudinary: a.cloudinary
          ? {
              publicId: String(a.cloudinary.publicId || ""),
              originalFilename: String(a.cloudinary.originalFilename || ""),
              resourceType: String(a.cloudinary.resourceType || ""),
              deliveryType: String(a.cloudinary.deliveryType || ""),
              bytes: Number(a.cloudinary.bytes ?? 0),
              width: Number(a.cloudinary.width ?? 0),
              height: Number(a.cloudinary.height ?? 0),
              format: String(a.cloudinary.format || ""),
            }
          : null,
      })),
      pagination: {
        page,
        limit,
        totalCount,
        totalPages: Math.ceil(totalCount / limit),
        hasNextPage: page < Math.ceil(totalCount / limit),
        hasPrevPage: page > 1,
      },
    });
  })
);

adminForumRouter.post(
  "/attachments/:id/approve",
  asyncHandler(async (req, res) => {
    const id = String(req.params.id || "");
    if (!Types.ObjectId.isValid(id)) return res.status(400).json({ error: "Invalid id" });
    const adminId = new Types.ObjectId(req.user!.id);

    const updated = await ForumAttachmentModel.updateOne(
      { _id: new Types.ObjectId(id), status: "pending" },
      { $set: { status: "approved", reviewedByUserId: adminId, reviewedAt: new Date(), rejectReason: "" } }
    );
    if (!updated.matchedCount) return res.status(404).json({ error: "Not found" });
    return res.json({ ok: true });
  })
);

const RejectAttachmentSchema = z.object({
  reason: z.string().trim().min(1).max(500),
});

adminForumRouter.post(
  "/attachments/:id/reject",
  asyncHandler(async (req, res) => {
    const id = String(req.params.id || "");
    if (!Types.ObjectId.isValid(id)) return res.status(400).json({ error: "Invalid id" });
    const parsed = RejectAttachmentSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Invalid input", details: parsed.error.flatten() });
    const adminId = new Types.ObjectId(req.user!.id);

    const updated = await ForumAttachmentModel.updateOne(
      { _id: new Types.ObjectId(id), status: "pending" },
      { $set: { status: "rejected", reviewedByUserId: adminId, reviewedAt: new Date(), rejectReason: parsed.data.reason } }
    );
    if (!updated.matchedCount) return res.status(404).json({ error: "Not found" });
    return res.json({ ok: true });
  })
);

