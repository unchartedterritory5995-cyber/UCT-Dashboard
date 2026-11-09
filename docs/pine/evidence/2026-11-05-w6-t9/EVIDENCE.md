# W6-T9 receiver types — EVIDENCE (desktop)

**NEXT STEP: HOLD for the coordinator's direct go, then measure-pair runtime 0 and 1 (shared base, `heavy-mp2.lock` /
`heavy-mp3.lock`), then merge origin/master again, re-run the targeted rails on the merged tree (review N5), final-tip
FULL scope, ready-check.**

Branch `feat/pine-w6-t9-receivers`, code tip `73c59fc272`, tested on master `81a4665a5a` (engine 21).
Spec: `docs/pine/W6-BREAKDOWN.md` @ `1889bbedd7`, section 4 T9 and section 1 rows 3, 4, 6.
Engine bump: **yes** (refusals become served values on the runtime pane). Not edited here.

## What changed

All in `app/src/components/chart/engine/ast/pineRuntimeFrontend.js` (the runtime side, rule 9:
`ast/pine.js` is untouched; the FE now claims and lowers the shapes the shared Resolver refused
`pine:member` / `pine:type`). The type is T3b's `exprType` / T3a's `slots[s].ty`; no per-slot
boolean is added.

- **Overloads** (`methodHeads`, `methodRecvTyOf`, `methodDefName`, `resolveMethod`): each
  declaration of an overloaded method registers as `name#<type key>`; a call resolves by the
  receiver's `exprType` (dotted form, chain, and the function form `m(x, …)` by argument 0).
  Refused by name (`runtime:udt-method`): an unreadable receiver type (library types = W8), two
  declarations this lane cannot tell apart (int/float are one `num`; same receiver twice), a
  method beside a plain function, a receiver whose type does not settle the choice (an unknown
  element, or a built-in of the name could be Pine's pick).
- **Typed shadowing** (`userMethodShadows`): a script's method shadows a built-in member
  (collection or drawing) only for its own receiver type. A single declaration on an untyped
  receiver keeps master's binding.
- **Chains** (`receiverCallOf`, `lowerReceiverCall`, `receiverStmtOf`, `memberRecvUdt`): a
  method or field read off an element, a copy, a function's result or a field path; a
  collection member on a field or on a name bound to a typed expression; a drawing member read
  off an element (`bx.get(0).get_bottom()`, when the run draws). Value and statement position.
  `needsRuntime` routes these to the runtime lane (`isReceiverCall`).
- **Slots bound to a typed expression** (`receiverInitTy`): where `initialiserTy` answers
  nothing (or an array of unknown element), `exprType` fills in a record, collection or
  drawing type (an unknown element only with a record type). Scalars keep master's answer.
- **`f.copy()` / `Foo.copy(f)`** (`recordCopyOf`): shallow, lowered as `Foo.new(f.a, …)`;
  refused by name when the receiver is not a variable or field (it would be evaluated per field).
- **Kept refused (W6-U1)**: a script's method beside a built-in member of the same name that
  could take the same call (same receiver type, an arity the built-in accepts), on every shape
  this task adds. Master's single-declaration binding on a slot is unchanged.
- **Object door**: every rule is off at the door (`receiverTypesServed = !atObjectDoor`), so
  the C18 door builds what master builds (rails below).

## Rails

`app/src/components/chart/engine/runtime/__tests__/w6ReceiverTypes.test.js` (27 tests,
synthetic shapes only). On the tip 27/27 green. Against master's FE (the same file with the
import pointed at a byte copy of master's `pineRuntimeFrontend.js`, both temp files deleted):
**21 red, 6 green**. The 6 green are controls that must hold on both: the `na` element stop,
the one-declaration binding control, the method-plus-function refusal, the `pine:member`
refusal for an untyped chain, and the two door rails. Red on master, green on tip: every test
in sections 1-4 except those two controls, and in section 5 "does not settle", "cannot type at
all" (message), "cannot tell apart", "does not read", "W6-U1". Log `runs/w6-t9/vt-master.log`.

`objectDoorGate.test.js`: three shapes added (`t9_overload`, `t9_chain`, `t9_field_coll`, the
`false` flavour): the door draws nothing new, the pane builds each, the same build at the door
falls back to master's refusal. 9 tests green.

Changed existing rail: `udtRecords.test.js` "a Pine 6 `method` gets its OWN guard". History
(`git log -S`): added `69cf1b0f39` (2026-09-22) to keep `method` under its own guard rather
than `runtime:udt`; its `Point` / `array<float>` overload pair was set by `8009fce4ee` (C11,
2026-09-29) because "what keeps this guard is an OVERLOADED name, which Pine resolves by the
receiver's type and this lane does not". T9 now resolves exactly that pair (it is served in
`w6ReceiverTypes`), so the case moves to an overload the receiver type cannot settle (two
declarations on `Point`); the assertion (guard `runtime:udt-method`, message names the method)
is unchanged.

