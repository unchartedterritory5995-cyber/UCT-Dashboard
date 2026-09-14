# UCT Breadth History Reader — Session 6 report

Date: 2026-09-14. Worktree `C:\Users\Patrick\uct-worktrees\breadth-history-reader`.

**Nothing in this session merged to master. Nothing was pushed to master. No Railway
setting was changed, Wait-for-CI was not toggled, and the `production` branch was not
created.** Two feature branches were pushed; a branch push triggers no deploy and this was
verified against the Railway deployment list after the push, not assumed.

⛔ **Reading rule used throughout:** results and interpretation are separated. A number
without its instrument, its `n` and its settled-status is not quoted as a result.

---

# 1. Carry-forward corrections, and QUESTION 1.a

## 1.a — what is on `docs/session4-findings` that is not on master?

**Answer: nothing. There is no unmerged Session 4 doc work, and no gate is owed.**

| check | result |
|---|---|
| `git log --oneline 1216958ed..e89ac81d1` | **empty** |
| `git merge-base --is-ancestor e89ac81d1 origin/master` | **yes — merged** |
| what `e89ac81d1` is | a `merge master` commit on `docs/session4-findings`, 2026-09-14 16:30:02 −0500 |

The prompt's premise was true when written and is no longer: the branch tip has since
become an ancestor of master. The Session 4 docs went in through the normal gate.

## Carry-forward corrections

| the prompt says | measured now |
|---|---|
| `origin/master 7707b2241, unmoved` | ⚠️ **moved.** `origin/master` is **`1216958ed`**, "Merge origin/master before pushing OI-37 + queue sizing" |
| production deploys `7707b2241` at 21:30:11Z | ⚠️ production deploys **`1216958ed`**, created **22:09:17Z**, SUCCESS. `7707b2241` is REMOVED |
| `breadth_reconstructed_daily` 4,701 rows | the local `VACUUM INTO` copy this session profiled reads **4,700**; Session 4's refreshed copy read 4,701. One row is one trading session between two copies |
| branch `docs/session4-findings`, HEAD `e89ac81d1` | this session worked on **`breadth/phase-instrument`** and **`docs/session6-record`**, both off `origin/master` |

⚰️ **`1216958ed` landed 15 seconds after the Workstream 2 window was first opened**, from
another workstream. The pod restarted (uptime 2,225 → 52) and the four samples collected
were discarded. **They are not in this report.** The window was re-opened only after
uptime passed 600 s again.

⭐ **Before sampling against a different commit I checked it was the same reader**, rather
than assuming a docs-and-load-harness merge could not have touched it:

| file | `7707b2241` vs `1216958ed` |
|---|---|
| `api/services/breadth_monitor.py` | **IDENTICAL** |
| `api/services/breadth_daily_ohlc.py` | **IDENTICAL** |
| `api/services/breadth_timing.py` | **IDENTICAL** |
| `api/routers/breadth_monitor.py` | **IDENTICAL** |
| `api/services/breadth_numeric_migration.py` | **IDENTICAL** |

⛔ **Non-vacuity control:** `git diff --name-only 7707b2241 1216958ed` lists **26** changed
files, so the comparison can detect a difference; it found none on the reader path. The
n=20 window is therefore comparable to Session 5's n=6.

---

# 2. Workstream 2 — the n=20 settled-window sample

## 2.1 Protocol, as run

| | |
|---|---|
| settled | `/api/health` `uptime_seconds` ≥ 600 — **never `/proc/uptime`** |
| deployed commit | `1216958ed`, SUCCESS at 22:09:17Z, reader path byte-identical to `7707b2241` |
| cache | forced miss — a **distinct `days=` value per sample**, so no two samples share a cache key |
| cadence | one sample every ~35 s |
| sets | (i) n=20 deep, `days` 7,900→7,881 · (ii) n=5 shallow, `days` 95→91 |
| logs | `railway logs` streamed to `logs/session6-sample.log` **every 5 samples**, not once at the end — the buffer is ~500 lines ≈ 10 minutes and a window longer than that loses its own evidence |
| window | opened 22:23:04Z, closed 22:38:25Z |
| uptime | 708 → 1,629 s, **monotonic** |

## 2.2 Results

**RESULTS.** n=20 deep + n=5 shallow, all `status=200`, no failed invocation, all settled.

| # | time UTC | uptime | days | reader_ms | post_ms | total_ms | client wall | status | bytes |
|---|---|---|---|---|---|---|---|---|---|
| 1 | 22:23:04 | 708 | 7900 | **192.8** | 539.0 | 731.8 | 1002 | 200 | 681,975 |
| 2 | 22:23:40 | 745 | 7899 | **156.7** | 420.4 | 577.1 | 924 | 200 | 681,973 |
| 3 | 22:24:16 | 781 | 7898 | **147.2** | 379.7 | 526.9 | 815 | 200 | 681,973 |
| 4 | 22:24:52 | 817 | 7897 | **150.6** | 394.1 | 544.7 | 796 | 200 | 681,973 |
| 5 | 22:25:28 | 853 | 7896 | **231.8** | 397.8 | 629.6 | 893 | 200 | 681,974 |
| 6 | 22:26:06 | 891 | 7895 | **205.0** | 502.4 | 707.4 | 954 | 200 | 681,974 |
| 7 | 22:26:43 | 927 | 7894 | **591.0** | 413.3 | 1004.3 | 1417 | 200 | 681,974 |
| 8 | 22:27:20 | 964 | 7893 | **998.7** | 426.8 | 1425.5 | 1898 | 200 | 681,973 |
| 9 | 22:27:57 | 1001 | 7892 | **1000.4** | 496.1 | 1496.4 | 1742 | 200 | 681,973 |
| 10 | 22:28:33 | 1038 | 7891 | **275.6** | 573.0 | 848.5 | 1305 | 200 | 681,973 |
| 11 | 22:29:12 | 1076 | 7890 | **265.1** | 475.9 | 741.0 | 982 | 200 | 681,974 |
| 12 | 22:29:48 | 1112 | 7889 | **144.2** | 541.1 | 685.3 | 1011 | 200 | 681,974 |
| 13 | 22:30:24 | 1149 | 7888 | **319.2** | 411.7 | 730.9 | 979 | 200 | 681,974 |
| 14 | 22:31:01 | 1185 | 7887 | **254.9** | 427.9 | 682.7 | 945 | 200 | 681,973 |
| 15 | 22:31:37 | 1221 | 7886 | **173.1** | 438.1 | 611.2 | 946 | 200 | 681,973 |
| 16 | 22:32:14 | 1259 | 7885 | **180.4** | 378.8 | 559.2 | 873 | 200 | 681,973 |
| 17 | 22:32:50 | 1295 | 7884 | **187.5** | 546.4 | 733.9 | 1253 | 200 | 681,973 |
| 18 | 22:33:27 | 1331 | 7883 | **460.1** | 742.1 | 1202.2 | 1540 | 200 | 681,973 |
| 19 | 22:34:03 | 1368 | 7882 | **184.8** | 484.6 | 669.4 | 997 | 200 | 681,973 |
| 20 | 22:34:40 | 1404 | 7881 | **214.3** | 377.6 | 591.8 | 830 | 200 | 681,973 |
| 21 *(shallow)* | 22:35:17 | 1442 | 95 | **91.0** | 24.0 | 114.9 | 259 | 200 | 24,076 |
| 22 *(shallow)* | 22:35:53 | 1477 | 94 | **434.6** | 58.2 | 492.8 | 675 | 200 | 23,829 |
| 23 *(shallow)* | 22:36:28 | 1513 | 93 | **90.9** | 27.2 | 118.1 | 279 | 200 | 23,604 |
| 24 *(shallow)* | 22:37:04 | 1548 | 92 | **101.6** | 25.4 | 127.0 | 301 | 200 | 23,349 |
| 25 *(shallow)* | 22:37:39 | 1584 | 91 | **131.3** | 28.0 | 159.3 | 316 | 200 | 23,114 |

