import type { FeedResponseDTO } from "@watchlist/shared";
import { FeedCard } from "./FeedCard.js";

export function FeedView({
  feed,
  onAck,
  onMarkSeen,
}: {
  feed: FeedResponseDTO;
  onAck: (eventId: string) => void;
  onMarkSeen: (symbol: string) => void;
}) {
  const withNews = feed.cards.filter((c) => c.events.length > 0);
  const quietCount = feed.cards.length - withNews.length;

  if (feed.cards.length === 0) {
    return (
      <div className="feed-empty">
        <p>Your watchlist is empty. Add a symbol from the Manage tab to start seeing what changes.</p>
      </div>
    );
  }

  if (withNews.length === 0) {
    return (
      <div className="feed-empty" role="status">
        <p>Nothing meaningful has changed since you last checked any of your {feed.cards.length} watched symbols.</p>
      </div>
    );
  }

  return (
    <>
      <ul className="feed-list" aria-label="Attention feed, ranked by significance">
        {withNews.map((card) => (
          <FeedCard key={card.symbol} card={card} onAck={onAck} onMarkSeen={onMarkSeen} />
        ))}
      </ul>
      {quietCount > 0 && (
        <p className="watermark-line" style={{ marginTop: 14, textAlign: "center" }}>
          {quietCount} other watched symbol{quietCount === 1 ? "" : "s"} — nothing new. See the Table tab for the full list.
        </p>
      )}
    </>
  );
}
