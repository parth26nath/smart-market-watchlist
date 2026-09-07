import { computePriceMoveEvent } from "./priceMove.js";
import { computeVolumeAnomalyEvents } from "./volume.js";
import { computeSessionGapEvents } from "./gap.js";
import { computeStructuralLevelEvents } from "./structural.js";
import { computeCorrelationBreakEvents } from "./correlation.js";
import { combineScoresNoisyOr, round } from "./stats.js";
import type { ChangeEvent, EngineInput } from "./types.js";

/**
 * The whole significance engine, in one call: (history, watermark) -> scored,
 * explained change events, best-first. Pure — no I/O, no wall clock. This is
 * the function the API layer calls once per watched symbol per feed request,
 * and the only function this module needs tested end-to-end (its five
 * sub-detectors are each independently tested too — see test/significance/).
 */
export function computeChangeEvents(input: EngineInput): ChangeEvent[] {
  const events: ChangeEvent[] = [];

  const priceMove = computePriceMoveEvent(input);
  if (priceMove) events.push(priceMove);

  events.push(...computeVolumeAnomalyEvents(input));
  events.push(...computeSessionGapEvents(input));
  events.push(...computeStructuralLevelEvents(input));
  events.push(...computeCorrelationBreakEvents(input));

  return events.sort((a, b) => b.score - a.score);
}

/** Noisy-OR combination for "several things happened to this symbol" — see DECISIONS.md §3.7. */
export function combinedSymbolScore(events: ChangeEvent[]): number {
  return round(combineScoresNoisyOr(events.map((e) => e.score)), 1);
}
