# BarStore (client) — P2a core

Status: P2a of the chart-data consolidation program (2026-11-11). Built OFF TO THE SIDE:
`app/src/data/barStore/` is wired into the chart behind the P3-S1 `BARSTORE` switch (default off, §P3-S1). P2b adds persist / network /
liveFeed, P2c the prefetch facade, P3 makes StockChart a pure renderer over it. Server side:
[bar-contract.md](bar-contract.md) (P1).

## Files

| File | Owns |
|---|---|
| `types.js` | `keyOf` / `parseKey`, `expectedServerCacheKey`, tf / status / action constants, JSDoc shapes |
| `reducer.js` | `reduce(state, action, ctx)` — the ONLY merge path; `initialState`, `invalidate`, `refreshStatus`, `isSealedRow`, `inSealedSpan` |
| `status.js` | `deriveStatus`, `TRANSITIONS`, `isLegalTransition` |
| `registry.js` | `createRegistry()` — key → entry, refcount, LRU (200 keys) + bar budget (2.5M), per-tf depth caps, subscribe / dispatch / invalidate |
| `__fixtures__/seededSeries.js` | test-only seeded market simulator (mulberry32, same as P0b rails) |

Note: the root `.gitignore` line `data/` also matches `app/src/data/`;
new files there need `git add -f` until a `!app/src/data/` negation is added.

## Key

`${SYM}_${seriesCacheTf(tf)}` (+ `@to=<unix>` for a windowed / replay series) — the identity the
IDB / mem caches already use. Only 60m differs by session: `AAPL_60` (TradingView RTH grid,
09:30 … 15:30 half bar) vs `AAPL_60e` (clock hours). The server's `cache_key`
(`b1:<TICKER>:<tf>:<grid>`) names the ROW SERIES; a payload or frame whose cache_key ticker/tf or
`sym` name another series is ignored (S7), a changed cache_key resets the entry.

## Snapshot (frozen, identity-stable)

`{key, sym, tf, bars, developing, completeThrough, verifiedThrough, seriesRev, historyRev,
cacheKey, adjBasis, grid, tailStatus, sealedSpans, restFrom, deltaFrom, status, baseRev, devRev, depth,
source, restSeen, needsFull, error, invalidatedFor, gen, pendingHistoryRev, depthFloor, localHoleFrom}`

