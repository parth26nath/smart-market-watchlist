import { Router } from "express";
import { listAllSymbols } from "../../storage/repositories/symbolsRepo.js";
import { requireAuth } from "../middleware/auth.js";

export const symbolsRouter = Router();
symbolsRouter.use(requireAuth);

/** The demo universe, for the "add symbol" autocomplete. All prices are synthetic — see README. */
symbolsRouter.get("/", async (_req, res) => {
  const symbols = await listAllSymbols();
  res.json({ symbols: symbols.map((s) => ({ symbol: s.symbol, name: s.name, sector: s.sector })) });
});
