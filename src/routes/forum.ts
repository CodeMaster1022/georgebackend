import { Router } from "express";
import { Types } from "mongoose";
import { z } from "zod";

import { requireAuth, requireRole } from "../middleware/auth";
import { asyncHandler } from "../utils/asyncHandler";
import { env } from "../config/env";
import { ForumArticleModel } from "../models/ForumArticle";
import { ForumAttachmentModel } from "../models/ForumAttachment";
import { ForumCommentModel } from "../models/ForumComment";
import { ForumFollowModel } from "../models/ForumFollow";
import { ForumCreditTransactionModel } from "../models/ForumCreditTransaction";
import { ForumNotificationModel } from "../models/ForumNotification";
import { ForumArticleReactionModel } from "../models/ForumArticleReaction";
import { getCloudinary } from "../services/cloudinary";

export const forumRouter = Router();

forumRouter.use(requireAuth, requireRole("student", "teacher", "admin"));

const BASE_ARTICLE_QUOTA_PER_WEEK = 3;

function startOfWeekUtc(d: Date): Date {
  // Monday 00:00 UTC
  const date = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = date.getUTCDay(); // 0..6 (Sun..Sat)
  const diffToMonday = (day + 6) % 7; // Mon->0, Tue->1, ... Sun->6
  date.setUTCDate(date.getUTCDate() - diffToMonday);
  date.setUTCHours(0, 0, 0, 0);
  return date;
}

async function forumCreditsBalance(userId: Types.ObjectId): Promise<number> {
  const agg = await ForumCreditTransactionModel.aggregate([
    { $match: { userId: { $eq: userId } } },
    { $group: { _id: null, balance: { $sum: "$amount" } } },
  ]);
  return Number(agg[0]?.balance ?? 0);
}

async function usedArticlesThisWeek(userId: Types.ObjectId): Promise<number> {
  const now = new Date();
  const periodStart = startOfWeekUtc(now);
  return await ForumArticleModel.countDocuments({ authorUserId: userId, createdAt: { $gte: periodStart } });
}

forumRouter.get(
  "/me/summary",
  asyncHandler(async (req, res) => {
    const userId = new Types.ObjectId(req.user!.id);
    const now = new Date();
    const periodStart = startOfWeekUtc(now);
    const periodEnd = new Date(periodStart);
    periodEnd.setUTCDate(periodEnd.getUTCDate() + 7);

    const [creditsBalance, used] = await Promise.all([forumCreditsBalance(userId), usedArticlesThisWeek(userId)]);

    const baseQuota = BASE_ARTICLE_QUOTA_PER_WEEK;
    const allowed = Math.max(0, baseQuota + creditsBalance);
    const remaining = Math.max(0, allowed - used);

    return res.json({
      period: { startAt: periodStart, endAt: periodEnd, kind: "week" },
      baseQuota,
      creditsBalance,
      used,
      allowed,
      remaining,
    });
  })
);

forumRouter.get(
  "/me/articles",
  asyncHandler(async (req, res) => {
    const userId = new Types.ObjectId(req.user!.id);
    const rows = await ForumArticleModel.find({ authorUserId: userId })
      .sort({ createdAt: -1 })
      .limit(200)
      .lean();

    return res.json({
      articles: rows.map((a: any) => ({
        id: String(a._id),
        title: String(a.title || ""),
        status: String(a.status || ""),
        rejectReason: String(a.rejectReason || ""),
        createdAt: a.createdAt,
        reviewedAt: a.reviewedAt ?? null,
      })),
    });
  })
);