### Non-vacuity controls on the window itself

| control | result |
|---|---|
| distinct cache keys | 20 distinct `days=` for 20 deep samples, 5 for 5 shallow — no sample could have hit another's cache entry |
| payload really returned | `decoded_bytes` 681,973–681,975 on every deep sample (a 2-byte spread is the rolling adv/dec figure) |
| no restart mid-window | uptime rose monotonically 708 → 1,629 s |
| no deploy inside the window | Railway's newest deployment is `1216958ed` at 22:09:17Z, **14 minutes before** the window opened |
| logs really captured | 128 `[breadth-timing]` lines across **8** capture blocks in `logs/session6-sample.log` |

## 2.3 Statistics

| deep, n=20 | min | p50 | p90 | **p95** | max | mean | sd |
|---|---|---|---|---|---|---|---|
| client wall | 796.2 | **980.8** | 1,560.2 | **1,749.7** | 1,897.7 | 1,105.0 | 316.7 |
| server `total_ms` | 526.9 | 696.3 | 1,224.5 | 1,429.0 | 1,496.4 | 785.0 | 281.2 |
| `reader_ms` | 144.2 | 209.7 | 631.8 | 998.8 | 1,000.4 | 316.7 | **258.2** |
| `post_reader_ms` | 377.6 | **433.0** | 549.1 | 581.5 | 742.1 | 468.3 | **89.4** |

| shallow, n=5 | min | p50 | p95 | max | mean | sd |
|---|---|---|---|---|---|---|
| client wall | 258.8 | 301.4 | 603.3 | 675.2 | 366.1 | 174.2 |
| `reader_ms` | 90.9 | 101.6 | 373.9 | 434.6 | 169.9 | 148.9 |
| `post_reader_ms` | 24.0 | 27.2 | 52.2 | 58.2 | 32.6 | 14.4 |

### p95 estimability — the question the sample existed to answer

**RESULT: p95 is estimable at n=20.** The exact binomial order-statistic interval places
the true 95th percentile between order statistics **18 and 20**:

> **95 % CI for the true p95 of client wall: [1,540.0 ms, 1,897.7 ms]**, empirical
> p95 **1,749.7 ms**.

⭐ **Bounded by real observations on both sides.** At n=6 the empirical p95 *was* the
maximum by construction, so quoting it was quoting the max with a statistic's name on it.
That is no longer the case.

## 2.4 Interpretation

⭐ **Post-reader is the steady half; the reader is the volatile one.** `post_reader_ms` has
sd 89.4 against `reader_ms`'s 258.2, and post exceeds reader in **17 of 20** (median ratio
2.09). Session 5 saw 6 of 6 and could not tell whether that was a small-sample artifact;
at n=20 it is the shape of the thing.

⭐ **Reader volatility is contention, not work.** Samples 8 and 9 (uptime 964 and 1,001 s)
put `reader_ms` at 998.7 and 1,000.4 while the payload was byte-identical to samples 3 and
4 at 147.2 and 150.6. Identical code, identical bytes, 6.8×. That is the Session 2
conclusion reproduced inside a settled window — the pod is shared with schedulers and other
members, and "settled" bounds the post-boot storm, not all contention.

⚠️ **Against D-042's 54,923 ms cold: 56× at the median, 31× at p95.** ⛔ I am reporting
this as a band comparison, not a ratio with a confidence attached: D-042 is **n=1** and was
taken on a different pod state. The honest statement is that **the two bands do not
overlap** — D-042's single cold deep read was 54,923 ms; the n=20 settled band is
796–1,898 ms.

## 2.5 Verdict and cap recommendation

**VERDICT: the deep read meets a ~2 s bar at p95 on a settled pod, and does not meet a ~1 s
bar at p95.** p50 is 980.8 ms; p95 is 1,749.7 ms with an upper confidence bound of
1,897.7 ms.

**CAP RECOMMENDATION: leave `BREADTH_SERIES_MAX_SESSIONS` at 365. No change, and no push.**

Three reasons, in order of weight:

1. ⭐ **A lift exposes nothing anyone can request.** The UI's largest `days=` is **365**
   (`Breadth.jsx:657` sends `MONITOR_WINDOW = 90` or `VIEWS_DAY_CHOICES = [90,180,365]`;
   `useMonitorGrid.js:98` sends `days=${stored.length}` where `stored` is a slice of
   `BLOCK = 150`). Raising the cap to 1,000 changes what **no member** can ask for.
2. **It would cost a deploy for zero member-visible difference**, and a master push is the
   scarce, serialising resource in this repo — the thing Workstream 4 exists to protect.
