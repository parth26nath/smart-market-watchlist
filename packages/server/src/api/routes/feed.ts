import { Router } from "express";
import { SystemClock } from "../../domain/clock.js";
import { buildFeedForUser } from "../feedService.js";
import { acknowledgeEvent } from "../../storage/repositories/eventsRepo.js";
import { requireAuth } from "../middleware/auth.js";

export const feedRouter = Router();
feedRouter.use(requireAuth);

const clock = new SystemClock();

/** The default view: what changed since this user last looked, ranked and explained. Read-only — never advances a watermark. */
feedRouter.get("/", async (req, res) => {
  const feed = await buildFeedForUser(req.userId!, clock);
  res.json(feed);
});

/** Per-item dismiss — acknowledges one event without moving the symbol's watermark (DECISIONS.md §3.8). */
feedRouter.post("/events/:id/ack", async (req, res) => {
  const ok = await acknowledgeEvent(req.userId!, req.params.id!);
  if (!ok) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  res.status(204).end();
});
