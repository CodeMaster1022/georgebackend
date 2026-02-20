import { Router } from "express";
import { z } from "zod";
import { Types } from "mongoose";

import { requireAuth, requireRole } from "../middleware/auth";
import { asyncHandler } from "../utils/asyncHandler";
import { StudentProfileModel } from "../models/StudentProfile";
import { BookingModel } from "../models/Booking";
import { ClassReportModel } from "../models/ClassReport";
import { LessonRatingModel } from "../models/LessonRating";

export const studentRouter = Router();

studentRouter.use(requireAuth, requireRole("student"));

async function ensureStudentProfileId(userId: string, email: string) {
  const existing = await StudentProfileModel.findOne({ userId }).select("_id").lean();
  if (existing && typeof existing === "object" && "_id" in existing && existing._id) return String(existing._id);

  // Create profile if it doesn't exist
  try {
    const created = await StudentProfileModel.create({
      userId: new Types.ObjectId(userId),
      nickname: String(email || "").split("@")[0] || "Student",
    });
    return String(created._id);
  } catch {
    const again = await StudentProfileModel.findOne({ userId }).select("_id").lean();
    if (again && typeof again === "object" && !Array.isArray(again) && "_id" in again && again._id) {
      return String((again as { _id: unknown })._id);
    }
    return null;
  }
}

// Get student profile (with stats: lessonsCompleted, feedbackGiven, rating from teachers)
studentRouter.get(
  "/profile",
  asyncHandler(async (req, res) => {
    await ensureStudentProfileId(req.user!.id, req.user!.email);
    const profile = await StudentProfileModel.findOne({ userId: req.user!.id }).lean();
    if (!profile) return res.status(404).json({ error: "Student profile not found" });
    const userId = new Types.ObjectId(req.user!.id);
    const [lessonsCompleted, feedbackGiven, ratingAgg] = await Promise.all([
      BookingModel.countDocuments({ studentUserId: userId, status: "completed" }),
      LessonRatingModel.countDocuments({ fromUserId: userId, fromRole: "student" }),
      LessonRatingModel.aggregate([
        { $match: { studentUserId: userId, fromRole: "teacher" } },
        { $group: { _id: null, avg: { $avg: "$rating" }, count: { $sum: 1 } } },
      ]),
    ]);
    const ratingAvg = ratingAgg[0]?.avg != null ? Math.round(Number(ratingAgg[0].avg) * 100) / 100 : 0;
    const ratingCount = ratingAgg[0]?.count ?? 0;
    const out = {
      ...profile,
      stats: { lessonsCompleted, feedbackGiven, ratingAvg, ratingCount },
    };
    return res.json({ profile: out });
  })
);

const StudentProfileUpdateSchema = z.object({
  nickname: z.string().trim().max(120).optional(),
  birthdate: z.string().trim().max(20).optional(),
  spanishLevel: z.string().trim().max(80).optional(),
  canRead: z.enum(["Yes", "No", ""]).optional(),
  homeschoolFunding: z.enum(["Yes", "No", ""]).optional(),
  questionnaire: z.string().trim().max(5000).optional(),
  photoUrl: z.string().trim().max(2000).optional(),
  parentContact: z
    .object({
      name: z.string().trim().max(200).optional(),
      phone: z.string().trim().max(80).optional(),
    })
    .optional(),
});

// Update student profile
studentRouter.put(
  "/profile",
  asyncHandler(async (req, res) => {
    const parsed = StudentProfileUpdateSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Invalid input", details: parsed.error.flatten() });

    await ensureStudentProfileId(req.user!.id, req.user!.email);
    const profile = await StudentProfileModel.findOneAndUpdate(
      { userId: req.user!.id },
      { $set: parsed.data },
      { new: true }
    ).lean();
    if (!profile) return res.status(404).json({ error: "Student profile not found" });
    return res.json({ profile });
  })
);

// Get class report for a booking (only if booking belongs to current student)
studentRouter.get(
  "/reports",
  asyncHandler(async (req, res) => {
    const bookingId = typeof req.query.bookingId === "string" ? req.query.bookingId.trim() : "";
    if (!bookingId || !Types.ObjectId.isValid(bookingId)) {
      return res.status(400).json({ error: "Invalid bookingId" });
    }
    const studentUserId = req.user!.id;
    const booking = await BookingModel.findOne({
      _id: new Types.ObjectId(bookingId),
      studentUserId: new Types.ObjectId(studentUserId),
    })
      .select("_id")
      .lean();
    if (!booking) return res.status(404).json({ error: "Booking not found" });
    const reportRaw = await ClassReportModel.findOne({ bookingId: new Types.ObjectId(bookingId) }).lean();
    const report = reportRaw as { _id: Types.ObjectId; summary?: string; homework?: string; strengths?: string; updatedAt?: Date } | null;
    return res.json({
      report: report
        ? {
            id: String(report._id),
            summary: report.summary ?? "",
            homework: report.homework ?? "",
            strengths: report.strengths ?? "",
            updatedAt: report.updatedAt,
          }
        : null,
    });
  })
);
