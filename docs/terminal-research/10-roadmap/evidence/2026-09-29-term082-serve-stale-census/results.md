# TERM-082 (FB-D4-01): serve-stale census and first two adoptions

* base: `eb8e19c90510735f55cd3ec59039b3985e1f525b`
* built: `c4660990c` (code + tests) and `92c51a697` (the test the first mutation pass showed was missing)
* spec: `docs/terminal-research/05-product-strategy/feature-opportunity-backlog.md` §FB-D4-01; row TERM-082 in `10-roadmap/backlog.md`

## 1. Current `serve_stale` consumers: the "five" holds for modules, not for slots

A grep for `ServeStale` over `api/` finds **5 consumer modules holding 10 slots**:

| module | slots |
|---|---|
| `api/routers/calendar.py` | `_WEEKLY_STALE` (:2031), `_ENRICH_STALE` (:3292) |
| `api/routers/signature.py` | `_DPL_STALE`, `_FCB_STALE`, `_GXW_STALE` (:70-72), `_DPC_STALE` (:979) |
| `api/routers/wire.py` | `_MOVES_STALE` (:30), `_COVERAGE_STALE` (:93) |
| `api/services/implied_move.py` | `_MOVE_STALE` (:402) |
| `api/services/setup_grade.py` | `_GRADE_STALE` (:110) |

So the spec's "five consumers" is correct if it means modules. At the base SHA **none of the ten slots emits a freshness stamp**: `ServeStale.serve` returns a value and does not say which tier answered.

## 2. The census: web `/api/*` reads that recompute synchronously on a TTL miss

Scope: GET reads served by `web`, with a plain TTL cache, an expensive recompute on a miss, and no serve-stale mechanism. Excluded per the brief: the options-flow family, auth, `/api/bars*`, and anything that feeds a write.

Ranking = cost of a miss × how often a member hits the expiry × whether anything keeps the key warm. The survey was done by a read-only sub-agent. The rows marked **verified** were re-read in code for this record. The others are the survey's `file:line` claims and were not re-checked.

| # | endpoint → service | key / TTL | what a miss does | who hits the expiry | warm? | status |
|---|---|---|---|---|---|---|
| **1** | `/api/snapshot` → `massive.get_snapshot` (`api/services/massive.py:1842`) | `snapshot`, **15 s**, one global key | 4 **sequential** Massive single-ticker snapshots, then 2 yfinance `fast_info` quotes capped at 12 s each. Per-ticker Massive measured 80–110 ms (`docs/superpowers/specs/2026-05-10-app-wide-s-tier-audit.md:36`), so a miss is ~1–2 s, worst case 12 s. A failed leg was cached 15 s as `"—"` as if good. | `FuturesStrip.jsx:189` 10 s · `MorningWireIndexes.jsx:37` 10 s (plain `useSWR`, keeps polling in hidden tabs) · `MARelationship.jsx:62` 15 s. **A 15 s TTL under a 10 s poll: some member pays a miss in every window.** | one-shot boot warm only (`api/main.py:5067`) | **ADOPTED** (verified) |
| **2** | `/api/movers` → `massive.get_movers` | `movers` **30 s** + `movers_discovery` 60 s, one global key each | 2 **sequential** Finviz Elite exports (15 s timeout each) + per-wire-mover `_is_leveraged_etf` yfinance `.info` (12 s cap, cached) + 1 Massive batch. Measured "67 ms warm / 3.3 s first" (s-tier audit `:34`). A Finviz failure is swallowed, parses to `[]`, and was cached 60 s as a good discovery. | `MoversSidebar.jsx:133` 30 s, market hours, on Dashboard + MobileNav. **TTL equals the poll interval.** | one-shot boot warm only (`main.py:1073`, `:5068`) | **ADOPTED** (verified) |
| 3 | `/api/earnings` + `/api/earnings-gaps` → `engine.get_earnings` (`engine.py:909`) | `earnings` 1800 s; `earnings_gaps_live` 30 s | 2 EarningsWhispers + 2 Finnhub calls, **sequential**, 15 s timeouts each (worst ~60 s). `/api/earnings-gaps` calls `get_earnings()` itself, so its 30 s poller usually trips the 30-min cliff. | `CatalystFlow.jsx:86-93` (300 s / 30 s) | boot one-shot (`main.py:5073`). **Invalidated on every `/api/push`** (`push.py:32`), so the first reader after the morning wire pays. | **ADOPTED** (`7550991ff`, see §8) |
| 4 | `/api/theme-performance` live overlay (`theme_performance.py:684`) | `theme_performance_overlaid` **10 s** (`_LIVE_1D_TTL`, verified `:61`) | Massive batch snapshots over ~2,050 holdings (~11 chunks) + open map (~11 chunks) + taxonomy enrichment of a ~345 KB payload; ~1–2 s. **No single-flight**: concurrent misses each fire ~22 chunk calls. | `ThemeTracker.jsx:125-127` 30 s; `ThemeTrackerPage.jsx:620` | boot one-shot | **ADOPTED** (`be00f2c9a`, verified, see §9) |
| 5 | `/api/breadth-monitor` → `get_history_deep`/`get_history` | 300 s body + deep caches | SQLite scan + rolling metrics. A code comment (`breadth_monitor.py:351`) records a 28 s uncached spike; CLAUDE.md records 2.9 s→137 ms warm. | `Breadth.jsx:683`, `BreadthWidget.jsx:378` 5 min | boot one-shot for `days=90` only; already single-flighted | follow-up. Keys vary by `days`/`end`/`anchor`, so it needs a bounded slot. |
| 6 | `/api/calendar/day-metrics-batch` → `get_day_metrics` (verified `calendar.py:2986`, `:3148`) | `calendar_metrics_{date}` (verified `:3000`): today 120 s | 1 Finviz Elite export per date (15 s timeout), Massive fallback; the batch walks up to 7 dates **serially**. | `useCalendarData.js:160` 2 min. TTL equals the poll interval. | not warmed | **ADOPTED** (`be00f2c9a`, verified, see §9) |
| 7 | `/api/sector-strength` (verified `sector_strength.py:117,126`) | `sector_strength_{n}` 900 s | 11 parallel Massive agg calls, ~1 s; single-flight exists | 900 s | none | low |
| 8 | `/api/insider/feed` (verified `insider.py:183`) | `insider_feed` 3600 s | ~55 tickers, 10-wide pool, several seconds cold | UCT20 page, 1 h | none | low |
| 9 | `/api/calendar/month` | `calendar_month_{y}_{m}` 1800 s | ~5 serial range-week builds | Month view, 30 min | none | low |