Targeted vitest (Node 20.20.2, `--maxWorkers=1`, after ram_gate): w6ExprType, w6TypeDescriptor,
methodsAndArrayMembers, udtRecords, methodDrawings, w6KeywordHonesty, w6ForIn, w6ArrayMembers,
objectDoorGate, w6ReceiverTypes: **10 files, 374/374 passed**. Log
`_resume-2026-11-01/runs/w6-t9/vt4.log`.

## Hand mutations

`_resume-2026-11-01/runs/w6-t9/muts.json`, run with mutate.py's own loop at `--maxWorkers=1`
over `w6ReceiverTypes.test.js` + `objectDoorGate.test.js`; restores byte-exact. Log
`runs/w6-t9/handmut.log`.

| mutation | result | killed by |
|---|---|---|
| M0 no-op control (comment) | survived (control) | none, as required |
| M1 dispatch by declaration order | KILLED | overloads: two `clr`; field receiver |
| M2 untyped shadowing (any defined name shadows) | KILLED | typed shadowing rule |
| M3 no slot refinement (`receiverInitTy` = `initialiserTy`) | KILLED | chain through a copy; fn-result loop bound; field array copy |
| M4 no W6-U1 guard | KILLED | W6-U1 refusal |
| M5 served at the door | KILLED | door rails (w6ReceiverTypes section 6, objectDoorGate t9_*) |
| M6 `copy` aliases the receiver | KILLED | shallow copy rail |
| M7 int/float overloads not detected | KILLED | cannot tell apart |
| M8 pick the first fitting overload | KILLED | does not settle |
| M9 a namespace head read as a receiver | KILLED | name form of a built-in (value position, added after the first run where it SURVIVED: the statement form never reached the guard) |
| M10 member arm without `exprType` | KILLED | copy refusal; chains |
| M11 no `needsRuntime` claim | KILLED | field receiver; method on element; others |
| M12 copy of any receiver | KILLED | copy-of-a-call refusal |
| M13 no drawing-chain claim | KILLED | drawing member off an element |
| M14 an overload on an untyped receiver not refused early | KILLED | cannot type at all (message; first run SURVIVED, the later "does not settle" refusal caught the same shape, so the rail now pins the early sentence) |

15 mutants: 14 killed, 1 no-op control survived. Logs `runs/w6-t9/handmut.log`, `handmut2.log`.

## Canary / hostParity

`node tools/pine_runtime_host_parity.mjs --host node --check` on the tip (bundle built fresh):
**HP-1 GREEN: 164/166 cases equal the committed digests; 2 REPORTED** (`transcendental@forming`,
`transcendental@listing`: the known V8 Math.sin/cos 1-ulp note, not gated). No hostParity case
and none of the 10 `services/pine_runtime` canary cases (a subset of that corpus, incl.
`methods_udt@listing`) changes status or digest. Log `runs/w6-t9/hp1.log`.

## Light checks on named scripts (local, not a census)

Raw sources through the FE, master vs tip, runtime pane and door (`runs/w6-t9/st0.txt`,
`sm0.txt`). Door: identical on all 14. Pane: first wall moves on
`enhanced-mcclellan-summation-index` (pine:member -> runtime:conditional-history, W4),
`support-and-resistance-zones-feels` (pine:builtin -> runtime:loop, T11),
`trend-speed-analyzer-zeiierman` (expression-statement -> runtime:conditional-history, W4).
`adx-and-di-for-v4`: identical values. Others stop earlier on walls outside T9
(`realtime-untold`, W7 lower-tf, `session.isfirstbar`, `ta.dmi`). measure-pair will measure it.

Not served, by design: `smart-money-volume-activity` (`lt_v` is `request.security_lower_tf`,
W7), `footprint-strategy` and `lorentzian-…` / `trailing-take-profit-…` (library types, W8),
`stop-loss-clustering` (`array<chart.point>` receiver: unreadable type, refused by name).
`gaps` (built-in) needs T6's `for … in` inside a function (W6-F1).

