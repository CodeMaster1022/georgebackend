import { Router } from "express";
import { Types } from "mongoose";
import { z } from "zod";
import { requireAuth, requireRole } from "../middleware/auth";
import { CreditTransactionModel } from "../models/CreditTransaction";
import { asyncHandler } from "../utils/asyncHandler";

export const creditsRouter = Router();

creditsRouter.use(requireAuth, requireRole("student"));

creditsRouter.get("/balance", asyncHandler(async (req, res) => {
  const userId = req.user!.id;
  const agg = await CreditTransactionModel.aggregate([
    { $match: { userId: { $eq: new Types.ObjectId(userId) } } },
    { $group: { _id: null, balance: { $sum: "$amount" } } },
  ]);

  const balance = agg[0]?.balance ?? 0;
  res.json({ balance });
}));

creditsRouter.get("/ledger", asyncHandler(async (req, res) => {
  const userId = req.user!.id;
  const txs = await CreditTransactionModel.find({ userId }).sort({ createdAt: -1 }).limit(200).lean();
  res.json({ transactions: txs });
}));

const PurchaseSchema = z.object({
  credits: z.number().int().min(1).max(500),
  method: z.enum(["mock_card", "mock_paypal"]).default("mock_card"),
  referralCode: z.string().trim().max(80).optional(),
});

// Fake purchase (no payment provider). Just writes to DB ledger.
creditsRouter.post("/purchase", asyncHandler(async (req, res) => {
  const parsed = PurchaseSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid input", details: parsed.error.flatten() });

  const userId = req.user!.id;
  const { credits, method, referralCode } = parsed.data;

  await CreditTransactionModel.create({
    userId: new Types.ObjectId(userId),
    type: "purchase",
    amount: credits,
    currency: "credits",
    meta: { method, referralCode: referralCode ?? "" },
    related: {
      // store a marker-like id so we can trace purchases later even without a Payment model
      paymentId: new Types.ObjectId(),
    },
  });

  const agg = await CreditTransactionModel.aggregate([
    { $match: { userId: { $eq: new Types.ObjectId(userId) } } },
    { $group: { _id: null, balance: { $sum: "$amount" } } },
  ]);
  const balance = agg[0]?.balance ?? 0;

  res.status(201).json({ ok: true, method, balance });
}));

