# AUDIT packet: r8-integration GO

Branch `agent/pl/r8-integration`. Development (local, scripted model): LOCAL native Windows Node v24, BROWSER-MOCK-MODEL / SIMULATED.
pytest was not run locally; Agent CI runs it. Every command below can be re-run from the branch.

## (1) Each piece: the head last seen, where it is integrated, and proof nothing changed silently

### 1a. Heads and integration points

| Piece | Head AUDIT / the Lead last saw | Integrated by | Merge parents (integration side, piece) |
|---|---|---|---|
| ship-3 (#985) | 0740e1eac2 | ship-4 head d84dfbddfe IS the merge of ship-3 into ship-4 | ac98ce1f50, 0740e1eac2 |
| ship-4 | d84dfbddfe | inside ship-5 6339030e1e (its merge of ship-4) | 6ff0dc666d, d84dfbddfe |
| ship-5 | 6339030e1e | **the base of r8-integration** (the first merge's first parent) | none |
| f1 r8-multistep | a5aee1cf49 | 2bd6cdf7bc | 6339030e1e, a5aee1cf49 |
| f2 r8-scanner-filter | 6e9b4e7dad | 063722a3bb | 2bd6cdf7bc, 6e9b4e7dad |
| f3 r8-indicator-style | 5e9b22f1cf | 5e5b47b3d0 | 063722a3bb, 5e9b22f1cf |
| f4 r8-errors | 4535c7b8e0 | 7b88131195 | 5e5b47b3d0, 4535c7b8e0 |
| f5 r8-drawings | cdda9c6261 | cd19f3ac1a | 7b88131195, cdda9c6261 |
| f6 r8-presets | 44c9e38de8 | ecc5f07d99 | cd19f3ac1a, 44c9e38de8 |
| post-merge | (none) | ecc5f07d99..9f4a845d5c | linear commits, listed in 1d |

Each merge's second parent is EXACTLY the head in the second column, so `git diff <head> <merge's second parent>` is empty for
every piece. The checks that matter are 1b (what each merge wrote into the piece's own files) and 1c (what later pieces
changed in an earlier piece's files).

### 1b. Each merge kept the piece's own files byte-for-byte

For each merge M with parents (P1, H) and merge base B, every file the piece changed (`git diff --name-only B H`) was checked.
Either it is identical at M and H, or it is a true 3-way merge (P1 also changed it since B). For a 3-way file, the patch the
merge applied (`git diff P1 M -- f`) has the same `git patch-id --stable` as the piece's own patch (`git diff B H -- f`):

| Merge | Piece files | Identical to the piece head | 3-way (both sides changed): patch-id piece = applied | Unexplained |
|---|---|---|---|---|
| 2bd6cdf7bc (f1) | 13 | 13 | none | none |
| 063722a3bb (f2) | 9 | 9 | none | none |
| 5e5b47b3d0 (f3) | 3 | 3 | none | none |
| 7b88131195 (f4) | 6 | 4 | `deixis.js` 78af6a787d0c = 78af6a787d0c; `useAgent.js` be2fbae80c0e = be2fbae80c0e | none |
| cd19f3ac1a (f5) | 19 | 18 | `contract/manifest.golden.json` eaa6eb880e40 = eaa6eb880e40 | none |
| ecc5f07d99 (f6) | 6 | 6 | none | none |

**CONFLICT RESOLUTION, the only one:** 063722a3bb (f2), `qa/chartsOutcome/widgetDoorRows.outcome.test.jsx`. Git marked f2's
appended round-8 block as conflicting against an EMPTY integration side (the integration side had not changed the file since
B; one line with a different line ending caused the marking). It was resolved as f2's file, and the table shows it is
identical to f2's head.

### 1c. Later changes to an earlier piece's files (each made by a later, documented piece)

`git diff --numstat` between consecutive integration points, per file shared by more than one piece (ship-3 → ship-4 → ship-5 →
+f1 … +f6):

| File | Changed by (lines +/-) |
|---|---|
| agent/useAgent.js | ship-4 (+4/-11), ship-5 (+13/-1), f1 (+52/-4), f4 (+14/-1) |
| agent/deixis.js | ship-5 (+7/-0), f1 (+11/-3), f4 (+28/-7) |
| agent/capabilities/board.js | ship-4 (+4/-3), f2 (+4/-2), f6 (+1/-0: the item-list name-length check) |
| agent/widgetNames.js | ship-4 (+15/-1), f2 (+17/-1), f6 (+2/-0: the News presets item list) |
| pages/charts/widgets/TradeExchangeNewsWidget.jsx | f2 (+1/-1), f6 (+9/-2: door read/write of presets) |
| qa/chartsOutcome/teNewsWatchlist.outcome.test.jsx | f2 (+40/-4), f6 (+45/-1) |
| qa/chartsOutcome/widgetDoorRows.outcome.test.jsx | f2 (+58/-0) |
| agentExecReach.test.jsx | ship-4 (+2/-1), f2 (+11/-1) |
| agentWidgetControls.test.jsx / agentWidgetOptions.test.jsx | ship-4 (+7/-7) / ship-4 (+1/-12) |
| contract/manifest.golden.json | f5 (+48/-0: the drawingBoard.set entry) |

Each change belongs to the piece named, and each piece's PR doc (`PR-ship-4.md`, `PR-ship-5.md`, `PR-r8-*.md`) describes it.
No other commit touches these files.

### 1d. Post-merge commits (ecc5f07d99 to 9f4a845d5c)

- Docs only: R8-INTEGRATION.md, PR-r8-integration.md.
- **RE-PIN / FIX 251658000d** (the Agent CI 42597513367 pytest failures, all from drawingBoard.set):
  - `tests/test_uct_agent_contract.py`: `_GROUP_OF` gains `"drawingBoard": "drawings"`.
  - `baseline/baseline.lock.json`: +25 lines, the one new intent `drawingBoard.switch`. It was computed with the rail's own
    `fingerprint()`; the lock and the data differed only by that entry.
  - `api/services/uct_agent/turn_v2.py`: `_DOMAIN_OF` gains `"drawingBoard": "drawing"`. Before this, planner v2 sent the
    prefix to "history".

### 1e. Re-pins (all marked)

- In the pieces: f5 re-pinned the manifest golden (+803 compact bytes), the NL-1 parity fixture (+4/-1), the capreg
  contract / coverage / corpus (+1 intent), the route-group count (157 to 158) and the manifest count (151 to 152).
  f4 re-pinned the agentPhase2B pickedChoice test; f1 re-pinned 3 receipt rails.
- At integration (ecc5f07d99): the golden, SAT-1, NL-1 parity and capreg re-pins were run once. All produced
  content-identical files, so nothing was committed (R8-INTEGRATION.md).
- After CI: 251658000d (1d).

## (2) ship-4 S4-A: the F-16 exemption is still narrowed to Options Flow (af946f2659)

- af946f2659 is an ancestor of this branch. `git diff af946f2659 HEAD -- api/services/uct_agent/turn.py tests/test_uct_agent_flow_widget_gate.py`
  is **empty**: neither the code nor its pytest changed after round 2.
- The code, in `api/services/uct_agent/turn.py`:
  - **L1232-1239** `_flow_widget_ids(context)`: only `type == "optionsflow"` widgets from the request's board context.
  - **L2636-2638**: `flow_ids = _flow_widget_ids(context)`, then
    `widget_only = bool(ops_now) and all(action == "widget.setOption" and args.widget in flow_ids for o in ops_now)`.
  - **L2639**: `if hidden_why and (plans_screen or (hidden_screen_request(msg) and not widget_only))`. A screener op, or any
    setOption on a widget that is not Options Flow, is still gated.
- The pytest, `tests/test_uct_agent_flow_widget_gate.py`:
  - L36 `test_a_widget_setOption_plan_on_the_options_flow_is_kept`;
  - L46 `test_a_hidden_field_screen_is_still_refused`;
  - L56 `test_a_mixed_plan_with_any_screener_op_is_still_refused`;
  - L65 `test_a_widget_setOption_on_a_widget_that_is_not_the_options_flow_is_still_gated`;
  - L74 `test_flow_widget_ids_reads_only_options_flow_widgets_from_the_board_context`;
  - L29 `test_the_words_are_gated_text_so_the_case_is_real` (non-vacuity).

## (3) Multi-step caps: code and rails

| Cap | Code | Rail |
|---|---|---|
| 6 steps | `app/src/agent/compound.js` L38 `export const MAX_STEPS = 6`; L133 a longer plan is refused before anything runs ("UCT does at most 6 … Nothing has changed."). Per step, L39 `MAX_STEP_OPS = MANIFEST_CONTRACT.limits.maxOps`, enforced at `useAgent.js` L627 / in `runCompound` | `agentMultiStep.test.jsx` L209 "(5) bounded: a plan of more than the step cap is refused before anything runs" |
| 60 s | `app/src/agent/useAgent.js` L635 `export let COMPOUND_WALL_MS = 60000` (L636 a test setter); L1992 no step after the first STARTS past it | `agentMultiStep.test.jsx` L216 "(5) bounded: past the wall-clock cap no further step starts" (the cap is forced, and the timeframe step never runs) |
| 0 retries | Structural: `useAgent.js` `runCompound` (L1937). The steps are read once, up front (`planCompound`), then L1990 runs one `for` pass. Every failure path calls `stop(i, …)` and `return`s (L1992, L1993, L2037), and nothing re-plans or re-runs a step | `agentMultiStep.test.jsx` L153 "(1)(2) a step that fails partway … nothing after runs"; L168 "a partial run never reports full success" |
| ≤2 paid model calls | Server: `api/services/uct_agent/budget.py` L68 `DEFAULT_MAX_CALLS = 2`; L131-132 `max_calls()` reads `UCT_AGENT_MAX_CALLS_PER_REQUEST`. The client sends a multi-step request it cannot read instantly as ONE request | pytest `tests/test_uct_agent_spend_limits.py` L210 `test_CEILING_two_calls_per_request_research_lookup_not_counted` (the third call is refused, `call_limit`); `tests/test_uct_agent_turn_cap.py` L163 / L283 (a refused call takes no place; racing calls never pass the cap). Instant sequences: `agentMultiStep.test.jsx` L216 `p.turns() === 0` |

The premise check sits beside these: `useAgent.js` L1945 / L1993 (a changed layout epoch or board visit stops the run), and
L2044 (a step whose ops target the layouts kind re-reads the starting point). Rail: L178 "(3) a changed premise".

AUDIT's held-out probes are AUDIT's own; none were written here.

## (4) New tests that FAIL on a wrong drawingBoard mapping

`tests/test_uct_agent_drawing_board_mapping.py` (new, 3 tests, reads repository files only):

1. `test_drawing_board_is_in_the_drawings_group_of_the_real_routing_map`
   - Reads the browser's own `app/src/agent/routing.js`. The server has no group map of its own; the browser sends the groups.
   - Asserts `drawingBoard` is in the `drawings` group (the same group as `drawing`), and that `test_uct_agent_contract._GROUP_OF`
     agrees with routing.js for EVERY domain both name, so the copy cannot drift.
   - Includes a non-vacuity floor: at least 20 domains must be read.
2. `test_planner_v2_sends_drawing_boards_to_the_drawing_domain_not_history`: the real `turn_v2.domain_for("drawingBoard.set")` is
   `"drawing"`, while `breadth.show` still falls back to `"history"`.
3. `test_drawing_board_switch_corpus_entry_pins_its_op_and_args_and_the_lock_digest`
   - Asserts the entry's ops exactly: `drawingBoard.set`, target `$drawingBoards[0]`, args `{op: "switch", board: "Swing", name: null}`.
   - Asserts its `before` step creates "Swing" (`{op: "create", board: null, name: "Swing"}`).
   - Asserts the expected drawings counts (0 after, 1 after Undo).
   - Asserts the lock entry equals the rail's own `fingerprint()` of the entry, so a changed op / args without a re-lock fails.

The logic of all three was dry-run with plain Python, reading the same files, with the two server imports stubbed by their
parsed maps. That was not pytest; CI runs the real thing.

## pytest owed (CI)

- test_uct_agent_drawing_board_mapping.py (new)
- test_uct_agent_contract.py
- test_uct_agent_capreg_baseline.py
- test_uct_agent_flow_widget_gate.py
- the test_uct_agent_breadth_current.py changes
- the v2 cost rail (test_uct_agent_spend_limits.py, test_uct_agent_turn_cap.py)
- the NL-1 parity fixture reader
- planner v2 (test_uct_agent_planner_v2.py)

🤖 Generated with [Claude Code](https://claude.com/claude-code)