## measure-pair / final-tip

Not run yet (heavy; coordinator schedules). Expected movers per the spec:
`trend-speed-analyzer-zeiierman` (+W4) and the +W1/W3 rows.

## Fix round r1 (review `_resume-2026-11-01/dsk/reviews/W6-T9.md`, NO-GO @96af51f9ae)

**B1, the C18 door gate in `memberRecvUdt` had no rail.** Every site where W6-T9 changes what the door
builds was listed and each gate removed alone in a copy of the FE (`runs/w6-t9/doorgates.py`, a battery of
38 synthetic shapes x objectsInRun 0/1, at the door, compared with the unmutated tip; log `doorgates.log`,
`doorgates2.log`):
- 8 sites change the door when their gate goes: `methodCallOf`, `overloadRefusal`, `isReceiverCall`,
  `memberRecvUdt`, `receiverCallOf`, `userMethodShadows`, `receiverInitTy`, the call arm. Each now has its
  own `objectDoorGate.test.js` shape (describe "W6-T9 receiver types keep master's answer at the object
  door, site by site", 8 tests) and its own mutant (G01-G13 below). `memberRecvUdt`'s shape is the
  reviewer's `f_rt(close).o`.
- 5 gates changed nothing at the door under any shape: `resolveMethod`'s single-declaration test,
  `isOverloadedMethod`, and `exprType`'s three method arms (overload result, `.copy()`, `Foo.copy()`).
  They are TYPE READERS whose answers reach the door only through the 8 gated sites (the other `exprType`
  callers are T6's `for … in`, refused by name at the door, and the method-form family callback on a
  slot name). A gate inside a reader cannot be proved, so the 5 were REMOVED rather than railed (lesson:
  a guard repeated is a guard unproved). The FE header names the 8 door sites.
- Door identity: the 38-shape battery at the door is byte-identical between master 81a4665a5a's FE and
  the tip, for objectsInRun 0 and 1 (`runs/w6-t9/dm0.txt`/`dt0.txt`, `dm1.txt`/`dt1.txt`).

**N1.** The manual's sentences are quoted (Methods x4, Objects x2, read 2026-11-06, the reviewer's
quotes) in the `w6ReceiverTypes` header, the FE band header, and the `recordCopyOf` comment.

