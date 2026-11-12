# Server bar contract (v1)

Status: P1 of the chart-data consolidation program (2026-11-11). Additive and backward
compatible: every field below is NEW; `bars` and every pre-existing field keep their
exact shape and meaning. This document is the contract the client `BarStore` (P2)
consumes. Implementation: `api/services/bar_contract.py` (the only one), store side
`api/services/bars_sqlite.py` (`series_meta`), stream side `api/routers/stream.py` +
`api/services/bar_broadcaster.py`.

## 1. Where it appears

| Surface | Carries the contract |
|---|---|
| `GET /api/bars` 200 with a `bars` list — every tf (1/5/15/30/60, D/W/M), every serve branch (`Server-Timing: bars;desc=<label>`), full / `since=` (delta) / `to=` (replay), `session=rth|eth|absent` | yes |
| `GET /api/bars` non-200 (`warming` 503, `warm-shed` 503, fault 503) and terminal `no_data` 200 | no (nothing to describe) |
| `/api/stream/bars` `event: bar` frames | yes (identity + `rev` + `final`, section 5) |

## 2. Fields (REST)

```
contract          1
grid              "eth-clock" | "rth-tv" | "plain"
session           "rth" | "eth" | null
cache_key         "b1:<TICKER>:<tf>:<grid>"
series_rev        int | null
history_rev       int | null
verified_through  float (unix s) | null
sealed_through    float (unix s) | null
complete_through  int (unix s) | null
developing        {t, o, h, l, c, v, rev} | null
```

### grid
The bucket grid of the rows in `bars`.
- `eth-clock`: ET clock floors (`t // step * step`) over the 04:00-20:00 extended
  session. All of 1/5/15/30m (rth and eth charts read the same rows), and 60m with
  `session=eth` (TradingView clock hours 04:00 ... 19:00).
- `rth-tv`: the stored 60m grid, TradingView RTH alignment: 09:30, 10:30 ... 14:30, then
  the 15:30 half bar (ends 16:00); pre/post-market hours keep the stored layout
  (09:00-09:30 stub, 16:00, 17:00 ...). Bucket bounds always come from
  `bar_rollup.tv_bucket_bounds` — never compute `t + 3600`.
