# DECISIONS.md — Smart Market Watchlist

This is a design sketch, written before code, per the brief's process. It states what I'm building and why, and flags where I'm pushing back on the brief itself.

---

## 0. Thesis, restated as a spec

A watchlist is a table you already know how to build. The actual product is: **for each user, for each symbol they watch, what happened since they last looked, and is it worth interrupting them for.** Everything below serves that sentence. Price display, list CRUD, and the DB are plumbing in service of it.

---

## 1. The watermark: what "last seen" means

**Decision: the watermark advances only on an explicit user acknowledgment, never on render.**

Rejected: advancing watermark on page load / feed fetch. That's the obvious thing, and it's wrong — a feed can render in a background tab, during a fast scroll-past, or in a request that times out client-side after the server already recorded it. If render sets the watermark, the event that mattered can be marked "seen" without anyone seeing it. The brief explicitly asks me to distinguish these two, so I'm taking the stricter one.

Concretely: `GET /feed` is a pure read, side-effect-free. Marking an item seen is a separate action (`POST /events/:id/ack` or a bulk `POST /feed/ack-all`) that the frontend calls when the user actually interacts with an item — expand its reasoning, or hit "seen." I additionally track a non-authoritative `last_rendered_at` per session purely for the "you last checked ~X ago" UI copy, so that string can say "feed opened 4 minutes ago" even before anything is acknowledged — but no diffing logic ever reads that field. Only `watermark.acknowledged_at` / `acknowledged_observation_id` does.

**Multi-device reconciliation: watermark is monotonic, forward-only.**
`UPDATE watermarks SET last_ack_id = :new WHERE user_id=:u AND symbol=:s AND last_ack_id < :new`. If a stale tab (already showing older data) acks after a newer device already advanced the watermark further, the stale ack is a silent no-op — correct, because the user has already seen strictly more than that tab knew about. No locking needed; the WHERE clause makes it atomic and idempotent by construction.

**Schema:** `watermarks(user_id, symbol, last_ack_observation_id, acknowledged_at)`, one row per (user, symbol), created lazily on first watch with a watermark of "beginning of history" (so a brand-new watch shows the full backlog once, not silence).

---

## 2. Watermark-relative diffing, not fixed windows

**Decision: every computation spans `(watermark, now]` over the full stored history, recomputed fresh each read.** No "today's change," no daily reset. If you're away 3 hours, the window is 3 hours of bars/observations; away 3 weeks, it's 3 weeks. Nothing here has a cron job that "resets at midnight."

This is why the significance engine takes `(history, watermark) -> events` as its whole signature — it has no notion of "today" baked in, so correctness across absence-length is structural, not a case I have to remember to handle.

**Rejected: incrementally computing events at ingestion time per user.** That would mean fanning out per-user work every poll cycle (N users × M symbols), which fights the "poll once, dedupe across users" requirement directly. Instead: ingestion only ever appends to per-symbol history; the read path (feed request) does one pass of the pure engine over that user's watched symbols' history since their watermark. This is strictly less total work — it happens once per user-visit, not once per user per poll — and it's the only way I can see to keep ingestion decoupled from user count while still making the diff genuinely per-user.

---

## 3. Significance scoring (the core module)

Module: `domain/significance/*.ts` — pure functions, no Date.now(), no I/O, `Clock` and `RNG` (for the fake provider only) injected everywhere they're needed. This is deliberately the least clever-looking code in the repo; I want it boring and checkable.

### 3.1 Data the engine operates on

Two series, both append-only and already in the store — the engine never reaches out:
- **Daily bars** (`open, high, low, close, volume, session_date`) — the substrate for volatility, ATR, volume baseline, gap, streak, correlation.
- **Intraday observations** (`price, observed_at, as_of`) — the substrate for "price right now" and "since-watermark move within today's session."

### 3.2 Normalized price move — the core signal

`z = ln(P_now / P_watermark) / (σ_daily × √max(sessions_elapsed, ε))`

