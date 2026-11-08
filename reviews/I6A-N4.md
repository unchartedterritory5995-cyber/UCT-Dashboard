VERDICT: GO-WITH-NOTES @397e6ed193

# I6a-N4 independent review (2026-11-07)

Branch `origin/fix/pine-i6a-n4-switch-indent` @ `397e6ed193`, merge-base = origin/master `83d65f95cb`.
Reviewed in a detached worktree `uct-worktrees/rev-i6an4` (node_modules junctioned, nothing installed, removed after).

## Code read
- `pine.js::refuseOffBlockIndent` + `openerWordOwnsBody`: it only throws; the throw is `pine:indent`, and it fires only when
  (a) the header's last depth-0 opener is a WORD (`if/else/for/while/switch`, reset by a later `=>`), and
  (b) every depth-0 new-line start in the body sits at an indent % 4 != 0.
  Comments and blank lines produce no tokens, so they can't affect it. Brackets are depth-tracked. Tabs come from the existing L2 lexer rule (tab = next multiple of 4).
- Both lanes call the same function right after `blockStatements`: the host `translatePine` call is inside the existing refusal try, and the runtime front end runs it before the pane/door split. The door is therefore covered by construction, and the rail `at the C18 object door too` backs it.
- Registrations: editorStatus `language` family, spec section 4, and the guardCensus unexercised roster. All consistent.

## Over-refusal probes (mine, synthetic, both lanes + object door)
None of 29 legal shapes refuses `pine:indent` on any door:
- tab body;
- tab-tab nested;
- tab line + 4-space line;
- 2 spaces + tab (= 4);
- tab block with a tab+2 wrap;
- comments at 6 and 3 inside a block;
- a comment-only line at 2 before the body;
- blank lines with trailing spaces;
- first line at 4 then wraps at 6;
- switch arms with wrapped results (+ at 6, at 5);
- a ternary chain wrapped inside `if` and inside `for`;
- bracket continuations at 2 and 8 inside a block;
- a wrapped condition (dangling `and`) above a block;
- a paren condition wrapped at 2;
- a function body `switch`;
- a function value wrapped at 5;
- a function body with tab `if`;
- an `else if` chain;
- a subjectless switch;
- a body at 8;
- `while` with tab;
- a comma-split `d := switch`;
- `for … in` with tab;
- `v = if … else`;
- CRLF line endings;
- an arm wrapped in parens at 2.
Some of these refuse on the host or door with OTHER guards (`pine:block`, `pine:reassign`, `runtime:object-door`, `pine:collection`). Those are untouched by this change, which only adds a `pine:indent` throw.

These are refused `pine:indent` on all three doors, with the same message on host and runtime:
- tab+2 spaces (indent 6);
- `if` body at 6;
- a comment at 4 above a body at 6. This one is correct: a comment is not a block line.

## Corpus (re-run myself, 877 = 464 committed corpus/fixtures + 413 `_resume/pine-sample`)
- Static `refuseOffBlockIndent` over all 877: **0 hits**.
- Through the real lanes (buildRuntimeIr pane, buildRuntimeIr objectDoor, translatePine strict) over all 877: **0 `pine:indent`**, 0 exceptions.
- Near-miss density: a deliberately broad rule ("any depth-0 body line at an indent that is not a multiple of four, under any opener incl. `=>`") hits **96 files**. The builder's 15 are a subset of this shape class: `07-hull-suite`, the wrapped-condition `if`s, the arm wraps.
- All 96 pass the narrow rule. So the narrowing is what keeps the published wild styles serving, and it does so with wide margin, not by luck of a small sample.

## Rails / suites (Node 20.20.2, --maxWorkers=1)
- i6aN4BlockIndent, w34I6SwitchArmWrap, pine.guardCensus, tabIndent, and all of `builder/`: 184 files pass, 4 skipped, 0 fail.
- Node 24.13.1 `tools/pine_runtime_host_parity.mjs --host node --check`: HP-1 GREEN 166/166.

## Reviewer mutations (copy, mutate, run, restore by copy, cmp identical each time)
| id | mutation | result |
|---|---|---|
| R1 | body scan ignores bracket depth | KILLED (2 red) |
| R2 | no recursion into `sub` | KILLED (10 red) |
| R3 | drop the `=>` reset in `openerWordOwnsBody` | **SURVIVED**; see N2 |
| R4 | lexer: tab = 1 column | KILLED (tabIndent x2 + i6aN4 corpus guard); 7 of my legal tab probes would then refuse `pine:indent` |
| R6 | block line = indent % 8 | KILLED (15 red) |
| R7 | `else` not an opener word | KILLED (2 red) |

## Merge
`git merge-tree --write-tree origin/master 397e6ed193` is clean (master == merge-base `83d65f95cb`).

## Notes (non-blocking)
- **N1. Tab + 2 spaces (measured 6) is refused `pine:indent`.** This is consistent with the L2 tab=4 model and the manual's wrap rule, but no capture row covers a tab-led wrap-only body. Suggest adding a probe (`if c` / `\t  v := close`) to I6A-N4-1 so a TradingView answer pins the tab case too.
- **N2. R3 survives.** I could not construct legal Pine whose header has an opener word BEFORE a depth-0 `=>` (`=>` always precedes `switch`/`if` in `0 => switch k`), so this looks like an equivalent mutation. It is unrailed defensive code. Optional: a one-line rail, or a comment saying it is defensive.
- **N3. Unchanged pre-existing gaps** (not this lane):
  - the host lane refuses the `for`/`while` tab-body probes `pine:reassign`;
  - the door refuses `for … in` `runtime:object-door`.

## Engine bump / measure-pair
- **Engine bump: YES, at merge.** Synthetic shapes that master served (`if`/`for`/nested switch with wrap-only bodies) now refuse, so served answers change.
- **Measure-pair: NOT needed.** 0 of 877 scripts change their answer on any door, verified through the lanes and not only the static check.
