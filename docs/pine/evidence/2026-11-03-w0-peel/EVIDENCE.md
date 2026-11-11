# W4 T0 census peel: evidence (desktop run, 2026-11-04)

Branch `fix/pine-w0-census-peel`, code commit `05623fd2f7`, run at HEAD `75c4c400c2`. Tested-on master `6990d63b02`
(pine-base `origin/master` at fetch; the map's `masterSha`). Tooling only: no engine change, no `SCRIPT_ENGINE_VERSION` bump.

## Path mappings (job.sh was written for the laptop)
The committed `job.sh` is unchanged; the desktop copy is `job-desktop.sh` (diff: two lines).
- `source /c/Users/pgosz/.../pine-handoff/.../env-laptop.sh` -> `C:/Users/Patrick/uct-worktrees/pine-handoff-dsk/docs/pine/parity-programme/scripts/env-desktop.sh`
- `WT=$UCT_WORKTREES/pine-w0-peel` -> `$UCT_WORKTREES/pine-dsk-w4t0` (`/c/Users/Patrick/uct-worktrees`)
- `UCT_RESUME` = `/c/Users/Patrick/uct-worktrees/_resume-2026-11-01`; sample = `$UCT_RESUME/pine-sample`; REF = `$UCT_RESUME/runs/C/ref_rebuilt.json`; outputs `$UCT_RESUME/runs/w0peel/` (local, not committed)
- `app/node_modules` junctioned to pine-base's. Run: `python $HEAVY_LOCK run --path .../dsk/heavy-final2.lock --label w4t0-job --timeout 43200 -- bash job-desktop.sh` (waited ~65 min for the lock, ran 60.4 min).

## Results (all rc=0)
- Vendor harness (336 captures): production MATCH 93 / DIVERGE 103 / INCONCLUSIVE 140 (unchanged vs 11-02); runtime-on 111 / 107 / 118.
- Census 967/967 rows both lanes, new tooling and old tooling (A/B on same tree and sample).
- Map: transfer 211 -> 218 (32.1%), attach 285 -> 287, runtime-on transfer 250 -> 259, verified transfer 45 -> 47. Old tooling today gives the same 218/287/259/47: the instrument moves wall attribution (44 walls differ), not the counts; the +7 is master moving. See COVERAGE-MAP-2026-11-03.md section 0.
- Rails: census vitest 11 passed, 2 skipped. pytest pine (honesty 10 + conditional_ta + runtime_switch_on) 105 passed. Gates (shadowed defs, dockerfile build args, vite/visibility flag ledgers, engine-version gate) 52 passed. Hygiene clean.
- Mutations (logs `mut-js.log.txt`, `mut-py.log.txt`): J1,J2,J3,J4,J6 and P1-P8 all KILLED; no survivors.
- Temp files `coverageMapDoorCensusBefore.measure.test.js` and `coverage_map_before.py` were removed by the job trap.

## Deliverables
`docs/pine/coverage-map.json`, `docs/pine/coverage-targets-2026-11-03.json`, `docs/pine/COVERAGE-MAP-2026-11-03.md`, and the 7.1 corrigendum inserted before 7.2 of `docs/pine/COVERAGE-MAP-2026-11-02.md`.
