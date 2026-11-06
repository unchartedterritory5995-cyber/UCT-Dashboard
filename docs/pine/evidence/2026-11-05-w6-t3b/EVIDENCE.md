# W6-T3b evidence: `exprType` with per-call-site return-type inference (WIP, session restarted)

## NEXT STEP (exact)
1. Measure-pair: a rerun was queued under `heavy-mp2.lock` at 17:39 (waiting on an unlabelled holder, pid 10756).
   Log: `_resume-2026-11-01/runs/w6t3b/mp-all.log` (per lane `mp0.log`, `mp1.log`, dirs `mp0/`, `mp1/`; job `runs/w6t3b/mp.sh`).
   If it did not finish with `MPALL_DONE`, re-run: `lock_run` (LOCK var -> `$UCT_RESUME/dsk/heavy-mp2.lock`) `-- bash $UCT_RESUME/runs/w6t3b/mp.sh`.
   It switches `pine-dsk-mpbase2` to `merge-base HEAD origin/master` and asserts HEAD before/after each lane.
   Attempt 1 (`mp-all-attempt1.log`, `mp0-attempt1.log`) is VOID: another session switched `pine-dsk-mpbase2` to
   `c855e8cadf` at 17:18 during the base side (reflog), so the script stopped with HEAD MOVED. Its tip side was rt0
   harness `MATCH 93 / DIVERGE 103 / INCONCLUSIVE 140`, same totals as the base side before the move.
2. Classify every C18/census/harness diff (expected: 0; no served path reads a new answer).
3. final-tip LAST: `lock_run` on `$UCT_RESUME/dsk/heavy-final2.lock` `-- bash $UCT_RESUME/runs/w6t3b/ft.sh`
   (FULL, 2 parallel shards, Node 20.20.2), then `ready-check.sh pine-dsk-w6t3b $UCT_RESUME/runs/w6t3b-final`.
   Before it, merge current origin/master if it moved. Then fill the sections below and push (docs only after TIP).

## State
- Branch `feat/pine-w6-t3b-expr-type`; code commit `e105a1f9a3`; merges: T3a tip `7dc6a77d1b`, origin/master
  `3168501f22`, then origin/master `3ca4b0d358` (T3a landed as engine 18, W9 landing). Diff vs master = FE + rail only.
- Engine bump: **no**. No served path changes: the only production caller is the method-form family callback
  (both sites), which now asks `methodNsOf(exprType(name))`; for a name that is the slot's descriptor, identical.

## What changed (`ast/pineRuntimeFrontend.js`)
- `exprType(node, scope)` in the type band after `bindSlotTy`: a T3a descriptor or `null` ("cannot tell").
  Names (`slotTy`), field paths through each field's written type, `Foo.new`; collection reads (`ARRAY_READS_ELEMENT`,
  `matrix.get`, `map.get` value type); `array.copy/slice/concat/from/new*`, `str.split`, `map.keys/values`,
  `matrix.row/col/new`, `map.new`; ternary and `if`/`switch` arms (na takes the other arm, disagreement = null);
  built-in and user method results; user function results inferred from the body per (function, argument types)
  with untyped params taking the argument's type and typed params their written type; recursion = null
  (`fnInferring`, the only recursion stop); an overloaded name = null (T9); loops' values = null.
- `writtenTyOf` factored out of `declaredTyAt` (identical); `fnSourceByName` registered in `defineFunction`.
- Test probe `opts.exprTypeProbe === true` -> `exprTypeOf(text)` on the result; nothing in the engine passes it.

## Rail `runtime/__tests__/w6ExprType.test.js` (28 tests)
Green on tip (with `w6TypeDescriptor`: 51/51). Red on base (FE at `c96f59cd8d`, restored byte-exact):
`27 failed | 1 passed (28)` (the passing one asserts the probe is absent). Log `runs/w6t3b/redbase.log`.

## Mutations (`runs/w6t3b/muts.json`, log `runs/w6t3b/job1.out`, lock heavy-mut.lock; tests w6ExprType + w6TypeDescriptor)
C0 no-op control SURVIVED. KILLED: M1 infer once per function, M2 first arm wins on disagreement, M3 na arm -> null,
M4 recursion guard removed (stack overflow), M5 untyped param ignores argument, M6 typed param takes argument,
M7 overload keeps a definition, M8 ternary takes first arm, M9 element read answers the collection, M10 defined method
does not win the method form, M11 field element type dropped, M12 named argument by position, M13 body bindings untyped,
M14 tenv ignored, M15 public answer keeps declaredOnly, M16/M17 ufcs value/statement site answer 'array'
(w6TypeDescriptor matrix/map rails), M20 if chain first arm only, M21 probe always attached.
SURVIVED, named: M18 (re-throw of non-refusal errors; no reachable input raises one), M19 (depth bound 48; a backstop
for env-macro cycles, as `udtTypeOf`'s, no finite input reaches it).
The missing-`else`/no-default NA arm was removed before mutation: `na` joins to the other arms, so it could not be proved.
