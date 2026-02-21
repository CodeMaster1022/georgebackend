import { Router } from "express";
import { z } from "zod";
import { Types } from "mongoose";
import { google } from "googleapis";

import { requireAuth, requireRole } from "../middleware/auth";
import { asyncHandler } from "../utils/asyncHandler";
import { TeacherProfileModel } from "../models/TeacherProfile";
import { TeacherAvailabilityModel } from "../models/TeacherAvailability";
import { ClassSessionModel } from "../models/ClassSession";
import { BookingModel } from "../models/Booking";
import { StudentProfileModel } from "../models/StudentProfile";
import { ClassReportModel } from "../models/ClassReport";
import { LessonRatingModel } from "../models/LessonRating";
import { UserModel } from "../models/User";
import { decryptString } from "../utils/crypto";
import { env } from "../config/env";
import { persistAndNotify } from "../ws/emit";

export const teacherRouter = Router();

teacherRouter.use(requireAuth, requireRole("teacher"));

async function ensureTeacherProfileId(userId: string, email: string) {
  const existing = await TeacherProfileModel.findOne({ userId }).select("_id").lean();
  // Fix for _id maybe absent on array types due to TS inference/lint: ensure not an array
  if (existing && typeof existing === "object" && "_id" in existing && existing._id) return String(existing._id);

  // Backward-compat / recovery: if a teacher user exists without a profile, create it.
  try {
    const created = await TeacherProfileModel.create({
      userId: new Types.ObjectId(userId),
      name: String(email || "").split("@")[0] || "Teacher",
    });
    return String(created._id);
  } catch {
    const again = await TeacherProfileModel.findOne({ userId }).select("_id").lean();
    if (
      again &&
      typeof again === "object" &&
      !Array.isArray(again) &&
      "_id" in again &&
      again._id
    ) {
      return String((again as { _id: unknown })._id);
    }
    return null;
  }
}
// Profile
// -----------------------
teacherRouter.get(
  "/profile",
  asyncHandler(async (req, res) => {
    const teacherId = await ensureTeacherProfileId(req.user!.id, req.user!.email);
    if (!teacherId) return res.status(404).json({ error: "Teacher profile not found" });
    const profile = await TeacherProfileModel.findOne({ userId: req.user!.id }).lean();
    if (!profile) return res.status(404).json({ error: "Teacher profile not found" });
    const lessonsCompleted = await BookingModel.countDocuments({
      teacherId: new Types.ObjectId(teacherId),
      status: "completed",
    });
    const out = { ...profile, stats: { ...(profile as any).stats, lessonsCompleted } };
    return res.json({ profile: out });
  })
);

const TeacherProfileUpdateSchema = z.object({
  name: z.string().trim().max(120).optional(),
  bio: z.string().trim().max(5000).optional(),
  timezone: z.string().trim().max(80).optional(),
  country: z.string().trim().max(80).optional(),
  photoUrl: z.string().trim().max(2000).optional(),
  phone: z.string().trim().max(80).optional(),
  address: z.string().trim().max(500).optional(),
  resumeUrl: z.string().trim().max(2000).optional(),
  social: z
    .object({
      linkedin: z.string().trim().max(2000).optional(),
      facebook: z.string().trim().max(2000).optional(),
      instagram: z.string().trim().max(2000).optional(),
      whatsapp: z.string().trim().max(2000).optional(),
    })
    .optional(),
});

teacherRouter.put(
  "/profile",
  asyncHandler(async (req, res) => {
    const parsed = TeacherProfileUpdateSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Invalid input", details: parsed.error.flatten() });

    await ensureTeacherProfileId(req.user!.id, req.user!.email);
    const profile = await TeacherProfileModel.findOneAndUpdate(
      { userId: req.user!.id },
      { $set: parsed.data },
      { new: true }
    ).lean();
    if (!profile) return res.status(404).json({ error: "Teacher profile not found" });
    return res.json({ profile });
  })
);