3. **The number that would justify a lift is not the one that improved.** `/series` is
   capped because a deep span is expensive; the deep span is now cheap in the *reader* and
   the remaining cost has moved to `encode_render`, which a larger cap makes **worse**
   linearly in rows. Lifting the cap before the encoder is addressed raises the ceiling on
   the half that did not get fixed.

⚠️ **What would change this:** a member-facing feature that actually requests > 365
sessions. Until one exists, the cap is not a constraint anyone is hitting.

---

# 3. Workstream 1 — the per-phase instrument

## 3.0 QUESTION 2.a — is there a way to force a known-expensive read?

**Answer: yes, and it needs no flag shipped to a paid route.**

Copy the production databases locally and `DELETE FROM breadth_snapshot_numeric` and
`DELETE FROM breadth_reconstructed_daily`. The reader's counted fallback takes the legacy
blob path, and the result is a read I know is expensive because I made it expensive by
**removing data**, not by adding a switch.

| mode | rows returned | `reader_ms` | dominant phase |
|---|---|---|---|
| `expensive` (materialised tables emptied) | **174** | **3,778.8** | `numeric_fetch` 3,563.1 |
| `normal` | 4,703 | 248.2 | `reconstructed_fetch` 99.0 |

⭐ **27× fewer rows, 15× slower reader.** That is the blob path: 636,834 bytes per row of
which 99.7 % is `*_list` arrays parsed and discarded.

⛔ **I did not propose an env flag on the live route, and would not.** A flag that makes a
paid endpoint slow on purpose is a foot-gun that ships; deleting rows from a local copy is
reversible, invisible to members, and strictly more faithful — it exercises the *real*
fallback rather than a branch added to simulate it.

## 3.1 The phases, enumerated with evidence

**Reader side — nine phases**, every one wrapped in `api/services/breadth_monitor.py`
inside `_history_deep_uncached`. All run **in the anyio threadpool** (the route is a plain
`def`).

| phase | what it is | evidence it is on the path |
|---|---|---|
| `merged_dates` | the deep window's date set | `distinct_dates()` off the materialised table, `distinct_dates_by_scan()` as fallback |
| `collector_floor` | the oldest collector date | `_collector_floor()` |
| `anchor` | window anchoring when `end=` is given | inert at the latest window — measured at 0.003 ms, **not** absent |
| `numeric_fetch` | `breadth_snapshot_numeric` projection + counted blob fallback | `_metrics_for_dates(c, dates)` |
| `reconstructed_fetch` | `breadth_reconstructed_daily` | `ohlc.reconstructed_for_dates()` |
| `merge_rows` | collector-beats-reconstructed precedence + row dicts | the merge loop |
| `adv_seed` | advance/decline seed before the window | `_adv_decline_seed_before()` |
| `derive` | rolling derivations incl. the 15-session warm-up | `_derive_ascending()` |
| `cache_set` | writing the result to the TTL cache | measured at 0.017 ms |

**Post-reader side — three phases.**

| phase | what it is | where it runs |
|---|---|---|
| `route_tail` | `date_bounds()` + `next_trading_day()` | **threadpool** — ⭐ these run *after* `reader_ms` stops and *before* the response exists, so they were hiding inside post-reader with no name |
| `encode_render` | route-return → `http.response.start`: `jsonable_encoder`, `JSONResponse.render`, **and GZip compression** | **event loop** |
| `gzip_send` | `http.response.start` → last body chunk: the ASGI transport of already-compressed bytes | **event loop** |

⚠️ **`encode_render` is a BUNDLE and is named as one.** Starlette's `GZipResponder` holds
`http.response.start` until it has compressed the body, so on an outermost middleware the
compression lands *inside* `encode_render`, not in `gzip_send`. Production cannot split it
without patching starlette on a paid route; §3.5 splits it locally instead.

## 3.2 How the phase notes cross the threadpool, and the proof

The route is a plain `def`; anyio **copies** the context into the worker, so a
`ContextVar.set()` there is invisible to middleware on the event loop. **A copied context
still holds a reference to the same dict**, so `phase()` mutates the record **in place** and
never rebinds. The middleware opens the record on the event loop; the worker writes phases
into that same object.

**PROOF — end-to-end, against the real route, not an async stand-in:**

`tests/test_breadth_timing.py::test_phases_recorded_in_the_threadpool_reach_the_header_on_the_event_loop`
records `threading.get_ident()` in the route body and in a middleware on the event loop,
**asserts they differ**, and only then asserts the phases appear in the `Server-Timing`
header the middleware wrote.

⛔ **The thread-identity assertion is the non-vacuity control.** If the stand-in route
happened to run on the event loop there would be no boundary to cross and the test would
prove nothing — which is precisely how the original rails passed while production reported
`reader_ms=0.0`.

**Mutation-proved.** Changing `phase()` to rebind the contextvar instead of mutating in
place turns that test red and names it: `1 failed, 10 passed`.

## 3.3 The three controls

All run against the real route via `TestClient` with the real middleware stack, against
`VACUUM INTO` copies of the production databases, in both modes.

| control | requirement | `normal` | `expensive` |
|---|---|---|---|
| **(a)** | every phase > 0 on a deep `cache=miss`; none absent | **PASS** — 0 absent, 0 reported as zero | **PASS** |
| **(b)** | phase sums within 10 % of `reader_ms` and of `post_reader_ms`; residual reported and explained | **PASS** — reader 97.0 % (residual **7.5 ms**), post 99.5 % (residual **3.0 ms**) | **PASS** — reader 99.9 % (residual 2.9 ms), post 98.5 % (residual 1.8 ms) |
| **(c)** | on `cache=hit` the reader phases are cheap and post-reader is still non-trivial | **PASS** — `reader_ms` 0.0 with all nine reader phases **absent**, `post_reader_ms` **586.8** | **PASS** — 0.0 / 72.4 |

### The residuals, explained rather than waved at

- **Reader residual 7.5 ms (3.0 %)** — the un-phased work between phases: the single-flight
  entry, the cache key construction, the `_conn()` open and its `PRAGMA` calls, and the
  window slice. Each is sub-millisecond; none is worth its own phase, and naming them
  individually would make the line longer without making it truer.
- **Post residual 3.0 ms (0.5 %)** — the ASGI plumbing between the route returning and the
  middleware's `_send` running, plus the header assembly.