Ruled out (survey; reasons in the sub-agent record): `/api/news` (own SWR), `/api/calendar` + enrichment (ServeStale + 240 s loop warmer), `/api/rs-rankings` (50-min loop warmer; `compute_rs_scores` itself lacks single-flight), `/api/breadth-monitor/live` (per-minute sampler), theme-performance base and dark-pool aggregates (non-blocking stubs), wire_data-backed reads, per-ticker unbounded-key reads (a poor fit for a bounded slot), and cheap reads.

⚠️ One survey claim was **wrong and is corrected here**. The survey said `/api/snapshot` and `/api/earnings` have "no warmer at all". Both are warmed by the second, lifespan-level one-shot `_warm_dashboard_caches` (`api/main.py:5060-5074`), which the survey did not see. The ranking is unchanged: a one-shot warm covers only the first TTL after a deploy.

## 3. What was adopted, and why these two

**#1 `/api/snapshot`** and **#2 `/api/movers`**. They are the only candidates whose TTL is at or under the member's poll interval on the dashboard, so the cliff lands on some member in every window rather than once an hour. Each has one global key, which makes the slot trivially bounded. Both also had a cache_policy violation that turns into a real bug once last-good is remembered: a failed leg or export was cached as good.

The implementation follows the calendar/wire consumers: same class, same single-flight, a module-level slot, and `fresh=cache.get(key)`.

