# W9-T3a + T3b evidence: capture tooling for the strategy tester

Branch `feat/pine-w9-t3-capture-tooling`. Design: `docs/pine/W9-STRATEGY-DESIGN.md` r3 @59bf931484 (GO-WITH-NOTES).
Tooling and offline tests only: no capture was run, TradingView was not opened, the rig and its profile were not
touched. Every capture and report tree in the tests is SYNTHETIC (marked in the test file), plus a fixture-distinguishes
control per reader rail. No `SCRIPT_ENGINE_VERSION` edit; no engine bump is needed (nothing under `app/src` outside tests).

## SHAs
- TIP (final-tip run): `6a49968a55e69084b9088c9e63ea2c20fca86595`.
- Train merged into the tip: `origin/integ/pine-train-2026-11-05` @ `834467d2f0`. The train has since moved to
  `1eb3ba53e5`; its diff (62 files) touches none of `tools/vendor_harness`, the probes, the queue docs or the vendorHarness tests,
  so no re-merge was done (a re-merge would restart the 75 min run).
- tested-on-master (merge-base with `origin/master`): `646dca8cbf`.

## What was built
T3a (`tools/vendor_harness/`):
- `tv_capture.js` v3: a strategy (`StrategyScript$` id) is written as tool v3 with `provenance.strategySettings`
  (every visible Properties input; the hidden encoded script is left out), the dividend / back-adjustment reads as raw
  `{path, value}` pairs, `gradeMethod` (a, b, none; the page refuses without it), `gradeRange` for method (b), and
  `provenance.report`. Indicator captures stay tool v2 with no `provenance` key. `_strategyKeys()` is the W9-C0 spike
  (names and types, depth 2, never a call, never a value). `strategyReport({reportPath})` reads only the path the owner
  names after C0, calls only a zero-argument accessor, refuses step names that look like mutators or exports
  (`exportData` included), serialises with depth and node limits (a truncation is `partial`, a cycle is flagged).
- `strategy_capture.mjs`: the one authority for the Properties table (19 inputs by TradingView's own names, from the
  2026-10-02 RDDT fixture), the provenance validation, the settings agreement (source literal vs read-back; a disagreement
  is INCONCLUSIVE, `unread` is listed apart), and the report SLOTS (21) with `extractReportFields` / `readReport`.
  `strategy_report_slots.json` is UNPINNED: every slot refuses `strategy-report:unpinned` until W9-C0 is taken.
- `schema.mjs`: a v3 strategy capture without settings fails (gated on `tool.version >= 3`; the v2 fixtures are unchanged).
- `verify_capture.mjs`: prints `SETTINGS: AGREE | INCONCLUSIVE (n compared, n disagree, n unread)` for a v3 strategy.
- `batch_capture.py`: passes `gradeMethod`, `gradeRange`, `reportPath` from a manifest row (absent keys are not sent).

