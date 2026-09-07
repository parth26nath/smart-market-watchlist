import { tradingSessionsElapsed } from "../marketSession.js";
import { cleanDailyReturns, completedBars } from "./windows.js";
import { logReturn, saturatingScore, stdev, round } from "./stats.js";
import type { ChangeEvent, EngineInput } from "./types.js";

const MIN_RETURNS_FOR_SIGMA = 10;
const SIGMA_LOOKBACK_SESSIONS = 20;
const MIN_SESSIONS_ELAPSED_FLOOR = 0.05; // ~20 minutes; stops the denominator collapsing on very short absences
const SCORE_K = 1.8; // saturating-transform constant, see stats.saturatingScore
const NOTABLE_Z = 1.5; // below this, the move isn't worth a card at all

export function computePriceMoveEvent(input: EngineInput): ChangeEvent | null {
  const { target, watermark, now } = input;
  const latest = target.latestObservation;
  if (!latest) return null;

  const bars = target.bars;
  const complete = completedBars(bars);
  const returns = cleanDailyReturns(complete).slice(-SIGMA_LOOKBACK_SESSIONS);
  if (returns.length < MIN_RETURNS_FOR_SIGMA) return null; // insufficient history — no fabricated score

  const sigmaDaily = stdev(returns);
  if (!Number.isFinite(sigmaDaily) || sigmaDaily <= 0) return null;

  // Resolve the watermark price/time. No prior watch (`asOf === null`) means
  // "show the full backlog once" — baseline against the earliest bar we have.
  let watermarkAsOf: string;
  let watermarkPrice: number;
  if (watermark.asOf === null || watermark.price === null) {
    const earliest = bars[0];
    if (!earliest) return null;
    watermarkAsOf = `${earliest.sessionDate}T00:00:00.000Z`;
    watermarkPrice = earliest.open;
  } else {
    watermarkAsOf = watermark.asOf;
    watermarkPrice = watermark.price;
  }

  if (latest.asOf <= watermarkAsOf) return null; // nothing newer than what was already seen

  const sessionsElapsed = Math.max(
    tradingSessionsElapsed(watermarkAsOf, latest.asOf),
    MIN_SESSIONS_ELAPSED_FLOOR,
  );

  const move = logReturn(watermarkPrice, latest.price);
  const z = move / (sigmaDaily * Math.sqrt(sessionsElapsed));
  const absZ = Math.abs(z);
  if (absZ < NOTABLE_Z) return null;

  const score = saturatingScore(absZ, SCORE_K);
  const direction = move >= 0 ? "up" : "down";
  const movePct = round((Math.exp(move) - 1) * 100, 2);
  const sessionsLabel =
    sessionsElapsed < 1 ? `${round(sessionsElapsed * 100, 0)}% of a session` : `${round(sessionsElapsed, 1)} sessions`;

  return {
    type: "price_move",
    windowKey: watermark.asOf ?? "genesis",
    score: round(score, 1),
    rawStat: round(z, 2),
    headline: `${target.symbol} moved ${direction} ${Math.abs(movePct)}% since you last checked (${sessionsLabel} ago) — a ${round(absZ, 1)}σ move for this name.`,
    detail:
      `Price went from ${round(watermarkPrice, 2)} to ${round(latest.price, 2)} ` +
      `(${direction === "up" ? "+" : ""}${movePct}%). Normalised against this symbol's realised daily volatility ` +
      `(σ=${round(sigmaDaily * 100, 2)}%/session over the last ${returns.length} sessions) and the ${sessionsLabel} elapsed, ` +
      `that's a ${round(absZ, 2)}σ move — ${absZ >= 3 ? "well beyond" : "beyond"} what this name typically does in that span.`,
    metrics: {
      move_pct: movePct,
      z_score: round(z, 3),
      sigma_daily_pct: round(sigmaDaily * 100, 3),
      sessions_elapsed: round(sessionsElapsed, 3),
      price_watermark: round(watermarkPrice, 4),
      price_now: round(latest.price, 4),
    },
    windowStart: watermarkAsOf,
  };
}
