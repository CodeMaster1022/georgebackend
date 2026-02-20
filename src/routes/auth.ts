import { Router } from "express";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { z } from "zod";
import crypto from "crypto";

import { env } from "../config/env";
import { UserModel, type UserRole } from "../models/User";
import { TeacherProfileModel } from "../models/TeacherProfile";
import { StudentProfileModel } from "../models/StudentProfile";
import { EmailVerificationCodeModel } from "../models/EmailVerificationCode";
import { asyncHandler } from "../utils/asyncHandler";
import { sendVerificationCodeEmail } from "../services/mailer";
import { google } from "googleapis";
import { encryptString } from "../utils/crypto";

export const authRouter = Router();

const RegisterSchema = z.object({
  role: z.enum(["student", "teacher", "admin"]),
  email: z.string().email(),
  password: z.string().min(6),
});

function make6DigitCode() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

function hashCode(code: string) {
  return crypto.createHash("sha256").update(`${code}:${env.EMAIL_CODE_PEPPER}`).digest("hex");
}

authRouter.post("/register", asyncHandler(async (req, res) => {
  const parsed = RegisterSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid input", details: parsed.error.flatten() });

  const { role, email, password } = parsed.data;
  const normalizedEmail = email.trim().toLowerCase();

  const existing = await UserModel.findOne({ email: normalizedEmail });
  if (existing) {
    // If already verified, treat as a real conflict.
    if (existing.verifiedEmail) return res.status(409).json({ error: "Email already exists" });

    // Role mismatch should also be a conflict.
    if (existing.role !== role) return res.status(409).json({ error: "Email already exists" });

    // If not verified yet, re-send the verification code instead of failing.
    const code = make6DigitCode();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);
    await EmailVerificationCodeModel.findOneAndUpdate(
      { userId: existing._id },
      {
        $set: {
          userId: existing._id,
          email: existing.email,
          codeHash: hashCode(code),
          expiresAt,
          attempts: 0,
          lastSentAt: new Date(),
        },
      },
      { upsert: true, new: true }
    );
    let emailSent = true;
    let devFallback = false;
    try {
      const result = await sendVerificationCodeEmail(existing.email, code);
      devFallback = result.devFallback === true;
    } catch (err) {
      emailSent = false;
      console.error("[auth] Failed to send verification email (resend for existing):", err);
    }
    return res.json({
      pendingVerification: true,
      user: { id: String(existing._id), role: existing.role, email: existing.email },
      ...(devFallback ? { verificationCode: code } : {}),
      ...(emailSent ? {} : { emailError: true }),
    });
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const user = await UserModel.create({
    role,
    email: normalizedEmail,
    passwordHash,
    status: "active",
    verifiedEmail: false,
  });

  // Create empty role profile (optional fields can be filled later)
  if (role === "teacher") {
    await TeacherProfileModel.create({ userId: user._id, name: normalizedEmail.split("@")[0] });
  }
  if (role === "student") {
    await StudentProfileModel.create({ userId: user._id, nickname: normalizedEmail.split("@")[0] });
  }

  // Send verification code
  const code = make6DigitCode();
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000);
  await EmailVerificationCodeModel.findOneAndUpdate(
    { userId: user._id },
    {
      $set: {
        userId: user._id,
        email: user.email,
        codeHash: hashCode(code),
        expiresAt,
        attempts: 0,
        lastSentAt: new Date(),
      },
    },
    { upsert: true, new: true }
  );

  let emailSent = true;
  let devFallback = false;
  try {
    const result = await sendVerificationCodeEmail(user.email, code);
    devFallback = result.devFallback === true;
  } catch (err) {
    emailSent = false;
    console.error("[auth] Failed to send verification email on register:", err);
  }
  return res.status(201).json({
    pendingVerification: true,
    user: { id: String(user._id), role: user.role, email: user.email },
    ...(devFallback ? { verificationCode: code } : {}),
    ...(emailSent ? {} : { emailError: true }),
  });
}));

