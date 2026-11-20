# Capture queue: A1, a function parameter that sizes a history offset, passed a value read per bar (2026-11-20)

Filed for coordinator patrick-2b by the objects agent (roadmap unit `objects`, A1). Probes and licence-held scripts
only: no capture text is committed.

The runtime lane now compiles, for a call site whose argument changes every bar, a copy of the function that reads that
parameter per bar (`pineRuntimeFrontend.js::seriesParamOf`), from a ring of Pine's 5,000 (WS-C M2 / M3 / Q-MBB,
captured 2026-11-18: TradingView reads the real history for an offset known only while the bar runs, declared buffer or
none; M4 for a script's own series). Nothing proves such an offset whole or non-negative before bar 0, so every dynamic
read in that copy is strict: a negative or fractional offset read on a bar STOPS the run by name. What TradingView answers
there is rows Q-A1-4 / Q-A1-5. An argument built with `/` is refused by name (DY1, Q-DYN-1 in
`capture-queue-2026-11-18-parity2.md`).

Every probe and script runs with its inputs at their defaults, on the chart's own symbol, from the listing so no warm-up
hides a difference. A line that does not compile is a reading: record the error text and the line, remove only that
row, and capture the rest. A runtime error is a reading: record its text and the bar it names. Not live. Read after the
close.

Probe sha256 (first 16 hex, of the file as committed): `vw-a1-series-param-offset.pine` f0e2cc92c59b5d8d,
`vw-a1-series-param-offset-neg.pine` 5f3d56f9a55fb47b, `vw-a1-series-param-offset-frac.pine` 3f96f49b5f3c1374.
Script source sha256 (first 16 hex, of the cached text): `dynamic-linear-regression-channels__17ec799bc1` 1f95519da1f4e844.

## The run half A1 mints (evidence before admission)

dynamic-linear-regression-channels (`reference:dynamic-linear-regression-channels__17ec799bc1`, licence-held, 6,527
boosts) is one of the objects unit's sole scripts: before A1 its run half was declined (`runtime:history-dynamic-offset`);
with A1 it MINTS (the drawing build stands, 12 drawing operations). A run half reaches a member only after a
runtime-on grade of the RUN's drawings matches on at least two distinct captures
(`runHalfRailSeam.RUN_HALF_EVIDENCE_MIN_CAPTURES` = 2), then admission. Capture locally, grade into the evidence ledger,
commit the ledger rows only (never the capture text). Record every plot on every bar and EVERY object (lines, linefills)
at the last bar.

| id | script (corpus key) | chart | live | what to record | unblocks |
|---|---|---|---|---|---|
| Q-A1-1a | `reference:dynamic-linear-regression-channels__17ec799bc1` | NYSE:RDDT 1D from the listing | no | every line (x1, y1, x2, y2), every linefill, at the last bar | the A1 run half's drawings (its channels: a per-bar window `bar_index - start_index + 1`) |
| Q-A1-1b | `reference:dynamic-linear-regression-channels__17ec799bc1` | AMEX:SPY 1D from the listing | no | the same | the same, a second capture |

## The rule A1 stops on (probes)

| id | probe | chart | live | what to record | unblocks |
|---|---|---|---|---|---|
| Q-A1-3a | `tools/visual_conformance/probes/vw-a1-series-param-offset.pine` | NYSE:RDDT 1D from the listing | no | every plot on every bar | the per-bar copy's values against TradingView: P01 `src[n]`, P02 the support-and-resistance `cum` shape, P03 the guarded loop |
| Q-A1-3b | `tools/visual_conformance/probes/vw-a1-series-param-offset.pine` | AMEX:SPY 1D from the listing | no | the same | the same, on a second symbol |
| Q-A1-4a | `tools/visual_conformance/probes/vw-a1-series-param-offset-neg.pine` | NYSE:RDDT 1D from the listing | no | every plot on every bar, or the runtime error's text and bar | what Pine answers for a NEGATIVE offset read on a bar (the lane stops by name there) |
| Q-A1-4b | `tools/visual_conformance/probes/vw-a1-series-param-offset-neg.pine` | AMEX:SPY 1D from the listing | no | the same | the same, on a second symbol |
| Q-A1-5a | `tools/visual_conformance/probes/vw-a1-series-param-offset-frac.pine` | NYSE:RDDT 1D from the listing | no | every plot on every bar, or the compile / runtime error's text | what Pine answers for a FRACTIONAL offset (the lane stops by name there; DY1 settles the constant half) |
| Q-A1-5b | `tools/visual_conformance/probes/vw-a1-series-param-offset-frac.pine` | AMEX:SPY 1D from the listing | no | the same | the same, on a second symbol |

## Still refused, by name (not this queue's)

- support-and-resistance (`reference:support-and-resistance__c13363a5d2`): past A1 its `Variance(src, p) => p == 1 ? 0 :
  Sma(...)` keeps per-call-site history in one arm of a `?:` (`runtime:conditional-history`): roadmap A4.
- fibonacci-extention-retracment-pivot-points-by-dgt, trend-direction-helper, linear-regression-channel-curve-slope-by-dgt:
  each passes a length built with `/` (`i_depth / 2`, `abs(RISK / 180) + 1`, `i_linregLength2 * htf_multiplier /
  timeframe.multiplier`): DY1, Q-DYN-1.
