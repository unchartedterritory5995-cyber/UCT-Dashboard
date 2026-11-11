# W34-I6b The T14 residue: v6 tail `if`/`switch` the bool typer did not reach. Evidence (desktop)

**STATUS: r1 fix done for review NO-GO @ca7c1bb103 (B1). See "Round r1" at the end. Code `7d5a7a2eea`.** Earlier status: light phase done (code, rail, red-on-master, hand mutations). The coordinator schedules the heavy jobs:
mutate.py, measure-pair runtime 0 and 1, final-tip, ready-check. None of them has been run here, and no heavy lock was taken.

Branch `fix/pine-w34-i6b-bool`. Code commit `d6d054cc9c`. Tested-on-master `4ca464f6e3` (engine 22, W34-I6a landed).
Spec: `docs/pine/W34-I6-SPEC.md` section I6b (`origin/docs/pine-w34-i6-spec` @ `9be8910111`).
Engine bump needed: **yes**. Served values change on the runtime lane (item 1 and item 4 shapes now serve, and so
does item 2's non-bool half). No `SCRIPT_ENGINE_VERSION` edit was made.

## What changed (paths under app/src/components/chart/engine/)
- `ast/pineRuntimeFrontend.js`
  - **item 1**: `statementOnlyFn(fn)` decides whether every call site of user function `fn` is a statement. A
    whole-line call (`f(x)`, or `obj.f(x)` for a method) counts only in a position whose value is discarded. Every
    other occurrence counts as a VALUE use: inside an expression, in a condition or argument, in a parameter
    default, in an inline body, in a `switch` arm, or as the last statement of a function body or of a block whose
    value is read. The analysis is conservative: any shape it does not recognise counts as a value use, which keeps
    the refusal. The function-tail `vstate` carries `discarded`, and `armAssignerFor` exposes it as `mk.vstate`.
    `refuseV6UnmatchedBool` returns early (lowered as it stands, with the `na` seed) when the block's value flows
    only into a discarded result. **This applies off the object door only.** The door keeps Q-A3.
  - **item 2**: `armValueCands(lines)` gives every value an arm can yield. A one-expression arm gives itself. An arm
    ending in a COMPLETE nested block (an `if … else` chain ending in a bare `else`, or a `switch` with a default)
    gives its arms' values by recursion. Anything else gives `[null]`, which no type proves. Both callers (the
    `if`-chain lowering and the `switch` lowering) use it. **Off the object door only**: at the door an arm is
    master's one expression.
  - **item 4**: `namedConstantNonBool(nm)` reads `namedConstantTypes.json` and treats a name as non-bool when its
    reference type is in `NON_BOOL_TYPES`. `provablyNonBoolNode` asks it for an undeclared name.
- `ast/namedConstantTypes.json` (new, GENERATED): 47 constants in the families `size.*`, `text.align_*`, `xloc.*`,
  `yloc.*`, `extend.*`, `label.style_*` and `line.style_*`. Each one's reference type with the qualifier dropped
  is `string` (the reference says `const string`). The file holds names and a type word only, no reference text.
- `tools/pine_survey/emit_named_constant_types.js` (new): the emitter, modelled on `emit_length_qualifiers.js`.
  `--check` compares its output with the committed file. It was run against the local v6 reference
  `_w0-2026-11-02/ref/pine_v6_reference.json` (sha256 `91084ea8ae9b…0596`; licence-held, not committed). Result:
  `ok: 47 constants match`. `text.format_*` is typed `const text_format` there, so it is excluded.
- `runtime/__tests__/w34I6V6BoolResidue.test.js` (new rail, synthetic shapes only).