// -----------------------
// Availability
// -----------------------
teacherRouter.get(
  "/availability",
  asyncHandler(async (req, res) => {
    const teacherId = await ensureTeacherProfileId(req.user!.id, req.user!.email);
    if (!teacherId) return res.status(404).json({ error: "Teacher profile not found" });

    const items = await TeacherAvailabilityModel.find({ teacherId }).sort({ createdAt: -1 }).lean();
    return res.json({ availability: items });
  })
);

const AvailabilityCreateSchema = z
  .object({
    type: z.enum(["weekly", "override"]),
    // weekly
    weekday: z.number().int().min(0).max(6).optional(),
    startTime: z.string().regex(/^\d{2}:\d{2}$/).optional(),
    endTime: z.string().regex(/^\d{2}:\d{2}$/).optional(),
    timezone: z.string().optional(),
    // override
    startAt: z.string().datetime().optional(),
    endAt: z.string().datetime().optional(),
    status: z.enum(["available", "blocked"]).optional(),
  })
  .superRefine((v, ctx) => {
    if (v.type === "weekly") {
      if (v.weekday === undefined || !v.startTime || !v.endTime) {
        ctx.addIssue({ code: "custom", message: "weekly requires weekday, startTime, endTime" });
      }
    }
    if (v.type === "override") {
      if (!v.startAt || !v.endAt) ctx.addIssue({ code: "custom", message: "override requires startAt, endAt" });
    }
  });

teacherRouter.post(
  "/availability",
  asyncHandler(async (req, res) => {
    const parsed = AvailabilityCreateSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Invalid input", details: parsed.error.flatten() });

    const teacherId = await ensureTeacherProfileId(req.user!.id, req.user!.email);
    if (!teacherId) return res.status(404).json({ error: "Teacher profile not found" });

    const data: any = { ...parsed.data, teacherId: new Types.ObjectId(teacherId) };
    if (data.startAt) data.startAt = new Date(data.startAt);
    if (data.endAt) data.endAt = new Date(data.endAt);

    const item = await TeacherAvailabilityModel.create(data);
    return res.status(201).json({ availability: item });
  })
);

teacherRouter.delete(
  "/availability/:id",
  asyncHandler(async (req, res) => {
    const teacherId = await ensureTeacherProfileId(req.user!.id, req.user!.email);
    if (!teacherId) return res.status(404).json({ error: "Teacher profile not found" });

    const id = req.params.id;
    if (!Types.ObjectId.isValid(id)) return res.status(400).json({ error: "Invalid id" });

    await TeacherAvailabilityModel.deleteOne({ _id: id, teacherId });
    return res.json({ ok: true });
  })
);

// -----------------------
// Sessions
// -----------------------
teacherRouter.get(
  "/sessions",
  asyncHandler(async (req, res) => {
    const teacherId = await ensureTeacherProfileId(req.user!.id, req.user!.email);
    if (!teacherId) return res.status(404).json({ error: "Teacher profile not found" });

    const status = typeof req.query.status === "string" ? req.query.status : undefined;
    const from = typeof req.query.from === "string" ? new Date(req.query.from) : undefined;
    const to = typeof req.query.to === "string" ? new Date(req.query.to) : undefined;

    const q: any = { teacherId };
    if (status) q.status = status;
    if (from || to) {
      q.startAt = {};
      if (from) q.startAt.$gte = from;
      if (to) q.startAt.$lte = to;
    }

    const sessions = await ClassSessionModel.find(q).sort({ startAt: 1 }).lean();
    return res.json({ sessions });
  })
);

const SessionCreateSchema = z.object({
  startAt: z.string().datetime(),
  endAt: z.string().datetime(),
  priceCredits: z.number().int().min(1).default(1),
  meetingLink: z.string().trim().max(2000).optional(),
});

