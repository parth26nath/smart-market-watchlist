export function timeAgo(iso: string | null): string {
  if (!iso) return "never";
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 0) return "just now";
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min} min ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} hr ago`;
  const day = Math.floor(hr / 24);
  if (day < 14) return `${day} day${day === 1 ? "" : "s"} ago`;
  const week = Math.floor(day / 7);
  return `${week} week${week === 1 ? "" : "s"} ago`;
}

export function scoreBucket(score: number): "high" | "mid" | "low" {
  if (score >= 75) return "high";
  if (score >= 45) return "mid";
  return "low";
}

export function formatMetricValue(v: number | string): string {
  if (typeof v === "string") return v;
  if (Number.isInteger(v) && Math.abs(v) >= 1000) return v.toLocaleString();
  return String(v);
}

export function metricLabel(key: string): string {
  return key.replace(/_/g, " ");
}

export const EVENT_TYPE_LABEL: Record<string, string> = {
  price_move: "Price move",
  volume_anomaly: "Volume anomaly",
  session_gap: "Session gap",
  structural_level: "Structural level",
  correlation_break: "Correlation break",
};
