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
import { UserModel } from "../models/User";
import { decryptString } from "../utils/crypto";
import { env } from "../config/env";

export const teacherRouter = Router();

teacherRouter.use(requireAuth, requireRole("teacher"));

async function ensureTeacherProfileId(userId: string, email: string) {
  const existing = await TeacherProfileModel.findOne({ userId }).select("_id").lean();
  if (existing?._id) return String(existing._id);

  // Backward-compat / recovery: if a teacher user exists without a profile, create it.
  try {
    const created = await TeacherProfileModel.create({
      userId: new Types.ObjectId(userId),
      name: String(email || "").split("@")[0] || "Teacher",
    });
    return String(created._id);
  } catch {
    const again = await TeacherProfileModel.findOne({ userId }).select("_id").lean();
    return again?._id ? String(again._id) : null;
  }
}

// -----------------------
// Profile
// -----------------------
teacherRouter.get(
  "/profile",
  asyncHandler(async (req, res) => {
    await ensureTeacherProfileId(req.user!.id, req.user!.email);
    const profile = await TeacherProfileModel.findOne({ userId: req.user!.id }).lean();
    if (!profile) return res.status(404).json({ error: "Teacher profile not found" });
    return res.json({ profile });
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

    const rows = bookings.map((b: any) => ({
      id: String(b._id),
      status: b.status,
      priceCredits: b.priceCredits,
      bookedAt: b.bookedAt,
      studentUserId: String(b.studentUserId),
      studentNickname: nicknameByUserId.get(String(b.studentUserId)) || "",
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

    const booking = await BookingModel.findOne({ _id: parsed.data.bookingId, teacherId }).lean();
    if (!booking) return res.status(404).json({ error: "Booking not found" });

    const now = new Date();
    const report = await ClassReportModel.findOneAndUpdate(
      { bookingId: booking._id },
      {
        $set: {
          teacherId: new Types.ObjectId(teacherId),
          studentUserId: booking.studentUserId,
          summary: parsed.data.summary ?? "",
          homework: parsed.data.homework ?? "",
          strengths: parsed.data.strengths ?? "",
          updatedAt: now,
        },
        $setOnInsert: { createdAt: now, bookingId: booking._id },
      },
      { upsert: true, new: true }
    ).lean();

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

    const booking = await BookingModel.findOne({ _id: bookingId, teacherId }).select("_id").lean();
    if (!booking) return res.status(404).json({ error: "Booking not found" });

    const report = await ClassReportModel.findOne({ bookingId: booking._id }).lean();
    return res.json({ report: report ?? null });
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