- `σ_daily` = stdev of daily log returns, trailing 20 sessions (min 10 required; below that the engine returns "insufficient history," not a fabricated number).
- `sessions_elapsed` = trading sessions spanned since the watermark, fractional for an intraday gap (e.g., 0.15 for ~an hour into a session).
- The `√time` scaling is the load-bearing decision here: under a random-walk null, the expected stdev of a move over N sessions is `σ×√N`. Without it, a 3-week-old watermark would report an inflated z-score for a move that's actually unremarkable once you account for how much time has passed — exactly the "must not silently degrade over long absences" failure the brief calls out. **This is why watermark-relative, time-scaled normalization beats a raw % move: the raw number is the same whether you were gone 3 hours or 3 weeks; the z-score correctly isn't.**
- **Stated failure modes** (required by the brief, not glossed over): (a) assumes i.i.d. returns — breaks down around earnings/news clusters where volatility itself jumps, so a real regime change can initially under-score until σ catches up; (b) trending regimes make sustained moves look like a sequence of "expected" small steps rather than one big one — momentum is structurally underweighted by a model built for mean-reverting noise; (c) very short absences (`sessions_elapsed → ε`) are noisy because intraday microstructure isn't captured by a daily σ — I floor `sessions_elapsed` at a small constant (0.05 sessions ≈ ~20 min) to stop the denominator collapsing and producing absurd z-scores from a few minutes of bid-ask noise.

### 3.3 Volume anomaly

`z_vol = (V_today − median₂₀) / (1.4826 × MAD₂₀)`

Median/MAD instead of mean/stdev — volume is right-skewed and a single past spike (earnings day) would drag a mean/stdev baseline and mask the next spike. Median/MAD is robust to that. This is a small, deliberate "not the obvious thing" choice.

### 3.4 Session gap

