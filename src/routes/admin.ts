import { Router } from "express";
import { z } from "zod";
import { UserModel } from "../models/User";
import { TeacherProfileModel } from "../models/TeacherProfile";
import { StudentProfileModel } from "../models/StudentProfile";
import { BookingModel } from "../models/Booking";
import { asyncHandler } from "../utils/asyncHandler";
import { requireAuth, requireRole } from "../middleware/auth";

export const adminRouter = Router();

// Middleware: All admin routes require admin role
adminRouter.use(requireAuth, requireRole("admin"));

// GET /admin/users - List all users with pagination
adminRouter.get("/users", asyncHandler(async (req, res) => {
  const page = Math.max(1, parseInt(String(req.query.page || "1")));
  const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit || "20"))));
  const skip = (page - 1) * limit;

  // Build filter query
  const filter: any = {};
  if (req.query.role) filter.role = req.query.role;
  if (req.query.status) filter.status = req.query.status;
  if (req.query.search) {
    filter.email = { $regex: String(req.query.search), $options: "i" };
  }

  const [users, totalCount] = await Promise.all([
    UserModel.find(filter)
      .select("email role status createdAt verifiedEmail lastLoginAt")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    UserModel.countDocuments(filter),
  ]);

  // Get credits for each user (from student profiles)
  const userIds = users.map(u => u._id);
  const studentProfiles = await StudentProfileModel.find({ userId: { $in: userIds } })
    .select("userId credits")
    .lean();

  const creditsMap = new Map(studentProfiles.map(p => [String(p.userId), p.credits || 0]));

  const usersWithCredits = users.map(u => ({
    _id: String(u._id),
    email: u.email,
    role: u.role,
    status: u.status,
    createdAt: u.createdAt,
    verifiedEmail: u.verifiedEmail,
    lastLoginAt: u.lastLoginAt,
    credits: creditsMap.get(String(u._id)) || 0,
  }));

  return res.json({
    users: usersWithCredits,
    pagination: {
      page,
      limit,
      totalCount,
      totalPages: Math.ceil(totalCount / limit),
      hasNextPage: page < Math.ceil(totalCount / limit),
      hasPrevPage: page > 1,
    },
  });
}));

// GET /admin/users/:id - Get user details
adminRouter.get("/users/:id", asyncHandler(async (req, res) => {
  const user = await UserModel.findById(req.params.id)
    .select("-passwordHash")
    .lean();

  if (!user) return res.status(404).json({ error: "User not found" });

  let profile = null;
  if (Array.isArray(user)) {
    return res.status(500).json({ error: "Unexpected array result" });
  }
  
  if (user.role === "teacher") {
    profile = await TeacherProfileModel.findOne({ userId: user._id }).lean();
  } else if (user.role === "student") {
    profile = await StudentProfileModel.findOne({ userId: user._id }).lean();
  }

  return res.json({ user, profile });
}));

// PATCH /admin/users/:id - Update user
const UpdateUserSchema = z.object({
  role: z.enum(["student", "teacher", "admin"]).optional(),
  status: z.enum(["active", "inactive", "banned"]).optional(),
  email: z.string().email().optional(),
});

adminRouter.patch("/users/:id", asyncHandler(async (req, res) => {
  const parsed = UpdateUserSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid input", details: parsed.error.flatten() });
  }

  const user = await UserModel.findById(req.params.id);
  if (!user) return res.status(404).json({ error: "User not found" });

  if (parsed.data.role) user.role = parsed.data.role;
  if (parsed.data.status) user.status = parsed.data.status;
  if (parsed.data.email) user.email = parsed.data.email.trim().toLowerCase();

  await user.save();

  return res.json({ user: { id: String(user._id), email: user.email, role: user.role, status: user.status } });
}));

// POST /admin/users/:id/ban - Ban user
adminRouter.post("/users/:id/ban", asyncHandler(async (req, res) => {
  const user = await UserModel.findById(req.params.id);
  if (!user) return res.status(404).json({ error: "User not found" });

  user.status = "banned";
  await user.save();

  return res.json({ ok: true, user: { id: String(user._id), status: user.status } });
}));

