import type { VercelRequest, VercelResponse } from "@vercel/node";
import type { Express } from "express";
import { createApp } from "./app";

let app: Express | null = null;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    if (!app) {
      app = await createApp();
    }
    // Pass the request to Express
    return app(req as any, res as any);
  } catch (err) {
    console.error("Vercel handler error:", err);
    return res.status(500).json({ 
      error: "Internal Server Error",
      message: err instanceof Error ? err.message : String(err)
    });
  }
}

