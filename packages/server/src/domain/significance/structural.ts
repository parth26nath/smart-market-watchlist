import { barsAfter, completedBars, effectiveSinceDateKey, trailingWindow } from "./windows.js";
import { saturatingScore, round } from "./stats.js";
import type { ChangeEvent, EngineInput } from "./types.js";

const RANGE_LOOKBACK = 20;
const SCORE_K_BREAKOUT = 0.05; // breakout magnitude is a fraction of price, so k is small
const SCORE_FLAT_THRESHOLD = 70; // a threshold crossing is binary — score it as a firm, non-saturating signal

/**
 * Two brief bullets ("user threshold crossing" and "streak/regime change: broke
 * a multi-day range") implemented as one mechanism: both are "price relative to
 * a level, fired on the crossing edge, not on standing above/below it" — see
 * DECISIONS.md §3.5 for why building these as two separate features would be
 * duplicated code for no extra signal.
 */
export function computeStructuralLevelEvents(input: EngineInput): ChangeEvent[] {
  const { target, watermark, thresholds } = input;
  const complete = completedBars(target.bars);
  const candidates = barsAfter(complete, effectiveSinceDateKey(watermark.asOf, complete));

  const events: ChangeEvent[] = [];
  for (const candidate of candidates) {
    const idx = complete.findIndex((b) => b.sessionDate === candidate.sessionDate);
    if (idx <= 0) continue;
    const prev = complete[idx - 1]!;

    // --- Rolling N-session range breakout (a.k.a. streak/regime change) ---
    const window = trailingWindow(complete, idx, RANGE_LOOKBACK);
    if (window.length >= RANGE_LOOKBACK) {
      const priorHigh = Math.max(...window.map((b) => b.high));
      const priorLow = Math.min(...window.map((b) => b.low));

      if (candidate.close > priorHigh) {
        const magnitude = (candidate.close - priorHigh) / priorHigh;
        events.push(breakoutEvent(target.symbol, candidate.sessionDate, "high", priorHigh, candidate.close, magnitude));
      } else if (candidate.close < priorLow) {
        const magnitude = (priorLow - candidate.close) / priorLow;
        events.push(breakoutEvent(target.symbol, candidate.sessionDate, "low", priorLow, candidate.close, magnitude));
      }
    }

    // --- User-defined threshold crossing (edge-triggered) ---
    if (thresholds?.high !== undefined && prev.close <= thresholds.high && candidate.close > thresholds.high) {
      events.push(thresholdEvent(target.symbol, candidate.sessionDate, "above", thresholds.high, candidate.close));
    }
    if (thresholds?.low !== undefined && prev.close >= thresholds.low && candidate.close < thresholds.low) {
      events.push(thresholdEvent(target.symbol, candidate.sessionDate, "below", thresholds.low, candidate.close));
    }
  }
  return events;
}

function breakoutEvent(
  symbol: string,
  sessionDate: string,
  side: "high" | "low",
  priorLevel: number,
  close: number,
  magnitude: number,
): ChangeEvent {
  const score = saturatingScore(magnitude, SCORE_K_BREAKOUT);
  const label = side === "high" ? `a new ${RANGE_LOOKBACK}-session high` : `a new ${RANGE_LOOKBACK}-session low`;
  return {
    type: "structural_level",
    windowKey: `${sessionDate}:breakout_${side}`,
    score: round(score, 1),
    rawStat: round(magnitude, 4),
    headline: `${symbol} broke ${label} on ${sessionDate}.`,
    detail: `Closed at ${round(close, 2)}, ${side === "high" ? "above" : "below"} the prior ${RANGE_LOOKBACK}-session ${side} of ${round(priorLevel, 2)} — a possible regime change rather than noise within the recent range.`,
    metrics: { close, prior_level: round(priorLevel, 2), session_date: sessionDate, side },
    windowStart: `${sessionDate}T00:00:00.000Z`,
  };
}

function thresholdEvent(
  symbol: string,
  sessionDate: string,
  direction: "above" | "below",
  level: number,
  close: number,
): ChangeEvent {
  return {
    type: "structural_level",
    windowKey: `${sessionDate}:threshold_${direction}`,
    score: SCORE_FLAT_THRESHOLD,
    rawStat: 1,
    headline: `${symbol} crossed ${direction} your ${round(level, 2)} level on ${sessionDate}.`,
    detail: `Closed at ${round(close, 2)}, crossing ${direction} the ${round(level, 2)} level you set. This fires once on the crossing — it won't repeat while price sits ${direction} it.`,
    metrics: { close, threshold: level, session_date: sessionDate, direction },
    windowStart: `${sessionDate}T00:00:00.000Z`,
  };
}