⛔ **Control (b) is computed against the WALL total, not against `post_reader_ms`.**
`post_reader_ms` is derived from `total_ms`, which is taken at `http.response.start` and
therefore **prices the send at nothing**; reconciling `gzip_send` against it made the
residual go *negative* — the parts summing to more than the whole. The harness now
accounts against `total_with_send_ms`.

⭐ **Control (c) is the discriminating one, and the discrimination is in the word
"absent".** On a cache hit the nine reader phases do not report `0.0`; they report
**absent**, because they did not run. `encode_render` reports **582.8 ms** on that same
request. That is the finding: **the post-reader cost exists regardless of cache state.**

## 3.4 Parity — EXACT

**RESULT: byte-identical.**

| | |
|---|---|
| sha256 (both sides) | `7695923c7e80d3abe7ca9a8692af3f6adf9295a8369ad033520d65f49b57cc6d` |
| bytes compared | **5,576,278** across spans 90 / 365 / 8000 |
| payload | 4,703 rows × 80 keys |
| golden | a real `git worktree` at `origin/master` |
| side detection | the harness derives its own side from source (`'phase("route_tail")' in src`) and the two runs reported `golden` and `instrumented` |

⛔ **The golden is a worktree, not a module swap.** `parity.py`'s technique loads one
module from git under its canonical name; this change touches the **router**, which imports
the service by package name — both would have resolved through the working tree and the
comparison would have been one tree against itself.

⛔ **And it compares the RESPONSE BODY, not the reader's rows.** `route_tail` wraps work
that runs *after* the reader returns, so a rows-only comparison would be blind to exactly
the half that moved.

**Non-vacuity controls:** flipping one byte at offset 2,788,139 → differs. Truncating one
byte → differs. Asserted `rows > 4000`, `keys > 20`, `bytes > 1,000,000` before comparing —
two empty bodies are byte-identical.

## 3.5 The local both-side profile, and the dominant post-reader phase

**RESULT.** Local, `TestClient` on the real app, production database copies, 8,000-day span.
⛔ **LOCAL. Not quoted as a production number.**

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
| **`reader_ms`** | **248.2** | **0.0** |
| `route_tail` | 34.1 | 0.02 |
| `encode_render` | **525.5** | **582.8** |
| `gzip_send` | 0.731 | 0.883 |
| **`post_reader_ms`** | **563.3** | **586.8** |

### The dominant post-reader phase is `encode_render` — and it is named further

**`encode_render` is 93 % of post-reader on a cold read and 99 % on a warm one.** Split
locally on the same payload, since production cannot:

| | ms | bytes out |
|---|---|---|
| `jsonable_encoder` | **481.1** | — |
| `json.dumps` | 116.1 | 4,958,869 |
| gzip level 9 | 158.0 | 577,540 |
| gzip level 1 | 16.1 | 1,287,641 |

⭐ **The encoder is named: `fastapi.encoders.jsonable_encoder`, ~64 % of the bundle.**
Under the Session 2 §4 ruling — *"pre-serialised Response only if the encoder is named"* —
that condition is now met. I have **not** implemented it; it is proposed in §7.

### GZip does not dominate, and the `*_list` branch is moot twice over

The prompt's §2.5 said: *"if GZip dominates, also measure wire_bytes without `*_list` keys
and trace every key consumed by `Breadth.jsx` / `useMonitorGrid.js`."* **That branch does
not fire, for two independent reasons, and I checked both rather than only the first:**

1. **GZip is not dominant.** Compression is 158.0 ms of a ~525–590 ms bundle; transport
   (`gzip_send`) is 0.7–0.9 ms.
2. **There are no `*_list` keys on the wire at all.** Measured on the captured response
   body: 80 keys, and **none** ends in `_list` — D-045's numeric projection removed them
   already. No UI trace is needed because there is nothing to trace.

⭐ **What the encoder is actually paying for is CELLS, not BYTES.** 4,703 rows × 80 keys =
**376,240 scalar values**, ≈ 1.28 µs each. No single key exceeds **4.5 %** of the payload
(`date` 4.5 %, `adv_decline_cum` 3.0 %, `market_phase` 2.1 %); 2.9 % of cells are null.
**That is why compressing harder does not help and why pre-serialising would**: the cost is
per-value Python work, not byte volume.

## 3.6 Three defects found in the instrument itself

⛔ **Declared before the numbers above were quoted, per the standing rule.**

| # | defect | how it read | what caught it |
|---|---|---|---|
| 1 | `gzip_send` was in `POST_PHASES` | **`gzip_send=absent`** for a stage that had run | Both the header and the main log line are emitted at `http.response.start`; `gzip_send` is only knowable *after* it. It was computed and reported **nowhere**. It now has its own log line with its own wall total. |
| 2 | `_phase_str` used `.1f` | **`cache_set=0.0`**, **`anchor=0.0`** for phases really costing 11–17 µs and 1–4 µs | The owner's control (a), *"every phase reports > 0"*. ⚠️ `.3f` alone just moved the zero down two decimals (0.0004 → `0.000`); below its own resolution it now prints **`<0.001`**, a third fact distinct from both `absent` and a measured value. The `Server-Timing` header keeps a bare number (`.6f`) because a parser reading `dur=<0.001` gets nothing. |
| 3 | `merge_rows` used a hand-rolled `__enter__`/`__exit__` pair | would report **`merge_rows=absent`** if the merge raised | reading the code. `__exit__` is skipped on an exception — the instrument going quiet exactly when something went wrong. It is a `with` block now; `phase()` records in a `finally`. |

⚰️ **And a fourth, in the harness rather than the product:** the log capture used
`record.getMessage() % record.args`, which double-applies the args and raises. The
exception was swallowed and `LOGS` came back empty — reported as `gzip_send: absent` **while
the values were visible on stderr in the same run**. A non-vacuity assertion on the capture
now fails the run instead of returning an empty list.

⭐ **Two of the six false instruments this programme has now recorded were inside
instruments written to catch the others.**

## 3.7 Allocation and RSS

**RESULT: 1,201 B per request** (tracemalloc, 200 synthetic requests; 12 phases + 2 marks;
`sizeof(phases)` 464 B, `sizeof(marks)` 184 B).

Against a 4.96 MB payload the request already builds, and `rss_after_mb` is reported to
0.1 MB. **1.2 KB cannot move it.**