teacherRouter.post(
  "/sessions",
  asyncHandler(async (req, res) => {
    const parsed = SessionCreateSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Invalid input", details: parsed.error.flatten() });

    const teacherId = await ensureTeacherProfileId(req.user!.id, req.user!.email);
    if (!teacherId) return res.status(404).json({ error: "Teacher profile not found" });

    const doc = await ClassSessionModel.create({
      teacherId,
      startAt: new Date(parsed.data.startAt),
      endAt: new Date(parsed.data.endAt),
      priceCredits: parsed.data.priceCredits,
      meetingLink: parsed.data.meetingLink ?? "",
      status: "open",
    });

    return res.status(201).json({ session: doc });
  })
);

const SessionPatchSchema = z.object({
  meetingLink: z.string().trim().max(2000).optional(),
  status: z.enum(["open", "cancelled"]).optional(),
  priceCredits: z.number().int().min(1).optional(),
});

teacherRouter.patch(
  "/sessions/:id",
  asyncHandler(async (req, res) => {
    const teacherId = await ensureTeacherProfileId(req.user!.id, req.user!.email);
    if (!teacherId) return res.status(404).json({ error: "Teacher profile not found" });

    const id = req.params.id;
    if (!Types.ObjectId.isValid(id)) return res.status(400).json({ error: "Invalid session id" });

    const parsed = SessionPatchSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Invalid input", details: parsed.error.flatten() });

    const session = await ClassSessionModel.findOneAndUpdate(
      { _id: id, teacherId },
      { $set: parsed.data },
      { new: true }
    ).lean();

    if (!session) return res.status(404).json({ error: "Session not found" });
    if (parsed.data.status === "cancelled") {
      const bookings = await BookingModel.find({ sessionId: id, status: "booked" }).select("studentUserId").lean();
      const studentUserIds = bookings.map((b: any) => String(b.studentUserId)).filter(Boolean);
      if (studentUserIds.length) {
        await persistAndNotify(studentUserIds, "session_cancelled", { sessionId: id });
      }
    }
    return res.json({ session });
  })
);

const GenerateSchema = z.object({
  from: z.string().datetime(),
  to: z.string().datetime(),
  priceCredits: z.number().int().min(1).default(1),
});

function hmToMinutes(hm: string) {
  const [h, m] = hm.split(":").map((x) => Number(x));
  return h * 60 + m;
}

teacherRouter.post(
  "/sessions/generate",
  asyncHandler(async (req, res) => {
    const parsed = GenerateSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Invalid input", details: parsed.error.flatten() });

    const teacherIdStr = await ensureTeacherProfileId(req.user!.id, req.user!.email);
    if (!teacherIdStr) return res.status(404).json({ error: "Teacher profile not found" });
    const teacherId = new Types.ObjectId(teacherIdStr);

    const from = new Date(parsed.data.from);
    const to = new Date(parsed.data.to);
    const priceCredits = parsed.data.priceCredits;

    const weekly = await TeacherAvailabilityModel.find({ teacherId, type: "weekly" }).lean();
    if (!weekly.length) return res.json({ created: 0 });

    const created: any[] = [];

    // Naive slot generation (UTC). Can be upgraded to timezone-aware later.
    for (let d = new Date(from); d <= to; d = new Date(d.getTime() + 24 * 60 * 60 * 1000)) {
      const weekday = d.getUTCDay();
      const blocks = weekly.filter((w: any) => w.weekday === weekday);
      for (const b of blocks) {
        if (!b.startTime || !b.endTime) continue;
        const startMin = hmToMinutes(b.startTime);
        const endMin = hmToMinutes(b.endTime);
        for (let t = startMin; t + 25 <= endMin; t += 25) {
          const startAt = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 0, 0, 0));
          startAt.setUTCMinutes(t);
          const endAt = new Date(startAt.getTime() + 25 * 60 * 1000);
          created.push({
            teacherId,
            startAt,
            endAt,
            status: "open",
            priceCredits,
            meetingLink: "",
          });
        }
      }
    }

    if (!created.length) return res.json({ created: 0 });

    // Avoid duplicates by (teacherId,startAt)
    const ops = created.map((doc) => ({
      updateOne: {
        filter: { teacherId: doc.teacherId, startAt: doc.startAt },
        update: { $setOnInsert: doc },
        upsert: true,
      },
    }));
    const bulk = await ClassSessionModel.bulkWrite(ops, { ordered: false });
    const upserts = (bulk as any)?.upsertedCount ?? 0;
    return res.json({ created: upserts });
  })
);

