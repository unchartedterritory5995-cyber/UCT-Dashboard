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
| 4 | `/api/theme-performance` live overlay (`theme_performance.py:684`) | `theme_performance_overlaid` **10 s** (`_LIVE_1D_TTL`, verified `:61`) | Massive batch snapshots over ~2,050 holdings (~11 chunks) + open map (~11 chunks) + taxonomy enrichment of a ~345 KB payload; ~1–2 s. **No single-flight**: concurrent misses each fire ~22 chunk calls. | `ThemeTracker.jsx:125-127` 30 s; `ThemeTrackerPage.jsx:620` | boot one-shot | follow-up. Biggest fan-out; the base layer is already non-blocking and uses `set_by_completeness`. |
| 5 | `/api/breadth-monitor` → `get_history_deep`/`get_history` | 300 s body + deep caches | SQLite scan + rolling metrics. A code comment (`breadth_monitor.py:351`) records a 28 s uncached spike; CLAUDE.md records 2.9 s→137 ms warm. | `Breadth.jsx:683`, `BreadthWidget.jsx:378` 5 min | boot one-shot for `days=90` only; already single-flighted | follow-up. Keys vary by `days`/`end`/`anchor`, so it needs a bounded slot. |
| 6 | `/api/calendar/day-metrics-batch` → `get_day_metrics` (verified `calendar.py:2986`, `:3148`) | `calendar_metrics_{date}` (verified `:3000`): today 120 s | 1 Finviz Elite export per date (15 s timeout), Massive fallback; the batch walks up to 7 dates **serially**. | `useCalendarData.js:160` 2 min. TTL equals the poll interval. | not warmed | follow-up. `/calendar` is the first nav entry. |
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
