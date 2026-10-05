# Capture queue — 2026-10-04, H10 (knob reach, a fraction in a length slot)

Branch `pine/h10-w18-h9-merge` (base `integrate/wave18-2026-10-04`). What H10 changed is in the
triage doc, section H10. Procedure: `docs/pine/VENDOR-HARNESS.md` (visibility gate, **Create new ▸
Indicator**, "Add to chart" binding gate, `__uctVH.capture`), inputs at defaults unless a row says
otherwise.

## What is already settled by capture (no probe owed)

`vw-int-div-assign-spy-1d-2026-10-02` (v5, AMEX:SPY 1D): two `const int` operands truncate
(`28 / 100` -> 0, `a /= 100` -> 0, `c := c / 100` -> 0); an `input.int` operand keeps the fraction
(-> 0.28). So a v5 `5 / 2` in a length slot is the length 2, exactly what the host translates
(`f1ConstIntDivision.test.js`: `ta.sma(close, 7 / 2)` is 3 bars). H9's observation is captured
truth, not a defect.

## What no capture settles (refused by name on both lanes until one does)

A length that is not a whole number of bars: v6 `ta.sma(close, 5 / 2)` (2.5 by the v6 docs), or
v5 `len = input.int(5)` / `ta.sma(close, len / 2)` (2.5 by D04). The host refuses it `pine:window`
(with both whole-number spellings named), the runtime lane `runtime:history-dynamic-offset`. Nothing
TradingView hosts states whether it errors, truncates or rounds; these probes settle it.

| id | probe / chart | what it settles | scripts it would move |
|---|---|---|---|
| Q-H10a | new probe `vw-h10-frac-length` (v5): `len = input.int(5)`; rows `ta.sma(close, len / 2)`, `ta.sma(close, 2)`, `ta.sma(close, 3)`, `ta.wma(close, len / 2)`, `ta.highest(high, len / 2)`, `close[len / 2]` (each on its own line; if the script does not compile, record the compiler's sentence verbatim and which line it names). **AMEX:SPY 1D**, ≥ 300 bars | does a v5 fractional length (input / literal) compile, and if so is it 2 (truncate / floor) or 3 (round) — per builtin, and for a history offset | none measured yet: the 266 committed scripts write no fractional length the host would serve (pmax-explorer writes `floor(length / 2)` / `ceil(length / 2)`, already whole) |
| Q-H10b | the same rows in a `//@version=6` copy, plus `ta.sma(close, 5 / 2)` and `ta.sma(close, 7 / 2)` | the v6 const-int quotient in a length slot (2.5 / 3.5): error, truncate, or round | as above |
| Q-H10c | v5: `len = input.int(20)`; `plot(ta.sma(close, len / 2))` beside `plot(ta.sma(close, 10))` | a WHOLE-valued fractional-typed length (`20 / 2` = 10.0): does it compile, and is it the 10-bar average | the host serves this today as 10 (every reading of 10.0 is 10, so no wrong value is possible if it compiles); the probe confirms it compiles |
