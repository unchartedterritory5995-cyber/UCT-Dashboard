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

# Session 2 — what the 30x is NOT, settled by direct measurement

⚠️ **Reconstructed from commit messages, `docs/breadth/DECISIONS.md` (D-044) and
`docs/breadth/flow-worker-strand-timing.md`.** Session 2's own working notes were not
written to this file at the time; every number below is quoted from an artifact that
exists, and nothing is reconstructed from memory.

The owner's ruling was to stop reasoning about the 30x and price each candidate:
{encoder, gzip, memory, vCPU, contention, volume IO}.

## The candidates, and what each one measured

| candidate | measured | verdict |
|---|---|---|
| **encoder** | the whole post-reader bundle was 561.7 ms locally on the 8,000-day span — 14.3 % of a 3.9 s full-stack request | cannot carry a 30x here |
| **GZip** | same bundle; compression is a fraction of it | ruled out |
| **memory** | a real read's transient peak is **117.1 MB**, not the 616 MB / 1.36 M objects the first probe reported | ruled out |
| **framework** | the difference between a function call and an HTTPS round trip, measured on the same box | ruled out |
| **contention** | the same read: **224 ms settled** vs **17,480 ms three minutes after boot** — a **54x swing on identical code and identical bytes** | ⭐ **this is it** |

⭐ **The conclusion, stated plainly because the owner asked for it plainly: the 30x is
CONTENTION on the single uvicorn process**, not the encoder and not memory. One uvicorn
process is one event loop and one anyio threadpool of 64, shared by every user and every
background job on the pod; a deep read that lands during the post-boot warm storm queues
behind all of it.

## ⚰️ The manufactured finding, kept rather than deleted

The first blob-memory probe held **all 174 parsed blobs at once** and reported 616 MB /
1.36 M objects. The reader does `fetchall()` and then parses **one at a time**, so the
real transient is 117.1 MB. The bad number is kept in the record, labelled, as the
counterfactual — deleting it would leave the next reader without the reason the
measurement is shaped the way it is.

⚠️ **And `tracemalloc` inflated the timings 4.9x** (868 ms → 4,247 ms). Time and memory
are measured in **separate process modes** for that reason, one measurement per process.

## What shipped

| commit | what |
|---|---|
| `7705c2d3b` | the production timing instrument (`api/services/breadth_timing.py`) — `Server-Timing` header + one structured `[breadth-timing]` log line, shipped as its own merge with the member-facing summary *"Internal: timing diagnostics on breadth history reads"* |
| `685a19bdb` | fix shape (a), the numeric store — see **D-045** |

⚰️ **The instrument's first version reported `reader_ms=0.0` for a reader that had just
run.** The route is a plain `def`, so FastAPI runs it in the anyio threadpool and anyio
**copies** the context; a `ContextVar.set()` in the worker is invisible to middleware on
the event loop. The fix is a middleware-owned record mutated **in place** — a copied
context still points at the same dict. **The unit rails passed throughout**, because they
exercised an async stand-in and were structurally blind to the one boundary that mattered.

---

# Session 3 — materialise the reconstructed side, and make stacked pushes a rule

⚠️ **Reconstructed from commit messages, D-045 and the runbooks**, as above.

## What shipped

| commit | what |
|---|---|
| `b4c141948` | `breadth_reconstructed_daily` — the reconstructed side stops being assembled per request and becomes a table with watermarks |
| `f7e09f56c` | the migration tolerates a continuously-written input |
| `725151fd3` | `idx_bdo_source_date(source, date, metric, c)` |

The writers are enumerated in D-045; precedence (collector beats reconstructed) is
asserted in the reader and railed, not left implied.

## The stacked-push rule, promoted from a footnote

Written into `docs/runbooks/deploy-windows.md`, `CLAUDE.md` and `docs/breadth/gates.md`,
and enforced by an extended `tools/pre_push_guard.py`
(`suspected_stacked_pushes(rows, window=STACK_WINDOW_SECONDS=300)`, `MIN_SETTLE_SECONDS
= 150`), plus an hourly `--audit` via `tools/stacked_push_audit.ps1` and the Task
Scheduler job `UCT-StackedPushAudit`.

⚰️ **The incident it encodes:** `7705c2d3b` pushed at 12:29:23 UTC on a green guard;
`9e2b93805` pushed **173 s later** while it was still BUILDING, marking it REMOVED
mid-flight. A request in flight died with a 500 after 93 s and `/api/health` served 502
for ~45 s.

