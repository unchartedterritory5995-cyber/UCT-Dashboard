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
- B1 (corrected r1): of the 39 door `pine:no-output` rows in the old sole-55 drawing bucket, 36 attempted and dropped ops (`dropped`),
  2 attempted none (`never-attempted`: builtin:pivot-points-standard, builtin:trading-sessions), and 1 attempted 110 and dropped 0
  (`no-output-other`: committed:correlation-matrix). The earlier "0 zero-attempt" claim was false. T1's measure-pair set is the 36
  rows with attemptedOps>0 and droppedOps>0, not 39. The two zero-attempt and the one no-output-other row end with named item walls
  (`label.new`, `line.new`) rather than the new buckets (named beats bucket), so `[drawing-no-output-other]` touches 0 hides that one row.
- Map headline transfer 212 (31.2%), runtime-on 260. Against W0 (218 / 268) the -6 / -8 is entirely W9-T0's `places_orders` predicate (8 order-placing strategies newly carry `[strategy]`); per-script door verdicts: 0 diffs.

## Rails and mutations
`tests/test_pine_coverage_w3w4_t0_honesty.py` (11) + vitest `W3W4-T0: dropHeads` (2). `mut.py`: P0 and J0 no-op controls green; P1..P8, J1, J2 all red (killed). Log `mut.out` under runs/w34-t0.

## Final-tip (full, 1 shard) on 24edd414e3: rc gate=0 hyg=1 py=0 js=1, totals ok, integrity ok
- hyg=1 was the 6.1 MB wall-detail JSON (5 MB limit); fixed by compact JSON (3.9 MB) in the next commit, hygiene re-run alone: clean; the 3 pine pytest files: 44 passed.
- js failures: baselines pollingSites, settingsScope, enumerationSites, controlDoorCensus, coverageAudit; plus vendorHarness.test.js
  (tolerancePolicy float 0.000049999999999999996 vs 0.00005, a file this lane does not touch).

## Declared out of scope (r1): spec item 6, the `drawing-build-empty` tag and its rail 4
Not built. W34-D2 found the drawing build DOES lower ops, and that the door's value-build re-probe hid the refusal; so a tag keyed on
"the drawing build declined with zero ops lowered" would label a decline the census cannot attribute to that build, and would be a
wrong-reason label. Item 6 waits for D2's finding to be fixed in the probe (or for the census to probe the drawing build directly).
`masterSha` in the map reads 3ca4b0d358; the census tree was 299a1a77cb (c855e8cadf plus the W9-T0 branch), both engine 18.

## Full final-tip on 670f6a95f8 (after master merge): rc gate=0 hyg=1->see below py=0 js=1, totals ok, integrity ok
jsfail: controlDoorCensus, enumerationSites, vendorHarness, settingsScope, pollingSites (baselines), usePreferences.additionsOnly (master's TodayHome.jsx, recorded),
vendorHarness.coverageAudit (delta-rsi-oscillator-strategy runtime-pane; re-run alone: 1 failed, 184 passed; not a file this lane touches).
ready-check: FAIL on coverageAudit only.
