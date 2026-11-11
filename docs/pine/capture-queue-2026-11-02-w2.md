# Capture queue: 2026-11-02, W2 arming, the renko `if na(ret)` arm on more charts

Branch `feat/pine-w2-arming`. Same procedure as `docs/pine/capture-queue-2026-09-28.md` and
`docs/pine/capture-procedure.md`: visibility gate, **Create new > Indicator**, the "Add to chart"
binding gate, `__uctVH.capture({...})`, chunks, `verify_capture.mjs --assemble`. Inputs at defaults.
These rows are for the owner's capture rig. Nothing in this branch runs them.

## Why renko is withheld, and what is on file

`corpus/committed/renko-candles-overlay__d76a18d49e.pine`, `get_b_size(value)` (lines 26 to 36):
`float ret = value`, then `if na(ret)` / `ret := ta.tr(true)`. It is called with `ta.atr(modevalue)`
(lines 39 to 41). The arm's test reads a per-bar value (`na()` of a `ta.atr`), so it is **not**
a test on an input: it is a data-dependent arm, and the census names the script `conditional-ta`
(`tools/pine_coverage/coverage_map.py`, the `conditional-ta` row of `FEATURES`). The registry row of
the same name is `divergent` (`api/data/pine_runtime_allowlist.json`), so R1
(`api/services/rollout_gate.py::pine_runtime_admission`) withholds the script. **It stays withheld.**

What is committed (`docs/pine/evidence/w2-arming-2026-11-02/harness-lane-diff.json`, runtime-on lane):

| capture | production lane | runtime-on lane | reason text |
|---|---|---|---|
| `renko-candles-overlay-rddt-1d-2026-10-03` | INCONCLUSIVE | MATCH | all 2 items agree |
| `renko-candles-overlay-spy-1d-2026-10-03` | INCONCLUSIVE | INCONCLUSIVE | 1 of 2 items could not be compared (the cause is not recorded in that file) |

One chart settles one MATCH. Both committed charts are daily, one of them from the listing.

## Rows

At the default inputs (`mode = 'ATR/2'`, `Atr Period = 14`) the `na(ret)` arm is taken while
`ta.atr(14)` has no value yet, that is on the first bars of the loaded series, and on no later bar
unless a source bar is missing. So the chart choice that matters is where the series starts. A
series that starts at the listing shows the arm on TradingView; a long-history symbol does not
(`docs/pine/capture-procedure.md`, "BAR 0 IS NOT REACHABLE ON A LONG-HISTORY SYMBOL").

| id | script / probe | chart | question | what the engine does today | what the capture changes |
|---|---|---|---|---|---|
| Q-W2R1 | `corpus/committed/renko-candles-overlay__d76a18d49e.pine` | NASDAQ:CRWV 1D from the listing (listed 2025-03-28; the symbol `docs/pine/capture-procedure.md` already names for a whole-history window) | does the runtime lane's draw equal TradingView's on the early bars where `na(ret)` is true, on a second listing-start chart that is not RDDT? | RDDT 1D reads MATCH (2 of 2 items); no CRWV capture exists | a second independent MATCH, or a named per-bar difference at the warm-up bars |
| Q-W2R2 | the same script | NYSE:RDDT 1W from the listing | same question on a weekly series (about 130 bars: RDDT had 631 daily bars on 2026-10-02, per `vendorHarness.h4Loops.test.js`; that is fewer than `Number of Bricks` = 140 plus the ATR warm-up), so the arm's bars are a different slice of the brick window | no weekly renko capture exists | MATCH or a named difference; also shows whether a short series changes which items are comparable |
| Q-W2R3 | probe (optional): `float ret = na`, then `if bar_index % 3 == 0` / `ret := ta.tr(true)`, `plot(ret)`, with `plot(ta.tr(true))` at the root as the control | NYSE:RDDT 1D from the listing and AMEX:SPY 1D | is `ta.tr(true)` evaluated in an arm that runs on some bars the same number as the root-level `ta.tr(true)` on those bars? (renko's only call in the arm is `ta.tr(true)`.) | the front end serves a conditional `ta.sma` / `ta.ema` / `ta.rma` per call site (`pineRuntimeFrontend.js`, `SERVED_COND`) and refuses other conditional history by name; this probe is not on file | if equal on every run bar, the arm carries no call-site history for this function, which is a measured fact the owner can weigh. If not equal, renko stays withheld with a measured reason |

Notes:
- Q-W2R1 and Q-W2R2 are the "at least two more charts" for renko. Q-W2R3 is a probe, listed because
  the arm's only stateful-looking call is `ta.tr(true)`; the committed `vw-call-site-history` witness
  (C48) covers `ta.sma` and `ta.ema`, not `ta.tr`.
- Whatever the captures read, the withholding is the owner's call. A MATCH does not change the
  census row: `conditional-ta` detects the construct, not its grade.
