import { Router } from "express";
import mongoose, { Types } from "mongoose";
import { z } from "zod";

import { requireAuth, requireRole } from "../middleware/auth";
import { ClassSessionModel } from "../models/ClassSession";
import { BookingModel } from "../models/Booking";
import { CreditTransactionModel } from "../models/CreditTransaction";
import { asyncHandler } from "../utils/asyncHandler";
import { TeacherProfileModel } from "../models/TeacherProfile";
import { StudentProfileModel } from "../models/StudentProfile";
import { LessonRatingModel } from "../models/LessonRating";
import { env } from "../config/env";
import { BbbClient } from "../bbb/client";
import { persistAndNotify, resolveTeacherUserId } from "../ws/emit";
import { deriveMeetingPasswords } from "../bbb/meetingPasswords";

export const bookingsRouter = Router();

bookingsRouter.use(requireAuth, requireRole("student"));

function normalizeBbbBaseUrl(raw: string): string {
  let base = raw.trim().replace(/\/+$/, "");
  if (base.toLowerCase().endsWith("/api")) base = base.slice(0, -4);
  return base;
}

function publicBackendBaseUrl(req: any): string {
  const fromEnv = (env.PUBLIC_BACKEND_URL || "").trim().replace(/\/+$/, "");
  if (fromEnv) return fromEnv;
  const proto = (req.headers["x-forwarded-proto"] || req.protocol || "http") as string;
  const host = (req.headers["x-forwarded-host"] || req.get("host") || "") as string;
  return `${proto}://${host}`.replace(/\/+$/, "");
}

function isBbbIdNotUniqueError(err: any): boolean {
  const msg = String(err?.message || "");
  // BBB typically returns messageKey "idNotUnique" when meetingID already exists.
  return msg.includes("idNotUnique") || msg.toLowerCase().includes("not unique");
}

const ListSchema = z.object({
  status: z.enum(["booked", "completed", "cancelled", "no_show"]).optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
});

// Student view: list my bookings (for "Your classes")
bookingsRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const parsed = ListSchema.safeParse(req.query);
    if (!parsed.success) return res.status(400).json({ error: "Invalid query", details: parsed.error.flatten() });

    const studentUserId = req.user!.id;
    const { status, from, to } = parsed.data;

    const q: any = { studentUserId: new Types.ObjectId(studentUserId) };
    if (status) q.status = status;
    if (from || to) {
      q.bookedAt = {};
      if (from) q.bookedAt.$gte = new Date(from);
      if (to) q.bookedAt.$lte = new Date(to);
    }

    const bookings = await BookingModel.find(q)
      .sort({ bookedAt: -1 })
      .populate({ path: "sessionId", select: "startAt endAt meetingLink status priceCredits" })
      .populate({ path: "teacherId", select: "name country photoUrl stats" })
      .lean();

    const bookingIds = (bookings as any[]).map((b) => b._id);
    const ratings = await LessonRatingModel.find({ bookingId: { $in: bookingIds } })
      .select("bookingId fromRole")
      .lean();
    const studentRatedSet = new Set(
      (ratings as any[]).filter((r: any) => r.fromRole === "student").map((r: any) => String(r.bookingId))
    );
    const teacherRatedSet = new Set(
      (ratings as any[]).filter((r: any) => r.fromRole === "teacher").map((r: any) => String(r.bookingId))
    );

    const rows = (bookings as any[]).map((b) => ({
      id: String(b._id),
      status: String(b.status || ""),
      priceCredits: Number(b.priceCredits ?? 0),
      bookedAt: b.bookedAt,
      cancelledAt: b.cancelledAt ?? null,
      calendarEventId: String(b.calendarEventId || ""),
      studentRated: studentRatedSet.has(String(b._id)),
      teacherRated: teacherRatedSet.has(String(b._id)),
      teacher: b.teacherId
        ? {
            id: String(b.teacherId._id),
            name: String(b.teacherId.name || "Teacher"),
            country: String(b.teacherId.country || ""),
            photoUrl: String(b.teacherId.photoUrl || ""),
            ratingAvg: Number(b.teacherId?.stats?.ratingAvg ?? 0),
          }
        : null,
      session: b.sessionId
        ? {
            id: String(b.sessionId._id),
            startAt: b.sessionId.startAt,
            endAt: b.sessionId.endAt,
            meetingLink: String(b.sessionId.meetingLink || ""),
            status: String(b.sessionId.status || ""),
            priceCredits: Number(b.sessionId.priceCredits ?? 0),
          }
        : null,
    }));

    return res.json({ bookings: rows });
  })
);

