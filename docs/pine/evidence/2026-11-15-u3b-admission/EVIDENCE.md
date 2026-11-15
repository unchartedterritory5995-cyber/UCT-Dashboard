# U3b: udt and generics admitted; the object rows re-derived under x grading (2026-11-15)

This follows U1 + U3 (#1347). It is a registry + policy slice: no engine change and no
`SCRIPT_ENGINE_VERSION` bump. `PINE_RUNTIME_CAPABILITY_ADMISSION` still defaults to `off`.

## What changed underneath

Since #1347 merged, two things landed on master:

- **U13 (#1335):** objects v2 now grades x.
- **S13/S14/S16/S17/S18/S20 (#1357):** the capture sessions, including the x-capable re-captures and the S20
  admission evidence.

Re-running the runtime-on harness at `7a74a90f45` (688 captures) had two effects:

- **Every U1 evidence capture taken before the x table now grades objects v2 INCONCLUSIVE.** That covers
  Renko, Wyckoff, AlgoAlpha, Fibonacci 10-02, inside-bar-range, Trendline Pivots, VW_FORIN and others.
  The plot verdicts are unchanged.
- **The committed snapshots are refreshed**, so A8 holds every `obj:*` entry to its x-graded verdict.
  The `obj:*` rows of #1347 are therefore re-derived from the x-graded captures (`objectsX` is now the
  capture's own x verdict).
- **No runtime-drawn capture has an x that DIVERGES**, in any family.

## Decisions

| capability | captures / scripts / community | decision |
|---|---|---|
| udt | 2 / 2 / 2 (Signal Follow-Through Ledger, Trendline Pivots) | **ADMITTED** (S20) |
| generics | 7 / 3 / 2 (Sweep Reversal Map, Signal Ledger; probe VW_INT_ARRAY_AVG) | **ADMITTED** (S20) |
| calc-bars | 4 / 2 / 2 (Sweep Reversal Map x2, Wyckoff x2) | **HELD**: see below |
| obj:line | 4 / 3 / 2 (Fibonacci 11-15, Sweep Reversal Map x2; probe VW_INT_ARRAY_AVG 11-15) | re-derived, admitted |
| obj:label | 5 / 4 / 3 (+ Fair Value Gap 11-15) | re-derived, admitted |
| obj:delete | 5 / 4 / 4 (Fair Value Gap, Fibonacci, Sweep x2, Signal Ledger) | re-derived, admitted |
| obj:collection | 4 / 3 / 3 (Fair Value Gap, Sweep x2, Signal Ledger) | re-derived, admitted |
| obj:getter | 2 / 2 / 1 (Fair Value Gap 11-15; probe VW_INT_ARRAY_AVG 11-15) | re-derived, admitted |
| **obj:linefill** | **0** | **WITHDRAWN**: its 3 captures (AlgoAlpha x2, FVG Finder) predate the x table and grade INCONCLUSIVE |
| obj:box | 4 / 3 / 3 | still withheld (ruling: v4 default border colour) |
| obj:table | 1 / 1 / 1 (Signal Ledger rddt; its spy capture is INCONCLUSIVE) | one short, as expected |
| collections:matrix, collections:map, method-def, enum | 0 | no evidence |
| conditional-ta | | owned by COND-TA |

## Sweep Reversal Map does use calc_bars_count, but no capture witnesses it

Its source line 10 reads `indicator(..., calc_bars_count = 10000)`, so the detector is right that the
script uses it. But a window only changes the picture when the chart has more bars than it.

| capture | calc_bars_count | bars | the window binds? |
|---|---:|---:|---|
| sweep-reversal-map rddt | 10000 | 666 | no |
| sweep-reversal-map spy | 10000 | 8507 | no |
| wyckoff rddt | 1000 | 636 | no |
| wyckoff spy | 1000 | 1800 | **yes** |

On three of the four captures, an engine that ignored `calc_bars_count` would draw exactly the same
picture, so they witness nothing about the capability. Only one script (Wyckoff, on SPY) runs past its
window.

The probes that do bind are all host-drawn, and all DIVERGE on plots:
- `vw-cs1-calc-bars`, `vw-wse-calc-bars-bar-index`, `vw-cbc-history-reads` and `vw-cbc-mbb-and-input`
  (window 100 on 666 bars).

So calc-bars is **held**: it is not a registry row. The `_readme` says why, and
`test_U3b_calc_bars_is_held_while_one_script_runs_past_its_window` holds the measurement.

To lift the hold, a second community script whose window binds on a runtime-drawn MATCH is needed:
for example Sweep Reversal Map on an intraday chart with more than 10000 bars, or a capture of a
script with a smaller window.

## Census, before (#1347's registry) -> after (this PR), member door, admission ON

Both sides are over the fresh run at `7a74a90f45`.

**Sample of 679 scripts:** admitted 200 -> 205. Runtime lane fully drawn:

| population | before | after |
|---|---:|---:|
| committed | 10 | 11 |
| reference | 6 | 5 |
| builtin | 5 | 4 |
| **total** | **21** | **20** |

- **Newly fully drawn: 1**, `trendline-pivots-quantvue` (was missing udt).
- **No longer drawn: 2**, `builtin:linear-regression-channel` and
  `reference:best-sr-indicator-with-candlestick-patterns`. Both use obj:linefill, which is withdrawn.
- Counted strictly (RT5's provenance sentence as a not-drawn note): 0 new and 0 lost.

**Captures:** admitted 258 -> 269; runtime-drawn 21 -> 28. The 7 new runtime-drawn captures:
- MATCH (5): trendline-pivots rddt, vw-int-array-avg rddt/spy, vw-int-array-avg-neg rddt/spy;
- INCONCLUSIVE (2): vw-array-na rddt/spy.

**REACH (`report.json`):** 0 runtime-lane DIVERGE, 0 MATCH -> DIVERGE. The new runtime-drawn DIVERGEs
in the corpus are all still withheld:
- mann-kendall rddt/spy: conditional-ta, obj:table;
- inside-bar-boxes: obj:box, varip.

**Also worth knowing.** Several of #1347's PROVEN claims now read objects v2 INCONCLUSIVE under x
grading, because their captures have no x table: inside-bar-range, parabolic-sar, zigzag-mtf. Their
plot verdicts stay MATCH. They need x re-captures before they count as proven with x.

## Engine 56 (#1264) landed during this PR

Master moved to engine 56 (`5443154808`) after the measurement, so the branch merged it and the
runtime-on harness was run again at engine 56.

- **6 verdicts moved**, all host-drawn and none of them evidence or a runtime-lane reach capture:
  - k-clustering rddt/spy: DIVERGE -> INCONCLUSIVE;
  - mcclellan-indicators rddt/spy: DIVERGE -> INCONCLUSIVE;
  - support-and-resistance-multi-time-frame rddt/spy: DIVERGE -> MATCH.
- Every evidence entry and every admitted runtime-lane capture grades exactly as committed.
- The committed snapshots stay the engine-55 measurement at `7a74a90f45`, so REACH reads both lanes
  at one engine.

## Rails and mutants

The rails are in `tests/test_pine_capability_admission.py`:
- **A8:** objectsX is held to the verdict's own x answer (`_x_verdict`), replacing the `x-grades.json`
  record of #1347.
- `test_U3b_linefill_is_withdrawn_until_an_x_graded_capture_carries_it`.
- `test_U3b_calc_bars_is_held_while_one_script_runs_past_its_window`.
- **The unadmitted example** is now a matrix script (udt is admitted).
- **The committed admitted set** is updated.

**7 mutants, all KILLED, each restored byte-equal** (`runs/mutants.json`):
- **U3b-M1:** linefill re-added on its pre-x evidence.
- **U3b-M2:** calc-bars admitted on its count.
- **U3b-M3:** the A8 objectsX check dropped.
- **U3b-M4:** an entry's objectsX misstated.
- **U3b-M5:** udt left on one script.
- **U1-M2r / U1-M5r:** the pairedNothing and x-veto mutants, re-run.