**N2 (coordinator) / N3 (review): an `array<int>` receiver was served by an `array<float>` overload.**
This lane has one number type, so it cannot tell an `int` receiver from a `float` one, and no manual
sentence says a collection receiver converts in overload choice (the `getType()` example tells `int` from
`float`). Now: an OVERLOAD whose chosen receiver type holds a number (a number, or a collection or map of
numbers) refuses by name, `runtime:udt-method` "... this lane has one number type (W6-U1)". A single
declaration (master's binding) is unchanged. Queue: `docs/pine/capture-queue-2026-11-06-w6.md` row W6-U1,
probe `tools/visual_conformance/probes/vw-w6-receivers.pine` (rows U01-U09; U08-U09 settle this). Rail:
"N2 - an overload whose receiver holds numbers" (array<int>, array<float>, a float scalar). The served
overload rails now use `array<string>` / `array<bool>` and record types. Consequence: `fx-market-sessions`'
`clear(array<float>)` dispatch is refused by name until U08 is captured.

**N4.** Two declarations on the same non-number receiver now say "two of them take the same receiver type,
and Pine then chooses by the other arguments"; the int/float sentence is kept for number receivers. Rail +
mutant N4.

**Review N2 (tyCompatible name check unrailed).** Rail "3b": a method on `Foo` does not run for a `Bar`
receiver. Mutant MA.

**N5.** T7 is not merged; any `definedNames.has(m)` site T7 adds keeps master's untyped shadowing. The
targeted rails are to be re-run on the merged tree before final-tip.

Targeted vitest, the same 10 files: **385/385**. Log `runs/w6-t9/vt5.log`.

Hand mutations r1 (`muts.json`, 26 mutants, w6ReceiverTypes + objectDoorGate, `--maxWorkers=1`, restored
byte-exact; log `runs/w6-t9/handmut3.log`):

| mutation | result |
|---|---|
| M0 no-op control | survived (control) |
| M1-M14 (round 0 set; M8 re-pointed at the new line) | all KILLED, each with named failing rails |
| G01 `methodCallOf` door gate | KILLED (named failing rail) |
| G02 `overloadRefusal` door gate | KILLED (named failing rail) |
| G04 `isReceiverCall`, G05 `memberRecvUdt`, G07 `receiverCallOf`, G08 `userMethodShadows`, G09 `receiverInitTy`, G13 call arm, N2, N4, MA | **UNVERIFIED**: vitest exited non-zero with NO failing test line. The harness reaped the run for low system memory at this point, so these results may be crashes, not kills. Re-run them (the coordinator schedules it; the session does not restart a reaped job). The door battery (`doorgates2.log`) already shows each G-site's shape changing at the door when its gate goes. |

### mutate.py batch (r1, coordinator GO 2026-11-06)

Tip `a7d15ed9f0`. `ram_gate` (free 15.9 GB at start), under `_resume-2026-11-01/dsk/heavy-mut.lock`, in three runs
(`mb0.json`, `mb1.json`, `mb2.json`, each opening with the no-op control M0), `mutate.py`'s loop at `--maxWorkers=1`
plus a stop if free RAM falls below 4 GB (never reached), over `w6ReceiverTypes.test.js` + `objectDoorGate.test.js`.
Restores byte-exact; `git status` clean afterwards. Logs `runs/w6-t9/mb0.log`, `mb1.log`, `mb2.log`, `mbsummary.txt`.

**26 mutants: 25 KILLED, each with named failing tests (2-4 per mutant); the no-op control M0 SURVIVED in all three
runs.** This replaces the r1 hand run's UNVERIFIED rows: G04, G05, G07, G08, G09, G13, N2, N4 and MA are each killed
by a named rail (G04/G05/G07/G13 by their own objectDoorGate site shape; G08 by the `userMethodShadows` site shape and
the pane rail; G09 by `t9_chain` and the `receiverInitTy` site shape; N2, N4, MA by their w6ReceiverTypes rails).
M1-M14, G01 and G02 are killed again.

### measure-pair (tip `4d105d38af`, code `a7d15ed9f0`, base `81a4665a5a`)

Coordinator run, Node 20.20.2, log `runs/w6-t9/mpr/mp-all.log`, per-runtime data `mpr/mp0/`, `mpr/mp1/`.

| surface | runtime 0 | runtime 1 |
|---|---|---|
| out (395 rows) | 0 differ | 0 differ |
| probe (69 rows) | 0 differ | 0 differ |
| harness (336 captures) | identical (MATCH 93 / DIVERGE 103 / INCONCLUSIVE 140 both sides) | identical (112 / 107 / 117 both sides) |
| census (967 rows) | 6 differ | 15 differ |

C18 is clean: no served value moved on either runtime.

### census adjudication (21 movers: 12 PROGRESS, 9 NEUTRAL, 0 REGRESSION)

Method: every mover's steps read tip-vs-base from `census.jsonl` (guard, line, attemptedOps, rtProbe guard, line and
message), the walls looked up in the source, and the doubtful shapes re-run as single synthetic scripts through
`runs/w6-t9/run.mjs` on the tip and on a base checkout (no corpus run). "Wall N" is census step N.

Runtime 0 (runtime dark), 6 rows, all **NEUTRAL (timeout noise)**: ai-supertrend-x-pivot-percentile, multi-timeframe-
trend-indicator, volatility-coil-edge, halftrend-longshort, luxy-momentum, mirage-liquidity-sweep. Every one of them
has a `pine:timeout` step on one side, or `attemptedOps` 0 on the step that differs (the object analysis ran out of
budget), or a `pine:timeout` dropHead. The same six rows are byte-identical tip-vs-base on runtime 1. This lane
does not touch pine.js or the object program.

Runtime 1, 15 rows:

