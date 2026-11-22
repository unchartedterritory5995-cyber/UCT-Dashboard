# U1 + U3: capability admission rows, measured (2026-11-15)

Plan: REMAINING-SCOPE-2026-11-14 section 2, rows U1 and U3. A registry + policy slice. No engine
change to what the door mints, and no `SCRIPT_ENGINE_VERSION` bump. `PINE_RUNTIME_CAPABILITY_ADMISSION`
stays `off` by default, so production is unchanged until it is armed.

## How it was measured (current master `5819d9363e`)

1. Vendor harness over `tests/fixtures/vendor` (584 captures; the S1 to S11 sessions are in it), both
   lanes. These runs replace the committed snapshots `docs/pine/vendor-harness/{runtime-on,production}/`.
   Against the 369 captures of the old snapshot only 2 verdicts moved: `atr-support-and-resistance`
   rddt/spy, MATCH -> INCONCLUSIVE. That is the known stale pair (the engine-54 object rail; REMAINING-SCOPE 1.5).
2. `capability_admission.py input`, then `capabilityAdmission.measure.test.js` `CAPADMIT_MODE=lanes`
   (which captures the RUNTIME lane draws) and `=admission` (the member door with admission on).
3. `capability_admission.py evidence` (ledger included: **no licence-held ledger row contributed**)
   joined with the objects v2 grade of every capture: `runs/evidence.json`.
4. The registry rows below, then `input` + `admission` + `report` again: `runs/census.json`,
   `../2026-11-13-capability-admission/runs/report.json` (the REACH run).

## The rule (unchanged, plus three additions)

The rule is still: at least 2 MATCH captures from at least 2 DISTINCT script families, at least 1 of
them a COMMUNITY script, each drawn by the runtime lane with the runtime pane on. On top of that:

- **`obj:*`: records paired.** Each counted entry also carries `objectsPaired > 0`. For line, label,
  box, table and linefill this is the family's OWN paired records; for delete, collection and getter
  it is every paired record. A MATCH with `pairedNothing` compared nothing, and 142 runtime-on objects
  v2 MATCHes are exactly that. This dropped 3 captures that the 11-14 `objev.py` counted:
  `fair-value-gap` rddt and `wyckoff` rddt/spy for `obj:line`.
- **`obj:*`: an x DIVERGE vetoes the family** (`objectsX: DIVERGE` on any entry). Where a U13 x grade
  exists, it is recorded on the entry (`objectsX`, `objectsXCapture`) and held to `runs/x-grades.json`.
- **`realtime-state` admits only with `scope: closed-bar-history`** (ruling (b), G6). See below.

## x grades (U13, PR #1335 at `484ff2c5a5`, not merged)

- Only one evidence script has an x-capable re-capture: `fibonacci-dolphintradebot` rddt, from S14
  (`fibonacci-dolphintradebot-rddt-1d-2026-11-15`). Its source sha256 is the same as the 10-02 evidence
  capture's.
- Graded runtime-on by #1335's harness, through its xmap sidecar: runtime lane, objects v2 MATCH,
  **x 21 graded / 21 agree / 0 differ** (lines x1/x2 7+7, labels x 7).
- Recorded on that capture's `obj:line`, `obj:label` and `obj:delete` entries.
- **No x grade DIVERGES for any family.** Every other evidence capture predates the x table, so it is
  y-graded only (ruling G1).

## Admitted

| capability | captures / scripts / community | evidence scripts (community in bold) |
|---|---|---|
| obj:line | 14 / 9 / 7 | **AlgoAlpha Trend Targets, FVG Finder, Fibonacci Retracement (x MATCH), IBRBVC, Renko, Trendline Pivots, ZZMTF**; probes VW_FORIN, VW_INT_ARRAY_AVG |
| obj:label | 15 / 11 / 8 | **AlgoAlpha Trend Targets, FVG Finder, Fair Value Gap SpaceManBTC, Fibonacci Retracement (x MATCH), Renko, SAR, Trendline Pivots, ZZMTF**; probes VW_FORIN, VW_INT_ARRAY_AVG, VW_LOOP_IN_BLOCK |
| obj:delete | 12 / 8 / 7 | **AlgoAlpha Trend Targets, Fair Value Gap SpaceManBTC, Fibonacci Retracement (x MATCH), IBRBVC, Renko, Trendline Pivots, ZZMTF**; probe VW_FORIN |
| obj:collection | 8 / 6 / 5 | **AlgoAlpha Trend Targets, Fair Value Gap SpaceManBTC, Renko, Trendline Pivots, ZZMTF**; probe VW_FORIN |
| obj:getter (U3) | 5 / 4 / 2 | **Fair Value Gap SpaceManBTC, Trendline Pivots** (S1); probes VW_FORIN, VW_INT_ARRAY_AVG |
| obj:linefill (U3) | 3 / 2 / 2 | **FVG Finder** (S1), **AlgoAlpha Trend Targets** x2 |
| switch (U3) | 3 / 2 / 2 | **Fibonacci Retracement** x2, **FVG Finder** (S1) |
| for-in (U3) | 2 / 2 / 1 | **Trendline Pivots** (S1); probe VW_FORIN |
| max_bars_back (U3, ruling (a)) | 5 / 3 / 3 | **Fibonacci** x2, **Renko** x2, **ZZMTF** |
| realtime-state (U3, ruling (b), closed bars only) | 7 / 5 / 3 | **Fair Value Gap SpaceManBTC, Renko** x2, **ZZMTF**; probes VW_FORIN, VW_INT_ARRAY_AVG x2 |

