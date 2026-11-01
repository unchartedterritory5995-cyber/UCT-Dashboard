# Capture queue: 2026-10-31, WS-C history and series semantics

Branch `feat/pine-p3-wsc`. These are the captures WS-C still needs. Each shape below
is **refused by name or fails closed** on the runtime lane until a capture settles it
(standing ruling 2). Same procedure as `docs/pine/capture-queue-2026-09-28.md`: visibility
gate, **Create new > Indicator**, the "Add to chart" binding gate, `__uctVH.capture({...})`,
chunks, `verify_capture.mjs --assemble`. Inputs at defaults. A runtime error is itself a
reading: record its text and the bar it names.

No probe file is written yet for any row. Each row says what the probe must print.

## Q1. `max_bars_back`: where TradingView stops a script (plan 3.1, 3.6 item 2)

What the lane does now (`pineRuntimeFrontend.js` `MBB_*`, `vm.js` `READ_HIST*`):
- a constant offset past 5,000 bars, or past a declared `indicator(max_bars_back = N)`,
  refuses the build (`runtime:directive`);
- an offset known only while the bar runs, past the same buffer, stops the run in the VM;
- `max_bars_back(x, n)` with `n` below 5,000 stays refused (`runtime:directive`).

This is the safe direction (no wrong number is drawn), but it is not yet TradingView's rule.

| row | probe shape | what it settles |
|---|---|---|
| M1 | `indicator(max_bars_back = 20)`, `plot(close[30])` | does a declared buffer cap a CONSTANT offset, or does auto-detection widen it? If TradingView draws, the build refusal over-refuses. |
| M2 | `indicator(max_bars_back = 20)`, `n = bar_index > 100 ? 25 : 1`, `plot(close[n])` | the runtime error text and the bar it names, for a dynamic offset past a declared buffer |
| M3 | no declaration, `n = bar_index > 300 ? 250 : 1`, `plot(close[n])` | Pine's AUTOMATIC sizing: does it stop below 5,000 when the offset grows after the early bars? |
| M4 | `max_bars_back(x, 50)` then `x[60]` and `ta.sma(x, 60)` | does a per-series buffer bound built-in windows over `x`? |
| M5 | `n = 6000`, `plot(close[n])` on a chart with more than 6,000 bars | the hard ceiling for a chart series |

## Q2. An infinity inside a bar (plan 3.6 item 4)

The lane now launders `+-Infinity` to `na` when it is READ BACK from history (`x[1]`), so both
lanes agree on `x[1] > y`. The live value inside the bar is unchanged.

| row | probe shape | what it settles |
|---|---|---|
| I1 | `x = close / (close - close)`, `plot(x > 1 ? 1 : 0)`, `plot(na(x) ? 1 : 0)` | is `1/0` already `na` inside the bar in Pine (then the lane should launder at the division too)? |

## Q3. Conditional history the lane still refuses (R4)

Served exactly on this branch: `ta.sma`, `ta.ema`, `ta.rma` in a root-level `if` / `switch`
block (per call site); any `ta.*` behind a test fixed before bar 0 (input, literal, the chart's
timeframe flags, the chart symbol's text), including a function-body branch on a parameter at a
call site that fixes it. Everything below stays refused by name (`runtime:conditional-history`).

| row | probe shape | what it settles |
|---|---|---|
| H1 | `ta.stdev(close, 5)`, `ta.sum(close, 5)`, `ta.median(close, 5)` under `close > open`, and under `bar_index % 2 == 0` | do these count RUNS like `ta.sma` (C03 / D02)? They share `sma`'s skip window here, but no capture shows it. |
| H2 | `ta.change(close)`, `ta.mom(close, 2)`, `ta.roc(close, 2)`, `ta.swma(close)` in an `if` block, same two guards | the previous RUN's value is witnessed for `ta.change` in a `?:` arm (vw-arm-history T05 / K03); this witnesses the block, and the offset forms |
| H3 | `ta.atr(5)`, `ta.rsi(close, 5)` under the same guards | do they read the chart's previous bar (`close[1]` in the true range) or the previous run? |
| H4 | `x = close * 2` in a block, `x[2]`, `x[3]` read there | C05 / D03 witness `[1]` as the previous run; does `[k]` count runs for `k >= 2`? |
| H5 | `ta.highest` / `ta.lowest` in a block | `vw-cond-window-extremes` shows neither "last N bars" nor "last N runs" (X02: always 3 runs back; X03: never expires). The rule is still unknown; a probe printing `bar_index` for N = 2..6 under a period-3 guard would show the pattern. |
| H6 | a `ta.*` in a `?:` arm with a per-bar test, `ta.sma` / `ta.ema` / `ta.change` | witnessed per run (vw-arm-history T03 / T05 / K02 / K03). The lane refuses it because it evaluates both arms (`SELECT`); serving it needs the arm lowered as a jump, not a capture. |
| H7 | v6 `cond and ta.rising(close, 2)`, `cond or ta.crossover(...)` | is the right operand's history per run under v6 short-circuit evaluation? Refused now, not witnessed. |
| H8 | a `ta.*` in a `for` / `while` body | several steps a bar: not witnessed, refused |
| H9 | `(close + open)[1]` and `(close * 2)[2]` inside `if close > open`, plotted where the block runs | is an expression's history in a block the previous RUN's value (like a block local, C05) or the chart's previous bar? Refused by name in a block and in a `?:` arm (review M1). |
| H10 | v4 `iff(close > open, sma(close, 3), 0)` beside `close > open ? sma(close, 3) : 0` | does `iff` evaluate its untaken argument (every-bar `sma`) or not (per run, as `?:` does, vw-arm-history T03)? Refused by name (review M3). |

## Q4. The v6 `for` bound (handed to WS-A)

Pine v6 re-reads a `for` loop's `to` bound before every pass (v5 fixes it on entry). The lane
fixes it on entry. WS-C drafted a by-name refusal for a v6 bound the body changes and removed it
from this branch, because plan section 5 gives this item to WS-A. A probe for WS-A:
`a = array.from(1.0, 2.0)`, `for i = 0 to array.size(a) - 1` with `array.push(a, 9.0)` (and a
`remove` variant) in the body, printing the pass count, under `//@version=5` and `//@version=6`.
