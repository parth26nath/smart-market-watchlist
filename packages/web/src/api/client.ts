import type { AuthResponseDTO, FeedResponseDTO, WatchlistDTO } from "@watchlist/shared";

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
  }
}

// In local dev, Vite proxies /api to the backend (same-origin, cookies just work).
// On a static host with no backend colocated (e.g. a frontend-only Vercel deploy),
// point this at a separately-deployed API via VITE_API_BASE at build time.
const API_BASE = import.meta.env.VITE_API_BASE ?? "/api";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    credentials: "include",
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  if (res.status === 204) return undefined as T;
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new ApiError(body.error ?? `request_failed_${res.status}`, res.status);
  }
  return res.json();
}

export const api = {
  signup: (email: string, password: string) => request<AuthResponseDTO>("/auth/signup", { method: "POST", body: JSON.stringify({ email, password }) }),
  login: (email: string, password: string) => request<AuthResponseDTO>("/auth/login", { method: "POST", body: JSON.stringify({ email, password }) }),
  logout: () => request<void>("/auth/logout", { method: "POST" }),
  me: () => request<{ userId: string }>("/auth/me"),

  getFeed: () => request<FeedResponseDTO>("/feed"),
  ackEvent: (id: string) => request<void>(`/feed/events/${id}/ack`, { method: "POST" }),

  getWatchlists: () => request<{ watchlists: WatchlistDTO[] }>("/watchlists"),
  createWatchlist: (name: string) => request<{ watchlist: WatchlistDTO }>("/watchlists", { method: "POST", body: JSON.stringify({ name }) }),
  renameWatchlist: (id: string, name: string) => request<void>(`/watchlists/${id}`, { method: "PATCH", body: JSON.stringify({ name }) }),
  deleteWatchlist: (id: string) => request<void>(`/watchlists/${id}`, { method: "DELETE" }),
  addSymbol: (watchlistId: string, symbol: string, alias?: string) =>
    request<void>(`/watchlists/${watchlistId}/items`, { method: "POST", body: JSON.stringify({ symbol, alias }) }),
  removeSymbol: (watchlistId: string, symbol: string) => request<void>(`/watchlists/${watchlistId}/items/${symbol}`, { method: "DELETE" }),
  setThresholds: (watchlistId: string, symbol: string, thresholds: { high?: number | null; low?: number | null }) =>
    request<void>(`/watchlists/${watchlistId}/items/${symbol}/thresholds`, { method: "PATCH", body: JSON.stringify(thresholds) }),
  markSeen: (watchlistId: string, symbol: string) => request<void>(`/watchlists/${watchlistId}/items/${symbol}/mark-seen`, { method: "POST" }),

  getSymbols: () => request<{ symbols: { symbol: string; name: string; sector: string }[] }>("/symbols"),
};
