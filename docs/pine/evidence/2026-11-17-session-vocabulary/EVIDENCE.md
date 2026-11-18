# The regular session's readers (#1713, Engine 73): the TradingView grade

What was built: `sessionOpen()`, `sessionHigh()`, `sessionLow()`, `openingRangeHigh(minutes)`,
`openingRangeLow(minutes)` and the two clock leaves `regularfirst` / `regularhours`
(Pine's `session.isfirstbar_regular` / `session.ismarket`). Indicators backlog 54.

This file records one thing the pull request could not hold when it merged: the grade against
TradingView.

## The capture

| | |
|---|---|
| id | `session-regular-witness-spy-5-2026-11-17` |
| script | `WITNESS_SOURCE` from `engine/ast/sessionRegularWitness.test.js`, byte for byte (541 bytes, sha256 `19513c2f2e3b...`) |
| chart | AMEX:SPY, 5 minutes |
| session as READ BACK | `0400-2000`, timezone `America/New_York` (extended hours: the chart's own resolved session, not an assumption) |
| bars | 20,112, from 2026-06-22 04:00 to 2026-11-17 18:25 New York |
| sessions | 105, each with bars outside 09:30 to 16:00 (between 96 and 114 of them) |
| newest bar | forming when captured; graded like the rest |
| captured by | the capture session, with the vendor harness |

The capture is vendor data and is NOT in this repository. It is local to the capture machine
(`%LOCALAPPDATA%/uct-vendor-batch/runs/srw-2026-11-17/captures/`); the grade's own output is
kept locally under `reports/indicator-ecosystem/session-vocabulary/`.

How an unknown value is recorded: the capture stores a plot row only for a bar where the script
produced a value, so a bar with no plot row is NaN in every column. The grade treats it so.

## The grade

`grade_capture.py` (beside this file) runs the server lane's native readers
(`indicator_compute.compute_session_regular_raw`, on the engine's own bar shape) over the
captured bars and compares each with TradingView's plot of the same name, joined on bar time.
Tolerance 1e-6.

| plot | equal | unknown on both sides | unknown on one side | differ | worst difference |
|---|---|---|---|---|---|
| Session high | 20,046 | 66 | 0 | 0 | 0 |
| Session low | 20,046 | 66 | 0 | 0 | 0 |
| Session open | 20,046 | 66 | 0 | 0 | 0 |
| Opening range high 30 | 20,046 | 66 | 0 | 0 | 0 |

The 66 bars unknown on both sides are the first day's pre-market bars (2026-06-22 04:00 to
09:25), before the first regular bar of the series: nothing is known until a regular session
opens, on TradingView and here. On every later day the pre-market bars carry the previous
session's values on both sides.

By the engine's own clock, every one of the 105 regular sessions is 78 five-minute bars
starting 09:30.

## What this does NOT cover

- **A half day.** There is none between 2026-06-22 and 2026-11-17. A 13:00 close is the one
  case that tells "the regular session ends at 16:00" from "it ends when the exchange says".
  The same chart is to be captured after 2026-11-27 and graded with the same script.
- **The browser lane directly.** The grade ran the server lane. The browser lane is held
  equal to it by the clock and reader parity fixtures that shipped in #1713
  (`clock_parity.json`, `sessionRegular.test.js`, `test_ast_session_regular.py`), not by this
  capture.
- **`openingRangeLow` and other range lengths.** The witness plots the 30-minute high. The low
  and the other lengths share the reader and are held by its own tests.
- **Another symbol or timeframe.** One symbol, one timeframe. A range that does not divide the
  bar (or a bar longer than the range) is withheld by name and is not a value to grade.

## To grade again

```sh
python docs/pine/evidence/2026-11-17-session-vocabulary/grade_capture.py <path to the capture.json>
```

It prints counts only. Its `first_bad` rows print vendor values when something differs: read
them locally, do not commit them.
