import { Router, type Request } from "express";
import { z } from "zod";
import jwt from "jsonwebtoken";
import { google } from "googleapis";

import { requireAuth, requireRole } from "../middleware/auth";
import type { AuthUser } from "../middleware/auth";
import { asyncHandler } from "../utils/asyncHandler";
import { UserModel } from "../models/User";
import { env } from "../config/env";

export const integrationsRouter = Router();

integrationsRouter.use(requireAuth, requireRole("student", "teacher", "admin"));

integrationsRouter.get(
  "/google-calendar/status",
  asyncHandler(async (req, res) => {
    const userId = (req as Request & { user: AuthUser }).user.id;
    const user = await UserModel.findById(userId).select("integrations.googleCalendar email").lean();
    if (!user) return res.status(404).json({ error: "User not found" });

    const gc = (user as any)?.integrations?.googleCalendar ?? {};

    return res.json({
      connected: Boolean(gc.connected),
      googleUserEmail: gc.googleUserEmail || "",
      calendarId: gc.calendarId || "",
      lastSyncedAt: gc.lastSyncedAt || null,
    });
  })
);

integrationsRouter.post(
  "/google-calendar/disconnect",
  asyncHandler(async (req, res) => {
    const userId = (req as Request & { user: AuthUser }).user.id;
    await UserModel.updateOne(
      { _id: userId },
      {
        $set: {
          "integrations.googleCalendar.connected": false,
          "integrations.googleCalendar.googleUserEmail": "",
          "integrations.googleCalendar.refreshTokenEncrypted": "",
          "integrations.googleCalendar.scopes": [],
          "integrations.googleCalendar.tokenExpiry": null,
          "integrations.googleCalendar.calendarId": "",
          "integrations.googleCalendar.lastSyncedAt": null,
        },
      }
    );
    return res.json({ ok: true });
  })
);

// Placeholder for future OAuth connection flow.
const AuthUrlQuery = z.object({
  // where frontend should return after OAuth (optional for future)
  returnTo: z.string().optional(),
});

integrationsRouter.get(
  "/google-calendar/auth-url",
  asyncHandler(async (req, res) => {
    const parsed = AuthUrlQuery.safeParse(req.query);
    if (!parsed.success) return res.status(400).json({ error: "Invalid query", details: parsed.error.flatten() });

    if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET || !env.GOOGLE_REDIRECT_URI) {
      return res.status(501).json({ error: "Google OAuth is not configured on the backend." });
    }

    const returnToRaw = parsed.data.returnTo;
    const returnTo =
      returnToRaw && returnToRaw.startsWith("/") && !returnToRaw.startsWith("//")
        ? returnToRaw
        : "/ebluelearning";

    const state = jwt.sign(
      { kind: "google_calendar", sub: (req as Request & { user: AuthUser }).user.id, returnTo },
      env.JWT_SECRET,
      { expiresIn: "10m" }
    );

    const oauth2 = new google.auth.OAuth2(env.GOOGLE_CLIENT_ID, env.GOOGLE_CLIENT_SECRET, env.GOOGLE_REDIRECT_URI);
    const url = oauth2.generateAuthUrl({
      access_type: "offline",
      prompt: "consent",
      include_granted_scopes: true,
      scope: [
        // Use full calendar scope so we can create events + Google Meet conferenceData reliably.
        // (calendar.events alone can be insufficient depending on how the token was granted.)
        "https://www.googleapis.com/auth/calendar",
        "https://www.googleapis.com/auth/calendar.events",
        "https://www.googleapis.com/auth/userinfo.email",
        "openid",
      ],
      state,
    });

    return res.json({ url });
  })
);

