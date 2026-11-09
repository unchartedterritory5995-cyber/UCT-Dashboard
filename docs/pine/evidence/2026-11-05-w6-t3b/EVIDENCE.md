# W6-T3b evidence: `exprType` with per-call-site return-type inference

**Code tip (final-tip ran on it): `afea7afaf5`** (merge of origin/master `7f6dd3714d`; no engine file in that merge).
Later commits are docs only. **Engine bump: no** (`SCRIPT_ENGINE_VERSION` untouched, 18 from master).

## measure-pair (`runs/w6t3b/mp.sh`, lock heavy-mp2.lock, base `pine-dsk-mpbase2` switched in-job; HEAD asserted before/after each lane)
Log `runs/w6t3b/mp-all.log`, `mp0.log`, `mp1.log`; compare `runs/w6t3b/mpcompare.py` (ignores `ms`).
`== side tip 1eb962e278` / `== side base 3ca4b0d358` (tested-on-master `3ca4b0d358`, then the merge-base). Master
`7f6dd3714d`, merged afterwards, changes no file under `app/src/components/chart/engine`, so the pair stands for the final code.
- **C18 corpus audit 395 rows: 0 diffs; constructed probes 69: 0 diffs, on both lanes.**
- Harness byte-identical: rt0 `MATCH 93 / DIVERGE 103 / INCONCLUSIVE 140`, rt1 `MATCH 111 / DIVERGE 107 / INCONCLUSIVE 118` both sides.
- Census 967 rows; no row changed attached/clean/stuck. All NOISE, the same rows W4-T14 and W6-T3a recorded:
  rt0 `volatility-coil-edge-bullbyte` (dropReasons), `halftrend-longshort-signal-engine-bigbeluga` (peelSteps 7 vs 6),
  `luxy-momentum-…` (attemptedOps), `multi-timeframe-trend-indicator` (nested refusal list length); rt1
  `multi-timeframe-trend-indicator` (same). These are `pine:timeout` wall-clock and nested-refusal rows; no T3b caller
  serves a new answer. 0 unintended.
- Attempt 1 (`mp-all-attempt1.log`) is VOID: another session switched `pine-dsk-mpbase2` mid-run (reflog 17:18); the
  script caught it (HEAD MOVED).

## final-tip (`runs/w6t3b/ft.sh`, lock heavy-final2.lock, FULL, 2 parallel shards, Node 20.20.2; logs `runs/w6t3b-final/`, `runs/w6t3b/ft.out`)
`TIP afea7afaf5 done`, `scope=full shards=2`, `rc gate=0 hyg=0 py=0 js=1`, `totals=ok errors=0 integrity=ok`.
jsfail, classified:
- baselines: `pollingSites.rail`, `settingsScope.rail`, `enumerationSites`, `vendorHarness`;
- red on MASTER `7f6dd3714d` too, the same test each, run alone in `pine-dsk-mpbase2` (`runs/w6t3b/rerun-master.log`;
  tip alone `runs/w6t3b/rerun.log`, 3 failed | 200 passed both sides):
  `controlDoorCensus` (flags master's `app/src/agent/guide/slots.js`), `usePreferences.additionsOnly` (flags master's
  `notebook/TodayHome.jsx`), `vendorHarness.coverageAudit` (delta-rsi INCONCLUSIVE). None touch this lane's files.
- `ready-check.sh pine-dsk-w6t3b runs/w6t3b-final`: **READY-CHECK PASS** (HEAD b44e74ce53, TIP afea7afaf5, docs-only after TIP).

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

# Round 2 (review NO-GO @a01eec7203, B1 rail gap; review `dsk/reviews/W6-T3b.md`)

Code tip `c0d9bce75c`: rail commit `dbc39fdc19` (test only) + merge of origin/master (test files only under engine/; no FE
source change, so the round-1 measure-pair stands). Engine bump: still **no**.

## B1 fix (rail only, `w6ExprType.test.js`, now 29 tests, green)
- (a) `ifElifLastBad`: a 3-arm `if / else if / else` whose LAST arm disagrees answers null.
- (b) `naPass(x) => close > open ? x : "a"`: `naPass("b")` is text, `naPass(na)` is null (an `na` argument gives an
  untyped parameter no type).
- N1: operators rail: `"a" + "b"` text, `1 + 2` num, comparison bool, `"a" + 1` null.
Mutations (`runs/w6t3b/muts-b1.json`, log `runs/w6t3b/job-b1.log`, heavy-mut.lock): C0 control SURVIVED; reviewer's
X12 (else-if continuation -> break) KILLED; X10 (na argument bound as NA_TY) KILLED; X3 (text + text dropped) KILLED.
N2/N3 accepted as equivalent and kept documented; N4 (cache vs a later overload) is handed to T9.

## final-tip (`runs/w6t3b/ft3.sh`, heavy-final2.lock, FULL, 2 parallel shards, Node 20.20.2; logs `runs/w6t3b-final3/`)
`TIP c0d9bce75c done`, `scope=full shards=2`, `rc gate=0 hyg=0 py=0 js=1`, `totals=ok errors=0 integrity=ok`.
jsfail: the same seven as round 1 (4 baselines + `controlDoorCensus`, `usePreferences.additionsOnly`,
`vendorHarness.coverageAudit`, red on master `7f6dd3714d`).
A first attempt (`runs/w6t3b-final2-void/`) is VOID, integrity=tree-changed-during-run: `ast/lookbackAgreement.test.js`
regenerates `tools/lookback_agreement.json`, translating each corpus script under `budgetMs: 3000`. Under full-suite
load 3 trees timed out (`distinct_trees_walked` 608 -> 605, the 146 rows identical), and two load-sensitive harness files
(`b1Paints`, `wseCalcBars`) went red. This is host-lane `translatePine` wall-clock noise, outside this lane's diff. The
file was restored byte-exact from HEAD, and the rerun was clean.
