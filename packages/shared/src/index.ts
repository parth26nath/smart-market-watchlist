// Types shared between server and web so the API boundary can't silently drift.
// Kept intentionally small — this is DTO shapes only, no logic.

export type ChangeEventType =
  | "price_move"
  | "volume_anomaly"
  | "session_gap"
  | "structural_level"
  | "correlation_break";

export type MarketSessionState = "pre" | "open" | "post" | "closed";

export interface QuoteDTO {
  symbol: string;
  price: number;
  asOf: string; // ISO timestamp — provider/exchange time
  observedAt: string; // ISO timestamp — when we fetched it
  ageSeconds: number; // derived at read time: now - observedAt
  isStale: boolean; // derived: ageSeconds beyond the symbol's tier-appropriate freshness bound
  source: string;
  sessionState: MarketSessionState;
  corporateActionSuspected: boolean;
}

export interface ChangeEventDTO {
  id: string;
  symbol: string;
  type: ChangeEventType;
  score: number; // 0-100, saturating transform of the underlying statistic
  headline: string; // plain-language reason
  detail: string; // longer plain-language explanation
  metrics: Record<string, number | string>; // the numbers behind the headline, traceable
  detectedAt: string;
  lastUpdatedAt: string;
  windowStart: string; // start of the (watermark, now] window this event was computed over
  acknowledgedAt: string | null;
}

export interface SymbolCardDTO {
  symbol: string;
  name: string;
  sector: string;
  quote: QuoteDTO | null; // null if we have never successfully ingested this symbol
  watermark: {
    lastAckAt: string | null; // null => never seen, full backlog is "new"
  };
  events: ChangeEventDTO[]; // events for this symbol since the watermark, best-first
  combinedScore: number; // noisy-OR combination of `events[].score`
}

export interface FeedResponseDTO {
  generatedAt: string;
  marketSessionState: MarketSessionState;
  marketSessionNote: string; // e.g. "Market closed since 16:00 ET · nothing new since close"
  providerDegraded: boolean;
  cards: SymbolCardDTO[]; // ranked by combinedScore desc; zero-event symbols included last for the table view
}

export interface WatchlistDTO {
  id: string;
  name: string;
  createdAt: string;
  items: WatchlistItemDTO[];
}

export interface WatchlistItemDTO {
  symbol: string;
  alias: string | null;
  addedAt: string;
  thresholdHigh: number | null;
  thresholdLow: number | null;
}

export interface UserDTO {
  id: string;
  email: string;
}

export interface AuthResponseDTO {
  user: UserDTO;
}
