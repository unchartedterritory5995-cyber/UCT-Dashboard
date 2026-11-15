# CBC-FMT — `calc_bars_count` window and `str.tostring` number text (evidence)

Branch `fix/pine-engine-calcbars-format`, based on master `687441f13f`. `SCRIPT_ENGINE_VERSION = 55`
(master + 1 at branch time); engines 55-58 (#1264, #1265, #1294, the colour PR) are unmerged, so the
number and its history line are the coordinator's to renumber at the rebase. Investigation:
`inv-fmt-1115` (local report). Witnesses: committed `vw-cs1-calc-bars`, `vw-wse-calc-bars-bar-index`,
`vw-int-array-avg(-neg)`, `support-resistance-mtf-flux-charts`, `parabolic-sar`; capture session S10
(fixtures in PR #1316): `vw-fmt-tie-readings`, `vw-cs2-label-number-format`, `vw-cbc-history-reads`,
`vw-cbc-mbb-and-input`, `vw-cbc-zero`, `vw-cbc-input-count` (compile error), and the LRC builtin
(licence-held, transcribed).

## ITEM 2 — `calc_bars_count`

| defect | before | after |
|---|---|---|
| D1 (production, wrong numbers) | the host lane ignored `indicator(calc_bars_count = N)` and drew every bar (`vw-cs1-calc-bars` 5 of 6 plots DIVERGE) | the host lane computes a stamped document over the chart's last N bars at ONE seam (`nativeRegistry.computeFor` → `engine/calcBarsWindow.js`): the slice is the whole history, `bar_index` from 0, `NaN` before the window |
| D2 | `objectStore.declaredCalcBarsOf`, a regex taking the FIRST `calc_bars_count = <digits>` anywhere (a `request.security` argument windowed cvd x2 and luxy) | ONE reader, `pine.js::declarationCalcBars`, of the declaration's own named argument; stamped as `meta.calcBarsCount` (and `meta.calcBarsRequest`) by the member door on both lanes' documents; the regex is deleted |
| D3 | the runtime lane's `bar_index` probe refused correct pictures (`plot(bar_index)`) | deleted (`runtime:calc-bars-bar-index`, `shiftBarIndexLeaves`, the probe cache); the base is witnessed |

What a window serves, and on what witness:
- window = last N rows; `bar_index` 0..N-1; `var` state from the window's first bar; warm-up inside the window (`vw-cs1-calc-bars`, `vw-wse-calc-bars-bar-index`);
- history reads never reach before the window: `close[1]`, `time[1]`, `bar_index[1]` `na` on its first bar, `close[150]`, `ta.highest(high, 150)` `na`, `nz(close[100], -1)` = -1; `max_bars_back = 500` changes nothing (`vw-cbc-history-reads`, `vw-cbc-mbb-and-input`, S10);
- `last_bar_index` = 99, `barstate.isfirst` on the window's first bar, `ta.cum(1)` 1..100 (S10);
- `calc_bars_count = 0` = every bar (`vw-cbc-zero`, S10, MATCH);
- a non-literal count refuses by name at every door, `pine:calc-bars-count-expr` (TradingView's own CE10123, S10 `vw-cbc-input-count`).

Withheld or refused by name (no capture yet; rows in `docs/pine/capture-queue-2026-11-15-calc-bars.md`):
- any request in a window, the identity request included: `pine:calc-bars-request` (Q-CBC2; S10's `NYSE:SPY` take was invalid);
- the newest bar while it may be forming: `pine:calc-bars-forming` (coordinator ruling; Q-CBC6), both lanes, a run's drawings with it;
- a windowed script's HOST object program (phase 1): not carried, named in the document's notes; an objects-only one refuses `pine:calc-bars-objects`;
- a screen of a windowed script: `pine:window-dependent` (a screen computes every bar it reads);
- alerts and the screener backtest: `alert:calc-bars-window` (fail closed on a stamp they cannot read).

Also: the browser worker now carries `meta.calcBarsCount` (it carried only `runtimeHistory`) and the window record; the object lane asks its `runtime.error` stop over the window; `editorStatus` files `pine:calc-bars-*` under limits and `format:*` under presentation.

⚠️ Not admitted: the `calc-bars` capability in `pine_capabilities` / the allowlist registry. Its named evidence (`vw-cs1-calc-bars` + wyckoff RDDT + SPY) fails the one evidence rule: `capabilityEvidenceLane.test.js` requires every evidence capture to be DRAWN BY THE RUN, and `vw-cs1-calc-bars` is drawn by the host lane, which leaves one script (wyckoff). A second runtime-drawn windowed capture is needed.

## ITEM 1 — `str.tostring` number text

One core, `pineTextFormat.js::tostringNumberText`, for no format (`defaultNumberText`), `#`/`0` patterns (`formatPlainNumber`) and patterns with words (`formatPatternedNumber`); every one of S10 `vw-fmt-tie-readings`' `str.tostring` rows (T01-T20, T26, T28-T30) reproduces:
- F4 no ten-decimal cap (LRC builtin 16 `#` 0.8175176096085278; T15-T17);
- F5 binary ties half away (vw-int-array-avg R06-R19, -neg A11-A13);
- F6 decimal ties up on the SHORTEST decimal ("decup"): T01-T07 settle it against the binary reading (1.005 → 1.01, 163.265 → 163.27, -1.005 → -1.01); T19, T30 (a carry);
- F7 a value that rounds to zero is unsigned (T13, T14, T26, T29); F8 the default prints `1e+21` (T18); F9 grouping by three (T20).
- `format.mintick` is a different rounding, `n / tick` in BINARY (T08 1.005 → 1.00, T09 163.265 → 163.26, T10 0.125 → 0.13, T11 -0.004 → 0.00, T12 1234.5 → 1234.50, no grouping); 127.705 / 0.01 is 12770.5 exactly, so `support-resistance-mtf-flux` reads "127.71".
- Still withheld by name: a pattern at 1e21+ (`format:magnitude-uncaptured`), another grouping size (`format:grouping-uncaptured`), a negative under a prefix (`format:negative-under-prefix`), a negative mintick tie, a tie at a non-power-of-ten tick (Q-FMT2).
- The runtime VM: a withheld text stops the run BY ITS NAME (`runtime/text.js`), where a `null` used to reach `+` (an unnamed VmError) or a drawing's text (an unnamed drawing error); a drawing run keeps its plots and withholds its drawings under that name.
- F11: a number in a label / box / cell `text` is a TradingView compile error, refused `pine:type` (inside `str.format` an implicit number stays `{N}`'s).
- `str.format` keeps its own formatter (R6: 952.4295 → "952.429", T24 "1"); T25 (2.0625 → "2.062", half-even) is a new witness for THAT formatter, not adopted here.
- Open: `math.round_to_mintick(127.705)` reads 127.7 (binary `x / tick` gives 12770.499…), so the SAR label `tostring(round_to_mintick(sar))` still differs there; a numeric change, out of this scope.

## Rails and mutants

New rails: `engine/__tests__/calcBarsWindow.cbcfmt.test.js` (W2-W6, S10 C1/C2/C4, both lanes), `engine/__tests__/strTostringCore.cbcfmt.test.js` (S10 T-rows, R1-R3, R6, lanes, F11), `tests/test_cbcfmt_calc_bars_server.py`; updated: `wseReviewFixes(.test, 2)`, `runtimeObjectsDoor`, `runtimeRealtimeWse`, `strTostringFormat.vendor`, `pine.guardCensus`, `test_alert_user_admission` (the new gate driven).

Mutants (copy aside, mutate, focused rail, restore from the copy, `git hash-object` == HEAD blob): 33 of 33 killed, every restore equal to HEAD, control green. Format: 10-cap, toFixed core, binary-only reading, half-down, no zero-sign guard, str.format using the core, a 16-decimal cap, no exponent, no grouping, mintick on the decimal reading, negative mintick tie served, VM null not named, no `pine:type`. Window: no host window, no `historyFromListing`, pad 0, off by one, the source regex back (runtime), the index probe back, the object-lane stop over every bar, host / runtime request refusal off, forming withhold off, screen refusal off, runtime front-end refusal off, no meta stamp, host objects kept, 0 as a window, an expression accepted, the stamp lost on early returns. Python: alert gate off, backtest refusal off, fail open.

Focused vitest (13 files, 247 tests) and pytest (`test_cbcfmt_calc_bars_server`, `test_alert_user_admission`, `test_alert_catalog_refusals`, `test_no_shadowed_definitions`, `test_dockerfile_vite_build_args`, `test_vite_flag_ledger`, `test_visibility_flag_ledger`, `test_script_engine_version_gate`, `test_saved_script_prebump`, `test_pine_capabilities`, `test_pine_capability_admission`) green under the heavy lock; `check_repo_hygiene` clean.

## Measurements

PENDING: the vendor harness in both lanes (BEFORE by product-file swap / AFTER), the scoped door census and the ledger regrade were queued and timed out on the heavy lock (12 jobs queued); held per the coordinator's lock-priority rule until engine 55 and #1326 merge.