// POST /admin/users/:id/unban - Unban user
adminRouter.post("/users/:id/unban", asyncHandler(async (req, res) => {
  const user = await UserModel.findById(req.params.id);
  if (!user) return res.status(404).json({ error: "User not found" });

  user.status = "active";
  await user.save();

  return res.json({ ok: true, user: { id: String(user._id), status: user.status } });
}));

// POST /admin/users/:id/credits - Award credits
const AwardCreditsSchema = z.object({
  amount: z.number().int().min(1).max(1000),
  reason: z.string().optional(),
});

adminRouter.post("/users/:id/credits", asyncHandler(async (req, res) => {
  const parsed = AwardCreditsSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid input", details: parsed.error.flatten() });
  }

  const user = await UserModel.findById(req.params.id);
  if (!user) return res.status(404).json({ error: "User not found" });

  if (user.role !== "student") {
    return res.status(400).json({ error: "Only students can receive credits" });
  }

  const profile = await StudentProfileModel.findOne({ userId: user._id });
  if (!profile) return res.status(404).json({ error: "Student profile not found" });

  profile.credits = (profile.credits || 0) + parsed.data.amount;
  await profile.save();

  return res.json({ ok: true, credits: profile.credits });
}));

// GET /admin/stats - Dashboard statistics
adminRouter.get("/stats", asyncHandler(async (req, res) => {
  const [totalUsers, totalTeachers, totalStudents, totalBookings] = await Promise.all([
    UserModel.countDocuments(),
    UserModel.countDocuments({ role: "teacher" }),
    UserModel.countDocuments({ role: "student" }),
    BookingModel.countDocuments(),
  ]);

  const activeUsers = await UserModel.countDocuments({ status: "active" });
  const recentUsers = await UserModel.find()
    .sort({ createdAt: -1 })
    .limit(5)
    .select("email role createdAt")
    .lean();

  return res.json({
    totalUsers,
    totalTeachers,
    totalStudents,
    totalBookings,
    activeUsers,
    recentUsers,
  });
}));

// GET /admin/teachers - List all teachers with pagination
adminRouter.get("/teachers", asyncHandler(async (req, res) => {
  const page = Math.max(1, parseInt(String(req.query.page || "1")));
  const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit || "20"))));
  const skip = (page - 1) * limit;

  // Build filter query
  const filter: any = { role: "teacher" };
  if (req.query.status) filter.status = req.query.status;
  if (req.query.search) {
    filter.email = { $regex: String(req.query.search), $options: "i" };
  }

  const [teachers, totalCount] = await Promise.all([
    UserModel.find(filter)
      .select("email status createdAt verifiedEmail")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    UserModel.countDocuments(filter),
  ]);

  const teacherIds = teachers.map(t => t._id);
  const profiles = await TeacherProfileModel.find({ userId: { $in: teacherIds } })
    .select("userId name bio country timezone photoUrl")
    .lean();

  const profileMap = new Map(profiles.map(p => [String(p.userId), p]));

  const teachersWithProfiles = teachers.map(t => ({
    _id: String(t._id),
    email: t.email,
    status: t.status,
    createdAt: t.createdAt,
    verifiedEmail: t.verifiedEmail,
    profile: profileMap.get(String(t._id)) || null,
  }));

  return res.json({
    teachers: teachersWithProfiles,
    pagination: {
      page,
      limit,
      totalCount,
      totalPages: Math.ceil(totalCount / limit),
      hasNextPage: page < Math.ceil(totalCount / limit),
      hasPrevPage: page > 1,
    },
  });
}));

// GET /admin/bookings - List all bookings with pagination
adminRouter.get("/bookings", asyncHandler(async (req, res) => {
  const page = Math.max(1, parseInt(String(req.query.page || "1")));
  const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit || "20"))));
  const skip = (page - 1) * limit;

  // Build filter query
  const filter: any = {};
  if (req.query.status) filter.status = req.query.status;

  const [bookings, totalCount] = await Promise.all([
    BookingModel.find(filter)
      .sort({ bookedAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate("studentUserId", "email")
      .populate("teacherUserId", "email")
      .lean(),
    BookingModel.countDocuments(filter),
  ]);

  return res.json({
    bookings,
    pagination: {
      page,
      limit,
      totalCount,
      totalPages: Math.ceil(totalCount / limit),
      hasNextPage: page < Math.ceil(totalCount / limit),
      hasPrevPage: page > 1,
    },
  });
}));