- `bars`: CLOSED buckets, strictly increasing unique `t`, UNIX SECONDS (intraday: bucket start;
  D/W/M: 00:00 UTC of the label date — `toISOString().slice(0,10)` is the server's label). Each
  bar is `{t,o,h,l,c,v, rev, fin, src}`; `src` ∈ rest | final | push | tick | local (the adapter
  strips the extras). Rows inside a sealed span with `src: 'rest'` are final; later rows are
  closed-but-provisional (P1 I3).
- `developing`: the forming bucket `{t,o,h,l,c,v, rev, src: server|push|tick, provisional?,
  authHigh?, authLow?}` — never in `bars`, always after every closed row.
- `completeThrough`: the greatest seal any server answer claimed (unix s, a bucket END).
- `sealedSpans`: union of `[first row carried (delta: since), claim]` over server answers.
- `deltaFrom`: where the next `since=` delta must start (first closed row after the newest
  sealed one, else the developing / last bar) — network.js reads it.
- `baseRev` +1 when bars / seal / identity fields change (persist + setData key);
  `devRev` +1 when only the developing bar changes (`update()`).
- A no-op action returns the SAME object (subscribers compare with `===`); a merge or trim
  that leaves the same rows keeps the same `bars` array (no baseRev churn).
- `gen`: bumped by every invalidate (and by a history change seen on a delta / scroll-back).
  Every network action carries the `gen` it was requested under (P2b); a different one is
  dropped — a request from before an invalidate can never land after it.
- `pendingHistoryRev`: a delta / scroll-back showed a NEWER `history_rev`. The held bars stay
  on screen (status `updating`, `needsFull`), deltas are refused, and the full read of that
  history replaces the entry atomically.
- `depthFloor`: the depth a scroll-back reached; the per-tf depth cap never trims below it.
- `localHoleFrom`: an interior hole a hydrated copy reported (`repair_from`) that no restored
  seal explains; while it is older than `deltaFrom`, `needsFull` is forced (a delta could never
  re-read it). A full answer clears it.
- `adjBasis` (P4): the server's `adj_basis` (bar-contract.md §2) of the held rows — the price
  basis. A LOCAL row carries the stamp of the copy it came from (`ab`; absent = unstamped).

### Price basis (P4) — one rule, replaces the 2% close test
- Identity: an answer / copy / scroll-back window whose `adj_basis` differs from the held one
  (both non-null) is another row series — the `cache_key` mechanism: a full answer resets the
  entry, a delta / window sets `needsFull` (gen + 1), a local copy is refused whole.
- A server answer keeps a local row only when its basis is PROVEN: stamped with the answer's
  `adj_basis`, or (unstamped legacy copy / answer without `adj_basis`) by
  `reducer.basisVerdict` over the rows the answer also carries — 'changed' iff ≥ 2 rows are ONE
  uniform rescale (o/h/l/c share r, |r − 1| > 0.5%, volume ≈ 1/r or unchanged) ⇒ every local
  row goes; 'same' ⇒ re-stamped with the answer's basis; 'unknown' (no overlap) ⇒ a FULL answer
  naming its basis discards those rows once. Chosen over "discard every unstamped record": it
  keeps a legacy copy's depth whenever its overlap proves it, and a close-only difference (a
  bucket the copy caught while forming — a volatile name's > 2%) is never a basis change
  (the 2% rule's false positive). Railed: `reducer.test.js` "P4 price basis" (B1–B4, B2 a
  seeded property).
- A local copy that lands after a server answer adds deeper rows only on the held basis
  (stamped, or proven 'same').

### One guard for every server-sourced action
`staleReason` refuses a payload whole when its `gen` is stale or its `history_rev` is OLDER than
the one held (or pending) — rest-full, rest-delta, rest-error, scroll-back and local copies.
A late answer from before a correction / delete can therefore never resurrect a removed row.

## Actions

| type | rule |
|---|---|
| `seed-from-pack` / `idb-hit` / `mem-hit` | before any server answer: seed (last row is `developing` if its bucket has not ended). After one: only rows OLDER than the server-covered region are prepended. Another cache_key / older history_rev ⇒ discarded. Local rows are never sealed — except a persisted copy's verified seals (`sealed_spans`, P2b §Persist), restored only before any server answer; a server row always replaces a non-sealed local one. |
| `rest-full` | rows ingested once (`foldOffGridBars`, sort, dedupe); P1 `developing` removed from rows and merged into the developing bar; seal = `complete_through`. NULL (before a series' first tail repair; D/W/M, bar-contract.md §8) seals NOTHING: those rows stay ordered by rev, so a revision with the same `history_rev` still lands. Only a LEGACY answer (no contract fields) uses I8 (the answer holds a LATER bucket); absences inside its sealed span remove non-server rows. A risen `history_rev` or changed `cache_key` resets the entry first. |
| `rest-delta` | as `rest-full` over `[since, …]`; a risen `history_rev` / changed `cache_key` ⇒ bars kept, `needsFull`, `pendingHistoryRev`, `gen`+1 (rows not applied, later deltas refused until the full read). |
| `rest-error` | `no_data` is terminal (`unavailable`); other errors are recorded, data kept. |
| `push-bar` | `t` must be on the grid and its `trade_ts` inside the bucket (I4). Same bucket as `developing`: `liveBarMerge.mergePushBar` (I1–I3, I6, I7) gated by `rev` (≤ held ⇒ ignored). Later bucket: the developing bar closes into `bars`. Earlier bucket: competes as a closed row (never inside a sealed span). |
| `push-final` | merges `final: true` and closes the bucket into `bars` (`fin`). An older-`rev` final still closes it. For an earlier bucket it is the `correct` case: replaces the closed row by rev — never a sealed one. NOT a seal (bar-contract.md §5). |
| `tick-fallback` | only when `ctx.streamLive` is false (S6). `liveTickBaseline.isSaneLivePriceFor` with this key's own closes; bucket by trade time; same bucket ⇒ `foldPrice` (never the open, never `authHigh/authLow`) and the bar is marked `ticked` (closed later, it ranks as a tick, never as the server's); later ⇒ `provisionalOpen` (`src: tick`). Never touches a closed row. |
| `scroll-back` | rows older than the first held bar (and the developing bar) are prepended; raises `depthFloor`. A newer `history_rev` ⇒ needsFull as for a delta. |
| `invalidate` | empty entry, `needsFull`, `invalidatedFor` — S2's only exception. |

Closed-row precedence (one rule, `_wins`): a sealed held row is immutable; an incoming sealed
row wins; otherwise the greater `rev` (P1 HLC ms: REST rows carry the answer's `series_rev`,
frames their own `rev`) wins; ties rest > final > push > tick > local.

## Status

`empty · provisional · context · current · updating · unavailable`, derived (`status.js`) from
`marketSession.intradayBarCurrentness` (intraday) / `expectedDailyTailForPaintET` (D) — the
one freshness contract. Local-only: `context` if current-enough else `provisional`. Server
answer held: `current` when current AND verified (`verified_through` or `tail_status:
'verified'`), `context` when current but unverified (legacy), `updating` when behind. D/W/M
server answers are `current` at the paint frontier (P1 does not seal D/W/M yet).
Transitions: once a server answer is held the entry never returns to `provisional`; any
state may go to `empty` (invalidate); `unavailable` is left only by data.

## Invariants (barStore.property.test.js, seeded; `BARSTORE_SEEDS=N` to widen)

- S1 bars strictly increasing, unique, on the bucket grid.
- S2 `completeThrough` and the last sealed `t` never decrease (except invalidate / a new
  history); `history_rev` held never goes back.
- S3 `developing.t` > every closed row.
- S4 within the developing bucket H↑ L↓ open-once V↑ (until final).
- S5 confluence: any order / duplication of rest-full, rest-delta, push-bar, push-final
  (including feed-only ghost prints the server filters) converges; a later sealing answer
  makes every sealed row equal the truth and removes every ghost.
- Eventual convergence (rich sequences): provider revisions before the seal (series_rev only)
  and corrections / deletes inside it (history_rev + 1), stale-history races, `complete_through`
  null before the first repair, scroll-back, local hits, fallback ticks and invalidates in any
  order — after one settling full answer the sealed region is identical across orders, equals
  the truth, and a deleted row never resurrects.
- S6 ticks: ignored while the stream delivers; never move an authoritative open or vouch an
  extreme; never touch a closed row; a server frame replaces a provisional open.
- S7 foreign key / symbol / series never touches an entry.
- S10 frozen, identity-stable, idempotent (re-applying an action is a no-op), legal transitions.
- S8 (persist) and S9 (network): `persist.test.js`, `network.test.js` (P2b, below).

Coverage: 7 dates (both 2026 DST edges, both half-days, plain days) × RTH/ETH × 1/5/15/30/60m
(+ a daily series suite). Mutating the seal protection, the sealed-span insertion block, the
absence rule, the rev gate, the stream-live tick gate or the foreign check each fails it.

## Deviations from the design spec (BARSTORE-SPEC.md)

- `push-final` does not advance `completeThrough`: P1 §5 — only REST asserts completeness.
- `rest-delta` invalidates on a risen `history_rev` (P1's "sealed history changed"), not on any
  `series_rev` change (`series_rev` rises on every write, including tail growth).
- Seals are per span carried, not a single threshold: a delta's claim never seals rows it did
  not re-read (`deltaFrom` tells network.js where to start).
- Hydrated (local) rows are unsealed unless the persisted envelope proves them (P2b §Persist); everything else is re-proved by the first server answer.
- A delta with a new history keeps the chart and waits for a full read (no blank frame).

## P2b — persist / network / live feed / API

| File | Owns |
|---|---|
| `persist.js` | the ONLY cache reader/writer of the store: hydrate (mem, then IDB → `mem-hit` / `idb-hit` with the read's `gen`), writes through the existing `memPutMonotonic` / `idbPutMonotonic` (barsMerge one write rule, `_entryReadable`), pack import facade |
| `network.js` | per-key loop, ≤1 request in flight per key, AbortController, `gen` on every action, delta vs full, cadence, scroll-back, `barsUrl` (the store's one /api/bars URL builder) |
| `liveFeed.js` | push frames → `push-bar` / `push-final`; tick fallback (one source, only while push is not delivering); D/W/M fold of the 1m stream |
| `index.js` / `useBarSnapshot.js` | public API (subscribe / getSnapshot / peek / ensure / prefetch / invalidate / scrollBack / applyLive) and the React binding |

### Persist
- Writes on a `baseRev` change only, only for a server-backed snapshot (`restSeen` — a copy read FROM the cache is never written back, which would re-stamp its `savedAt`), debounced 1 s then at idle, ≤1 write per key in flight. Rows in the cache's legacy shape (`{t,o,h,l,c,v}`, D/W/M `t` = 'YYYY-MM-DD'); the developing bar is not persisted. Windowed keys never.
- Provenance envelope `meta` next to the rows: cache_key, grid, history_rev, series_rev, adj_basis (P4), complete_through, verified_through, sealed spans, gen, and a value fingerprint of every SEALED row. The `@hist` segment carries only its stamp (cache_key, history_rev, adj_basis). A stamped write onto a record of another stamp (or onto an unstamped one, when it names a basis / is `@hist`) REPLACES it — rows are never merged under a stamp that does not describe them (`barsIDB.idbPutMonotonic`).
- Invalidation: any other writer's put replaces the record WITHOUT `meta`; on hydrate a span survives only if the stored rows inside it (clipped to the stored depth) are exactly the sealed rows, same fingerprints; the reducer then refuses another key / cache_key / older history_rev / stale gen. Restored seals clear `needsFull`, so the first request after a reload is a `since=` delta — and they must be RE-PROVEN by the first server answer: a legacy answer, a null or different history_rev / cache_key voids them (rows drop to local; a delta is refused, a full read follows). Two local copies: one of a newer history replaces the other; one with an older series_rev only adds deeper rows.

### Network
- Delta (`since = deltaFrom - 1`; the delta's span starts at `deltaFrom`) when a seal is held, no full read is needed and the delta is no bigger than the full read (`deltaWithinBudget`); otherwise full. D/W/M always full, every 5 min.
- Cadence = `intradayTailPoll.nextTailPollMs` (catch-up burst honoring `retry_after`, then 30 s) with `intradayDedupMs` as floor; errors back off 1.5 s → 30 s honoring Retry-After; paused while hidden. Budget per key per hour ≤ 3600/30 + TAIL_CATCHUP_MAX_TRIES (railed for current / unverified / shedding servers).
- Gate: `prefetchBars.barsLaneRequest` — joins an in-flight chart-lane / warm request of the URL, non-visible requests share the warm queue's `_MAX_CONCURRENT` and 503 backoff (background also the pack-ingest hold). visible (never queued) > urgent > grid > warm queue > background.
- Scroll-back (intraday): #1116's `historyWindowUrl` / `barsBeforeUrl` / `HISTORY_WINDOW_BARS`, gated by its `prependOlder` seam rule (a window on another basis is refused whole); serialized behind the key's tail request.
- No seal held (prod: `complete_through` null on 5m live-store, 60m, D/W/M): intraday polls are `since = serverTail − MUTABLE_WINDOW_S` (the newest row a REST answer supplied — never a push-fed bar ahead of it, #1125) (8 h = bars_fetch `_DELTA_HEAL_WINDOW_SECONDS`) deltas that replace the window; older history changes only with `history_rev` → full read. FULL reads only on first load, `needsFull` (cache_key / history_rev change, voided restored seal), an over-budget delta, D/W/M and windowed keys (as the legacy client). A null / different `history_rev` voids only RESTORED seals, once.

### Live feed
- Tick fallback (push not delivering — prod `VITE_REALTIME_BARS=0`): ONE SOURCE PER BUCKET, quality-ranked and sticky — `liveFeed.arbitrateTick`, the one rule (audit D2: the trade feed used to own for 3 s after each print, so on a liquid name with a trickling Finnhub feed one bucket alternated between two feeds — close flipped, H/L widened from the worse feed). Sources: MASSIVE = a livePrices entry carrying `trade_ts` (the Massive trade time; primary), TRADE = the Finnhub trade feed (`realtimeCandle.getLastTrade`, its own trade time), UNTIMED = a livePrices entry without `trade_ts` (its `updated_at` is the server's send / receipt time — api/routers/stream.py, realtime_stream.py). MASSIVE may claim any bucket nobody holds; TRADE claims one only while Massive is QUIET (its trade ≥ `SOURCE_QUIET_MS` = 3 s newer than Massive's newest); the holder keeps the bucket until IT goes quiet (≥ the bound behind the challenger's trade); the next bucket is chosen afresh. Quiet is judged in TRADE time (both feeds' own clocks), never by arrival or the wall clock — a lagging feed is simply older (2026-11-12 stall: a trade feed lagging the wall clock held the key 81 s). UNTIMED is the last resort (a symbol outside Massive coverage with no Finnhub trades): only while both trusted sources are quiet by the wall clock, it folds into the developing bar's bucket or opens the WALL-CLOCK bucket its own time lies in — never a past or future bucket, so it never closes one early — and holds nothing. Quiet counts only ADMISSIBLE prints (`reducer.tickAdmission`, the reducer's own tick admission rule): a refused print never claims a bucket nor keeps its source live, and the holder is committed only once the bar took the print. The holder (`{bucket, src}`) lives with the key's subscriptions; a later bucket or a quiet holder replaces it. Every tick carries its OWN time (`liveTickTime`) and the reducer buckets it with the one rule (`reducer.bucketOf`). Railed: `liveFeed.arbitration.test.js` A1–A4 (seeded lag 0–90 s: the bar reaches the wall bucket on the first live-price tick in it, never freezes) and P1–P3 (seeded, every tf incl. D/W/M: interleaved Massive + trickling trade feed ⇒ one feed's prices per bucket, close never alternates; Massive quiet ⇒ the trade feed takes over within the bound, no freeze, no back-and-forth; an untimed entry moves the bar only into the wall-clock bucket; P4 refused prints never hold a bucket).
- D/W/M: base = the server's developing period bar (authoritative); RTH 1m frames fold in (open kept, H/L union, close = newest minute). Volume adds only minutes starting after the base's ARRIVAL minute + 1 min skew margin (`developing.rev` is a write time, not a read time) — so v ≤ the true sum, railed over random interleavings. Rebased on every REST answer.
- Lane aborts: a lane request runs on its own controller, ref-counted over lane callers; one caller's abort only detaches it. Lane requests are never joinable by legacy callers; a visible request never joins a `&warm=1` twin.

## P2c — prefetch facade (`prefetch.js`)
- `ensure(key, {until, depth, priority, signal})`: a held / hydrated snapshot already in `until` costs nothing; else ONE `store.ensure` (joins any request of the key). `prefetch(keys, {priority})` = ensure to DISPLAYABLE (context | current). `peek` = `store.peek`.
- Facade: the same export names and arities as every `utils/prefetchBars` import in the app (derived by AST in `prefetch.facade.test.js`). Priorities: `prefetchBarsToIDB({immediate})`, urgent `prefetchBars`, `prefetchBarOnIntent`, prepares → urgent; visible list rows and `prefetchGridWarm` → grid; the rest → background. No queue of its own: the lane is the gate (`_MAX_CONCURRENT`, 503 backoff, pack hold for background).
- Re-ask cooldown: a key the server ANSWERED that is still not displayable is re-asked ≤ once per bucket (≥ 60 s; D/W/M 5 min), keyed by store key + `gen` (invalidate resets); an aborted / shed / failed request gives the slot back.
- Handoff: `peekDisplayable` = peek()?.status ∈ {context, current} (non-intraday / custom → true; an unseen key is hydrated, its mem half synchronously). `prepareForDisplay(sym, tf, {signal})` = ensure(until context | current | unavailable) → current | authoritative (answered, still behind: a halt) | nodata | error. `prepareDailyForDisplay`: any held set is prepared without a request. A prepare owns its key: facade warms of that key do not add a waiter, so aborting the prepare (symbol switch) cancels the request — `network.fetchOnce(…, {signal})` ref-counts one-shot waiters and aborts only when the last one leaves and no subscriber holds the key.
- Persisted: an `ensure` answer that changed the base is written through `persist.writeOnce` (mem synchronously, then IDB; same monotonic writers and server-backed-only rule) when no subscriber watches the key; a hydrate promotes an IDB copy into mem with its own savedAt. So legacy `memPeek` readers (handoff daily fast path, useDayFacts) see facade fetches, and list warms survive the registry LRU. The cooldown holds only while the answer is held (store, or re-hydrated from what persist wrote); entries are pruned by age and size (≤ 400).
- Wire shape = legacy: `&warm=1` on non-urgent prefetchBars, prefetchBar, durable / grid / deep / replay warms and prepareForDisplay; never on urgent rows, intent, typed or daily-prepare. `priority: true` → `front` (head of its lane rank). A one-shot ask of a subscribed key rides the chart's rank, never warm; a chart joining a warm still waiting in the lane promotes it (`promoteLaneRequest`).
- prepareForDisplay: a LOCAL copy is `current` only by the legacy paint rule (`isCacheCurrentForView`, view session); else the server is asked. Daily: S1 reads the store key `keyOf({sym, tf})` (useBarSnapshot) — there is no SWR preload. Typed warm: legacy `_typedCachePaints` with the hydrated savedAt; S1 ADAPTER ITEM: never returns `stale-answer` (pinned by test).
- A forming row restored from the caches is `DEV_SRC.LOCAL` (closes as a `local` row), so `serverTailOf` never mistakes it for the server tail. A `fetchOnce` aborted while queued behind a scroll-back is dropped from the queue.

## P3-S1 — the chart's bar source behind ONE switch

`components/chart/barStoreSwitch.js`: `BARSTORE` = build const `VITE_BARSTORE === '1'`, overridden
per browser by `localStorage['uct.barStore']` (`'1'` on / `'0'` off), read ONCE at module load.
StockChart picks its bar hook at module scope (`const useChartBars = BARSTORE ? useBarSnapshotBars
: useLegacyChartBars`) — one call site, a fixed hook order. **Default OFF**: it swaps every chart's
bar path, so the owner approves the live switch separately (ledger: `VITE_BARSTORE`).

`components/chart/useBarSnapshotBars.js` takes the legacy hook's parameters and returns the SAME
24 bindings from ONE `useBarSnapshot(keyOf({sym, tf, session}))`. What a snapshot may paint:

| status | intraday frame | live writers (`provisionalStaleRef`) |
|---|---|---|
| empty | nothing | — |
| provisional | context: held rows minus the last (cached-while-forming) candle | frozen |
| context / current / updating | the snapshot (`adapter.legacyBars`) | live; frozen if the tail is > 8 h old |
| unavailable | nothing; `data.no_data` | — |

D/W/M: a local-only copy paints only when `marketSession.dailyCachePaintVerdict` (with the today
seed, `persist.savedAtOf`) says `ok` and its last bar passes the value sanity check; a server-backed
snapshot always paints. Writer D (StockChart `updateChart`) seeds `liveBarRef` from
`data.developing` (= `snapshot.developing`) and re-tops it after every setData; the Finnhub re-top
branch is not taken under BARSTORE.

Adapter items (§P2c): the handoff prepares through the facade with an abort signal; its D/W/M fast
path and `useDayFacts` read `prefetch.peekBars` (the store's held set) before the mem cache; the
type-to-search door uses the facade's `warmTypedSymbol` (never `'stale-answer'`); there is no SWR
preload — `chartKeyFor` equals the facade's `keyFor` for every tf × session.

Reducer fix found by the acceptance matrix: a forming bar RESTORED from a cache (`DEV_SRC.LOCAL`,
not ticked) is replaced whole by the server's answer for the same bucket (it used to keep its stale
close through Writer D's "live close stands" rule). Railed: `reducer.test.js` INVARIANT.

### Legacy selector → BarStore rule (or intentionally dropped)

| legacy behaviour (useLegacyChartBars.js) | under BARSTORE |
|---|---|
| IDB read once per (sym, tf) in render; mem fast path | `persist.hydrate` on subscribe (mem synchronous, then IDB) |
| cross-ticker guards (`idbReadyForRef`, `data.ticker`, `sameSymTf`, load seq) | S7 key identity; `useBarSnapshot` returns the new key's snapshot in the same render |
| 60m answer on the other grid refused | reducer: `cache_key` / `grid` identity |
| `since=` from the IDB / mem tail (+1 s back-off), `repairFromT` hole re-ask | network `deltaFrom` / mutable-window deltas; holes inside a sealed span are the server's absences; **review fix 6**: a hydrated hole (`repairFromT` → `repair_from` → `localHoleFrom`) older than the delta start forces a FULL read |
| fresh / behind / gapped + `isCacheCurrentForView` (`_idbNotCurrent`, mem refused) | `status.js` (one freshness contract): provisional vs context |
| `_staleContext`, `_idbProvisional` (+ Part 2 drop-last) | status provisional → context minus last, writers frozen |
| daily paint authority, `idbStaleDaily`, `_memTailStaleDaily`, `_idbDailyLastInsane` | same predicates on a local-only D snapshot |
| `_idbBasisMismatch` close-compare + `idbDelete` purge | server rows replace local rows over the answer span; `history_rev` / `cache_key` / `adj_basis` reset; **P4**: a local row is kept only on a proven basis (its `adj_basis` stamp, or `basisVerdict` — see §Price basis), else EVERY local row is dropped (full: reset + apply; delta: needsFull). `_idbBasisMismatch` stays `false` (the reducer owns it) |
| keep deeper IDB over a shallow full set; `spliceDeepLeftOfFresh` | reducer: local rows OLDER than the server-covered region are kept |
| delta merged in render; no-op poll skip | reducer merge (one snapshot); a no-op returns the same snapshot |
| split-fetch `/api/bars-history` (edge, `d=` date), Fix 2 cold-tail paint, fp dwell | **dropped**: D/W/M depth = `ensure({depth})` on the store's one URL builder; edge history is a follow-up |
| intraday `@hist` IDB segment | **review fix 6**: persist.js writes it (`idbPutHistory`) for a series deeper than the tail record when history grew / `historyLagsTail`; hydrate reads it (`idbGetHistoryEntry`) as a prepend-only `history` copy (reach + basis). **P4**: the segment is STAMPED (`histStamp`: cache_key, history_rev, adj_basis); the reducer refuses it on another cache_key / adj_basis or a history_rev that is not exactly the held one; unstamped needs a proven seam (`basisVerdict` 'same'); hydrate cuts it at its newest interior hole (`barsIDB._newestInteriorHoleEnd`); a write under another stamp replaces it |
| left windows (`_loadOlder`), 900 ms dwell, PREFETCH_WINDOWS warm | `store.scrollBack` (#1116 seam rule); same dwell + loop |
| background warm of the other tfs (sequential, abort on switch, `&warm=1`) | facade `prefetch` at background rank, `&warm=1`, aborted on switch (the lane gate bounds concurrency) |
| SWR poll cadence / dedupe / Retry-After / catch-up budget | network.js (same modules); **review fix 5**: `network.tailExhausted(key)` / `subscribeTailBudget` → `_tailCatchupRef` (DELAYED) |
| replay `to=` window, no polling | windowed key (`@to=`), read once |
| custom tf: base SWR + resample | base key subscription + memoized `resampleForSpec` |
| W/M synthesized from the mem Daily | resample of the held D snapshot |
| `developingTail` compose from the outgoing / finer tf (W-O) | **dropped**: the tf-switch hold keeps the previous frame until the server answers |
| `_tfSwitchHold`, `dailyRepairTodayRef`, `provisionalStaleRef`, axis-ratchet reset, T1/T3 marks | kept (derived from the snapshot + `savedAt`) |
| watchdog `mutate(payload, {revalidate:false})` injection | `mutate` = kick of the key's one request; the payload is not merged (one merge path) |
| `joinPendingBars`, `instFetcher` abort-on-switch | the lane's join; the subscription's AbortController |
| `window.__uctBarsDebug` traces | **dropped** |
| IDB first-paint timeouts (600 ms / 4 s once the browser has a cache) | **dropped**: the request never waits on the cache read (same request count) |
| compare SWR | `useCompareBars`, shared by both hooks |

### P3-S1 review fixes (BARSTORE path; the switch stays OFF)

1. **Render cost — split notify.** `registry.subscribe(key, cb, {wake})`: `'base'` subscribers
   (the chart's `useBarSnapshot(…, {wake: 'base'})` → `getBaseSnapshot`) are not woken by a
   developing-only change (`reducer.isDevOnlyChange`); `'dev'` subscribers
   (`store.subscribeDeveloping`) get one call per animation frame with the newest snapshot. The
   chart re-renders / `legacyBars` copies / resamples / setData()s per BASE change only; the
   developing bar is painted by Writer D's one function (`_writerDRef.retop`, series.update of
   candle + volume) from the dev channel. Railed: `StockChart.barStoreWriterD.test.jsx` (60
   developing-only ticks ⇒ ≤ 1 setData, ≤ 1 repaint pass), `useBarSnapshotBars.test.jsx`.
   Indicators / legend follow the developing bar at base changes (as the legacy poll did).
2. **Push gate.** `liveFeed` subscribes to barsStreamManager only when
   `lib/realtimeBarsGate.realtimeBarsEnabled()` (`VITE_REALTIME_BARS`, the owner
   `useRealtimeBars` reads too); off ⇒ push never counts as delivering, ticks are the source.
3. **Restored forming bar.** The server answer takes its open / close; its extremes / volume
   replace the copy's only when `verified_through ≥ seenAt` (the copy's savedAt), else H/L/V merge
   monotonically (S4). Railed: property suite "S4 across a cache restore".
4. **One key function.** `prefetch.viewKeyFor(sym, tf, {showExtended, window})` serves
   `chartKeyFor` and every facade call; the handoff passes the PANE's `showExtended`
   (`ChartWidget` → `useSymbolHandoff`).
5. **DELAYED** — see the table above.
6. **Deep history / holes / basis** — see the table above (`persist.test.js` "review fix 6").

## P3-S2 — the store is the ONLY writer of the developing candle (BARSTORE on)

`components/chart/legacyLiveWriters.js` holds every legacy live writer, MOVED out of StockChart
unchanged: A (livePrices tick effect), B (`onRealtimeBar` + `useRealtimeBars` + reconnect backfill +
60m grid opt-in), C (realtimeCandle registry), D (`legacyAfterSetData` seed / Finnhub re-top +
`legacyPushRetop`), E (fast D/W/M 1m tick + the legend's `liveTickRef`), F (custom-tf), the frozen-chart
watchdog, the per-switch ref reset and the tf-switch push-hold fold. Their state (`liveBarRef`,
`lastBarRef`, `lastBarSymRef`, `barsPushActiveRef`, `provisionalStaleRef`, `sessionOwnsDailyRef`,
`gapHealAtRef`, `watchdogTriesRef`, `barStartVolRef`) is written only there.

**One structural gate.** Each export is chosen once at module load: `LEGACY_LIVE = !BARSTORE`; a hook
export is the writer or an inert stand-in that calls no hook; `liveAfterSetData` /
`liveAfterVolumeSetData` (updateChart's two post-setData steps) are the legacy step or "call the store
paint". So under BARSTORE no legacy writer is mounted: no subscription, no effect, no ref write.
Deleted with the switch (P3-S3).

**The store paint** (StockChart `_storeDevPaintRef`): the only candle / volume `update()` under BARSTORE.
Triggers: after updateChart's setData (`paint(true)`) and the store's dev channel (one call per frame).
It paints `_storeDevRef` = `useBarSnapshotBars.viewDevelopingOf(snapshot)`:
- the view's freeze (provisional CONTEXT on screen, or a tail > 8 h old) is the channel yielding `null`;
- a custom tf gets its own forming bucket: `resampleForSpec` of the native developing bar with the
  native rows of the same bucket (= the last bucket of the base path's resample — railed);
- Heikin-Ashi: `indicators.heikinAshiNext` (the ONE recurrence; `toHeikinAshi` and the adapter's tail
  step with it) continued from the HA bar before the bucket in `displayBars` (review fix (b));
- skipped on replay / cutoff, a D/W/M bar the session preview owns, a non-RTH bucket on an RTH view,
  and (dev channel only) a static chart (`liveUpdates` off);
- never an older state after a newer: a lower `devRev` or an earlier time than the last paint / the
  series tail is refused.
Every reader of "the developing bar on screen" (legend, MA overlay extension, session chip, screenshot
price, the live-tick sanity baseline) goes through `devOnScreenSource` — the legacy refs or the bar the
store paint recorded (`_storeDevBarRef`). Under BARSTORE the legend no longer folds a quote feed into
O/H/L/C, and the D/W/M volume no longer takes the live day volume: both are snapshot.developing's.

**Review fix (a).** A dev flush whose `baseRev` the hook has not rendered yet is dropped by the channel;
the render of that base now takes `store.getSnapshot(key)`'s developing bar whenever its `baseRev`
equals the rendered base's, and paints it in an effect — the final developing state paints even when
no further tick arrives. Railed: `useBarSnapshotBars.devChannel.test.jsx` (deferred render + seeded
interleavings: the bar handed to the paint never goes back and settles on the store's newest).

**Review fix (c).** `utils/viewSession.resolveShowExtended(cs, forceExtendedHours)` is the one
showExtended rule (StockChart, ChartWidget's handoff key, ChartPane / GridChartCell EXT toggles).

Rails: `engine/__tests__/r1StoreWriterCensus.test.js` (R1: the candle-write sites of StockChart are the
base paint, two static Model Book repaints and the store paint; every legacy export is inert under
BARSTORE), `singleWriterIndex.test.js` (derives writers in both files; StockChart holds only writer S),
`StockChart.barStoreLive.test.jsx` (painted P1 H↑ L↓ open-once V↑ per bucket, P2 painted = newest, P3 a
rolled candle = the store's closed row, HA, R1 at runtime with a quote that only the legacy source paints).

## P3-S2b — the live input is whichever live source is active; gaps and tick rows are statuses

- **One D/W/M fold base, two live sources** (`liveFeed.js`). The fold state (the server's developing
  period bar + its arrival) is tracked whether or not push is on. Push gated off (prod:
  `VITE_REALTIME_BARS=0`): the tick fallback drives the period bar — price (H/L union, close; RTH
  ticks only, as the 1m fold) and VOLUME from the live-price feed's cumulative day volume
  (`periodTickVolume`, the one owner). The SERVER's period bar defines the volume (D = the Massive
  daily aggregate, extended hours included; the feed's day volume is the snapshot's regular-session
  `day.v` in RTH and a summed-aggregates total outside it — a different definition), so the feed only
  ADDS what traded since the server's bar arrived: v = base.v + (dayVol − dayVol at arrival), for D/W/M
  alike (unknown arrival / another day ⇒ nothing: v ≤ truth until REST). S4: within a period the
  developing volume never falls (a non-final REST answer merges by max — liveBarMerge.mergePushBar). The reducer
  takes it on `tick-fallback` as `event.v` (period keys only), never lowering the volume. Push is not
  enabled by this.
- **Legend (BARSTORE)**: reads the bar the store paint painted (every tick → dev channel → paint;
  the off-cursor legend re-reads it ≤ 500 ms). **Decision (intentional difference from legacy):**
  the D % is the SHOWN bar vs the PREVIOUS daily bar's close — it matches the candle
  (TradingView-style). Legacy used the feed's change_pct / prev_close, which outside RTH (pre-market,
  before today's bar exists; after hours) names another day's move than the bar on screen.
- **Live gap** (`reducer.liveGapStart`, `liveGapFrom`): a bucket is MISSING only if it starts at or
  after max(verifiedThrough, end of the newest row) — the server never vouched for it (bar-contract.md
  §verified_through); a thin name's proven-empty buckets are not a gap. A live action opening a bucket
  past a missing one records it: `deltaFrom` ≤ it and the store kicks ONE read (index.js). Status is
  untouched and the forming candle still paints. Any server answer clears it.
- **Tick-closed rows**: a closed row the tick fallback produced (src `tick`) after the newest REST row
  sets `snapshot.tailUnverified` (`status.tickClosedTail`) until a REST answer replaces it (rest >
  tick). It is a FLAG, not a status: the status never flaps across tick bucket rolls.
- **R1 census widened**: candle AND volume write sites, per (statement, method); updateChart's
  `_applyData` incremental `update()` is its own row.

## P3-S2c — the open / close switch of the feed's volume; no `tailUnverified`

- The live-price feed's day volume changes DEFINITION at 09:30 (pre-market summed aggregates →
  regular-session `day.v`, which restarts below the pre-market total) and at 16:00. The D/W/M fold
  anchor now records that definition (`def0`: the snapshot's `ext_session`, else the clock), and
  `liveFeed.anchorTick` re-anchors ONLY when the definition or the day changes: `dayVol0` = the
  reading now, `vBase` = the volume already shown (never lower). Within one definition and day a
  falling (stale) reading never re-anchors: the fold keeps the reading's high-water mark and
  v = vBase + (hwm − dayVol0), so a dip-and-recover is never counted twice. The definition is the
  wire `ext_session` ('pre_market' | 'post_market' ⇒ extended; null ⇒ the clock decides).
  The first RTH tick after a pre-market anchor asks the server for the period bar once
  (`onReanchor` → `network.kick`) for what traded between 09:30 and that tick. Railed (seeded,
  across both boundaries): painted v never falls and never under-counts the feed's RTH gain after
  the first post-open tick.
- `snapshot.tailUnverified` is REMOVED. Its only candidate reader, the live badge
  (`intradayTailPoll.liveBadgeState`: live / updating / delayed / stale / unavailable, fed by
  `network.tailExhausted` → `_tailCatchupRef`), cannot express "a tick-closed row awaits the next
  poll" without flapping at every tick bucket roll with push off — the flap the status rule just
  removed — and nothing is late or missing: the next delta re-reads those rows (`deltaFrom` starts at
  or before every unsealed row) and REST replaces them. `status.tickClosedTail` stays as the predicate.
