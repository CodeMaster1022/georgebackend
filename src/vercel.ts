import type { Request, Response } from "express";
import { createApp } from "./app";

let appPromise: ReturnType<typeof createApp> | null = null;

export default async function handler(req: Request, res: Response) {
  try {
    if (!appPromise) appPromise = createApp();
    const app = await appPromise;
    return app(req, res);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(err);
    return res.status(500).json({ error: "Internal Server Error" });
  }
}