forumRouter.get(
  "/me/follows",
  asyncHandler(async (req, res) => {
    const userId = new Types.ObjectId(req.user!.id);
    const follows = await ForumFollowModel.find({ userId }).sort({ createdAt: -1 }).limit(200).lean();
    const articleIds = follows.map((f: any) => f.articleId).filter(Boolean);

    const articles = await ForumArticleModel.find({ _id: { $in: articleIds }, status: "approved" })
      .select("title createdAt")
      .lean();
    const byId = new Map(articles.map((a: any) => [String(a._id), a]));

    return res.json({
      follows: follows
        .map((f: any) => {
          const a = byId.get(String(f.articleId));
          if (!a) return null;
          return {
            articleId: String(f.articleId),
            followedAt: f.createdAt,
            article: { id: String(a._id), title: String(a.title || ""), createdAt: a.createdAt },
          };
        })
        .filter(Boolean),
    });
  })
);

forumRouter.get(
  "/me/notifications",
  asyncHandler(async (req, res) => {
    const userId = new Types.ObjectId(req.user!.id);
    const rows = await ForumNotificationModel.find({ userId }).sort({ createdAt: -1 }).limit(100).lean();
    return res.json({
      notifications: rows.map((n: any) => ({
        id: String(n._id),
        type: String(n.type || ""),
        articleId: String(n.articleId || ""),
        commentId: n.commentId ? String(n.commentId) : "",
        readAt: n.readAt ?? null,
        createdAt: n.createdAt,
      })),
    });
  })
);

forumRouter.post(
  "/me/notifications/:id/read",
  asyncHandler(async (req, res) => {
    const userId = new Types.ObjectId(req.user!.id);
    const id = String(req.params.id || "");
    if (!Types.ObjectId.isValid(id)) return res.status(400).json({ error: "Invalid id" });

    await ForumNotificationModel.updateOne({ _id: new Types.ObjectId(id), userId }, { $set: { readAt: new Date() } });
    return res.json({ ok: true });
  })
);

const AttachmentInputSchema = z.object({
  publicId: z.string().trim().min(1).max(255),
  assetId: z.string().trim().max(255).optional(),
  resourceType: z.string().trim().max(40).optional(),
  deliveryType: z.string().trim().max(40).optional(),
  format: z.string().trim().max(40).optional(),
  bytes: z.number().int().nonnegative().optional(),
  width: z.number().int().nonnegative().optional(),
  height: z.number().int().nonnegative().optional(),
  originalFilename: z.string().trim().max(255).optional(),
});

const CreateArticleSchema = z.object({
  title: z.string().trim().min(1).max(200),
  body: z.string().trim().min(1).max(20000),
  attachments: z.array(AttachmentInputSchema).max(8).optional(),
});

forumRouter.post(
  "/articles",
  asyncHandler(async (req, res) => {
    const parsed = CreateArticleSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Invalid input", details: parsed.error.flatten() });

    const userId = new Types.ObjectId(req.user!.id);
    const [creditsBalance, used] = await Promise.all([forumCreditsBalance(userId), usedArticlesThisWeek(userId)]);
    const allowed = Math.max(0, BASE_ARTICLE_QUOTA_PER_WEEK + creditsBalance);
    if (used >= allowed) {
      return res.status(429).json({ error: "Posting limit reached for this week." });
    }

    const { title, body, attachments } = parsed.data;

    const article = await ForumArticleModel.create({
      authorUserId: userId,
      title,
      body,
      status: "pending",
    });

    if (attachments?.length) {
      await ForumAttachmentModel.insertMany(
        attachments.map((a) => ({
          parentType: "article",
          parentId: article._id,
          uploaderUserId: userId,
          status: "pending",
          provider: "cloudinary",
          cloudinary: {
            publicId: a.publicId,
            assetId: a.assetId ?? "",
            resourceType: a.resourceType ?? "image",
            deliveryType: a.deliveryType ?? "authenticated",
            format: a.format ?? "",
            bytes: a.bytes ?? 0,
            width: a.width ?? 0,
            height: a.height ?? 0,
            originalFilename: a.originalFilename ?? "",
          },
        }))
      );
    }

    return res.status(201).json({
      article: {
        id: String(article._id),
        status: String(article.status),
        title: String(article.title),
        body: String(article.body),
        createdAt: article.createdAt,
      },
    });
  })
);

