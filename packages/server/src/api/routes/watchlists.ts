import { Router } from "express";
import { z } from "zod";
import * as watchlistsRepo from "../../storage/repositories/watchlistsRepo.js";
import * as symbolsRepo from "../../storage/repositories/symbolsRepo.js";
import { advanceWatermark } from "../../storage/repositories/watermarksRepo.js";
import { getLatestGoodObservation } from "../../storage/repositories/observationsRepo.js";
import { requireAuth } from "../middleware/auth.js";
import type { WatchlistDTO } from "@watchlist/shared";

export const watchlistsRouter = Router();
watchlistsRouter.use(requireAuth);

function toDTO(wl: Awaited<ReturnType<typeof watchlistsRepo.listWatchlists>>[number]): WatchlistDTO {
  return {
    id: wl.id,
    name: wl.name,
    createdAt: wl.createdAt.toISOString(),
    items: wl.items.map((item) => ({
      symbol: item.symbol,
      alias: item.alias,
      addedAt: item.addedAt.toISOString(),
      thresholdHigh: item.thresholdHigh,
      thresholdLow: item.thresholdLow,
    })),
  };
}

watchlistsRouter.get("/", async (req, res) => {
  const lists = await watchlistsRepo.listWatchlists(req.userId!);
  res.json({ watchlists: lists.map(toDTO) });
});

watchlistsRouter.post("/", async (req, res) => {
  const parsed = z.object({ name: z.string().min(1).max(80) }).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_input" });
    return;
  }
  const wl = await watchlistsRepo.createWatchlist(req.userId!, parsed.data.name);
  res.status(201).json({ watchlist: toDTO({ ...wl, items: [] }) });
});

watchlistsRouter.patch("/:id", async (req, res) => {
  const parsed = z.object({ name: z.string().min(1).max(80) }).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_input" });
    return;
  }
  const ok = await watchlistsRepo.renameWatchlist(req.userId!, req.params.id!, parsed.data.name);
  if (!ok) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  res.status(204).end();
});

watchlistsRouter.delete("/:id", async (req, res) => {
  const ok = await watchlistsRepo.deleteWatchlist(req.userId!, req.params.id!);
  if (!ok) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  res.status(204).end();
});

const addItemSchema = z.object({
  symbol: z
    .string()
    .min(1)
    .max(10)
    .transform((s) => s.toUpperCase()),
  alias: z.string().max(40).optional(),
});

watchlistsRouter.post("/:id/items", async (req, res) => {
  const parsed = addItemSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_input" });
    return;
  }
  const meta = await symbolsRepo.getSymbolMeta(parsed.data.symbol);
  if (!meta) {
    res.status(422).json({ error: "unknown_symbol", message: `${parsed.data.symbol} isn't in the demo universe.` });
    return;
  }
  const ok = await watchlistsRepo.addSymbolToWatchlist(req.userId!, req.params.id!, parsed.data.symbol, parsed.data.alias);
  if (!ok) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  res.status(201).end();
});

watchlistsRouter.delete("/:id/items/:symbol", async (req, res) => {
  const ok = await watchlistsRepo.removeSymbolFromWatchlist(req.userId!, req.params.id!, req.params.symbol!.toUpperCase());
  if (!ok) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  res.status(204).end();
});

const thresholdsSchema = z.object({ high: z.number().positive().nullable().optional(), low: z.number().positive().nullable().optional() });

watchlistsRouter.patch("/:id/items/:symbol/thresholds", async (req, res) => {
  const parsed = thresholdsSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_input" });
    return;
  }
  const ok = await watchlistsRepo.setThresholds(req.userId!, req.params.id!, req.params.symbol!.toUpperCase(), parsed.data);
  if (!ok) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  res.status(204).end();
});

/** Explicit "I'm caught up" action — advances this symbol's watermark to the latest known price (DECISIONS.md §1). */
watchlistsRouter.post("/:id/items/:symbol/mark-seen", async (req, res) => {
  const symbol = req.params.symbol!.toUpperCase();
  const latest = await getLatestGoodObservation(symbol);
  if (!latest) {
    res.status(404).json({ error: "no_data_yet" });
    return;
  }
  await advanceWatermark({ userId: req.userId!, symbol, asOf: latest.asOf, price: latest.price });
  res.status(204).end();
});
