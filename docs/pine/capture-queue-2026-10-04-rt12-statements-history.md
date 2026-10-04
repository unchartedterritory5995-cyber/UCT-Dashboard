# Capture queue - 2026-10-04 RT12, statements and history

Branch `pine/rt12-statements-history`. One new probe
(`tools/visual_conformance/probes/vw-rt12-statements-history.pine`, never compiled here), for the
capture lane to run on the live TradingView rig with `tools/vendor_harness/tv_capture.js`, same
procedure as `docs/pine/capture-queue-2026-09-28.md`. Plus three corpus captures.

## Why

RT12 serves, graded only against the same program written the way the lanes already served it and
a hand replay (no TradingView capture exercises them):

- a comma line of a binding (or `:=`) and calls, including a line whose trailing `,` carries the
  next line's `plot` (`pine.js::commaCallSplit`, host and runtime lanes);
- a value builtin on a line of its own, its value discarded (runtime lane);
- a function-body local bound once from values the call site fixes, and constant `+ - *`
  arithmetic in a window length (runtime lane, `frameDerived` / `foldConstNode`).

And REFUSES by name, unsettled:

- a SERIES window length (`ta.lowest(len)` with `len` changing per bar, `ta.highestbars(high, n)`
  likewise): `runtime:history-dynamic-offset`. What TradingView answers when the length passes the
  bars that exist, when it is `na`, and whether its history buffer stops the script, is not
  captured anywhere in `tests/fixtures/vendor/`.

## Q-RT12

| # | capture | settles |
|---|---|---|
| Q-RT12a | the probe as written, NYSE:RDDT **1D** from the listing, and AMEX:SPY 1D | rows L01-L06 (series window length; L00 is the control). A runtime error is the reading. |
| Q-RT12b | same captures | rows C01, C02 (comma statements) and D01 vs D00 (frame-local fixed length) |
| Q-RT12c | `corpus/committed/range-filter-bs-signals__*.pine` as written, NYSE:RDDT 1D and AMEX:SPY 1D | the corpus script RT12 attaches through the frame-local fold (runtime lane) |
| Q-RT12d | `corpus/committed/nonlinear-regression-zero-lag-moving-average-loxx__*.pine` as written, same symbols | the corpus script RT12 attaches through the trailing-comma split (runtime lane) |
| Q-RT12e | `corpus/committed/atr-trailing-stoploss-strategy__*.pine` as written, same symbols | the corpus script RT12 attaches on the HOST lane through the comma split |

## What lands when it is captured

- L01-L06: if TradingView answers the window over the last `len` bars (shorter at the listing),
  serve a series length on the runtime lane as a ring sized to the run's bar count; a runtime
  error on L03/L04 means the lane must stop the run by name at that bar instead. Then
  market-structure-break-order-block (whose only wall this is, measured by substitution) attaches.
- C01/C02 differ: the comma split is wrong; revert `commaCallSplit` (one function).
- D01 differs from D00: a frame local is not fixed per call site; revert `frameDerived` (one map).
- Q-RT12c/d/e MATCH: add each to the starter allowlist candidates (owner ruling D6).

## Walls named, not queued here (no capture can serve them alone)

- sessions (10 `runtime:statement` scripts): `input.session` has no carrier, a v4 session with no
  day list is unmeasured, overnight sessions and `time(<other tf>, sess)` are not served (RT10's
  note); measured by substitution, each script then stops on another session wall.
- `enum` (Pine 6): the first wall of 4 `pine:statement` scripts (footprint-iq-pro, stop-loss-
  clustering, volume-footprint, and `jason5480/chrono_utils/7` behind trailing-take-profit); three
  then need lower-timeframe requests, the fourth is a strategy.
