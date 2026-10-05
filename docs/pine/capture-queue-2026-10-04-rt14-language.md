# Capture queue - 2026-10-04 RT14, core language completeness on the runtime lane

Branch `pine/rt14-language`. Two new probes (never compiled here), for CAP (the sole browser
user) to run on the live TradingView rig with `tools/vendor_harness/tv_capture.js`, same procedure
as `docs/pine/capture-queue-2026-09-28.md`:

- `tools/visual_conformance/probes/vw-rt14-language.pine` (v5)
- `tools/visual_conformance/probes/vw-rt14-legacy-max.pine` (v4)

Plus four corpus captures (scripts RT14 attaches on the runtime lane, none captured yet).

## Why

RT14 serves language forms graded only against the lane's own already-served spelling of the same
program (a hand-written slot, the nested call, `array<float>`), never against TradingView:

- a never-mutated ROOT binding read where it has no slot (`ta.change(top)`), and a STATEFUL one
  (`ta.valuewhen`) read inside a block, as Pine's every-bar variable (rows B01-B03);
- `var x = if|switch` initialising once (V01-V03);
- a function whose trailing `if` runs for its effect, called on its own line (F01-F02);
- an `if` arm whose value is a `switch` (W01-W02);
- `float[] q` in a function header and a user-type field declared an array (T01, A01, A02);
- `math.max` / `math.min` with three arguments over runtime state (M01), and v1-v4 bare
  `max(a, b, c)` / `min(...)` (L01-L02; L00 is the control);
- `varip` on closed bars (P01 vs P00) - NOT served: the queue question below.

## Q-RT14

| # | capture | settles |
|---|---|---|
| Q-RT14a | `vw-rt14-language.pine` as written, NYSE:RDDT **1D** from the listing | B01-B03, V01-V03, F01-F02, W01-W02, T01, A01-A02, M01 |
| Q-RT14b | same capture | P01 vs P00: is `varip` equal to `var` on every CLOSED bar (the manual says it differs only across realtime updates)? The forming bar is not graded. |
| Q-RT14c | `vw-rt14-legacy-max.pine`, NYSE:RDDT 1D | L01, L02 (v4 bare variadic `max` / `min`) equal L00's nesting |
| Q-RT14d | `corpus/committed/support-and-resistance__1505.pine` as written, NYSE:RDDT 1D and AMEX:SPY 1D | the runtime-lane attach (root bindings read in blocks); grade with the harness, runtime pane permitted |
| Q-RT14e | `corpus/committed/blackflag-fts__GdkmXaTINI.pine`, RDDT 1D and SPY 1D | v4 `max(a, b, c)` in a trailing-stop ratchet |
| Q-RT14f | `corpus/committed/kalman-psar-backquant__0a389f529b.pine`, RDDT 1D | a `float []` parameter (library import loaded) |
| Q-RT14g | `corpus/committed/fvg-detector-tradingfinder-fair-value-gap-imbalance-mitigated__578addf606.pine`, RDDT 1D | drawing-only (lines, labels, linefills): valueless effect-`if` function + `if`-arm `switch` |

A runtime error is a reading: record message and row.

## What lands when it is captured

- B01-B03 equal the slot spelling in `rt14Language.test.js` ("a root binding read where it has no
  slot ..."): the rail cites the capture. A difference on B02/B03 would mean TradingView steps a
  root `ta.valuewhen` only where it is READ - contrary to the manual's execution model; stop and
  re-measure before changing `rootMacroSlot`.
- V01-V03 equal the first bar's arm on every bar. P01 equal to P00 on every closed bar lets
  `varip` be read as `var` on history (the forming bar keeps the refusal unless captured there).
- L01/L02 equal L00: `pine.js`'s legacy `math.*` route cites the capture.