const ListArticlesQuerySchema = z.object({
  page: z.coerce.number().int().min(1).max(500).default(1),
  q: z.string().trim().max(120).optional(),
});

forumRouter.get(
  "/articles",
  asyncHandler(async (req, res) => {
    const parsed = ListArticlesQuerySchema.safeParse(req.query);
    if (!parsed.success) return res.status(400).json({ error: "Invalid query", details: parsed.error.flatten() });

    const { page, q } = parsed.data;
    const limit = 20;
    const skip = (page - 1) * limit;

    const query: any = { status: "approved" };
    if (q) query.title = { $regex: q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), $options: "i" };

    const [rows, total] = await Promise.all([
      ForumArticleModel.find(query)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate({ path: "authorUserId", select: "email role" })
        .lean(),
      ForumArticleModel.countDocuments(query),
    ]);

    return res.json({
      page,
      pageSize: limit,
      total,
      articles: rows.map((a: any) => ({
        id: String(a._id),
        title: String(a.title || ""),
        bodyPreview: String(a.body || "").slice(0, 240),
        createdAt: a.createdAt,
        commentCount: Number(a.commentCount ?? 0),
        followerCount: Number(a.followerCount ?? 0),
        viewCount: Number(a.viewCount ?? 0),
        author: a.authorUserId
          ? { id: String(a.authorUserId._id), email: String(a.authorUserId.email || ""), role: String(a.authorUserId.role || "") }
          : null,
      })),
    });
  })
);

