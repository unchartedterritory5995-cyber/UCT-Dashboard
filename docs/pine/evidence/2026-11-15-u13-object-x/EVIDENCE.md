# Vendor harness: drawing-object x graded (U13, ruling G1)

Branch `feat/pine-harness-object-x`, on master `e67164172c`. Tooling only: no engine file changes,
no engine output change, no `SCRIPT_ENGINE_VERSION` bump.

## Why
Objects v2 (`docs/pine/evidence/2026-11-12-objects-v2`) graded a drawing's prices, style, text and
colour, never where on the time axis it sits: a line on the wrong bar at the right price passed.
Coordinator ruling G1: the `obj:line`, `obj:label` and `obj:box` families are admitted only once x
is witnessed and graded, not on y alone.

## What the captures hold (step 1)
Scanned every capture with object records: 213 under `tests/fixtures/vendor`, 245 in the
licence-held store (local only).
- Lines `x1`/`x2`, labels `x`, boxes `x1`/`x2` are small integers in every record (9,279 line, 8,215
  label and 4,053 box records in the fixtures). None is a time (no value near a millisecond epoch).
- No record carries an `xloc` key. Lines carry `ex` (extend: `n`, `r`, `b`, `l`), boxes `ex`
  (`n`, `r`); both were already graded.
- The integers are positions in the study's own `_indexes` array, whose entries are model bar
  indices. Measured 2026-09-08 (`tests/fixtures/vendor/visual/object-semantics-spy-1d-2026-09-08.json`):
  `_indexes = [259, 264, …, 299]`, the anchor line's `x1 = 4, x2 = 10` resolve to model bars 279
  and 299, the 20 bars `bar_index - 20 .. bar_index` asks for.
- **No harness capture records that table.** `objects` holds `counts`, `records`, `texts`,
  `unreadable` only, in all 458. So no existing capture can have its x graded. The "rank of the
  distinct x values" reconstruction was tried on 2026-11-12 and not adopted (5 of 93 agreed).

## The change
- `tools/vendor_harness/tv_capture.js` `readXIndex`: records `objects.xIndex`: the table, the bar
  time at each entry, the model indices of the loaded bars, and the path it was found at. The
  probe did not name the object the table hangs off, so the graphics object and the data source are
  searched (two levels into own `*graphics*` objects) through property descriptors only: no getter
  runs, nothing is called. Not found and ambiguous are recorded as such, with the keys looked at.
  `capture()`'s summary carries `objectsX` so the capturer sees it on the first capture.
  (`docs/pine/capture-procedure.md`, "THE OBJECT x TABLE".)
- **Confirmed location: `graphics()._indexes`.** Capture session S10 (2026-11-15) read it as
  `g._indexes` into xmap sidecars and verified the mapping 96/96 (RDDT) and 503/503 (SPY) against
  printed `bar_index` labels. Its model indices start NEGATIVE on a real chart (RDDT 1D:
  `firstBarIndex = -366`, 666 bars), so `k = index - firstBarIndex`, never `index` itself.
  `readXIndex` reads that path first, as an own data property, and falls back to that one named
  property if it is an accessor.
