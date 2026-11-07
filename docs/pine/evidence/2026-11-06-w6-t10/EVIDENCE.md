# W6-T10 evidence: `enum` and `input.enum` on the runtime lane

Branch `feat/pine-w6-t10-enum`, built from `origin/master` `0aeffdc0e9` (engine 24). Spec: `docs/pine/W6-BREAKDOWN.md`
(branch `docs/pine-w6-breakdown`), T10 and sections 3 and 6. Light phase only: no `mutate.py`, measure-pair or
final-tip was run, and no heavy lock was taken (the coordinator schedules those).
Code tip: `157f95c70b`. Tested on master `0aeffdc0e9`. `SCRIPT_ENGINE_VERSION` not edited.
**Engine bump: yes (coordinator's call).** Scripts with an `enum` go from `runtime:statement` to served or to a named
`runtime:enum` refusal on the runtime pane. The C18 object door is unchanged by construction (see below).

Dependency note: the coordinator's brief says T7/T8/T9 are on master. At `0aeffdc0e9` they are not (`collections.js`
holds no `matrix.*` / `map.*`; no W6-T7/T8/T9 merge in the log). So the spec's "as a map key (T8)" and "in a
collection" are not served here; both refuse by name (an enum as a call argument), and the W6-E1 probe carries a map-key row.

## Authorities
- Pine manual, *Enums* (`https://www.tradingview.com/pine-script-docs/language/enums/`), read 2026-11-06.
- Pine v6 reference, keyword `enum` and `input.enum`, read 2026-11-06 through `tools/pine_survey/pine_reference_extract.js`.
They state: `enum <Name>` then one field per line, `<field> [= <title>]`, the title a `const string`, a missing
title being the field's name; each field a unique member; `E.field` bound to variables, compared with `==` / `!=`,
used in `switch` and conditionals; `input.enum(defval, title, options, ...)`, where an `options` tuple must include
`defval`. No licence-held text is committed; the rail and probe are written here.

