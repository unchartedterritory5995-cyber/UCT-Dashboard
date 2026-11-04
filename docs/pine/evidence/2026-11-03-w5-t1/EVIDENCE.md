# W5-T1 server bundle: evidence

Lane: W5-T1 (docs/pine/SERVER-RUNTIME-DESIGN.md section 7, P0 T1), desktop machine.
Branch `feat/pine-w5-t1-server-bundle`. Tested on master `5d95103c8a` (merge-base = origin/master at start).
One engine-file touch, non-behavioural: `runtime/runtimeColumns.js` gains `export { RUNTIME_FRONTEND_LANGUAGE,
RUNTIME_FRONTEND_VERSION }` beside the existing `export { RUNTIME_WARMUP_KEY, ... }` (2 lines). Reason: the server entry
may not import `ast/pineRuntimeFrontend` itself, because `pineRuntimeFrontendGate.test.js` ("no live file reaches the
runtime lane without the tri-state producer") fails any non-test importer lacking `pineRuntimeClock`; this was the
first final-tip run's only new red, fixed by re-exporting through the module that already imports both. Proof it
changes no output: the bundle built before and after the touch is byte-identical (sha256 a27a389e3b78..., 2,140,179
bytes), so no measure-pair was run and **no SCRIPT_ENGINE_VERSION bump is needed**.

## What is new
- `app/src/components/chart/engine/runtime/serverEntry.js`: re-exports only (computeRuntimeColumns,
  runtimeVersionRefusal, resetRuntimeSessions, resetRuntimeLedgers, SCRIPT_ENGINE_VERSION,
  RUNTIME_FRONTEND_LANGUAGE/VERSION, RUNTIME_IR_VERSION).
- `app/scripts/build-pine-runtime.mjs`: esbuild, ESM, node20 target, `dist-server/pine-runtime.mjs` plus
  `pine-runtime.manifest.json` (bytes, sha256, modules, baked VITE_* names). `import.meta.env` is baked
  once from the process's `VITE_*` variables (H3). jsep and the four JSON tables are inlined (H2).
  Not wired into `npm run build`, no Docker (T10).
- `app/scripts/measure-pine-runtime.mjs`: the bare-Node run (first-party indicator: MACD(12,26,9), RSI 14, ATR 14).
- Rail: `runtime/__tests__/serverBundle.rail.test.js` (6 tests).

## First measured bare-Node run (5,000 daily bars)
Commands (from `app/`; the run directory holds only the bundle, its manifest and the script, no node_modules):
```
node scripts/build-pine-runtime.mjs --out <dir>/pine-runtime.mjs
cd <dir> && node measure-pine-runtime.mjs --bundle pine-runtime.mjs \
  --bars <repo>/tests/fixtures/vendor/harness/vw-deadband-ticks-aapl-1d-2026-09-28.json --n 5000 --runs 5
```
Bundle: 2,140,179 bytes, 90 modules, sha256 a27a389e3b78dc3e0f72a6e6352c37bc6e09eaf4e47e918521ec745df9f3ee2e
(built with no VITE_* set). Node v24.13.1 on the desktop (Windows 11).

| measure | value |
|---|---|
| bars | 5,000 (4 columns, 19,915 finite values) |
| import of the bundle | 61.5 ms (253 ms on the first, cold-disk run) |
| cold run (`incremental:false`) | 48.1 ms |
| runs 1-5 (ms) | 48.1, 15.1, 8.9, 8.0, 6.4; median 8.9 |
| RSS after 5 runs | 88.5 MB |
| heap used | 17.6 MB |
| columns sha256 (Float64 LE, NaN canonical) | fe780ebfc0e575852d759ad7a72b93ef32b948bc0dcc86edec7a63e7904e053d |

The rail runs the same child process on 400 bars. Note: one light indicator; heavy corpus scripts
(94-144 ms per PHASE3 RT1) are a T9 measurement. The bundle still contains the fetch-bearing modules
(`serverCompute`, `runtimeKill`) and the two build gates: cutting those edges is T2.
Build warning (pre-existing, not ours): esbuild `duplicate-case` at `runtime/ir.js:518` (`EXPR.TUPLE`).

## Rail tests (red on master, green on tip)
All six tests in `serverBundle.rail.test.js` are red on master (the suite cannot load: the build script and
entry do not exist). Proved in the final job by moving `build-pine-runtime.mjs` aside (byte-exact restore).
Green on tip: see FINAL below.

## Mutation table (mutate.py, rail file only)
| mutation | killed by |
|---|---|
| `external: ['jsep']` | "leaves no bare or JSON import" and the bare-node run |
| `define` dropped | "bakes import.meta.env once" |
| VITE_* not spread into the define | "bakes import.meta.env once" (sha equal) |
| `viteEnvOf` unsorted | "bakes import.meta.env once" (order assertion; first attempt SURVIVED because `toEqual` ignores key order, rail fixed) |
| `viteEnvOf` bakes every var | "bakes import.meta.env once" (viteEnvNames) |
| entry drops `resetRuntimeLedgers` | "exports the entry surface" |
| entry drops `RUNTIME_IR_VERSION` | "exports the entry surface" |
| format `cjs` | "exports the entry surface" |
No equivalent survivors.

## FINAL checks
Red on master (proxy, byte-exact restore): with `scripts/build-pine-runtime.mjs` moved aside the rail suite fails to load
("Cannot find module .../build-pine-runtime.mjs", rc 1, no tests); on master the file and `serverEntry.js` do not exist.
Green on tip: `serverBundle.rail.test.js` 6/6; with `pineRuntimeFrontendGate.test.js` 9/9 (command:
`node node_modules/vitest/vitest.mjs run <both files> --maxWorkers=2`, tip b67c3c4dc7).

final-tip run 1 (tip 6888e54478, tested on master 5d95103c8a), log dir `_resume-2026-11-01/runs/w5t1-final/`:
- gate pytest (no_shadowed_definitions, dockerfile_vite_build_args, vite_flag_ledger, visibility_flag_ledger): 46 passed
- `tests/test_script_engine_version_gate.py`: 6 passed; hygiene: clean (34669 tracked files)
- full chart+hooks vitest: 2 failed | 22365 passed | 118 skipped (Test Files 2 failed | 1333 passed | 27 skipped).
  Failures: `pollingSites.rail` (known baseline) and `pineRuntimeFrontendGate` "no live file reaches the runtime lane"
  (NEW, caused by this branch's serverEntry importing `pineRuntimeFrontend`; fixed in b67c3c4dc7, gate now 9/9 above).

final-tip run 2 on the final tree (b67c3c4dc7): NOT COMPLETED. The job was queued at 16:32 and never obtained the heavy
lock in ~7 h (other builders' jobs kept winning it); it was cancelled by its owner, not run. The delta since run 1 is
the 2-line re-export plus this document, and the bundle built from it is byte-identical to run 1's. Coordinator: rerun
`final-tip.sh` on the tip before merge; expected totals 1 failed (pollingSites.rail baseline).

## final-tip run 2 (COMPLETED, desktop heavy lane 2)
Tip caa9d246f4 (code identical to b67c3c4dc7; only EVIDENCE.md differs), tested on master 5d95103c8a, label
w5t1-final3, logs `_resume-2026-11-01/runs/w5t1-final3/`. Ran on desktop lane 2 (heavy-final2.lock).
- gate pytest: 46 passed; `tests/test_script_engine_version_gate.py`: 6 passed; hygiene: clean (34669 files)
- full chart+hooks vitest:      Tests  1 failed | 22366 passed | 118 skipped (22485); Test Files 1 failed | 1334 passed | 27 skipped. The only failure is the known
  baseline `pollingSites.rail`. `pineRuntimeFrontendGate` is green. Run 2 above supersedes the "NOT COMPLETED" note.