forumRouter.get(
  "/articles/:id",
  asyncHandler(async (req, res) => {
    const id = String(req.params.id || "");
    if (!Types.ObjectId.isValid(id)) return res.status(400).json({ error: "Invalid id" });

    const userId = new Types.ObjectId(req.user!.id);
    const isAdmin = req.user!.role === "admin";

    const article = await ForumArticleModel.findById(new Types.ObjectId(id))
      .populate({ path: "authorUserId", select: "email role" })
      .lean();
    if (!article) return res.status(404).json({ error: "Not found" });

    // Increment view count for approved articles
    if (String((article as any).status) === "approved") {
      await ForumArticleModel.updateOne({ _id: new Types.ObjectId(id) }, { $inc: { viewCount: 1 } });
    }

    const isAuthor = String((article as any).authorUserId?._id || "") === String(userId);
    if (String((article as any).status) !== "approved" && !isAdmin && !isAuthor) {
      return res.status(404).json({ error: "Not found" });
    }

    const [following, comments, attachments, userReaction] = await Promise.all([
      ForumFollowModel.findOne({ userId, articleId: new Types.ObjectId(id) }).lean(),
      String((article as any).status) === "approved"
        ? ForumCommentModel.find({ articleId: new Types.ObjectId(id) })
            .sort({ createdAt: 1 })
            .limit(500)
            .populate({ path: "authorUserId", select: "email role" })
            .lean()
        : Promise.resolve([] as any[]),
      ForumAttachmentModel.find({ parentType: "article", parentId: new Types.ObjectId(id) })
        .sort({ createdAt: 1 })
        .lean(),
      ForumArticleReactionModel.findOne({ articleId: new Types.ObjectId(id), userId }).lean(),
    ]);

    const commentIds = (comments as any[]).map((c) => c?._id).filter(Boolean);
    const commentAttachments = commentIds.length
      ? await ForumAttachmentModel.find({ parentType: "comment", parentId: { $in: commentIds } })
          .sort({ createdAt: 1 })
          .lean()
      : [];

    const commentAttByCommentId = new Map<string, any[]>();
    for (const att of commentAttachments as any[]) {
      const key = String(att.parentId || "");
      if (!commentAttByCommentId.has(key)) commentAttByCommentId.set(key, []);
      commentAttByCommentId.get(key)!.push(att);
    }

    const visibleAttachments = attachments.filter((att: any) => {
      if (isAdmin) return true;
      return String((article as any).status) === "approved" && String(att.status) === "approved";
    });

    return res.json({
      article: {
        id: String((article as any)._id),
        title: String((article as any).title || ""),
        body: String((article as any).body || ""),
        status: String((article as any).status || ""),
        createdAt: (article as any).createdAt,
        reviewedAt: (article as any).reviewedAt ?? null,
        rejectReason: isAuthor || isAdmin ? String((article as any).rejectReason || "") : "",
        author: (article as any).authorUserId
          ? {
              id: String((article as any).authorUserId._id),
              email: String((article as any).authorUserId.email || ""),
              role: String((article as any).authorUserId.role || ""),
            }
          : null,
        commentCount: Number((article as any).commentCount ?? 0),
        followerCount: Number((article as any).followerCount ?? 0),
        viewCount: Number((article as any).viewCount ?? 0),
        likeCount: Number((article as any).likeCount ?? 0),
        dislikeCount: Number((article as any).dislikeCount ?? 0),
        following: Boolean(following),
        userReaction: userReaction ? String((userReaction as any).type) : null,
      },
      attachments: visibleAttachments.map((att: any) => ({
        id: String(att._id),
        status: String(att.status || ""),
        provider: String(att.provider || ""),
        cloudinary: att.cloudinary
          ? {
              publicId: String(att.cloudinary.publicId || ""),
              format: String(att.cloudinary.format || ""),
              bytes: Number(att.cloudinary.bytes ?? 0),
              width: Number(att.cloudinary.width ?? 0),
              height: Number(att.cloudinary.height ?? 0),
            }
          : null,
      })),
      comments: comments.map((c: any) => ({
        id: String(c._id),
        body: String(c.body || ""),
        createdAt: c.createdAt,
        author: c.authorUserId
          ? { id: String(c.authorUserId._id), email: String(c.authorUserId.email || ""), role: String(c.authorUserId.role || "") }
          : null,
        attachments: (commentAttByCommentId.get(String(c._id)) || [])
          .filter((att: any) => (isAdmin ? true : String(att.status) === "approved"))
          .map((att: any) => ({
            id: String(att._id),
            status: String(att.status || ""),
            provider: String(att.provider || ""),
            cloudinary: att.cloudinary
              ? {
                  publicId: String(att.cloudinary.publicId || ""),
                  format: String(att.cloudinary.format || ""),
                  bytes: Number(att.cloudinary.bytes ?? 0),
                  width: Number(att.cloudinary.width ?? 0),
                  height: Number(att.cloudinary.height ?? 0),
                }
              : null,
          })),
      })),
    });
  })
);

forumRouter.post(
  "/articles/:id/follow",
  asyncHandler(async (req, res) => {
    const id = String(req.params.id || "");
    if (!Types.ObjectId.isValid(id)) return res.status(400).json({ error: "Invalid id" });

    const articleId = new Types.ObjectId(id);
    const userId = new Types.ObjectId(req.user!.id);

    const article = await ForumArticleModel.findById(articleId).lean();
    if (!article || String((article as any).status) !== "approved") return res.status(404).json({ error: "Not found" });

    try {
      await ForumFollowModel.create({ articleId, userId });
      await ForumArticleModel.updateOne({ _id: articleId }, { $inc: { followerCount: 1 } });
    } catch {
      // ignore duplicate follow
    }

    return res.json({ ok: true });
  })
);

forumRouter.post(
  "/articles/:id/unfollow",
  asyncHandler(async (req, res) => {
    const id = String(req.params.id || "");
    if (!Types.ObjectId.isValid(id)) return res.status(400).json({ error: "Invalid id" });

    const articleId = new Types.ObjectId(id);
    const userId = new Types.ObjectId(req.user!.id);

    const del = await ForumFollowModel.deleteOne({ articleId, userId });
    if (del.deletedCount) {
      await ForumArticleModel.updateOne({ _id: articleId }, { $inc: { followerCount: -1 } });
    }
    return res.json({ ok: true });
  })
);

