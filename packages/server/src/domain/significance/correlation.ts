import { barsAfter, completedBars, effectiveSinceDateKey } from "./windows.js";
import { logReturn, mean, pearsonCorrelation, saturatingScore, stdev, round } from "./stats.js";
import type { ChangeEvent, DailyBar, EngineInput } from "./types.js";

const LOOKBACK = 60; // "regime" window for correlation/beta estimation
const MIN_TRAINING_PAIRS = 20;
const MIN_PEERS_REPORTING = 2;
const PEER_COHERENCE_FACTOR = 0.5; // peers must move at least this fraction of their typical move
const PEER_DISPERSION_TOLERANCE = 2; // candidate-day peer disagreement vs. training-window baseline
const NOTABLE_Z = 2;
const SCORE_K = 1.5;

/** date ("YYYY-MM-DD") -> log return, skipping any pair touching a suspected corporate action. */
function returnsByDate(bars: DailyBar[]): Map<string, number> {
  const out = new Map<string, number>();
  for (let i = 1; i < bars.length; i++) {
    const prev = bars[i - 1]!;
    const cur = bars[i]!;
    if (prev.corporateActionSuspected || cur.corporateActionSuspected) continue;
    out.set(cur.sessionDate, logReturn(prev.close, cur.close));
  }
  return out;
}

/**
 * Rolling market-model residual against the symbol's sector peers: "everything
 * around it moved, and it didn't (or moved the other way)." This is the
 * originality bet described in DECISIONS.md §3.6 — sized down from a full
 * multi-factor model to something a hackathon can implement and verify.
 *
 * Two gates before this ever fires, both there to stop a data problem from
 * masquerading as a signal: peers must have actually moved together in a
 * meaningful, mutually-consistent way on the candidate day, or the "expected"
 * side of the comparison isn't trustworthy and we say nothing rather than guess.
 */
export function computeCorrelationBreakEvents(input: EngineInput): ChangeEvent[] {
  const { target, peers, watermark } = input;
  if (peers.length < MIN_PEERS_REPORTING) return [];

  const targetComplete = completedBars(target.bars);
  const targetReturns = returnsByDate(targetComplete);
  const peerReturnMaps = peers.map((p) => returnsByDate(completedBars(p.bars)));

  const candidates = barsAfter(targetComplete, effectiveSinceDateKey(watermark.asOf, targetComplete));
  const events: ChangeEvent[] = [];

  for (const candidate of candidates) {
    const date = candidate.sessionDate;
    const targetReturn = targetReturns.get(date);
    if (targetReturn === undefined) continue;

    const peerReturnsToday = peerReturnMaps.map((m) => m.get(date)).filter((r): r is number => r !== undefined);
    if (peerReturnsToday.length < MIN_PEERS_REPORTING) continue; // sector too stale/thin to trust today

    const peerAvgToday = mean(peerReturnsToday);

    // Build the training window: aligned (target, peerAvg) pairs strictly before this date.
    const allDates = targetComplete.map((b) => b.sessionDate).filter((d) => d < date);
    const trainDates = allDates.slice(-LOOKBACK);
    const trainTarget: number[] = [];
    const trainPeerAvg: number[] = [];
    const perDayPeerDispersion: number[] = [];
    for (const d of trainDates) {
      const tr = targetReturns.get(d);
      const pr = peerReturnMaps.map((m) => m.get(d)).filter((r): r is number => r !== undefined);
      if (tr === undefined || pr.length < MIN_PEERS_REPORTING) continue;
      trainTarget.push(tr);
      trainPeerAvg.push(mean(pr));
      if (pr.length >= 2) perDayPeerDispersion.push(stdev(pr));
    }
    if (trainTarget.length < MIN_TRAINING_PAIRS) continue; // insufficient history — no guess

    const correlation = pearsonCorrelation(trainTarget, trainPeerAvg);
    const peerSigma = stdev(trainPeerAvg);
    const targetSigma = stdev(trainTarget);
    if (!Number.isFinite(correlation) || !Number.isFinite(peerSigma) || peerSigma <= 0) continue;

    const beta = correlation * (targetSigma / peerSigma);
    const residualsTrain = trainTarget.map((tr, i) => tr - beta * trainPeerAvg[i]!);
    const residualStdev = stdev(residualsTrain);
    if (!Number.isFinite(residualStdev) || residualStdev <= 0) continue;

    // Gate 1: did the sector actually move today, meaningfully?
    const peerTypicalMove = mean(trainPeerAvg.map((r) => Math.abs(r)));
    if (Math.abs(peerAvgToday) < PEER_COHERENCE_FACTOR * peerTypicalMove) continue;

    // Gate 2: do peers agree with each other today, or is this just noisy/stale data?
    if (perDayPeerDispersion.length >= MIN_TRAINING_PAIRS / 2 && peerReturnsToday.length >= 2) {
      const baselineDispersion = mean(perDayPeerDispersion);
      const todayDispersion = stdev(peerReturnsToday);
      if (Number.isFinite(baselineDispersion) && baselineDispersion > 0 && Number.isFinite(todayDispersion)) {
        if (todayDispersion > PEER_DISPERSION_TOLERANCE * baselineDispersion) continue; // peers disagree — sector signal unreliable today
      }
    }

    const expected = beta * peerAvgToday;
    const residual = targetReturn - expected;
    const z = residual / residualStdev;
    if (Math.abs(z) < NOTABLE_Z) continue;

    const score = saturatingScore(Math.abs(z), SCORE_K);
    const direction = residual >= 0 ? "outperformed" : "underperformed";
    const peerPct = round((Math.exp(peerAvgToday) - 1) * 100, 2);
    const targetPct = round((Math.exp(targetReturn) - 1) * 100, 2);

    events.push({
      type: "correlation_break",
      windowKey: date,
      score: round(score, 1),
      rawStat: round(z, 2),
      headline: `${target.symbol} ${direction} its sector on ${date} — moved against the usual pattern.`,
      detail:
        `Sector peers averaged ${peerPct}% while ${target.symbol} moved ${targetPct}% — given their normal ` +
        `${round(correlation, 2)} correlation, ${target.symbol} was expected near ${round((Math.exp(expected) - 1) * 100, 2)}%. ` +
        `The ${round(Math.abs(z), 2)}σ residual suggests something symbol-specific, not sector-wide.`,
      metrics: {
        target_return_pct: targetPct,
        peer_return_pct: peerPct,
        correlation: round(correlation, 3),
        residual_z: round(z, 3),
        session_date: date,
        peers_reporting: peerReturnsToday.length,
      },
      windowStart: `${date}T00:00:00.000Z`,
    });
  }

  return events;
}
