# Breadth history reader — Session 0: where does the time go?

**Programme opened 2026-09-14 (D-043).** The reader is its own programme because it is a
backend cost problem on a shipped, paid route, not a Data Charts change — and because
`/api/breadth-monitor?days=8000` was measured in production at **54,923 ms cold** (D-042).

**This session is a PROFILE. No product code was changed.**

---

## ⛔ Read this before quoting a number: what this session could NOT measure

The instruction was to reproduce the cold deep read **against a `VACUUM INTO` copy of the
production database**. That requires `railway ssh`, and **the permission classifier denied
it** (`Production Reads`). A denial is not routed around, so:

- there is **no** production copy on this box, and none was attempted by another route;
- `C:\data\breadth_monitor.db` here is **12 KB — schema only**, so there was nothing real
  to read;
- **every number below is from a SYNTHETIC corpus built to production's SHAPE.** It
  measures the CODE — how the reader's cost scales with rows, with row width, and with
  stored bytes. It does not measure the owner's data or the Railway volume.

⭐ **What that still settles, and it is the useful half:** whether the reader has an
algorithmic blow-up (it does not), which phase dominates (it is the merge read, not the
derivation), and whether a measurable part of the work is **provably discarded** (it is).
⛔ **What it cannot settle:** the 200×-ish gap between these numbers and production's. That
requires the copy, and it is the first item of Session 1.

**Method.** `profile_breadth_reader.py` (session scratchpad; reproduced in `evidence/`
outputs) builds two SQLite stores shaped like production — a recent **collector** range and
a deep **reconstructed** range below it — pins `BREADTH_MONITOR_DB`, `BREADTH_OHLC_DB` and
`BREADTH_SENTIMENT_DB` *before* importing anything from `api.**`, clears the
`breadth_history_` cache between samples, and times `get_history_deep` per span plus each
phase separately. Python 3.14, local NVMe, box otherwise idle.

⚠️ **The harness's own first run was wrong and is recorded rather than hidden.** It seeded
the deep store with `source='reconstruct'`, which is not in `_TRUSTED_SOURCES`
(`("live", "intraday_recon", "close_recon")`), so `distinct_dates()` returned nothing, the
deep merge never engaged, and the 8000-day "read" returned 180 collector rows in 33 ms. The
harness now **aborts** when the deep span returns no more rows than the collector range,
because a corpus the reader cannot see produces confident numbers about the wrong code path.

---

## The measurements

Corpus: 4,700 sessions (2008-09-08 → 2026-09-11), 180 in the collector range, 4,520
reconstructed — the same shape as the production window D-042 measured (4,703 rows).

| config | snapshot blob | OHLC rows | 90d cold | 365d cold | **8000d cold** | ms/row @8000 |
|---|---|---|---|---|---|---|
| A — no stored lists, width 20 | 1.1 KB | 90,400 | 72.7 ms | 67.2 ms | **252.7 ms** | 0.054 |
| B — 400-ticker lists, width 20 | 152 KB | 90,400 | 279.7 ms | 357.6 ms | **813.2 ms** | 0.173 |
| C — no lists, width 35 | 1.1 KB | 158,200 | 89.1 ms | 128.7 ms | **388.5 ms** | 0.083 |
| **production (D-042)** | — | — | **1,018 ms** | 10,498 ms † | **54,923 ms** | **11.7** |

† production's 365-day figure is a `&end=` teleport, which engages the merge; the local
365-day rows sit inside the reconstructed range and do too.

### Phase breakdown (config A, 8000-day span)

| phase | ms | share |
|---|---|---|
| `closes_for_dates` (deep store → one row per date) | 129.2 | 51 % |
| `_derive_ascending` (rolling metrics over 4,700 rows) | 63.8 | 25 % |
| `merged_dates` (`SELECT DISTINCT date … WHERE source IN (…)`) | 44.1 | 17 % |
| `values_asof` (sentiment overlay) | 3.3 | 1 % |
| `_adv_decline_seed_before` (one SUM) | 1.2 | < 1 % |
| **accounted** | **241.6 / 252.7** | **96 %** |

The phases account for the whole read, so nothing large is hiding between them.

---

## Finding 1 — the reader is LINEAR, with no algorithmic blow-up

A → C raises OHLC rows ×1.75 and the cost moves ×1.54 (`closes_for_dates` ×1.66,
`merged_dates` ×1.51). A → B raises stored bytes ×143 and the 90-day read moves ×3.8.

⭐ **This is what rules out the tempting explanation.** To turn 252.7 ms into 54,923 ms by
data volume alone, production would need roughly **217× the rows** — about 20 million in
`breadth_daily_ohlc`, i.e. ~4,400 metrics per date. Nothing in the schema suggests that. So
volume alone does not explain production, and the remaining terms are **row size**,
**storage latency on the Railway volume**, and **contention** — in some proportion this
session cannot apportion.

⚠️ Stated the other way, so nobody over-reads it: these numbers do NOT show that production
is doing something different. They show that the same code, on the same shape, costs
250 ms on a local NVMe — and therefore that the 55 s is bought somewhere this box cannot see.

## Finding 2 — a measurable part of the work is thrown away