| script | verdict | why |
|---|---|---|
| builtin:gaps__Gaps (peel 6 vs 5) | PROGRESS | base wall 2 is `pine:member` at `allGaps.shift().delete()`. Its peel deletes the only call into `method delete(Gap)`, so the method body is never compiled. The tip types the chain and reaches the body: `runtime:loop` (a `for … in`) and then `runtime:block-value`. The extra peel step is a deeper wall, and the shared tail (statement, builtin, attach) is the same. |
| fx-market-sessions | PROGRESS | base walls 2-4 are `runtime:udt-method` at the overloads `clear(array<string>)`/`clear(array<float>)` and `create(Dot)`/`create(Candle)`. The receivers are distinct, so the tip serves them. Its call `price_ranges.clear(length)` has 2 arguments, which built-in `array.clear` does not take. The tip's walls reach 848/851. |
| ict-institutional-order-flow | PROGRESS | the tip types `IS.imbalance.size()` and `.unshift()` (base walls 5-7) and reaches a deeper `runtime:block-value` at 926 inside the reached body. |
| ipda-standard-deviations | PROGRESS | base wall 1 is `delete` "declared more than once": `delete(DexterDev)` beside `delete(TimeWindow)`, which are distinct receivers. The tip serves it. Its other walls are base's list minus that wall, shifted up one step, so the guards only *look* like they become `call-undeclared-builtin-state`. One more wall (76) is reached inside the cap. |
| support-resistance-mtf-flux-charts | PROGRESS | base walls 3-6 (field/member at 297-313) are served by the tip. The tip's wall 3 is base's wall 7 (`runtime:loop` 270), and it goes deeper. |
| tehthomas-aligned-timeframe-fvg (peel 4 vs 7) | PROGRESS | base walls 2-4 (`oldFvg.isFilled`, the block-value and the `unshift` statement) are served by the tip. Both attach, and the tip needs 3 fewer peels. |
| volume-delta-hapharmonic | PROGRESS | base walls 0-1 (`pine:builtin` 87/88) are served by the tip, and its list starts at base's wall 2. |
| volumized-order-blocks | PROGRESS | `currentOB.breaker` (256, 297) is typed by the tip. The tip then refuses `top.y`/`btm.y` (264, 305), lines that base never reached because it peeled the whole `if` chain at 256/297. The guards are honest and the count is the same. |
| auto-chart-patterns-trendoscope | PROGRESS | base wall 7 `o.OHLC.new` (271) is passed, and the tip's wall 7 is later (291). |
| dynamic-swing-anchored-vwap | PROGRESS | base walls 2, 3 and 5 are `expression-statement` at `vwap.points.clear()`/`.push()`. The tip types the field array: `clear` is served, and the `push` walls move into the argument (`chart.point.from_index`, `call-undeclared-builtin-state`). That is a deeper wall, and the tip reaches 114 where base stopped at 102. |
| support-and-resistance-zones-feels (stuck nothing-drawn) | PROGRESS | base walls 0-6 (`existing.isResistance`, and `copy.size`/`copy.get(0).strength` on `copy = zones.copy()`) are typed by the tip; `copy` is a local `array<Zone>`. The tip's wall 0 is base's wall 7 (`runtime:loop` 142). After 7 peels, which removed the loops that BUILD the zones, the peeled script runs and draws nothing, so the row reports `stuck=runtime:nothing-drawn`. That is a measurement-only artefact of a peeled script (census_peel.mjs: "MEASUREMENT ONLY"). The real script is still refused at the host (`pine:block`, unchanged), and out/probe show 0 differ, so no wrong answer is served. |
| trend-speed-analyzer (peel 4 vs 7) | PROGRESS | base walls 0-3 (`bearish.change.unshift()` etc.) are served. The tip now reaches the attach, where base did not. |
| enhanced-mcclellan-summation-index | NEUTRAL | base wall 0 is `pine:member` on statement 105-108 (`bar.new(...).mc().ha()`). Its peel removes the only users of `adv`/`dec`. The tip compiles further and refuses their definitions at 102/103, by name: `null` is the script's method and the receiver (a `request.security` result) is untyped (W6-U1). Single-script check: `request.security(…, bar.new(close)).null()` REFUSES on base (`pine:member`) and on the tip (`runtime:udt-method`), so nothing is newly refused. With a typed receiver (`mk(close).null()`), base refuses and the tip serves `[100,102,…,110]` (correct). |
| smart-money-breakouts-chartprime | NEUTRAL | same line 92, same depth. The guard is renamed (`expression-statement` `Volume.SCR.push()` to `pine:builtin` `Volume.SCR`), and the peel count is the same. |
| multi-timeframe-trend-indicator | NEUTRAL | refusal count only, on `pine:timeout` steps (noise). |

No REGRESSION: no script hits an earlier first wall at the same depth, is newly refused, or is newly stuck on the real
(unpeeled) script. No fix needed.

### merge origin/master (engine 22, `4ca464f6e3`)