⭐ **The gap is a TIME gap, not a logic gap.** The guard reads the queue at the moment of
the push and is correct at that moment; a build takes 3–5 minutes and a gate takes
longer. *"The queue was clear when I started my gate"* is true and useless — **the wait
is on the DEPLOY, not on the check.**

⚠️ The audit reports **SUSPECTED**, never CONFIRMED: Railway's deployment list carries
only `status` and `createdAt`, so it can show that two commits deployed closer together
than a build takes and cannot show the first was still building. See Session 5 for a
ground-truth method that can.

## Deferred

Pre-warm, by owner ruling — one heavy lane at a time.

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

---

# Session 5 — the gate that was not gating, and six settled samples

## Wait-for-CI is not a gate — measured, not inferred

Eight consecutive `web` deploys on 2026-09-14, 19:10Z–21:30Z. Each one **started before
its own check suite finished**, including `7707b2241`, which was created **after** the
Wait-for-CI toggle was already ON. The lead was **99–141 s** on every one of the eight.

⚰️ **And the check set is not the workflow list.** GitHub lists **9** workflows for this
repo; `.github/workflows/` holds **7**. Two are ghosts — run history, no file. Any design
that enumerates "required checks" must derive them from the directory, never from the UI.

⭐ **A toggle that is ON and not gating is worse than one that is OFF**, because every
session downstream of it reasons as though the queue is protected. Session 6's Workstream
4 replaces it with a promoted-branch gate.

## The n=6 settled sample, and the finding in it

With `settled := /api/health uptime_seconds >= 600`, six forced-cache-miss reads of the
deep span. The result that redirected the programme:

⚰️ **`post_reader_ms` exceeded `reader_ms` in all six.** The optimisation target had
moved, and the shipped instrument could not say where either side spent its time — it
reported two numbers and a total. That is what Session 6's Workstream 1 exists to fix.

⚠️ **n=6 cannot bound a p95.** With six observations the 95th percentile rests entirely
on the largest sample and has no upper confidence bound from data. Session 6 re-sampled
at n=20 for exactly this reason.

---

# Session 6 — naming the post-reader cost, and a p95 that is actually estimable

## Workstream 2 — n=20 settled window

Against deployed `1216958ed`, window 22:23:04Z–22:38:25Z, uptime 708→1,629 s
(**monotonic — no restart mid-window**), every sample a forced cache miss on a distinct
`days=` key, all 200, `decoded_bytes` 681,973–681,975, `railway logs` streamed to
`logs/session6-sample.log` every 5 samples (128 `[breadth-timing]` lines, 8 capture
blocks) because the buffer is ~500 lines ≈ 10 minutes and a window longer than that
loses its own evidence.

| deep, n=20 | min | p50 | p90 | p95 | max | sd |
|---|---|---|---|---|---|---|
| wall (client) | 796.2 | **980.8** | 1,560.2 | **1,749.7** | 1,897.7 | 316.7 |
| server `total_ms` | 526.9 | 696.3 | 1,224.5 | 1,429.0 | 1,496.4 | 281.2 |
| `reader_ms` | 144.2 | 209.7 | 631.8 | 998.8 | 1,000.4 | 258.2 |
| `post_reader_ms` | 377.6 | **433.0** | 549.1 | 581.5 | 742.1 | **89.4** |

| shallow (days≈90–95), n=5 | min | p50 | p95 | max |
|---|---|---|---|---|
| wall | 258.8 | 301.4 | 603.3 | 675.2 |
| `reader_ms` | 90.9 | 101.6 | 373.9 | 434.6 |
| `post_reader_ms` | 24.0 | 27.2 | 52.2 | 58.2 |

⭐ **p95 IS estimable at n=20.** The exact binomial CI puts the true p95 between order
statistics 18 and 20 — **[1,540.0, 1,897.7] ms**, bounded by real observations on **both**
sides. At n=6 there was no upper bound at all.

⭐ **Post-reader is the steady half and the reader is the volatile one:** post sd 89.4 vs
reader sd 258.2, and post exceeds reader in **17 of 20** (median ratio 2.09). The
volatility is contention (Session 2); the floor is encoding.

## Workstream 1 — where each half spends its time

Nine reader phases and three post-reader phases, on the existing contextvar record. Local,
against `VACUUM INTO` copies of the production databases, through the **real route**
(TestClient, real middleware, plain-`def` route in the anyio threadpool).

