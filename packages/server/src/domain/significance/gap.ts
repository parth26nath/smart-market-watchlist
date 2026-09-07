import { barsAfter, completedBars, trailingWindow } from "./windows.js";
import { averageTrueRange, logReturn, saturatingScore, round } from "./stats.js";
import type { ChangeEvent, EngineInput } from "./types.js";

const ATR_LOOKBACK = 14;
const MIN_ATR_BARS = 8;
const NOTABLE_RATIO = 0.75; // gap must be at least 0.75x the normal daily range to be worth a card
const SCORE_K = 1.2;

/**
 * Overnight/weekend gap sized against ATR14 rather than realised σ — a session
 * boundary behaves differently from an intraday move (a name can have low daily
 * volatility but still gap hard around a scheduled print), so it gets its own
 * yardstick (DECISIONS.md §3.4). A boundary flagged as a suspected corporate
 * action is skipped entirely, never scored as a gap.
 */
export function computeSessionGapEvents(input: EngineInput): ChangeEvent[] {
  const { target, watermark } = input;
  const complete = completedBars(target.bars);
  const candidates = barsAfter(complete, watermark.asOf ? watermark.asOf.slice(0, 10) : null);

  const events: ChangeEvent[] = [];
  for (const candidate of candidates) {
    const idx = complete.findIndex((b) => b.sessionDate === candidate.sessionDate);
    if (idx <= 0) continue; // no prior session to gap from
    const prev = complete[idx - 1]!;
    if (candidate.corporateActionSuspected || prev.corporateActionSuspected) continue;

    const atrWindow = trailingWindow(complete, idx, ATR_LOOKBACK + 1); // needs one extra bar for the first TR's prevClose
    if (atrWindow.length < MIN_ATR_BARS) continue;
    const atr = averageTrueRange(atrWindow);
    if (!Number.isFinite(atr) || atr <= 0) continue;

    const gapAbs = Math.abs(candidate.open - prev.close);
    const ratio = gapAbs / atr;
    if (ratio < NOTABLE_RATIO) continue;

    const gapReturn = logReturn(prev.close, candidate.open);
    const score = saturatingScore(ratio, SCORE_K);
    const direction = gapReturn >= 0 ? "up" : "down";
    const gapPct = round((Math.exp(gapReturn) - 1) * 100, 2);

    events.push({
      type: "session_gap",
      windowKey: candidate.sessionDate,
      score: round(score, 1),
      rawStat: round(ratio, 2),
      headline: `${target.symbol} gapped ${direction} ${Math.abs(gapPct)}% at the open on ${candidate.sessionDate}.`,
      detail:
        `Previous close ${round(prev.close, 2)} → open ${round(candidate.open, 2)} ` +
        `(${direction === "up" ? "+" : ""}${gapPct}%) — ${round(ratio, 2)}× this symbol's average true range ` +
        `(ATR${ATR_LOOKBACK}=${round(atr, 3)}), i.e. a bigger jump than its normal session-to-session range.`,
      metrics: {
        gap_pct: gapPct,
        atr: round(atr, 4),
        gap_to_atr_ratio: round(ratio, 3),
        session_date: candidate.sessionDate,
      },
      windowStart: `${candidate.sessionDate}T00:00:00.000Z`,
    });
  }
  return events;
}