const CreateCommentSchema = z.object({
  body: z.string().trim().min(1).max(5000),
  attachments: z.array(AttachmentInputSchema).max(4).optional(),
});

forumRouter.post(
  "/articles/:id/comments",
  asyncHandler(async (req, res) => {
    const id = String(req.params.id || "");
    if (!Types.ObjectId.isValid(id)) return res.status(400).json({ error: "Invalid id" });
    const parsed = CreateCommentSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Invalid input", details: parsed.error.flatten() });

    const articleId = new Types.ObjectId(id);
    const userId = new Types.ObjectId(req.user!.id);

    const article = await ForumArticleModel.findById(articleId).lean();
    if (!article || String((article as any).status) !== "approved") return res.status(404).json({ error: "Not found" });

    const comment = await ForumCommentModel.create({
      articleId,
      authorUserId: userId,
      body: parsed.data.body,
    });

    if (parsed.data.attachments?.length) {
      await ForumAttachmentModel.insertMany(
        parsed.data.attachments.map((a) => ({
          parentType: "comment",
          parentId: comment._id,
          uploaderUserId: userId,
          status: "pending",
          provider: "cloudinary",
          cloudinary: {
            publicId: a.publicId,
            assetId: a.assetId ?? "",
            resourceType: a.resourceType ?? "image",
            deliveryType: a.deliveryType ?? "authenticated",
            format: a.format ?? "",
            bytes: a.bytes ?? 0,
            width: a.width ?? 0,
            height: a.height ?? 0,
            originalFilename: a.originalFilename ?? "",
          },
        }))
      );
    }
    await ForumArticleModel.updateOne({ _id: articleId }, { $inc: { commentCount: 1 } });

    // Notify followers + author (excluding commenter)
    const followers = await ForumFollowModel.find({ articleId }).select("userId").lean();
    const recipientIds = new Set<string>();
    for (const f of followers as any[]) recipientIds.add(String(f.userId));
    const authorId = String((article as any).authorUserId || "");
    if (authorId) recipientIds.add(authorId);
    recipientIds.delete(String(userId));

    if (recipientIds.size) {
      await ForumNotificationModel.insertMany(
        Array.from(recipientIds).map((rid) => ({
          userId: new Types.ObjectId(rid),
          type: "comment_on_followed_article",
          articleId,
          commentId: comment._id,
        }))
      );
    }

    return res.status(201).json({
      comment: {
        id: String(comment._id),
        body: String(comment.body),
        createdAt: comment.createdAt,
      },
    });
  })
);

const UploadSignSchema = z.object({
  resourceType: z.enum(["image", "video", "raw"]).default("image"),
});

// Cloudinary signed uploads (frontend uploads directly to Cloudinary)
forumRouter.post(
  "/uploads/sign",
  asyncHandler(async (req, res) => {
    const parsed = UploadSignSchema.safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json({ error: "Invalid input", details: parsed.error.flatten() });

    const cloudName = (env.CLOUDINARY_CLOUD_NAME || "").trim();
    const apiKey = (env.CLOUDINARY_API_KEY || "").trim();
    if (!cloudName || !apiKey) return res.status(500).json({ error: "Cloudinary not configured" });

    const resourceType = parsed.data.resourceType;
    const timestamp = Math.floor(Date.now() / 1000);
    const folder = "mars_forum";
    const type = "authenticated";

    const cld = getCloudinary();
    const signature = cld.utils.api_sign_request({ timestamp, folder, type }, (env.CLOUDINARY_API_SECRET || "").trim());

    return res.json({
      cloudName,
      apiKey,
      timestamp,
      folder,
      type,
      resourceType,
      signature,
      uploadUrl: `https://api.cloudinary.com/v1_1/${cloudName}/${resourceType}/upload`,
    });
  })
);

