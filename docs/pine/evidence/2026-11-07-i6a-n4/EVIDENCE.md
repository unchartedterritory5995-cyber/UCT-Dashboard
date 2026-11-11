# I6a-N4: an opener with no line at a block indent: evidence (2026-11-07)

Branch `fix/pine-i6a-n4-switch-indent`, cut from origin/master `2827af2633` (engine 32), with master `83d65f95cb` merged in before the push.
Source: review note N4 in `W34-I6a.md` (the desktop reviews folder): master serves a nested `switch` whose inner arms sit at indent 9 or 6.
Light phase only: no mutate.py, measure-pair or final-tip. `SCRIPT_ENGINE_VERSION` is untouched (the engine bump is at merge).

## The manual (quoted)

From "Script structure" (https://www.tradingview.com/pine-script-docs/language/script-structure/):
- "A local block must be indented by a tab or four spaces."
- "A local block requires indenting each line that belongs to its scope by four spaces or a tab"
- Line wrapping: "Generally, each wrapped line after the first can use any indentation length _except_ multiples of four, because Pine uses four-space or tab indentations to define local code blocks."
- Brackets: "all code between those characters _does not_ have any restriction on indentation length"

From "Conditional structures" (https://www.tradingview.com/pine-script-docs/language/conditional-structures/):
- "The local blocks in conditional structures must be indented by four spaces or a tab."
- For the `switch` syntax and for `if`: "It must be indented by four spaces or a tab."

Neither page has a sentence of its own about switch arms or nested blocks. The local-block rule is the only one stated.

What the manual settles exactly: a line at an indent that is not a multiple of four is a wrap, not a block line. So an opener (`if`, `else`, `for`, `while`, `switch`, including `0 => switch k`) whose every line beneath is at such an indent has no local block.

What it does not settle: what TradingView then does with that source. The syntax implies a compile error, but no sentence says so. That question is capture rows I6A-N4-0/1a/1b/1c/2 (`docs/pine/capture-queue-2026-11-07-i6a-n4.md`). Their probes are under `tools/visual_conformance/probes/i6a-n4-*.pine`, each pasted alone, with a control at indent 8.

## Reproduced on master 2827af2633 (both lanes)

| shape | runtime lane (buildRuntimeIr) | host lane (translatePine strict) |
|---|---|---|
| nested switch, inner arms at 8 (control) | serves | `pine:block` (its switch subject is not fixed) |
| nested switch, inner arms at 9 / 6 / 10 | **serves** | `pine:block` |
| top-level switch, arms at 6 / 5 | **serves** | `pine:block` |
| `if` body at 6; `if` in `if`, inner body at 6 | **serves** | **serves** |
| `for` body at 6 | **serves** | `pine:reassign` |
| `f(x) =>` value wrapped at 6; `v = close +` / `      open` | serves | serves |

## The change

- `pine.js::refuseOffBlockIndent(stmts, indents)` is one check, called right after `blockStatements` by both lanes: the host translator (inside its existing refusal try) and `pineRuntimeFrontend.js` (pane and object door).
- It refuses with the new guard `pine:indent`: "a Pine local block is indented by four spaces or a tab, and this line sits at another indent — `<word>` has no local block: every line beneath it starts at an indent that is not a multiple of four (the first at N), and Pine reads such a line as a wrap of the line above, not as a block (User Manual, "Script structure" -> "Line wrapping")".
- It fires only when both of these hold:
  - the header's last top-level opener is an opener WORD;
  - every body line start outside brackets is at a non-multiple-of-four indent.
- The guard is registered in three places:
  - `editorStatus.js`: the `language` family;
  - `EDITOR-STATUS-PANEL-SPEC.md` section 4;
  - `pine.guardCensus.test.js`: the unexercised roster, with a note on why it is declared without a witness.

### Why narrow

A first, broader cut refused any block line at a non-multiple-of-four indent. A census of 877 scripts (`corpus/`, `tests/fixtures/`, and the licence-held sample, read locally and never committed) found 15 hits, all published scripts that TradingView compiles:
- wrapped `if` conditions above a real block (`if a` / `      and b` / `        …`);
- function values wrapped at indent 5 or 6 (the `Mode(…) =>` ternary-chain shape, `07-hull-suite` among them);
- arm values wrapped inside brackets.

By the manual, every one of those is a wrap, and each still has a real block or is an inline value. The narrow rule hits **0 of 877**.

## Now refuses, and what still serves

- **Refuses `pine:indent`, both lanes, same sentence:**
  - a nested switch with its inner arms at 9, 6, 10 or 5;
  - a top-level switch with its arms at 6 or 2;
  - `0 => if c` with its body at 9;
  - an `if`, nested `if`, `else` or `for` body at 6;
  - a `while` body at 2;
  - an `if` body at 6 whose only indent-4 line is inside brackets.
- **Still serves, unchanged:**
  - a nested switch at block indents (equal to its ternary over 3,000 bars);
  - W34-I6a's inner-arm wrap (equal to its one-line form);
  - inner arms at 12 (equal to 8; a multiple of four, out of scope, capture row I6A-N4-2);
  - a function value wrapped at 6 (equal to the inline form, both lanes);
  - a top-level wrapped expression;
  - an `if` body at 4.
- **Unchanged and not this lane:** a wrapped condition above a real block is still refused as master refused it (`runtime:statement` / `pine:reassign`), not by `pine:indent`.

## Door impact

- **The object door also refuses these shapes `pine:indent`.** An over-serve is wrong at every door.
- **Corpus impact: none.** The census found 0 hits in 877 scripts, so no corpus script changes its answer at the pane, the door or the host lane. The rail pins this over the 400+ committed scripts.
- **Synthetic shapes:**
  - the host lane stops serving the `if` body at 6 and the nested `if` at 6;
  - the runtime pane stops serving every shape in the refused list;
  - at the door, nested-switch shapes that master refused `runtime:object-door` now refuse `pine:indent` first. Both refuse.

## Rails

`app/src/components/chart/engine/runtime/__tests__/i6aN4BlockIndent.test.js`, 25 tests:
- 13 refused shapes, each checked on both lanes: guard, sentence and indent, plus host == runtime message;
- the object door;
- the refusal's line;
- 7 still-serves differentials and controls;
- the committed-corpus over-refusal guard;
- probe-file agreement (refused files refuse on both lanes; control 8 equals 12).

## Results

- Node 20.20.2, `--maxWorkers=1`:
  - targeted: i6aN4BlockIndent 25/25, w34I6SwitchArmWrap 9/9;
  - guardCensus, pine.test, tabIndent, pine.continuation, pine.community(+guards), p3WsaReviewFixes and objectDoorGate: green after the registrations;
  - editorStatus*: 90/90.
- ⛔ **CORRECTION (final-tip, 2026-11-07): the folder run below was NOT a folder pass.** The shared node_modules broke while it ran, so 310 test files never started (`Failed to start forks worker`). Vitest did not report them in its failed count. One of them, `symbolRosterSpeaks.test.js`, pins `Object.keys(REFUSALS).length`, and final-tip found it red (44 -> 45, the new `pine:indent`). It is re-pinned to 45, with the reason. The full folders are final-tip's to answer.
- Full `engine/ast` + `engine/runtime` (heavy lock `heavy-final6.lock`, label i6an4, free RAM 11.2 GB before): 5772 pass, 1 fail, 6 skipped, 203 files.
  - The one failing test was the census roster's alphabetical order (`pine:indent` placed before `pine:hidden-only`). It is fixed and re-run green (see the re-run line below).
  - One file failed to load: `serverBundle.rail.test.js`, "Cannot find package '@adobe/css-tools'". That is the shared `pine-base` node_modules (junctioned), which another session was reinstalling during the run (modified 17:44). It is not this change.
- Re-run after the roster fix and the master merge (`83d65f95cb`; master's delta since the base is docs, probes and one Python tool), once the shared node_modules was whole again: guardCensus, serverBundle.rail, i6aN4BlockIndent, w34I6SwitchArmWrap and editorStatus* gave 7 files and 135/135 pass. Nothing was installed from this worktree.
- Service suite, Node 24.13.1: `node --test --test-reporter=tap "services/pine_runtime/test/**/*.mjs"` 139/139.
- `node tools/pine_runtime_host_parity.mjs --host node --check`: `HP-1 GREEN: 166/166 cases equal the committed digests`.
- `pytest tests/test_saved_probe_integrity.py tests/test_pine_w34_d1_queue_targets.py`: 12 passed.

## Hand mutations

Method: copy to the scratchpad, mutate, run the rail, restore by copy, then `cmp` (identical every time).

| id | mutation | result |
|---|---|---|
| M1 | runtime front end does not call the check | KILLED, 15 red |
| M2 | host translator does not call the check | KILLED, 13 red |
| M3 | block line = indent % 2 | KILLED, 10 red |
| M4 | refuse on any wrap, even with a block line | KILLED, 2 red (wrapped condition; corpus guard) |
| M5 | check `switch` only | KILLED, 7 red |
| M6 | count bracketed lines as block lines | first SURVIVED, then a rail was added (`if` body at 6 whose only indent-4 line is inside brackets), and it is KILLED, 1 red |

## Review note N1 (reviews/I6A-N4.md, GO-WITH-NOTES @397e6ed193): a tab plus two spaces

A body of one tab then two spaces measures 6 (the L2 lexer rule: a tab advances to the next multiple of four) and is refused `pine:indent`. The manual does not say how a tab followed by spaces is counted. So this is queued, not asserted:
- capture row I6A-N4-1d and its probe `tools/visual_conformance/probes/i6a-n4-if-tab2.pine` (a real tab, then two spaces);
- the rail's probe-file test now also checks that this file refuses on both lanes;
- `docs/pine/vendor-harness/capture-queue.json` was regenerated after merging origin/master (`88c8009212`). `evidence_engine.py queue --check` PASS.

Results:
- queue tests: test_evidence_engine, test_queue_dispositions, test_pine_w34_d1_queue_targets and test_saved_probe_integrity gave 63 passed;
- rails: i6aN4BlockIndent, w34I6SwitchArmWrap, guardCensus, tabIndent and editorStatus* gave 7 files and 130/130.

## Final-tip red: the REFUSALS count pin

- `symbolRosterSpeaks.test.js` now pins 45, and its comment names `pine:indent` (I6a-N4, the manual's block-indent rule).
- I searched every other registry for a REFUSALS count or a full list of codes:
  - `pine.guardCensus.test.js` (the unexercised roster) was already updated;
  - so were `editorStatus.js` and the spec's section 4;
  - the other counts (`sentence.test.js`, `budget.test.js`) count `parse.js` / `interpret.js` / `sentence.js` / `budget.js` tables, which this lane did not touch;
  - `refusalLaundering` and `pine.test` read the keys rather than restating them.
- Run (Node 20, `--maxWorkers=1`): every `engine/ast` test file naming REFUSALS (29, measure files excluded), plus i6aN4BlockIndent, w34I6SwitchArmWrap and editorStatus*: 34 files, 1161/1161 pass.
