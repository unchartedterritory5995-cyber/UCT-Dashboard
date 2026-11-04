# EVIDENCE - W3 S1 round 2 (drawing objects, cell text), desktop re-home

Branch `feat/pine-w3-drawings`. Code tip `58dd37a20ca85f47dfb26085596ff6e537215802` (an empty wip handoff
commit on top of `7eaca7777f`; this file is a docs-only commit on top of it).
Tested on master `52f76f9b4f4ce3241e19590ffb25acd773a909c5` (the tip's merge-base with origin/master).
Engine bump: YES. The merge takes `SCRIPT_ENGINE_VERSION` 8 (coordinator order: T4 6, T3 7, W3 8). It is NOT edited here (still 5).
What changed and the capture rows: `docs/pine/capture-queue-2026-11-02-w3.md`.

Machine: desktop. Lanes (heavy_lock `--path`): measure-pair on `_resume-2026-11-01/dsk/heavy-mp2.lock`
(base worktree `pine-dsk-mpbase2`); final-tip on `_resume-2026-11-01/dsk/heavy-final3.lock`. Up to 4 heavy
jobs ran at once on the machine, so expect wall-clock timing noise.

## measure-pair (both runtime lanes)
Command, one job under heavy-mp2: `runs/w3r2-mp.sh`. It runs
`M=$(git -C pine-dsk-w3 merge-base HEAD origin/master); git -C pine-dsk-mpbase2 switch -q --detach $M` (and checks it), then
`measure-pair.sh runs/w3r2-mp<rt> tip:pine-dsk-w3 base:pine-dsk-mpbase2 <rt> 1` for rt 0 and 1.
Logs: `_resume-2026-11-01/runs/w3r2-mp0.log`, `w3r2-mp1.log` (out dirs `w3r2-mp0/`, `w3r2-mp1/`).
Sides: `== side tip 58dd37a20c` / `== side base 52f76f9b4f` on both lanes. Every step rc=0.

| instrument | runtime 0 (production) | runtime 1 (runtime-on) |
|---|---|---|
| C18 corpus audit (`out-*.json`, `ms` ignored) | 0 diffs | 0 diffs |
| C18 constructed probes (`probe-*.json`) | 0 diffs | 0 diffs |
| vendor harness | `TOTAL 336 - MATCH 93 / DIVERGE 103 / INCONCLUSIVE 140` both sides; verdicts.json + summary.md byte-identical | `MATCH 111 / DIVERGE 107 / INCONCLUSIVE 118` both sides; byte-identical |
| census (967/967 rows each side) | 3 differing rows, all NOISE | 0 differing rows |

Runtime 0 census classification (0 unintended):
- NOISE `reference:halftrend-longshort-signal-engine-bigbeluga__07070e14d6`: the step-2 `pine:timeout` message switches between
  "nested past 400 levels" (base) and "gave up after 10000ms" (tip). Same guard and outcome; attached/clean/peel unchanged.
- NOISE `reference:market-structure-with-inducements-sweeps-luxalgo__7948c21279`: the step-0 `pine:timeout` refusal list
  differs in where the budget tripped. Same guard; top-level fields unchanged.
- NOISE `committed:volatility-coil-edge-bullbyte__604f0fd1c6`: only step 6 (the step ending in `pine:timeout`) differs.
  droppedOps 141 to 142 (`create:label` 1). Steps 0-5 and 7 are identical (146,146,145x4 / 137). This step moves between
  runs at master: 137 in both sides of `w4t11-mp0` (master 5d95103c8a), 141 on this base. The runtime-on lane already
  counts `create:label: 1` on master at the same step. It depends on how far the reader gets before the wall-clock budget
  trips, not on S1. Attached/clean unchanged (false/false).
- No intended census flip was expected. S1's names ride inside `cellTextWhy`, and the census tallies those cells as
  `cell:text` on both sides. The `{N,number,percent}` cell it reads stays refused on its other walls (doc row S1-C).
  The rails below carry S1's behaviour.

## final-tip
Command, under heavy-final3: `final-tip.sh pine-dsk-w3 w3r2-final tests/test_script_engine_version_gate.py`, tip
`58dd37a20ca85f47dfb26085596ff6e537215802`. Log dir `_resume-2026-11-01/runs/w3r2-final/` (job log `runs/w3r2-final-job.log`).
- gate pytest: `46 passed` (rc=0). Hygiene rc=0: `clean: 34661 tracked file(s)...`. Version gate: `6 passed`.
- full chart+hooks vitest: `Test Files  1 failed | 1335 passed | 28 skipped (1364)`. The one failure is
  `src/hooks/pollingSites.rail.test.js`, the known desktop baseline. There is no other failure, so nothing needed a solo re-run.
  The 28th skipped file is `ast/w3ObjectWhy.measure.test.js` (env-gated measurement, header closed in round 2).
- The branch's rails, all green in that run: `ast/textRefusalNames.test.js` (23), `__tests__/w3CapturedCells.vendor.test.js` (8),
  `__tests__/strFormat.vendor.test.js` (11), `__tests__/formatVendorRules.test.js` (10).

## Not run in this re-home (open, from the handoff commit 58dd37a20c)
The handoff listed pin-on-master, the 35-file rail job, the 13-mutation run (`runs/w3r2/muts2.json`) and the "why" census
base/tip. They live in the laptop's `runs/w3r2/job2.sh`, which is not on the desktop. The coordinator scoped this
re-home to measure-pair plus final-tip. Red-on-master and the mutation table are therefore NOT re-proved here.
