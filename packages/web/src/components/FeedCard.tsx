import type { SymbolCardDTO } from "@watchlist/shared";
import { EVENT_TYPE_LABEL, formatMetricValue, metricLabel, scoreBucket, timeAgo } from "../util/format.js";

export function FeedCard({
  card,
  onAck,
  onMarkSeen,
}: {
  card: SymbolCardDTO;
  onAck: (eventId: string) => void;
  onMarkSeen: (symbol: string) => void;
}) {
  const bucket = scoreBucket(card.combinedScore);

  return (
    <li className="card">
      <div className="card-top">
        <div>
          <div className="card-symbol-block">
            <span className="card-symbol">{card.symbol}</span>
            <span className="card-name">{card.name}</span>
            {card.quote?.isStale && (
              <span className="badge stale" title={`Last updated ${timeAgo(card.quote.observedAt)}`}>
                stale
              </span>
            )}
            {card.quote?.corporateActionSuspected && (
              <span className="badge corp-action" title="A large overnight move looked split-shaped and was excluded from alerting.">
                possible split — not alerted
              </span>
            )}
          </div>
          <div className="watermark-line">You last checked this {timeAgo(card.watermark.lastAckAt)}.</div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          {card.quote && (
            <span className="card-quote">
              <span className="price">{card.quote.price.toFixed(2)}</span> · as of {timeAgo(card.quote.observedAt)} · {card.quote.source}
            </span>
          )}
          <span className={`score-pill ${bucket}`} title="Combined attention score across all reasons below">
            {Math.round(card.combinedScore)}
          </span>
        </div>
      </div>

      {card.events.length > 0 && (
        <ul className="reasons" style={{ listStyle: "none", padding: 0, margin: "10px 0 0" }}>
          {card.events.map((event) => (
            <li className="reason" key={event.id}>
              <div className="reason-head">
                <div>
                  <span className="reason-type">{EVENT_TYPE_LABEL[event.type] ?? event.type}</span>
                  <span className="reason-headline">{event.headline}</span>
                </div>
                <div className="reason-actions">
                  <button className="button subtle" onClick={() => onAck(event.id)} aria-label={`Mark reviewed: ${event.headline}`}>
                    Mark reviewed
                  </button>
                </div>
              </div>
              <details>
                <summary>Why this score, and the numbers behind it</summary>
                <p className="reason-detail">{event.detail}</p>
                <dl className="metrics">
                  {Object.entries(event.metrics).map(([key, value]) => (
                    <span className="metric" key={key}>
                      {metricLabel(key)}: <b>{formatMetricValue(value)}</b>
                    </span>
                  ))}
                </dl>
              </details>
            </li>
          ))}
        </ul>
      )}

      <div className="card-footer">
        <button className="button subtle" onClick={() => onMarkSeen(card.symbol)}>
          I'm caught up on {card.symbol}
        </button>
      </div>
    </li>
  );
}