The full per-entry list is in `runs/evidence.json` and in the registry rows.

## Not admitted (measured shortfall)

| capability | measured | why not |
|---|---|---|
| **obj:box** | 6 / 4 / 3 (**Renko, Wyckoff, Fair Value Gap SpaceManBTC**; VW_FORIN) | **passes the rule, WITHHELD by coordinator ruling 2026-11-15**: the v4 default border colour bug below. Absent from the registry, with the reason in its `_readme`; railed (`test_A7_obj_box_waits_for_version_aware_object_defaults`) |
| udt | 1 / 1 / 1 (Trendline Pivots) | one script |
| generics | 2 / 1 / 0 (one probe family) | one family, no community script |
| calc-bars | 2 / 1 / 1 (Wyckoff) | one script |
| collections:matrix | 0 | the one candidate (one-sided-gaussian, S1) is runtime-on INCONCLUSIVE |
| obj:table | 0 | no runtime-drawn capture with tables paired (G2) |
| method-def, enum, collections:map | 0 | no runtime-drawn candidate in the sample (wait for U8) |
| conditional-ta | 8 / 5 / 5 | owned by COND-TA (U2); stays `divergent` |
| request-other (not in scope) | 1 / 1 / 1 | one script |

RS Rating (`rs-rating-fred6724`): the committed rddt/spy/nvda captures grade runtime-on INCONCLUSIVE on
master (`pine:request` refused). The s13 ALAB/CRWV `MATCH_SUBSTITUTED` grades are not committed, and by
design (RS-RATING-TRANSFER.md L7) they never count as MATCH for admission, so nothing was folded in.

## G6: realtime-state for closed-bar history only

- **Registry:** `rollout_gate.pine_capability_admission` refuses a `realtime-state` row without
  `scope: closed-bar-history`. `admitted_capabilities()` names the restricted ids in `historyOnly`.
- **Server:** `runtime_admission` adds `historyOnly: [...]` to an admitted verdict whose script uses one.
  If the capability set cannot be re-read, it answers pending, never admitted.
- **Browser:** `runtimeKill.js` latches the restriction as one boolean. A malformed value fails closed.
- **The refusal:** `runtimeFormingRefusalOf` refuses the script BY NAME (`pane:forming-ungraded`) unless
  `newestBarIsForming === false`. A forming bar and an untold bar each get their own member sentence.
- **Where it is asked:** at all three run doors, on every run: runtime documents
  (`runtimeColumnsOrReasons`), run halves (`withRunHalf`, `objectLoss.js` sentence) and run-read colours
  (`withRuntimeColours`).
- **Who is exempt:** the graded allowlist and the test grant are never asked.

## Census, before -> after (member door, admission ON; the registry as merged, obj:box withheld)

Re-run after the obj:box ruling, one lock hold (`input` + `CAPADMIT_MODE=admission`): `runs/census.json`
`final`. The first measurement, with the obj:box row, is kept there as `withObjBox`.

**Sample of 679 scripts:** admitted 141 -> 200 (with obj:box it was 220). Runtime lane fully drawn:

| population | before | after | with obj:box |
|---|---:|---:|---:|
| committed | 7 | 10 | 11 |
| reference | 4 | 6 | 6 |
| builtin | 4 | 5 | 5 |
| **total** | **15** | **21** | **22** |

**Newly fully drawn by the runtime lane: 6**, each refused before:
- committed: inside-bar-range-mother-candle (obj:line, obj:delete), parabolic-sar (obj:label),
  zigzag-multi-time-frame-with-fibonacci-retracement;
- reference: auto-fibonacci-and-gann-fan, best-sr-indicator-with-candlestick-patterns;
- builtin: linear-regression-channel.