⚠️ **`rss_mb()` reads `/proc/self/statm` and returns `None` — reported as `unreadable` —
on this box, by construction.** The allocation was therefore measured **directly** rather
than inferred from a gauge that cannot answer here. tracemalloc distorts *timing* (measured
4.9× in Session 2) and is the right tool for *memory*; no timing number is taken from that
run.

## 3.8 Branch and commits

| | |
|---|---|
| branch | **`breadth/phase-instrument`**, off `origin/master` (`1216958ed`), **pushed, not merged** |
| `e4f5ac4c8` | feat(breadth): per-phase timing on BOTH sides of the breadth history read |
| `2ccb70a12` | docs(breadth): flow-worker strand for the per-phase timing commit — INERT |

**Scoped suite: 91 passed** (`test_breadth_timing`, `test_breadth_deep_history`,
`test_breadth_numeric_store`, `test_breadth_reconstructed_store`,
`test_breadth_history_window`, `test_breadth_history_single_flight`,
`test_breadth_history_direct_call`) — run in its own tool call, before the commit.

**Six new rails**, mutation-proved three ways (each goes red and names its own rail):

| mutation | result |
|---|---|
| `phase()` rebinds instead of mutating | **RED** — 1 failed, 10 passed |
| `gzip_send` back in `POST_PHASES` | **RED** — 1 failed, 14 passed |
| `_phase_ms` back to `.1f` | **RED** — 1 failed, 13 passed |

File restored byte-identically afterwards (sha verified), **never via `git checkout`**.

**Flow-worker strand: ADDITIVE, INERT, no redeploy.** The coverage rail goes RED on
`breadth_monitor.py` and `breadth_timing.py`; per the runbook that is a review gate, and
the review is `docs/breadth/flow-worker-strand-phases.md`. Traced with a closure walk:
flow-worker reaches this module by one hop for one symbol — `bars_fetch.py:2467`'s
`get_latest()` — and **every hunk in this commit is inside `_history_deep_uncached`, which
has no call site anywhere in flow-worker's chain**. The timing entry points all return
immediately there because no middleware ever opens a record.

---

# 4. Workstream 3 — the programme record

## 4.2 answer — QUESTION 4.a, the D-042 heading

**The premise is wrong in both halves, and the real finding points the other way.**

1. **D-042 has a heading and the measurement is already in it.**
   `docs/breadth/DECISIONS.md:541` — *"### D-042 · The cost bound is NOT met, `bucket=`
   would not fix it, and the cause is the reader — B1 stays dark"* — and the **54,923 ms**
   figure is at line 549, in a table alongside `days=90` (1,018 ms cold) and the
   `end=`-teleport case (10,498 ms). **No retrospective heading is needed and no second
   record should be created**; a second home for that number is exactly the
   second-authority defect this file keeps paying for.

2. **The heading-LEVEL inconsistency is real and it is not D-042's.** Census:
   **42 entries use `###`** (D-001…D-042); **3 use `##`** (D-043, D-044, D-045). The drift
   is in the three newest entries — two of them written in earlier sessions of this
   programme, and D-045 written today to match its immediate neighbours.

⚠️ **PROPOSED, not done:** normalise D-043, D-044 and D-045 to `###` in one edit, so the
trio is not left in a mixed state. I did not act because it edits two other sessions'
records, and because a mixed state within the trio would be worse than either uniform one.
**One line of approval and it is done.**

⭐ What I *would* additionally propose, and did not do: D-042's heading does not carry the
number that started the programme, so nobody scanning headings finds it. Appending
`— 54,923 ms cold on days=8000` to that heading costs nothing and creates no second
authority, because the table below it stays the source. Also owner's call.

## 4.6 answer — should `--audit` use the ground-truth method?

**No — not as a substitution. The ground-truth method answers a different question, and
swapping it in would make the tool answer the adjacent one under the old name.**

| question | what answers it | can it be CONFIRMED? |
|---|---|---|
| *"was deploy B pushed while deploy A was still BUILDING?"* — what `--audit` reports | `createdAt` proximity of two distinct-commit deployments | ⛔ **No.** Railway's list carries only `status` and `createdAt`. There is no "reached SUCCESS at". |
| *"did this deploy start before its own checks finished?"* — Session 5's method | GitHub check-runs `completed_at` vs Railway `createdAt` | ✅ **Yes**, and that is how Wait-for-CI was disproved |

⛔ **They are not the same property.** A deploy can be perfectly CI-gated and still be
stacked on a building predecessor, and vice versa. `lesson_a_guard_that_tests_the_adjacent_thing`
is the exact shape.

**The self-labelling is already correct and should not change.** Both the docstring and the
printed line say **SUSPECTED, never CONFIRMED**, and say why:

> *"the list carries no 'reached SUCCESS at' time"*

**PROPOSED (not implemented), and deliberately additive:** a separately-named
`--gate-audit` that reports **CONFIRMED-ungated** deploys using checks-finished vs
deploy-created. I did not implement it for three reasons:

1. It needs GitHub API access. The `github` MCP server failed to connect this session
   (*"Authorization header is badly formatted"* — the `${GITHUB_PERSONAL_ACCESS_TOKEN}`
   expansion), and **G-2 is yours**. Writing a tool that cannot run, and cannot have a
   non-vacuity control run against it, is the shape this programme keeps rejecting.
2. **Workstream 4 obsoletes it.** Under the promoted-branch gate, "was this deploy gated"
   is answerable from `production`'s own git log — a fast-forward only happens after the
   gate passes — with **no GitHub API at all**. Building the API-based detector now means
   building it to delete it.
3. It is not under ~50 lines *with a test that can fail*. The test needs a fixture pair
   (one gated deploy, one not) and a non-vacuity control proving the API call returned
   something — an empty check-run list would otherwise read as "nothing ungated".

## 4.3–4.5 — what was written

| file | what |
|---|---|
| `docs/breadth/DECISIONS.md` | **D-045** — the numeric store and materialised reconstructed side: the five commits with their contents, why a JSON column rather than ~70 typed ones, why "numeric" names the purpose not a type filter, precedence, the fingerprint/`VACUUM INTO` migration discipline (including why the first production run reported FAILED and was right to), the measured results in band form, and the n=20 production numbers. D-044's dangling `(D-045 work)` now points at it. |
| `docs/breadth-history-reader/00-profile.md` | **Sessions 2, 3, 5 and 6**, in the existing `# Session N` template; plus a **conventions** section and a **false-instrument appendix**. |
| `docs/breadth/gates.md` | the *"Wait for CI — the two-push verification"* section had an **empty results table waiting for a run**. Replaced with the measured result and a warning against citing it as evidence of serialisation. |

