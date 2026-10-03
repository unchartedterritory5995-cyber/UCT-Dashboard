# Capture queue — 2026-10-02 RT1, a `?:` whose test is `na`

Branch `pine/rt1-runtime-fallback`. One new probe
(`tools/visual_conformance/probes/rt1-na-test.pine`, never compiled), for the parent session to run
on the live TradingView rig with `tools/vendor_harness/tv_capture.js` — same procedure as
`docs/pine/capture-queue-2026-09-28.md`.

## Why

The shared `TERNARY` (`interpret.js`, used by both lanes) answers `na` when its test is `na`. The
member door's runtime fallback (RT1) measured two committed captures where TradingView takes the
OTHER branch instead: `qqe-signals` RDDT 1D (`cross(...) ? 1 : ... : nz(trend[1], 1)` during
warm-up, bar 73) and `pivot-point-supertrend` RDDT 1D (`ph ? ph : pl ? pl : na` with `ph` na, bar
517). RT1 refuses such a script on the fallback by name (`runtime:na-test`, `lowerIr.js::naTestsOf`).
This probe settles the rule per test shape, so the lanes can serve one witnessed rule.

## Q-NA

| # | capture | settles |
|---|---|---|
| Q-NA-a | `rt1-na-test.pine` as written (v5), NYSE:RDDT **1D**, full history, market closed | v5: cmp / cross / history / explicit-na tests |
| Q-NA-b | line 1 `//@version=4`, `indicator(` → `study(` | v4 (float truthiness era) |
| Q-NA-c | line 1 `//@version=6` | v6 (bools are never na) |

Read: on bars 0..18 rows `A01`, `A02`, `A04`, `A05` are 2 if TradingView takes the else branch on an
`na` test, `na` if it propagates. `A00` and `A03` are controls.