## Item 3 (B4a) was already delivered by T14
`provablyBoolNode` already types `c ? a : b` (both branches bool) and `and`/`or`/`not` as bool. A kioseff-shaped
synthetic (`switch` of `x == false ? a == b : c and d` and `p and q`) is served `false` with the test-only gate
lifted, and is refused by name without it. That holds on master too. What keeps the line-63 wall is the **Q-A3
gate** (`V6_BOOL_UNMATCHED_CAPTURED = false`), not the typer. The spec's reading ("the typer does not read a
ternary of comparisons as bool") does not hold. The item 3 rails pin the T14 behaviour and pass on master by design.

## Item 5: where the named scripts land (sources read locally, never committed)
The probe sentences come from the latest local runtime-on census, `runs/w6-t9/mpr/mp1/tip/census/census.jsonl`.

| script | census line | first-wall sentence | placed |
|---|---|---|---|
| `fibonacci-retracement-statistics-by-volprofex` | 593, 719 | unmatched v6 bool | **item 1**. `recordHtfSwing` (L658, L672) and `finaliseRetracement` (L753, L789) are called only as statements |
| `tehthomas-aligned-timeframe-fair-value-gaps` | 239 | unmatched v6 bool | **item 1**. `addFVG` is called at L249 and L251, both statements |
| `ict-institutional-order-flow-fadi` | 926 | unmatched v6 bool | **item 1**. `method clear` is called as `imb.clear()` / `temp.clear()` statements |
| `ict-institutional-order-flow-fadi` | 477 | "`f_highlightDisplacement(…) => if …` has a branch with no value" | **Not the unmatched-bool rule.** The step-1 peel removed L478 (`pine:builtin` on `Trend_Settings.displacement_show`), which left the arm empty. This is a peel artifact. The un-peeled B2 shape (a nested `if … else` arm, value read) is item 2 and stays Q-A3-gated |
| `volume-delta-oi-delta-kioseff-trading` | 63 | unmatched v6 bool | **item 3**. Already typed bool; held by Q-A3 |
| `volume-delta-oi-delta-kioseff-trading` | 69 | unmatched v6 bool | **item 4**. `size.*` arms with a blank line after the header |
| `edufx-amd` (reference) | 61 | "`drawBoxes(…) => if …` has a branch with no value" | **NAMED, not 1-4.** The source IS on this machine (`pine-sample/reference/edufx-amd__0ca9b3c747.pine`, v6). `drawBoxes` returns a box id (`x := drawBoxes(…)` at L87-97), and one arm's value is a `box.new(…)` the object pass owns. A drawing used as a VALUE is a separate wall (`runtime:object-op` / "a branch with no value"), not T14. No capture row is owed by this lane |

These scripts are not sole for this wall, so the change moves first walls and unblocks nothing in production
(spec "Depends"). The census and harness effect is for measure-pair to classify.

## Capture gating (no new rows)
- Items 2 and 3 (a bool value is read) **inherit Q-A3** (`capture-queue-2026-10-31-wsa-for-bound.md`). The served
  `false` exists only behind the test-only `w4t14ServeUnmatchedFalse`, and the shipped lane keeps the named refusal
  (rails "gate not lifted"). Item 2's non-bool half (`na`) serves without the gate, the same rule T14 applies to a
  flat numeric arm.
- Item 1 (value discarded): `false` and `na` cannot be told apart, so no capture is owed. It applies off the door
  only. The door still refuses Q-A3 (rail "the object door keeps Q-A3"; mutation M1d).
- Item 4: the reference states `const string`, and an unmatched non-bool block is `na` in every version (T14).
  No capture is owed. It follows the existing non-bool rule on both lanes.