const CreateSchema = z.object({
  sessionId: z.string().min(1),
});

bookingsRouter.post("/", asyncHandler(async (req, res) => {
  const parsed = CreateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid input", details: parsed.error.flatten() });

  const studentUserId = req.user!.id;
  const sessionIdStr = parsed.data.sessionId;

  if (!Types.ObjectId.isValid(sessionIdStr)) return res.status(400).json({ error: "Invalid sessionId" });
  const sessionId = new Types.ObjectId(sessionIdStr);

  const mongoSession = await mongoose.startSession();

  try {
    let result: any = null;
    let createdBookingId: string | null = null;

    await mongoSession.withTransaction(async () => {
      const classSession = await ClassSessionModel.findOne({ _id: sessionId, status: "open" }).session(mongoSession);
      if (!classSession) {
        result = { status: 409, body: { error: "Session is not available" } };
        return;
      }

      const balanceAgg = await CreditTransactionModel.aggregate([
        { $match: { userId: { $eq: new Types.ObjectId(studentUserId) } } },
        { $group: { _id: null, balance: { $sum: "$amount" } } },
      ]).session(mongoSession);

      const balance = balanceAgg[0]?.balance ?? 0;
      if (balance < classSession.priceCredits) {
        result = { status: 402, body: { error: "Not enough credits", balance, required: classSession.priceCredits } };
        return;
      }

      const updated = await ClassSessionModel.findOneAndUpdate(
        { _id: sessionId, status: "open" },
        { $set: { status: "booked" } },
        { new: true, session: mongoSession }
      );
      if (!updated) {
        result = { status: 409, body: { error: "Session already booked" } };
        return;
      }

      const booking = await BookingModel.create(
        [
          {
            sessionId,
            teacherId: updated.teacherId,
            studentUserId: new Types.ObjectId(studentUserId),
            status: "booked",
            bookedAt: new Date(),
            priceCredits: updated.priceCredits,
          },
        ],
        { session: mongoSession }
      );

      const bookingDoc = booking[0];

      const tx = await CreditTransactionModel.create(
        [
          {
            userId: new Types.ObjectId(studentUserId),
            type: "spend",
            amount: -updated.priceCredits,
            currency: "credits",
            related: { bookingId: bookingDoc._id, sessionId: updated._id },
          },
        ],
        { session: mongoSession }
      );

      bookingDoc.creditTxId = tx[0]._id;
      await bookingDoc.save({ session: mongoSession });

      createdBookingId = String(bookingDoc._id);
      result = {
        status: 201,
        body: {
          booking: {
            id: String(bookingDoc._id),
            sessionId: String(updated._id),
            teacherId: String(updated.teacherId),
            status: bookingDoc.status,
            priceCredits: bookingDoc.priceCredits,
            bookedAt: bookingDoc.bookedAt,
          },
          session: {
            startAt: updated.startAt,
            endAt: updated.endAt,
            meetingLink: updated.meetingLink || null,
          },
        },
      };
    });

    if (!result) return res.status(500).json({ error: "Unknown error" });

    // If booking succeeded, create a BBB meeting and store a role-aware join link.
    if (result.status === 201 && createdBookingId) {
      try {
        const bbbBaseUrl = env.BBB_BASE_URL ? normalizeBbbBaseUrl(env.BBB_BASE_URL) : "";
        const secret = (env.BBB_SHARED_SECRET || "").trim();
        if (!bbbBaseUrl || !secret) {
          result.body.bbb = { created: false, reason: "bbb_not_configured" };
        } else {
          const booking = (await BookingModel.findById(createdBookingId).lean()) as any | null;
          if (!booking) {
            result.body.bbb = { created: false, reason: "booking_not_found" };
          } else {
            const session = (await ClassSessionModel.findById(booking.sessionId).select("startAt endAt meetingLink teacherId").lean()) as any | null;
            if (!session) {
              result.body.bbb = { created: false, reason: "session_not_found" };
            } else {
              const meetingId = sessionIdStr;
              const salt = (env.MEETING_PASSWORD_SALT || "").trim() || secret;
              const { moderatorPW, attendeePW } = deriveMeetingPasswords({ meetingId, salt });

              const teacherProfile = (await TeacherProfileModel.findById(session.teacherId).select("name").lean()) as any | null;
              const teacherName = String(teacherProfile?.name || "Teacher");
              const meetingName = `Class with ${teacherName}`.slice(0, 120);

              const startMs = new Date(session.startAt).getTime();
              const endMs = new Date(session.endAt).getTime();
              const durationMinutes = Number.isFinite(startMs) && Number.isFinite(endMs) && endMs > startMs
                ? Math.max(1, Math.round((endMs - startMs) / 60000))
                : undefined;

              const joinLink = `${publicBackendBaseUrl(req)}/bbb/sessions/${encodeURIComponent(sessionIdStr)}/join`;

              // Create BBB meeting (best-effort). If meeting already exists, treat as success.
              const bbb = new BbbClient(bbbBaseUrl, secret);
              let created = false;
              try {
                await bbb.callXml(
                  "create",
                  {
                    meetingID: meetingId,
                    name: meetingName,
                    record: false,
                    duration: durationMinutes,
                    moderatorPW,
                    attendeePW,
                    logoutURL: `${env.CORS_ORIGIN.replace(/\/+$/, "")}/ebluelearning`,
                  },
                  "create"
                );
                created = true;
              } catch (e: any) {
                if (!isBbbIdNotUniqueError(e)) throw e;
              }

              // Store join link (works for both student/teacher because backend chooses the BBB password).
              await ClassSessionModel.updateOne({ _id: booking.sessionId }, { $set: { meetingLink: joinLink } });
              result.body.session.meetingLink = joinLink;
              result.body.bbb = { created, joinLink };
            }
          }
        }
      } catch (e: any) {
        // Don't fail the booking if BBB meeting creation fails.
        const msg = String(e?.message || "BBB meeting creation failed");
        result.body.bbb = { created: false, error: msg };
        // eslint-disable-next-line no-console
        console.error("[booking->bbb] creation failed", msg);
      }
      // Notify teacher of new booking (include student name)
      const teacherProfileId = result.body.booking.teacherId;
      const teacherUserId = await resolveTeacherUserId(teacherProfileId);
      const studentProfile = (await StudentProfileModel.findOne({ userId: studentUserId }).select("nickname").lean()) as { nickname?: string } | null;
      const studentName = String(studentProfile?.nickname || "").trim() || String(req.user?.email || "").split("@")[0] || "A student";
      // eslint-disable-next-line no-console
      console.log("[bookings] new_booking notify", { teacherProfileId, teacherUserId: teacherUserId ?? "null" });
      if (teacherUserId) {
        await persistAndNotify([teacherUserId], "new_booking", {
          bookingId: result.body.booking.id,
          sessionId: result.body.booking.sessionId,
          startAt: result.body.session?.startAt,
          endAt: result.body.session?.endAt,
          studentName,
        });
      }
    }

    return res.status(result.status).json(result.body);
  } finally {
    mongoSession.endSession();
  }
}));