// -----------------------
// Bookings (teacher view)
// -----------------------
teacherRouter.get(
  "/bookings",
  asyncHandler(async (req, res) => {
    const teacherId = await ensureTeacherProfileId(req.user!.id, req.user!.email);
    if (!teacherId) return res.status(404).json({ error: "Teacher profile not found" });

    const from = typeof req.query.from === "string" ? new Date(req.query.from) : undefined;
    const to = typeof req.query.to === "string" ? new Date(req.query.to) : undefined;
    const status = typeof req.query.status === "string" ? req.query.status : undefined;

    const q: any = { teacherId };
    if (status) q.status = status;
    if (from || to) {
      q.bookedAt = {};
      if (from) q.bookedAt.$gte = from;
      if (to) q.bookedAt.$lte = to;
    }

    const bookings = await BookingModel.find(q)
      .sort({ bookedAt: -1 })
      .populate({ path: "sessionId", select: "startAt endAt meetingLink status" })
      .lean();

    const studentIds = Array.from(new Set(bookings.map((b: any) => String(b.studentUserId))));
    const studentProfiles = await StudentProfileModel.find({ userId: { $in: studentIds } })
      .select("userId nickname")
      .lean();
    const nicknameByUserId = new Map(studentProfiles.map((p: any) => [String(p.userId), p.nickname]));

    const bookingIds = bookings.map((b: any) => b._id);
    const ratings = await LessonRatingModel.find({ bookingId: { $in: bookingIds } })
      .select("bookingId fromRole")
      .lean();
    const teacherRatedSet = new Set(
      (ratings as any[]).filter((r: any) => r.fromRole === "teacher").map((r: any) => String(r.bookingId))
    );
    const studentRatedSet = new Set(
      (ratings as any[]).filter((r: any) => r.fromRole === "student").map((r: any) => String(r.bookingId))
    );

    const rows = bookings.map((b: any) => ({
      id: String(b._id),
      status: b.status,
      priceCredits: b.priceCredits,
      bookedAt: b.bookedAt,
      studentUserId: String(b.studentUserId),
      studentNickname: nicknameByUserId.get(String(b.studentUserId)) || "",
      teacherRated: teacherRatedSet.has(String(b._id)),
      studentRated: studentRatedSet.has(String(b._id)),
      session: b.sessionId
        ? {
            id: String(b.sessionId._id),
            startAt: b.sessionId.startAt,
            endAt: b.sessionId.endAt,
            meetingLink: b.sessionId.meetingLink || "",
            status: b.sessionId.status,
          }
        : null,
      calendarEventId: b.calendarEventId || "",
    }));

    return res.json({ bookings: rows });
  })
);

// Mark booking as completed (done lesson) - teacher only
teacherRouter.post(
  "/bookings/:id/complete",
  asyncHandler(async (req, res) => {
    const teacherId = await ensureTeacherProfileId(req.user!.id, req.user!.email);
    if (!teacherId) return res.status(404).json({ error: "Teacher profile not found" });
    const id = req.params.id;
    if (!Types.ObjectId.isValid(id)) return res.status(400).json({ error: "Invalid booking id" });
    const booking = await BookingModel.findOne({ _id: id, teacherId }).lean();
    if (!booking) return res.status(404).json({ error: "Booking not found" });
    if ((booking as any).status !== "booked") {
      return res.status(400).json({ error: "Only booked lessons can be marked complete" });
    }
    await BookingModel.updateOne({ _id: id, teacherId }, { $set: { status: "completed" } });
    await persistAndNotify([String((booking as any).studentUserId)], "lesson_completed", {
      bookingId: id,
    });
    return res.json({ ok: true, bookingId: id });
  })
);

