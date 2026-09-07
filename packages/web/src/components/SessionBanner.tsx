import type { FeedResponseDTO } from "@watchlist/shared";

/**
 * Market-closed / degraded-provider states are designed, not accidental — a
 * closed market with nothing new is communicated as expected behaviour, not
 * an empty error state (DECISIONS.md §4).
 */
export function SessionBanner({ feed }: { feed: FeedResponseDTO }) {
  const cls = feed.providerDegraded ? "degraded" : feed.marketSessionState === "open" ? "open" : "closed";
  return (
    <div className={`session-banner ${cls}`} role="status">
      <span className="dot" aria-hidden="true" />
      <span>{feed.marketSessionNote}</span>
      {feed.providerDegraded && <strong>· some quotes are stale</strong>}
    </div>
  );
}