- `plain`: D/W/M; one bar per period, `t` = `"YYYY-MM-DD"` (D: the session date; W: the
  week's Friday; M: the 1st).

### session
The chart session the answer was judged for: `rth`, `eth`, or `null` when the request
sent no `session` (legacy: 60m on `rth-tv`, tail judged against the extended frontier).
Always `null` on D/W/M.

### cache_key
The canonical, server-issued key of the ROW SERIES. Keyed on `grid`, not on `session`:
an rth and an eth 5m chart hold byte-identical rows (only `tail_status` differs) and
share one entry; the two 60m grids cannot be converted into each other and never share.
Clients MUST use this value as their cache identity and never build their own.
Version prefix `b1` changes only if row identity semantics change.

### series_rev
Revision of the STORED source series (bars.db `series_meta.rev`, keyed `(ticker, tf)`;
the eth 60m grid's source is the 15m series). A hybrid logical clock in milliseconds:
every committed write that touches the series' rows sets `rev = max(rev + 1, now_ms)`
in the same transaction as the rows.
- Monotonic per series per store. Never decreases, including across restarts.
- A wholesale store change (snapshot install, bulk heal) raises every series' served
  rev to at least that instant (`store_meta.rev_floor_ms`).
- MAY increase without a visible value change (a re-write of identical rows); never
  fails to increase when rows change.
- `null` = the answer is not store-backed (breadth, market indicators, indexes,
  delisted entities, yfinance-only symbols) — treat every such answer as possibly new.
- Comparable only within one store. bars-api is the authority (P5 removes the edge's
  web-pod fallback); a different store's rev is time-ordered (HLC ms) but not
  guaranteed monotonic with this one.

### history_rev
The `series_rev` of the newest write that changed HELD HISTORY: a row a client may hold
and that its `since=` deltas will not re-read. Determined by the writer, under the write
lock, by comparing the rows it is about to write with the stored ones
(`bars_sqlite._history_keys`, the only implementation — `data_sync`'s R2 merge feeds its
candidate rows through it too). A write moves it when a row it writes
- is keyed at or below the series' **history floor** — `stored tail - MUTABLE_WINDOW_S`
  intraday (`bars_sqlite.MUTABLE_WINDOW_S` = `BARS_DELTA_HEAL_WINDOW_SECONDS`, 8 h, the
  same window the tail repair rewrites and the client re-reads); every row before the
  tail period on D/W/M (the daily/weekly/monthly delta rewrites only the tail) — sealed
  or NOT, or
- ended at or before the series' `sealed_through` (the region `complete_through` calls
  final),

AND its values differ from the stored row, or its bucket was EMPTY inside the stored span
(a hole: a client may hold the absence). Also: any delete, and a wholesale change. The
stored tail is read before the write.

Never counted: identical rewrites; rows inside the mutable window and past the seal (tail
repairs, live-store updates, hole fills inside the window, completing a provisional row,
tail growth, the developing bar) — deltas carry those, and counting them would turn every
tail repair into a client full reload; rows older than the series' OLDEST stored row
(prepending history: the deep fetch, #1116's `to=` windows, a cold populate) — no client
can hold a bucket older than the store's oldest row (every held row was served from the
store, and a delete moves `history_rev`), and scroll-back reads them from the store. A
deep write's overlap with stored rows is still judged row by row.

Which writers this catches (each goes through `put_bars` / `put_bars_many` /
`_history_keys`): split re-adjust (`bars_split_repair`), the R2 merge's hole fills and
higher-volume corrections below the window, gap-fill and live-store backfill restoring an
old hole, deep writes that differ from stored rows, alert/ingest add-only writes into old
holes. Deletes (#1062 off-grid purge `intraday_grid.repair_pair`, the weekly / impossible /
off-calendar purges, reconciliation) and `replace_ticker_tf_rows` always move it.

**The client poll rule this guarantees** (railed by H1 in
`tests/test_history_rev_corrections.py`, a property test over random write sequences
incl. D/W/M): a client that does a full read whenever `history_rev` differs from the one
it holds, and otherwise asks `since = held tail - MUTABLE_WINDOW_S` (D/W/M: the tail
period) and replaces its rows after `since` with the answer, holds rows byte-identical to
the store over its held span after every poll (5m, 60m, D, W, M). The server answers
`ts > since`, so the row AT `tail - window` is history — and the tail repair never
rewrites it: both sides use ONE boundary, `bars_sqlite.is_held_history` (the repair's
`_delta_keep_bar` re-emits only rows above the floor, plus missing ones).
- `BARS_DELTA_HEAL_WINDOW_SECONDS` is clamped (with a warning) to the client contract
  value `CLIENT_MUTABLE_WINDOW_S` (8 h, `app/src/data/barStore/network.js`): a server
  window wider than the client's would rewrite rows outside the client's delta without a
  bump. A narrower one is safe (more rows count as history).
- While `history_rev` is unchanged, nothing a client holds below its delta start (or at
  or below `complete_through`) has changed.
- A newer `history_rev` = re-read the window you hold (split re-adjust, heal, merge
  correction, reconciliation, snapshot install).
- `history_rev <= series_rev` always.
- The rule is judged against the STORE's tail. A client whose tail runs ahead of the
  store (a push-fed developing bar the store has not written yet) and starts its delta
  from that tail can miss a correction in the few buckets it is ahead by, at the far
  (8 h old) edge of the window; a client should start deltas from the newest REST-served
  row.
- Legacy StockChart tail poll (not BarStore): it asks `since = held tail - 1` and never
  reads `history_rev`, so it misses ANY interior change (inside the window too) until a
  full reload — `history_rev` cannot help it; BarStore is the fix.

### verified_through
Unix seconds at which the provider (or, for live-covered 5m series, the universe live
stream) was asked and every row it returned had ALREADY reached this store. "Nothing
newer existed as of X." Persisted in `series_meta.verified_through` (write-behind,
batched about every second, max-merged), so it survives restarts and reads the same
from every process on that store.
- Written in exactly one place (`bars_fetch._mark_tail_verified`), after a provider
  answer that did not raise and whose rows were persisted.
- Invalidated: a DELETE of the series' rows clears it and refuses any later write of a
  proof taken before the delete (`proof_floor`); a wholesale change voids all proofs.
- Never derived from the stored tail.
- On the wire this is the value `tail_status` uses: for a 5m series the universe live
  stream covers it also includes the stream's proof (`bars_live_store.proven_through_s`).
  It says "nothing NEWER existed"; it does not say the stored rows are final — that is
  `sealed_through`.