| phase | cold `cache=miss` | warm `cache=hit` |
|---|---|---|
| `merged_dates` | 21.0 | absent |
| `collector_floor` | 8.4 | absent |
| `anchor` | 0.003 | absent |
| `numeric_fetch` | 11.3 | absent |
| `reconstructed_fetch` | **99.0** | absent |
| `merge_rows` | 8.4 | absent |
| `adv_seed` | 2.1 | absent |
| `derive` | **90.5** | absent |
| `cache_set` | 0.017 | absent |
| **reader_ms** | **248.2** | **0.0** |
| `route_tail` | 34.1 | 0.02 |
| `encode_render` | **525.5** | **582.8** |
| `gzip_send` | 0.731 | 0.883 |
| **post_reader_ms** | **563.3** | **586.8** |

⭐ **`encode_render` is the dominant post-reader phase, and a cache hit does not touch
it.** The cache stores the Python object; the route re-encodes it on every request. Split
locally on the same payload:

| | ms | bytes |
|---|---|---|
| `jsonable_encoder` | **481.1** | — |
| `json.dumps` | 116.1 | 4,958,869 |
| gzip level 9 | 158.0 | 577,540 |
| gzip level 1 | 16.1 | 1,287,641 |

⚰️ **GZip does not dominate, and the `*_list` question is moot twice over:** the lists
are already absent from the wire (D-045's projection removed them), and no single key
exceeds 4.5 % of the payload. What the encoder is paying for is **376,240 scalar cells**
(4,703 rows x 80 keys) — ~1.28 us each. This is a per-value cost, not a byte-volume cost,
which is why compressing harder does not help and why a pre-serialised response would.

### Controls, all against the real route

| control | result |
|---|---|
| (a) every phase > 0 on a deep `cache=miss`, none absent | **PASS** |
| (b) phases account for 97.0 % of `reader_ms` (residual 7.5 ms) and 99.5 % of `post_reader_ms` (residual 3.0 ms) | **PASS** |
| (c) on `cache=hit` the reader phases are **absent** and post-reader is still 586.8 ms | **PASS** |

⭐ **A known-expensive read needs no shipped flag.** Emptying `breadth_snapshot_numeric`
and `breadth_reconstructed_daily` on a **local copy** forces the legacy blob path:
`reader_ms` 3,778.8 for **174 rows**, of which `numeric_fetch` is 3,563.1. Nothing was
added to a paid route to make it slow on purpose.

### Parity

**EXACT.** sha256 `7695923c7e80d3abe7ca9a8692af3f6adf9295a8369ad033520d65f49b57cc6d` over
**5,576,278 bytes** across spans 90/365/8000, 4,703 rows x 80 keys, identical between the
instrumented tree and a real `origin/master` worktree. Controls: flipping one byte and
truncating one byte each differ. ⚰️ The golden is a **worktree**, not a module swap — the
change touches the router, which a module swap cannot cover.

### Allocation

**1,201 B per request** (tracemalloc, 200 requests) against a 4.96 MB payload the request
already builds. `rss_after_mb` is reported to 0.1 MB; this cannot move it.

---

# Session 7 — the encoder leaves the request

## What shipped, in order, each to SUCCESS before the next

| merge | commit | what |
|---|---|---|
| M1 | `a6cfa511d` | D-045/Sessions 2-6 record, heading normalisation, D-046 (the cap closed) |
| M2 | `5ea008844` | the per-phase instrument + the missing rail for defect 3 |
| M3 | `57e5131a3` | the promoted-branch deploy gate (workflow only; no cutover) |
| M4 | `baffee6cf` | **the pre-serialised history response** |

## Workstream B — the production BEFORE, with per-phase notes for the first time

⚠️ **Two runs, because the first window was contaminated 10 minutes in.** Another
workstream deployed `8e6f892a7` at 23:54:23Z; pod uptime fell 1,236 → 54. Samples 17-35
of run 1 ran on an unsettled pod and are **excluded from every statistic and reported as
excluded** — 19 of 56 collected. The reader path was re-verified byte-identical across
the intrusion (5 files IDENTICAL, 17 files changed as the control) before run 2 opened.

| deep cold, n=22 settled | min | p50 | mean | p95 | max | sd |
|---|---|---|---|---|---|---|
| `total_ms` | 547.6 | 728.6 | 1,072.0 | 3,093.2 | 3,933.1 | 869.8 |
| `reader_ms` | 158.4 | 219.6 | 564.4 | 2,564.7 | 3,197.9 | 824.1 |
| `post_reader_ms` | 376.8 | 470.0 | 507.6 | 729.9 | 877.6 | 123.8 |
| `encode_render` | 349.8 | **425.2** | 470.5 | 702.5 | 865.1 | 126.7 |
| `reconstructed_fetch` | 59.3 | 91.2 | 370.0 | 1,353.1 | 2,974.5 | **674.9** |
| `derive` | 68.1 | **79.8** | 82.0 | 99.4 | 123.5 | **12.1** |

p95(`total_ms`) rests on order statistics 20..22 → **95 % CI [1,893.8, 3,933.1]**.
Two samples exceed 3x the running median; without them n=20, p50 721.5, p95 1,432.4.

| warm days=365, n=10 | min | p50 | p95 | max |
|---|---|---|---|---|
| `total_ms` | 55.1 | **74.7** | 352.6 | 525.7 |
| `encode_render` | 39.3 | **50.8** | 57.4 | 58.2 |

| cold days=365, n=5 | min | p50 | max |
|---|---|---|---|
| `total_ms` | 75.8 | 131.7 | 221.6 |

## ⭐ The finding: the volatility is ONE phase, and it is not CPU

Across a **20.2x swing in `reader_ms`** (158.4 → 3,197.9 ms) inside a settled window:

| phase | ratio slowest/fastest |
|---|---|
| `reconstructed_fetch` | **50.2x** (59.3 → 2,974.5 ms) |
| `numeric_fetch` | 9.8x |
| `derive` | **1.0x** (76.8 → 77.2 ms) |

⛔ **`derive` does not move at all.** It is pure CPU over 4,703 rows x 80 keys, so if the
uvicorn worker were starved of CPU it would scale with everything else. It is flat across
the entire range. **The residual volatility inside a settled window is SQLite read latency
on the Railway volume for `breadth_reconstructed_daily` — volume I/O, not vCPU.**

⚠️ That refines Session 2 rather than overturning it. The 30x between a settled read and a
post-boot read is contention; the 20x *within* a settled window is I/O on one table.

⭐ **Production `encode_render` is ~20 % FASTER than local** (p50 425.2 ms vs 525-544 ms
measured on this box), which is worth knowing before any local number is used to predict a
production saving.

## Workstream C — the pre-serialised response

`jsonable_encoder` was walking **376,240 values that are already plain scalars**, on every
request including a cache hit, because the cache held row dicts. The route now renders its
own JSON once and caches the **bytes**.

| local, real route | before | after |
|---|---|---|
| days=8000 warm | 508.3 ms | **61.2 ms** (8.3x) |
| days=8000 cold | 827.8 ms | **382.5 ms** (2.2x) |
| days=365 warm | 50.7 ms | **10.0 ms** (5.1x) |
| days=365 cold | 176.2 ms | 148.9 ms (1.2x) |

⛔ **LOCAL.** Section D owns the production numbers.

⭐ **Byte-identity is STRUCTURAL.** `_render_json` makes the same call with the same
arguments `starlette.responses.JSONResponse.render` makes — `ensure_ascii=False,
allow_nan=False, indent=None, separators=(",", ":")` — read off the installed source. A
rail pins those four arguments, so a starlette change surfaces as a failure rather than as
drift. Parity: sha256 `7695923c…` over **5,576,278 bytes** across 90/365/8000 against a
real `origin/master` worktree, with flip-one-byte and truncate-one-byte controls.

⭐ **Caching bytes is SMALLER than caching dicts**, which inverts the risk flagged at the
end of Session 6: the rows cost **24,471,209 bytes** as live Python objects and
**4,958,766** as JSON. Peak RSS over baseline, one measurement per process: cold 61.4 MB
on both sides; including the warm request **68.0 → 63.4 MB**, i.e. the new path peaks
*lower*. Resident grows 4.7 MB — exactly the cached body.

### The orjson question, answered and declined

`orjson` is **already a declared dependency** (`requirements.txt:80`) and was measured
**byte-identical on all three spans**, at 43.2 ms against stdlib's 113.0 ms.

⛔ **It was still not taken.** It serialises NaN and ±Inf to `null` where the current path
**raises**. That is a silent behaviour change on a data edge — a 500 becomes a plausible
wrong number — so it is the owner's decision, not a side effect of a performance change. A
parametrised rail pins the refusal.

⭐ The general form: **stdlib's byte-identity is structural (same function, same
arguments); orjson's is empirical (matches today's data, diverges on a known edge).**

