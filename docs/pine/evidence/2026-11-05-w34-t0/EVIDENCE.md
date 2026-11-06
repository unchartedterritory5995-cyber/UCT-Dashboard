# W3W4-T0 census honesty: evidence (desktop, 2026-11-05)

Tooling only. Engine bump: no. Branch `feat/pine-w34-t0-census` (W9-T0 branch merged in; re-merge origin/master once W9-T0 lands there).
Census run on master c855e8cadf (engine 18) + this tree; sample 967 scripts, both lanes; harness 336 captures fresh.
Run 1 (`job.sh`) lost the runtime-on census to a vanished node_modules junction (another lane removed the worktree it pointed at);
production census (967 rows) was kept; `job2.sh` re-ran runtime-on + maps + targets + detail.

## Instrument
- A door `pine:no-output` / `pine:objects-only` means zero SURVIVING ops. `walls_of` now reads the step's own attempted/dropped counters
  on refused step 0 and tells apart: dropped (op + host guard named, `object op dropped: guard:create <- pine:state`, capability = that guard's),
  never attempted (`[drawing-never-attempted]`), no-output other (`[drawing-no-output-other]`). Withheld paint with a clean program = `[paint-withheld]`.
- `coverage-map.json` carries `objectProgram {attemptedOps, droppedOps, split}` per script; runtime-on `attachedDirtyWalls` names the 8-ish host-dirty scripts' walls.
- Census test records `dropHeads` (op@line: guard, no message text). `wall_detail.py` writes `docs/pine/census/wall-detail-2026-11-05.json` (identifiers/counters only).
- `w3ObjectWhy.measure.test.js` now translates with the member door's strict options (review N2a).
- Not done (left out by design): W9 strategy logic untouched (reused as merged); the screener why file is not retired.

## Corrected counts (same census rows, OLD vs NEW walls_of; see analysis.txt)
- `[drawing-objects]` sole: 55 before -> 3 after (doc said 56: master moved). Of the 55: 6 -> `[paint-withheld]`, 1 -> `[drawing-never-attempted]`,
  3 stay, the rest (45) now carry named dropped-op walls (single: create:label <- pine:text-value 2, others 1 each; many are multi-wall).
- `[imperative]` sole: 39 before -> 39 after (doc said 41). The imperative bucket was not mis-bucketed by this; unchanged.
- B1: of the 39 door `pine:no-output` in the drawing bucket, every one has attemptedOps>0 and droppedOps>0 on the door lane (0 zero-attempt there); the 2 zero-attempt
  rows in the screener why file do not reproduce on the member door. New `[drawing-no-output-other]` touches: 0.
- Map headline transfer 212 (31.2%), runtime-on 260.

## Rails and mutations
`tests/test_pine_coverage_w3w4_t0_honesty.py` (11) + vitest `W3W4-T0: dropHeads` (2). `mut.py`: P0 and J0 no-op controls green; P1..P8, J1, J2 all red (killed). Log `mut.out` under runs/w34-t0.