- **xmap sidecars** (`<run>/xmap/<capture id>.json`, S10's format): `harness.js::loadCapture`
  attaches one BESIDE its capture (never into it: the receipt covers the capture's bytes), and
  `objectRecords.js` grades x through it when the capture has no table of its own. It is trusted
  only when it names the same capture, its `barIndex = indexes - firstBarIndex` arithmetic holds,
  its first bar time is the capture's and its bar span equals the capture's bar count; and each
  entry's time must equal the capture's bar. All 15 S10 sidecars pass those checks.
- `compare.mjs` `OBJECTS_V2_FIELDS`: x fields of kind `x`: lines `x1`, `x2`; labels `x`; boxes
  `left` (`x1`), `right` (`x2`). `compareObjectsV2` tallies x apart from the other fields and
  returns `verdict` (with x) and `verdictWithoutX` (the pre-U13 grade, same run).
- `objectRecords.js`: both sides resolve to `k`, the bar's position in the capture's own
  `bars.rows` (future bars count on past the last one). Vendor: `xIndex.indexes[x] - first model
  bar`, cross-checked against the table's own time. Ours: the bars our object lane ran on
  (`ourSide.js` `objects.xFrame`, set for both lanes: the host object lane and the runtime RT5
  object store), minus the replayed prehistory; `xloc.bar_time` lands on the bar whose span holds
  it, by the render state's own clock (`makeBarClock`). Exact bar alignment. y keeps the
  comparator's tolerance.
- States: `agree`, `differ`, and `xMissing` (with a reason: no x table, table not found or
  ambiguous, model bars not lining up with the capture's bars, our x `na`, our `bar_time` off the
  loaded bars, our side without a frame). `xMissing` is never agreeing: a v1 MATCH whose paired
  lines, labels or boxes have any `xMissing` x and no difference is **INCONCLUSIVE**; any x
  difference is DIVERGE. Tables, cells and fills have no x and grade as before.
- `objectsV2Regrade.measure.test.js`: `PINE_OBJECTS_V2_DIR` re-grades another directory (the
  store); reports v1, v2 without x, v2 with x, and every capture x moved.

## Re-grade (step 4)
Same run, `verdictWithoutX` is the pre-U13 v2 grade. Check against the committed runtime-on
snapshot: 367 of 369 captures identical; the 2 others are `atr-support-and-resistance` rddt and spy,
the known stale rows (engine-54 object rail, REMAINING-SCOPE §1.5).

| set (captures with object records) | v1 M/D/I | v2 without x M/D/I | v2 with x M/D/I | moved by x |
|---|---|---|---|---|
| fixtures, production (213) | 81/31/15 | 77/35/15 | 10/35/82 | 67 MATCH -> INCONCLUSIVE |
| fixtures, runtime-on (213) | 100/32/16 | 96/36/16 | 10/36/102 | 86 MATCH -> INCONCLUSIVE (15 runtime-drawn) |
| store, production (245) | 46/11/6 | 45/12/6 | 7/12/44 | 38 MATCH -> INCONCLUSIVE |
| store, runtime-on (247) | 52/17/9 | 51/18/9 | 7/18/53 | 44 MATCH -> INCONCLUSIVE (5 runtime-drawn) |

(Captures without a v1 objects grade are not counted in the M/D/I columns.)

- **Every move is MATCH -> INCONCLUSIVE, and every one has the same cause: the capture records no
  x table** (`xMissing` reasons: 100% "the capture records no x table (taken before U13)").
- **0 x differences, 0 MATCH -> DIVERGE** in this pass. None was possible: none of these captures
  holds a table. A capture gap, not an engine finding (the sidecar pass below found two).
- The MATCHes that stay MATCH (10 / 10 / 7 / 7) pair no line, label or box: tables, cells and
  fills only, which are pane-anchored or carry no x.
- Every DIVERGE stays DIVERGE (a wrong price is a wrong price, with or without x).

### Re-grade with the S10 / S11 xmap sidecars (the store, later the same night)
Sessions S10 and S11 (2026-11-15) wrote xmap sidecars for 57 store captures. Store re-grade
(326 captures, runtime-on; production identical in the x columns):

- v2 with x: 8 MATCH / 43 DIVERGE / 64 INCONCLUSIVE (without x: 53 / 43 / 19). 45 MATCH ->
  INCONCLUSIVE, 0 MATCH -> DIVERGE.
- **x actually graded on 7 captures, 146 x fields, 43 differ.** All 7 are drawn by the host lane;
  none is runtime-drawn, so none is U1 evidence.
  - x agrees on every field: `vw-cs2-label-number-format` rddt (7/7, objects v2 MATCH with x),
    `vw-fmt-tie-readings` rddt (30/30; DIVERGE on a label text), `auto-trendlines-by-pivots` rddt
    (50/50; v1 INCONCLUSIVE), `zig-zag-channels-luxalgo` rddt (4/4; v1 INCONCLUSIVE),
    `support-resistance-fibonacci-retracement` rddt (6/6; DIVERGE on a line's y).
  - **x differs** (both already v1 DIVERGE, so no verdict moved, but each is a finding for engine
    triage): `relative-strength-index-divergences-libertus` rddt: all 39 paired labels on other
    bars (first: vendor bar 146, ours 26; TradingView holds 48 labels, we hold 39, so the
    newest-end pairing may be misaligning them as well). `smart-money-concepts-probability-expo`
    rddt: 4 of 10 line x (first: vendor bar 545, ours 655).
- Named x gaps: `inside-bar-setup` rddt (v1 MATCH -> INCONCLUSIVE): its 18 x sit at TradingView's
  off-chart timepoint `-2000000` (an `na` x, or one off the loaded bars), which is never graded as a
  bar. `williams-r-rsi-ema-tendance-silver-wong` rddt: 3 of our `bar_time` x fall on no loaded bar.

## U1 evidence with x graded (step 5)
Join of `plan-1114/objev.py` (runtime-drawn, runtime-on MATCH, objects v2 MATCH) over the U13
runtime-on verdicts, now also requiring `x.graded > 0`:

| capability | without x (captures / scripts / community) | with x |
|---|---|---|
| obj:line | 13 / 7 / 5 | 0 / 0 / 0 |
| obj:label | 11 / 7 / 4 | 0 / 0 / 0 |
| obj:box | 5 / 3 / 2 | 0 / 0 / 0 |
| obj:delete | 9 / 5 / 4 | 0 / 0 / 0 |
| obj:collection | 5 / 3 / 2 | 0 / 0 / 0 |

The without-x column reproduces `objev-all.json` exactly. With x, no family meets the admission
rule (>= 2 captures, >= 2 scripts, >= 1 community). No registry change is prepared.

## Re-captures needed (the coordinator's session)
- **First, the 15 U1 evidence captures** (S1 rows 18-23 and their probes): fibonacci-dolphintradebot
  rddt/spy, inside-bar-range-mother-candle rddt/spy, parabolic-sar rddt, renko-candles-overlay
  rddt/spy, trend-targets-algoalpha rddt/spy, wyckoff-accumulation-distribution rddt/spy,
  vw-forin-collections rddt, vw-int-array-avg spy, vw-int-array-avg-neg spy, vw-loop-in-block spy.
- Then every capture whose paired lines / labels / boxes now read `xMissing`: 115 distinct
  captures (100 committed fixtures; 53 in the store, of which 15 exist only there), 97 of them
  moved MATCH -> INCONCLUSIVE in at least one lane. Script x symbol x timeframe list:
  `runs/u13-scratch/recapture-list.json` (local).
- On the first capture of the session, check `objectsX.found` (capture-procedure.md). If the table
  is not where `readXIndex` looks, stop object captures and fix the snippet first.

## Rails and mutations
`vendorHarness.objectsV2.test.js` (x block, sidecar block) and `vendorHarness.test.js` (the x-table
double). Each mutant below was applied to a saved copy, run, and restored (sha checked); every one
turned its rail red against a green control:

| mutant | rail |
|---|---|
| M1 every x agrees (x ignored) | objectsV2: wrong bar at the right price DIVERGES |
| M1b vendor x read raw as a bar | objectsV2: the vendor x is a POSITION in the table |
| M2 a missing x does not block MATCH | objectsV2: no x table is INCONCLUSIVE |
| M2b a missing x read as agreeing | objectsV2: no x table is INCONCLUSIVE |
| M3 not found recorded as an empty found table | tv_capture double: not found is said |
| M4 a getter runs (no descriptor read) | tv_capture double: read-only |
| M5 the sidecar ignored | objectsV2: graded through its xmap sidecar |
| M6 a sidecar for another capture trusted | objectsV2: a sidecar for another capture is not trusted |
| M7 the `_indexes` accessor fallback dropped | tv_capture double: accessor read by that one name |