`gap = ln(open_today / close_prev)`, compared against `ATR14` (Wilder's average true range, 14 sessions) rather than against σ. ATR is the standard instrument for "is this move big for this name's normal daily range," and it's cheap to justify to anyone who's traded — reusing σ here would double up with 3.2 and lose the session-boundary-specific character (gaps behave differently from intraday moves; a name can have low daily σ but gap hard on earnings).

### 3.5 Structural level (merges two brief bullets on purpose)

The brief lists "user threshold crossing" and "streak/regime change (broke a multi-day range)" as separate bullets. I'm implementing one mechanism for both: **a rolling 20-session high/low breakout, plus optional user-set price levels, both evaluated as edge-triggers over consecutive bars in the query range.** A price sitting above a broken level isn't a new event every poll — only the bar where it *crossed* is. This is stated explicitly as a scope decision: they're mechanically the same thing (price relative to a level, fired on crossing, not on standing), so building two implementations would be duplicated code for no extra signal.

### 3.6 Correlation break — the originality bet

Each seeded symbol has a static sector tag; a synthetic market index is computed internally as the equal-weight average daily return across all seeded symbols (no external index feed needed — one less dependency, one less thing that can fail). For each symbol, rolling 60-session correlation against its sector-peer average return establishes an "expected co-movement" (a rolling beta/correlation regime, not a fixed constant).

An event fires when: sector peers move coherently by a non-trivial amount (peer-average |return| exceeds their own typical move) **and** the symbol's residual — `actual_return − correlation × peer_return`, scaled by the symbol's own historical residual stdev — is itself a large z-score. In plain language, this is "everything in its sector moved, and it didn't (or moved the other way)" — a rolling market-model residual, the same idea underlying alpha/idiosyncratic-shock detection, sized down to what a hackathon can implement in an evening.

**Failure modes stated up front:** needs a large-enough, internally-consistent peer group (I gate on peers themselves agreeing with each other before trusting the peer average — otherwise a single noisy peer poisons the "expected" side); thin sectors in the seed data will be noisier than the intraday price-move signal; a genuine sector-wide data outage (all peers stale) must not read as "everyone moved and this one didn't" — the engine checks peer staleness before computing this signal and suppresses it if peers are stale, rather than firing false positives off a provider gap.

### 3.7 Turning raw statistics into one ranked, explained feed

Each event type produces a raw stat (a z-score, or a ratio-to-ATR). I map it through a saturating transform, `score = 100 × (1 − e^(−|stat|/k))`, tuned per type so `|z|≈2` lands near 60 and `|z|≈3+` saturates near the high 80s/90s. Saturating rather than linear is deliberate: past a certain point, "how much worse" stops being the interesting question — a 6σ move and an 8σ move are both "drop everything," and a linear score would over-reward chasing extremes in the sort order versus genuinely distinct events.

When multiple event types fire for the same symbol in the same read, they're grouped into one feed card (one symbol, several reasons) with a combined score via noisy-OR (`1 − Π(1 − sᵢ)`) rather than a sum — this avoids double-counting when signals are correlated (a big price move and a volume spike are not independent evidence) while still ranking "three things happened" above "one thing happened." Every card's score is only ever a rendering of numbers that are also shown verbatim on demand ("2.4σ price move since you last looked, 6 sessions ago; realized vol 1.8%/day") — no score is presented without its inputs one click away.

### 3.8 Idempotency and cooldown — solved via the signature, not a timer

`change_events` is unique on `(user_id, symbol, event_type, window_key)`. `window_key` is chosen per type so that identity does the deduplication work instead of a scheduled cooldown job:

- **Price move**: keyed to the watermark's observation id it's measured from. While unacknowledged, recomputation **updates** the same row (magnitude can grow as the move continues) rather than inserting a new one. The moment the watermark advances (user acks), that window is closed forever — a new watermark id opens a new window. Re-running ingestion or re-fetching the feed a hundred times produces the same row, not a hundred.
- **Volume/gap/structural/correlation**: keyed to the specific session-date (or bar-pair, for a crossing) that produced them. A three-week absence surfaces one row per notable day in that range, not one row for "today," which is exactly the correctness-across-long-absences requirement — and each is independently idempotent because it's pinned to a date, not to "when the poller happened to run."

This is why there's no separate cooldown-timer subsystem: an event that's already stored and acknowledged simply won't be re-inserted, because its signature already exists and is marked seen. "Reported once, acknowledged, never resurfaces unchanged" falls out of the unique constraint plus this key choice, rather than needing its own mechanism.

---

## 4. Data resilience

**Append-only, two grains.** `observations` (raw quote-level: `price, volume?, source, observed_at, as_of, quality`) is never mutated, only appended. `daily_bars` is derived from observations (or fetched pre-aggregated where the provider gives daily OHLCV directly) and is also append-only per `(symbol, session_date)` — a re-poll of a session in progress **replaces that day's provisional row** (`is_provisional=true` until session close), it doesn't create a second row for the same date. Nothing in the request path calls upstream; API reads only ever hit the store.

**Staleness is derived, not stored as a flag that can rot.** Every quote response carries `age = now − observed_at` and `as_of` computed at read time, plus the session state (below), so the frontend always renders "as of 14:32, 3 min ago" rather than a boolean that could go stale itself.

**Bad-tick handling**, applied at ingestion before anything touches history or baselines:
- Reject outright: price ≤ 0, non-finite, `as_of` older than the newest already-stored `as_of` for that symbol from an equal-or-lower-priority source (out-of-order, see conflicts below).
- Quarantine (store with `quality='quarantined'`, excluded from every baseline/engine calculation, but visible in an admin/debug view): a single-tick move whose implied return is beyond ~20× the symbol's current realized σ. It is **not** discarded outright, because a real 20×σ event does happen (crashes, halts) — it's held pending confirmation. If the *next* observation confirms the level (i.e., doesn't snap back), it's promoted to real and processed normally, one tick late; if it doesn't confirm, it's left quarantined forever. One bad print can therefore never fire an alert or poison a rolling baseline on its own.

**Conflicting sources**: providers are ranked by a static authority order (config, not hardcoded logic) and every ingested value carries its source. On disagreement for the same `as_of`: newer `as_of` wins; exact tie goes to higher-authority source; every conflict — whether it changed the stored value or not — writes a row to an `ingestion_conflicts` log rather than silently overwriting, so the decision is auditable after the fact.

**Corporate-action guard**: an overnight close→open ratio landing within ~3% of a common split ratio (2, 3, 1.5, 4, 0.5, 0.333, 0.25) **and** far outside what ATR would predict (>5×ATR) is flagged `corporate_action_suspected`. That session's return is excluded from σ/ATR/baseline recomputation (so it can't poison the next 20 sessions of "normal"), and price-move/gap alerts across that boundary are suppressed with an explicit UI note ("large overnight change flagged as a possible split — not adjusted, not alerted on") rather than either firing a false 10σ alert or quietly pretending nothing happened. I'm not doing full split/dividend price adjustment — that's a data-vendor-grade problem, and the brief explicitly says detection is the bar, not correction.

**Market sessions**: a pure `getSessionState(now, calendar) -> 'pre'|'open'|'post'|'closed'` function (fixed exchange hours + a short hardcoded holiday list for the demo). When closed, the feed explicitly renders "market closed since 16:00 · nothing new since close" — a designed state, not an empty list that reads as a bug.

**Provider failure behavior**: retry with exponential backoff + jitter (bounded attempts) for transient failures; a circuit breaker opens after N consecutive failures per provider and serves last-known-good from the store with staleness clearly surfaced, probing half-open after a cooldown. A dead provider degrades the "fresh enough" label, never the app — no blank screens, and (because bad-tick/quarantine logic sits between provider and store either way) an outage can't manufacture a spurious alert either.

---

## 5. Architecture & scale

**Ingestion is per-symbol, not per-user.** A scheduler polls each *unique* watched symbol once per its tier, independent of how many users watch it — 1 user or 500 users watching the same symbol costs upstream exactly one call. This is the direct answer to "deduplicate work across users": the join table is `watchlist_items(watchlist_id, symbol)`, and the poller iterates `SELECT DISTINCT symbol FROM watchlist_items`, not per-user.

**Tiering** (recomputed periodically from current watch-counts + realized vol, not per-request):
- **Hot** — watched by many users or top-tercile realized vol: poll every 30s during market hours.
- **Warm** — the default: every 5 min.
- **Cold** — single-watcher, low-vol, long-tail names: every 15–30 min.
- All tiers back off to a slow keep-alive cadence (~30–60 min) outside market hours — there's nothing to catch except pre/post prints, so there's no reason to hammer the provider or the DB.

Justification: uniform polling either over-serves the long tail (wasted upstream budget) or under-serves the names people actually watch closely; tiering by demand×volatility spends the (rate-limited, free-tier) upstream budget where it changes the feed's freshness, not where it doesn't.

**Batching**: the provider interface exposes `getQuotes(symbols[])`, not a per-symbol call; the scheduler groups each tier's symbols into provider-max-sized batches per cycle. This is what keeps "hundreds of symbols, many users" from becoming hundreds of upstream calls.

**No N+1 on read**: the feed endpoint loads one user's watched symbols, then does bounded batched queries (bars + observations `WHERE symbol IN (...)`, watermarks `WHERE user_id = ...`) — not a per-symbol round trip. Indexes on `(symbol, as_of)` / `(symbol, session_date)` and `(user_id, symbol)` keep these cheap at hundreds of symbols.

**Idempotent ingestion**: re-running a poll for a symbol/date is safe — `daily_bars` upserts on `(symbol, session_date)`, `observations` insert is naturally append-safe (a duplicate observed_at/as_of pair from a retried call is just another row and changes nothing downstream since the engine reads the latest valid one per as_of). Nothing about re-running ingestion can duplicate a change event either, per §3.8.

---

## 6. Auth

Real signup/login, kept minimal so it doesn't eat time that should go to the engine:
- **Password hashing**: Node's built-in `crypto.scryptSync` (random 16-byte salt per user, `crypto.timingSafeEqual` for verification) — zero extra dependency, no native bindings to fight with in a Docker/CI environment, and scrypt is a perfectly sound KDF for this scope. Rejected bcrypt/argon2 packages solely to avoid a native-module dependency for something Node already does well.
- **Sessions**: opaque random token (`crypto.randomBytes(32)`) in an `httpOnly` cookie, looked up against a `sessions` table server-side. Rejected JWT — it adds a library and a "how do we revoke it" problem for no benefit at this scale; an opaque server-side session is simpler to reason about and matches the brief's own "state persists server-side" framing.
- No password reset / email verification flow — out of scope for a submission; noted under §8.

---

## 7. Stack

| Choice | Alternative considered | Why |
|---|---|---|
| **SQLite + Prisma**, migrations via Prisma Migrate | Postgres + Docker | Brief explicitly allows SQLite for zero-setup; a judge should be running this in under a minute with no Docker dependency. Prisma gives real migrations + type-safe queries for one dependency, which is what keeps the storage layer thin. |
| **Express + zod** for the API | Fastify | Fastify is nice but adds a schema/plugin model on top of a small route surface; Express + zod validation at the boundary is the smaller mental model for the same result. |
| **Hand-rolled tiered scheduler** (`setInterval` per tier + overlap guard) | `node-cron` | Requirements are fixed-interval tiers, not cron expressions — a real cron parser is unused surface area. ~40 lines, fully testable by injecting a fake clock/trigger function. |
| **Hand-rolled structured JSON logger** | `pino` | The ask is "structured logging," not a production log pipeline — a ~20-line wrapper that emits `{level, ts, event, ...context}` JSON lines is enough to make ingestion/alerting decisions explainable, without a dependency. |
| **Vitest** | Jest | Faster, native ESM/TS, no config layer to fight. |
| **Provider interface**: `FakeReplayProvider` (deterministic, seeded PRNG, used for tests + default demo) and one real HTTP provider (Finnhub — generous free tier, no card required) | Alpha Vantage | Alpha Vantage's free tier (25 calls/day at time of writing) is unworkably small even for a demo; Finnhub's free tier actually supports batched/frequent polling of a small symbol set. The app runs fully off the fake provider with no key and no network — the real provider is a genuine second implementation, wired but not required. |
| **npm workspaces monorepo** (`server`, `web`, `shared` for DTO/event types) | Copy-pasted types across front/back | One dependency-free workspace config buys type-safety across the API boundary; the alternative silently drifts. |

**Run story**: `npm install && npm run setup && npm run dev` (setup = migrate + seed) is the primary, documented path — genuinely one command, no Docker required. A `docker-compose.yml` is included as an alternative for anyone who prefers it, wrapping the same steps, not as the primary path.

---

## 8. Deliberately simple, and what's next

Kept simple on purpose: no push/email notifications (pull-based feed only); no WebSocket push to the browser (short polling refresh, ~15–30s, is indistinguishable from push for a watchlist and avoids a connection-management subsystem); no full corporate-action price adjustment; no multi-instance/queue-based scheduler (single-process is correct at this scale; would move to a job queue + leader election for real horizontal scaling); no password reset/email verification; no API rate-limiting/abuse protection.

With more time, in priority order: (1) real dividend/split-adjusted history instead of detect-and-suppress; (2) a second real provider to make the conflict-resolution path exercised by real disagreement, not just tests; (3) push delivery (email/webhook) for the highest-severity events, gated by the same idempotency signature; (4) promoting the scheduler to a queue for multi-instance deployment.

---

## 9. Notes

- **"Rename symbols"** in the brief's requirement 1 doesn't quite parse literally (you can't rename a ticker). Read as "rename a watchlist" (implemented, multiple named lists per user — one extra FK, low cost) plus an optional personal alias per watched symbol.
- Multiple watchlists per user are implemented since the schema cost is negligible and it's explicitly allowed ("if justified") — one extra table, no UI complexity added beyond a list switcher.