## Checks (tip `d6d054cc9c`, tested-on-master `4ca464f6e3`, Node 20.20.2, `--maxWorkers=1`)
| check | command (in `app/`) | totals |
|---|---|---|
| I6b rail, tip | `npx vitest run src/components/chart/engine/runtime/__tests__/w34I6V6BoolResidue.test.js --maxWorkers=1` | **31 passed (31)** |
| I6b rail, master FE (master `pineRuntimeFrontend.js` swapped in, then restored with sha256 `OK`) | same | **14 failed, 17 passed (31)** |
| T14 + I6a neighbours | `w4V6Bool.test.js` | 21 passed |
| | `w34I6SwitchArmWrap.test.js` + `p3WsaReviewFixes.test.js` | 92 passed |
| | `w4FunctionForms.test.js` + `c18WhileAndLastBar.test.js` | 54 passed |
| | `__tests__/p3WsaDarkGate.test.js` + `runtime/__tests__/objectDoorGate.test.js` | 205 passed |
| | `functionBodyBlockValue.test.js` + `p3StatementsBlockValues.test.js` | 39 passed |
| | `blockValuedBinding.test.js` + `blockValuedReassign.test.js` | 25 passed |
| | `ast/h2BlockReassign.test.js` + `ast/irDeferredFunction.test.js` | 19 passed |
| | `declarationPersistence.test.js` + `w4SimpleFolding.test.js` | 34 passed |
| | `ast/pineProbeReplay.test.js` + `ast/pineRuntimeTextLane.test.js` | 17 passed |
| emitter | `node tools/pine_survey/emit_named_constant_types.js --ref <v6 ref> --check` | `ok: 47 constants match` |

### Rails red on master, green on the tip (14)
- item 1: v6 tail `if` with no else, every call site a statement: served · v6 tail `switch` with no default, called
  as a statement: served · v6 a statement call inside an `if` statement is still a statement
- item 2: [gate lifted] complete nested `if … else` of bools, unmatched is false · [gate lifted] nested `switch` with
  a default, unmatched is false · v6 nested arm of numbers is na, served on the shipped lane
- item 4: `size.*`, `text.align_*`, `xloc.*`, `yloc.*`, `extend.*`, `label.style_*` and `line.style_*` switches with
  no default (blank line after the header) are served with unmatched `na` (7 rails) · v6 a MATCHED arm still yields
  its constant

The other 17 pass on master by design. They are the v5 controls, the untypable controls that still refuse, the
mixed-call and value-position refusals, the object-door control, the Q-A3 gate-kept refusals, the item 3 pins, and
the generated-table rail.

## Hand mutations (rail file only; each file restored byte-exact, sha256 verified after every one)
| mutation | result | killed by |
|---|---|---|
| M0 no-op control (comment added) | 31 passed | (control survives, as it must) |
| M1a item 1: valueUse ignored (a value call site treated as a statement) | 5 failed | MIXED · last-line-of-another-function · call-inside-expression (+2 item 2 rails whose `f` is called as a value) |
| M1b item 1: `!inValue` dropped (a call at a function tail read as a statement) | 1 failed | last-line-of-another-function |
| M1c item 1: discarded exemption removed | 3 failed | the three item 1 served rails |
| M1d item 1: exemption extended to the object door | 1 failed | object door keeps Q-A3 |
| M2a item 2: recursion stopped | 3 failed | the nested `if … else` / nested `switch` / nested-numbers rails |
| M2b item 2: completeness check dropped (nested chain with no final else recursed) | 1 failed | UNTYPABLE nested chain with no final `else` |
| M2c item 2: default requirement dropped for a nested `switch` | 1 failed | UNTYPABLE nested `switch` with no default |
| M4a item 4: `size.*` typed `number` in the table | 3 failed | table rail · `size.*` switch · matched-arm rail |
| M4b item 4: `size.*` typed `bool` in the table | 3 failed | same three |
| M4c item 4: table not consulted | 8 failed | the seven family rails + the matched-arm rail |

