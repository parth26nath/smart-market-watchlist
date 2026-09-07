import { useState, type FormEvent } from "react";
import type { WatchlistDTO } from "@watchlist/shared";
import { api, ApiError } from "../api/client.js";

export function ManageView({
  watchlists,
  activeId,
  onChangeActive,
  symbolOptions,
  onMutated,
}: {
  watchlists: WatchlistDTO[];
  activeId: string | null;
  onChangeActive: (id: string) => void;
  symbolOptions: { symbol: string; name: string }[];
  onMutated: () => void;
}) {
  const [newListName, setNewListName] = useState("");
  const [symbolInput, setSymbolInput] = useState("");
  const [error, setError] = useState<string | null>(null);

  const active = watchlists.find((w) => w.id === activeId) ?? null;

  async function createList(e: FormEvent) {
    e.preventDefault();
    if (!newListName.trim()) return;
    const { watchlist } = await api.createWatchlist(newListName.trim());
    setNewListName("");
    onMutated();
    onChangeActive(watchlist.id);
  }

  async function renameList(id: string, currentName: string) {
    const name = window.prompt("Rename watchlist", currentName);
    if (!name || name === currentName) return;
    await api.renameWatchlist(id, name);
    onMutated();
  }

  async function deleteList(id: string) {
    if (watchlists.length <= 1) {
      window.alert("You need at least one watchlist.");
      return;
    }
    if (!window.confirm("Delete this watchlist and everything on it?")) return;
    await api.deleteWatchlist(id);
    onMutated();
    const remaining = watchlists.filter((w) => w.id !== id);
    if (remaining[0]) onChangeActive(remaining[0].id);
  }

  async function addSymbol(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!active) return;
    const symbol = symbolInput.trim().toUpperCase();
    if (!symbol) return;
    try {
      await api.addSymbol(active.id, symbol);
      setSymbolInput("");
      onMutated();
    } catch (err) {
      setError(err instanceof ApiError && err.status === 422 ? `${symbol} isn't in the demo universe.` : "Couldn't add that symbol.");
    }
  }

  async function removeSymbol(symbol: string) {
    if (!active) return;
    await api.removeSymbol(active.id, symbol);
    onMutated();
  }

  return (
    <div className="manage-panel">
      <div>
        <h2 style={{ fontSize: 14, marginBottom: 8 }}>Watchlists</h2>
        <div className="watchlist-select-row">
          {watchlists.map((w) => (
            <span key={w.id} style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <button className="button" aria-pressed={w.id === activeId} onClick={() => onChangeActive(w.id)}>
                {w.name} ({w.items.length})
              </button>
              {w.id === activeId && (
                <>
                  <button className="button subtle" onClick={() => renameList(w.id, w.name)} aria-label={`Rename ${w.name}`}>
                    rename
                  </button>
                  <button className="button subtle" onClick={() => deleteList(w.id)} aria-label={`Delete ${w.name}`}>
                    delete
                  </button>
                </>
              )}
            </span>
          ))}
        </div>
        <form className="add-symbol-form" onSubmit={createList} style={{ marginTop: 10 }}>
          <label className="sr-only" htmlFor="new-list-name">
            New watchlist name
          </label>
          <input id="new-list-name" placeholder="New watchlist name" value={newListName} onChange={(e) => setNewListName(e.target.value)} />
          <button className="button" type="submit">
            Create list
          </button>
        </form>
      </div>

      {active && (
        <div>
          <h2 style={{ fontSize: 14, marginBottom: 8 }}>Symbols in "{active.name}"</h2>
          <form className="add-symbol-form" onSubmit={addSymbol}>
            <label className="sr-only" htmlFor="add-symbol">
              Add symbol
            </label>
            <input
              id="add-symbol"
              placeholder="e.g. AAPL"
              list="symbol-universe"
              value={symbolInput}
              onChange={(e) => setSymbolInput(e.target.value)}
            />
            <datalist id="symbol-universe">
              {symbolOptions.map((s) => (
                <option key={s.symbol} value={s.symbol}>
                  {s.name}
                </option>
              ))}
            </datalist>
            <button className="button primary" type="submit">
              Add
            </button>
          </form>
          {error && (
            <p className="field-error" role="alert">
              {error}
            </p>
          )}

          <div className="table-wrap" style={{ marginTop: 10 }}>
            <table className="watchlist-table">
              <thead>
                <tr>
                  <th scope="col">Symbol</th>
                  <th scope="col">Added</th>
                  <th scope="col" />
                </tr>
              </thead>
              <tbody>
                {active.items.length === 0 && (
                  <tr>
                    <td colSpan={3}>No symbols yet — add one above.</td>
                  </tr>
                )}
                {active.items.map((item) => (
                  <tr key={item.symbol}>
                    <th scope="row">{item.symbol}</th>
                    <td>{new Date(item.addedAt).toLocaleDateString()}</td>
                    <td>
                      <button className="button subtle" onClick={() => removeSymbol(item.symbol)} aria-label={`Remove ${item.symbol}`}>
                        remove
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