- **A claim never outruns the rows it is attached to.** The value on the wire is read
  ONCE, before the answer's rows are (re)read from the store (full intraday answers
  are reconciled to the store over the heal window; `since=` deltas are re-read), and
  is the RAW proof `min(proof, now)` — currentness ("nothing newer existed at X"); the
  settle lag applies only to finality (`sealed_through`), never here (review #1098 F1:
  a lagged value kept thin covered 5m names `unverified` for a minute after every
  boundary). `tail_status` judges that same number. So a cached payload
  never carries a newer claim than its rows: every stored row whose bucket ended by
  `verified_through` is in the payload with the store's values (railed: I4 in the
  property test, and a router-level stale-cache test).
- It is NOT capped at the payload's newest row: for a thin name with no prints after
  15:55 the proof legitimately says "nothing newer up to X" (the client's
  `intradayBarCurrentness` relies on exactly that beyond the one-bucket tolerance).

### sealed_through
Unix seconds: every bucket of the series that ENDED at or before it is final in this
store. Persisted in `series_meta.sealed_through` (write-behind with the proofs).
- Advanced only by THE intraday tail repair (`bars_fetch._heal_intraday_tail`) after a
  provider answer that did not raise and whose rows were persisted: to
  `checked_at - SEAL_LAG_S` (`BARS_SEAL_LAG_SECONDS`, default 45 — late SIP reports,
  the provider's aggregation/publish delay and aggregate re-publication mean a REST
  answer seconds after a boundary routinely holds the just-closed bucket partial), and
  only when the answer's rewritten window (`_delta_intraday` reports `window_start`)
  starts at or before the current value — a contiguous proof — and its check is not
  older than the current seal's check (`sealed_checked_at`). A repair that starts past
  the seal (rows written in between by the live feed, a cold fetch, a merge) cannot
  extend it.