**What the ruling changed:** `order-blocks` (committed) is no longer drawn: it draws boxes. Its rddt
capture and the `vw-forin-collections` probe capture also leave the runtime lane.

Two of the six (linreg, zigzag-mtf) read bar state, so they draw on closed bars only. The count of 6
reads RT5's provenance sentence as a disclosure. Counted strictly as a "not drawn" note (analyse.py's
way), the number is 1: inside-bar-range.

**Newly partial (named undrawn parts): 2.** order-block-finder (per-bar colour shapes, a plot fill)
and uptrick-volatility-adjusted-trail (a plot fill).

**Lost: 0.**

**Captures:** admitted 167 -> 238 (with obj:box: 263); runtime-drawn 15 -> 21 (23). The 6 new
runtime-drawn captures:
- MATCH: inside-bar-range rddt + spy, parabolic-sar rddt, zigzag-mtf rddt, vw-loop-in-block;
- INCONCLUSIVE: vw-clock-close-tfchange.

**Newly PROVEN community scripts: inside-bar-range-mother-candle, parabolic-sar, zigzag-mtf.**

**REACH:** 0 runtime-lane DIVERGE under admission, 0 MATCH -> DIVERGE (`report.json`).

## A real engine bug found (not fixed here)

`inside-bar-boxes` rddt (S2-era capture, Pine v4) is drawn by the runtime lane and DIVERGEs on objects:

- **What:** the default `border_color` of `box.new` without one is `#2962ff` on our side and `#2196f3`
  on TradingView. That is the v5/v6 `color.blue` served to a v4 script: the runtime lane's object
  default colour is not version-aware.
- **Not a REACH stop on its own:** the script also uses `varip`, which stays unadmitted.
- **But it is a known wrong drawing:** a v4 script that draws a default-coloured box and is admitted by
  capability would draw the wrong border colour. Every `obj:box` MATCH in the evidence sets its colours
  or is v5+.
- **RULING (coordinator, 2026-11-15): obj:box is WITHHELD** until runtime object defaults are made
  version-aware (from the same palette table engine 58 introduces). The row is dropped from the
  registry, and its `_readme` names the bug and this capture. `test_A7_obj_box_waits_for_version_aware_
  object_defaults` holds both, and also checks that this capture still shows the divergence it names.
  `test_A7_a_box_drawing_member_script_is_withheld` holds the door. Mutant U1-M8 (the row re-added)
  turns 4 rails red. Every generic `obj:*` rail stays.

## Rails and mutants

The rails are in `tests/test_pine_capability_admission.py` (A1, A7, A8, G6, REACH),
`runtimeFormingRefusal.test.js`, `runHalf.test.jsx`, `div4RuntimeReadPaint.test.js` and
`capabilityEvidenceLane.test.js`. The last one holds every new evidence id to the runtime lane, and the
reach run's lanes to the door: 319 tests.

**20 mutants, all KILLED, each restored from a saved copy and checked byte-equal** (`runs/mutants.json`).
- **U1-M1:** the objectsV2 requirement dropped.
- **U1-M1b:** the objectsLane requirement dropped.
- **U1-M2:** a pairedNothing capture counted as evidence.
- **U1-M2b:** the A8 evidence rail stops holding the paired count.
- **U1-M3:** a family admitted on probe-only evidence.
- **U1-M4:** distinct scripts counted as captures.
- **U1-M5:** the x-DIVERGE veto removed.
- **U1-M6 / U1-M7:** registry data overstates a paired count, or names an x grade the record does not hold.
- **G6-M1:** the scope requirement removed.
- **G6-M2:** the door drops historyOnly.
- **G6-M3:** the door fails open.
- **G6-M4:** the registry row loses its scope.
- **G6-M5:** the latch drops the restriction.
- **G6-M6:** a malformed historyOnly fails open.
- **G6-M7:** an untold bar read as closed.
- **G6-M8 / M9 / M10:** each run door stops asking.
- **U1-M8:** obj:box re-added to the registry against the ruling.

## 2026-11-16, landing train 1 (engine 59): obj:box re-pointed, still withdrawn

Object defaults are version-aware since engine 59 (legacy semantics B5), so the capture this ruling
names, `inside-bar-boxes-rddt-1d-2026-11-14`, no longer differs on any colour (50 boxes paired, 0 differing
fields, colours agree on 100 paired slots). It still grades objects v2 DIVERGE on the count of boxes held
(vendor 52, ours 50; master's row had the same count difference behind the colour), and its x is not graded
(taken before U13). Coordinator ruling 2026-11-16: obj:box stays withdrawn. The rail named above is now
`test_A7_obj_box_stays_withdrawn_on_its_box_count_and_ungraded_x`, and the registry `_readme` says the same.
