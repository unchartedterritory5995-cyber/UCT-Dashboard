# W5-T2 host-neutral closure: evidence

Lane: W5-T2 (docs/pine/SERVER-RUNTIME-DESIGN.md section 7 row T2; sections 2.1, 2.2 H3/H4/H5, 8 step 4; ruling R3 in
9.1), desktop machine. Branch `feat/pine-w5-t2-host-neutral`.
**Stacked on W5-T1** (READY, unmerged): base = `origin/feat/pine-w5-t1-server-bundle` `27e95ca34c`, whose master is
`5d95103c8a` (tested-on-master). "Base" below always means `27e95ca34c`. T1 merges first, then T2.
Fix round r1 (review `dsk/reviews/W5-T2.md`, B1): the previous version of this file at `0b45a9707a` held another
lane's draft (a shared-scratchpad collision on the desktop). This file is rewritten from the W5-T2 run records in
`_resume-2026-11-01/runs/w5t2/` and `runs/dsk-w5t2-final/`. No code changed in r1.

**Engine bump: NO.** No product caller injects a clock (the browser worker passes `{budgetMs}` only, HP-7), and every
default reads the same host clock, late, as before. Measured: C18 0 diffs and harness 0 diffs on both lanes, census
0 diffs on runtime 1, and 3 runtime-0 census rows that are wall-clock `pine:timeout` jitter (classified below).
HP-1 166/166. SCRIPT_ENGINE_VERSION untouched.