## The GZip level table (measured, not changed) — production runs level 5

days=8000 body, 4,958,867 B uncompressed:

| level | compress ms | bytes out | vs level 5 |
|---|---|---|---|
| 1 | 28.7 | 1,287,614 | +93.0 % size, −32.7 ms |
| 3 | 46.4 | 800,161 | +19.9 % size, −15.0 ms |
| **5 (production)** | **61.4** | **667,150** | — |
| 6 | 103.1 | 654,066 | −2.0 % size, +41.7 ms |
| 9 | 148.1 | 577,542 | −13.4 % size, +86.7 ms |

⚠️ The in-code comment justifying level 5 says level 9 buys "<3% size gain". **Measured,
it is −13.4 %.** The choice still looks right — level 9 costs +86.7 ms of shared event
loop for it — but the number in the comment is wrong and should be corrected or dropped.

## Workstream E — the deploy gate, observed

| merge | `master deploy gate` | `promote to production` |
|---|---|---|
| M3 | 00:22:28 → **00:24:39** | started **00:24:41**, done 00:25:05 |
| M4 | 02:42:38 → **02:44:54** | started **02:44:56**, done 02:45:20 |

⭐ **The promotion starts 2 seconds AFTER the gating check completes, on both.** Compare
Wait-for-CI, which started eight consecutive deploys **99–141 s BEFORE** their checks
finished. The mechanism does what the toggle did not.

