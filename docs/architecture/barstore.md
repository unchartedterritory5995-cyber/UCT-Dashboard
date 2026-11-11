# BarStore (client) — P2a core

Status: P2a of the chart-data consolidation program (2026-11-11). Built OFF TO THE SIDE:
`app/src/data/barStore/` is imported by no runtime module yet. P2b adds persist / network /
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
cacheKey, grid, tailStatus, sealedSpans, restFrom, deltaFrom, status, baseRev, devRev, depth,
source, restSeen, needsFull, error, invalidatedFor, gen, pendingHistoryRev, depthFloor}`

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

### One guard for every server-sourced action
`staleReason` refuses a payload whole when its `gen` is stale or its `history_rev` is OLDER than
the one held (or pending) — rest-full, rest-delta, rest-error, scroll-back and local copies.
A late answer from before a correction / delete can therefore never resurrect a removed row.

## Actions

| type | rule |
|---|---|
| `seed-from-pack` / `idb-hit` / `mem-hit` | before any server answer: seed (last row is `developing` if its bucket has not ended). After one: only rows OLDER than the server-covered region are prepended. Another cache_key / older history_rev ⇒ discarded. Local rows are never sealed; a server row always replaces a local one. |
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
- S8 (persist) and S9 (network) belong to P2b.

Coverage: 7 dates (both 2026 DST edges, both half-days, plain days) × RTH/ETH × 1/5/15/30/60m
(+ a daily series suite). Mutating the seal protection, the sealed-span insertion block, the
absence rule, the rev gate, the stream-live tick gate or the foreign check each fails it.

## Deviations from the design spec (BARSTORE-SPEC.md)

- `push-final` does not advance `completeThrough`: P1 §5 — only REST asserts completeness.
- `rest-delta` invalidates on a risen `history_rev` (P1's "sealed history changed"), not on any
  `series_rev` change (`series_rev` rises on every write, including tail growth).
- Seals are per span carried, not a single threshold: a delta's claim never seals rows it did
  not re-read (`deltaFrom` tells network.js where to start).
- Hydrated (local) rows are never sealed; the first server answer re-proves them.
- A delta with a new history keeps the chart and waits for a full read (no blank frame).
