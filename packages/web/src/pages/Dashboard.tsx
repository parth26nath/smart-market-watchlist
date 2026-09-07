import { useCallback, useEffect, useRef, useState } from "react";
import type { FeedResponseDTO, WatchlistDTO } from "@watchlist/shared";
import { api } from "../api/client.js";
import { SessionBanner } from "../components/SessionBanner.js";
import { FeedView } from "../components/FeedView.js";
import { TableView } from "../components/TableView.js";
import { ManageView } from "../components/ManageView.js";

type Tab = "feed" | "table" | "manage";
const POLL_INTERVAL_MS = 20_000;

export function Dashboard({ onSignedOut }: { onSignedOut: () => void }) {
  const [tab, setTab] = useState<Tab>("feed");
  const [feed, setFeed] = useState<FeedResponseDTO | null>(null);
  const [watchlists, setWatchlists] = useState<WatchlistDTO[]>([]);
  const [symbolOptions, setSymbolOptions] = useState<{ symbol: string; name: string; sector: string }[]>([]);
  const [activeWatchlistId, setActiveWatchlistId] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");

  const refreshFeed = useCallback(async () => {
    const next = await api.getFeed();
    setFeed(next);
    const withNews = next.cards.filter((c) => c.events.length > 0).length;
    setAnnouncement(withNews > 0 ? `Feed updated: ${withNews} symbol${withNews === 1 ? "" : "s"} need attention.` : "Feed updated: nothing new.");
  }, []);

  const refreshWatchlists = useCallback(async () => {
    const { watchlists: lists } = await api.getWatchlists();
    setWatchlists(lists);
    setActiveWatchlistId((prev) => prev ?? lists[0]?.id ?? null);
  }, []);

  useEffect(() => {
    refreshFeed();
    refreshWatchlists();
    api.getSymbols().then((r) => setSymbolOptions(r.symbols));
  }, [refreshFeed, refreshWatchlists]);

  const pollRef = useRef(refreshFeed);
  pollRef.current = refreshFeed;
  useEffect(() => {
    const id = setInterval(() => pollRef.current(), POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, []);

  async function handleAck(eventId: string) {
    await api.ackEvent(eventId);
    refreshFeed();
  }

  async function handleMarkSeen(symbol: string) {
    const wl = watchlists.find((w) => w.items.some((i) => i.symbol === symbol));
    if (!wl) return;
    await api.markSeen(wl.id, symbol);
    refreshFeed();
  }

  async function handleLogout() {
    await api.logout();
    onSignedOut();
  }

  return (
    <div className="app">
      <header className="app-header">
        <p className="app-title">
          Smart Market Watchlist <span>· what changed, and why it matters</span>
        </p>
        <div className="header-actions">
          <button className="button subtle" onClick={handleLogout}>
            Log out
          </button>
        </div>
      </header>

      <div aria-live="polite" className="sr-only">
        {announcement}
      </div>

      {feed && <SessionBanner feed={feed} />}

      <div className="tabs" role="tablist" aria-label="Views">
        <button className="tab" role="tab" aria-selected={tab === "feed"} onClick={() => setTab("feed")}>
          Attention feed
        </button>
        <button className="tab" role="tab" aria-selected={tab === "table"} onClick={() => setTab("table")}>
          Table
        </button>
        <button className="tab" role="tab" aria-selected={tab === "manage"} onClick={() => setTab("manage")}>
          Manage
        </button>
      </div>

      {!feed && <p className="loading-line">Loading your feed…</p>}

      {feed && tab === "feed" && <FeedView feed={feed} onAck={handleAck} onMarkSeen={handleMarkSeen} />}
      {feed && tab === "table" && <TableView feed={feed} />}
      {tab === "manage" && (
        <ManageView
          watchlists={watchlists}
          activeId={activeWatchlistId}
          onChangeActive={setActiveWatchlistId}
          symbolOptions={symbolOptions}
          onMutated={() => {
            refreshWatchlists();
            refreshFeed();
          }}
        />
      )}
    </div>
  );
}
