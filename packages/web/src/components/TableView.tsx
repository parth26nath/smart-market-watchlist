import type { FeedResponseDTO } from "@watchlist/shared";
import { timeAgo } from "../util/format.js";

/** The secondary view — a plain price grid. Table stakes, kept deliberately unremarkable. */
export function TableView({ feed }: { feed: FeedResponseDTO }) {
  if (feed.cards.length === 0) {
    return (
      <div className="feed-empty">
        <p>No symbols on this watchlist yet.</p>
      </div>
    );
  }
  return (
    <div className="table-wrap">
      <table className="watchlist-table">
        <thead>
          <tr>
            <th scope="col">Symbol</th>
            <th scope="col">Sector</th>
            <th scope="col">Price</th>
            <th scope="col">As of</th>
            <th scope="col">Attention score</th>
          </tr>
        </thead>
        <tbody>
          {feed.cards.map((c) => (
            <tr key={c.symbol}>
              <th scope="row">{c.symbol}</th>
              <td>{c.sector}</td>
              <td className="num">{c.quote ? c.quote.price.toFixed(2) : "—"}</td>
              <td>
                {c.quote ? timeAgo(c.quote.observedAt) : "no data yet"}
                {c.quote?.isStale && " (stale)"}
              </td>
              <td className="num">{Math.round(c.combinedScore)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