⚠️ **Sessions 2 and 3 are marked RECONSTRUCTED**, in the file, at the top of each section:
their working notes were never written to `00-profile.md`, so every number is quoted from
an artifact that exists (commit messages, D-044, the strand docs) and nothing is
reconstructed from memory.

**Conventions recorded (4.5):** settled := `/api/health uptime_seconds ≥ 600`, never
`/proc/uptime` (it is the container's clock and keeps counting across an application
restart); logs streamed live because the buffer is ~10 minutes; one measurement per
process; bytes measured not inferred; no local number quoted as production; ≥ 20 samples
before a p95; an empty result is a failed invocation; any instrument that could report work
as free is declared as such before its number is shown.

**False-instrument appendix (4.5):** all four, each with the control that caught it — plus
the two found this session (`gzip_send` reported absent; the harness's swallowed
`getMessage() % args`).

## Branch and commits

| | |
|---|---|
| branch | **`docs/session6-record`**, off `origin/master`, **not pushed** |
| `6feca9907` | docs(breadth): D-045, Sessions 2/3/5/6, the conventions and the false-instrument list |

⚠️ **The prompt named `docs/session4-findings` for docs work.** I used a fresh branch
because that one is now fully merged into master (see 1.a) and reusing a merged branch
would have made the diff harder to read, not easier. **Say the word and I will rebase onto
whatever branch you prefer.** It is not pushed yet — tell me if you want it on origin.

---

# 5. Workstream 4 — the promoted-branch deploy gate

Built in an isolated worktree, **design + branch only**. ⛔ No cutover, no `production`
branch on origin, no Railway change, no PR.

## 5.0 Verified in my own session, not taken on the lane's word

| claim | my check | result |
|---|---|---|
| branch pushed | `git rev-parse origin/breadth/deploy-gate-v2` | **`3758cd75e`** |
| 1 ahead, 0 behind master | `git rev-list --left-right --count` | **0 1** |
| `production` does not exist on origin | `git ls-remote --heads origin production` | **empty — absent** |
| no deploy triggered | Railway deployment list | newest is still `1216958ed` at 22:09:17Z |
| the suite passes | `pytest tests/test_promotion_gate.py tests/test_no_shadowed_definitions.py` | **26 passed** |
| the gate's own self-check | `tools/promotion_gate.py --self-check` | **9 cases, 0 failures** |

## 5.1 Design summary

**Mechanism:** master → `promote to production` workflow → **fast-forward only** push of
`production` → Railway watches `production` instead of master.

**Files:** `docs/breadth/deploy-gate-v2.md` · `.github/workflows/promote-production.yml` ·
`tools/promotion_gate.py` · `tests/test_promotion_gate.py` · a `# promotion-gate:` marker
in each of the 7 pre-existing workflows.

### Which checks gate, and which only warn

⭐ **Derived from `.github/workflows/`, never from the GitHub UI** — GitHub lists 9
workflows; the directory holds 8 (7 pre-existing + the new one). The extras are ghosts with
run history and no file.

| check | | why |
|---|---|---|
| master deploy gate | 🔒 **GATE** | secret scan, shadowed definitions, VITE args, flag ledger, line endings; no path filter on master |
| vite build args | 🔒 **GATE** | an undeclared `VITE_*` bakes in as `undefined` — "off on purpose" behind a green suite |
| Options Flow guard | 🔒 **GATE** | a stale-buffer commit silently removing live perf wiring |
| wisdom rails | 🔒 **GATE** | BAN rails — a red means Wisdom reaches Substack or member Journal data |
| flow-worker deploy coverage | 📋 advisory | owner ruling `b9acfddbd`; exits 0 by design |
| Joystick device suite | 📋 advisory | BrowserStack Automate unfunded; a clean green skip |
| OCR Linux version cert | 📋 advisory | says of itself *"IT SETS NO BAR"*; has a `continue-on-error` step |
| promote to production | 📋 advisory | it **is** the promotion; self-gating would deadlock its own poll |

⛔ **An unclassified workflow refuses the promotion**, so a workflow added tomorrow cannot
silently default to advisory.

⛔ **Two holes closed explicitly.** A path-filtered check that did not run is not a
failure — but a **disabled** workflow looks identical from the runs API, so every gating
workflow must additionally report `state == active`. And `master deploy gate` is
*required* to have run, because it has no path filter on master; its absence is a fault,
not a skip.

### Serialisation: QUEUE, not coalesce

`concurrency: cancel-in-progress: false`.

⭐ **The reason is repo-specific and is the kind that does not generalise:** `master deploy
gate`'s secret scan reads `git diff HEAD^ HEAD` — **one commit's files**. Cancel run A and
promote B, and A's code still deploys (it is an ancestor of B) while **A's changed files
were never scanned by any run that gated a deploy**. Coalescing is only sound when every
gating check is cumulative over the whole tree; ours is not.

### Fast-forward only, and rollback

If `production` is not an ancestor of the candidate the promotion **fails loudly and never
forces**.

**Rollback = revert on master, promoted forward:**
```sh
git revert --no-edit <bad-sha>
git push origin HEAD:master
```
⛔ **A manual reset of `production` is silently undone**: the older SHA is still an
ancestor of master, so the next promotion fast-forwards straight back over it. The
emergency path is `gh workflow disable "promote to production"` **first**, then a
force-with-lease — documented as owner-only.

### Interaction with `pre_push_guard.py`

It keeps watching **master**: it guards the *push*, and pushes still go to master. The
`--audit` stacked-push detector is largely obsoleted by the queue — under the promoted
gate, two master pushes cannot produce two overlapping deploys.

## 5.2 The 5.3 test design

Two docs-only pushes to master with the workflow live and `production` **unwatched**. Push
A carries a `[ci-slowtest]` marker that gates a sleep step; push B is trivial.

| | serialises correctly | does not |
|---|---|---|
| observation | `production`'s git log shows A's fast-forward completing **before** B's begins | B's fast-forward lands first, or the two interleave |
| evidence | commit order and timestamps **on `production` itself** | same |