**E.1 answered:** the workflow does **not** create `production` — it runs
`git ls-remote --exit-code --heads origin production` and, when absent, emits
`::notice title=Nothing promoted::` and no-ops. Creating the branch is deliberately an
owner step. `production` was therefore created by hand as an exact copy of master at
**`7ac0e0aee`**, and M4's promotion fast-forwarded it to **`baffee6cf`** — verified an
ancestor of master, never forced.

⚠️ **Railway still watches `master`. `production` is unwatched.** No cutover happened.

# Session 8 — the label was wrong, and the read is not what it looked like

## What shipped

| merge | commit | what |
|---|---|---|
| M5 | `07cd3319c` | the Session 7 record |
| M6 | `47e1516b5` | the cache-tier fix + the `reconstructed_fetch` split |

## The label was wrong, not merely vague

`_history_deep_uncached` delegates any window inside the collector range to
`get_history`, having already noted `cache="miss"`. **`get_history` noted nothing at
all.** So a `days=90` request served entirely from `get_history`'s own cache reported
`cache=miss` — on every request, indefinitely, in the direction that makes a warm path
look like work.

`cache` now reports what served the request; a new **additive** `cache_tier` says which:
`body` | `deep` | `plain` | `miss`. `cache` keeps hit/miss so every Session 5/6/7 log line
still parses, and a rail asserts exactly that.

⭐ **The rails decide "was this cached" from whether `_history_uncached` actually RAN**,
never from the label under test — the standing rule that a harness measures what served
the request rather than asserting a label. Mutation-proved three ways, each red, each
naming its own rail.

⚠️ And the rails read the label from the **log**, not from `breadth_timing.get()`: the
record is per-request and the middleware clears it, so reading the contextvar from a
test's own context returns `None` and every assertion fails for a reason that has nothing
to do with the label. The first version did exactly that.

## `reconstructed_fetch` — the static facts, before any instrument

| | |
|---|---|
| rows / payload | **4,700** rows, 4,678,369 B of `metrics`, avg **995 B/row** |
| file | **41,861,120 B** on the Railway volume, page_size 4096 |
| query | `WHERE date IN (?...)` **chunked at 400** — 12 statements per deep read |
| plan | one PK seek per date — **4,700 seeks** per deep read |
| connection | **opened per call**; `PRAGMA journal_mode=WAL` + `busy_timeout=3000` **every time** |
| ⛔ `cache_size` | **2 MB** against a 41.9 MB file |
| ⛔ `mmap_size` | **0** — every page is a syscall |

## The split, and what it already shows

`rf_open` / `rf_pragma` / `rf_execute` / `rf_fetch` / `rf_materialise`, plus `rf_rows`,
`rf_bytes`, `rf_busy_retries` and a per-request `/proc/self/io` delta.

⭐ **`read_bytes` is the discriminator the whole diagnosis turns on**, and it is confirmed
readable in production: bytes that came from the block device, against `rchar` which
includes the page cache. `read_bytes` climbing = H1; flat with `rchar` climbing = served
from cache and the time went elsewhere; both flat = it was not reading at all.