## Files changed (27e95ca34c..tip, 15 files)
| file | why |
|---|---|
| `engine/objectRuntimeSeam.js` (new) | an import-free leaf holding the C18 runtime-values slot (H4) |
| `engine/objectColumns.js` | reads the slot from the seam; re-exports `registerObjectRuntimeValues` from it |
| `engine/runtime/runtimeColumns.js` | registers through the seam, not `objectColumns.js` (the edge that pulled in nativeRegistry, serverCompute, runtimeKill, runtimePaneGate, lib/runtimePanePermission); clock lines: one default `hostNow`, `clockOf(opts)` at the three pane-budget sites, `opts.now` handed to the VM (`WALL_TIME`; before T2 the VM ignored the caller's clock) and to the translator (`withTranslateClock`) for the run's build; `runtimeObjectValues` takes `ctx.now` the same way |
| `engine/lowerTfServing.js` (new) | an import-free leaf: the translator's view of the lower-timeframe gate; unregistered is OFF, only a literal `true` serves (H3) |
| `engine/lowerTf.js` | reads the gate through `lowerTfServing.js`, no longer imports `lowerTfGate.js` |
| `engine/lowerTfGate.js` | registers its (unchanged, late) reader into the leaf when imported; still the ONE reader of the flag |
| `engine/nativeRegistry.js` | imports `./lowerTfGate.js` (the chart door registers the gate) |
| `app/src/test-setup.js` | imports `lowerTfGate.js`, as the app does through the registry, so suites that stub the flag still flip it |
| `engine/ast/pine.js` (TRANSLATE_DEADLINE block, Resolver deadline, checkClock, translatePine's window) | every translator clock read goes through an injectable clock: `withTranslateClock(now, fn)`, `beginTranslateBudget(budgetMs, path, now)`, `translatePine(src, { now })`, Resolver `opts.now`; each deadline is read on the clock that set it; default `const wallNow = () => Date.now()` (H5, R3) |
| `tools/pine_runtime_closure.mjs` (new) | the 2.1 walk as a rail (design 8 step 4), see below |
| `runtime/__tests__/hostNeutralClosure.rail.test.js` (new) | the rail, 14 tests |
| `runtime/__tests__/serverBundle.rail.test.js` (T1's) | module floor derived from the closure walk (was a literal `> 80`); a VITE_* value no longer moves the bundle (it did on base, through the two gates) |
| `docs/pine/evidence/2026-11-04-w5-t2/{EVIDENCE.md,muts.json,muts-r2.json}` | this evidence and the mutation sets |

`tools/pine_runtime_closure.mjs` walks from `runtime/serverEntry.js` and `runtime/runtimeColumns.js` (relative static,
side-effect and literal dynamic imports; comments blanked, strings skipped, line numbers kept) and reports, each with
its import chain: forbidden modules (nativeRegistry, objectColumns, serverCompute, runtimeKill, runtimePaneGate,
lowerTfGate, lib/runtimePanePermission, runtimeAsync, runtimeWorker); network / build-flag / storage / dynamic-code /
worker / timer patterns; any wall clock other than the three named defaults (exact line; a stale default is also a
finding); bare imports other than `jsep`; door registrations (the registry must still reach `lowerTfGate.js`); and
every module or JSON outside the service's watch patterns (3.1). `--check` exits 1 on a finding and 2 when the walk
cannot be made (never clean); `--repo <dir>` walks another tree.

| measure | base `27e95ca34c` | tip |
|---|---|---|
| closure modules / lines / JSON | 84 / 95,693 / 4 | 64 / 85,541 / 3 |
| `--check` findings | 35 (rc 1) | 0 (rc 0) |
| server bundle (T1 build script) | 2,140,179 B, 90 modules | 1,829,141 B, 69 modules |
| bundle sha with `VITE_PINE_LOWER_TF_ENABLED=1` vs unset | differs | identical |

## Rails: red on base, green on tip
`runtime/__tests__/hostNeutralClosure.rail.test.js` (14 tests):
- the closure is host-neutral (findings = []); `--check` exits 0; CONTROL: a tree breaking every rule gives each
  named finding, CLI rc 1, and an unwalkable tree rc 2;
- CONTROL: with no clock injected a run reads the host clock. With `opts.now` and `Date.now`/`performance.now`
  throwing, runs read 0 host clocks from the listing, off the listing (warm-up curtain, sessions on) and in a
  `calc_bars_count` window; the clock scope is restored after a run; the VM's WALL_TIME reads the injected clock;
  `translatePine` reads only the injected clock and its deadline is that clock's; each `pine:timeout` limb (window
  expiry, tick, Resolver own clock, scoped clock, in-window clock; a still clock never expires) reads its handed
  clock; `runtimeObjectValues` reads `ctx.now`;
- the C18 slot is one slot (`viaColumns === viaSeam`, registered = `runtimeObjectValues`); the lower-tf gate reaches
  the translator late and fails closed (unregistered, throwing, non-`true`);
- the server bundle under bare node with `fetch`, `Date.now` and `performance.now` all throwing: 0 calls, columns
  computed on the injected clock; no VITE_* value moves the bundle.

Red on base (inside the mp3 measure-pair hold; base worktree `pine-dsk-mpbase3` detached at `27e95ca34c`; the tool and
the rail copied in and removed after; logs `runs/w5t2/redbase-closure.log`, `runs/w5t2/redbase-rail.log`):
- `node tools/pine_runtime_closure.mjs --check` on base: rc 1, `closure: 35 finding(s)` (7 forbidden modules, fetch
  and import.meta.env hits, 19 uninjectable clocks, 5 modules outside the watch patterns, 2 absent defaults);
- `hostNeutralClosure.rail.test.js` on base: rc 1, the suite cannot load ("Cannot find module
  '../../objectRuntimeSeam.js'"), Test Files 1 failed, no tests;
- T1's edited assertion (no VITE_* value moves the bundle) is red on base by construction: the base bundle's sha moves
  with the flag (table above).
Green on tip: 14/14 and serverBundle 6/6 (tip `b886da066a`, direct run), and both inside final-tip. Also green directly
on the tip: pine.timeout, lowerTf, memberPaneGate, runtimeRealtimeGuards, runtimePaneSafety, runtimeHardeningP1,
runtimeLimitsAcceptance, simpleArgWindow, vendorHarness c27/c35/c41/c49, useLowerTfSources, objectRuntimeValues,
pineRuntimeFrontendGate, pineProbeReplay.

## Mutation table
Command (from `app/`, lock `dsk/heavy-mut.lock`): `python $S/mutate.py ../docs/pine/evidence/2026-11-04-w5-t2/muts.json
src/components/chart/engine/runtime/__tests__/hostNeutralClosure.rail.test.js src/components/chart/engine/__tests__/objectRuntimeValues.test.js`.
- Round 1 (`muts.json`, tip `b613082ee1`, `runs/w5t2/mut.log`, 12:16-12:26): 45 mutations. Control survived,
  **42 killed**, 2 survived: `pine:tick-wall` and `pine:checkClock-wall`. Cause: the rail used a LEAPING injected
  clock, and a leaping clock cannot tell its own reading from the host's (both are past the deadline). The rail was
  fixed in `b886da066a`: a clock that does not advance must never expire and must read no host clock.
- Round 2 (`muts-r2.json`, tip `b886da066a`, `runs/w5t2/mut2.log`): both **KILLED**; control survived.

**44 of 44 real mutations killed. No equivalent survivors in this lane.** (Consequence for T1's table: its mutations
"define dropped" and "VITE_* not spread into the define" become equivalent survivors on this tree, because nothing in
the closure reads `import.meta.env` any more.)

| group | mutations (names as in muts.json) | killed by |
|---|---|---|
| edges | `edge:objectColumns-import-back`, `edge:lowerTfGate-import-back`, `edge:nativeRegistry-into-closure` | "is host-neutral" (forbidden module + chain) |
| door | `door:registry-no-longer-registers-gate` | "is host-neutral" (door registration finding) |
| gate seam | `door:gate-does-not-register`, `seam:unregistered-serves`, `seam:truthy-serves`, `seam:throw-serves` | "the lower-timeframe gate reaches the translator..." |
| C18 seam | `c18:not-registered`, `c18:reader-ignores-slot` | "one slot" / objectRuntimeValues.test.js |
| runtimeColumns clocks | `clock:pane-core-host`, `clock:offlisting-host`, `clock:calcbars-host`, `clock:vm-not-handed`, `clock:core-build-not-scoped`, `clock:objects-build-not-scoped`, `clock:objects-vm-not-handed`, `clock:injected-ignored` | the matching "injected clock is the only clock read" test |
| pine.js clocks | `pine:scope-ignored`, `pine:scope-not-restored`, `pine:window-ignores-now`, `pine:translatePine-drops-now`, `pine:expired-wall`, `pine:tick-wall` (r2), `pine:resolver-ignores-now`, `pine:resolver-ignores-scope`, `pine:resolver-ignores-window`, `pine:checkClock-wall` (r2), `pine:checkClock-window-wall` | translator / limbs / from-the-listing (scope restore) tests |
| tool | `tool:network-pattern-dropped`, `tool:flag-pattern-dropped`, `tool:forbidden-modules-unchecked`, `tool:bare-unchecked`, `tool:clock-any-allowed`, `tool:clock-allow-by-file`, `tool:stale-unchecked`, `tool:watch-unchecked`, `tool:watch-any`, `tool:door-unchecked`, `tool:comments-kept`, `tool:line-comments-kept`, `tool:strings-not-skipped`, `tool:side-effect-import-unwalked`, `tool:check-exit-0` | the CONTROL tree test and "is host-neutral" |
| control | `control:noop-comment` | SURVIVED (control), both rounds |

## measure-pair (both runtime lanes)
Lock `dsk/heavy-mp3.lock`, label `w5t2-mp`, log `runs/w5t2/mpjob.log`; per lane `runs/w5t2/mp{0,1}.log` and a
timing-scrubbed tip/base diff of every artifact in `runs/w5t2/mp{0,1}-compare.txt`. Tip `b886da066a` (its code is the
final tip's code: every later commit touches only this evidence directory). Base worktree `pine-dsk-mpbase3` switched
INSIDE the job (detached) from `5d95103c8a` to `27e95ca34c`. Its HEAD, asserted with a timestamp:

    BASE_BEFORE_SWITCH 5d95103c8a426e9c5844f42acef2f2131a96101a 12:52:56
    BASE_HEAD after-switch          27e95ca34cb5615f512487fd5fd10bd237e8cd67 12:52:56
    BASE_HEAD before-tip-side-rt0   27e95ca34cb5615f512487fd5fd10bd237e8cd67 12:52:56
    == side tip b886da066a 12:52:57      == side base 27e95ca34c 13:11:39
    BASE_HEAD after-base-side-rt0   27e95ca34cb5615f512487fd5fd10bd237e8cd67 13:28:42
    BASE_HEAD before-tip-side-rt1   27e95ca34cb5615f512487fd5fd10bd237e8cd67 13:28:43
    == side tip b886da066a 13:28:43      == side base 27e95ca34c 13:47:14
    BASE_HEAD after-base-side-rt1   27e95ca34cb5615f512487fd5fd10bd237e8cd67 14:03:59
    BASE_HEAD end                   27e95ca34cb5615f512487fd5fd10bd237e8cd67 14:04:03

| lane | C18 audit (63,694 leaves) | C18 probes (921) | census (967 rows) | harness |
|---|---|---|---|---|
| runtime 0 (production) | 0 differ | 0 differ | 3 rows differ (below); lane.jsonl hostRefused 1293 vs 1290 | 0 of 56,887 leaves; summary identical; MATCH 93 DIVERGE 103 INCONCLUSIVE 140 both |
| runtime 1 (runtime-on) | 0 differ | 0 differ | 0 differ | 0 of 68,366 leaves; summary identical; MATCH 111 DIVERGE 107 INCONCLUSIVE 118 both |

### The runtime-0 census rows, by script (lane.jsonl hostRefused 1290 -> 1293 is their sum)
Each row differs in WHERE the census's peel loop met the translator's 10 s wall-clock `pine:timeout`; every row hits
that timeout on BOTH sides (no census path injects a clock, so tip and base read the same `Date.now`, and the row's
total run time differs with load):
- `committed:volatility-coil-edge-bullbyte`: peel step 6 is `pine:timeout` on both; ops dropped there 143 vs 142
  (row ran 90 s on the tip, 86 s on the base);
- `reference:halftrend-longshort-signal-engine-bigbeluga`: step 2 `pine:timeout` on both; then 7 vs 4 peel steps
  before the census stopped (61 s vs 21 s);
- `reference:market-structure-with-inducements-sweeps-luxalgo`: steps 0-1 `pine:timeout` on both; one extra timeout
  refusal line recorded on the tip (107 s vs 89 s).
hostRefused 1290 -> 1293 in lane.jsonl is these three rows' refused-step counts, nothing else (runtime 1 shows 0 row
diffs and equal lane totals for the same scripts).

**Re-run alone (fix r1)**, under `dsk/heavy-mp3.lock` (label `w5t2-rt0probe`, `runs/w5t2/rt0probe/`; tip worktree at
`0b45a9707a` = tip code; base `pine-dsk-mpbase3` asserted at `27e95ca34c` at 22:01:35, 22:18:28 and 22:34:58): each
script through `translatePine(src, { strict, objects })` twice with the wall clock OFF (`budgetMs: 0`, only the
deterministic step and depth limbs) and twice with it ON. The answer (ok, first guard and line, every refusal guard
and line, output count) is **identical on tip and base in all 12 pairs**: halftrend `pine:state` (14 refusals),
volatility-coil `pine:reassign` (3), market-structure `pine:timeout` (2; with the clock off this is the deterministic
step cap, reached after 446-529 s on both sides; with the clock on, 16-17 s). So the translator gives the same
answer on both trees with or without a clock, and the census rows move only with wall time.
**Classification: noise (pre-existing wall-clock non-determinism, design H5), not a change made by this branch.**

**0 unintended diffs.**

## Host parity (W5-T4's HP-1, run read-only)
W5-T4's tool, corpus and committed digests were extracted read-only from `origin/feat/pine-w5-t4-host-parity`
(`eb922686fe`) with `git archive` and run against THIS tree's server bundle:
`node tools/pine_runtime_host_parity.mjs --host node --bundle <tip bundle> --check`.
- early, bundle from `8429814e36`: **HP-1 GREEN 166/166** (`runs/w5t2/hp1-early.log`);
- final, bundle from `073806c4b4` (1,829,141 B, 69 modules), in the final-tip hold: **HP-1 GREEN 166/166** (`runs/w5t2/hp1.log`).
T4 recorded those digests on T1's bundle, so the closure cut changes no column, refusal guard or warm-up of the corpus.

## final-tip
Command: `bash $S/final-tip.sh pine-dsk-w5t2 dsk-w5t2-final tests/test_script_engine_version_gate.py`, lock
`dsk/heavy-final3.lock`, tip `073806c4b4` (code identical to every later commit; only this directory differs), tested on
(T1's) master `5d95103c8a`. Logs `_resume-2026-11-01/runs/dsk-w5t2-final/` and `runs/w5t2/finaljob.log` (14:35-15:22).
- gate pytest (4 files): 46 passed. `tests/test_script_engine_version_gate.py`: 6 passed. Hygiene: clean (34,676 files).
- full chart+hooks vitest: Test Files 1 failed | 1335 passed | 27 skipped (1363); Tests 1 failed | 22380 passed |
  118 skipped (22499). The only failure is `src/hooks/pollingSites.rail.test.js`, the desktop baseline (96582cd549 is
  not in this tree, so settingsScope is not expected red). Both W5-T2 rails passed inside the run.
- In the same hold: `pine_runtime_closure.mjs --check` 0 findings (64 modules); HP-1 GREEN 166/166.
- No `app/dist` or `app/dist-server` was created in the worktree (bundles were built into a scratch dir).

## Open items
- **Arming checklist for `VITE_PINE_LOWER_TF_ENABLED`** (review note 1): in a realm that never imports the registry
  (the runtime worker, the server bundle) the gate reads OFF. While the flag is dark (UNSET, `docs/feature_flags.json`)
  nothing changes. Once armed, the runtime front end there refuses a read below the chart as
  `lower-tf:store-unmeasured` instead of `lower-tf:runtime-lane`: the same withhold, a different name and sentence, on
  a path the member door does not route (its probe, main thread and registered, refuses with `runtime-lane`).
- The `docs/feature_flags.json` note for that flag says "Its one caller is engine/lowerTf.js"; it should name
  `lowerTfServing.js` (the read is still only in `lowerTfGate.js`). Coordinator rewords at merge.
- Wire `node tools/pine_runtime_closure.mjs --check` into `master-deploy-gate.yml` (design 8 step 4) with T19.
- Stack order: T1 then T2. If T1 takes a fix round on `serverBundle.rail.test.js`, carry over the two edits here.
- `test-setup.js` registers the gate in every vitest realm; the unregistered realm is exercised only by the explicit
  rail (review note 2). The VITE on/off sha assertion sits in both bundle rails (note 3): harmless.
