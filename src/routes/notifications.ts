import { Router } from "express";
import { Types } from "mongoose";

import { requireAuth, requireRole } from "../middleware/auth";
import { asyncHandler } from "../utils/asyncHandler";
import { TeachingNotificationModel } from "../models/TeachingNotification";

export const notificationsRouter = Router();

notificationsRouter.use(requireAuth, requireRole("student", "teacher"));

notificationsRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const userId = new Types.ObjectId(req.user!.id);
    const rows = await TeachingNotificationModel.find({
      userId,
      $or: [{ readAt: null }, { readAt: { $exists: false } }],
    })
      .sort({ createdAt: -1 })
      .limit(100)
      .lean();
    return res.json({
      notifications: rows.map((n: any) => ({
        id: String(n._id),
        type: String(n.type || ""),
        readAt: n.readAt ?? null,
        createdAt: n.createdAt,
        payload: n.payload ?? {},
      })),
    });
  })
);

notificationsRouter.patch(
  "/read-all",
  asyncHandler(async (req, res) => {
    const userId = new Types.ObjectId(req.user!.id);
    await TeachingNotificationModel.updateMany(
      { userId, $or: [{ readAt: null }, { readAt: { $exists: false } }] },
      { $set: { readAt: new Date() } }
    );
    return res.json({ ok: true });
  })
);

notificationsRouter.patch(
  "/:id/read",
  asyncHandler(async (req, res) => {
    const userId = new Types.ObjectId(req.user!.id);
    const id = String(req.params.id || "");
    if (!Types.ObjectId.isValid(id)) return res.status(400).json({ error: "Invalid id" });

    await TeachingNotificationModel.updateOne(
      { _id: new Types.ObjectId(id), userId },
      { $set: { readAt: new Date() } }
    );
    return res.json({ ok: true });
  })
);
