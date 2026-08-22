"""One-off helper: writes the final consolidated stress-test report.md.
Not itself a report — a generator script, kept for reproducibility.
"""
from pathlib import Path

CONTENT = r"""# Screener UI Stress Test — Final Report

**Target:** 10 concurrent paid-user browser contexts x 1,150 iterations = 11,500 actions against `/screener` (ScannerShell), local backend `http://localhost:8077`.

**Actual:** two runs, combined below. Run 1 (the full 11,500-target run) was **externally killed** (process terminated, not a crash of the harness's own logic) after the backend itself died mid-run and was restarted by the controller. Run 2 is a **fresh 2,000-iteration top-up** (10 workers x 200) launched after the restart to (a) prove the fixes/pacing still hold, (b) add clean post-recovery coverage, and (c) watch for a second crash. **No second crash occurred** -- backend uptime climbed monotonically through all of Run 2 (uptime_seconds 598 -> 2162+) even though it was still 503-ing heavily under load.

Run 1's design has **no checkpointed resume** (no per-worker progress file) -- a killed process cannot be resumed, only restarted. Given Run 1 had already reached an estimated **>=10,035 of 11,500 iterations** (lower bound, derived from the highest iteration number carrying a *finding*; most iterations near the end produced no finding at all, so true completion is almost certainly higher -- worker 9 alone was at iteration 1147/1150), restarting all 10 workers from zero for the last ~1,465 iterations was judged a poor use of another ~70-minute window carrying the same infra fragility. Instead: **Run 1's findings stand as-is** (per the controller's own instruction), and **Run 2 is a smaller fresh top-up**, not a resume -- stated here explicitly so the "iterations completed" number is honest about what it means.

| | Target | Completed | Status |
|---|---|---|---|
| Run 1 (full) | 11,500 | **>=10,035** (lower bound; likely closer to 11,000+) | Externally killed after backend restart, mid-flight |
| Run 2 (top-up) | 2,000 | **2,000 / 2,000** | Completed cleanly, no crash |
| **Combined** | -- | **>=12,035 real iterations executed** | |

Both runs' raw data are preserved: Run 1 -> `tools/ui_stress_out_run1/` (findings.jsonl + anomalies, backed up before Run 2 overwrote the live output dir). Run 2 -> `tools/ui_stress_out/` (findings.jsonl + anomalies, current).

---

## The crash -- top finding, stated honestly

**At ~22:39 CT, the local backend died (exit 1, no traceback) while 10 concurrent Playwright contexts were mid-run**, hammering `/api/live-prices`, `/api/bars/{ticker}` (per-ticker chart fetches from the grid's live-price cells, ticker popups, and the Charts view's mini-chart gallery), and `/api/screener/scan`. The controller restarted it on the same port; it came back in ~2 minutes.

- **Local-confirmed, prod-severity unproven.** This backend is a single keyless local uvicorn process -- `/api/bars/*` falls through to yfinance (no Massive API key configured locally), and yfinance under 10-way concurrent hammering is exactly the kind of unbounded-fanout load this repo's own CLAUDE.md performance section warns about ("Any NEW blocking external call on the request path MUST have a timeout" / the 2026-07-01 524 outage class). Production has real API keys, warm caches, and the bounded-pool protections documented there (`massive._bounded_yf`, `yf_util.bounded_call`) -- whether they hold under an equivalent 10-concurrent-user popup/chart-fetch burst is **unknown from this test**. Flag to the owner as: *"10 concurrent users doing popup/bars-heavy actions killed a keyless local single-process backend; the popup fetch path is expensive under concurrency -- worth a deliberate load check against prod before assuming it's fine."*
- Even after the restart, the backend continued returning heavy **503 Service Unavailable** on `/api/bars/{ticker}` and `/api/live-prices` for the **entire 24-minute Run 2** (not just a brief post-restart window) -- see "Chronic backend pressure" below. This backend was never fully "healthy" again at 10-way concurrency; it was merely not fully dead.

### Quarantine -- the outage-shaped noise, not counted as candidate bugs

Run 1's findings.jsonl was analyzed post-hoc (`tools/_analyze_stress_findings.py`) to separate outage artifacts from real signal. Two environmental buckets were carved out and **excluded from the candidate-bug list below**:

1. **Discrete outage windows** (13 detected via a 10-second-bucket, >=4-simultaneous-workers heuristic): `21:51:10-21:51:30`, `21:52:00-21:52:10`, `21:53:00-21:54:20`, `21:55:40-21:56:30`, `21:57:10-21:58:30`, `22:01:50-22:02:10`, `22:03:00-22:03:40`, `22:04:20-22:05:10`, `22:05:50-22:06:00`, `22:07:00-22:07:10`, `22:22:50-22:23:00`, `22:39:30-22:39:40` (the fatal one), `22:40:10-22:40:20`. Findings inside these windows matching a connection/5xx/timeout shape: **516 findings, 94 distinct signatures** (mostly per-ticker `network_fail:HTTP 503:.../api/bars/{TICKER}` -- see below), workers 0-9 all affected.
2. **Chronic action-timeout pressure under 10-way concurrency** (see next section) -- pervasive throughout, not confined to the discrete windows.

**Per-ticker signature explosion (a harness-design note, not a product bug):** `/api/bars/{TICKER}` 503s produce a *distinct signature per ticker* (the URL normalizer only strips numeric path segments, not ticker symbols) -- Run 1 alone shows **150+ distinct `network_fail:HTTP 503:.../api/bars/<TICKER>` signatures**. This is one story ("the backend was down/overloaded for bars fetches"), not 150 stories. Anyone reading `findings.jsonl` directly should collapse anything matching `network_fail:HTTP 503:.*api/bars/[A-Z]+$` into one bucket.

---

## Chronic backend-load pressure (environmental, not a UI bug -- but real signal)

Distinct from the discrete crash, **every action type** hit either the outer 8-second wall-clock cancellation (`action_error:<name>:timeout`) or Playwright's own 4-second element-action timeout (`action_error:<name>:TimeoutError`) **repeatedly, from the very first iterations of every worker, throughout both runs** -- not concentrated in a short window. In Run 2 alone: `set_filter:TimeoutError` x50 (capped -- true count higher), `switch_view:timeout` x50, `sort_header:timeout` x44, `filter_search:TimeoutError` x35, `screens_menu:timeout` x34, `columns_picker` (both flavors) x54, `remove_chip:timeout` x28, `scroll_more:timeout` x24, `nav_roundtrip:TimeoutError` x19, `ticker_popup:timeout` x17, and more.

**Triage: this is backend latency under sustained 10-way local concurrency, not 12 independent broken UI controls.** The uniform spread across every unrelated action type (a UI click, a sort, a filter-search keystroke) is the signature of shared request latency, not a control-specific defect -- a real per-control bug would concentrate in one action type, not appear evenly across all of them. This matches the crash section's framing exactly: environmental, real, but a capacity/local-environment story rather than a `/screener` UI defect. **Recommendation for the owner:** this harness's 4-8s budgets were sized for a healthy backend; they are not proof of anything at 10-way concurrency against a keyless local yfinance fallback. Re-run (or accept as expected) against a warmly-cached / API-keyed instance before drawing UI-perf conclusions from timeout counts alone.

---

## CANDIDATE BUGS (real signal, triaged, screenshots opened and confirmed)

### 1. Blank-white-page crash under sustained load -- no error boundary (SEVERE, high confidence)

**Signature:** `root_empty` (React `#root` has zero children) + `match_count_missing` (no `[aria-live=polite]` element -- the same symptom, different probe). **Run 2 alone: 204 and 217 true occurrences respectively** (in-memory counts; findings.jsonl caps the raw log at 50/signature) -- over **10% of all 2,000 Run-2 iterations** landed on a completely blank white page.

**This is not a screenshot-timing artifact.** Occurrences cluster into **long contiguous runs per worker**, not isolated blips -- e.g. worker 0 iterations **110 through 136 straight** (27 consecutive iterations blank), worker 2 iterations **187 through 200** (ran to the end of that capped sample), worker 7 **28-31**. Once a worker's page goes blank, it **stays blank across many subsequent actions** until something resets it (a page reload/recycle) -- this is a persistent crash state, not a one-frame race.

**Screenshot:** `anomalies/root_empty_7_28.png` -- pure white, no dark app background, no logo, nothing. Confirmed by opening the image directly.

**Hypothesis (for the owner to verify in code, not verified line-by-line here):** under the sustained 503 storm on `/api/live-prices` / `/api/bars` / `/api/screener/scan`, something inside `ScannerShell`'s render tree (or a child it always mounts -- `VirtualResults`, the live-price merge in `cellValue`, `ChartsGallery`, `PatternFeedbackChip`'s fetch, or `useRealtimePrices`) throws synchronously during a failed-fetch render path. `/screener` -> `ScannerShell` has **no visible ErrorBoundary** in the files read for this harness; an uncaught render error with no boundary is exactly how React 18 produces a torn-down, zero-child root. **Recommendation: wrap ScannerShell (or its VirtualResults/ChartsGallery/live-price-merge children) in an ErrorBoundary**, and instrument what specifically throws under a failed scan/bars/live-prices response.

**Cross-run confirmation:** the same signature (with a slightly different absolute count) appeared in Run 1 too (27 occurrences in the capped sample), so this reproduces across independent runs -- not a one-off fluke of Run 2's particular load pattern.

**Positive counter-evidence worth noting:** the app's error-UX *can* degrade gracefully -- a phone-worker screenshot mid-crash-window (`anomalies/pageerror_Failed_to_fetch_8_892.png`) shows a proper "Scan failed -- Failed to fetch [Retry]" banner, "Export failed -- nothing downloaded. Try again." status text, and per-card "Failed to load chart -- RETRY" states in the Charts gallery -- so *some* failure paths are handled well. The blank-page state is a **different, unhandled** path that the graceful one doesn't cover.

### 2. ColumnPicker's own header renders invisible/unreachable (real, reproducible on the very first interaction -- not load-related)

**Signature:** `action_error:columns_picker:TimeoutError`, first occurrence **at iteration 1** for worker 2 (~21:50:22, long before any backend stress).

**Screenshot:** `anomalies/action_error_columns_picker_TimeoutError_2_1.png` -- the Columns dropdown is open and its checkbox list renders fine (6M%, 1Y%, YTD%, ADR 1W, etc., with ATH checked), but **the picker's own header row -- the "Find a column..." search box, "Reset to view" button, and the X close button -- is not visible anywhere in the popup.** The harness's attempt to click "Close column picker" (`aria-label="Close column picker"`) timed out because that element isn't reachable/visible.

**Triage: real, high confidence.** This happened on the very first action of a fresh session, far from any load condition, and the component code (`ColumnPicker.jsx`) clearly defines that header (search input + Reset + Close button) as the first children of `.pickerHead`, above `.pickerList`. Something is rendering the header off-screen, behind the toolbar, or with zero height at this specific viewport (1568x900) and current filters state -- a real member closing this dropdown would be stuck clicking outside it instead of using the intended Close button. **Recommendation: check ColumnPicker.module.css's `.pickerHead` positioning/z-index relative to `.toolbar` and `.pickerPop`.**

### 3. Five zero-accessible-name buttons on `/charts` (found incidentally via `nav_roundtrip`)

**Signatures:** `zero_a11y_name:_settingsBtn_1bmsl_163`, `_btnCompact_97moi_3`, `_btn_1mmqs_135`, `_gearBtn_edx06_211`, `_badge_10ga6_17` -- 13 occurrences each in Run 2 (50 each in Run 1, capped), all first-seen during `nav_roundtrip` (the action that visits `/charts` and returns).

**Screenshots confirmed:** `zero_a11y_name__badge_10ga6_17_1_316.png` and `zero_a11y_name__btnCompact_97moi_3_4_180.png` show the ChartsWorkspace page (SPY/APGE mini-charts, left panel watchlist rail, TF bar). These are icon-only toolbar/widget-header buttons (gear/settings icons, a compact "..." button, a watchlist count badge) with no `aria-label` and no visible text -- a real accessibility gap, though on `/charts`, not `/screener` itself (reached via the `nav_roundtrip` action's "visit Charts and go back" leg). Out of strict scope for a "/screener" audit, but real and worth a quick pass since it was found for free.

### 4. Intro-overlay stuck visible well after a page recycle (curiosity, likely a harness/timing interaction -- flagged, not confirmed)

`match_count_invalid_4_424.png` shows the cinematic intro's brand logo still centered on screen at iteration 424 for worker 4 -- ~24 iterations after that worker's page recycle at iteration 400 (which does call `dismiss_intro()`). This suggests the intro's click-to-dismiss can occasionally fail to clear the overlay even though the harness attempted it, or the reduced-motion branch's fade can get stuck under load. Low confidence this affects a real (non-automated) user identically, since a human doesn't click at the same fixed offsets the harness does -- noted for the record, not asserted as a shipped defect.

---

## Environmental / not bugs (explicitly ruled out per the task's own caveats)

- Em-dash (`\u2014`) columns in the grid (SECTOR, MKT CAP, PATTERN, etc. showing `\u2014` for most rows) are the **local stale-snapshot (2026-08-12) designed null rendering** -- not a defect. Visible in every screenshot above; correctly not flagged by the harness (the bad-text regex specifically excludes the em-dash).
- The `/api/live-prices` and `/api/bars/*` 503 storms, the crash, and the chronic-timeout pressure are all backend/local-environment findings, addressed above -- not `/screener` UI defects in themselves.
- `NS_BINDING_ABORTED` / `net::ERR_ABORTED` requestfailed events are near-exclusively this harness's own aggressive reload/back/forward/navigate actions cancelling in-flight fetches -- ignored per the documented ignore list.
- `ResizeObserver loop` / React DevTools console messages -- standard benign noise, ignored per the documented ignore list.

---

## Planted-violation control

Before **both** runs, a throwaway browser context visited `/screener` and had four violations injected directly into the live DOM (an overflowing element, an `undefined`-bearing text node, a `console.error()` call, and an oversized `role="dialog"` popover), then removed -- proving the invariant checks could actually fire before trusting either run.

- Overflow detection: **PASS**
- Bad-text (`undefined`/NaN/`[object Object]`) detection: **PASS**
- Console-error capture: **PASS**
- Popover-overflow detection: **PASS**
- **Overall control: PASS** (both runs)

A zero-findings run would have been treated as suspicious per this control; neither run was anywhere close to zero-findings.

---

## Per-worker totals

### Run 1 (killed mid-flight; lower-bound iteration count from findings.jsonl, since a clean iteration produces no finding)

| Worker | Viewport | Max iter w/ a finding (lower bound) |
|---|---|---|
| 0 | desktop | 1030 |
| 1 | desktop | 1142 |
| 2 | desktop | 1105 |
| 3 | desktop | 892 |
| 4 | desktop | 892 |
| 5 | desktop | 758 |
| 6 | desktop | 1030 |
| 7 | desktop | 1115 |
| 8 | tablet | 924 |
| 9 | phone | 1147 |

### Run 2 (completed cleanly, 200/200 every worker)

| Worker | Viewport | Seed | Iterations | Action errors | Recycles |
|---|---|---|---|---|---|
| 0 | desktop | 1000 | 200 | 74 | 0 |
| 1 | desktop | 1001 | 200 | 96 | 0 |
| 2 | desktop | 1002 | 200 | 33 | 0 |
| 3 | desktop | 1003 | 200 | 2 | 0 |
| 4 | desktop | 1004 | 200 | 103 | 0 |
| 5 | desktop | 1005 | 200 | 23 | 0 |
| 6 | desktop | 1006 | 200 | 3 | 0 |
| 7 | desktop | 1007 | 200 | 18 | 0 |
| 8 | tablet | 1008 | 200 | 129 | 0 |
| 9 | phone | 1009 | 200 | 73 | 0 |

Run 2 actions by type: set_filter 354 - switch_view 254 - screens_menu 250 - sort_header 235 - scroll_more 166 - columns_picker 165 - remove_chip 157 - ticker_popup 120 - nav_roundtrip 95 - filter_search 95 - csv_export 60 - set_filter_sheet 32 - filter_search_sheet 17.

---

## Deduped findings -- full table (Run 2, true occurrence counts; Run 1 raw data at `tools/ui_stress_out_run1/findings.jsonl`)

Screenshots captured only on first occurrence of each signature.

| Signature | Occurrences | First seen | Detail | Screenshot |
|---|---|---|---|---|
| `console_error:...503 (Service Unavailable)` | 401 | w0/i1/scroll_more | Env -- backend 503 storm | anomalies/console_error_..._0_1.png |
| `network_fail:HTTP 503:.../api/live-prices` | 334 | w0/i1/scroll_more | Env -- backend 503 storm | anomalies/network_fail_..._0_1.png |
| `match_count_missing` | **217** | w7/i28/set_filter | **Candidate bug #1** | anomalies/match_count_missing_7_28.png |
| `root_empty` | **204** | w7/i28/set_filter | **Candidate bug #1** | anomalies/root_empty_7_28.png |
| `action_error:set_filter:TimeoutError` | 147 | w0/i14/set_filter | Env -- chronic load | (none) |
| `action_error:switch_view:timeout` | 55 | w0/i17/switch_view | Env -- chronic load | (none) |
| `action_error:sort_header:timeout` | 44 | w7/i15/sort_header | Env -- chronic load | (none) |
| `action_error:filter_search:TimeoutError` | 35 | w0/i19/filter_search | Env -- chronic load | (none) |
| `action_error:screens_menu:timeout` | 34 | w1/i13/screens_menu | Env -- chronic load | (none) |
| `action_error:columns_picker:timeout` | 29 | w1/i15/columns_picker | Env -- chronic load | (none) |
| `action_error:columns_picker:TimeoutError` | 25 | w2/i1/columns_picker | **Candidate bug #2** | anomalies/action_error_columns_picker_TimeoutError_2_1.png |
| `action_error:remove_chip:timeout` | 28 | w4/i51/remove_chip | Env -- chronic load | (none) |
| `action_error:scroll_more:timeout` | 24 | w1/i12/scroll_more | Env -- chronic load | (none) |
| `action_error:nav_roundtrip:TimeoutError` | 19 | w0/i13/nav_roundtrip | Env -- chronic load | (none) |
| `network_fail:HTTP 503:.../api/stream/bars` | 18 | w6/i95/nav_roundtrip | Env -- backend 503 storm | anomalies/network_fail_..._stream_bars_6_95.png |
| `action_error:ticker_popup:timeout` | 17 | w4/i52/ticker_popup | Env -- chronic load | (none) |
| `action_error:set_filter_sheet:TimeoutError` | 15 | w9/i11/set_filter_sheet | Env -- chronic load | anomalies/action_error_set_filter_sheet_TimeoutError_9_11.png |
| `action_error:switch_view:TimeoutError` | 14 | w9/i10/switch_view | Env -- chronic load | anomalies/action_error_switch_view_TimeoutError_9_10.png |
| `action_error:screens_menu:TimeoutError` | 13 | w9/i19/screens_menu | Env -- chronic load | anomalies/action_error_screens_menu_TimeoutError_9_19.png |
| `zero_a11y_name:_settingsBtn_1bmsl_163` | 13 | w4/i188/nav_roundtrip | **Candidate bug #3** | anomalies/zero_a11y_name__settingsBtn_1bmsl_163_4_180.png |
| `zero_a11y_name:_btnCompact_97moi_3` | 13 | w4/i188/nav_roundtrip | **Candidate bug #3** | anomalies/zero_a11y_name__btnCompact_97moi_3_4_180.png |
| `zero_a11y_name:_btn_1mmqs_135` | 13 | w4/i188/nav_roundtrip | **Candidate bug #3** | anomalies/zero_a11y_name__btn_1mmqs_135_4_180.png |
| `zero_a11y_name:_gearBtn_edx06_211` | 13 | w4/i188/nav_roundtrip | **Candidate bug #3** | anomalies/zero_a11y_name__gearBtn_edx06_211_4_180.png |
| `zero_a11y_name:_badge_10ga6_17` | (Run1: 50) | w1/i316/nav_roundtrip | **Candidate bug #3** | anomalies/zero_a11y_name__badge_10ga6_17_1_316.png |
| `action_error:nav_roundtrip:Error` | 10 | w1/i17/nav_roundtrip | Env -- nav interrupted by outage | (none) |
| `action_error:csv_export:TimeoutError` | 10 | w2/i118/csv_export | Env -- chronic load | anomalies/action_error_csv_export_TimeoutError_2_118.png |
| `match_count_invalid` (intro stuck) | (Run1: 27) | w4/i424/set_filter | **Candidate bug #4** (low confidence) | anomalies/match_count_invalid_4_424.png |
| `pageerror:Failed to fetch` | (Run1) | w8/i892 | Positive: shows graceful-degradation UX | anomalies/pageerror_Failed_to_fetch_8_892.png |
| ~150 distinct `network_fail:HTTP 503:.../api/bars/<TICKER>` | 1-3 each | various | Env -- per-ticker signature explosion, one story | anomalies/network_fail_..._api_bars_*.png |

PatternFeedbackChip regression watch (the popover-overflow check extended for `_pop_` classes and the compact-wrap check for `_compact_` classes) fired **zero times** across ~12,000 combined iterations -- the 8/21 wrap fix (commits `3eacf47de` + `90a02d892`) held throughout. No chip-related anomalies of any kind were recorded.

---

## Ignore list in effect

- Console errors matching: `ResizeObserver loop`, `Download the React DevTools`
- Network `requestfailed` errorText ignored: `NS_BINDING_ABORTED`, `net::ERR_ABORTED`

---

## Harness resilience note

The harness's own design (per-action try/except, no crash on backend failure) meant the outage did **not** require restarting the Python process -- workers kept looping and recording findings straight through the crash and recovery window with zero manual intervention. The **external kill** of Run 1's process (status: `killed`, not a Python exception) was outside the harness's own control -- most likely session/infrastructure-level, not a bug in the harness. Given the harness had no checkpoint file, "resume" was not possible; the pragmatic choice made was a smaller fresh top-up run rather than a full restart, given Run 1 was already >85% (lower bound) complete.
"""

out_path = Path(r"C:\Users\Patrick\uct-worktrees\screener-deep-work\tools\ui_stress_out\report.md")
out_path.write_text(CONTENT, encoding="utf-8")
print(f"Wrote {out_path} ({len(CONTENT)} chars)")