const TeacherRateStudentSchema = z.object({
  rating: z.number().int().min(1).max(5),
  comment: z.string().trim().max(1000).optional(),
});

// Teacher rates student for a completed booking
teacherRouter.post(
  "/bookings/:id/rate",
  asyncHandler(async (req, res) => {
    const teacherId = await ensureTeacherProfileId(req.user!.id, req.user!.email);
    if (!teacherId) return res.status(404).json({ error: "Teacher profile not found" });
    const id = req.params.id;
    if (!Types.ObjectId.isValid(id)) return res.status(400).json({ error: "Invalid booking id" });
    const parsed = TeacherRateStudentSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Invalid input", details: parsed.error.flatten() });
    const booking = await BookingModel.findOne({ _id: id, teacherId }).lean();
    if (!booking) return res.status(404).json({ error: "Booking not found" });
    if ((booking as any).status !== "completed") {
      return res.status(400).json({ error: "Can only rate completed lessons" });
    }
    const existing = await LessonRatingModel.findOne({ bookingId: id, fromRole: "teacher" }).lean();
    if (existing) return res.status(400).json({ error: "You already rated this lesson" });
    await LessonRatingModel.create({
      bookingId: new Types.ObjectId(id),
      teacherId: new Types.ObjectId(teacherId),
      studentUserId: (booking as any).studentUserId,
      fromRole: "teacher",
      fromUserId: new Types.ObjectId(req.user!.id),
      rating: parsed.data.rating,
      comment: parsed.data.comment ?? "",
    });
    return res.json({ ok: true });
  })
);

// -----------------------
// Reports
// -----------------------
const ReportUpsertSchema = z.object({
  bookingId: z.string().min(1),
  summary: z.string().trim().max(5000).optional(),
  homework: z.string().trim().max(5000).optional(),
  strengths: z.string().trim().max(5000).optional(),
});

teacherRouter.post(
  "/reports",
  asyncHandler(async (req, res) => {
    const parsed = ReportUpsertSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Invalid input", details: parsed.error.flatten() });
    if (!Types.ObjectId.isValid(parsed.data.bookingId)) return res.status(400).json({ error: "Invalid bookingId" });

    const teacherId = await ensureTeacherProfileId(req.user!.id, req.user!.email);
    if (!teacherId) return res.status(404).json({ error: "Teacher profile not found" });

    const bookingRaw = await BookingModel.findOne({ _id: parsed.data.bookingId, teacherId }).lean();
    if (!bookingRaw || Array.isArray(bookingRaw)) return res.status(404).json({ error: "Booking not found" });

    // Mongoose typing in this repo sometimes widens `lean()` results to `doc | doc[]`.
    // Narrow it so TS knows `studentUserId` exists on a single booking document.
    const booking = bookingRaw as { _id: Types.ObjectId; studentUserId?: unknown };

    const now = new Date();
    const report = await ClassReportModel.findOneAndUpdate(
      { bookingId: booking._id },
      {
        $set: {
          teacherId: new Types.ObjectId(teacherId),
          studentUserId: booking.studentUserId ? new Types.ObjectId(String(booking.studentUserId)) : undefined,
          summary: parsed.data.summary ?? "",
          homework: parsed.data.homework ?? "",
          strengths: parsed.data.strengths ?? "",
          updatedAt: now,
        },
        $setOnInsert: { createdAt: now, bookingId: booking._id },
      },
      { upsert: true, new: true }
    ).lean();

    const studentUserId = booking.studentUserId ? String(booking.studentUserId) : null;
    if (studentUserId && report) {
      await persistAndNotify([studentUserId], "class_report_submitted", {
        bookingId: String(booking._id),
        reportId: String((report as any)._id),
      });
    }
    return res.json({ report });
  })
);

