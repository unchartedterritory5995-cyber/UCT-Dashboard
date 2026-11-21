# UCT RS Phase 2a/2b review — branch feat/uct-rs-phase2a

Reviewed head: cb97c86931 (worktree C:\Users\pgosz\uct-worktrees\rs-phase2a), 2026-11-06.
Input: 40 confirmed findings (4 pairs were duplicates and are merged below, giving 36 entries) and 1 dropped finding. Severities are the skeptic's, not the first reviewer's.

## 1. Verdict

**Do not merge this branch to main yet. With every RS flag at 0 it is not dark.** Push it to its own remote branch or draft PR as much as you like. A merge, though, deploys to Railway, and four things reach members or the web pod with every flag at its default:

1. **RS alerts are live and carry a critical bug.** `register_rs_series()` runs at import, and neither the catalog nor the create door checks any flag (#2). So members can arm all 12 RS addresses. Those alerts run through the cycle-wide `rs_pass` memo, which leaves the symbol out of its key (#1). Two tickers with the same window and the same last close then share one RS column set. The result is false or missed "RS new high" and cross alerts, and the notification prints the other stock's ratio. `rs_line.rating` also arms and then never fires, because `rs_rating_history` does not exist.
2. **The `bars_rs` build step has no gate** (#5). It adds roughly 10 minutes of pure-Python, GIL-holding CPU to every screener build on the web pod. That covers the 03:00 build, the admin refresh and the boot self-warm, which runs during market hours.
3. **The seven RS starters ship with no gate, filed under "Momentum leaders"** (#12).
4. **The rating columns and their "Over 80 / Over 90" presets are visible while RS_HISTORY_ENABLED is off** (#14). Members see a column of dashes in Momentum and a filter that returns 0 rows.

Minimum work before the merge: Unit 1 (memo key, catalog and create-door gates), the `bars_rs` gate in Unit 3, and Unit 6 (starter grouping, plus putting the RS starters, the RS view and the rating presets behind the same flags as the data that fills them). Once `bars_rs` is gated, the ten bars_rs columns are NULL while dark, so the starters and the Relative Strength view must sit behind the same gate. If they don't, they become "a screen that found nothing". Everything else on the branch is dark behind its flag or is copy on a surface that only renders under RS_V2_ENABLED.

What must be fixed before each flag is armed (arm order per docs/feature_flags.json: V2, HISTORY, EVIDENCE, DISCORD):

| Flag | Must be fixed first |
|---|---|
| RS_V2_ENABLED (web) | #1, #10, #17, #28, #29, #36 (Unit 1). #10 and #5 kernel cost (Unit 2). #8, #13, #19, #24 provider side (Unit 5). #9, #21, #35 card copy (Unit 7). #11 dot size control, #27 (Unit 8). Turning V2 on also opens the RS alert catalog (after the Unit 1 gate) and the `bars_rs` step, so measure the step on the pod and record the figure in the build receipt before arming. |
| RS_HISTORY_ENABLED (web) | #4 split guard, #20, #30, #31 (Unit 3). #16 rating cache key (Unit 5). The rating alert gate in #2 (Unit 1). Rating columns and presets come back on this flag, and #33 copy (Unit 6). #23 fast-rating copy (Unit 7). |
| RS_EVIDENCE_ENABLED (worker) | #3 interrupted run (Unit 4). It must land before the first scheduled night, because one killed run orphans sessions permanently. #6 baseline and effective-N floor, #7 weekly horizon, and #22 below-floor sentence (Unit 5). #22 literature line (Unit 7). |
| RS_DISCORD_POST_ENABLED (web) | #32 marker receipt (Unit 9). The #6 display-floor fix also governs the Discord evidence line, because `_rs_evidence_for` filters on `displayable`. |

Not blocking: #25 (v3 client surfaces inert while dark). Phase 1 already had this gap, and it closes the moment RS_V2_ENABLED arms. Fix it only if the dark window will last weeks.

## 2. Confirmed findings, ranked

Severity scale: critical = wrong answer delivered to a member as fact; major = wrong or missing member-facing number, published-data corruption, or an ungated production cost; minor = bounded, labelled, cosmetic or operator-only.

### #1 — critical — RS pass memo key leaves out the symbol, so one ticker's RS columns are served to another
- ids: math-01, alerts-memo-key-collides-across-symbols (merged)
- file: api/services/alert_rs_series.py:397 (`_fingerprint` 397-403; key built at `RsPass.columns` :492)
- scenario: `_run_one_cycle` opens one `rs_pass()` for the whole cycle (indicator_alert_evaluator.py:2815). The memo key is `(family, fp(bars), fp(bench), inputs_key)`, where fp is `(len, first t, last t, last c)`. Neither symbol nor tf is in it. Two D groups with the same alert params get windows of the same size and the same dates from `group_bars`, and the SPY slice has the same fingerprint for both. If their last closes match to the cent, the second ticker reads the first one's rs_line, MA, new-high and Mansfield columns. That causes false or missed new-high and cross alerts, and the notification prints the other stock's ratio. After the close the prices stay fixed, so a collision repeats every 60 s until the next open.
- fix: Pass `sym` and `code` from `_rs_column.fn` into `build_rs_series`/`RsPass.columns`. Key on `(family, sym.upper(), tf, fp(bars), fp(bench), inputs_key)`. Optionally also fingerprint the full `(t, c)` sequence as a second guard.
- skeptic's evidence: Reproduced twice. In scratchpad skeptic_fp.py, B's rs_line tail inside a shared pass was [0.241332, 0.241795, 0.242742], which is A's exact tail. B alone gives [0.244246, 0.243737, 0.242742]. In scratchpad rsreview/collide2.py, BBB's `rs_line.value[-2]` came back as 0.726515 (AAA's value) against 0.754443 when computed alone. The shared-pass column equals AAA's column exactly.

### #2 — major — All 12 RS alert addresses are offered and armed with RS_V2_ENABLED off; the rating arms with RS_HISTORY_ENABLED off and can never fire
- id: alerts-rs-catalog-not-dark
- file: api/services/indicator_alert_evaluator.py:416
- scenario: `register_rs_series()` runs at import. ADDRESS_PARTITIONS (516-519) feeds `all_addresses()`/`alert_catalog()` (1182) with no flag check. The create door (indicator_alert_service.py:1666-1678) checks only the timeframe. A member with the v1 RS line sees the "UCT Relative Strength" alert group and can arm alerts on series their chart does not draw. `rs_line.rating` reads a table that does not exist, so its column is None on every bar. `diagnose` (indicator_alert_service.py:1160-1175) does not treat that as a fault, so the silence sweep never surfaces it. This is also what makes #1 live on merge.
- fix: Gate RS_ADDRESSES in `alert_catalog` and in `refusal_for` (which returns a sentence) on `registry_defs.RS_V2_ENABLED`. Gate `rs_line.rating` additionally on `api.main.rs_history_enabled()` (or on the table existing with a recent session). Leave registration unconditional so stored rows still resolve.
- skeptic's evidence: grep finds RS_V2_ENABLED read only at signature.py:948 and in registry_defs.py, and no RS_HISTORY check anywhere in the alert service, router or evaluator. Map §2.6 asks the alert lane to consult `registry_defs.RS_V2_ENABLED`, and that was not done.

### #3 — major — An interrupted evidence run deletes open-session checkpoints for good; partial rows stay in the published numbers
- id: production-evidence-interrupted-run-drops-open-sessions
- file: api/services/rs_evidence/job.py:382
- scenario: `S.clear()` (store.py:140-147) deletes the rows and checkpoints of every wanted pair and commits at once. Those pairs include up to ~126 still-open sessions, which are requested only through their OPEN checkpoint (job.py:182). Rows are committed every 50 tickers (390-391). Checkpoints are written only after the whole loop (398-404). A 2 h timeout (worker_main.py:449), a worker redeploy, or RS_EVIDENCE_RUN_ON_BOOT followed by a deploy leaves partial rows with no checkpoint. Nightly `--sessions 5` never requests those sessions again. The artifact is built from S.summary over all rows, so members' evidence cards show n, hit rate and median from a biased, frozen subset. The reviewer's repro on this branch (60 tickers, night 2 killed at ticker 56) produced 2,350 orphan rows over 47 sessions, and the artifact read sessions=52 with sessions_open=5.
- fix: Keep the old checkpoints in place while measuring. Write the new rows, then swap the checkpoints and delete the stale rows in one transaction at the end. As belt and braces, have `plan_sessions` also request every session that has rows but no checkpoint. Add a test that kills a run midway and then runs a normal night.
- skeptic's evidence: Confirmed on the code path at every cited line. The job docstring (job.py:21-22) says un-checkpointed pairs are re-measured, but that only holds for sessions that are requested again. The test was not re-run because no test environment is installed.

### #4 — major — The +/-60% one-bar split guard removes real big-gap leaders from the IBD-style rating for ~270 sessions
- id: math-02
- file: api/services/screener/rs_history.py:169 (`split_suspect` 169-177, SPLIT_GUARD_PCT=60 at :105, skip at compute_ratings :280)
- scenario: Any one-bar close ratio outside 0.4 to 1.6 anywhere in the 270-close READ_BARS window drops the ticker: ibd, m1-m12, d5 and d20 all come back NULL with reason `unadjusted_split`. A real +65% earnings or FDA gap, or a -60% crash, removes the stock for about 270 sessions, even after the gap leaves the 253 closes the score reads. These are the names that "RS 90+" screens and the chart's rating chip exist to show. The reviewer's repro: a 0.3%/day riser with one +65% day returned bars=0, unadjusted_split, against a true score that ranks near 99.
- fix: Use `bars_sanitize.unadjusted_splits` against the declared split list, as map §2.2 (line 72) specifies. At minimum, check only the last 253 closes and only split-sized ratios (within tolerance of 2, 3, 1/2, 1/3 and so on).
- skeptic's evidence: Nothing in the module checks for split-sized ratios or reads a declared split list. The value goes missing rather than wrong, so the severity is major, not critical.

### #5 — major — The `bars_rs` build step runs ungated on every screener build, adding about 10 minutes of pure-Python CPU on the web pod
- ids: production-bars-rs-ungated-build-cost (major), screener-bars-rs-step-cpu-cost (minor) (merged at major: ungated and on the web process)
- file: api/services/screener/snapshot_builder.py:556; cost in api/services/screener/rs_columns.py:224 and api/services/relative_strength.py:143-175
- scenario: The only gate on `_step('bars_rs', rs_columns.collect_one(...))` is `if spy_bars:`. About 11,230 rows are rebuilt each build. The build runs in the BackgroundScheduler thread of the single uvicorn process (main.py:2001, ~2430+), so it competes for the GIL. The 44-minute 03:00 build becomes about 54 minutes. The 500-ticker boot warm adds ~28 s of CPU after every deploy during market hours.
- fix: Gate the step (RS_V2_ENABLED, or a dedicated build flag) so a dark pod pays nothing. Unit 2 cuts the per-ticker cost: make `rolling_extreme_event` O(n), compute the RS line once and reuse it for phase1, Mansfield and agreement, and trim the benchmarks to the window. Measure the step on the pod and write the figure into the build receipt.
- skeptic's evidence: The two skeptics measured different per-ticker times: 56.7 ms (venv python, plain run) and ~515 ms (a cProfile-wrapped run). Treat ~55-75 ms as the real figure and re-measure on the pod. Both profiles agree that the hotspot is `rolling_extreme_event`'s O(n x 252) `any(_is_num)` scan (3 calls per ticker, 147k `_is_num` calls). Benchmark time-map builds are a small share (~0.3 of 5 s profiled), so clipping the benchmarks alone does not fix the cost. Mitigation: the 03:00 build has 2+ h of headroom before the 06:00 watchdog, and the rs_history job does not depend on it.

### #6 — major — The measured evidence sentence prints a hit rate with no baseline, and its display floor is checked on raw, overlapping n
- id: copy-hit-rate-without-baseline
- file: api/services/rs_evidence_pull.py:324 (`sentence_for` 318-330; `evidence_for` displayable 271-277)
- scenario: "58.3% closed higher than SPY 63 bars later" prints without the all-bars baseline, although `payload.evidence.baseline` is sent beside it. If the baseline is 56%, the real lift is about 2 points. `displayable` is `n >= display_floor_n` on raw event bars. Red-day highs fall on roughly 40 red sessions a year across the whole universe, so raw n clears 100 while effective N cannot. The research base says to suppress below an effective N of 100 ("5,000 events on 40 dates is 40 observations").
- fix: Add the baseline to the sentence ("... against 56.0% for all bars"). Check the floor on the artifact's distinct `dates` count (measure.py already computes it) or on a de-overlapped n, and say "events on N sessions".
- skeptic's evidence: measure.py's own header says the baseline exists "so a hit rate reads as lift, not as a number on its own", and research 03-evidence.md:107/114 sets the effective-N rule.

### #7 — major — The daily evidence sentence ("63 bars later", "21-bar average") prints unchanged on weekly charts
- id: copy-evidence-daily-horizon-on-weekly
- file: api/routers/signature.py:1039
- scenario: `_rs_evidence()` goes into the payload for W too. The artifact is measured on daily bars (rs_evidence/job.py:100). On a weekly chart a bar is a week, so the member reads a 63-week horizon and a 21-week average for a statistic measured over 63 sessions and a 21-day EMA, about five times shorter.
- fix: Have `sentence_for` say sessions ("63 sessions (about 3 months) later", "its 21-day average", "on daily bars"), or send the measured sentence only when store == 'D'.
- skeptic's evidence: signature.py:1039 builds evidence for every store. job.py:100 reads `get_bars_before(ticker, 'D', ...)`, and SIGNAL_LABELS says "21-bar average".

### #8 — major — The green-on-red readout says "of the last 20 red days" when it counts the last 20 sessions
- ids: copy-green-on-red-denominator (major), math-04 (minor) (merged at major)
- file: api/routers/signature.py:1491 (1485-1492)
- scenario: `rolling_count(gor, 20)` counts up-on-red days inside 20 sessions, but the reason string reads "up on 3 of the last 20 red days". With 4 red days in the window, the true 3-of-4 reads as a weak 3-of-20. The Checks card (nativeRegistry.js:4132) and the screener column `green_on_red_20` describe the same count correctly, so the surfaces contradict each other.
- fix: f"up on {k} of {red_days} red days in the last {_RS_GREEN_ON_RED_WINDOW} sessions" (count the red days in the same window).
- skeptic's evidence: The reason prints verbatim through `scalar:checks.greenOnRed.reason` (nativeRegistry.js:4139), and the docstring at signature.py:1420 says sessions.

### #9 — major — The Mansfield card says "(200 bars daily, 52 weekly)", but weekly charts compute 200 weekly bars unless Trend weekly is applied
- id: copy-mansfield-card-length
- file: app/src/components/chart/engine/nativeRegistry.js:4115
- scenario: `mansfieldLength` defaults to 200 on every timeframe (nativeRegistry.js:3971), and only `trendWeekly` (3921) sets 52. `_rs_mansfield_scalars` is computed before the toggle blanks the column (signature.py:954/969), so a Classic weekly chart with the line off still shows a "Mansfield +x%" row that is a 200-week (about 4-year) reading, while the card says 52. Intraday rows are 200-intraday-bar readings under a card that says daily. The screener copy calls 200 sessions "its own past year" (methodology.py:385, columnDefs.js:585), which is about 9.5 months.
- fix: Print the length actually used (`payload.mansfield.length` is already sent) in the card text or as its own row. Reword the card: "measured over the Mansfield length set; 200 on daily, 52 is Weinstein's weekly". Replace "past year" with "its 200-session average" (that part is in Unit 6). Changing the W default is out of scope here.
- skeptic's evidence: The cited lines confirmed. The comment at signature.py:967 says the scalars are computed before the toggle.

### #10 — major — Every RS-alerted symbol recomputes ~70-85 ms of pure-Python RS every 60 s on the web pod
- id: alerts-rs-compute-every-cycle-on-web-pod
- file: api/services/alert_rs_series.py:568 (closed-window call at indicator_alert_evaluator.py:1916; kernel relative_strength.py:162-175)
- scenario: `rs_pass()` is cycle-scoped and no cache lasts across cycles. The full window, including the forming bar, is passed in. `compute_phase1_columns` runs `rolling_extreme_event` three times at O(n x lookback). The evaluator is a daemon thread in the web process (main.py:4740), so 300 RS-alerted symbols means about 25 s of GIL-held CPU every minute, all session and all night. Yet the D/W answer at `closed_bar_index` does not change during the session.
- fix: Compute on `bars[:i+1]` (the closed window). Add a cross-cycle cache in alert_rs_series.py keyed on `(sym, tf, closed bar t, benchmark closed t, inputs)`, which inherits the #1 fix. Make `rolling_extreme_event` O(n) with a monotonic deque (Unit 2).
- skeptic's evidence: Timed in scratchpad rsreview/timing2.py: 84 ms per `compute_phase1_columns` on 652 bars, against 6.9 ms for Mansfield. cProfile puts ~96% of it in `rolling_extreme_event`. Correction to the original reasoning: the recompute happens because the pass is cycle-scoped, not only because the forming bar's close changes.

### #11 — major — The Dot size control writes only the whole-indicator size, but the per-dot sizes that Stress and Trend store take priority and nothing clears them
- id: frontend-dot-size-control-outranked-by-preset-per-output-size
- file: app/src/components/chart/IndicatorSettingsDialog.jsx:625 (setter :309-310; Chart Settings row ChartSettingsIndicators.jsx:2786/2789; agent op agentMutations.js:953; `setInstanceDotSize` instanceControls.js:1251-1253; precedence presentation.js:363-370)
- scenario: Stress stores `plots.dotNHbeforePx.dotSize='large'`. The select reads the instance level and shows Default while the gold dot draws Large. Picking Small or Default changes nothing on screen. Stress followed by Trend leaves a per-dot 'small', so Default then leaves the gold dot at x0.6 forever. No member control or preset ever deletes the per-dot entry.
- fix: When the instance-level control writes a word (dialog, Chart Settings row, agent op with no plotKey), also delete every per-dot entry, the same way `applyPresetFields` does for a word preset. Do this in `setInstanceDotSize` so all three callers inherit it. Alternatively, show "Mixed" when the per-dot sizes differ from the instance size.
- skeptic's evidence: Traced through nativeRegistry.js:3931, instanceControls.js:812-825, presentation.js:456/481, and IndicatorSettingsDialog.presets.test.jsx, which pins `{plots:{dotNHbeforePx:{dotSize:'large'}}}`. The agent op with an explicit plotKey can reach the entry, so the agent half of the finding applies to the no-plotKey form only.

### #12 — major — All seven RS starters land under "Momentum leaders"
- id: screener-rs-starters-misgrouped
- file: app/src/pages/screener/focus/screenGroups.js:36
- scenario: `RS_STARTER_GROUP = "Relative strength"` (saved_screens.py:513) is not a GROUPS label or key, so `groupOf` falls back to 'momentum'. ScreenMenu.jsx:77 builds sections only from GROUPS, so there is no Relative strength heading. The starters are joined to `_starter_defs()` with no gate (saved_screens.py:853).
- fix: Add `{key: 'relative_strength', label: 'Relative strength'}` to GROUPS. Add a test that every starter group label resolves to its own key and not the fallback. Put the RS starters behind the same gate as the `bars_rs` step (see the Verdict).
- skeptic's evidence: The node check returned `groupOf({id:'starter_rs_new_high', group:'Relative strength'}) === 'momentum'`. screenGroups.js is not in the diff.

### #13 — minor — The anchor check reports FAIL (+0.0% vs +0.0%) when the benchmark's 20-session low is today
- id: math-03
- file: api/routers/signature.py:1451 (1448-1456; counted at :1508)
- scenario: `min(window, ...)` picks today's bar during a selloff, which gives sr = br = 0.0, so `pass = False`. The summary then reads "1 of 4" instead of "1 of 3", on exactly the days the check is meant for.
- fix: When ago == 0, return `pass: None` with the reason "the benchmark's 20-session low is today", or anchor on the prior 20 sessions excluding today.
- skeptic's evidence: Nothing upstream catches ago == 0, and False (not None) is counted in `decided`.

### #14 — minor — The rating columns and the "Over 80 / Over 90" presets are visible while the job that fills them is dark
- id: screener-dark-rating-columns-member-visible
- file: api/services/screener/filters.py:741 (741-744; Momentum view :1081; RS view :1160-1161; meta :1690+)
- scenario: With RS_HISTORY_ENABLED off, all seven rating columns are NULL on every row. Members see a column of dashes in Momentum, and "Over 90" returns 0 rows. That is the failure closedTable.json:3671 names, and the reason the rating starters were held back (saved_screens.py:489-499).
- fix: Gate the seven rating filters, their presets and their view seats in `meta()` on `rs_history_enabled()`. Gate the bars_rs columns and the Relative Strength view on the same flag as the `bars_rs` step.
- skeptic's evidence: `meta()` hides nothing that is all-NULL, and the repo's own text records that these columns are NULL in production.

### #15 — minor — SPY/RSP bars are never settled or caught up, so the newest bar can mix a settled ticker close with an unsettled SPY close
- id: screener-benchmark-bars-not-settled
- file: api/services/screener/snapshot_builder.py:1504 (1504-1505; per-ticker settle ~1640-1660; note 1171-1177)
- scenario: A 15:58 `_delta_daily` SPY bar for session D skews the newest bar's ratio and can flip the red-day flag at the -0.5% threshold (-0.52% official vs -0.47% partial). A ticker caught up to D while SPY ends at D-1 gets OUTCOME_NO_BENCH and all ten columns NULL. RSP ending at D-1 nulls `rs_benchmark_agree`, so "Leaders vs equal-weight too" returns nothing.
- fix: Run `settled_bar_outcome` and `catchup_outcome` on spy_bars and rsp_bars before the per-ticker loop, and count the outcome in the receipt.
- skeptic's evidence: rs_columns.py:224-229 confirms the NULL path. The effect is limited to the newest bar or to NULLs.

### #16 — minor — The chart's day cache can pin the previous session's rating and evidence until 16:05 ET
- ids: math-06, production-rs-envelope-pins-stale-rating-evidence (merged)
- file: api/routers/signature.py:1021 (key 917-920, `_et_session_day` 1515-1517, TTL 1048/1063)
- scenario: The key turns over at ET midnight, and the TTL runs to the next 16:05 ET. The first open of a symbol between 00:00 and 04:15 ET (rs_history at 04:15, evidence pull at 04:30, main.py:2528/2545) caches session S-1's ibd/d5/d20 and the old artifact for every member until 16:05. Symbols first opened later show session S.
- fix: Put the newest rs_history session and the evidence artifact's asof (or a generation counter) in the cache key. Read them with a cheap PK-served `MAX(session)` inside signature.py, so rs_history.py does not change. Or cap the TTL at 04:30 ET for envelopes built before that hour.
- skeptic's evidence: The rating carries its own asof, so it is one session stale and labelled as such, not hidden.

### #17 — minor — An RS alert whose benchmark is the symbol itself, or has no stored bars, is accepted, never fires, and reads as warming up
- id: alerts-self-benchmark-never-fires
- file: api/services/alert_rs_series.py:607 (`[None]*n` at 617-618; `rs_refusal` 302-340; create door indicator_alert_service.py:1675; diagnose :1189)
- scenario: Examples are SPY on D with the default benchmark, QQQ vs QQQ, and an ETF on SECTOR (resolves to SPY). The create succeeds, every cycle skips, and `diagnose` says "not enough history", so the alert never reaches needs_attention.
- fix: At the create door, refuse when the resolved benchmark equals the symbol, with a sentence. In `_closed_value_for`/`diagnose`, resolve the benchmark and return `(True, '<bench> resolves to the symbol itself' | 'no stored bars for <bench>')`.
- skeptic's evidence: Lowered to minor because the chart provider also blanks a self-benchmark line (plan §6.10), and RSP is prewarmed.

### #18 — minor — RS new-high age can never exceed 147 (Mansfield cross age 199), so older events show blank in the screener while the chart shows them
- id: screener-rs-age-ceiling-400-window
- file: api/services/screener/rs_columns.py:88 (window comes from snapshot_builder.py build_row `bars[-400:]`, :559-562)
- scenario: rsNH starts at index 252, so 399 - 252 = 147 is the oldest high the screener can see. A filter of `RS NH Age >= 148` can never match. The column reads 147 one day and blank the next, while the deep-bar chart still draws the dot. This breaks the "scan, dot and alert read one answer" principle.
- fix: Pass `collect_one` a deeper window (at least LOOKBACK + the longest age to publish, e.g. 652 bars). Do this after the Unit 2 kernel lands so the cost stays flat.
- skeptic's evidence: `bars_ago_column` (relative_strength.py:516-540) is None before the first event, and columnDefs.js:577 and methodology.py:341-346 never state the ceiling.

### #19 — minor — The regime volatility tercile, and so the regime label, depends on the member's RS lookback input
- id: math-05
- file: api/routers/signature.py:1266 (count from `_rs_bars_count` :1540 via :907/:928; regime reads :1008)
- scenario: The benchmark is fetched at lookback + 600 bars, so the volatility distribution holds about 493 samples at lookback 20, 725 at 252 and 756 only near 500. The same SPY on the same day can flip between "rebound-risk" and "mixed" with an unrelated new-high setting.
- fix: Read the regime's benchmark at a fixed depth of at least `_RS_VOL_WINDOW + _RS_VOL_DIST_MAX + 1` (883) bars, independent of lookback.
- skeptic's evidence: The lookback clamp of 20..500 is at relative_strength.py:67, and the samples are taken as `[-757:-1]`.

### #20 — minor — Rating columns keep serving the newest stored session at any age
- id: screener-rs-rating-served-stale-forever
- file: api/services/screener/rs_history.py:776 (read_fields 776-791; mapped at snapshot_builder.py:1020-1062)
- scenario: The flag is armed, then rolled back with the table left behind. Every build then writes frozen ratings and frozen chg_5/chg_20 deltas, and the pane shows "RS rating N of 99, up X in a week" with no as-of date. A crashing job does raise a chart_health_alerts warning (main.py:2180-2227), so the silent case is the rollback.
- fix: In `_read_rs_history_fields`, map nothing (the columns go NULL) when the served session is more than STALE_DAYS behind the build's settled session. Keep the stale count in the receipt, and add a test that seeds an old session.
- skeptic's evidence: Serving stale data with a count is the house pattern (dividend_join.py:371, earnings_dates.py:362). The silent case needs a specific operator sequence.

### #21 — minor — The Checks card's "six in twenty is unusual, one is noise" is unmeasured and conflicts with the 3+ screener starter
- id: copy-checks-threshold-claim
- file: app/src/components/chart/engine/nativeRegistry.js:4134 (threshold signature.py:1088; starter saved_screens.py:546-550)
- scenario: The chart check passes only at 6 (`_RS_GREEN_ON_RED_PASS`), and its comment cites a starter "Up on down days (6 of 20)" that does not exist. The real starter is 3+. A stock up on 4 of 20 is featured by the starter and marked failed on the chart.
- fix: Drop the unusual/noise sentence. Say on the card that 6 is UCT's threshold, and fix the signature.py comment. The 3+ starter stays as a looser scan.
- skeptic's evidence: The same card line says nothing is measured.

### #22 — minor — The Bulkowski line can never show on the Before-price card, and "UCT has not measured one yet" prints after UCT measured
- id: copy-evidence-fallbacks
- file: app/src/components/chart/engine/nativeRegistry.js:4104 (readoutSchema.js:302-304 `cardEvidenceText`; rs_evidence_pull.py:321; methodology.py:512)
- scenario: A V2 envelope always carries a string in `sentence.beforePrice` (honesty or measured), so `cardEvidenceText` never reaches the static Bulkowski line, even though methodology points members to it. Below the floor, the sentence still says "has not measured one yet".
- fix: Unit 7 makes `cardEvidenceText` always print the card's static literature line and then the server sentence. Unit 5 changes the below-floor sentence to "UCT measured N events on M sessions, too few to print a hit rate (floor 100)."
- skeptic's evidence: `_empty()` and the artifact path both always set a string for every key.

### #23 — minor — The fast rating card says "read hourly ... moves during the session", but the chart shows a nightly snapshot
- id: copy-fast-rating-not-hourly
- file: app/src/components/chart/engine/nativeRegistry.js:4083
- scenario: `rating.fast` is the `fast` column written once at 04:15 ET from `rs_ranking.cached_rank_map()` (rs_history.py:415-448). "Can differ by a few points" understates the gap: the formulas differ on purpose (rs_history.py:15-18). "200 days" means calendar days, about 138 sessions.
- fix: Reword: "UCT fast rating, 1 to 99, as captured by the nightly job (the screener's hourly RS Rank): 3-month, 6-month, 1-month and 1-week returns over about 138 sessions. A different formula from the IBD-style rating, so the two can differ widely."
- skeptic's evidence: The value is correct, and it has its own "Rated as of" row.

### #24 — minor — Regime and Checks rows say "needs more history" on weekly, intraday and same-symbol charts
- id: copy-regime-checks-false-fallback
- file: app/src/components/chart/engine/nativeRegistry.js:4121 (provider signature.py:1002-1006; fallback readoutSchema.js:228)
- scenario: A non-D store sends label/summary None with the reason "daily bars only", so AAPL weekly with 20 years of bars reads "Regime: needs more history", and the regimeNote row beneath it says "daily bars only".
- fix: On the provider side (Unit 5), put the reason in `regime.label`/`checks.summary` when it cannot compute ("daily charts only", "benchmark is the symbol"), so the declared fallback never shows for a known reason.
- skeptic's evidence: The true reason is printed on the same readout, so two lines contradict each other but no number is wrong.

### #25 — minor — With RS_V2_ENABLED off, the v3 presets, toggles and description are visible but do nothing or degrade the line
- id: frontend-v3-client-surfaces-not-dark-when-flag-off
- file: app/src/components/chart/engine/nativeRegistry.js:3915 (registered :4158; `revMismatch` serverCompute.js:187 has no caller)
- scenario: Trend recolours the line grey and hides it intraday with no Mansfield line. Stress turns on red-day dots that never arrive. Toggles are inert, and each flip refetches the same cached v1 envelope. Spec §215 ("hide new plots when rev is 1") is not implemented.
- fix: In the dialog and phone sheet, hide the v3-only presets and inputs when the landed envelope's rev is below the definition's rev (wire up `revMismatch`).
- skeptic's evidence: Phase 1 already ships the same gap (engineering map line 201), and arming V2 closes it. Not blocking.

### #26 — minor — Choosing Classic after Trend or Stress keeps daily-and-up visibility and the dot sizes, while the picker says "Classic"
- id: frontend-classic-reads-back-while-carrying-stress-visibility
- file: app/src/components/chart/engine/instanceControls.js:852 (`presetFieldsMatch` :847; Classic declared at nativeRegistry.js:3906)
- scenario: After Stress then Classic, the pane is hidden on every intraday chart and the gold dot draws Large, while the picker reads "Classic (O'Neil)".
- fix: Give Classic, Classic weekly and Phase explicit `visibility: 'all'` and the default dot-size word, so applying them undoes Trend/Stress (the word preset clears per-dot entries). Update the pinned assertion in IndicatorSettingsDialog.presets.test.jsx (the "back to Classic: ... the fields stay" case).
- skeptic's evidence: The behaviour is pinned as intended by that test, but nothing on screen shows it. Recoverable through Show on.

### #27 — minor — The phone sheet's preset detection reads inputs only and disagrees with the desktop dialog
- id: frontend-phone-sheet-preset-detection-ignores-fields
- file: app/src/pages/charts/mobile/MobileIndicatorSheet.jsx:344
- scenario: After Trend plus a Large dot on desktop, the dialog says Custom while the phone still highlights Trend and prints its origin line.
- fix: `detectPreset(presets, studyModel.values, { instance: studyInst, def: studyDef, cs })`, and update the header comment at :38-40.
- skeptic's evidence: The header comment admits the sheet "passes none and reads inputs alone".

### #28 — minor — The armed shadow cycle evaluates RS alerts outside any rs_pass
- id: alerts-shadow-cycle-no-rs-pass
- file: api/services/alert_shadow_log.py:359 (359-385)
- scenario: ALERT_SHADOW_ENABLED is armed on web. Each RS alert in the shadow cycle builds a fresh `RsPass` and pays its own ~84 ms compute, in the same process.
- fix: Wrap the group loop in `with alert_rs_series.rs_pass():`. After #1 and #10 land, it shares their keyed cache.
- skeptic's evidence: grep finds no rs_pass in the file. The benchmark read is cheaper than claimed (a 20 s TTL `_symbol_bars` cache).

### #29 — minor — /current-value always returns null for RS addresses, so the threshold box opens empty
- id: alerts-current-value-prefill-null
- file: api/routers/indicator_alerts.py:443
- scenario: `address_value` calls the column with no tf or sym, so RS columns answer `[None]*n` (alert_rs_series.py:604-607, 696-699). `rs_line.value`/`.ma` have no default threshold, so the member gets no hint of the ratio's scale (e.g. 0.0031).
- fix: Route `reads_benchmark` columns through `alert_user_series.call_series(fn, bars, parsed, tf=tf, sym=sym.upper())` inside `rs_pass()` and read at `closed_bar_index`, as `_closed_value_for` already does.
- skeptic's evidence: The router already does this for runtime user plots at :440. The rating has a default of 90.

### #30 — minor — Each uncached RS chart compute loads three full sessions of rs_rating_history to read one symbol
- id: production-read-fields-loads-whole-sessions-per-chart
- file: api/services/screener/rs_history.py:778 (776-783; caller signature.py:1148)
- scenario: About 11k rows become Python dicts per cold (symbol, inputs, toggles, day) compute in the /columns threadpool.
- fix: When `want` is small, add `AND ticker IN (...)` to the three per-session queries (served by idx_rsh_ticker). Keep the public signature and the full read for the builder's bulk call.
- skeptic's evidence: Bounded to tens of ms per cold compute.

### #31 — minor — snapshot-status creates the RS tables on a dark pod and runs a full-table COUNT DISTINCT
- id: production-snapshot-status-ddl-and-full-scan
- file: api/services/screener/rs_history.py:840 (status 833-848; last_run 490-495)
- scenario: `ensure_schema` runs CREATE TABLE/INDEX from a request thread, which contradicts the flag note "a dark pod carries no table". Once backfilled (~1M rows, growing ~1M a year), each call scans the whole table.
- fix: A read-only status: check sqlite_master instead of calling ensure_schema, and take rows, sessions and latest from the newest rs_history_runs receipt (or a PK-served MAX(session)).
- skeptic's evidence: No frontend or tool calls /api/screener/snapshot-status (only the route at api/routers/screener.py:408), so what remains is a documentation mismatch plus a scan on a manual diagnostic call.

### #32 — minor — The Discord receipt says marked=True when the session marker was not written
- id: production-discord-marked-true-when-marker-not-written
- file: api/services/rs_discord_post.py:616 (FileMarker.mark 153-171; receipt 614-616)
- scenario: With a full or read-only DATA_DIR, the post lands, no marker is written, and the receipt and status still report dedup in place.
- fix: Have `FileMarker.mark` return a bool, set `receipt['marked']` from it, and put the failure in the receipt reason. Keep an in-process record of the session so a same-process admin call cannot repost.
- skeptic's evidence: The retry pass will not double-post a landed post (main.py:2358-2390 return early on `posted`). A repeat needs a manual non-forced admin call, so this is a receipt-truth issue.

### #33 — minor — The "Rank 1M" description says 21 sessions is one of the rating's weighted windows
- id: math-07
- file: app/src/pages/screener/columnDefs.js:597
- scenario: IBD_TERMS weights 63/126/189/252 only (rs_weighted_return.py:65-70). The rs_rating_ibd description a few lines above contradicts it.
- fix: "A companion percentile of the 21-session return; the IBD-style rating does not weight it."
- skeptic's evidence: Confirmed against IBD_TERMS and IBD_COMPONENTS.

### #34 — minor — Screener copy states unmeasured frequency claims about before-price and red-day highs
- id: copy-unsupported-leader-claims
- file: app/src/pages/screener/columnDefs.js:573 (and methodology.py:328, :338)
- scenario: "Strength on a weak day is real demand more often than strength on a strong one" (methodology.py:338) is a comparative claim with no measurement, and the chart card says "never measured publicly". :573 and :328 paraphrase IBD's qualitative "often" and are caveated.
- fix: "IBD calls it more bullish, not a precondition; no published study measures how often it precedes a breakout." and "Strength on a weak day is what the UCT workshops watch for; it has not been measured publicly."
- skeptic's evidence: Copy only. No number or behaviour is affected.

### #35 — minor — The regime card says all fifteen worst momentum months came "during rebounds"; the source says 14 of 15
- id: copy-regime-overstated-crash-claim
- file: app/src/components/chart/engine/nativeRegistry.js:4124
- fix: "... all came after a negative two-year market return, fourteen of them in months the market rose (1932, 2001, 2009) ...". The research base §b table (03-evidence.md:130) carries the same slip and should be corrected by the owner.
- skeptic's evidence: 03-evidence.md:18 gives "14 of 15 in months the market rose".

### #36 — minor — Alert refusal sentences cite "plan §6.5" and a backticked table name
- id: copy-refusal-internal-refs
- file: api/services/alert_rs_series.py:205 (187-188, 204-206; surfaced via indicator_alerts.py:317-319)
- fix: "An RS new high or cross is a daily or weekly fact, and the chart blanks RS events intraday; arm it on D or W." and "The rating is computed nightly from daily closes, one per session, so a weekly bar has no rating of its own."
- skeptic's evidence: `timeframe_refusal` text is returned as the HTTP 400 detail, and the docstring calls it "the member sentence".

## 3. Fix plan (disjoint file sets, one worktree per unit)

Rules for every unit: touch only the files listed. Put new tests in new test files named after the unit (e.g. tests/test_rs_fix_u1_*.py, app/src/**/__tests__/rsFixU8*.test.jsx), and do not edit shared test files unless the unit lists them. Run vitest with --maxWorkers=2, scoped to the unit's directories. A cross-unit read (calling another module's existing public function) is allowed, but changing its signature is not.

| Unit | Gate | Findings | Files (exclusive) |
|---|---|---|---|
| U1 Alert lane | before merge (#1, #2); rest before V2 | #1, #2, #10 (closed window + cross-cycle cache), #17, #28, #29, #36 | api/services/alert_rs_series.py; api/services/indicator_alert_evaluator.py; api/services/indicator_alert_service.py; api/routers/indicator_alerts.py; api/services/alert_shadow_log.py |
| U2 RS kernel cost | before V2 | #10 (O(n) `rolling_extreme_event`), #5 (compute the RS line once, trim benchmarks to the window) | api/services/relative_strength.py; api/services/screener/rs_columns.py |
| U3 Screener build + rating store | `bars_rs` gate before merge; rest before HISTORY | #5 (gate + receipt timing), #4, #15, #18, #20, #30, #31 | api/services/screener/snapshot_builder.py; api/services/screener/rs_history.py |
| U4 Evidence job | before EVIDENCE | #3 | api/services/rs_evidence/job.py; api/services/rs_evidence/store.py |
| U5 Chart provider + evidence copy | before V2 (#8, #13, #19, #24); before HISTORY (#16); before EVIDENCE (#6, #7, #22 server half) | #6, #7, #8, #13, #16, #19, #21 (signature.py comment), #22 (below-floor sentence), #24 | api/routers/signature.py; api/services/rs_evidence_pull.py |
| U6 Screener surfaces | before merge (#12, #14, starter/view gate); rest before HISTORY | #12, #14, #9 ("past year" wording), #33, #34 | app/src/pages/screener/focus/screenGroups.js; api/services/screener/saved_screens.py; api/services/screener/filters.py; app/src/pages/screener/columnDefs.js; api/services/screener/methodology.py |
| U7 Chart card copy + presets | before V2 | #9 (card text, length row), #21 (card), #22 (literature line in `cardEvidenceText`), #23, #26, #35 | app/src/components/chart/engine/nativeRegistry.js; app/src/components/chart/engine/readoutSchema.js; app/src/components/chart/IndicatorSettingsDialog.presets.test.jsx (the Classic assertion only) |
| U8 Chart controls | before V2 (#11, #27); #25 optional | #11, #25, #27 | app/src/components/chart/engine/instanceControls.js; app/src/components/chart/engine/presentation.js (read-only unless needed); app/src/components/chart/IndicatorSettingsDialog.jsx; app/src/components/chart/ChartSettingsIndicators.jsx; app/src/components/chart/builder/agentMutations.js; app/src/pages/charts/mobile/MobileIndicatorSheet.jsx; app/src/components/chart/engine/serverCompute.js |
| U9 Discord receipt | before DISCORD | #32 | api/services/rs_discord_post.py |

Unit notes:
- **U1.** Key the pass memo and the new cross-cycle cache on `(family, sym.upper(), tf, ...)`. Add a regression test that runs the two-ticker equal-last-close case in one pass. The catalog and create-door gate reads `registry_defs.RS_V2_ENABLED`, and the rating gate reads `api.main.rs_history_enabled()`, both read-only. Leave registration unconditional.
- **U2.** Output must match the current implementation exactly. Add a parity test of old against new `rolling_extreme_event` and `collect_one` on random series with gaps. Record the per-ticker time before and after.
- **U3.** Gate `bars_rs` on `registry_defs.RS_V2_ENABLED`. The split guard uses `bars_sanitize.unadjusted_splits` (read-only). Deepen the window for #18 only after U2 merges, or stage it as a follow-up commit in this worktree. `read_fields` keeps its public signature, because U5 calls it.
- **U5.** Read the rs_history newest session for the cache key with its own PK-served query, so rs_history.py does not change. The `displayable` floor change also governs the Discord evidence line (main.py `_rs_evidence_for`), which is intended. main.py is not edited.
- **U6.** The seven RS starters, the Relative Strength view and the bars_rs filters follow RS_V2_ENABLED, the same gate as the `bars_rs` step. The seven rating columns, their presets and the Momentum seat follow `rs_history_enabled()`. Add a test that every starter group resolves to its own GROUPS key.
- **U7 and U8.** The presets test file belongs to U7. U8's new tests go in new files. U8 clears per-dot entries inside `setInstanceDotSize`, so the dialog and Chart Settings inherit it. The agent op's no-plotKey path in agentMutations.js must go through the same setter.

Suggested merge order: U1, U3 (gate only) and U6 first; that makes the branch dark and safe to merge. Then U2, then the rest of U3, U5, U7 and U8 before arming V2. U4 before EVIDENCE, U9 before DISCORD. Owner follow-up outside the repo: correct the research base 03-evidence.md:130 (14 of 15).

## 4. Dropped findings

- copy-discord-outcome-wording: unreachable. The only wired evidence_fn (main.py:2324 `_rs_evidence_for`) skips non-displayable signals and supplies its own label and outcome, so the template default at rs_discord_post.py:292 never reaches a real post.
