import { Router } from "express";
import { TeacherProfileModel } from "../models/TeacherProfile";
import { asyncHandler } from "../utils/asyncHandler";

export const teachersRouter = Router();

// Public listing (basic fields)
teachersRouter.get("/", asyncHandler(async (_req, res) => {
  const teachers = await TeacherProfileModel.find({})
    .select("name bio timezone country photoUrl stats")
    .sort({ "stats.ratingAvg": -1, createdAt: -1 })
    .lean();

  res.json({ teachers });
}));

