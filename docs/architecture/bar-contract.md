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
The `series_rev` of the newest write that changed SEALED history: a row whose bucket
ended at or before the series' `sealed_through` (the region `complete_through` calls
final) got different values, or a previously empty sealed bucket got a row; any delete;
a wholesale change. Determined by the writer, under the write lock, by comparing the rows
it is about to write with the stored ones (`bars_sqlite._history_keys`) — identical
rewrites do not count, and completing a provisional row, tail growth and developing-bar
updates never do.
- While `history_rev` is unchanged, a client that holds the series only needs `since=`
  deltas: nothing it holds at or below `complete_through` has changed.
- A newer `history_rev` = re-read the window you hold (split re-adjust, heal, merge
  correction, reconciliation, snapshot install).
- `history_rev <= series_rev` always.

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

### sealed_through
Unix seconds: every bucket of the series that ENDED at or before it is final in this
store. Persisted in `series_meta.sealed_through` (write-behind with the proofs).
- Advanced only by THE intraday tail repair (`bars_fetch._heal_intraday_tail`) after a
  provider answer that did not raise and whose rows were persisted: to
  `checked_at - SEAL_LAG_S` (`BARS_SEAL_LAG_SECONDS`, default 5 — a provider asked at X
  has the final aggregate only of buckets that ended a few seconds before X; the same
  knob as the request path's sealed-bucket rule), and only when the answer's rewritten
  window (`_delta_intraday` reports `window_start`) starts at or before the current
  value — a contiguous proof. A repair that starts past the seal (rows written in
  between by the live feed, a cold fetch, a merge) cannot extend it.
- A series with no seal yet trusts the rows below the first repair's window: they are
  that repair's own "already-final history" (`_DELTA_HEAL_WINDOW_SECONDS`, 8 h).
- Voided like `verified_through` (deletes, wholesale changes).
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
Tolerance is ONE bucket everywhere.

## 7. Write-lock cost

Measured 2026-11-11, interleaved A/B on one temp store (2000 tickers x 400 rows, this
dev machine under load; medians of 6 rounds; meta = rev upsert + history check):

| write | without meta | with meta |
|---|---|---|
| request-path tail delta (2 rows, `put_bars`) | 0.21 ms | 0.31 ms |
| universe live batch (2000 tickers x 1 row, `put_bars_many`) | 343 ms | 370 ms (+8%) |
| interior 50-row rewrite, unsealed series | 0.53 ms | 0.71 ms |
| proof/seal flush (500 series, one transaction) | n/a | one short txn per second |

A rewrite INSIDE the sealed region (a correction) additionally reads the rows it
replaces to compare them — bounded by the rows written. `bars_sqlite.meta_flush_stats()`
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
- `data_sync` merge counts a corrected TAIL row (higher snapshot volume) as tail
  growth, not history, even if that tail had been proven.

## 9. Migration

- No flag. Tables are created by `init_db` (and self-created by the first writer on a
  store that predates them). Existing rows start at rev 0 / no proof; the first write
  or verification populates them.
- A restart no longer forgets proofs: fewer `unverified` answers and Retry-After polls
  after deploys.
- Clients: ignore unknown fields today; P2 `BarStore` keys on `cache_key`, orders on
  `series_rev` / `rev`, trusts rows only through `complete_through`.