* `api/routers/snapshot.py`: `_SNAPSHOT_STALE = ServeStale("snapshot", max_age_seconds=120, max_keys=4)`. The bound is 8× the TTL: past that, a failing refresh falls back to the old synchronous build.
* `api/routers/movers.py`: `_MOVERS_STALE`, bound 180 s (6× the TTL). The slot sits **at the router on purpose**. `massive.get_movers()` has other callers, including the catalyst engine, which writes catalyst rows from it. Those callers keep their exact behaviour and never see a served-stale list (railed: `test_get_movers_other_callers_never_see_a_stale_list`).
* **Partial is never last-good (cache_policy's guard, reused rather than restated).** `get_snapshot` and the new `massive.build_movers()` both cache through `set_by_completeness`:
  * A snapshot is complete only when every leg is priced (`massive.snapshot_complete`). Short TTL 5 s.
  * Movers are complete only when both Finviz exports answered and the Massive overlay did not raise. Short TTL 10 s; discovery 15 s.
  * The new `_fetch_finviz_movers_checked` reports the export failure the old code swallowed. `_fetch_finviz_movers_live` keeps its 2-tuple for its callers and tests.
  * A partial is still served on its short TTL (rule 1), and `good()` keeps it out of the slot.

## 4. Freshness convention (PROD-C7)

No serve-stale consumer exposed a stamp, so there was nothing to copy there. The established convention for "which cache tier served this" is `/api/bars`' `Server-Timing` header, `bars;desc="<layer>";dur=<ms>` (`api/routers/bars.py:989-1004`, labels from `bars_fetch._mark_serve`). CARD 16 already rules on its `stale-swr` label.

Both routes now emit that exact shape:

* `snapshot;desc="stale-swr";dur=<ms>, stale-age;dur=<age ms>` for a served-stale answer;
* otherwise `mem` / `fetch` / `inflight-wait`, the bars vocabulary.

The mechanism is `serve_stale.serve_with_tier()`. It observes the callbacks and does not modify `ServeStale`, so the ten existing slots are byte-identical in behaviour.

⚠️ **This is the stamp at the response, not in the payload body.** PROD-C7's full wording ("visible at the value") is a UI concern. It is `TERM-059` (FB-A11-03, "Label a stale or proxied value at the value", behind 041). The brief forbade inventing a new body field or doing UI work, so the payloads are unchanged and no frontend reads the header yet.

## 5. Tests

`tests/test_term082_serve_stale_adoption.py`, 14 tests. The providers are faked, the clock is injected (`cache.time` and `serve_stale.time` patched), and nothing touches the network. Per route:

* **(a)** After the TTL lapses, 8 concurrent requests all get last-good while the rebuild is held on a gate. Each is marked `stale-swr` with a `stale-age`, and exactly one recompute runs. There is also a cold-herd test: 6 concurrent cold requests produce 1 build.
* **(b)** A refresh that raises writes nothing, and last-good keeps being served, still `stale-swr`, with a growing age. A partial rebuild is served on its short TTL, never enters the slot, and last-good returns once the short TTL lapses. Movers covers both legs: a Finviz export failure and a Massive overlay failure. The real Finviz fetch is driven with each export failing.
* **(c)** On a cold start with no last-good: one synchronous build, the built payload returned exactly as the service caches it, and a raise is still a 503.

`tests/conftest.py` gains `_reset_snapshot_movers_serve_stale`, the same sys.modules pattern as the calendar fixture. `tests/api/test_movers.py::test_movers_structure` now fakes the route's new seam, `build_movers`.

Totals, each read from the run's own log:

| run | totals |
|---|---|
| adoption + existing movers/snapshot/movers-filter tests | `29 passed` (before the Finviz test was added) |
| rails `test_no_shadowed_definitions`, `test_llm_timeout_census`, `test_order_dependence_rails` + existing serve_stale consumer suites (`test_calendar_load_latency`, `test_implied_move`, `test_setup_grade`, `test_signature_router`) + the above | `204 passed` |
| every other test file touching movers/snapshot (`test_dashboard_warm`, `test_voice_tools`, `test_oi17_auth_gate`, `test_mover_threshold_single_authority`, `test_cache_snapshot`, …, 11 files) | `223 passed` |
| adoption suite + `test_movers_filter.py` after the Finviz test | `21 passed` |

## 6. Mutation proof

Harness in the session scratchpad. For each mutation: back up the bytes to a lane-unique scratch file, mutate, run the adoption suite, restore the bytes, then verify the restore against the committed blob (`git cat-file blob HEAD:<path>`, exported beforehand, compared CR-stripped). `git checkout` was not used. After the run, `git status` was clean.

| mutation | suite |
|---|---|
| M1 (a) snapshot slot unusable (`SNAPSHOT_STALE_MAX_AGE = 0`) | **3 failed**, 11 passed |
| M2 (a) movers slot unusable (`MOVERS_STALE_MAX_AGE = 0`) | **4 failed**, 10 passed |
| M3 (b) snapshot `good=bool` (partial remembered) | **1 failed**, 13 passed |
| M4 (b) movers `good=lambda r: bool(r)` (partial remembered) | **2 failed**, 12 passed |
| M5 (b) stale answer labelled `TIER_FRESH` | **7 failed**, 7 passed |
| M6 (b) failed Massive overlay not marked partial | **1 failed**, 13 passed |
| M7 (b) failed Finviz export not marked partial | **1 failed**, 13 passed |
| control (unmutated) | 14 passed |

⚰️ **M7 survived the first pass** (13 passed): every test faked `_fetch_finviz_movers_checked` wholesale, so the real flag was never exercised. `92c51a697` adds `test_finviz_fetch_reports_a_failed_export_as_incomplete`, and the table above is the second pass. All 7 mutations went red, and every restore matched HEAD.

## 7. Not measured

* Production latency. FB-D4-01's "known it worked" metric is "a cold-pod load of the adopting surface has no call over 3 s", with the tier mix reported beside the p95. That needs a deploy plus TERM-012's p95 instrument, and the backlog row marks TERM-082 "⛔ needs 012". Nothing was pushed.
* Whether any client reads `Server-Timing` for these two routes. None does today.

## 8. Rank 3 adopted: `/api/earnings` + `/api/earnings-gaps`

* base: `76bbbe126b6af4b4890761cda385198446c51489`
* built: `7550991ff` (code + tests), not pushed

**The slot.** `api/routers/earnings.py`: `_EARNINGS_STALE = ServeStale("earnings", max_age_seconds=2400, max_keys=4)`, keyed `earnings:<today>` because the payload is "today" (today's BMO, yesterday's AMC, tonight's AMC). `/api/earnings-gaps` reads its list through the same slot, so its 30 s poller no longer trips the 30-minute cliff. Both routes stamp `Server-Timing` through `serve_with_tier`; on the gaps route the tier names where the LIST came from, and the prices are at most 30 s old as before.

**The bound, 2400 s.** The slot's age counts from the build, so it is already ~1800 s old when the TTL lapses, and a bound at or under the TTL would never serve. 2400 s is the TTL plus 10 minutes: many times the ~60 s worst-case rebuild, but short enough that a refresh which keeps RAISING through a BMO/AMC report window degrades to the old synchronous build instead of pinning a pre-report list. A refresh that returns a PARTIAL does not need the bound: it is served from the cache on its short TTL.

**Complete, from the code.** `engine.build_earnings()` returns `(payload, complete)` and caches through `set_by_completeness` (ok 1800 s, partial 300 s). Complete means no provider leg that RAN failed:
* EarningsWhispers answered for today and yesterday (otherwise the lists fall back to `wire_data`, a degraded answer);
* every Finnhub calendar call that ran returned a body (`fh_get` returns None on an error, a 429 cooldown or a shed token);
* every FMP breadth-fallback call that ran answered: the new `_fmp_calendar_actuals_for_day_checked` separates a failure (raise, degraded, non-list) from an unconfigured key or an empty day; the old helper returned `{}` for all of them;
* the Massive `change_pct` overlay did not raise (`_enrich_earnings_with_gap` now returns whether it answered).

A leg that did not need to run is not a failure (no Finnhub key, nothing pending), and neither is a "Pending" verdict: before a company reports, a missing actual is the correct value.

**Push semantics (the choice).** The pre-push list may be served after a push, marked `stale-swr`, within the bound, and only because `/api/push` now calls `earnings.on_wire_push()` right after storing the new wire, which kicks one refresh immediately. Two guards make that honest:
* A build that started before the push read the old wire. `on_wire_push` bumps a generation counter; a build that sees it move re-runs once and drops its own cache write, so a straddling build is never cached as fresh and never becomes last-good. Without this, the push's kick is a no-op while that build runs (one refresh per key) and the stale build would win for 30 minutes.
* With no servable last-good in the slot (nobody has read the route since boot), the push kicks nothing and the first reader builds synchronously, exactly as before. Kicking there would race that reader's build, because the background refresh does not take the single-flight build lock.

`ServeStale` gained one additive public method, `kick()`, which calls the existing `_kick`. The ten older slots are untouched.

**Other callers.** The slot sits at the router, as movers did. `engine.get_earnings()` keeps its behaviour for the catalyst engine, voice and Compass tools, `flow_explain` and the analysis modal's row lookup: a cache hit, else a synchronous build. The only change they see is cache_policy's: a partial is now cached for 300 s instead of 1800 s. Railed by `test_get_earnings_other_callers_never_see_a_stale_list`.

**Tests.** `tests/test_term082_earnings_serve_stale.py`, 15 tests, real `build_earnings` with every provider faked and the clock injected: (a) expiry with 8 concurrent requests across both routes (one recompute) and a cold herd (one build); (b) a raising refresh, a partial refresh per leg (EW, Finnhub, FMP, Massive), the completeness predicate read from the legs, and the FMP checked helper; (c) cold start, the 503 and the gaps route's propagated error, and a new day never served yesterday's list; (d) the push kicks a refresh with no reader, a straddling build is re-run and not remembered, and no last-good means no kick. `tests/conftest.py` gains `_reset_earnings_serve_stale`. `tests/api/test_misc_endpoints.py::test_earnings_returns_structure` now fakes the route's seam, `build_earnings`.

| run | totals |
|---|---|
| new suite, three repeats | `15 passed` each |
| new suite + adoption suite + every test file touching earnings, earnings-gaps or push (22 files: `api/test_earnings`, `api/test_misc_endpoints`, `test_push`, `test_push_intraday`, `test_calendar_live`, `test_dashboard_signposts`, `test_earnings_*` (5), `test_flow_explain`, `test_voice_*` (3), `test_wire_archive`, `test_panel_prewarm`, `test_paywall_gate_free_tier`, `test_call_recap`, `test_calls_transcript_modernization`, `test_av_transcripts`, `theme_engine/test_propagation`) | `406 passed` |
| rails `test_no_shadowed_definitions`, `test_order_dependence_rails`, `test_llm_timeout_census` | `42 passed` |
| existing serve_stale consumer suites (calendar, implied_move, setup_grade, four signature files) | `219 passed` |

**Mutation proof.** Same method as §6: byte backup to a lane-unique file, mutate, run the suite, restore, compare the restore to `git cat-file blob HEAD:<path>` (CR-stripped). No `git checkout`; tracked `git status` clean afterwards.

| mutation | suite |
|---|---|
| control (unmutated) | 15 passed |
| M1 (a) slot unusable (`EARNINGS_STALE_MAX_AGE = 0`) | **6 failed**, 9 passed |
| M2 (b) `_good` ignores completeness (partial remembered) | **4 failed**, 11 passed |
| M3 (b) `build_earnings` always reports complete | **5 failed**, 10 passed |
| M4 (b) failed Finnhub today-AMC call not marked partial | **2 failed**, 13 passed |
| M5 (d) `on_wire_push` does not kick | **1 failed**, 14 passed |
| M6 (d) a build straddling a push is kept | **1 failed**, 14 passed |
| M7 (d) `/api/push` never calls the hook | **2 failed**, 13 passed |
| control after restores | 15 passed |

**Watch coverage.** `tools/flow_worker_watch_coverage.py` FAILS on `api/services/engine.py`: flow-worker imports it and will not redeploy for it. Classified an **inert strand**. `reachable_paths()` puts `engine.py` and `cache_policy.py` in flow-worker's closure and `api/routers/earnings.py`, `api/routers/push.py`, `api/services/serve_stale.py` and `api/flow_explain.py` outside it. The closure's only importers of `engine` are `earnings_enrichment` (`_get_anthropic_client`, `_EARNINGS_AI_MODEL`, `_anthropic_text`), `groups` (`_get_anthropic_client`) and `theme_performance` (`_load_wire_data`), none of them changed, and nothing in the closure calls `get_earnings`, `build_earnings`, `_enrich_earnings_with_gap` or the FMP helpers. The one import-time change, `from api.services.cache_policy import set_by_completeness`, names a module already in the closure (via `massive`). A stale copy on flow-worker is behaviourally identical. No forced flow-worker redeploy.

**Not measured.** Production latency, as for ranks 1 and 2.

## 9. Ranks 4 and 6 adopted: the theme-performance overlay and `/api/calendar/day-metrics-batch`

* base: `15a100749a1533ed926fdb2756238eab503127a7`
* built: `be00f2c9a` (code + tests), not pushed

### Census claims, re-read in code

Both claims held. Neither route had single-flight or a last-good.

* **Rank 4.** `_LIVE_1D_TTL = 10` (`theme_performance.py:61`). On a miss of `theme_performance_overlaid`, `get_theme_performance` re-ran `_apply_live_returns` over the cached daily base. That fetched `get_etf_snapshots` and `get_etf_open_snapshots` over every holding, and each is chunked at `_SNAPSHOT_BATCH = 200` (`massive.py:548`), so ~11 chunks each, then ran the taxonomy enrichment. The only lock is the base compute's `_compute_lock`. `ThemeTracker.jsx:127` polls every 30 s. The route had no `Response` object, so one was added (`response: Response = None`, the pattern movers uses). FastAPI injects it on a routed call, and a bare call gets `None`.
* **Rank 6.** `_METRICS_TTL = 120` for today, 1 h for a future date and 24 h for a past one (`calendar.py:2972`). The batch called `get_day_metrics` serially for up to 7 dates. Each miss runs one Finviz Elite export (15 s timeout) and, when fields are missing, a Massive rich-snapshot fallback. `useCalendarData.js:156-160` polls every 2 minutes for the current week. It is not warmed: `earnings_preview_warm` and the week poster call `get_day_metrics` on their own schedules, which is incidental, not a warm. The single-date route `/api/calendar/day-metrics` has no mounted caller (`useDayMetrics` is defined and never used), so it was left alone.

### Rank 4: the theme-performance live overlay

**The slot.** `api/routers/theme_performance.py`: `_THEME_STALE = ServeStale("theme_performance", max_age_seconds=30, max_keys=2)`, with one global key.

**The bound, 30 s.** That is 3x the TTL and equal to the tracker's poll. The slot's age counts from the build, so it is ~10 s old when the TTL lapses. A stale answer is therefore never more than one poll older than what the member already sees. A lone poller whose next poll lands after the bound builds synchronously, as before. `live_as_of` in the payload still says when its prices were applied.

**Complete, from the legs.** `svc.build_theme_performance()` returns `(payload, complete)`. An overlay is complete only when:
* the live 1D map was APPLIED (`_apply_live_returns` returns the base itself when there are no themes or the map is empty), and
* neither live map dropped a chunk or lost its client.

`get_batch_snapshots` and `get_batch_open_map` gained an additive `failures=` list. A chunk that fails twice is appended with its size; before this, it was invisible, because its tickers were simply absent. The `get_etf_*` wrappers forward the list only when one is passed, and a client failure appends `"client"`. An empty From-Open map with no failure is not a failure, because before the open prints it is the right answer.

A partial live map reused from the cache stays partial. A base recompute invalidates only the overlaid key, so the next overlay reuses the cached map; a marker key cached beside it with the same TTL carries the failure. The overlaid write goes through `set_by_completeness` with `ttl_partial == ttl_ok == 10`, so the cache TTL is unchanged for every caller. The "computing" stub is never complete. The overlay arithmetic is unchanged.

**Other callers.** The slot sits at the router. `svc.get_theme_performance()` is now "overlaid cache hit, else `build_theme_performance()[0]`", so voice tools, `theme_index`'s quotes and `compute_rotation_signals` keep their exact behaviour. The lifespan `_warm_dashboard_caches` also calls the service. `main.py`'s `_themes` warm calls the ROUTE function bare, so it now warms the slot too. The footer's `?refresh=1` bypasses the slot: it drops the overlay caches, builds synchronously, and a complete result refreshes the slot.

**Server-Timing** is `theme-performance;desc="<tier>";dur=<ms>` (+ `stale-age`), in the /api/bars shape.

### Rank 6: `/api/calendar/day-metrics-batch`

**The slot.** `api/routers/calendar.py`: `_METRICS_STALE = ServeStale("calendar_day_metrics", max_age_seconds=600, max_keys=16)`, keyed by the date's cache key.

**The bound, 600 s.** That is 5x today's TTL. It covers a refresh that keeps raising for several polls, then falls back to the synchronous build. A past or future date is older than the bound by the time its TTL lapses, so those keys behave as before (a synchronous build, now single-flighted). `max_keys` 16 covers the current week, the chart widget's selected day and a couple of paged weeks.

**Complete, from the legs.** The new `build_day_metrics(target)` returns `(payload, complete)`. A day is complete when price and avg_vol are each filled for at least one name (the rule this function always cached by) AND a Finviz leg that RAN did not fail. A raise, a non-ok response or an empty body is a failure. No token means the leg never ran, which is not a failure.

A Finviz failure is partial even when Massive filled the gaps. `avg_vol` is then the previous day's volume standing in for a 30-day average, and a past date used to pin that proxy for 24 h. Its short TTL is `min(ttl, 300)`, so today (120 s) is unchanged and a total miss keeps its 300 s. An unresolvable date is not complete, and `{}` is never remembered. A day with no entries is complete.

**Other callers.** `get_day_metrics` keeps the cache read and calls `build_day_metrics(...)[0]`. Its direct callers keep their behaviour: the week poster, `earnings_preview_warm`, the provider-coverage monitor (positional) and this module's week flattening. The only change they can see is cache_policy's: a past or future date whose Finviz leg failed is cached 300 s, not 24 h or 1 h.

**Server-Timing** is one `day-metrics` entry naming the STALEST tier any date was served from, with the oldest stale age. One stale date is never hidden behind six fresh ones.

### Tests

The new suites run the real services and routes against faked providers (the live snapshot maps; Finviz `requests.get` + the Massive client) with the clock injected. No network is used.

* `tests/test_term082_theme_performance_serve_stale.py` (15 tests):
  * (a) expiry with 8 concurrent requests (one recompute), and a cold herd (one build);
  * (b) a raising refresh; a partial refresh served on the live TTL and never remembered; the completeness predicate over dropped-chunk, empty and empty-open maps; the cached partial map; the REAL chunked fetch reporting a dropped chunk and a lost client; old-signature callers unchanged;
  * (c) cold start; the computing stub never remembered; the 503; `?refresh=1`;
  * other callers never stale, their TTL unchanged, and the bare lifespan call.
* `tests/test_term082_day_metrics_serve_stale.py` (17 tests):
  * (a) expiry with 8 concurrent requests, a cold herd, and the batch header naming its stalest date;
  * (b) a Finviz failure is partial even with Massive's fill; a raising refresh; the predicate (6 cases); the past-date TTL;
  * (c) cold start; the unresolvable date; the `max_keys` bound; the 7-date cap with no Response;
  * other callers (keyword and positional) never stale.

`tests/conftest.py` gains `_reset_theme_day_metrics_serve_stale`. `tests/test_theme_performance.py::test_theme_performance_endpoint_returns_200` and `tests/test_launch_hardening.py::test_theme_warm_is_throttled_and_capped` now fake the route's seam, `build_theme_performance`. After the route change, the first still passed with its old fake unused: it asserted only `themes` and `generated_at`, and the cold "computing" stub carries both. It now asserts that the fake answered.

| run | totals |
|---|---|
| both new suites | `32 passed` (15 + 17), repeated as the mutation harness's controls |
| the four term082 suites + rails `test_no_shadowed_definitions`, `test_order_dependence_rails`, `test_llm_timeout_census` | `103 passed` |
| every theme-performance / theme-tracker test file, plus massive's `get_etf_snapshots`/`get_batch_snapshots` users (19 files: `test_theme_performance`, `test_theme_from_open`, `test_theme_sets`, `test_launch_hardening`, `test_dashboard_warm`, `test_breadth_series_boot_warm`, `test_d4_cp3_theme_groups_per_entity_cache`, `test_d4_per_set_cache_manifest`, `test_engine_themes_news_cache_policy`, `test_groups`, `test_perf_cleanups`, `test_screener_theme_join`, `test_wire_archive`, `theme_engine/test_propagation`, `test_massive_extended_hours`, `test_discord_close_note`, `test_exposed_routes_gated`, `test_preference_key_validation`, `test_scan_evaluator`) | `484 passed, 1 failed`; the failure is pre-existing (below) |
| every calendar day-metrics test file (15 files: `test_calendar_anticipated_png`, `test_calendar_cache_policy`, `test_calendar_day_metrics_avg_vol`, `test_calendar_day_metrics_batch`, `test_calendar_week_contract`, `test_calendar_week_post`, `test_calendar_week_schedule`, `test_earnings_warm_priority_order`, `test_earnings_warm_row_adapter`, `test_provider_coverage_alerts`, `test_provider_coverage_forward_week`, `test_provider_coverage_monitor`, `test_provider_coverage_restart_dedup`, `test_scatter`, `test_calendar_load_latency`) | `234 passed, 1 xfailed` |

⚠️ **The one red is pre-existing, and it is a real product defect: the theme route's bars warm has been dead since `614235fd8`.** That commit added the query parameter `set: str | None = None` to `get_theme_performance`. It shadows the builtin inside the function, so `seen: set[str] = set()` calls `None()`. The `except Exception: pass` around the warm swallows the TypeError on every request without a `set`.

Proven against the base blob: running the HEAD router's warm path with the test's fakes gives `BASE warm calls with set=None: []`. `test_launch_hardening.py::test_theme_warm_is_throttled_and_capped` is therefore red at the base, and it stays red here. The fix is one line: rename the local, or use `builtins.set()`. It was NOT made, because it would restart a bars warm (30 tickers per 10 min) that has not run in production since that commit. That is an owner call, not part of TERM-082.

⚠️ `test_audit_sandbox_env.py` (4) and `test_shared_data_root_guard.py` (2) also fail on this branch. They matched the theme grep and are not in the brief's list. Every failure names `/data/hub_reports.db` or `/data` literals in `darkpool_router`, `flow_backup`, `flow_router`, `gex_router`, `main.py` and `schwab_router`, and none of those files is touched here.

### Mutation proof

The harness is `.superpowers/term082-r46/mutate_r46.py` (gitignored, lane-unique). For each mutation it takes a byte backup to a lane-unique file, applies the mutation (it must match exactly once), drops the module's `.pyc`, runs the suite, restores, and compares the restore to `git cat-file blob HEAD:<path>` (CR-stripped). No `git checkout`. Tracked `git status` was empty afterwards.

| mutation | suite |
|---|---|
| controls (theme / day), before and after | 15 passed / 17 passed |
| T1 (a) theme slot unusable (`THEME_STALE_MAX_AGE = 0`) | **3 failed**, 12 passed |
| T2 (b) `_good` ignores completeness (partial remembered) | **2 failed**, 13 passed |
| T3 (b) overlay `complete` ignores failed live legs | **3 failed**, 12 passed |
| T4 (b) cached partial live map read as whole (marker ignored) | **1 failed**, 14 passed |
| T5 (b) the real chunked snapshot fetch does not report a dropped chunk | **1 failed**, 14 passed |
| T6 (b) a stale overlay labelled `mem` on Server-Timing | **7 failed**, 8 passed |
| T7 (other callers) `svc.get_theme_performance` reads through the route's slot | **1 failed**, 14 passed |
| D1 (a) day-metrics slot unusable (`DAY_METRICS_STALE_MAX_AGE = 0`) | **4 failed**, 13 passed |
| D2 (b) `_metrics_good` ignores completeness | **2 failed**, 15 passed |
| D3 (b) a failed Finviz leg not marked partial | **5 failed**, 12 passed |
| D4 (b) the batch header hides a stale date (tier order reversed) | **1 failed**, 16 passed |
| D5 (b) a partial past date keeps its 24 h TTL | **1 failed**, 16 passed |
| D6 (other callers) `get_day_metrics` reads through the route's slot | **1 failed**, 16 passed |

All 13 went red, and every restore matched HEAD.

### Watch coverage

`tools/flow_worker_watch_coverage.py` FAILS on `api/services/massive.py` and `api/services/theme_performance.py`: flow-worker runs both and will not redeploy for them. This is classified an **inert strand**, with the evidence below.

* `reachable_paths()` puts both files (and `cache_policy.py`) in flow-worker's 192-file closure. `api/routers/theme_performance.py`, `api/routers/calendar.py` and `api/services/serve_stale.py` are outside it, so neither slot exists on flow-worker.
* An AST walk of the closure (comments stripped by construction; only references that resolve to these two modules count) finds these callers of changed functions outside the changed files:
  * `engine.py:615` (`get_etf_snapshots` via `snap_fn`);
  * `engine.py:828` and `:2655` (`_get_client().get_batch_snapshots`);
  * `groups.py:246` (`get_etf_snapshots`);
  * `groups.py:148` (`theme_performance.compute_rotation_signals`, which calls `get_theme_performance`).
* None of those external callers passes `failures`. With `failures=None`, the wrappers make the byte-identical call they always made, and the chunk loop appends nothing (railed: `test_callers_that_pass_no_failures_list_are_unchanged`).
* The only callers that pass `failures` are `theme_performance._fetch_live_*`. They sit in the same stale pair: neither file redeploys on flow-worker, so its old `theme_performance` runs against its old `massive`, consistently. The refactored `get_theme_performance` is behaviour-identical, and its marker writes land in the process's own in-memory cache.

A stale copy on flow-worker behaves identically, so no forced flow-worker redeploy is needed.

### Found in passing, not fixed

`live_returns_for_syms` (theme sets' off-taxonomy extras) calls `_fetch_live_1d_map(missing)`, but that function caches under the ONE global key whatever syms it was asked for. That breaks in two directions:
* an extras call on a cold key writes a map of only its few syms, and the next overlay (within 10 s) applies it, so almost every holding keeps its base 1D;
* an extras call on a warm key reads the universe map, which does not contain the off-taxonomy syms it asked for.

This is pre-existing and outside this lane. The overlay's completeness cannot see it either: a map built with no failures is "whole" even when it answered a different question.

**Not measured.** Production latency, as for ranks 1–3.
