import { Router } from "express";
import { z } from "zod";
import { ClassSessionModel } from "../models/ClassSession";
import { asyncHandler } from "../utils/asyncHandler";

export const sessionsRouter = Router();

const QuerySchema = z.object({
  teacherId: z.string().optional(),
  status: z.enum(["open", "booked", "cancelled"]).optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
});

sessionsRouter.get("/", asyncHandler(async (req, res) => {
  const parsed = QuerySchema.safeParse(req.query);
  if (!parsed.success) return res.status(400).json({ error: "Invalid query", details: parsed.error.flatten() });

  const { teacherId, status, from, to } = parsed.data;

  const q: any = {};
  if (teacherId) q.teacherId = teacherId;
  if (status) q.status = status;
  if (from || to) {
    q.startAt = {};
    if (from) q.startAt.$gte = new Date(from);
    if (to) q.startAt.$lte = new Date(to);
  }

  const sessions = await ClassSessionModel.find(q)
    .sort({ startAt: 1 })
    .select("teacherId startAt endAt status priceCredits meetingLink")
    .lean();

  res.json({ sessions });
}));