Clean merge, no conflicts (T7 and T8 are not on master). Master brings `pineRuntimeFrontend.js` (+93, W34-I6a
switch-arm wrap), objectDoorGate (+7) and engine 22; `SCRIPT_ENGINE_VERSION` is not edited by this lane. Targeted
rails on the merged tree, Node 20.20.2, `--maxWorkers=1`: w6ReceiverTypes, objectDoorGate, udtRecords,
methodDrawings, w34I6SwitchArmWrap, p3WsaReviewFixes, **6 files, 341/341**.

## r2: final-tip regression fix (runtime lane served a collection member off a call)

**Finding (coordinator's final-tip run):** `ast/postfixMember.test.js:183`, "⭐ C ... the RUNTIME lane answers alike",
went red on the T9 tip and is green on master `9485efc2b8`. SRC `plot(close + array.new_float(1, 5.0).size())`: the
host (`translatePine` strict) refuses `pine:member` line 3; the T9 tip's `buildRuntimeIr` returned `ok: true`.

**Root cause:** `receiverCallOf`'s last arm (the built-in member on a COLLECTION the receiver's type says it is) took
ANY non-slot receiver. A postfix `.size()` whose receiver is a call (`array.new_float(…)`, `a.copy()`, `a.slice(…)`,
`f()`, all parsed as a `call` node) or a postfix method (`os.get(0).mk()`) typed through `exprType` as `array<float>`
and was lowered as `array.size(<call>)`, so `needsRuntime`/`isReceiverCall` routed it to the runtime lane and it was
served, while the host lane refuses it through `pine.js`'s one Resolver. Master's FE never reached that arm (it is
T9's), so on master the shared Resolver answered for both lanes. Probe, original tip FE: all 5 shapes below served
on the runtime lane, refused `pine:member` on the host.

**Spec check:** W6-BREAKDOWN section 4 T9 item 3 serves built-in members on collections "held anywhere typed: a UDT
field (`ob.levels.size()`), a typed parameter". Item 2 serves chains of USER methods and fields (`f(…).m()`). No
item serves a built-in collection member read off a call's result, so the agreement is restored (the brief's
default), not served.

**Fix** (code `5831b98474`, `pineRuntimeFrontend.js`, `receiverCallOf`): the collection arm takes only a `name` receiver (a non-slot
name, or a dotted field path `ob.levels`) or a `member` receiver (a field read off a chain, `os.get(0).xs`, kept as
T9 item 3 progress). A `call` or `method` receiver returns null, so the shared Resolver refuses it `pine:member`
with the host's line. The header comment no longer claims "an element `a.get(i).size()`, a function's result".

**Rails** (`w6ReceiverTypes.test.js`, new section 5b, 7 tests): 5 shapes refuse `pine:member` at the SAME line in
BOTH lanes (a built-in constructor's result l3, `a.copy()` l4, `a.slice(0, 2)` l4, `f()` l5, a user method off an
element `os.get(0).mk()` l9, the guard's `method` arm); 2 controls stay served (`o.xs.size()`, and
`os.get(0).xs.size()` = 2 on every bar, the guard's `member` arm). Recv-type instrumentation (temporary, removed,
`cmp` same) showed the 4 corpus-style shapes reach the line as `call` and only the user-method chain as `method`.

**Hand mutations** of the one guard line (copy, sed, run w6ReceiverTypes + postfixMember, restore by copy, `cmp`
same after each), Node 20.20.2, `--maxWorkers=1`:

| mutant | result |
|---|---|
| R1 delete the guard (= the r1 tip) | KILLED, 6 red (postfixMember C + 5 in 5b) |
| R2 refuse only `call` receivers | KILLED, 1 red (`os.get(0).mk().size()`) |
| R3 refuse only `method` receivers | KILLED, 5 red |
| R4 take only `name` receivers (drop `member`) | KILLED, 1 red (`os.get(0).xs.size()` control) |

The original tip FE against the new rails: 6 red, 59 green (the same set as R1).

**Folder-wide run** (fix applied, before the 5b test-file additions, FE byte-identical to the committed one):
`vitest run --maxWorkers=1 src/components/chart/engine/ast src/components/chart/engine/runtime`, Node 20.20.2:
**505 files: 501 passed, 4 skipped; 7841 tests: 7830 passed, 11 skipped, 0 failed** (1556 s). After the test-file
additions: w6ReceiverTypes + postfixMember 65/65.

**Measure-pair:** the census rows above name only field or name receivers (`IS.imbalance.size()`, `copy.size`,
`bull.change.size()`), which keep their path. The coordinator's measure-pair re-run is the authority; not run here
(light phase).
