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

---

# Session 1 — the same profile, on the real data

**Authorised by the owner 2026-09-14**: one production read, read-only, breadth tables only.
`VACUUM INTO` to `/tmp/uctprof` in the web pod (never the live file, never the volume), gzip,
base64, streamed out, **sha256-verified byte-for-byte against the pod's own checksum**, and
the pod's temp copies deleted immediately afterwards (removal list printed, `still_exists:
false` confirmed).

| file | production | vacuumed | quick_check | tables remaining after the strip |
|---|---|---|---|---|
| `breadth_monitor.db` | 111,247,360 B | 111,067,136 B | `ok` | `breadth_snapshots` — **174 rows** |
| `breadth_daily_ohlc.db` | 30,486,528 B | 26,292,224 B | `ok` | `breadth_daily_ohlc` — **174,187 rows** |
| `breadth_sentiment_history.db` | 2,113,536 B | 1,990,656 B | `ok` | `breadth_sentiment` — **15,897 rows** |

⛔ **Nothing was dropped, and that is a measurement, not an omission.** Each file holds
exactly one table and every one is breadth history — no users, sessions, preferences,
journal or anything member-identifying was ever in these files, so the strip had nothing to
remove. The enumeration is printed above precisely so "there was nothing to drop" is on the
record rather than indistinguishable from a strip that never ran.

⚠️ The copy lives under the session temp directory (`uct-breadth-profile/prod`) —
**outside the repository**, so it cannot be committed by accident. It is not gitignored; it
is unreachable from git.

## The blob shape — the finding the whole programme turns on

| | |
|---|---|
| snapshot rows | **174** |
| total blob bytes | **105.7 MB** |
| **average blob** | **636,834 bytes per session** |
| `*_list` payload | **105.3 MB** |
| **`_list` share of every blob** | **99.7 %** |
| list keys per row | 21.9 (22 in the newest row) |
| tickers per row | **7,803** |

**Every history read parses 636 KB per row and keeps 0.3 % of it.** The numeric keys — all
70 of them, which is the entire Monitor grid — total **0.25 MB across all 174 rows**.

## Cold reads, each in its OWN process

⛔ One measurement per process, because the first draft ran nine reads in one and the
"cold" 8000-day number came out at 3,608 ms — *higher* than the same read under cProfile
(1,588 ms), which should be slower. Each read parses ~106 MB of JSON; by the ninth the
allocator was carrying the previous eight. A number that moves with how much the harness
has already done is a number about the harness.

| span | rows | cold | ms/row |
|---|---|---|---|
| 90 days (the default Monitor view) | 90 | **868 ms** | 9.64 |
| 365 days | 365 | **1,362 ms** | 3.73 |
| 8000 days | 4,703 | **1,860 ms** | 0.40 |

⭐ **ms/row FALLS as the span grows**, which is the opposite of what a per-row cost looks
like. The expensive part is a near-fixed 105 MB of blob work that *every* span pays: the
90-day default view pays almost as much as the 8,000-day teleport, then amortises it over
52× fewer rows.

## Phase table (8,000-day span)

| phase | ms | share |
|---|---|---|
| **blob parse** (`json.loads` × 174) | **1,417** | **68.1 %** |
| SQL fetch, OHLC (`closes_for_dates`, 4,529 dates) | 199 | 9.6 % |
| **`_list` strip** (`del` the keys just parsed) | **119** | **5.7 %** |
| SQL fetch, snapshots | 97 | 4.6 % |
| `merged_dates` (`DISTINCT date … WHERE source IN`) | 73 | 3.5 % |
| `_derive_ascending` (incl. the 15 warm-up rows) | 62 | 3.0 % |
| serialise (route-level; `get_history_deep` does not do this) | 49 | 2.4 % |
| `values_asof` (sentiment) | 48 | 2.3 % |
| merge (build the row list) | 10 | 0.5 % |
| `_adv_decline_seed_before` | 7 | 0.4 % |
| **phase sum** | **2,081** | |
| reference read, same process | 1,779 | **reconciles 117 %** |

⚠️ **117 %, and the over-count is explained rather than filed off.** The decomposition
re-fetches and re-parses the snapshot blobs on a second pass (the real read does it once),
and it includes `serialise`, which happens in FastAPI and not inside `get_history_deep`.
Removing serialise leaves 114 %.

⭐ **The absolute ms move ±25 % between runs on this box; the SHARE does not.** Across four
runs `blob_parse` measured 66.0 / 68.1 / 68.1 / 69.6 %, and parse + strip 73–75 %. The share
is the finding; the absolute is a property of the machine.

## The three fix shapes, measured — one of them is worse than doing nothing

105 rows (the default view's window), best of three runs each, on the real blobs:

| shape | ms | vs today |
|---|---|---|
| **today** — `SELECT metrics` → `json.loads` → `del` each `_list` | **627.7** | — |
| **`json_remove()` in SQLite**, then parse the remainder | **1,563.6** | **2.49× SLOWER** |
| **numeric-only column**, written once | **1.3** | **485× faster** |

⛔ **JSON-path extraction in SQL is not a fix — it is a regression.** `json_remove` makes
SQLite parse the 636 KB blob and serialise a new one, and Python still parses the result. It
moves the cost and adds to it. This is the option that looks cheapest, needs no migration,
and is the only one of the three that makes things worse; it is measured here so nobody
adopts it on plausibility.

⭐ The numeric projection of all 174 rows is **0.25 MB** and took **1,163 ms to build once** —
about 7 ms per row, i.e. nothing on the collector's write path.

## Re-ranked, against real numbers

**(a) Stop parsing ticker arrays on numeric reads — CONFIRMED, and it is the bulk.**
99.7 % of the bytes, 68 % of the time, 74 % with the strip. **Shape: a numeric store written
on write** — a second column or a side table — **not** SQL-side JSON surgery (measured
2.49× worse). The lists must stay reachable one date at a time: the drill endpoints read
them (`breadth_monitor.py:1075`), so the fix keeps a by-date path, and the rail is a test
asserting a history read never parses a `_list` key with a control proving the drill path
still can.

**(b) ⭐ NEW TOP OPEN QUESTION — the 30× the data does not explain.** The same read, on the
same bytes, is **1,860 ms here and 54,923 ms in production** (D-042). It is not the data:
this *is* production's data. Candidates, none yet measured: pod vCPU speed; contention on the
one uvicorn process (40+ scheduled jobs plus every member); volume IO; and the part of D-042
that is not in this number at all — FastAPI serialisation of 4,703 rows, GZip of a 5.18 MB
payload, and the Cloudflare hop, since D-042 timed an HTTPS round trip end to end and this
times a function call. ⚠️ **Until that is settled, no local number may be quoted as a
production improvement.**

**(c) `closes_for_dates` — 9.6 %.** Second-largest, linear in rows returned. After (a).

**(d) `merged_dates` / `distinct_dates` — 3.5 %.** `SELECT DISTINCT date … WHERE source IN`
over 174,187 rows with no index covering `source`. Cheap to fix, small to win.

**(e) `_derive_ascending` — 3.0 %, and LAST, confirmed on real data.** The obvious CPU target
is a twentieth of the bill. Optimising it first would produce a visible diff, a plausible
story, and almost no change to what a member waits for.

⚠️ Still not a candidate: capping `days=` on the monitor route (owner ruling, D-043).

---

# Session 4 — where the deep read goes now, measured in BYTES as well as milliseconds

The materialised tables exist in production (verified on a refreshed `VACUUM INTO`
copy: `breadth_snapshots` 175, `breadth_snapshot_numeric` 175, `breadth_daily_ohlc`
174,263, `breadth_reconstructed_daily` 4,701, every file `quick_check: ok`, every
table breadth history). 4,703 rows x 80 keys should read in tens of milliseconds.

⭐ **BYTES READ, NOT JUST MILLISECONDS.** Time on this box is a property of a warm
page cache; bytes are not. Each phase reports `GetProcessIoCounters.ReadTransferCount`,
so "which file did this touch" is a measurement.

## Before

| phase (on the request path) | ms | bytes read |
|---|---|---|
| **`merged_dates` / `distinct_dates`** | 96.6 | **11,329,088** |
| SQL fetch `breadth_snapshot_numeric` | 11.3 | 368,640 |
| SQL fetch `breadth_reconstructed_daily` | 99.5 | 6,090,852 |
| merge + precedence + row-dict | 17.5 | 0 |
| adv_decline seed | 2.2 | 37,064 |
| `derive_ascending` | 142.5 | 0 |
| serialise (route-level) | 112.0 | 0 |
| **on-path total** | **499.0** | **17,825,644** |
| reference read, same process | 362.2 | 17,882,612 |

⛔ **The date lookup read MORE than the table it exists to index into.**
`SELECT DISTINCT date` still walked all 174,263 OHLC rows — a covering index still
has to scan every entry to produce a DISTINCT — while `breadth_reconstructed_daily`
holds exactly one row per such date behind a PRIMARY KEY.

## After

| phase | ms | bytes read |
|---|---|---|
| `merged_dates` / `distinct_dates` | **9.0** | **127,176** |
| SQL fetch `breadth_snapshot_numeric` | 10.8 | 368,640 |
| SQL fetch `breadth_reconstructed_daily` | 87.0 | 6,090,852 |
| merge + precedence + row-dict | 12.3 | 0 |
| adv_decline seed | 2.4 | 37,064 |
| `derive_ascending` | 119.2 | 0 |
| serialise (route-level) | 78.2 | 0 |
| **on-path total** | **318.9** | **6,623,732** |
| reference read, same process | 241.5 | 6,680,700 |

**89x fewer bytes for the date set; 2.7x fewer for the whole read.**

⭐ **What the request path no longer touches, measured in the same run rather than
asserted:** `closes_for_dates` 233.7 ms / 8,753,252 bytes and sentiment
`values_asof` 56.2 ms / 1,513,459 bytes — both now **zero** on the request path. The
26 MB OHLC table and the sentiment history are off it entirely; what remains is the
two materialised tables and their indexes.

⚠️ **The decomposition reconciles at 132 %**, over-counting because it re-runs reads
the single reference read does once, and because it includes route-level serialise
which `get_history_deep` does not perform.

⚠️ **The cold-cache run was NOT reproduced locally.** Windows has no ready
`drop_caches`, and copying a file to force a cold read pulls it into the cache on the
way. What IS cache-independent is the bytes column, and a cold read cannot cost less
than the bytes it must fetch: the floor fell from 17.8 MB to 6.6 MB, and from 105.7 MB
before the projection existed. The production first-after-boot sample remains the real
cold measurement.

## What is left, and why it is not obviously reducible

`derive_ascending` (119 ms) and serialise (78 ms) are CPU over 4,703 rows x 80 keys
and return no bytes; the 6.09 MB reconstructed fetch **is** the payload (5.18 MB
serialised). Those three are the read now.