## What changed
- `ast/pineRuntimeFrontend.js`
  - `collectEnums(stmts)` (exported) and `enumDeclarationHead`: the top-level `enum` declarations, read before the
    walk, so a use above the declaration binds. The block reader joins the field lines into the declaration's header
    (as for `type`), so fields are read one per source line. A declaration it cannot read exactly carries `bad`.
  - `enumValueKey(E, field)` (exported): the runtime value of `E.field`, a text key built from the FIELD name.
  - Enum helpers in the closure: `enumOf` (static enum of a node: a field, an enum slot, an `env` name, `input.enum`,
    a `?:` of one enum), `containsEnum`, `admitEnumBinding`, `admitEnumAssign`, `lowerInputEnum`.
  - `lowerExpr` entry: an enum-valued node is lowered only if its parent admitted it (`enumOk`), else `runtime:enum`
    by name. Parents that admit: a binding (`var`, plain, written `E x =`), `:=` into a slot of the same enum,
    `==` / `!=` with the same enum on both sides (the `binary` arm; a `switch` on an enum lowers to it), a `switch`
    subject hoisted to a temporary, the arms of an admitted `?:`, and the expression an admitted name stands for.
  - The column route skips any subtree holding an enum (`containsEnum`); `initialiserTy` types an enum slot
    `{kind:'enum', name}`; `writtenTyOf` passes the enum set to `tyOfTypeWord` (T3a's planned hook).
  - Statement arm: a top-level `enum` emits nothing; a nested or repeated one, or a bad one, refuses by name.
    The `type` arm refuses an enum-typed field by name.
  - New guard `runtime:enum` in `RUNTIME_REFUSALS`, family `language` (`builder/editorStatus.js`,
    `docs/pine/EDITOR-STATUS-PANEL-SPEC.md` section 4 row).
- `runtime/runtimeInputs.js`: `input.enum` stays out of the settings (no knob), with its own skip sentence
  (`ENUM_SKIP`): the menu is the member input UI's work and W6-E1's.
- C18 object door: the registry is empty there and the statement arm is pane-only, so the door builds exactly what
  master built (master refuses the `enum` line). `objectDoorGate.test.js` gets shape `enum_eq` (door: refused, no
  label; pane: builds; door build: master's guard, not `runtime:object-door`).

## Served (rail `app/src/components/chart/engine/runtime/__tests__/w6Enum.test.js`, 24 tests)
Fields with and without titles; `x = E.b` then `==` / `!=`; two fields sharing a title are two members; a field whose
title is another field's name; use above the declaration; `var m = E.a` with `m := E.b` per bar; `E m = E.c`; `if m != E.a`;
`switch` on an enum (value from a `?:` of fields); two enums with the same field names; `input.enum` default
(positional, named `defval`, with `options` holding it); `switch input.enum(...)`; settings path skips it by name.

## Refused by name (`runtime:enum`)
- Kept refused until capture W6-E1 (spec): `str.tostring(enumValue)`; an `na` enum value (`E m = na`, `m := na`,
  `c ? E.a : na`, `m == na`); a member-set `input.enum` (the default serves).
- Not built here: an enum read as a number, text or condition (`plot(E.a)`, `"x" + m`, `m ? 1 : 0`, `na(m)`); `==`
  between two enums or an enum and text; a written type that disagrees; `:=` of an enum into a non-enum slot or of
  a non-field into an enum slot; an enum as a call argument (user function, `array.push`, so also a `map` key); an
  enum-typed UDT field; a nested or repeated `enum`; a title that is not one string literal; an unknown field;
  `input.enum` `options` that leave out the default or are not its fields; a block-valued (`switch`/`if`) enum result.
- Known gap (not an enum-specific rule): a pure binding that is never read is never lowered, so `s = "x" + E.a` with
  `s` unused builds (Pine would not compile it). The lane does this for every unused pure binding.

## Capture queue
`docs/pine/capture-queue-2026-11-06-w6.md`, row **W6-E1**, probe `tools/visual_conformance/probes/vw-w6-enum.pine`
(AMEX:SPY 1D): T01-T03 `str.tostring` title or name; E01 same-title `==`; N01-N04 the `na` enum; I01 `input.enum`
default; K01 an enum map key. Not compiled on TradingView.

## Red on master, green on tip
The tip's `pineRuntimeFrontend.js` and `runtimeInputs.js` were swapped for `origin/master`'s (`git show`), the rail run,
and the tip files copied back (diff unchanged after). `w6Enum.test.js` on master: `Tests 22 failed | 2 passed (24)`.
The two that pass are the controls: the object door keeps master's answer, and v4 `enum = 5` is a name.
On the tip: `Tests 24 passed (24)`.

## Targeted runs (Node 20.20.2, `--maxWorkers=1`)
`w6Enum, w6TypeDescriptor, w6ExprType, w6KeywordHonesty, runtimeInputs, runtimeInputKinds, editorStatus.families,
objectDoorGate`: `Test Files 8 passed (8)` after the spec-table row was added (`editorStatus.families` failed once
before that: the new guard must be in section 4's table; fixed).

## Folder-wide runs (`npx vitest run src/components/chart/engine/ast src/components/chart/engine/runtime --maxWorkers=1`)
Final, at tip `157f95c70b` (plus `editorStatus.families.test.js`): `Test Files 5 failed | 498 passed | 4 skipped (507)`, `Tests 6 failed | 7832 passed | 11 skipped (7849)`.
Earlier, at the pre-final tree (the header strip still in): `Test Files 5 failed | 497 passed | 4 skipped (506)`, `Tests 6 failed | 7818 passed | 11 skipped (7835)`. Same six failures both times, all `Test timed out in 15000ms`:
`pineStrictCensus`, `guardProbe.measure`, `objectLaneCallSites.measure`, `objectLaneCensus.measure` (x2), `objectLaneDrawerCensus.measure`. No other failure: every rail outside these corpus measures passes, including the cross-file ones (postfixMember and the rest of `engine/ast`).

The failures are 15 s timeouts in corpus measure files, and they are baseline: the four runtime ones
(`guardProbe`, `objectLaneCensus` x2, `objectLaneDrawerCensus`, `objectLaneCallSites`) time out identically with
master's front end swapped in (`Tests 5 failed | 4 passed (9)` on master and on tip, run alone);
`pineStrictCensus` passes alone (12.4 s) and times out only under the folder run's load.
Logs: `$UCT_RESUME/runs/w6t10/folders-r1.log`, `folders-final.log`, `timeouts-tip.log`, `timeouts-master.log`.

## Hand mutations (`hand-mutations.py` beside this file; each applied to the tip, the rail run, the file restored byte-exact)
Test set: `w6Enum.test.js` (plus `objectDoorGate.test.js` for M14/M14b). Log `$UCT_RESUME/runs/w6t10/muts-final.log`.

| mutation | result | killed by |
|---|---|---|
| C0 no-op control (a comment) | SURVIVED, as a control must | |
| M1 compare enums by TITLE (spec) | KILLED | two fields with the SAME title; a field whose title is another field name |
| M2 the leaf guard admits everything | KILLED | an enum value as a number, text or condition; a collection element / function argument |
| M3 drop the `str.tostring` W6-E1 refusal | KILLED | str.tostring of an enum value |
| M4 `==` admits two different enums | KILLED | == against another enum or text |
| M5 `:=` admits any value | KILLED | the na enum value; wrong types at an assignment |
| M6 member-set `input.enum` served | KILLED | a member-set input.enum refuses by name |
| M7 `options` need not hold the default | KILLED | options that leave out the default |
| M8 written type ignored at a binding | KILLED | the na enum value (`E m = na`) |
| M9 nested / repeated `enum` accepted | KILLED | a declaration this lane cannot read exactly |
| M10 initialiser does not type an enum slot | KILLED | var slot with `:=`; written type and if; switch on input.enum |
| M11 enum-typed UDT field accepted | KILLED | an enum-typed field |
| M12 a bad declaration served | KILLED | a declaration this lane cannot read exactly |
| M13 column-route exclusion removed | KILLED | 14 served-shape tests |
| M14 registry built at the object door | KILLED | objectDoorGate `enum_eq` door rows |
| M14b statement arm also at the object door | KILLED | the C18 object door keeps master's answer |

An earlier version stripped the field tokens off the declaration's header before the pre-passes. Its mutation (M15,
"field lines not stripped") SURVIVED, and with it M14 survived too (two guards over one door fact). The strip was
removed rather than shipped unproved; the rerun above is on the final code, where M14 and M14b each kill.

## Not run (coordinator schedules): `mutate.py`, measure-pair (both lanes), final-tip, ready-check.
Expected measure-pair: no census row moves (breakdown section 0, finding 5: no census script reaches an enum);
C18 diffs 0 (door unchanged by construction, railed).

## r1 (review GO-WITH-NOTES @a86e365e4c, note N2): reserved enum names
- `collectEnums` marks a declaration `bad` when its name is in `ENUM_RESERVED_NAMES`: every namespace heading a
  variable, constant, function or method in the Pine v6 reference, plus every type it lists (reference extracted
  2026-11-06 with `tools/pine_survey/pine_reference_extract.js`). The manual, *Enums*: an enum name must not match a
  built-in type or namespace, and such a name is a compilation error. W6-T2 has no namespace roster to reuse (its
  rule covers the `method` keyword only), so the list is new and cites the reference.
- The statement arm also refuses an `enum` sharing its name with a `type` the script declares (the manual: enum names
  are unique).
- Rail: 3 new tests in `w6Enum.test.js` (`enum color` / `syminfo` / `float` / `polyline` refuse; `enum Q` beside
  `type Q` refuses; `enum colors` still serves). 27/27 on the tip. The first two were red before the fix
  (`enum color` served, as the reviewer found).
- Hand mutations (`hand-mutations.py`): C0 control SURVIVED; M16 reserved names accepted KILLED; M17 enum named like a
  declared type accepted KILLED; M1 re-run KILLED.
- Door: unaffected (the registry is empty at the door).

## mutate.py (heavy-mut.lock, taken free; 5.4 min) at `237a17f62d`
`mutate.py runs/w6t10/muts.json w6Enum.test.js objectDoorGate.test.js` (the 18 mutations of `hand-mutations.py`):
C0 control SURVIVED; M1-M14, M14b, M16, M17 all KILLED (17 of 17). Tree clean after (`git status` empty).
Log `$UCT_RESUME/runs/w6t10/mutate.log`.

## Measure-pair (heavy-mp.lock with ram_gate; 84.2 min) tip `237a17f62d` vs base `pine-dsk-mpbase` at merge-base `0aeffdc0e9`
Base clean and lock free before launch; heads asserted unmoved before and after each side.
Scripts `$UCT_RESUME/runs/w6t10/mpr/mp.sh`, `mp-launch.sh`; logs `mp-all.log`, `mp0.log`, `mp1.log`.

| runtime | C18 out | C18 probe | harness | census |
|---|---|---|---|---|
| 0 | 395 rows, 0 differ | 69 rows, 0 differ | identical (MATCH 93 / DIVERGE 103 / INCONCLUSIVE 140 both) | 967 rows, 5 differ |
| 1 | 395 rows, 0 differ | 69 rows, 0 differ | identical (MATCH 112 / DIVERGE 107 / INCONCLUSIVE 117 both) | 967 rows, 9 differ |

**0 C18 diffs on both lanes.** Census movers, classified:
- runtime 0 (5): `multi-timeframe-trend-indicator`, `volatility-coil-edge-bullbyte`, `halftrend-longshort-signal-engine-bigbeluga`,
  `luxy-momentum-...`, `mirage-liquidity-sweep-pro`. All are `pine:timeout` budget noise (the 10 s translate budget,
  timeout text, a timed-out drop head or peel count). Runtime 0 does not run the runtime lane's enum code, and none of
  these declares an enum. **Unintended by this lane: 0 (timing noise).**
- runtime 1 (9): eight sources that declare an `enum`. On base each stopped at the `enum` line (`pine:statement` /
  `runtime:statement` / `pine:member`); on the tip each passes it and stops later, at its next wall, or at a named
  `runtime:enum`:
  - `footprint-iq-pro-tradingiq` -> `runtime:request-with-state`
  - `stop-loss-clustering-breakouts-kioseff-trading` -> `pine:builtin`
  - `trailing-take-profit-trailing-stop-loss` -> `runtime:statement`
  - `volume-footprint-measuring-classical-...` -> `pine:builtin`
  - `divergence-screener-trendoscope` -> `runtime:enum`
  - `ichimoku-kinko-hyo` (reference) -> `runtime:call-undeclared-builtin-state`
  - the manual and reference examples (`example:annotations:_enum`, `example:functions:input.enum`) -> `runtime:statement`
  
  All intended. The ninth is `multi-timeframe-trend-indicator` (no enum): the same `pine:timeout` script as on runtime 0.
  Its timed-out refusal line is null on the tip and 135 on base, both `pine:timeout`. That is timing noise.
  No script attaches. No served value changes.

## Merge with origin/master `4a67d2fc31` (engine 28, W6-T8 maps in) -> `c3f2da72b9`
- Conflicts: `objectDoorGate.test.js` (W6-T9's shapes beside `enum_eq`) and the capture queue (W6-M1/U1 beside
  W6-E1). Both resolved as a union.
- T8's `map.*` is on master now. An enum used as a map key (`mp.put(E.b, x)`) still refuses by name (`runtime:enum`,
  an enum as a call argument). `map.new<E, float>()` without an enum value builds. K01 in W6-E1 still applies.
- Rails: w6Enum, objectDoorGate, runtimeInputs, w6TypeDescriptor, w6ExprType, w6KeywordHonesty and
  editorStatus.families: `Test Files 7 passed (7)`, `Tests 382 passed (382)`.
- Folders (`vitest run engine/ast engine/runtime --maxWorkers=1`): `Test Files 4 failed | 501 passed | 4 skipped (509)`,
  `Tests 5 failed | 8083 passed | 11 skipped (8099)`. All 5 failures are the baseline 15 s corpus-measure timeouts
  (guardProbe, objectLaneCallSites, objectLaneCensus x2, objectLaneDrawerCensus). Log `runs/w6t10/folders-merge.log`.
- Measure-pair above was taken at `237a17f62d` against `0aeffdc0e9`, before this merge.
