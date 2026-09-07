import type { Clock } from "../domain/clock.js";
import { SystemClock } from "../domain/clock.js";

export type CircuitState = "closed" | "open" | "half_open";

/**
 * One breaker per provider. On sustained failure it opens and callers should
 * serve last-known-good data instead of hammering a dead upstream; after a
 * cooldown it lets one probe through (half-open) before fully closing again.
 * (DECISIONS.md §4 — "a provider being down must never produce a blank screen.")
 */
export class CircuitBreaker {
  private state: CircuitState = "closed";
  private consecutiveFailures = 0;
  private openedAt: number | null = null;

  constructor(
    private readonly failureThreshold = 5,
    private readonly cooldownMs = 30_000,
    private readonly clock: Clock = new SystemClock(),
  ) {}

  canAttempt(): boolean {
    if (this.state !== "open") return true;
    if (this.openedAt !== null && this.clock.now().getTime() - this.openedAt >= this.cooldownMs) {
      this.state = "half_open";
      return true;
    }
    return false;
  }

  onSuccess(): void {
    this.consecutiveFailures = 0;
    this.state = "closed";
    this.openedAt = null;
  }

  onFailure(): void {
    this.consecutiveFailures++;
    if (this.state === "half_open" || this.consecutiveFailures >= this.failureThreshold) {
      this.state = "open";
      this.openedAt = this.clock.now().getTime();
    }
  }

  getState(): CircuitState {
    return this.state;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Exponential backoff with jitter, bounded attempts. Only retries errors explicitly marked retryable. */
export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  opts: { maxAttempts?: number; baseDelayMs?: number } = {},
): Promise<T> {
  const maxAttempts = opts.maxAttempts ?? 3;
  const baseDelayMs = opts.baseDelayMs ?? 200;
  let lastError: unknown;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      const retryable = (err as { retryable?: boolean })?.retryable !== false;
      if (!retryable || attempt === maxAttempts - 1) throw err;
      const delay = baseDelayMs * 2 ** attempt * (0.5 + Math.random() * 0.5);
      await sleep(delay);
    }
  }
  throw lastError;
}