`breadth_snapshots.metrics` is one JSON blob per date, and it carries `*_list` ticker
arrays. **Both readers parse the whole blob and then delete every `_list` key** —
`breadth_monitor.py:449` (`get_history`) and `:719` (the deep path). The bytes are read off
disk, pushed through the JSON parser, and discarded.

Config B measures exactly that cost and nothing else: same rows, same queries, same
derivation, only bigger blobs. **The default 90-day Monitor view goes 72.7 ms → 279.7 ms**,
and the deep read 252.7 → 813.2 ms.

⭐ This is the one finding that needs no production measurement to act on: the work is
waste **by the code's own admission**, whatever the blob size turns out to be. It is also
the most likely explanation of production's flat **~11 ms per row across a 52× range of
row counts** (11.3 ms/row at 90 days, 11.7 ms/row at 4,703) — a per-row cost that barely
moves with span is a cost that scales with row CONTENT, not with the window.

## Finding 3 — the storage shape

| store | file | shape |
|---|---|---|
| collector | `/data/breadth_monitor.db` | `breadth_snapshots(date PK, metrics TEXT, created_at)` — one JSON blob per session, including the `*_list` arrays |
| reconstructed | `/data/breadth_daily_ohlc.db` | `breadth_daily_ohlc(date, metric, o,h,l,c, source, updated_at)`, **PK (date, metric)**, plus `idx_bdo_metric(metric, date)` |
| sentiment | `/data/breadth_sentiment_history.db` | overlay, as-of lookup; 1 % of the read |

⭐ **The PK gives `WHERE date IN (…)` an index** (SQLite's implicit `sqlite_autoindex`), so
`closes_for_dates` is not the table scan it looks like — worth saying because it is the
first thing a reader assumes. ⚠️ **`source` is indexed by nothing**, and both
`distinct_dates()` and `closes_for_dates()` filter on it; `distinct_dates()` is a
`SELECT DISTINCT date … WHERE source IN (…)` over the whole table, which is why it tracks
total row count (Finding 1).

## Finding 4 — the concurrency picture

- The route handler is a plain `def`, so FastAPI runs it in the **anyio threadpool**
  (measured: `AnyIO worker thread`), not on the event loop. One uvicorn process, one pool
  of 64, shared by every member and every endpoint.
- Since 2026-09-14 (`2d7ae7795`) concurrent readers of the **same window** collapse onto one
  computation (`api/services/single_flight.py`). That bounds duplicated work; it does not
  bound concurrency — a follower still holds its worker while it waits.
- `busy_timeout` is 5 s on the monitor store, 3 s on the OHLC store; WAL on both.
- ⚠️ **Every snapshot write calls `cache.delete_prefix("breadth_history_")`**, so the 4:15 pm
  collector push drops the entire history cache. The first Time Navigator user after the
  close pays a full cold read, every weekday, by design.

---

## Ranked candidates for Session 1

**(a) Stop reading what is thrown away.** Project the `*_list` keys out at the SQL layer
(`json_remove`, or a generated column, or move the lists to a side table keyed by date) so
they never reach the parser. Measured local win: **3.8× on the default 90-day view**.
Behaviour change: none — they are deleted a few lines later. ⚠️ The drill endpoints DO read
those lists (`:1075`), so the fix must keep a path that fetches them for one date.

**(b) Measure on the pod, once, against a `VACUUM INTO` copy.** One copy, the same harness,
`BREADTH_MONITOR_DB`/`BREADTH_OHLC_DB` pointed at it. This is the only thing that
discriminates *row size* from *volume* from *volume latency*, and every remaining item's
rank depends on the answer. ⛔ Blocked in this session on the permission classifier; needs
the owner's word.

**(c) `merged_dates` / `distinct_dates`.** A `SELECT DISTINCT date … WHERE source IN (…)`
with no index covering `source`; 17 % locally and tracking total row count. Candidates: an
index on `(source, date)`, or a small materialised date table the sweep maintains.

**(d) `closes_for_dates` — fetch narrower, not just fewer.** 51 % locally, linear in rows
returned, already chunked at 400 dates. It returns EVERY metric for every date, and the
caller keeps all of them; if the payload is what costs, the projection belongs here.

**(e) `_derive_ascending` — LAST, deliberately.** 25 % of a local read, 12 µs/row. It is the
obvious CPU target and it is the wrong first move: at production's 11.7 ms/row it is under
1 % of the bill. ⛔ Optimising it first would produce a visible diff, a plausible story, and
almost no change to what a member waits for.

⚠️ **Not a candidate: capping `days=` on the monitor route.** Time Navigator and Views
depend on deep windows (owner ruling, D-043). The cap lives on `/series`, which is dark.

---

## What Session 1 should do first

1. **(b)** — the pod measurement, if the owner opens that door. Everything else is ranked on
   an assumption until it runs.
2. **(a)** — it is actionable without (b), and its rail writes itself: a test that asserts a
   history read never parses a `_list` key, with a control proving the drill path still can.

⛔ And a standing caution for whoever picks this up: **this file's numbers are a local
synthetic corpus.** Quote them as "the code costs X per row on an idle NVMe", never as
"the breadth history takes X".