| reading | `rf_open` | `rf_pragma` | `rf_execute` | `rf_fetch` | **`rf_materialise`** | total |
|---|---|---|---|---|---|---|
| LOCAL, warm | 0.58 | 0.62 | 3.6 | 19.4 | **234.2** | 260.0 |
| PRODUCTION, 1 smoke | 0.1 | 0.2 | 1.7 | 7.5 | **44.7** | 54.8 |

⭐ **`rf_materialise` is 75–90 % of the fetch on every reading taken so far** — 4,529
`json.loads` over 4.5 MB. That is **H4**, not I/O.

## H2 is effectively excluded

A local concurrent writer committing **460,569 times** during the read window moved
`reconstructed_fetch` by **1.9x** (44.1 → 85.3 ms). Page-cache pressure managed **1.5x**.
Production's swing is **50.2x**. ⛔ In WAL mode a writer does not block this reader, and
neither local mechanism comes near reproducing the band.

⚠️ **Two control limits, stated rather than papered over.** A "cold" copy cannot be made
on Windows — there is no `drop_caches` and `shutil.copy2` **writes** the file straight
into the page cache, so that control is **INCONCLUSIVE here, not FAIL**; a FAIL would
blame the instrument for the platform. And a held write lock **is** observable (a
standalone probe blocked a read for **5,051 ms**), but in the route path `_ensure_init()`
runs DDL before the instrumented region and absorbs the block first, so the split cannot
attribute it.

# Conventions this programme now runs on

⛔ **Settled := `/api/health` `uptime_seconds` >= 600.** Never `/proc/uptime`, which is
the CONTAINER's clock and keeps counting across an application restart — it reports a pod
as settled while the process that serves the route has just booted.

⛔ **Logs are streamed live to a file for any measurement window.** The `railway logs`
buffer is ~500 lines ≈ 10 minutes; a window longer than that loses its own evidence.
Capture during the window, not after it.

⛔ **One measurement per process. Bytes measured, not inferred.**

⛔ **No local number is ever quoted as a production improvement.**

⛔ **One production sample is not a measurement** — >= 3 settled-pod, uptime-tagged
samples, and >= 20 if a p95 is to be quoted.

⛔ **An empty result is a failed invocation until proven otherwise.** Every rail that
shells out carries a non-vacuity control, and the control's own mutation proof is run
before the rail is called done.

⛔ **Any instrument that could report work as free is declared as such BEFORE its number
is shown.**

## Appendix — the four false instruments, and the control that caught each

⭐ **Kept as a list because the failures rhyme: every one of them priced real work at
zero or at a number nobody had measured, and in every case the code was green.**

| # | instrument | what it reported | what caught it |
|---|---|---|---|
| 1 | RSS via `ctypes.windll.psapi.GetProcessMemoryInfo` | **0.0 MB** for a 114-second read | the call had no `argtypes`, so the 64-bit HANDLE was truncated. Fixed by setting `restype`/`argtypes` and **raising instead of returning 0** — which is why `rss_mb()` now returns `None`, reported as `unreadable` |
| 2 | the `[breadth-timing]` probe, v1 | **`reader_ms=0.0`** for a reader that had just run | production. The unit rails used an **async** stand-in and were structurally blind: anyio copies the context into the threadpool worker, so the worker's `ContextVar.set()` never reached the middleware. Now proved end-to-end, with a control asserting the stand-in really crosses threads |
| 3 | the blob-memory probe | **616 MB / 1.36 M objects** | reading what the reader actually does — `fetchall()` then parse **one at a time**. Real transient: 117.1 MB. Kept, labelled, as the counterfactual |
| 4 | the phase formatter, v1 | **`cache_set=0.0`** and **`anchor=0.0`** for phases really costing 11–17 us and 1–4 us | the owner's control (a), *"every phase reports > 0"*. `.1f` rounded real work to the one string the instrument promises never to emit. `.3f` alone just moved the zero down two decimals; below its own resolution it now prints `<0.001` |
| 4b | the phase reporter, `gzip_send` | **`gzip_send=absent`** for a stage that had run | measuring the instrument itself. Both the header and the main log line are emitted at `http.response.start`; `gzip_send` is only knowable after it. It now has its own line with its own wall total |
| 4c | the W1 harness log capture | **an empty `LOGS` list**, i.e. `gzip_send: absent` again — while the values were visible on stderr in the same run | `record.getMessage() % record.args` double-applies the args and raises; the exception was swallowed. A non-vacuity assertion on the capture now fails the run instead |

