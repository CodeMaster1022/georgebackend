import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { env } from "../config/env";
import type { UserRole } from "../models/User";

export type AuthUser = { id: string; role: UserRole; email: string };

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const header = req.header("authorization") || "";
  const m = /^Bearer\s+(.+)$/.exec(header);
  if (!m) return res.status(401).json({ error: "Missing token" });

  try {
    const decoded = jwt.verify(m[1], env.JWT_SECRET) as any;
    const id = String(decoded?.sub || "");
    const role = decoded?.role as UserRole | undefined;
    const email = String(decoded?.email || "");
    if (!id || !role || !email) return res.status(401).json({ error: "Invalid token" });
    req.user = { id, role, email };
    return next();
  } catch {
    return res.status(401).json({ error: "Invalid token" });
  }
}

export function requireRole(...roles: UserRole[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    const user = req.user;
    if (!user) return res.status(401).json({ error: "Unauthorized" });
    if (!roles.includes(user.role)) return res.status(403).json({ error: "Forbidden" });
    return next();
  };
}