const VerifySchema = z.object({
  email: z.string().email(),
  code: z.string().regex(/^\d{6}$/),
});

authRouter.post("/verify-email", asyncHandler(async (req, res) => {
  const parsed = VerifySchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid input", details: parsed.error.flatten() });

  const normalizedEmail = parsed.data.email.trim().toLowerCase();
  const code = parsed.data.code;

  const user = await UserModel.findOne({ email: normalizedEmail });
  if (!user) return res.status(404).json({ error: "Account not found" });
  if (user.verifiedEmail) {
    const token = jwt.sign({ sub: String(user._id), role: user.role as UserRole, email: user.email }, env.JWT_SECRET, {
      expiresIn: "7d",
    });
    return res.json({ token, user: { id: String(user._id), role: user.role, email: user.email } });
  }

  const record = await EmailVerificationCodeModel.findOne({ userId: user._id });
  if (!record) return res.status(400).json({ error: "No verification code. Please resend." });
  if (record.expiresAt.getTime() < Date.now()) return res.status(400).json({ error: "Code expired. Please resend." });
  if (record.attempts >= 5) return res.status(429).json({ error: "Too many attempts. Please resend code." });

  const ok = record.codeHash === hashCode(code);
  if (!ok) {
    record.attempts += 1;
    await record.save();
    return res.status(400).json({ error: "Incorrect code" });
  }

  user.verifiedEmail = true;
  await user.save();
  await EmailVerificationCodeModel.deleteOne({ _id: record._id });

  const token = jwt.sign({ sub: String(user._id), role: user.role as UserRole, email: user.email }, env.JWT_SECRET, {
    expiresIn: "7d",
  });
  return res.json({ token, user: { id: String(user._id), role: user.role, email: user.email } });
}));

const ResendSchema = z.object({
  email: z.string().email(),
});

authRouter.post("/resend-code", asyncHandler(async (req, res) => {
  const parsed = ResendSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid input", details: parsed.error.flatten() });

  const normalizedEmail = parsed.data.email.trim().toLowerCase();
  const user = await UserModel.findOne({ email: normalizedEmail });
  if (!user) return res.status(404).json({ error: "Account not found" });
  if (user.verifiedEmail) return res.json({ ok: true });

  const existing = await EmailVerificationCodeModel.findOne({ userId: user._id });
  if (existing?.lastSentAt && Date.now() - existing.lastSentAt.getTime() < 30 * 1000) {
    return res.status(429).json({ error: "Please wait before resending." });
  }

  const code = make6DigitCode();
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000);
  await EmailVerificationCodeModel.findOneAndUpdate(
    { userId: user._id },
    {
      $set: {
        userId: user._id,
        email: user.email,
        codeHash: hashCode(code),
        expiresAt,
        attempts: 0,
        lastSentAt: new Date(),
      },
    },
    { upsert: true, new: true }
  );
  let emailSent = true;
  let devFallback = false;
  try {
    const result = await sendVerificationCodeEmail(user.email, code);
    devFallback = result.devFallback === true;
  } catch (err) {
    emailSent = false;
    console.error("[auth] Failed to send verification email (resend):", err);
  }
  return res.json({
    ok: true,
    ...(devFallback ? { verificationCode: code } : {}),
    ...(emailSent ? {} : { emailError: true }),
  });
}));

const LoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

authRouter.post("/login", asyncHandler(async (req, res) => {
  const parsed = LoginSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid input", details: parsed.error.flatten() });

  const { email, password } = parsed.data;
  const normalizedEmail = email.trim().toLowerCase();

  const user = await UserModel.findOne({ email: normalizedEmail });
  if (!user) return res.status(401).json({ error: "Invalid credentials" });
  if (user.status !== "active") return res.status(403).json({ error: "Account disabled" });
  if (!user.verifiedEmail) return res.status(403).json({ error: "Email not verified" });

  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) return res.status(401).json({ error: "Invalid credentials" });

  user.lastLoginAt = new Date();
  await user.save();

  const token = jwt.sign({ sub: String(user._id), role: user.role as UserRole, email: user.email }, env.JWT_SECRET, {
    expiresIn: "7d",
  });

  return res.json({ token, user: { id: String(user._id), role: user.role, email: user.email } });
}));

