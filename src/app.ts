import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";

import { env } from "./config/env";
import { connectDb } from "./config/db";

import { healthRouter } from "./routes/health";
import { authRouter } from "./routes/auth";
import { teachersRouter } from "./routes/teachers";
import { sessionsRouter } from "./routes/sessions";
import { bookingsRouter } from "./routes/bookings";
import { creditsRouter } from "./routes/credits";
import { integrationsRouter } from "./routes/integrations";
import { teacherRouter } from "./routes/teacher";
import { studentRouter } from "./routes/student";
import { bbbRouter } from "./routes/bbb";
import { forumRouter } from "./routes/forum";
import { adminForumRouter } from "./routes/adminForum";

export async function createApp() {
  await connectDb();

  const app = express();
  app.disable("x-powered-by");

  app.use(helmet());
  app.use(
    cors({
      origin: "*",
      credentials: true,
    })
  );
  app.use(express.json({ limit: "1mb" }));
  app.use(morgan("dev"));

  app.use("/health", healthRouter);
  app.use("/auth", authRouter);
  app.use("/teachers", teachersRouter);
  app.use("/sessions", sessionsRouter);
  app.use("/bookings", bookingsRouter);
  app.use("/credits", creditsRouter);
  app.use("/integrations", integrationsRouter);
  app.use("/teacher", teacherRouter);
  app.use("/student", studentRouter);
  app.use("/bbb", bbbRouter);
  app.use("/forum", forumRouter);
  app.use("/admin/forum", adminForumRouter);

  app.use((req, res) => {
    res.status(404).json({ error: "Not Found" });
  });

  // Error handler (prevents crashes from async route errors)
  app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    // eslint-disable-next-line no-console
    console.error(err);
    res.status(500).json({ error: "Internal Server Error" });
  });

  return app;
}