bookingsRouter.post("/:id/cancel", asyncHandler(async (req, res) => {
  const bookingIdStr = req.params.id;
  if (!Types.ObjectId.isValid(bookingIdStr)) return res.status(400).json({ error: "Invalid booking id" });

  const studentUserId = req.user!.id;
  const bookingId = new Types.ObjectId(bookingIdStr);

  const mongoSession = await mongoose.startSession();

  try {
    let result: any = null;

    await mongoSession.withTransaction(async () => {
      const booking = await BookingModel.findOne({ _id: bookingId, studentUserId: studentUserId }).session(mongoSession);
      if (!booking) {
        result = { status: 404, body: { error: "Booking not found" } };
        return;
      }
      if (booking.status !== "booked") {
        result = { status: 409, body: { error: "Booking cannot be cancelled" } };
        return;
      }

      booking.status = "cancelled";
      booking.cancelledAt = new Date();
      await booking.save({ session: mongoSession });

      // Re-open session (simple policy for now)
      await ClassSessionModel.updateOne({ _id: booking.sessionId }, { $set: { status: "open" } }).session(mongoSession);

      // Refund credits (simple policy; adjust later if needed)
      await CreditTransactionModel.create(
        [
          {
            userId: new Types.ObjectId(studentUserId),
            type: "refund",
            amount: booking.priceCredits,
            currency: "credits",
            related: { bookingId: booking._id, sessionId: booking.sessionId },
          },
        ],
        { session: mongoSession }
      );

      result = { status: 200, body: { ok: true } };
    });

    if (!result) return res.status(500).json({ error: "Unknown error" });
    if (result.status === 200) {
      const bookingDoc = (await BookingModel.findById(bookingIdStr).select("teacherId").lean()) as { teacherId?: Types.ObjectId } | null;
      const teacherUserId = bookingDoc?.teacherId ? await resolveTeacherUserId(bookingDoc.teacherId) : null;
      if (teacherUserId) {
        const cancelStudentProfile = (await StudentProfileModel.findOne({ userId: studentUserId }).select("nickname").lean()) as { nickname?: string } | null;
        const studentName = String(cancelStudentProfile?.nickname || "").trim() || String(req.user?.email || "").split("@")[0] || "A student";
        await persistAndNotify([teacherUserId], "booking_cancelled", { bookingId: bookingIdStr, studentName });
      }
    }
    return res.status(result.status).json(result.body);
  } finally {
    mongoSession.endSession();
  }
}));

