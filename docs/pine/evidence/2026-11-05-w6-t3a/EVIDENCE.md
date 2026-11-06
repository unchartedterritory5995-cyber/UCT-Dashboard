# W6-T3a evidence: one static type descriptor per slot (`slots[s].ty`)

Branch `feat/pine-w6-t3a-type-descriptor`, built from the landing-train commit `1b8b4616d8` and merged forward with
`origin/integ/pine-train-2026-11-05` (last merge `fccf4cf9ce`, train `1eb3ba53e5`).
Code tip (final-tip ran on it): `fccf4cf9ce778b3c91f72f5ca870e231a61717b9`. Every later commit is docs only.
Measure-pair tip `2739b34234`, tested on train base `834467d2f0` (the merge-base with the train at that time). The only
later merge (`fccf4cf9ce`) brings train-only commits and touches no lane file (`pineRuntimeFrontend.js`, `typeDescriptor.js`, `ufcs.js`).
**Engine bump: yes (recommended, coordinator's call).** The spec planned "no" for a pure refactor, but the runtime lane
(dark pane and server runtime) now does two new things, so its outcomes move:
- it serves the method form on a collection typed only by its written type (`var array<float> a = na` … `a.size()`);
- it names `matrix.*` / `map.*` in a matrix or map method-form refusal.

C18 and the harness are identical. `SCRIPT_ENGINE_VERSION` was not edited.

## What changed
- NEW `app/src/components/chart/engine/ast/typeDescriptor.js`, a pure module: `makeTy`, `tyOfTypeWord`, `bindingTy`,
  and the getters `isCollectionTy`, `elemTy`, `elemKindOf`, `udtNameOf`, `elemUdtOf`, `drawingOf`, `isTextTy`, `isColourTy`
  and `methodNsOf`.
- `ast/pineRuntimeFrontend.js`: every per-slot type flag is gone (`collection`, `elemText`, `elemColour`, `elemUdt`, `udt`,
  `colour`, `text`, `drawing`), and `grep` finds no reader or writer of them left. The type lives in `slots[s].ty`.
  - The only writers are `setSlotTy`, `bindSlotTy` (it replaces `markUdtSlot` and `markDrawingSlot` at the `var` and plain
    binding sites), the parameter walk, the switch-subject and alert-argument temporaries (`initialiserTy`), and the
    block-valued colour (W4-T12's paint rule).
  - Readers go through `slotTy`, `slotIsCollection`, `slotElemKind`, `slotElemUdt` and `slotUdt`.
  - `udtElemOf` lost its annotation branch, because the written type is now read in exactly one place (`declaredTyAt`).
- Rule: the written type wins for reference kinds (array, matrix, map, udt, drawing, enum).
  - A written collection without an element type takes the element of a same-kind initialiser.
  - Scalars keep master's initialiser-only reading. `string` and `color` declarations do not type an `na` slot;
    `float`/`int`/`bool` are recorded only when the initialiser has no type (no reader reads `num`/`bool` yet).
- A drawing family is a type only under `objectsInRun`, exactly as master's `markDrawingSlot` had it.
- Parameters record only collection and record types (master marked `array<T>` and UDTs; `matrix<T>` and `map<K,V>`
  are added). `paramTypeHeads` also carries the full `typeArgs`, and `methodsAndArrayMembers.test.js` was updated for the
  extra field.
- The method form's ufcs family callback now answers `methodNsOf(slotTy(recv))`, at both the value site and the
  statement site. Arrays behave as before. A matrix or map receiver refuses naming `matrix.*` or `map.*`; before, it named
  `array.*` (and `map.get` would have been admitted as `array.get`). The untyped-parameter C18 rule keeps its constant `'array'`.
- C18 door: a collection whose kind came only from the written type (`declaredOnly`, e.g. `var array<Foo> obs = na`) is
  NOT a collection at the door, and its text/colour element is hidden. Its record element is still read off the annotation,
  exactly as master did. Off the door, the written type is the type.
- `ast/ufcs.js` is unchanged: its `nsOf` callback already takes the family. Only the FE callers changed.

## Interface for T3b and T5-T10
- `slots[s].ty = {kind, elem?, key?, name?, declaredOnly?}`, read through the FE's `slotTy(slot)`.
  `kind` ∈ `TY_KINDS` (array, matrix, map, udt, drawing, enum, num, text, colour, bool).
- T7/T8: `tyOfTypeWord('matrix'|'map', typeArgs)` already gives `{matrix, elem}` / `{map, key, elem}`.
  `methodNsOf` routes `m.rows()` to `matrix.rows`. `collectionKindOf` answers the call's namespace for an unserved
  `matrix.*`/`map.*` initialiser, and T7/T8 replace that with each member's declared result.
- T10: `tyOfTypeWord(word, null, {enums})` gives `{enum, name}`. `declaredTyAt` must pass the script's enum set.
- T3b: `exprType` answers `makeTy` descriptors. A name's type is `slotTy`, and the door view is `slotIsCollection` /
  `slotElemKind`. Known gap for T3b: a written `string`/`color` with an `na` initialiser stays untyped, as on master.

## Rail: `app/src/components/chart/engine/runtime/__tests__/w6TypeDescriptor.test.js` (22 tests)
It pins the descriptor for each declaration form (written collections and their element types, initialiser
collections, matrix and map, records, colour, text, num and bool, written string/colour untyped, drawing only when
drawing, parameters). It also pins the method-form family (matrix, map, statement form, map param, alias), the C18 door
reading (served off the door, master's `runtime:expression-statement` at the door, record element still read at the
door), behaviour through the getters (`plot(textSlot)` refuses by name, text `+`, switch subject, colour function
result), and the pure module.

Red on base `834467d2f0`: the rail and `typeDescriptor.js` were copied into the base tree, run, and removed; the base
stayed clean. Result: `Tests 10 failed | 12 passed (22)`. The 12 that pass are the pure-module tests (the module was
copied in) plus behaviour that master already had. Log: `runs/w6t3a/redbase.log`.
Green on tip: 22/22.

Importers: the 165 test files that import `pineRuntimeFrontend.js` or `typeDescriptor.js` are listed in
`importers.txt` beside this file. On `c5e581e549` they gave `Test Files 162 passed | 3 skipped (165)`,
`Tests 2538 passed | 3 skipped`. All of them sit under `src/components/chart` and are inside final-tip's full run.

## Mutations (`mutate.py`, Node 20.20.2, lock `heavy-final3.lock`; logs `runs/w6t3a/job1-mut.log`, `job1b-mut.log`, `job1c-mut.log`)
Test set: w6TypeDescriptor, colours, w4PaintTyping, methodsAndArrayMembers, udtRecords, p3WsaReviewFixes and
colourComponents. M15, M19 and M20 were re-run against the extended rail.

| mutation | result |
|---|---|
| C0 no-op control (a comment) | SURVIVED, as a control must |
| M1 `methodNsOf` answers `'array'` (spec) | KILLED (matrix/map refusal rail) |
| M2 drop the written-type-first rule (spec) | KILLED (written collection rail; udt rails) |
| M3 drop the colour getter (spec) | KILLED (my colour rail; colours/w4PaintTyping `bgcolor` rails) |
| M4 door hides nothing | KILLED (door rail) |
| M5 door hides the record element too | KILLED (door record-element rail) |
| M6 door shows the text/colour element of a declared-only collection | SURVIVED. 11 shapes were tried (concat, `==`, switch, slot, `var` + `:=`, ternary, `request.security`, `str.length`, `str.format`, `str.tonumber`, label), and none distinguishes them at the door. Kept as master's reading; named as not proven observable |
| M7 drawing type when not drawing | KILLED |
| M8 parameters record every written kind | KILLED |
| M9 a written scalar overrides | KILLED |
| M10 alias kind answers `'array'` | KILLED |
| M11 call-initialiser kind answers `'array'` | SURVIVED, equivalent in T3a: every `matrix.*`/`map.*` call is refused when lowered, so that slot is never read. T7/T8 own it |
| M12 element merge dropped | KILLED |
| M13 `makeTy` accepts an unknown kind | KILLED |
| M14 collection getter false | KILLED |
| M15 text getter false | KILLED after adding the `plot(textSlot)` rail (it survived the first run) |
| M16 udt getter null | KILLED |
| M17 statement-site refusal names `array.*` | KILLED |
| M18 block-valued colour dropped | KILLED (w4PaintTyping) |
| M19 switch subject untyped | SURVIVED, equivalent: the hoisted subject is read only by the case `==`, which answers both kinds (`cmp` uses `===`) |
| M20 function result colour dropped | KILLED after adding the colour-function rail |

## measure-pair (`runs/w6t3a/mp.sh`, lock `heavy-mp3.lock`, base `pine-dsk-mpbase3` switched in-job to `834467d2f0`; HEAD asserted before and after each lane)
Logs: `runs/w6t3a/mp-all.log`, `mp0.log`, `mp1.log`; compare script `runs/w6t3a/mpcompare.py` (ignores `ms`).
- `== side tip 2739b34234` / `== side base 834467d2f0` on both lanes.
- **C18 corpus audit (395 rows) and constructed probes (69): 0 diffs on both lanes**, refusal messages included.
- Harness: rt0 `MATCH 93 · DIVERGE 103 · INCONCLUSIVE 140` on both sides; rt1 `MATCH 110 · DIVERGE 107 · INCONCLUSIVE 119`
  on both sides. Harness dirs are byte-identical.
- Census, 967 rows. No row changed `attached`, `clean` or `stuck`; 0 unintended.
  - rt0, 3 rows, all NOISE in the host (production) lane, where `pine:timeout` peel steps report a different
    `attemptedOps` / `peelSteps`: `volatility-coil-edge-bullbyte`, `halftrend-longshort-signal-engine-bigbeluga`,
    `luxy-momentum-trend-and-breakout-…`. The same scripts were noise in W4-T14.
  - rt1, 2 rows:
    - NOISE: `multi-timeframe-trend-indicator` (a nested refusal `line` null vs 160, the same row W4-T14 recorded).
    - INTENDED: `rsi-kernel-optimized-flux-charts`. Step 5's runtime probe moved from `runtime:call-undeclared-builtin-state`
      (`KDEHighY.size`) to `runtime:array` (`array.binary_search_leftmost`). The script declares
      `var array<float> KDEHighY = na`, the written type now makes it a collection, and the method form is served on the
      dark pane. Its next wall is a T5 member gated on Q-W19R2b. Not attached; C18 is identical.

## final-tip
Command `final-tip.sh pine-dsk-w6t3a w6t3a-final` + pytest `test_script_engine_version_gate`, `test_saved_script_prebump`,
`test_runtime_definitions`, `test_language_coverage`; FULL scope, 2 parallel shards, Node 20.20.2 (`dsk/node20.sh`),
lock `heavy-final3.lock`. Logs `runs/w6t3a-final/`, `runs/w6t3a/ft.out`.
- `TIP fccf4cf9ce done`, `scope=full shards=2`, `rc gate=0 hyg=0 py=0 js=1`, `totals=ok`, `errors=0`, `integrity=ok`.
- Shards: `Test Files 3 failed | 683 passed | 11 skipped (697)` and `4 failed | 676 passed | 17 skipped (697)`.
- jsfail, classified:
  - baselines: `pollingSites.rail`, `settingsScope.rail` (ready-check list); `enumerationSites`, `vendorHarness` (master
    baselines at 646dca8cbf, per the coordinator; see `runs/train/FIXES.md`);
  - flakes under full-run load, all three green ALONE on this tip AND on the train tip `1eb3ba53e5`
    (`runs/w6t3a/rerun.sh`, `rerun-tip.log` / `rerun-train.log`: `Test Files 3 passed`, `Tests 202 passed | 7 skipped` each side):
    `vendorHarness.coverageAudit` (known flake), `useWakeWord.lazy` (30 s timeout), `pineBoxImportVerdict` (an import-box
    `aria-hidden`/`tabindex` render diff from the train's EDITOR-E2 surface, no FE involvement).
- ready-check: expected to FAIL only because its allowlist names two of the four agreed baselines; every failure is
  outside this lane.

# Round 2 (review GO-WITH-NOTES @a10566902e, note N1)

Code tip `8a5d839b00`: merge of `origin/master` `6fe0577df8` (the train landed as be5fd05ea2). The merge touches no
lane file, and `SCRIPT_ENGINE_VERSION` is still 17 (not bumped; the coordinator assigns 18 at landing).

## N1 fix: a collection that is still `na` stops BY NAME
- `runtime/vm.js`, `OP.ARRAY` operand check: an `array` operand holding `na` now throws `CollectionError` ("the array is
  `na` (no array was assigned to it before this call); Pine stops the script here with a runtime error"). This reuses
  the existing collection stop, which `runtimeColumns` reports as `runtime:CollectionError`.
- A non-`na` number still meets the VM's own kind check, unchanged (the C18 untyped-parameter rule).
- Rail: `w6TypeDescriptor.test.js`, new case "(review N1)". It covers `a.size()`, `a.push(close)` and
  `array.get(a, 0)` on `var array<float> a = na`; a number handed to an untyped parameter still reads "takes an array,
  got number"; and the control runs once an array is assigned. 23/23 green on Node 20.20.2.
- Mutations (`runs/w6t3a/muts-n1.json`, log `n1-mut2.log`): no-op control SURVIVED; guard removed KILLED; any number
  treated as `na` KILLED (it was a survivor until the number case was added).

## final-tip: NOT COMPLETE
`final-tip.sh pine-dsk-w6t3a w6t3a-final2` started at 14:27:49 on `8a5d839b00` under `heavy-final3.lock`. During the
gate pytest step, Claude Code killed it because the machine was low on memory. It was not a test failure. The lock was
released, the tree is clean, and no process from the run is left. Per the harness rule, the agent did not restart it.

**Exact next step:** when free RAM allows, run `bash _resume-2026-11-01/runs/w6t3a/ft2.sh` under
`lock_run` on `heavy-final3.lock`. It is FULL scope, 2 parallel shards, Node 20.20.2 via `dsk/node20.sh`, and writes
`runs/w6t3a-final2/`. Expected reds: pollingSites, settingsScope, enumerationSites and vendorHarness, plus the
coverageAudit flake. Then run `ready-check.sh pine-dsk-w6t3a runs/w6t3a-final2`. HEAD must still be `8a5d839b00`
plus this docs-only commit.

## final-tip, round 2 (re-run after RAM recovered): COMPLETE
`final-tip.sh pine-dsk-w6t3a w6t3a-final2` (`runs/w6t3a/ft2.sh`): FULL scope, 2 parallel shards, Node 20.20.2 via
`dsk/node20.sh`, ram_gate passed, lock `heavy-final3.lock`. Logs `runs/w6t3a-final2/` and `runs/w6t3a/ft2b.out`.
- `TIP c96f59cd8d done` (code tree `8a5d839b00`; c96f59cd8d and this commit are docs only).
- `scope=full shards=2`, `rc gate=0 hyg=0 py=0 js=1`, `totals=ok`, `errors=0`, `integrity=ok`; pytest 196 passed.
- jsfail, classified:
  - baselines: `pollingSites.rail`, `settingsScope.rail`, `enumerationSites`, `vendorHarness`;
  - `controlDoorCensus`: red on `origin/master` `04b49bd61e` too (`runs/w6t3a/rerun2-master.log`). It names
    `app/src/agent/guide/slots.js` as missing from BULK_BLOB_SITES, a master file outside this lane: a master baseline;
  - `vendorHarness.coverageAudit`: the known flake. It is green alone on this tip twice (`ca-alone-1.log`,
    `ca-alone-2.log`: `185 passed | 7 skipped`) and green on master.
- ready-check: FAILS only on its allowlist (it names pollingSites and settingsScope only). Every red above is outside
  this lane.
