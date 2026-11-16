# `ta.rma` summation order (landing train 1, train-owned sixth input)

Coordinator ruling 2026-11-15: this rides landing train 1 under the train's one engine number, because the
train's one before/after regression had not been measured yet. Found while classifying one red rail
(`runtime/__tests__/l4dDrawingHistory.test.js`) on the combined tree.

## What was wrong
After CBC-FMT (`str.tostring`'s witnessed tie rule F6: a decimal tie rounds up, captures T01-T07), one label
of the licence-held capture `vw-w3n-draw-block-history-c-spy-1d-2026-11-15` printed a different last digit:
label 437 of 501 (bar 8378), `"C|" + str.tostring(ta.rma(close, 3))` stepped in an `if` block. TradingView's
value is 736.5254571057499 and its text "C|736.5254571057"; ours was 736.52545710575 and "C|736.5254571058".
The formatter is right. Our `ta.rma` double was one unit in the last place from TradingView's, and its
shortest decimal sat exactly on a tenth-decimal tie.

## What TradingView computes, measured
Offline (Python, the same IEEE float64 arithmetic), every value compared by its 8-byte pattern, never by a
tolerance. The SMA seed is summed left to right in every row (four seed variants were tried on the first two
captures and did not separate). "ours before" is `prev * (1 - 1/n) + src * (1/n)`, Pine's documented spelling
and what `interpret.js::smoothStep` computed for `rma`.

| capture (licence-held, NYSE:RDDT 1D from the listing unless said) | what is plotted | values | `(prev * (n - 1) + src) / n` | ours before | `prev + (1/n) * (src - prev)` |
|---|---|---|---|---|---|
| `vw-w3n-draw-block-history-c-spy-1d-2026-11-15` (AMEX:SPY) | `ta.rma(close, 3)` per call site, label y | 501 | **501** | 62 | 334 |
| `vw-w3n-draw-block-history-c-rddt-1d-2026-11-15` | the same | 314 | **314** | 45 | 194 |
| `average-true-range-rddt-1d-2026-11-14` | builtin ATR(14), `ta.rma(ta.tr(true), 14)` | 653 | **653** | 52 | 216 |
| `relative-strength-index-rddt-1d-2026-11-14` | builtin RSI(14), its own `ta.rma` of gains and losses | 652 | **652** | 281 | not run |
| `directional-movement-index-rddt-1d-2026-11-14` | builtin DMI(14, 14): +DI | 652 | **652** | 121 | not run |
| the same | -DI | 652 | **652** | 67 | not run |
| the same | ADX | 639 | **639** | 72 | not run |

4,063 of 4,063 values bit-exact for `(prev * (n - 1) + src) / n` (the same bits as `(src + (n - 1) * prev) / n`),
at n = 3 and n = 14, two symbols, a label lane and a plot lane, and three builtins that are written on
`ta.rma` in their own published source. Every miss of the old spelling is within about 1e-12 relative. The
count goes up for every function built on it; none goes down.

## What changed
- `interpret.js`: `smoothStepOf(recur)` makes the two smoothers from one seed / hold / NaN-prefix rule;
  `smoothStep` (ema, unchanged arithmetic) and `rmaStep` (`(prev * (n - 1) + v) / n`). `CARRIED.rma.step` is
  `rmaStep`. That table is the one authority: `FN.rma`, `atrPine` (Pine's `ta.atr`) and the runtime VM's
  carried kernel all step through it, so there is no second JS site.
- `api/services/ast_interpret.py`: `_smooth_col(..., wilder=True)` for `_rma_col` (and so `atrPine`'s twin).
- Already in the witnessed order, untouched: `interpret.js` `rsi` (the house kernel's gain / loss averages),
  `indicators.js` RSI, ATR and ADX, `ast_interpret.py` house `atr` and `adx`.
- NOT touched, because not measured: `ta.ema` and every alpha `2 / (n + 1)` site (`smoothStep`,
  `indicators.js::_ema`, `derivedColumns.js`, `_ema_col`). Tracked as a capture row:
  `docs/pine/capture-queue-2026-11-16-rma-last-bit.md` ("ta.ema / ta.rsi last-bit agreement: untested",
  probe `tools/visual_conformance/probes/vw-ema-last-bit.pine`).

## Rails
- `app/src/components/chart/engine/ast/rmaSummation.test.js`: ten doubles read off the builtin ATR(14)
  capture (its bars are the committed RDDT fixture's 666 sessions, checked bar for bar) and the recurrence
  written out in the test; the kernel table, the host lane (`ta.rma(ta.tr(true), 14)` and `ta.atr(14)`), the
  runtime lane as a pure column and as a value the VM steps, `ta.rma(close, 3)`, each equal on every bar by
  `Object.is`; a control that the old spelling misses six of the ten; a control that `ta.ema` is unchanged.
- `tests/test_ast_rma_summation.py`: the Python lane on the same ten doubles and every bar, `ema` unchanged,
  and JS against Python bit for bit on three trees (`ast_conformance.run_js` / `run_py`).

## Results on the train tree
- **The label.** `vw-w3n-draw-block-history-c-spy-1d-2026-11-15`: 0 of 501 labels differ from TradingView
  (label 437 prints "C|736.5254571057"); the RDDT twin 0 of 316; the SPY `-a` (sma) capture 0 of 501. No
  waiver of the regression gate was needed, and `l4dDrawingHistory.test.js` keeps its original pin.
- **Rails.** `rmaSummation.test.js` 7 passed; `tests/test_ast_rma_summation.py` 4 passed (JS against Python
  bit for bit included). `runtime/__tests__/carriedState.test.js`: its two longhand references step `rma`
  in the new order (the `na` hold it records is unchanged).
- **Mutants** (copy aside, mutate, the rail, restore from the copy, `git hash-object` == HEAD blob; controls
  green): the old spelling back in `rmaStep` (killed, 4 tests), `CARRIED.rma` back on the shared exponential
  step (killed, 4), `ema` moved onto the rma arithmetic (killed, 1: the control), the old spelling back in
  the Python twin (killed, 2), `ema` moved in Python (killed, 1). 5 of 5.
- **What moves downstream** is in the train PR: the before/after census and harness, the host-parity
  digests and any fixture that pins an `rma` / `atr` double in its last bits.
