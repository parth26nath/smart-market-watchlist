// Pure bad-tick guard, applied by ingestion before anything touches history or
// baselines (DECISIONS.md §4). No single reading is ever trusted outright: an
// implausible move is quarantined pending confirmation, not silently accepted
// or silently dropped — either extreme lets one bad print corrupt a baseline
// or hide a real (if rare) 20σ event like a halt or a crash.

export type TickVerdict =
  | { outcome: "accept" }
  | { outcome: "reject"; reason: string }
  | { outcome: "quarantine"; reason: string };

const EXTREME_MOVE_SIGMA_MULTIPLE = 20;
const QUARANTINE_CONFIRMATION_TOLERANCE = 0.02; // next tick must hold within 2% to confirm

export function evaluateTick(params: {
  price: number;
  asOf: string; // ISO
  /** Most recent as_of already stored for this symbol from an equal-or-higher-priority source. */
  latestKnownAsOf: string | null;
  /** Last known-good (non-quarantined, non-rejected) price for this symbol. */
  previousGoodPrice: number | null;
  /** Recent realised daily volatility estimate (as a fraction, e.g. 0.02 = 2%/session), if available. */
  sigmaDaily: number | null;
}): TickVerdict {
  const { price, asOf, latestKnownAsOf, previousGoodPrice, sigmaDaily } = params;

  if (!Number.isFinite(price) || price <= 0) {
    return { outcome: "reject", reason: "non-positive or non-finite price" };
  }

  if (latestKnownAsOf !== null && asOf <= latestKnownAsOf) {
    return { outcome: "reject", reason: "out-of-order as_of" };
  }

  if (previousGoodPrice !== null && sigmaDaily !== null && Number.isFinite(sigmaDaily) && sigmaDaily > 0) {
    const impliedReturn = Math.abs(Math.log(price / previousGoodPrice));
    const threshold = EXTREME_MOVE_SIGMA_MULTIPLE * sigmaDaily;
    if (impliedReturn > threshold) {
      return {
        outcome: "quarantine",
        reason: `implausible single-tick move (${(impliedReturn / sigmaDaily).toFixed(1)}σ) pending confirmation`,
      };
    }
  }

  return { outcome: "accept" };
}

/**
 * A quarantined tick is promoted to real only if the next observation confirms
 * it (holds near the same level) rather than snapping back — one bad print can
 * never fire an alert or poison a baseline on its own.
 */
export function isQuarantineConfirmed(quarantinedPrice: number, nextPrice: number): boolean {
  if (quarantinedPrice <= 0) return false;
  return Math.abs(nextPrice - quarantinedPrice) / quarantinedPrice <= QUARANTINE_CONFIRMATION_TOLERANCE;
}