const StudentRateSchema = z.object({
  rating: z.number().int().min(1).max(5),
  comment: z.string().trim().max(1000).optional(),
});

// Student rates teacher for a completed booking
bookingsRouter.post(
  "/:id/rate",
  asyncHandler(async (req, res) => {
    const studentUserId = req.user!.id;
    const id = req.params.id;
    if (!Types.ObjectId.isValid(id)) return res.status(400).json({ error: "Invalid booking id" });
    const parsed = StudentRateSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Invalid input", details: parsed.error.flatten() });
    const booking = await BookingModel.findOne({ _id: id, studentUserId: new Types.ObjectId(studentUserId) }).lean();
    if (!booking) return res.status(404).json({ error: "Booking not found" });
    const b = booking as any;
    if (b.status !== "completed") {
      return res.status(400).json({ error: "Can only rate completed lessons" });
    }
    const existing = await LessonRatingModel.findOne({ bookingId: new Types.ObjectId(id), fromRole: "student" }).lean();
    if (existing) return res.status(400).json({ error: "You already rated this lesson" });
    const teacherId = b.teacherId;
    await LessonRatingModel.create({
      bookingId: new Types.ObjectId(id),
      teacherId,
      studentUserId: new Types.ObjectId(studentUserId),
      fromRole: "student",
      fromUserId: new Types.ObjectId(studentUserId),
      rating: parsed.data.rating,
      comment: parsed.data.comment ?? "",
    });
    const agg = await LessonRatingModel.aggregate([
      { $match: { teacherId, fromRole: "student" } },
      { $group: { _id: null, avg: { $avg: "$rating" }, count: { $sum: 1 } } },
    ]);
    const avg = agg[0]?.avg ?? 0;
    const count = agg[0]?.count ?? 0;
    await TeacherProfileModel.updateOne(
      { _id: teacherId },
      { $set: { "stats.ratingAvg": Math.round(avg * 100) / 100, "stats.ratingCount": count } }
    );
    return res.json({ ok: true });
  })
);