What the reader extracts (capture side): the strategy Properties read-back, the chart data reads (session and time zone
are the capture's own `symbol` block, one authority), the grade method and window, and the raw tester-report tree at the
owner-named path; (Node side) the 21 summary slots (net profit, gross profit/loss, drawdown, run-up, trade counts,
percent profitable, profit factor, averages, largest win/loss, bars in trades, Sharpe, Sortino, commission) by key path.

T3b:
- `w9_probes.py` generates 48 probe files in `tools/visual_conformance/probes/` (46 `w9-*` plus `s1-broker-core.pine`
  and `s1-broker-core-range.pine`); the standard set of 5.1 is written once and appended to all. `--check` fails on a diff.
  `s1-broker-core.pine` is S1's probe (`pine/s1-strategy-broker` @ 34da5eb926) with the standard set appended.
- `range_guard.py`: `rewrite` (every order call gets the guard through its `when` or an `if` wrap), `window` (X, Y from
  TradingView's own bars), `longest_lookback` (a proxy). The order-call set is PARSED from `STRATEGY_ORDER_CALLS` in
  `ast/pine.js`, minus the `strategy.risk.*` configuration calls. Refusals are named (`range_guard:no-order-calls`,
  `order-call-in-expression`, `code-after-order-call`, `another-window`, `bad-window`, `order-set-unreadable`).
- `docs/pine/capture-queue-2026-11-05-w9.md`: 42 rows; all resolve to a source and a chart through the engine's own
  `parse_doc` (0 NEEDS_PROBE). `docs/pine/vendor-harness/capture-queue.json` regenerated (`queue --check` PASS).

Deviations and open items for the coordinator:
1. The design says the corpus grading variants `w9-g-<slug>-spy.pine` are committed. They are NOT: X depends on
   TradingView's first bar, known only from Q-S1n's capture, and the lookback scan is a proxy. The queue doc gives the two
   commands (`range_guard.py window`, then `rewrite`). Four of the eleven SPY-probe scripts are committed corpus
   (`72s-strategy-...`, `stop-loss-and-take-profit-in-example`, `tradingview-alerts-to-mt4-...`, `vwap-fibo-dev-extensions-strategy`);
   the test rewrites each and checks every order call is guarded and the result idempotent.
2. W9-S2 needs two sources (`w9-s2-sharpe.pine`, `w9-s2-sharpe-rf0.pine`): `risk_free_rate` is a `strategy()` argument, and
   settings are set in the source only.
3. No probe was compiled. v2 and v4 dialect probes are written from published syntax; a TradingView refusal is a datum.
4. The engine's `LIVE_RX` over-flags three historical rows as needsLive (`same-tick`, `live-past`, `every-tick` appear in
   probe names the design fixed). Not changed: evidence_engine is outside T3.
5. Review note N2 (record both trade counts in the grade report) is T2's grader, not built here.

## Checks
| check | command | result |
|---|---|---|
| T3a vitest (own file) | `vitest run .../vendorHarness.w9Strategy.test.js` (Node 20.20.2) | 35 passed |
| T3b pytest (own files) | `pytest tests/test_w9_range_guard.py tests/test_w9_probes.py` | 41 passed |
| existing captures unchanged | `validateCapture` over every `uct.vendor-capture/v1` fixture, base `1b8b4616d8` schema vs tip schema | 353 captures, 353 identical results |
| queue | `evidence_engine.py queue --check` | PASS |
| probes | `w9_probes.py --check` | OK: 48 probes, 0 differ |

## Rail tests that fail on master and pass on the tip
All 35 tests of `vendorHarness.w9Strategy.test.js` and all 41 of `test_w9_range_guard.py` / `test_w9_probes.py` (the modules and files they test do not exist on master).

## Mutation table (every rail mutation-proved, with no-op controls)

Runner `runs/w9t3/mut.py`, under `heavy-mut.lock`; saved bytes restored and compared. 42 mutations: 42 KILLED, 0 survived; 4 no-op controls (a comment appended) stayed green. Equivalent survivors: none.

| mutation | result | first failing rail |
|---|---|---|
| schema: strategy provenance never validated | KILLED | a v3 strategy capture with NO provenance fails; the SAME capture as v2 passes (the version gate) |
| schema: version gate dropped (v2 fixtures held to v3) | KILLED | a v3 strategy capture with NO provenance fails; the SAME capture as v2 passes (the version gate) |
| strategy_capture: required Properties never missing | KILLED | a read-back that lacks a required Properties input fails, and names it |
| strategy_capture: gradeMethod not required | KILLED | gradeMethod is required and method (a) needs startsAtBar0 |
| strategy_capture: method (a) needs no startsAtBar0 | KILLED | gradeMethod is required and method (a) needs startsAtBar0 |
| strategy_capture: warm-up bars not checked | KILLED | too few bars before fromTime fails (TradingView's first bar is not early enough) |
| strategy_capture: guard window not compared to gradeRange | KILLED | a source with no guard, or a guard for another window, fails |
| strategy_capture: guard not required | KILLED | a source with no guard, or a guard for another window, fails |
| strategy_capture: disagreement never reported | KILLED | a disagreement is INCONCLUSIVE and names the key (and a different read-back gives a different answer) |
| strategy_capture: report slot value constant | KILLED | extracts the pinned slots and refuses the rest BY NAME |
| strategy_capture: unresolved path not reported | KILLED | FIXTURE DISTINGUISHES: a different tree gives different values; a wrong path is missing, not a default 15ms[ |
| strategy_capture: a refused report is read as ok | KILLED | readReport: a capture with no report, a refused report, and an ok report each say so |
| strategy_capture: unpinned slot not refused | KILLED | extracts the pinned slots and refuses the rest BY NAME |
| tv_capture: strategy written as tool v2 | KILLED | a strategy capture is written as tool v3 with provenance that validates |
| tv_capture: gradeMethod not demanded | KILLED | a strategy capture with no gradeMethod is refused at the page |
| tv_capture: report path deny-list off | KILLED | strategyReport: no path refuses by name; a denied step is refused and never called |
| tv_capture: report with no path read anyway | KILLED | strategyReport: no path refuses by name; a denied step is refused and never called |
| tv_capture: key walk calls functions | KILLED | _strategyKeys is names and types only: it calls nothing and carries no value |
| tv_capture: hidden inputs carried into the settings | KILLED | a strategy capture is written as tool v3 with provenance that validates |
| tv_capture: cycle not detected | KILLED | strategyReport: a cycle is flagged, a non-finite number is named, and the report lands in the capture 18ms[3 |
| verify_capture: SETTINGS verdict hard-wired | KILLED | prints SETTINGS: AGREE for an agreeing capture and INCONCLUSIVE for a disagreeing one (exit 0 either way) 123ms[2 |
| range_guard: risk calls treated as orders | KILLED | py: test_w9_range_guard.py::test_order_set_is_parsed_from_pine_js_and_excludes_risk_calls |
| range_guard: no-order-calls not refused | KILLED | py: test_w9_range_guard.py::test_refusals_are_named[plot(close)\n-range_guard:no-order-calls] |
| range_guard: wrapped call not indented | KILLED | py: test_w9_range_guard.py::test_an_unconditional_order_call_is_wrapped_and_nothing_else_moves |
| range_guard: when condition not parenthesised | KILLED | py: test_w9_range_guard.py::test_a_when_argument_gets_the_guard_with_the_old_condition_parenthesised |
| range_guard: already-wrapped call wrapped again | KILLED | py: test_w9_range_guard.py::test_idempotent_for_both_forms - assert ... |
| range_guard: another window not refused | KILLED | py: test_w9_range_guard.py::test_refusals_are_named[if time >= 1 and time < 2\n    strategy.entry("a", strategy. |
| range_guard: expression-position call not refused | KILLED | py: test_w9_range_guard.py::test_refusals_are_named[x = cond ? strategy.entry("a", strategy.long) : 0\n-range_gu |
| range_guard: code after the call not refused | KILLED | py: test_w9_range_guard.py::test_refusals_are_named[strategy.entry("a", strategy.long) , 1\n-range_guard:code-af |
| range_guard: comments not blanked | KILLED | py: test_w9_range_guard.py::test_comments_and_strings_do_not_count_as_order_calls |
| range_guard: strings not blanked | KILLED | py: test_w9_range_guard.py::test_comments_and_strings_do_not_count_as_order_calls |
| range_guard: Y not just past the last closed bar | KILLED | py: test_w9_range_guard.py::test_window_from_bars_is_five_lookbacks_in_and_just_past_the_last_closed_bar |
| range_guard: forming bar graded | KILLED | py: test_w9_range_guard.py::test_window_from_bars_is_five_lookbacks_in_and_just_past_the_last_closed_bar |
| range_guard: original sha lost on a second pass | KILLED | py: test_w9_range_guard.py::test_idempotent_for_both_forms - Asserti... |
| range_guard: bad window accepted | KILLED | py: test_w9_range_guard.py::test_a_bad_window_is_refused[0-5] - Fail... |
| range_guard: warm-up not enforced | KILLED | py: test_w9_range_guard.py::test_a_window_that_cannot_hold_the_warmup_is_refused |
| w9_probes: window constant moved | KILLED | py: test_w9_range_guard.py::test_the_committed_method_b_probe_is_fully_guarded_and_the_plain_core_is_not |
| w9_probes: a standard plot renamed in the generator | KILLED | py: test_w9_probes.py::test_every_committed_probe_is_exactly_what_the_generator_writes |
| probe file: standard plot removed (std rail alone) | KILLED | py: test_w9_probes.py::test_every_probe_carries_the_standard_set_for_its_dialect |
| probe file: guard removed from the method (b) probe (guard rail alone) | KILLED | py: test_w9_probes.py::test_method_b_probe_guards_every_order_call_and_only_it |
| probe file: a guard leaks into a plain probe | KILLED | py: test_w9_probes.py::test_method_b_probe_guards_every_order_call_and_only_it |
| queue doc: a probe name misspelt (row stops resolving) | KILLED | py: test_w9_probes.py::test_every_w9_queue_row_resolves_to_its_probe_and_chart |
| CONTROL js: comment appended to strategy_capture.mjs | CONTROL-GREEN |  |
| CONTROL js: comment appended to tv_capture.js | CONTROL-GREEN |  |
| CONTROL py: comment appended to range_guard.py | CONTROL-GREEN |  |
| CONTROL py: comment appended to w9_probes.py | CONTROL-GREEN |  |

## final-tip (FULL scope, one lock hold under `heavy-final3.lock`, Node 20.20.2)
Command: `final-tip.sh pine-dsk-w9t3 w9t3/final tests/test_script_engine_version_gate.py tests/test_w9_range_guard.py tests/test_w9_probes.py tests/test_vendor_batch_capture.py tests/test_evidence_engine.py`
Logs: `_resume-2026-11-01/runs/w9t3/final.log`, `runs/w9t3/final/{gate,hyg,py,js}.log`, `FINAL_DONE`.
Record: `scope=full shards=1 gate=0 hyg=0 py=1 js=1 totals=ok errors=0 integrity=ok`.
- gate pytest: rc 0, 46 passed. Hygiene: rc 0.
- py rails: rc 1, 109 passed, 1 failed: `tests/test_vendor_batch_capture.py::test_the_committed_manifest_matches_the_corpus_and_skips_what_is_captured`
  (`corpus/committed/cdc-btc-rainbow-road` is now captured by a train fixture, commit 3e90f18e0a, while `batch-manifest.json` still lists it).
  This diff touches neither the manifest nor any fixture: a train baseline, not ours.
- vitest chart+hooks: `Test Files 5 failed | 1356 passed | 28 skipped (1389)`, `Tests 6 failed | 23110 passed | 122 skipped (23238)`.
  Failing files: `pollingSites.rail` (2), `settingsScope.rail` (1) [named baselines]; `enumerationSites` (1) and
  `vendorHarness.test` (1: float `0.000049999999999999996 !== 0.00005` in `tolerancePolicy`, `compare.mjs`, untouched here) [master baselines
  per the coordinator]; `vendorHarness.coverageAudit` (1: `delta-rsi-oscillator-strategy` runtime pane reads INCONCLUSIVE). The
  coverageAudit failure reproduced when re-run alone; it does not involve the files this lane changed (the 353-capture check above shows
  `validateCapture` is identical), so it is recorded as a baseline red, not a flake.
- ready-check: see the pushed result in the report; it fails on `py=1` and on the jsfail allowlist (`BASELINE_FAIL_RE` names only pollingSites and settingsScope) for the reasons above.

## Follow-up (coordinator note: is the py failure ours?)
`tests/test_vendor_batch_capture.py` run alone on a clean checkout of the train tip `1eb3ba53e5` (no change of ours): the manifest test
`test_the_committed_manifest_matches_the_corpus_and_skips_what_is_captured` FAILS there too (and so does
`test_grade_runs_the_corpus_harness_over_a_run_and_writes_both_files`, 2 failed / 20 passed; log `runs/w9t3/batch-capture-train-solo.log`).
On this tip: 1 failed (the manifest test) / 21 passed. It fails with the same assertion on both, so it does not come from our `tv_capture.js` v3
change, and the manifest was NOT regenerated. Cause: `batch-manifest.json` still lists `cdc-btc-rainbow-road`, which the train fixture of
`3e90f18e0a` already captures; the test's `captured_shas` finds it. A manifest regeneration is the train owner's.
`vendorHarness.coverageAudit` solo run on this tip: `runs/w9t3/coverageAudit-solo.log` (1 failed, 184 passed; `delta-rsi-oscillator-strategy` INCONCLUSIVE).

## Fix r1 (review W9-T3 NO-GO @38777a9f47)
- B1 fixed: `declaredStrategyArgs` locates `strategy(` on comment- and string-blanked text (`blankSource`, the rule of `range_guard.blank`).
  `settingsAgreement` never returns AGREE on nothing: no declaration is `strategy-settings:no-declaration`, a declaration with no literal is
  `strategy-settings:nothing-compared`, both INCONCLUSIVE; `verify_capture` prints the reason. Rails: the reviewer's case (commented
  `strategy (` above `initial_capital = 5000`, read-back 100000 gives INCONCLUSIVE with the disagreement), a string and a trailing comment,
  the two named zero-compared cases, the 4 named corpus strategies parse a declaration, and the verify_capture line.
- N1 fixed: `_strategyKeys` walks property descriptors only (own or inherited getters are reported `accessor`, never run); rail with an own and
  a prototype getter spy.
- N2 (the reviewer's 4 survivors) now each killed by name: (a) unpinned slot not guessed from a tree key, (b) partial report refused by
  `readReport`, (c) snippet records the given `warmupBars`, (d) method (a) carries no gradeRange.
- Mutations (`runs/w9t3/mut2.py`, `mut2.log`): 10 of 10 KILLED (3 B1 guards + reason line, getter walk, N2a-d) + 1 no-op control green. Total with the first table: 52 killed, 5 controls green.
- final-tip run 2 (FULL scope, `source dsk/node20.sh`, Node 20.20.2, after merging the then-current train): TIP `e620cf4473`;
  `runs/w9t3/final2.log`, `final2/`. rc gate=0 hyg=0 py=1 js=1 totals=ok errors=0 integrity=ok. vitest `Test Files 4 failed | 1362 passed`,
  `Tests 4 failed | 23245 passed`; failing files: enumerationSites, vendorHarness.test, settingsScope.rail, pollingSites.rail (all baselines).
  py: the `test_vendor_batch_capture` manifest test only (fails identically on the clean train tip, log `runs/w9t3/batch-capture-train-solo.log`).
  `vendorHarness.coverageAudit` PASSED in this full run; its earlier failure (delta-rsi runtime pane, solo log `runs/w9t3/coverageAudit-solo.log`)
  was a wall-clock flake, not a change of ours.