teacherRouter.get(
  "/reports",
  asyncHandler(async (req, res) => {
    const bookingId = typeof req.query.bookingId === "string" ? req.query.bookingId : "";
    if (!Types.ObjectId.isValid(bookingId)) return res.status(400).json({ error: "Invalid bookingId" });

    const teacherId = await ensureTeacherProfileId(req.user!.id, req.user!.email);
    if (!teacherId) return res.status(404).json({ error: "Teacher profile not found" });

    const bookingRaw = await BookingModel.findOne({ _id: bookingId, teacherId }).select("_id").lean();
    if (!bookingRaw || Array.isArray(bookingRaw)) return res.status(404).json({ error: "Booking not found" });
    const bookingIdObj = (bookingRaw as { _id: Types.ObjectId })._id;

    const report = await ClassReportModel.findOne({ bookingId: bookingIdObj }).lean();
    return res.json({ report: report ?? null });
  })
);

// -----------------------
// Dashboard stats (KPIs + charts)
// -----------------------
function getWeekStart(d: Date): Date {
  const x = new Date(d);
  const day = x.getUTCDay();
  x.setUTCDate(x.getUTCDate() - day);
  x.setUTCHours(0, 0, 0, 0);
  return x;
}

teacherRouter.get(
  "/dashboard/stats",
  asyncHandler(async (req, res) => {
    const teacherId = await ensureTeacherProfileId(req.user!.id, req.user!.email);
    if (!teacherId) return res.status(404).json({ error: "Teacher profile not found" });
    const tid = new Types.ObjectId(teacherId);

    const now = new Date();
    const thisWeekStart = getWeekStart(now);
    const prevWeekStart = new Date(thisWeekStart);
    prevWeekStart.setUTCDate(prevWeekStart.getUTCDate() - 7);
    const prevWeekEnd = new Date(thisWeekStart.getTime() - 1);

    const todayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0));
    const todayEnd = new Date(todayStart.getTime() + 24 * 60 * 60 * 1000 - 1);

    const [
      thisWeekSessions,
      prevWeekSessions,
      thisWeekBookings,
      prevWeekBookings,
      todayOpen,
      todayBooked,
      revenueByDay,
      guestsByDay,
      sessionsByDay,
      completedThisWeekRes,
      completedPrevWeekRes,
    ] = await Promise.all([
      ClassSessionModel.countDocuments({
        teacherId: tid,
        startAt: { $gte: thisWeekStart, $lte: now },
      }),
      ClassSessionModel.countDocuments({
        teacherId: tid,
        startAt: { $gte: prevWeekStart, $lte: prevWeekEnd },
      }),
      BookingModel.countDocuments({
        teacherId: tid,
        bookedAt: { $gte: thisWeekStart, $lte: now },
      }),
      BookingModel.countDocuments({
        teacherId: tid,
        bookedAt: { $gte: prevWeekStart, $lte: prevWeekEnd },
      }),
      ClassSessionModel.countDocuments({
        teacherId: tid,
        startAt: { $gte: todayStart, $lte: todayEnd },
        status: "open",
      }),
      ClassSessionModel.countDocuments({
        teacherId: tid,
        startAt: { $gte: todayStart, $lte: todayEnd },
        status: "booked",
      }),
      BookingModel.aggregate([
        { $match: { teacherId: tid, status: "completed" } },
        { $lookup: { from: "classsessions", localField: "sessionId", foreignField: "_id", as: "s" } },
        { $unwind: "$s" },
        {
          $group: {
            _id: { $dateToString: { format: "%Y-%m-%d", date: "$s.startAt" } },
            revenue: { $sum: "$priceCredits" },
          },
        },
        { $sort: { _id: 1 } },
      ]),
      BookingModel.aggregate([
        { $match: { teacherId: tid } },
        { $lookup: { from: "classsessions", localField: "sessionId", foreignField: "_id", as: "s" } },
        { $unwind: "$s" },
        {
          $group: {
            _id: { $dateToString: { format: "%Y-%m-%d", date: "$s.startAt" } },
            guests: { $sum: 1 },
          },
        },
        { $sort: { _id: 1 } },
      ]),
      ClassSessionModel.aggregate([
        { $match: { teacherId: tid } },
        {
          $group: {
            _id: { $dateToString: { format: "%Y-%m-%d", date: "$startAt" } },
            open: { $sum: { $cond: [{ $eq: ["$status", "open"] }, 1, 0] } },
            booked: { $sum: { $cond: [{ $eq: ["$status", "booked"] }, 1, 0] } },
          },
        },
        { $sort: { _id: 1 } },
      ]),
      BookingModel.aggregate([
        { $match: { teacherId: tid, status: "completed" } },
        { $lookup: { from: "classsessions", localField: "sessionId", foreignField: "_id", as: "s" } },
        { $unwind: "$s" },
        { $match: { "s.startAt": { $gte: thisWeekStart, $lte: now } } },
        { $count: "n" },
      ]),
      BookingModel.aggregate([
        { $match: { teacherId: tid, status: "completed" } },
        { $lookup: { from: "classsessions", localField: "sessionId", foreignField: "_id", as: "s" } },
        { $unwind: "$s" },
        { $match: { "s.startAt": { $gte: prevWeekStart, $lte: prevWeekEnd } } },
        { $count: "n" },
      ]),
    ]);

    const thisWeekCompletedCount = (completedThisWeekRes[0] as { n: number } | undefined)?.n ?? 0;
    const prevWeekCompletedCount = (completedPrevWeekRes[0] as { n: number } | undefined)?.n ?? 0;

    const sessionsTodayBooked = await ClassSessionModel.find({
      teacherId: tid,
      startAt: { $gte: todayStart, $lte: todayEnd },
      status: "booked",
    })
      .select("_id")
      .lean();
    const todayGuests = await BookingModel.countDocuments({
      sessionId: { $in: sessionsTodayBooked.map((s: any) => s._id) },
    });

    const totalRevenueThisWeek = await BookingModel.aggregate([
      { $match: { teacherId: tid, status: "completed" } },
      { $lookup: { from: "classsessions", localField: "sessionId", foreignField: "_id", as: "s" } },
      { $unwind: "$s" },
      { $match: { "s.startAt": { $gte: thisWeekStart, $lte: now } } },
      { $group: { _id: null, total: { $sum: "$priceCredits" } } },
    ]);
    const totalRevenue = (totalRevenueThisWeek[0] as { total: number } | undefined)?.total ?? 0;

    const dayLabels = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    const completedByDay = await BookingModel.aggregate([
      { $match: { teacherId: tid, status: "completed" } },
      { $lookup: { from: "classsessions", localField: "sessionId", foreignField: "_id", as: "s" } },
      { $unwind: "$s" },
      {
        $group: {
          _id: { $dateToString: { format: "%Y-%m-%d", date: "$s.startAt" } },
          count: { $sum: 1 },
        },
      },
    ]);
    const completedMap = new Map((completedByDay as { _id: string; count: number }[]).map((c) => [c._id, c.count]));
    const chartDays: { day: string; date: string; revenue: number; guests: number; open: number; booked: number; completed: number }[] = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(thisWeekStart);
      d.setUTCDate(d.getUTCDate() + i);
      const dateStr = d.toISOString().slice(0, 10);
      const dayName = dayLabels[d.getUTCDay()];
      const revRow = (revenueByDay as { _id: string; revenue: number }[]).find((r) => r._id === dateStr);
      const guestRow = (guestsByDay as { _id: string; guests: number }[]).find((g) => g._id === dateStr);
      const sessRow = (sessionsByDay as { _id: string; open: number; booked: number }[]).find((s) => s._id === dateStr);
      chartDays.push({
        day: dayName,
        date: dateStr,
        revenue: revRow?.revenue ?? 0,
        guests: guestRow?.guests ?? 0,
        open: sessRow?.open ?? 0,
        booked: sessRow?.booked ?? 0,
        completed: completedMap.get(dateStr) ?? 0,
      });
    }

    return res.json({
      thisWeek: {
        sessions: thisWeekSessions,
        bookings: thisWeekBookings,
        completed: thisWeekCompletedCount,
      },
      previousWeek: {
        sessions: prevWeekSessions,
        bookings: prevWeekBookings,
        completed: prevWeekCompletedCount,
      },
      today: {
        slotsAvailable: todayOpen,
        slotsBooked: todayBooked,
        guests: todayGuests,
      },
      totalRevenueCredits: totalRevenue,
      chartData: chartDays,
    });
  })
);