// Resolve a signed delivery URL for an attachment
forumRouter.get(
  "/attachments/:id/url",
  asyncHandler(async (req, res) => {
    const id = String(req.params.id || "");
    if (!Types.ObjectId.isValid(id)) return res.status(400).json({ error: "Invalid id" });

    const attachment = await ForumAttachmentModel.findById(new Types.ObjectId(id)).lean();
    if (!attachment) return res.status(404).json({ error: "Not found" });

    const isAdmin = req.user!.role === "admin";

    if (!isAdmin) {
      if (String((attachment as any).status) !== "approved") return res.status(404).json({ error: "Not found" });

      const parentType = String((attachment as any).parentType || "");
      const parentId = (attachment as any).parentId;

      if (parentType === "article") {
        const article = await ForumArticleModel.findById(parentId).lean();
        if (!article || String((article as any).status) !== "approved") return res.status(404).json({ error: "Not found" });
      } else if (parentType === "comment") {
        const comment = await ForumCommentModel.findById(parentId).select("articleId").lean();
        if (!comment) return res.status(404).json({ error: "Not found" });
        const article = await ForumArticleModel.findById((comment as any).articleId).lean();
        if (!article || String((article as any).status) !== "approved") return res.status(404).json({ error: "Not found" });
      } else {
        return res.status(404).json({ error: "Not found" });
      }
    }

    const publicId = String((attachment as any)?.cloudinary?.publicId || "");
    if (!publicId) return res.status(404).json({ error: "Not found" });

    const resourceType = String((attachment as any)?.cloudinary?.resourceType || "image");
    const deliveryType = String((attachment as any)?.cloudinary?.deliveryType || "authenticated");

    const cld = getCloudinary();
    const expiresAt = Math.floor(Date.now() / 1000) + 10 * 60;
    const url = cld.url(publicId, {
      secure: true,
      resource_type: resourceType as any,
      type: deliveryType as any,
      sign_url: true,
      expires_at: expiresAt as any,
    });

    return res.json({ url, expiresAt });
  })
);


// React to an article (like/dislike)
const ReactSchema = z.object({
  type: z.enum(["like", "dislike"]),
});

forumRouter.post(
  "/articles/:id/react",
  asyncHandler(async (req, res) => {
    const id = String(req.params.id || "");
    if (!Types.ObjectId.isValid(id)) return res.status(400).json({ error: "Invalid id" });

    const parsed = ReactSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Invalid input", details: parsed.error.flatten() });

    const articleId = new Types.ObjectId(id);
    const userId = new Types.ObjectId(req.user!.id);
    const { type } = parsed.data;

    const article = await ForumArticleModel.findById(articleId).lean();
    if (!article || String((article as any).status) !== "approved") return res.status(404).json({ error: "Not found" });

    // Check if user already reacted
    const existingReaction = await ForumArticleReactionModel.findOne({ articleId, userId }).lean();

    if (existingReaction) {
      const oldType = String((existingReaction as any).type);
      if (oldType === type) {
        // Remove reaction if clicking the same type
        await ForumArticleReactionModel.deleteOne({ articleId, userId });
        await ForumArticleModel.updateOne(
          { _id: articleId },
          { $inc: { [type === "like" ? "likeCount" : "dislikeCount"]: -1 } }
        );
        return res.json({ ok: true, action: "removed" });
      } else {
        // Change reaction type
        await ForumArticleReactionModel.updateOne({ articleId, userId }, { $set: { type } });
        await ForumArticleModel.updateOne(
          { _id: articleId },
          {
            $inc: {
              [oldType === "like" ? "likeCount" : "dislikeCount"]: -1,
              [type === "like" ? "likeCount" : "dislikeCount"]: 1,
            },
          }
        );
        return res.json({ ok: true, action: "changed" });
      }
    } else {
      // Add new reaction
      await ForumArticleReactionModel.create({ articleId, userId, type });
      await ForumArticleModel.updateOne(
        { _id: articleId },
        { $inc: { [type === "like" ? "likeCount" : "dislikeCount"]: 1 } }
      );
      return res.json({ ok: true, action: "added" });
    }
  })
);