⚠️ **Two of these six were in instruments written to catch the others.** That is the
argument for the standing rule: an instrument that could report work as free is declared
as such before its number is shown.

### Appendix addendum — Session 6's own instrument defects, and Session 7's

| # | instrument | what it reported | what caught it |
|---|---|---|---|
| 5 | `gzip_send` in `POST_PHASES` | **`gzip_send=absent`** for a stage that had run | Both the header and the main log line are emitted at `http.response.start`; the phase is only knowable after it, so it was computed and reported **nowhere**. It has its own line now. |
| 6 | `_phase_str` at `.1f` | **`cache_set=0.0`**, **`anchor=0.0`** for 11-17 µs and 1-4 µs of real work | The owner's control (a), *"every phase reports > 0"*. ⚠️ `.3f` alone only moved the zero down two decimals; below its own resolution it now prints `<0.001`. |
| 7 | `merge_rows`'s hand-rolled `__enter__`/`__exit__` | would report **`absent`** if the merge raised | Reading the code — `__exit__` is skipped on an exception, so the instrument went quiet exactly when something went wrong. ⚠️ **It was FIXED in Session 6 with no rail**; Session 7's A.3 found the gap and added an AST detector (a text search would match the fix's own comment). |
| 8 | the W1 harness log capture | an **empty** `LOGS` list, i.e. `gzip_send: absent` — while the values were on stderr in the same run | `record.getMessage() % record.args` double-applies the args and raises; the exception was swallowed. A non-vacuity assertion now fails the run. |
| 9 | **control (c)'s own threshold** | **FAIL on a 13x improvement** | The rule required `post_reader_ms > 50`, calibrated against a 586 ms warm path. The pre-serialised response took warm to 37 ms and the control punished the improvement it existed to measure. ⭐ **A magnitude was never what (c) tested** — it now tests the structure (reader phases ABSENT, at least one post phase present and non-zero) and still passes on the golden. |

⭐ **Three of these nine were inside instruments written to catch the others, and #9 was a
rail that failed the code for getting faster.** A threshold encodes the cost of the day it
was written; an intent does not.

### Appendix addendum — Session 7 and 8

| # | instrument | what it reported | what caught it |
|---|---|---|---|
| 10 | the `cache` label | **`miss` on a request served warm**, for every `days=90` request, indefinitely | Tracing which tier actually answered instead of reading the label. `get_history` noted nothing, so the deep reader's earlier `miss` stood. ⭐ The lesson is the standing rule it produced: **a harness never asserts a label; it measures what served the request and compares.** |
| 11 | control (c)'s threshold | **FAIL on a 13x improvement** | It required `post_reader_ms > 50`, calibrated against a 586 ms warm path the change removed. ⭐ **A control threshold is re-derived whenever the path it was calibrated against changes**; a control that passes — or fails — because the thing it measured no longer exists is a false instrument. |
| 12 | the `merge_rows` detector (near-miss) | would have **failed the correct code** | A text search for `__enter__`/`__exit__` matches the fix's OWN comment, which exists to explain why they are not used. Caught before shipping by writing it as an AST walk — an AST cannot see a comment. This is the seventh time this repo has met that shape. |
| 13 | the C.2 "cold cache" control | **FAIL**, apparently blaming the instrument | It cannot create its own condition on Windows: no `drop_caches`, and copying a file **writes** it into the page cache. Re-labelled **INCONCLUSIVE**. ⭐ A control that cannot establish its precondition reports INCONCLUSIVE, never FAIL — otherwise the platform's limits are recorded as the product's. |
| 14 | the C.2 lock control, v1 | **FAIL** — "a held write lock is invisible" | `BEGIN EXCLUSIVE` does not block a WAL reader (that is what WAL is for), and `CREATE TABLE IF NOT EXISTS` on an existing table is a no-op that takes no lock at all. With `locking_mode=EXCLUSIVE` and a real `UPDATE`, a read blocked for **5,051 ms**. The instrument was never blind; the control held nothing. |

⭐ **Five of the fourteen recorded false instruments were inside instruments written to
catch the others, and three of them failed by reporting the measurer's limits as the
subject's.** That is the argument for INCONCLUSIVE being a first-class verdict.

### Appendix addendum — Session 9

Nine more, and the last one is the most expensive kind: an instrument defect **inside the
write-up of another instrument defect**.

| # | instrument | what it reported | what caught it |
|---|---|---|---|
| 15 | `/proc/self/io` deltas (`read_bytes`, `rchar`, `syscr`) | `io_rchar` ranks request time at **Spearman +0.960**, "so D-048's two-phenomena reading is superseded" | **Dividing by a physical constant.** Block-device bytes over each sample's own `rf_fetch` implies **3,942 / 2,432 / 2,393 / 2,255 MB/s** on four Session 8 samples. No volume delivers 3.9 GB/s, so those bytes were another thread's — the counter is **process-wide, not request-scoped**. ⭐ Window A's 0.960 was luck: its quiet samples read *exactly* 0.00 MB, so the counter was nearly clean in that window and filthy in Session 8's. The claim was withdrawn **before it was used**. |
| 16 | the V1 flip watcher | "no boot in ~200 s → this is the STAGED case" | `railway variables --set` **did** auto-redeploy `web` — after **~4–5 minutes**. ⚠️ CLAUDE.md's procedure ("only if no boot appears within ~3 minutes, redeploy") would *also* have fired early and stacked a redeploy on top of an auto-redeploy. The dichotomy "staged vs auto-redeploy" is partly an artifact of how long the observer waited. |
| 17 | the Railway wrapper's non-vacuity guard | `--set` **"returned NOTHING — treat as failed"** | It had **already succeeded**; a successful `--set` prints not one byte. ⭐ *"An empty result is a failed invocation"* is a rule about **reads**. Applied to a **write** it reports failure while production has already changed — the guard failing in the safe-looking direction. |
| 18 | the same wrapper, one run earlier | `railway redeploy` → *"No linked project found"*, **and the run carried on** to report the staged case | The CLI resolves its project from the **cwd**, and it was invoked from the scratchpad. ⭐ *"An empty result is a failed invocation"* is **necessary and not sufficient** — an **error message is also non-empty output**. Check the return code, and pin the directory. |
| 19 | window A, 25 samples, no complaint | a clean window | A foreign deploy (`587ee51b2`) landed **mid-window**; 12 of 25 samples were taken on a pod at uptime 95–411 s, racing its own boot prewarmers. Only the **per-sample `uptime`** caught it. The analyser now drops anything under the settle floor **and counts what it dropped** — an intrusion should cost samples, not silently average a booting pod into the result. |
| 20 | window B, first launch | started sampling immediately, at uptime **71** | The settle wait lived in window A's **wrapper command**, not in `s9_window.py`; the relaunch faithfully reproduced the script and not the wrapper. ⚠️ **A precondition enforced outside the artifact is a precondition that does not travel with it.** Killed after 2 samples and restarted. |
| 21 | the background-task status | **exit code 0** | A `FileNotFoundError` traceback — `logs/` did not exist in the scratchpad. **Third sighting in this repo** of the wrapper's exit status being uninformative, and the second where it was cheerfully zero over a run that did nothing. |
| 22 | the A/B analyser | died mid-report with `UnicodeEncodeError` | Windows consoles decode with cp1252 and one `⛔` in an output line kills the process — the same defect that made `tools/flag_ledger_audit.py` report *"could not enumerate the project's services"*. Fixed at the **stream** (`sys.stdout.reconfigure`), never by deleting the character: stripping the marks hides the finding. |
| 23 | ⭐⭐ **§E.4 of this session's own report** | *"Confirmed again by an unplanned natural experiment — push 05:30:52 + a ~104 s gate → pod booted 05:32:36. Same relationship, independently."* | **The ~104 s was never measured.** It was the *median* gate duration substituted for the real one. Measured, that gate took **121 s**, moving the predicted cutover to 05:32:56 and turning the "confirmation" into an **18-second contradiction**. The conclusion it propped up — that Railway holds the cutover until CI passes — is now an OPEN QUESTION with nine observations against it and one for. |

⭐⭐ **#23 is the one to carry forward.** The other twenty-two were defects in code that
measured something. This was a defect in **prose that reasoned about measurements**: a
plausible number, never taken, inserted into a chain of argument that had already reached
its conclusion — and it read as corroboration precisely because it agreed. **A substituted
median is indistinguishable from a measurement once it is written down**, which is why the
rule has to be that every number in an argument carries its provenance, not just every
number in a table.

⚠️ And it survived a review that caught #15 in the same document, an hour apart. **Finding
one instrument defect does not put you in a state where you are finding them.**
