# Capture queue — 2026-09-30 C40, `for … in`, `<family>.all`, the cap `while`, a sized drawing list

Branch `pine/c40-forin-collections`. One probe, `tools/visual_conformance/probes/vw-forin-collections.pine`,
for the parent session to run on the live TradingView rig with `tools/vendor_harness/tv_capture.js` — same
procedure as `docs/pine/capture-queue-2026-09-28.md` (visibility gate, **Create new ▸ Indicator**, "Add to
chart" binding gate, `__uctVH.capture({...})`, chunks, `verify_capture.mjs --assemble`). Capture id
`vw-forin-collections-rddt-1d-<date>`, NYSE:RDDT 1D from the listing, inputs at defaults (none), after the
close. A runtime error is itself a reading: record its text and the bar it names.

The mechanism and the refusals these rows settle are in
`docs/pine/vendor-harness/objects-triage-2026-09-28.md` § C40 and
`app/src/components/chart/engine/ast/pineObjects.js` (the C40 section above `forInPlan`).

## What is already witnessed

`trend-lines-supports-and-resistances-rddt-1d-2026-09-28`: TradingView ran `for [i, v] in downtrends` over
two elements and applied the body to both, and read the body's `if` per element of `uptrends`
(`vendorHarness.c40ForIn`). `vw-object-gc-d`: `label.all` / `box.all` / `line.all` hold the family's live
objects oldest first, same-bar creates included.

## The rows

| rows | question | what the engine does today | what the capture changes |
|---|---|---|---|
| F01, F02 | CONTROL: five passes in index order over five lines (position `i` = 0 for the oldest); zero passes over an empty list | served (`loop` with `asc`) | must read 5 and 0, with `x2 = bar_index + 1 + i` — or the capture is not read |
| F03 | a body that **shifts** the list it walks: passes, and which lines are left | refused by name — `forInRefused: the body changes \`x\`, the list it walks`, the loop keeps `loopBlocked` | 5 passes and no line left ⇒ the walk is over the list as it stood at entry; 3 passes and `y = 23, 24` left ⇒ over the live list. Either reading can then be built: the reader's `bodyMayWriteList` check becomes the rule instead of a refusal |
| F04 | a body that **pushes** onto the list it walks | refused (same sentence) | 3 ⇒ fixed at entry; 13 ⇒ live |
| F05 | a body that **replaces** a later slot before the walk reaches it | refused (same sentence) | `y = 52` moved ⇒ the walk holds the elements it started with; `y = 59` moved ⇒ it reads each slot when it gets there |
| A01, A03 | CONTROL: `array.size(box.all)` is 5, then 4 after a delete | — (a size read of `.all` is not served) | must read 5 and 4 |
| A02 | is the array `box.all` returned a snapshot? | not read | 5 ⇒ snapshot; 4 ⇒ the live list |
| A04, A05 | `for b in box.all → box.delete(b)` over four boxes | the object run **stops** — `OBJECT_UNWITNESSED`, nothing drawn — when the family holds two or more and the body deletes or creates one (`objectRuntime.js`, the walk) | 4 passes and 0 left ⇒ serve it as a walk over the entry list (delete the `items.length >= 2` stop); 2 passes ⇒ serve the live reading. Scripts: trend-lines `f_clearAll` on a live chart, every "delete all" helper |
| A06 | an object's position in `box.all` | refused by name — `forInRefused: a position in \`box.all\` is read` | texts `0, 1, 2` oldest first ⇒ serve the counter where the program lost no create of the family |
| W01 | CONTROL: `while array.size(a) > 2 → label.delete(array.shift(a))` after a burst of four | served (`loop` with `cond`) | must read 2 passes with `W2`, `W3` left |
| Z01–Z03 | a drawing list created **with slots**: `array.new_label(3)`, then `label.delete(array.get(a, i))` / `array.set(a, i, label.new(…))` every bar | not modelled: the list is diverged from its creation (`collsDivergedWhy: coll:sized@<line>`), every read of it withheld and counted | size 3 on every bar, exactly three labels held (`Z0`–`Z2` of the last bar), slot 0 at the last bar ⇒ model the creation size as that many `na` slots (`colls[].size`) and lift `coll:sized` — a literal size first; a size that is an expression needs its value at the declaration bar |

## Scripts with no capture that this lane changes

None of them attaches at the member door (each stops on another wall — § C40's table), so nothing new is
drawn for a member today; they are listed because their loops are now read, and a capture would grade them
when their other walls clear. On NYSE:RDDT 1D, inputs at defaults, from the listing:

| script | what this lane now reads | grade when it draws |
|---|---|---|
| `smt-divergence-ict-killzones` | `for b in fut_boxes → box.delete(b)` ×2; `while array.size(smt_lines / smt_labels) > max_objects` | boxes, lines, labels and their texts |
| `elliot-wave-detector-pro` | `for ln in fibLines` / `for lbl in fibLabels` in `drawFibLevels` | fib lines and labels |
| `smart-money-breakout-channels-algoalpha` | `for ln in gaugeLines → ln.delete()` | gauge lines |
| `volume-footprint-measuring-classical-indicators-by-math-geometry-intro` | `for ln in profImbLns` / `for mlb in profMrgLbs` | profile lines and labels |
| `renderingnature-smc-reversal-engine-v71` | `while array.size(historicalTrendlines) > maxTrendlines` (carried); the `eventLabels` / `zzLines` caps (behind their blocks' guards) | trend lines, event labels, zigzag |
| `smart-money-concepts-by-welotrades` | `display_limit_line` / `display_limit_boxes` (`while array.size(_array) > _limit`) | every capped list |
| `trendline-pivots-quantvue` | `for l in utlArray` / `for l in dtlArray` | trend lines, cross labels |
| `stop-loss-clustering-breakouts-kioseff-trading` | `for data in gradXRAY` (a sized list — `coll:sized`) | gradient boxes |
| `market-structure-break-order-block` | refused by name: `for bull_ob in bu_ob_boxes` whose body shifts the list (F03), on lists created with five slots (Z01) | order-block boxes |
| `support-and-resistance-logistic-regression-flux-charts` | unchanged — `for curSR in allPivots` is a list of user types | lines and labels |
