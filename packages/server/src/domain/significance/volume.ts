import { barsAfter, completedBars, effectiveSinceDateKey, trailingWindow } from "./windows.js";
import { medianAbsoluteDeviation, median, saturatingScore, round } from "./stats.js";
import type { ChangeEvent, EngineInput } from "./types.js";

const BASELINE_LOOKBACK = 20;
const MIN_BASELINE_SIZE = 10;
const NOTABLE_Z = 3; // volume is noisier than price — require a bigger deviation before it's a "card"
const SCORE_K = 2.5;

/**
 * One event per notable day since the watermark (not just "today") — a long
 * absence should surface every spike it missed, not silently collapse to the
 * latest one. Median/MAD baseline, not mean/stdev: volume is right-skewed and
 * a single past spike would otherwise mask the next one (DECISIONS.md §3.3).
 */
export function computeVolumeAnomalyEvents(input: EngineInput): ChangeEvent[] {
  const { target, watermark } = input;
  const complete = completedBars(target.bars);
  const candidates = barsAfter(complete, effectiveSinceDateKey(watermark.asOf, complete));
  if (candidates.length === 0) return [];

  const events: ChangeEvent[] = [];
  for (const candidate of candidates) {
    const idx = complete.findIndex((b) => b.sessionDate === candidate.sessionDate);
    const baseline = trailingWindow(complete, idx, BASELINE_LOOKBACK);
    if (baseline.length < MIN_BASELINE_SIZE) continue; // insufficient history for this day

    const volumes = baseline.map((b) => b.volume);
    const baselineMedian = median(volumes);
    const mad = medianAbsoluteDeviation(volumes);
    if (!Number.isFinite(mad) || mad <= 0) continue;

    const z = (candidate.volume - baselineMedian) / mad;
    if (Math.abs(z) < NOTABLE_Z) continue;

    const score = saturatingScore(Math.abs(z), SCORE_K);
    const ratio = baselineMedian > 0 ? candidate.volume / baselineMedian : Infinity;
    events.push({
      type: "volume_anomaly",
      windowKey: candidate.sessionDate,
      score: round(score, 1),
      rawStat: round(z, 2),
      headline: `${target.symbol} traded ${round(ratio, 1)}× its typical volume on ${candidate.sessionDate}.`,
      detail:
        `Volume was ${Math.round(candidate.volume).toLocaleString()} vs a typical ` +
        `${Math.round(baselineMedian).toLocaleString()} (median of the trailing ${baseline.length} sessions) — ` +
        `a ${round(Math.abs(z), 2)}σ-equivalent deviation using a robust median/MAD baseline.`,
      metrics: {
        volume: candidate.volume,
        baseline_median: round(baselineMedian, 0),
        mad: round(mad, 0),
        z_score: round(z, 3),
        session_date: candidate.sessionDate,
      },
      windowStart: `${candidate.sessionDate}T00:00:00.000Z`,
    });
  }
  return events;
}
