import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import { authRouter } from "./routes/auth.js";
import { watchlistsRouter } from "./routes/watchlists.js";
import { feedRouter } from "./routes/feed.js";
import { symbolsRouter } from "./routes/symbols.js";
import { logger } from "../logger.js";

export function createApp() {
  const app = express();
  app.use(cors({ origin: process.env.WEB_ORIGIN ?? "http://localhost:5173", credentials: true }));
  app.use(express.json());
  app.use(cookieParser());

  app.get("/api/health", (_req, res) => res.json({ ok: true }));
  app.use("/api/auth", authRouter);
  app.use("/api/watchlists", watchlistsRouter);
  app.use("/api/feed", feedRouter);
  app.use("/api/symbols", symbolsRouter);

  // Central error handler — a thrown/rejected error becomes a 500 with no stack
  // leak, never a crashed process (DECISIONS.md §4: the app degrades, it doesn't break).
  app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    logger.error("api.unhandled_error", { error: (err as Error)?.message ?? String(err) });
    res.status(500).json({ error: "internal_error" });
  });

  return app;
}