- **An older check never overwrites sealed rows** (review #1098 F2). Concurrent repairs
  of one series each persist what the provider said at THEIR check; every repair write
  carries its check instant (`put_bars(checked_at=)` / the `provider_check` context
  `_heal_intraday_tail` and the background full fetch open), and rows inside a span a
  NEWER check sealed are not replaced by it. Writes without a check instant (split
  repair, merges, rebuilds) are not filtered; when they change held history (section 2,
  history_rev) they move `history_rev`, sealed or not.
- A series with no seal yet trusts the rows below the first repair's window (that
  repair's own "already-final history", `_DELTA_HEAL_WINDOW_SECONDS`, 8 h) — UNLESS rows
  were deleted since: a delete records the oldest deleted key (`unsealed_from`) and the
  next seal must reach back to it (review #1098 F4). A bulk delete (the boot heals,
  `bump_store_floor(deleted_from=)`) records a store-wide point that applies to every
  series not covered since. A gap-fill (`covers_from`: it restores missing rows from its
  `from_date`) or a full / deep fetch (`record_cover`, from its oldest row) clears the
  point, so a series never loses `complete_through` permanently.
- Every provider fetch -> persist site writes under `provider_check(t0)` with `t0`
  taken before its fetch: the tail repair, the background full fetch, the cold fetch,
  the deep fetch and deep-fill, the replay cold window, the alert-bars refresh and the
  live-store backfill. The seal rule exists once (`bars_sqlite._apply_seal`); the flush
  persists what it returns.
- Voided by deletes and wholesale changes by its CHECK instant (`sealed_checked_at` <=
  floor), not by an approximation of the sealed instant (review #1098 F3).
- `null` until the first repair after deploy (cold fetches do not seal; D/W/M are not
  sealed yet — section 8).

### complete_through
Unix seconds. Guarantee: **every row of this answer whose bucket END is
`<= complete_through` is final** — it will not change unless `history_rev` changes (a
correction). `null` = nothing is guaranteed. It is always the END of a row of the answer;
`sealed_through` (which may be later, e.g. a thin name with no prints since) says the
series has no further rows up to that instant.

Computation (`bar_contract.compute`):
1. `limit = min(sealed_through, now, end of the newest stored row that has ended)`.
2. An intraday full answer is first made equal to the store over the store's MUTABLE
   window (`_DELTA_HEAL_WINDOW_SECONDS` back from the stored tail): a memory-cache answer
   taken while a bucket was provisional would otherwise keep that partial below its own
   tail after a later repair finalised it. Read after the series meta, so the answer
   describes the store at `series_rev` or later. D/W/M answers (serve-time sanitised)
   whose last row is not the store's are capped below that row instead.
3. `complete_through = end of the newest answer row with end <= limit`.

For a `since=` delta the rows considered are the store's newest rows (after merging the
delta the client holds the store's tail). For `to=` (replay) the rows are read straight
from the store and step 3 is skipped.

Invariants (railed in `tests/test_bar_contract.py`):
- I1 `complete_through` is `null` or the end of a row in the answer (delta: of a stored
  row), `<= now`, and `<= end of the newest sealed stored row`.
- I2 For one series, while `history_rev` is unchanged, `complete_through` of
  successive answers never decreases (in particular never while `series_rev` is
  unchanged); every row it called final keeps its values.
- I3 A row with end `> complete_through` is either `developing` or *provisional*
  (closed but not yet sealed); a client may show it but must re-read it.
- The property test drives the REAL repair with a provider that publishes a bucket's
  final aggregate a few seconds late and rewrites from a random window start; mutating
  the contiguity rule or the mutable-window reconcile each fails it.

### developing
The bar of the bucket that contains `now` (`start <= now < end`), or `null`.
`{t, o, h, l, c, v, rev}` with `t` in the same unit as `bars` (unix s intraday,
`"YYYY-MM-DD"` on D/W/M). It is the answer's newest row when that row is forming —
so it duplicates `bars[-1]` (old clients keep reading `bars`; new clients take the
forming bar from `developing` and treat `bars` rows with end `> complete_through` as
provisional). When `bars` stops at the newest closed bucket (a first answer that
omitted a forming-only gap) the store's tail, then the push feed's partial (where this
process runs the broadcaster), supplies it; otherwise `null` — never an invented bar.

`developing.rev`: as-of revision in ms, the same clock as the stream's `rev`. REST:
`series_rev` at read time; push partial: its last trade time. A consumer keeps the
developing bar with the greater `rev` for the same `t`.

## 3. Examples

5m, 10:12:30 ET, store tail = the 10:10 bucket (partial), last repair at 10:11:02:
```
"bars": [... {"t": <10:05>}, {"t": <10:10>}],
"grid": "eth-clock", "session": "rth", "cache_key": "b1:AAPL:5:eth-clock",
"series_rev": 1762871522000, "verified_through": <10:11:02>,
"sealed_through": <10:10:57>,
"complete_through": <10:10>,          # the 10:05 bucket's end
"developing": {"t": <10:10>, ..., "rev": 1762871522000}
```
Same series at 10:15:20 before any new repair: the 10:10 bucket has closed but is not
sealed (a repair at or after 10:15:05 seals it); `complete_through` stays `<10:10>` and
`developing` is `null` (the 10:15 bucket is not stored yet).

D at 11:00 ET, store tail = yesterday, today's bar appended live: `complete_through`
null (no daily seal is recorded yet, section 8); `developing` = today's bar.

60m `session=eth` (derived from 15m): `series_rev` / `verified_through` are the 15m
series'; `complete_through` = end of the newest clock hour that ends at or before the
15m answer's `complete_through`.

## 4. Store (bars.db)

```
series_meta(ticker, tf, rev INTEGER, verified_through REAL, proof_floor REAL)  PK(ticker, tf)
store_meta(k TEXT PK, v REAL)   -- rev_floor_ms, proof_floor_s
```
`series_meta` also carries `history_rev INTEGER` and `sealed_through REAL`.
Writers: `bump_series_revs(conn, keys, deleted=, history=)` inside the writer's transaction
(`put_bars`, `put_bars_many`, `replace_ticker_tf_rows`, `delete_bars`, the weekly /
impossible-bar purges, `intraday_grid.repair_pair`, `bars_reconciliation`,
`data_sync._merge_pair`); wholesale writers call `bump_store_floor()` (snapshot
install, init_db purge migrations, the boot heals in `api/main.py`, refresh-all).
A census rail fails any new `INTO ohlcv` / `DELETE FROM ohlcv` site that does neither.
Write cost: one upsert per (series, transaction) — a per-row SQLite trigger was
measured ~6x slower on a 4M-row bulk load and rejected. Proof writes are batched
(`BARS_META_FLUSH_SECONDS`, default 1.0; `bars_sqlite.meta_flush_stats()` reports
lock time).

## 5. Stream (`/api/stream/bars`)

Each `event: bar` frame keeps `{sym, tf, bar: {t (ms), o, h, l, c, v, final,
trade_ts?}, session?}` and adds:
```
contract, grid, session, cache_key, series_rev   -- same values as REST for that series
rev     int ms HLC per (sym, tf-key): max(prev + 1, now_ms), strictly increasing per frame
final   = bar.final
t_s     = bar.t // 1000 (REST's unit)
```
Consistency with REST:
- `cache_key`/`grid` equal REST's for the same (ticker, tf, session) — a client routes a
  frame to the same store entry.
- `final: false` <=> the frame is that series' developing bar (REST `developing`, same
  `t`); `final: true` = the bucket CLOSED in the feed's view (not a seal). Completeness is
  only ever asserted by REST `complete_through` (the stream proves nothing about the
  store); a later `final` frame for the same `t` is a correction.
- `series_rev` is the store's rev (cached up to 1 s); a frame never bumps it — the push
  feed does not write rows. When REST `series_rev` moves past what a client holds, the
  client re-reads REST.

## 6. Session clock (one implementation)

`bars_fetch`: `_session_window(day, session)`, `newest_closed_bucket(tf, session)`,
`tail_within_one_bucket(tf, tail, bucket)`, `session_complete`, `session_end_ts`,
`session_verified`. `intraday_tail_status`, `_needs_fresh`'s completeness escalation and
the three `expected_completed_*bucket` names are readings of these; the former
`intraday_session_complete` (zero tolerance), `intraday_ext_session_complete`
(one-bucket tolerance), `_ext_session_end_ts` and `_ext_session_verified` were removed.
Currentness (`intraday_tail_status`) tolerates ONE bucket against the moving frontier;
session COMPLETENESS after the close (`session_complete`) requires the final bucket
exactly, so a background repair still fills a missing 15:55 5m / 15:59 1m / 15:30 hour
(review #1098 F5).

## 7. Write-lock cost

Measured 2026-11-11, interleaved A/B on one temp store (2000 tickers x 400 rows, this
dev machine under load; medians of 6 rounds; meta = rev upsert + history check):

| write | without meta | with meta |
|---|---|---|
| request-path tail delta (2 rows, `put_bars`) | 0.21 ms | 0.31 ms |
| universe live batch (2000 tickers x 1 row, `put_bars_many`) | 343 ms | 370 ms (+8%) |
| interior 50-row rewrite, unsealed series | 0.53 ms | 0.71 ms |
| proof/seal flush (500 series, one transaction) | n/a | one short txn per second |

Every write reads each written series' stored tail (one PK seek per series, one
statement per 400 series) to place its history floor; a write that touches rows below the
floor or inside the sealed region additionally reads the rows it replaces to compare them
(and, for an absent row, the series' oldest key) — bounded by the rows written. Measured
2026-11-11 (A/B, 2000 tickers x 400 rows, medians): universe live batch 78 -> 81 ms
(+3%), request-path tail write 0.03 -> 0.04 ms, 50-row rewrite below the floor 0.13 ->
0.22 ms. `bars_sqlite.meta_flush_stats()`
reports flush lock time in production. A per-row SQLite trigger was measured 6x slower on
a 4M-row bulk load and rejected.

## 8. Deferred

- D/W/M are not sealed yet (the daily delta does not record a seal), so their
  `complete_through` is null. Cold intraday fetches and the 30m/60m local derivation
  (#1090) do not seal either: a series' first seal comes with its first tail repair.
- `bars_live_store` (universe 5m/D feed) proves currentness (`verified_through`) but
  does not seal: a covered 5m name's `complete_through` advances only with repairs.
- The completeness attempt markers (`_completeness_attempt`, 6 h, and
  `_ext_completeness_attempt`, 120 s) stay in process memory: they only THROTTLE
  provider asks (forgetting one costs one extra ask after a restart) and never decide
  what is claimed, so they do not affect correctness.
- `data_sync` merge counts a corrected row inside the mutable window (incl. the TAIL,
  higher snapshot volume) as a delta, not history, unless it is sealed.

## 9. Migration

- No flag. Tables are created by `init_db` (and self-created by the first writer on a
  store that predates them). Existing rows start at rev 0 / no proof; the first write
  or verification populates them.
- A restart no longer forgets proofs: fewer `unverified` answers and Retry-After polls
  after deploys.
- Clients: ignore unknown fields today; P2 `BarStore` keys on `cache_key`, orders on
  `series_rev` / `rev`, trusts rows only through `complete_through`.
