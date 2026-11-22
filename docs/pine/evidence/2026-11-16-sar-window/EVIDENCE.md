# The `sar()` formula's window: 200 -> 400 bars, by measurement (2026-11-16)

## What broke

The native formula language's `sar(step, maxStep)` and `sarDirection(step, maxStep)` are an
expansion (`callExpansions.js::sarTrees`, mirrored by `call_expansions.py::sar_trees`). It runs the
chart's own Parabolic SAR rules (`indicators.js::computeParabolicSAR`) over a bounded window: each
bar's value is re-seeded `SAR_WARMUP` bars back.

With `SAR_WARMUP = 200`, the capture session's `vw-lower-tf-bars-rddt-15-2026-11-16` (NYSE:RDDT 15m,
20,886 bars) put 43 published bars (5167-5246) off the chart's full-history SAR, 17 of them in value
AND direction. `sar.test.js` recorded it as a KNOWN `it.fails` (#1472).

## The measure

**Merge distance.** For a SAR seeded at bar s, how many bars until its four states (trend, stop,
extreme point, acceleration) EQUAL the full-history SAR's. From there the two are one trajectory.
A window W gives the full-history value at bar i exactly when the seed `i - W` has merged by i.

All of it was measured offline over two sets of series, at step 0.02 and max 0.2:
- **The captured series.** The 62 distinct series in the vendor harness at #1472's head, plus the
  licence-held captures (read in place, never copied), deduplicated by symbol, timeframe, length and
  first bar.
- **A local sample.** 280 series from the local bars store (`C:\data\bars.db`, read-only): 40 per
  timeframe at 1m, 5m, 15m, 30m, 60m, D and W, chosen with a fixed seed.

Truth is the full-history loop from each series' first bar, as `sar.test.js` grades it. The scripts
were scratch measurement scripts; nothing of them is committed.

| | value |
|---|---|
| series | 342 (62 captured, 280 local) |
| bars | about 1.1 million |
| worst merge distance, captured | 280 (NYSE:RDDT 15m, seed 4967), then 199 (BITSTAMP:BTCUSD 1D), 174, 173 |
| worst merge distance, local sample | 265 (META 15m), 255 (CRM 15m), 253 (BCBP D), 250 (SPY 1m), 222 (TSLA 30m), 213 (JPM 60m), 211 (PLTR 5m), 193 (BRC W) |

**Designs graded on every bar of all 342 series.** A design is wrong where it publishes a value or
direction that is not the full-history one.

| design | published | wrong | withheld |
|---|---:|---:|---:|
| W = 200 (the old window) | 1,107,963 | **312** (GLD 5m 52, SPY 1m 50, GOOGL 15m 49, RDDT 15m 43, UBER 30m 38, TSLA 30m 22, ...) | 0 |
| W = 300 | 1,073,763 | 0 | 0 |
| **W = 400 (chosen)** | **1,039,563** | **0** | 0 |
| W = 600 | 971,318 | 0 | 0 |
| W = 200, published only where the 400 window agrees | 1,039,251 | 0 | 312 (exactly the wrong ones) |
| W = 400, published only where the 200 window agrees | 1,039,251 | 0 | 312 that W = 400 alone got right |

## Why 400

**Margin.** 400 is 1.43x the worst merge distance measured. 300 leaves 1.07x. 600 would push the
lookback (602) past the 550-bar budget cap (`budget.js::DEFAULT_BUDGET.maxLookback`).

**A certificate is dominated.** Publishing only where two windows agree publishes exactly the bars
W = 400 publishes, minus 312 right ones. It needs the same 401 bars of history, runs the recurrence
twice, and is no proof either (below).

**Compute is unchanged.** Both lanes run the recurrence as MERGED windows: each window steps only
until it joins the held trajectory. Simulated with the same algorithm over the long captured
series:

| W | state steps per bar (455,358 bars) |
|---|---:|
| 200 | 25.85 |
| 400 | 25.55 |
| 600 | 25.23 |

**What W = 400 does cost:**
- **The first value.** It appears at bar 401 instead of 201. That leaves 8% of a 5,000-bar chart
  blank; a 632-bar daily listing keeps 231 published bars.
- **Fetch depth.** Alerts and scans fetch the lookback, 402 bars instead of 202, inside the cap.

## What no finite window can do

SAR's memory is unbounded in one regime: a stretch where price sets no new high or low and the SAR
never flips. The local store holds a series of identical bars (MSTR 5m, a test series). There, every
seed agrees with every other, the full history (started before the stretch) differs, and no window
or certificate can tell. `SAR_NOTE` now says so:

> During a long stretch where price sets no new high or low and the SAR never flips, it can still
> differ from a chart that started further back.

That series is a constant test series, not a market. None of the 342 graded series has such a stretch.

## Saved documents

A formula document stores its expanded tree and has no engine stamp. `savedScriptUpgrade.js`
re-translates Pine script documents from their source and does not reach formula documents. So, per
the coordinator's ruling (option (a)):

- **Read-back.** A stored 200-bar SAR tree is recognised as the `sar(step, maxStep)` the member wrote
  (`recogniseExpansion`, against `SAR_LEGACY_WARMUPS = [200]`). It carries its own note
  (`sarLegacyNote`): the 200-bar start, the measured 312 of about 1.1 million bars, and that saving
  again moves it to 400.
- **Evaluation.** Every lane (chart, alerts, scans, the Python twin) evaluates the stored tree as
  stored, so such a document keeps the 200-bar values until it is saved again.
- **Re-save.** It collapses to the call and re-expands at 400 (`sar.test.js` asserts it).
- **Open.** The load-time rewrite of stored 200-bar trees is an engine-gap row:
  `docs/pine/capture-queue-2026-11-16-sar-window.md`, "sar() saved-tree upgrade".

## Rails (`app/src/components/chart/engine/ast/sar.test.js`)

- **The KNOWN `it.fails` is an `it`.** `vw-lower-tf-bars-rddt-15` equals the full-history SAR on every
  published bar, and it is graded in the "every distinct captured series" rail like every other series.
- **A control pins the OLD window on that series by name.** Built with `sarTrees(..., 200)`, it shows
  43 bars at 5167-5246, 17 wrong in value and direction, 60 counted. The series stays a witness that
  200 was not enough.
- **Legacy reading.** A 200-bar tree reads back as `sar` / `sarDirection` with `legacyWarmup: 200` and
  the legacy note. Re-saved, it is the 400 tree.
  - Control: a 300-bar tree (a window nobody saved) is not recognised.
- **Left-edge rails follow `SAR_WARMUP`.** The missing-low rail moves its hole past the 400-bar warm-up.
  The synthetic rail's series grow 900 -> 1000 bars, so 80 series still publish more than 40,000 bars.
- **Both lanes stay pinned.** `tests/test_call_expansions_parity.py` holds the Python twin to the same
  trees, byte for byte.