// -----------------------
// Earnings (basic)
// -----------------------
teacherRouter.get(
  "/earnings/summary",
  asyncHandler(async (req, res) => {
    const teacherId = await ensureTeacherProfileId(req.user!.id, req.user!.email);
    if (!teacherId) return res.status(404).json({ error: "Teacher profile not found" });

    const agg = await BookingModel.aggregate([
      { $match: { teacherId: new Types.ObjectId(teacherId) } },
      {
        $group: {
          _id: "$status",
          count: { $sum: 1 },
          totalCredits: { $sum: "$priceCredits" },
        },
      },
    ]);

    const byStatus: any = {};
    for (const row of agg) byStatus[row._id] = { count: row.count, totalCredits: row.totalCredits };

    return res.json({ byStatus });
  })
);

// -----------------------
// Calendar sync (creates events for booked sessions)
// -----------------------
teacherRouter.post(
  "/google-calendar/sync",
  asyncHandler(async (req, res) => {
    if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET || !env.GOOGLE_REDIRECT_URI) {
      return res.status(501).json({ error: "Google OAuth is not configured on the backend." });
    }

    const teacherIdStr = await ensureTeacherProfileId(req.user!.id, req.user!.email);
    if (!teacherIdStr) return res.status(404).json({ error: "Teacher profile not found" });
    const teacherId = new Types.ObjectId(teacherIdStr);

    const user = await UserModel.findById(req.user!.id).select("integrations.googleCalendar").lean();
    const gc = (user as any)?.integrations?.googleCalendar;
    if (!gc?.connected || !gc?.refreshTokenEncrypted) {
      return res.status(400).json({ error: "Google Calendar is not connected." });
    }

    const refreshToken = decryptString(gc.refreshTokenEncrypted);
    const oauth2 = new google.auth.OAuth2(env.GOOGLE_CLIENT_ID, env.GOOGLE_CLIENT_SECRET, env.GOOGLE_REDIRECT_URI);
    oauth2.setCredentials({ refresh_token: refreshToken });
    const calendar = google.calendar({ version: "v3", auth: oauth2 });
    const calendarId = gc.calendarId || "primary";

    const now = new Date();
    const bookings = await BookingModel.find({
      teacherId,
      status: "booked",
      calendarEventId: "",
    })
      .populate({ path: "sessionId", select: "startAt endAt meetingLink" })
      .sort({ bookedAt: -1 })
      .limit(50)
      .lean();

    let created = 0;
    for (const b of bookings as any[]) {
      const s = b.sessionId;
      if (!s?.startAt || !s?.endAt) continue;
      if (new Date(s.endAt).getTime() < now.getTime()) continue;

      const event = await calendar.events.insert({
        calendarId,
        requestBody: {
          summary: "Kids' Club Class",
          description: s.meetingLink ? `Join: ${s.meetingLink}` : undefined,
          start: { dateTime: new Date(s.startAt).toISOString() },
          end: { dateTime: new Date(s.endAt).toISOString() },
        },
      });

      const eventId = event.data.id || "";
      if (eventId) {
        await BookingModel.updateOne({ _id: b._id }, { $set: { calendarEventId: eventId } });
        created += 1;
      }
    }

    return res.json({ created });
  })
);