⭐ **INCONCLUSIVE is excluded by construction:** the fast-forwards are commits on a real
branch, so there is always a durable, ordered record — unlike the Railway deployment list,
which carries no completion time. The only inconclusive case is *no promotion happened at
all*, which is a different and louder failure.

⛔ **Design only. The run is not authorised and was not performed.**

## 5.3 QUESTION 5.4 — keep Wait-for-CI on as belt-and-braces?

> **No — leave it OFF.** It waits on ALL checks for the commit, which re-couples every
> advisory rail (`flow-worker deploy coverage` above all) to the deploy decision and
> reintroduces exactly the all-or-nothing hazard the promoted-branch gate exists to replace
> with a named, selective check set.
>
> It would also be redundant rather than belt-and-braces: with Railway watching
> `production`, a commit only arrives there **after** the promotion has verified those named
> checks — so Wait-for-CI could add failure modes (an advisory red, or a check that never
> runs) but never a veto the gate has not already applied.

## 5.4 Cutover checklist — 👑 marks the steps that are yours

| # | step | owner |
|---|---|---|
| 1 | create `production` on origin at the current master SHA | 👑 |
| 2 | branch protection on `production`: block force-push and delete; **no PR requirement** (it breaks the fast-forward push); restrict pushes to the Actions app | 👑 |
| 3 | allow the Actions token through that protection | 👑 |
| 4 | add `RAILWAY_TOKEN` as a repo secret (for the deploy wait) | 👑 |
| 5 | merge `breadth/deploy-gate-v2` to master — it promotes to a branch nobody watches | you authorise |
| 6 | **observe for a day** with `production` unwatched | me |
| 7 | verify a `GITHUB_TOKEN` push to `production` actually triggers a Railway build | me (this is the unverified assumption, below) |
| 8 | Railway `web`: watched branch `master` → `production` | 👑 |
| 9 | Railway `web`: Wait-for-CI **OFF** | 👑 |
| 10 | repeat 8–9 per additional service if wanted | 👑 |

**Rollback of the cutover:** point Railway's watched branch back to `master`. Nothing else
is needed — the workflow promoting to an unwatched branch is inert.

## 5.5 ⚠️ What could NOT be verified — flagged, not asserted

1. ⛔ **Whether Railway builds on a `GITHUB_TOKEN` push.** The Actions recursion guard
   suppresses *Actions* triggers, not webhooks, so it *should* — **but that is reasoning,
   not measurement.** Step 7 is where it becomes a fact. If it does not, the promotion push
   needs a deploy key or PAT (👑) and cutover pauses there.
2. ⛔ **The Railway deploy wait is NOT BUILT.** The workflow warns loudly rather than
   claiming a wait that did not happen: no token → *"serialisation is at GitHub only"*;
   token present → *"not-implemented"*. First follow-up after cutover.
3. `tools/promotion_lag.py` (the missing-promotion detector for visibility) is **proposed,
   not built** — recommended to ride the existing hourly `UCT-StackedPushAudit` job rather
   than adding a second scheduled job.
4. The `[ci-slowtest]` sleep step is designed but **not added**; it should land and be
   removed in the same PR as the test result.

⚠️ **One out-of-scope note:** adding the `# promotion-gate:` markers meant a one-line
comment in workflows owned by other workstreams (wisdom, joystick, OCR, optionsflow,
flow-worker). All inert comments, no behaviour change — but they are not this programme's
files, and you should know they were touched.

## 5.6 Branch and verification

| | |
|---|---|
| branch | **`breadth/deploy-gate-v2`**, off `origin/master`, **pushed, not merged** |
| `3758cd75e` | feat(deploy): promoted-branch deploy gate — design + workflow, no cutover |

Mutation-proved three ways — promote on an empty run list, drop the disabled-workflow
check, strip a marker — each red, each naming its own rail, files restored sha-identically.
All 8 workflow YAMLs parse. `check_repo_hygiene.py` clean, and clean again `--staged`.

---

# 6. Fragments re-emitted

## 6.1 — Session 5 B.3 sample table, all six rows

Deployed commit `7707b2241` throughout. All `rows=4704`, all `coalesced=False`.

| # | time UTC | uptime | days | reader_ms | post_ms | client wall | status | bytes | cache |
|---|---|---|---|---|---|---|---|---|---|
| 1 | 21:54:04 | 1291 | 7991 | **249.3** | 684.8 | 1203 | 200 | 681,974 | miss |
| 2 | 21:54:43 | 1331 | 7990 | **185.8** | 507.6 | 1078 | 200 | 681,975 | miss |
| 3 | 21:55:18 | 1366 | 7989 | **151.1** | 352.7 | 732 | 200 | 681,974 | miss |
| 4 | 21:55:52 | 1400 | 7988 | **251.2** | 419.2 | 906 | 200 | 681,974 | miss |
| 5 | 21:56:28 | 1435 | 7987 | **691.6** | 747.0 | 1664 | 200 | 681,974 | miss |
| 6 | 21:57:03 | 1471 | 7986 | **162.8** | 360.1 | 756 | 200 | 681,974 | miss |

## 6.2 — the `breadth_snapshot_numeric` row count

**Production, read in-pod 2026-09-14 (Session 5, read-only `railway ssh`):**
`breadth_snapshots` **175**, `breadth_snapshot_numeric` **175**, **`numeric_missing` 0**;
`breadth_reconstructed_daily` **4,701**. Both markers present — `.breadth_numeric_v1` and
`.breadth_reconstructed_v1`. Backfill runs at boot from `api/main.py:3440` via
`api/services/breadth_numeric_migration.py`.

⚠️ **The local copy this session profiled reads 174 / 174 / 4,700** — it is an older
`VACUUM INTO` copy, one trading session behind. ⭐ **The property that matters is not the
absolute count but that the two are EQUAL**: the projection covers every snapshot, with no
gaps, on both copies.

## 6.3 — `685a19bdb`, full commit body

