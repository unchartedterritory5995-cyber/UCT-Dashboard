NEXT STEP: none on this lane: READY (final-tip FULL shards=1 + READY-CHECK PASS on f58ac6ae59, last code 871d7eeb28); landing by the coordinator. Measure-pair DONE (0 C18 diffs, 0 unintended); origin/master 9a75786663 (engine 21) merged. Mutation batch DONE. Engine bump: YES (a refusal becomes a served value on the runtime pane; `SCRIPT_ENGINE_VERSION` NOT edited here).

# W34-I6a: a `switch` arm that wraps onto a continuation line

Branch `feat/pine-w34-i6a-switch-wrap`, from origin/master `bde38b0d69` (engine 20). Spec: the I6a
section of `docs/pine/W34-I6-SPEC.md` (`origin/docs/pine-w34-i6-spec` @ `9be8910111`).

## The rule (quoted in the rail header)

Pine Script User Manual, "Script structure" -> "Line wrapping"
(https://www.tradingview.com/pine-script-docs/language/script-structure/#line-wrapping):
"each wrapped line after the first can use any indentation length _except_ multiples of four",
"because Pine uses four-space or tab indentations to define local code blocks". Between brackets,
"all code between those characters _does not_ have any restriction on indentation length".
"A local block must be indented by a tab or four spaces."

## What changed

- `app/src/components/chart/engine/ast/pineRuntimeFrontend.js` (runtime side only; `pine.js` untouched,
  so the host lane's output is unchanged by construction):
  - `wrappedArmOf` / `joinWrappedSwitchArms`: one pass over the statement tree right after
    `blockStatements`. For each arm of a `switch` block that has an inline value (`m => v`) and lines
    beneath it: every beneath-line that starts outside brackets at an indent that is not a multiple
    of four is a wrapped line. All wrapped: the arm's header and raw `body` tokens are joined into one
    header, `sub` empty. None wrapped: unchanged (a real sub-block, today's reading). Both kinds:
    marked `wrapMixed`. Tabs count as a full indent level (the lexer's existing rule), so a tab line
    is a block line.
  - `lowerSwitchInto`: a `wrapMixed` arm is refused BY NAME (`runtime:block-value`, "wraps onto a
    continuation line and also has a line at a block indent … Pine's line-wrapping rule does not say
    which statement that line belongs to").
  - Not at the object door: the pass runs only when `!atObjectDoor`, so the C18 door keeps master's
    reading (its arm check still refuses "a value arm that ends in a block").
  - Two comments that said a continued arm "never reaches here" now say where it is joined.
- Every reader of a `switch` (lowering, typer `switchTyIn`, `armValueToks`, `bodyResultToks`,
  `simpleSwitchShape`, the door's arm check) reads the same normalised tree: one authority.

Still refused by name / unchanged: `c =>` with its value on the next line (a block, today's reading,
served); an inline arm with a real 4-space sub-block ("ends in a block"); mixed wrap + block lines
(the new sentence). Out of scope: a wrapped `=>` function body (not a `switch` arm).

## Rails

- NEW `app/src/components/chart/engine/runtime/__tests__/w34I6SwitchArmWrap.test.js` (8 tests,
  synthetic shapes, 5,000 LCG bars): fixture control (every arm decides bars both ways);
  differential top level (float, wraps at indents 5 and 6, brackets open across indent 8 from the arm
  line and from a wrapped line); differential in a function nested in `if … else if` (the census
  shape, two of four arms wrapped one space past the arm); the same as a top-level binding;
  CONTROL real 4-space sub-block keeps "ends in a block"; CONTROL `c =>` + block value equals the
  one-line arm; mixed refused by name; object door keeps master's refusal (+ a one-line control).
- `objectDoorGate.test.js`: `sw_wrap`, `sw_wrap_nested` (door draws nothing new; pane builds; door
  build refuses BY NAME `runtime:object-door`).
- `p3WsaReviewFixes.test.js` re-review 4 (INTENDED, CLASSIFIED change): the C47 continued arms sit at
  indent 14 (not a multiple of four), so they are wrapped lines. The pane half of "standalone
  `plot(f("a"))` … is refused" now asserts the pane reads the whole wrapped value (`close > open`,
  equal to one-line arms, v5 and v6, both picks); the object-door half is kept as it was.

Targeted vitest (Node 20.20.2, `--maxWorkers=1`, after ram_gate): w34I6SwitchArmWrap 8/8,
objectDoorGate 103/103, p3WsaReviewFixes 83/83, plus p3StatementsBlockValues, blockValuedBinding,
blockValuedReassign, elseIfChain, functionBodyBlockValue, fvgVendorParity green. Log:
`_resume-2026-11-01/runs/w34-i6a/targeted-vitest.log` (the p3WsaReviewFixes red in it is the
pre-update run, fixed as above).

## Single hand mutations (light; the mutate.py batch waits for a go)

Over w34I6SwitchArmWrap + objectDoorGate:

| mutation | result |
|---|---|
| M1 do not join (`if (false && !atObjectDoor)`) | KILLED, 6 red (both differentials, top-level binding, mixed, `sw_wrap` and `sw_wrap_nested` pane builds) |
| M2 join on any deeper indent (multiples of four too) | KILLED, 2 red (sub-block CONTROL, mixed) |
| M3 mixed arms join instead of refusing | KILLED, 1 red (mixed) |
| M4 ignore the bracket rule | KILLED, 1 red (top-level differential; survived before the bracket-from-a-wrapped-line case was added) |
| M5 join at the object door too | KILLED, 3 red (`sw_wrap` door draws / door refuses by name, door rail) |
| M0 no-op control (trailing whitespace) | SURVIVED, 111/111 |

## Census step (local, licence-held source read locally, not committed)

`fvg-detector-tradingfinder-fair-value-gap-imbalance-mitigated__578addf606` (sha256/16 `c3b3e97846fe9bbc`),
`probeRuntimeProgram(source, {objectsInRun: true})` and `buildRuntimeIr(source, {objectsInRun: true})`:
- join disabled (= master): `{ok:false, guard: runtime:block-value, "a branch of `DConditionFVG = if …` ends in a block this lane reads no value from"}`;
- this branch: `{ok: true}` for both. The runtime-on wall set goes from `{runtime:block-value}` to empty.
  The script then joins track A (its own capture grades the drawings before arming).

## Review N1 (fixed)

The review (GO-WITH-NOTES) found `0 => switch k` with a wrapped INNER arm refused as `wrapMixed`
(misleading): the outer arm's raw body holds the inner arms (indent 8) and the inner wrap (indent 9).
`wrappedArmOf` now leaves an arm alone when its inline value opens a block (`if`/`switch`/`for`/`while`,
`ARM_VALUE_OPENERS`); the inner switch's arms are joined on their own level, so the nested switch now
serves and equals its one-line form. Rail: `review N1` in `w34I6SwitchArmWrap.test.js` (9 tests).

## Mutation batch (`mutate.py`, coordinator GO; heavy-mut.lock, ram_gate, --maxWorkers=1)

Tests: w34I6SwitchArmWrap + objectDoorGate + p3WsaReviewFixes. One mutant per call, free RAM checked
before each (10.7-11.9 GB, never under 4 GB). Log: `_resume-2026-11-01/runs/w34-i6a/mut-batch.log`.

| mutant | result |
|---|---|
| M0 no-op (trailing whitespace) | SURVIVED |
| M1 no join | KILLED |
| M2 join on any deeper indent | KILLED |
| M3 mixed arms join | KILLED |
| M4 ignore the bracket rule | KILLED |
| M5 join at the object door | KILLED |
| M6 N1 opener skip off | KILLED |

## measure-pair (coordinator GO; `runs/w34-i6a/mp.sh`, lock `dsk/heavy-mp3.lock`, ram_gate; base `pine-dsk-mpbase3` switched in-job)

Pair: `== side tip 1246d11976` / `== side base bde38b0d69` (tested-on-master `bde38b0d69`), runtime 0 and 1, census on.
Free RAM never under 11 GB. Logs `runs/w34-i6a/mp-all.log`, `mp0.log`, `mp1.log`; compare `runs/w34-i6a/mpcompare{0,1}.txt`
(`runs/w6t3b/mpcompare.py`).
- **C18 corpus audit 395 rows: 0 differ (rt0 and rt1). Constructed probes 69: 0 differ.**
- **Harness** rt0 identical (93/103/140). rt1 tip 112/107/117 vs base 111/107/118: `delta-rsi-oscillator-strategy-rddt-1d`
  INCONCLUSIVE -> MATCH, the known wall-clock flake (W34-D1, W6-T6 record it; the script has no `switch`). NOISE.
  `adx-and-di-for-v4` (RDDT and SPY) MATCH on both sides, unchanged.
- **Census rt1 (967 rows): 2 differ.** INTENDED: `fvg-detector-tradingfinder…` **ATTACHES** runtime-on (attached
  false -> true, peelSteps 4 -> 0). NOISE: `multi-timeframe-trend-indicator` (`pine:timeout` refusal count, recorded by
  W4-T14 / W6-T3a/b / W6-T6).
- **Census rt0: 6 differ.** INTENDED: `fvg-detector-tradingfinder…` only the `.runtime.attached` annotation (production lane
  unchanged). NOISE (timeout / stuck rows recorded by W34-D2 / W6-T3b / W6-T6): adaptive-trend-following-suite (timeout
  text), ai-supertrend-x-pivot (`stuck`), volatility-coil-edge-bullbyte, halftrend-bigbeluga, mirage-liquidity-sweep.
0 unintended.

## Merge

origin/master `9a75786663` (engine 21) merged with a normal merge after the measure; clean.

## final-tip run 1: NOT COMPLETE (stopped by the host's low-memory reaper, not a test failure)

`runs/w34-i6a/ft.sh`, lock `dsk/heavy-final2.lock`, ram_gate, FULL, 2 shards SEQUENTIAL, Node 20.20.2; logs
`runs/w34-i6a-final/`, `runs/w34-i6a/ft.out`. `TIP 871d7eeb28`. gate pytest rc=0 (46 passed); hygiene rc=0; rails
pytest rc=0 (196 passed). Shard 1/2: 691 files passed, 3 failed, ALL BASELINE (`settingsScope.rail`,
`pollingSites.rail`, `usePreferences.additionsOnly`). Shard 2/2 was running when the session's memory reaper stopped
the job (no totals, no FINAL_DONE), so ready-check was not run. No process of this lane was left running (checked).

## final-tip run 2: COMPLETE, READY-CHECK PASS

`runs/w34-i6a/ft2.sh`, lock `dsk/heavy-final2.lock`, ram_gate, FULL, 1 js shard, Node 20.20.2; logs
`runs/w34-i6a-final2/`, `runs/w34-i6a/ft2.out`. `TIP f58ac6ae59` (last non-docs commit 871d7eeb28), integrity=ok,
totals=ok, errors=0. gate rc=0, hygiene rc=0, rails pytest rc=0 (196 passed). js rc=1, failing files ALL BASELINE:
controlDoorCensus, enumerationSites, vendorHarness, settingsScope.rail, pollingSites.rail, usePreferences.additionsOnly.
READY-CHECK PASS (READY_RC=0). Engine bump: YES (the coordinator's, at landing).