10 of 10 non-control mutants were killed, and there are no equivalent survivors. Script: scratchpad `handmut.py`
(not committed; the `mutate.py` batch is the coordinator's).

## Open items
- The heavy phase is the coordinator's: mutate.py, measure-pair runtime 0 and 1 against `pine-dsk-mpbase` at the
  tip's master, final-tip, and ready-check.
- Q-A3 still gates items 2 and 3 (and kioseff L63). Flipping `V6_BOOL_UNMATCHED_CAPTURED` is the whole change once
  the capture MATCHes.
- The spec's measure-pair witness `volatility-stop` (built-in, L7) is a statement-or-value question for its own
  function. Measure-pair will show whether it moves.

## Round r1 (review `dsk/reviews/W34-I6b.md`, NO-GO @ca7c1bb103)

Code `7d5a7a2eea`, on master `4ca464f6e3`.

### B1 fixed: an `else` arm of a value-bound block is a value read
Cause: in `statementOnlyFn`'s walk, an `else` / `else if` line is a separate list entry from the `y = if …` line that
opens its chain. Its keyword made it count as "a block statement", so it was walked as a statement position, and
`y = if c … else f(x)` marked `f` statement-only (a wrong `na` where Pine 6 gives `false`).
Fix: `walk` records the chain head's value-tail flag (`chainValued`). An `else` line's sub is now walked as a value
tail whenever its own position is a value position or the chain it continues is valued. Every arm of every
value-bound `if` (head, `else if`, `else`, and nested inside them) is a value read, and so is every arm of a
value-bound `switch` (already true, now railed). The rule is conservative: an unrecognised shape still counts as a
value use.
N2: item 1 now has ONE door guard, the refusal site (`refuseV6UnmatchedBool`'s `!atObjectDoor`). The `vstate`
pre-filter at the door was removed, so the guard can be mutation-proved (R4 below).

### Rails added (rail now 41 tests, all green on `7d5a7a2eea`)
- These are refused by name with the V6 sentence, gate not lifted:
  - the B1 repro (`else` arm);
  - an `else if` arm (complete chain);
  - an `else` arm inside another function body;
  - a nested `if` inside an `else` arm;
  - the HEAD arm of a value-bound `if` (R1);
  - a block arm of a value-bound `switch` (R1);
  - a parameter default `g(a, d = f(close))` (R7).
- [gate lifted] the B1 repro reads `[5,5,5,5,5,7,7,7]` (Pine 6's answer). The v5 control reads all 7.
- Object door: a nested numeric `if … else` arm is not recursed into (refused, Q-A3) (R3).
- Neighbours after the fix:
  - `w4V6Bool` + `objectDoorGate`: 182 passed;
  - `functionBodyBlockValue` + `w34I6SwitchArmWrap`: 18 passed;
  - `p3WsaDarkGate` + `p3WsaReviewFixes`: 127 passed.

### r1 hand mutations (rail file; FE restored byte-exact, sha256 OK after the batch)
| mutation | result | killed by |
|---|---|---|
| r1-M0 no-op | 41 passed | (control) |
| r1-M1 B1 fix reverted (else arms take their own flag) | 5 failed | 4 else-arm rails + gate-lifted B1 repro |
| r1-M2 `chainValued` never recorded | 5 failed | same |
| r1-M3 else arms ignore the chain flag | 5 failed | same |
| R1 `walk(st.sub, inValue)` (a value-bound tail read as a statement) | 7 failed | the 6 block-read rails + gate-lifted repro (head-arm and switch-arm rails close the gap) |
| R3 `armValueCands` recurses at the door | 1 failed | door no-recursion rail (KILLED now; it survived the review because no door rail existed) |
| R4 the single door guard removed | 1 failed | "object door keeps Q-A3" (KILLED now that the door has one guard) |
| R7 function-definition headers not scanned | 1 failed | parameter-default rail |
| R2 bareCall no longer requires an empty sub | 41 passed | **EQUIVALENT** (see below) |

R2 is equivalent. A whole-line call that carries a `sub` is a call followed by a deeper-indented line (for example
`f(close)` then `     + 1`). The statement lowering refuses that line by its own guard, `runtime:statement`
("`f()` is not a shape this front end reads"), and that guard does not consult `statementOnlyFn`. The same refusal
was observed on the tip with and without the sub condition. So whether `f` counts as statement-only cannot be
observed: the script refuses at the line either way. The condition stays as fail-closed belt.

## Measure-pair, mutate.py, merge (after re-review GO @fea38c2785)

### Measure-pair (tip `fea38c2785`, base `pine-dsk-mpbase2` detached at the merge-base `4ca464f6e3`)
- Lock: `dsk/heavy-mp2.lock`, which was free at launch. The RAM gate was on. Both HEADs were verified before and after
  each lane.
- Logs: `$UCT_RESUME/runs/w34-i6b/mpr/mp-all.log` and `mp0/`, `mp1/`. The compare tool was `runs/w6-t7/mpcompare.py`.

**Runtime 0**

| check | tip side | base side |
|---|---|---|
| `== side` SHA | `fea38c2785` | `4ca464f6e3` |
| captures | 336: MATCH 93, DIVERGE 103, INCONCLUSIVE 140 | identical |

- C18 out: 395 rows, 0 differ. C18 probe: 69 rows, 0 differ.
- Harness: identical.
- Census: 5 rows differ.

**Runtime 1**

| check | tip side | base side |
|---|---|---|
| `== side` SHA | `fea38c2785` | `4ca464f6e3` |
| captures | 336: MATCH 112, DIVERGE 107, INCONCLUSIVE 117 | identical |

- C18 out: 395 rows, 0 differ. C18 probe: 69 rows, 0 differ.
- Harness: identical.
- Census: 7 rows differ.

**C18: 0 diffs on both lanes.**

| lane | census row | verdict | why |
|---|---|---|---|
| rt0 | `example:keywords:method#0` | PROGRESS | `runtime.attached` false -> true. This is the reference's `method` example: `maintainArray` (tail `if` with no else, `id.shift()`) is called only as the statement `prices.maintainArray(50, close)`. That is item 1, and the value is discarded |
| rt0 | `volatility-coil-edge-bullbyte` | NEUTRAL | the order of the `pine:timeout` dropHeads differs (time budget) |
| rt0 | `halftrend-longshort-signal-engine-bigbeluga` | NEUTRAL | the timeout reason text differs (10000ms budget vs nesting depth); both are `pine:timeout` |
| rt0 | `luxy-momentum-trend-and-breakout-…` | NEUTRAL | `guard:reset` 11 vs 10, inside a step whose dropHeads are all `pine:timeout`; same refusal |
| rt0 | `mirage-liquidity-sweep-pro-willyalgotrader` | NEUTRAL | one dropHead is `pine:timeout` vs `pine:tuple` (time budget) |
| rt1 | `fibonacci-retracement-statistics-by-volprofex` | PROGRESS | the step-1/2 probe `runtime:block-value` (L593, L719) is gone, so the first wall moves to `pine:drawing` `box.all` L862 (item 1) |
| rt1 | `tehthomas-aligned-timeframe-fair-value-gaps` | PROGRESS | peelSteps 7 -> 5: the `runtime:block-value` L239 and `runtime:statement` L236 walls are gone (item 1) |
| rt1 | `volume-delta-oi-delta-kioseff-trading` | PROGRESS | the step-4 probe `runtime:block-value` (L69 `size.*`) is gone, so the wall moves to `runtime:request-with-state` (item 4). L63 is still refused (Q-A3) |
| rt1 | `volatility-coil-edge-bullbyte` | PROGRESS | the step-6 probe `runtime:block-value` (L615) is gone, so the wall moves to `runtime:colour` |
| rt1 | `dynamic-support-and-resistance-with-trend-lines-multi-language` | PROGRESS | the step-6 probe `runtime:block-value` is gone, so the wall moves to `runtime:history-dynamic-offset` |
| rt1 | `example:keywords:method#0` | PROGRESS | attached false -> true (as on rt0) |
| rt1 | `multi-timeframe-trend-indicator` | NEUTRAL | 3 vs 2 `pine:timeout` refusals in timed-out steps; the probes are identical |

**Totals: 7 PROGRESS, 5 NEUTRAL, 0 REGRESSION, 0 unintended.**

### mutate.py
- Lock: `dsk/heavy-mut.lock`, which was free when checked.
- Muts file: `runs/w34-i6b/i6b-muts.json`, 18 entries. Tests: the I6b rail + `w4V6Bool`.
- Log: `runs/w34-i6b/mut.log`. MUT_RC 0, and the tree was clean afterwards.

**16 KILLED.** The killed mutants are:
- M1a, M1b and M1c;
- M2a, M2b and M2c;
- M4a, M4b and M4c;
- r1-M1, r1-M2 and r1-M3;
- R1, R3, R4 and R7.

**2 SURVIVED**, both expected:
- M0, the no-op control;
- R2, the named equivalent (see Round r1).

### Merge
- `origin/master` `0aeffdc0e9` (engine 24, W34-I4 landed) was merged as `349e138e9c`. The merge was clean.
- Rails on the merged tree: `w34I6V6BoolResidue` + `w4V6Bool` = **62 passed (62)**.
- final-tip was not run, by the coordinator's instruction.

## Round r2 (landing hold on PR #907: item 4 changed the live object door)

Code `daf9883b57`. Merged `origin/master` `e79ff79c83` (engine 25, W34-I6c) as `837f4659fc`; the merge was clean.

### Decision: NOT stated exactly, so item 4 is gated off the door
The Pine v6 reference states only part of what the door would need.

- What it states: `switch` keyword, Remarks: "If the result of the `switch` statement is assigned to a variable and
  a `default_local_block` is not specified, the statement returns `na` if no `local_block` is executed." So the
  switch's `na` is stated.
- What it does not state: what a drawing does with that `na` when the door reads it as a `size`, `xloc` or
  `style` argument. It may draw at a default, error, or skip the drawing.
- It also says nothing for an `if` with no `else`. Its `if` entry has no Returns or Remarks, and item 4 covers
  that shape too.
- The v6 bool exception (never `na`) is not written in that remark either. So the generic remark alone is not the
  full v6 rule for a value read downstream.

**Fix:** `namedConstantNonBool` returns false at the object door (`atObjectDoor`). That is the one gate, and it
covers every caller (`provablyNonBoolNode`, and through it `nameIsNumeric` and `declaredTypeOfName`). The door
gives master's answer again (`runtime:object-door`, Q-A3). Off the door, item 4 is unchanged.

### Rails (43, all green)
- **(r2) door rail:** a v6 `size.*` switch with no default at the door is refused, `runtime:object-door` with
  Q-A3.
- **(r2) its pair:** the same source off the door (also with `objectTrees: []`) is served, and unmatched is `na`.
- **Union after the merge:**

| rail set | files | result |
|---|---|---|
| I6b | `w34I6V6BoolResidue` | 43 passed |
| I6a + T14 | `w34I6SwitchArmWrap` + `w4V6Bool` | 30 passed |
| I6c | `w4SeriesLength` + `finiteWindow` | 116 passed |
| neighbours | `pureWindowInFunction` + `objectDoorGate` | 167 passed |

### r2 hand mutations (FE restored byte-exact, sha256 OK)
| mutation | result | killed by |
|---|---|---|
| r2-M0 no-op | 43 passed | (control) |
| r2-M1 door gate removed (item 4 typed at the door again) | 1 failed | (r2) door rail |
| r2-M2 gate applied everywhere | 9 failed | 7 family rails + matched-arm rail + the off-door pair |

### Measure-pair note
The earlier measure-pair (`fea38c2785`) movers were all runtime-pane probes (`rtProbe`), not the door. The kioseff
L69 probe progress comes from the runtime pane, so r2 does not change it. That is an expectation only: measure-pair
was not re-run (light work only).
