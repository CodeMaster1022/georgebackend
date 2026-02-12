import { Router } from "express";
import { Types } from "mongoose";
import { z } from "zod";
import jwt from "jsonwebtoken";

import { requireRole, type AuthUser } from "../middleware/auth";
import { asyncHandler } from "../utils/asyncHandler";
import { env } from "../config/env";
import { BbbClient } from "../bbb/client";
import { deriveMeetingPasswords } from "../bbb/meetingPasswords";
import { ClassSessionModel } from "../models/ClassSession";
import { BookingModel } from "../models/Booking";
import { TeacherProfileModel } from "../models/TeacherProfile";
import { StudentProfileModel } from "../models/StudentProfile";

export const bbbRouter = Router();

function requireAuthHeaderOrQuery(req: any, res: any, next: any) {
  const header = String(req.header("authorization") || "");
  const m = /^Bearer\s+(.+)$/.exec(header);
  const fromHeader = m?.[1];
  const fromQuery = typeof req.query?.token === "string" ? req.query.token : "";
  const token = (fromHeader || fromQuery || "").trim();
  if (!token) return res.status(401).json({ error: "Missing token" });

  try {
    const decoded = jwt.verify(token, env.JWT_SECRET) as any;
    const id = String(decoded?.sub || "");
    const role = String(decoded?.role || "");
    const email = String(decoded?.email || "");
    if (!id || !role || !email) return res.status(401).json({ error: "Invalid token" });
    req.user = { id, role, email } satisfies AuthUser;
    return next();
  } catch {
    return res.status(401).json({ error: "Invalid token" });
  }
}

bbbRouter.use(requireAuthHeaderOrQuery, requireRole("student", "teacher", "admin"));

function normalizeBbbBaseUrl(raw: string): string {
  let base = raw.trim().replace(/\/+$/, "");
  if (base.toLowerCase().endsWith("/api")) base = base.slice(0, -4);
  return base;
}

function publicBackendBaseUrl(req: any): string {
  const fromEnv = (env.PUBLIC_BACKEND_URL || "").trim().replace(/\/+$/, "");
  if (fromEnv) return fromEnv;
  // Fallback (dev): build from request.
  const proto = (req.headers["x-forwarded-proto"] || req.protocol || "http") as string;
  const host = (req.headers["x-forwarded-host"] || req.get("host") || "") as string;
  return `${proto}://${host}`.replace(/\/+$/, "");
}

async function displayNameForUser(user: { id: string; role: string; email: string }): Promise<string> {
  if (user.role === "teacher") {
    const tp = (await TeacherProfileModel.findOne({ userId: user.id }).select("name").lean()) as any | null;
    const n = String(tp?.name || "").trim();
    return n || String(user.email || "").split("@")[0] || "Teacher";
  }
  if (user.role === "student") {
    const sp = (await StudentProfileModel.findOne({ userId: user.id }).select("nickname").lean()) as any | null;
    const n = String(sp?.nickname || "").trim();
    return n || String(user.email || "").split("@")[0] || "Student";
  }
  return String(user.email || "").split("@")[0] || "Admin";
}

const JoinParams = z.object({
  sessionId: z.string().min(1),
});

// Join a session's BBB meeting. Backend enforces role and redirects to BBB join URL.
bbbRouter.get(
  "/sessions/:sessionId/join",
  asyncHandler(async (req, res) => {
    const parsed = JoinParams.safeParse({ sessionId: req.params.sessionId });
    if (!parsed.success) return res.status(400).json({ error: "Invalid sessionId" });

    const sessionIdStr = parsed.data.sessionId;
    if (!Types.ObjectId.isValid(sessionIdStr)) return res.status(400).json({ error: "Invalid sessionId" });
    const sessionId = new Types.ObjectId(sessionIdStr);

    const user = req.user!;
    const classSession = await ClassSessionModel.findById(sessionId).select("_id teacherId status").lean();
    if (!classSession) return res.status(404).json({ error: "Session not found" });

    // Authorization: only the booked student, the session's teacher, or admin can join.
    if (user.role === "student") {
      const booking = await BookingModel.findOne({ sessionId, studentUserId: user.id, status: "booked" })
        .select("_id")
        .lean();
      if (!booking) return res.status(403).json({ error: "Forbidden" });
    } else if (user.role === "teacher") {
      const tp = (await TeacherProfileModel.findOne({ userId: user.id }).select("_id").lean()) as any | null;
      if (!tp?._id || String(tp._id) !== String((classSession as any).teacherId)) {
        return res.status(403).json({ error: "Forbidden" });
      }
    }

    const bbbBaseUrl = env.BBB_BASE_URL ? normalizeBbbBaseUrl(env.BBB_BASE_URL) : "";
    const secret = (env.BBB_SHARED_SECRET || "").trim();
    if (!bbbBaseUrl || !secret) {
      return res.status(501).json({ error: "BBB is not configured on the backend." });
    }

    const meetingId = sessionIdStr;
    const salt = (env.MEETING_PASSWORD_SALT || "").trim() || secret;
    const { moderatorPW, attendeePW } = deriveMeetingPasswords({ meetingId, salt });
    const password = user.role === "teacher" ? moderatorPW : attendeePW;
    const fullName = await displayNameForUser(user);

    const bbb = new BbbClient(bbbBaseUrl, secret);
    const joinUrl = bbb.buildSignedUrl("join", {
      meetingID: meetingId,
      fullName,
      password,
      redirect: true,
      // Best-effort: return to frontend after the meeting ends.
      logoutURL: `${env.CORS_ORIGIN.replace(/\/+$/, "")}/ebluelearning`,
    });

    return res.redirect(joinUrl);
  })
);

// Expose a helper endpoint (useful for debugging) that returns the stored join-link base.
bbbRouter.get(
  "/public-base-url",
  asyncHandler(async (req, res) => {
    return res.json({ publicBaseUrl: publicBackendBaseUrl(req) });
  })
);