```
merge(breadth): the numeric projection — reader fix shape (a) (§3)

Member impact: breadth history loads get dramatically cheaper. Nothing a member
sees changes — parity is exact, row for row and key for key, against the reader as
it was before this change.

WHY. 99.7% of every stored snapshot blob is *_list ticker arrays (7,803 tickers,
636,834 bytes per row) that both history readers parse and immediately delete. The
projection stores what is left — 1,516 bytes per row, 0.25 MB for all 174 sessions
— and the readers stop selecting the blob column at all unless a date has no
projection yet.

MEASURED ON THE PRODUCTION COPY:
  parity    EXACT on 90/365/8000 — 4,703 rows x 80 keys. The golden is the OLD
            reader loaded from git under its canonical module name and asserted
            not to be the new code, never the new reader agreeing with itself.
            Controls: one corrupted value and one dropped key each make it fail.
  memory    transient 117.1 MB -> 2.7 MB; 1.36M objects -> 180
  backfill  174 rows in 1,441 ms, source fingerprint identical before and after
            (04404182c0ed13c1), drift audit clean
  reader    3.7x / 11.8x / 4.7x faster locally at 90 / 365 / 8000 days

The migration refuses to run without a VACUUM INTO backup, aborts rather than
proceeding uninsured, asserts the source table did not move, is marker-gated and
idempotent, and runs on a daemon thread so the backup cannot hold up a boot. Until
it runs the reader still serves correctly off the blobs, and that counted fallback
is what makes shipping the read path and the backfill in one deploy safe.

Flow-worker: ADDITIVE and BACKWARD-COMPATIBLE BOTH WAYS, no redeploy —
docs/breadth/flow-worker-strand-numeric.md. This one changes get_history, which IS
what flow-worker runs, so the write paths were enumerated from source: the router,
self-heal and recon writers are all outside its closure and get_latest() is a read.
flow-worker never writes a breadth snapshot; every write arrives through web.

Gate: 467 passed on the identical file set that measured 453 before the change,
plus exactly the 14 new rails. ⚠️ The six-shard vitest gate does not apply — zero
frontend files, and this worktree has no node_modules.
```

## 6.4 — C.5 item 4, the blob memory test

> **The blob memory test** — it parsed **all 174 blobs at once** and reported
> **616 MB / 1.36M objects**. The reader never does that (`fetchall` then
> parse-and-strip one at a time). Caught by comparing against the app-level peak, which
> was **~130 MB**. **Kept, labelled, as the counterfactual.**

## 6.5 — C.4, the sentence after *"By this programme's own rule that is not a measurement…"*

> **C.4** Settled reader before Session 4: **5,638.9 ms**, **n=1** (single production
> sample, `days=90`). ⚠️ By this programme's own rule that is not a measurement — **treat
> the 224–431 ms "improvement" as a band comparison, not a ratio.**

## 6.6 — H, the last sentence about V2-3

> **V2-3 (coverage line) enters only after the cap question is closed, since it is the
> first piece that changes what a member sees.**

---

# 7. Open questions for you

Each is one question with options. My recommendation is first.

**Q1 — the encoder. `jsonable_encoder` is now named as ~64 % of `encode_render`, which is
93–99 % of post-reader. Under Session 2 §4 the pre-serialised Response is unlocked. Do I
build it?**
- **(a) Yes — cache the serialised bytes, return a pre-rendered `Response`** *(recommended)*.
  Removes `jsonable_encoder` + `json.dumps` (597 ms of the local bundle) on every cache hit
  and most cache misses. Parity is byte-comparable by construction, which is the strongest
  gate this programme has. Risk: the cache stores ~5 MB per span instead of a dict tree —
  needs a measured memory bound before it ships.
- (b) Cheaper first: drop GZip to level 1. 158.0 → 16.1 ms, at 1.29 MB on the wire instead
  of 578 KB. **I do not recommend it** — it trades a 142 ms server win for 710 KB per
  member per request, and the members on phones pay for it.
- (c) Neither this session; re-measure after the cap question.

**Q2 — the D-043/044/045 heading level. 42 entries use `###`, those three use `##`. Do I
normalise the trio to `###` in one edit?**
- **(a) Yes, normalise all three** *(recommended)* — one edit, no content change.
- (b) Leave it; the trio is internally consistent.
- (c) Normalise, and also append `— 54,923 ms cold on days=8000` to D-042's heading so the
  programme's origin measurement is findable by scanning.

**Q3 — `docs/session6-record` is committed but not pushed. Where does it go?**
- **(a) Push it as its own branch and merge it through the normal gate when you authorise**
  *(recommended)*.
- (b) Rebase it onto `docs/session4-findings` first.
- (c) Fold it into `breadth/phase-instrument` so the instrument and its record merge as one.

**Q4 — the cap. I recommend NO change to `BREADTH_SERIES_MAX_SESSIONS` (§2.5). Do you
accept, or do you want the lift anyway?**
- **(a) Accept — leave it at 365** *(recommended)*; revisit when a feature actually requests
  a deeper span.
- (b) Lift to 1,000 now for headroom, accepting a deploy for no member-visible change.

**Q5 — `--gate-audit` (4.6). Build the CONFIRMED-ungated detector, or let Workstream 4
obsolete it?**
- **(a) Let W4 obsolete it** *(recommended)* — `production`'s git log answers it with no
  GitHub API.
- (b) Build it anyway as a transitional check, once G-2 lands.

**Q6 — the deploy gate. `breadth/deploy-gate-v2` is pushed and inert (it promotes to a
branch that does not exist yet). What is the next step?**
- **(a) Merge it to master when you authorise, then let it run for a day against an
  absent/unwatched `production` before anything else** *(recommended)* — it is safe to merge
  before cutover by construction, and a day of observation is free.
- (b) Do steps 1–4 of the cutover checklist first (they are all 👑), then merge.
- (c) Hold it on the branch until Session 7.

⚠️ Whichever you pick, **step 7 is the one that can stop the cutover**: nobody has verified
that a `GITHUB_TOKEN` push to `production` actually triggers a Railway build. It is
reasoning, not measurement, and it is cheap to settle once the branch exists.

---

# 8. Proposed Session 7

Build the **pre-serialised Response** (Q1a) — the one remaining cost is now named down to a
function, and the gate for it is the strongest one available: the response body must stay
byte-identical, which this session has already proved is measurable to a sha256 over 5.5 MB.
Ship it as its own merge with its own flow-worker classification, then **re-run the n=20
settled window against it** so the improvement is a production band comparison rather than a
local number. Alongside it, **observe the promoted-branch gate running to an unwatched
`production` branch for a day** before any Railway change is proposed, and close out the
small record items (Q2, Q3). **V2-3 (coverage line) still enters only after the cap
question is closed, since it is the first piece that changes what a member sees.**