const GoogleCallbackQuery = z.object({
  code: z.string().min(1),
  state: z.string().min(1),
});

authRouter.get("/google/callback", asyncHandler(async (req, res) => {
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET || !env.GOOGLE_REDIRECT_URI) {
    return res.status(501).send("Google OAuth is not configured on the backend.");
  }

  const parsed = GoogleCallbackQuery.safeParse(req.query);
  if (!parsed.success) return res.status(400).send("Invalid callback query.");

  // Validate state token
  let state: any;
  try {
    state = jwt.verify(parsed.data.state, env.JWT_SECRET);
  } catch {
    return res.status(400).send("Invalid state.");
  }
  if (state?.kind !== "google_calendar" || !state?.sub) return res.status(400).send("Invalid state.");

  const userId = String(state.sub);
  const returnTo =
    typeof state.returnTo === "string" && state.returnTo.startsWith("/") && !state.returnTo.startsWith("//")
      ? state.returnTo
      : "/ebluelearning";

  try {
    const oauth2 = new google.auth.OAuth2(env.GOOGLE_CLIENT_ID, env.GOOGLE_CLIENT_SECRET, env.GOOGLE_REDIRECT_URI);
    const tokenResp = await oauth2.getToken(parsed.data.code);
    const tokens = tokenResp.tokens;
    oauth2.setCredentials(tokens);

    // Fetch Google account email
    const oauth2Api = google.oauth2({ version: "v2", auth: oauth2 });
    const userInfo = await oauth2Api.userinfo.get();
    const googleEmail = (userInfo.data.email || "").toLowerCase();

    // Need refresh token for long-term calendar sync.
    const refresh = tokens.refresh_token;
    if (!refresh) {
      const existing = await UserModel.findById(userId)
        .select("integrations.googleCalendar.refreshTokenEncrypted")
        .lean();
      const hasExisting = Boolean((existing as any)?.integrations?.googleCalendar?.refreshTokenEncrypted);
      if (!hasExisting) {
        return res
          .status(400)
          .send(
            "Google did not return a refresh token. Please revoke access in your Google Account and try again."
          );
      }
    }

    const scopes = (tokens.scope ? tokens.scope.split(" ") : []).filter(Boolean);
    const expiry = tokens.expiry_date ? new Date(tokens.expiry_date) : undefined;

    const update: any = {
      "integrations.googleCalendar.connected": true,
      "integrations.googleCalendar.googleUserEmail": googleEmail,
      "integrations.googleCalendar.scopes": scopes,
      "integrations.googleCalendar.tokenExpiry": expiry ?? null,
      "integrations.googleCalendar.calendarId": "primary",
    };
    if (refresh) {
      update["integrations.googleCalendar.refreshTokenEncrypted"] = encryptString(refresh);
    }

    await UserModel.updateOne({ _id: userId }, { $set: update });

    // Redirect back to frontend
    return res.redirect(`${env.CORS_ORIGIN}${returnTo}`);
  } catch (err: any) {
    const msg = String(err?.message || err || "");

    if (msg.includes("TOKEN_ENCRYPTION_KEY is not set")) {
      return res
        .status(500)
        .send("Server missing TOKEN_ENCRYPTION_KEY. Set it in backend/.env and restart the backend.");
    }

    // Common when code is reused/expired or redirect URI mismatch.
    if (msg.includes("invalid_grant")) {
      return res
        .status(400)
        .send("Google auth code expired/invalid. Click Connect again to restart the flow.");
    }

    // eslint-disable-next-line no-console
    console.error("[google-oauth] callback error", err);
    return res.status(500).send("Google OAuth failed. Check backend logs.");
  }
}));

