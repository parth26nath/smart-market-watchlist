// Input/output shapes for the significance engine. Deliberately not the Prisma
// models — this module must stay importable with zero DB/HTTP dependencies.

export type ChangeEventType =
  | "price_move"
  | "volume_anomaly"
  | "session_gap"
  | "structural_level"
  | "correlation_break";

export interface DailyBar {
  /** Exchange-local calendar date, "YYYY-MM-DD". */
  sessionDate: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  /** True once the session has closed; a same-day bar mid-session is provisional. */
  isProvisional: boolean;
  /** Set by ingestion's corporate-action guard — see domain/corporateAction.ts. */
  corporateActionSuspected: boolean;
}

export interface LatestObservation {
  asOf: string; // ISO
  price: number;
}

export interface SymbolHistory {
  symbol: string;
  sector: string;
  /** Ascending by sessionDate, oldest first. */
  bars: DailyBar[];
  latestObservation: LatestObservation | null;
}

/** A same-sector peer's bar history, used only for the correlation-break signal. */
export interface PeerHistory {
  symbol: string;
  bars: DailyBar[];
}

export interface Watermark {
  /** ISO timestamp of the position the user last acknowledged; null = never watched before (full backlog counts as new, once). */
  asOf: string | null;
  /** The price observed at that exact watermark position; null iff asOf is null. */
  price: number | null;
}

export interface UserThresholds {
  high?: number;
  low?: number;
}

export interface EngineInput {
  /** Injected "now" — the engine never reads the wall clock. */
  now: string;
  target: SymbolHistory;
  peers: PeerHistory[];
  watermark: Watermark;
  thresholds?: UserThresholds;
}

export interface ChangeEvent {
  type: ChangeEventType;
  /** Identity key for dedup/idempotency — see DECISIONS.md §3.8. */
  windowKey: string;
  score: number; // 0-100
  rawStat: number;
  headline: string;
  detail: string;
  metrics: Record<string, number | string>;
  windowStart: string; // ISO — start of the (watermark, now] slice this event covers
}

export interface SkippedReason {
  type: ChangeEventType;
  reason: "insufficient_history" | "no_data_since_watermark" | "peers_unreliable";
}
