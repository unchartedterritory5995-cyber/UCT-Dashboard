# W6-T9 receiver types — EVIDENCE (desktop)

**NEXT STEP: coordinator-scheduled heavy jobs, in order: (1) `mutate.py` batch over `muts.json`
(the hand run below already kills every mutant; the batch re-runs it under the lock), (2)
measure-pair runtime 0 and 1 against the tip's own master on a shared base (`heavy-mp2.lock` /
`heavy-mp3.lock`), (3) merge origin/master again, final-tip FULL scope, ready-check.**

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
