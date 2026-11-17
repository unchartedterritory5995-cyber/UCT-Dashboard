# DRAW-1 GC: the box count-at-cap carve-out narrowed to the shape no capture witnesses (2026-11-17)

Branch `fix/pine-draw-count-at-cap-gc`, cut from `origin/master` `2220931ff9` (engine 67). NUMBER PENDING.

## The regression

Engine 66 (#1482, `749d8dfd0c`) withheld every runtime-lane box family whose collector ran
(`objects:count-at-cap`). With `PINE_RUNTIME_STAGE=all`, that reached every member. On a long history where a
script's boxes run past `max_boxes_count`, the whole family was withheld, where TradingView keeps the newest N.

- Bisected by patrick-54 to `749d8dfd0c`.
- The failing rail is `runtime/__tests__/l4dArmShapes.test.js -t rs-arm-label-last-bar-spy`, which is local-only (it needs the licence-held s10 run).
- On SPY 1D, X01 drew 0 boxes where TradingView holds 503 (cap 500).
- No CI leg could see it: the rail is local-only, and no committed runtime-on verdict covered that shape.

## What the captures witness

C7 (`objectPool.js`): a create that takes a family past cap + 5 deletes the oldest until cap remain, sparing
this bar's creates and what a drawing variable holds. What the captures show about it:

| capture | shape | held, TradingView | C7 |
|---|---|---|---|
| rs-arm-label-last-bar-spy (s10, cap 500) | boxes never held | 503 | 503 |
| sonarlab-order-blocks spy / brk-a (cap 20) | boxes in arrays | 24 | 24 |
| vw-draw-count-at-cap spy / rddt (2026-11-16, cap 20; 2836 / 223 made) | lines never held | 22 / 25 | 22 / 25 |
| the same | labels in a `var`, never read through history | 22 / 25 | 22 / 25 |
| the same | **boxes in a `var`, moved through `myBox[1]`** | **20 / 23** | 22 / 25 |
| inside-bar-boxes rddt (cap 50, 158 made) | **boxes in a `var`, moved through `myBox[1]`** | **52** | 50 |

In the vw-draw-count-at-cap probe all three families are made on the same bars, so the box rows differ from the
line and label rows only by the shape that holds them.

## The fix

The box family is withheld only when its collector runs AND the script reads a past value of a variable holding
a box (`objectPool.js::historyHeldOf`):

- it reads the stripped source (`strippedForScan`, the same scan as the declared caps);
- a name counts when it is declared `box b` or assigned `box.new(...)`, and is read as `b[n]`;
- the result rides beside the caps (`objectCaps.historyHeld`) into the run's store.

Every other box family keeps C7, as before engine 66. Labels and lines were never carved out.

## Rails and mutants

Hold on the dev PC under the lock, tree `47f83df077`, clean:

- `runtime/__tests__/l4dArmShapes.test.js`, the whole file including the local-only s10 rows: **18 passed, 0 skipped**.
  - rs-arm-label-last-bar-spy X01 equals the vendor's newest boxes again (503 / 503 at cap 500).
- The focused rails: 50 passed.
  - `draw1CountAtCap` checks that C7 keeps the newest at caps 3 / 20 / 500, with exact counts. It also checks that the history shape is withheld, and runs `historyHeldOf` on the committed sources both ways.
  - The other files: `objectCollectorWithheld` r6 (neither lane withholds array-held boxes), `vendorHarness.b5ObjectDefaults` (inside-bar-boxes still withheld by name), `draw1DrawingObjects` and `draw1KeepHost`.
- The vendor harness on 34 selected captures, both lanes, against the committed snapshots: **no MATCH -> DIVERGE**.
  - The captures are the box evidence, inside-bar-boxes, vw-draw-count-at-cap, sonarlab x4, rs-arm-label x2, parabolic-sar x3, makuchaku, contraction-box, renko and vw-object-gc-a/b/c.
  - The only existing capture that moved is inside-bar-boxes runtime-on: DIVERGE -> INCONCLUSIVE, its boxes withheld by name.
  - Three captures newer than the snapshots (renko crwv, vw-draw-count-at-cap x2) grade INCONCLUSIVE; our side refuses the probe (`pine:state` / `runtime:object-op`).

Mutants, each restored from a copy (`git hash-object` equal), 6 of 6 killed:

| id | mutation | killed by |
|---|---|---|
| GC-M1 | the carve-out ignores the shape (the engine-66 behaviour) | draw1CountAtCap + l4dArmShapes (2 red) |
| GC-M2 | the collector keeps one fewer (cap + 4) | draw1CountAtCap |
| GC-M3 | the collector reaps the newest | draw1CountAtCap |
| GC-M4 | `historyHeldOf` never sees the shape | draw1CountAtCap (2) |
| GC-M5 | the front end does not hand the shape to the store | b5ObjectDefaults |
| GC-M6 | the carve-out never fires | draw1CountAtCap + b5ObjectDefaults (3) |

`l4dArmShapes` is added to the local-only licence-held rails the train's number step runs
(`docs/pine/LOCAL-ONLY-RAILS.md`).
