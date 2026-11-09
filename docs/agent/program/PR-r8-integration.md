The Charts Agent now runs multi-step requests one honest step at a time. It keeps targeting the chart you were just talking about, controls every Options Flow filter, and handles drawing boards, drawing management, indicator settings, more widget controls, and answers to its own questions.

This one PR replaces the separate ship-4, ship-5 and round-8 PRs. Base: master after ship-3 (#985).

## Behaviour

### Multi-step requests
"Switch to NVDA, make it weekly, then add RSI" runs as steps, each with its own result. These five rules are each pinned by a test (the GO bar):
1. **Each step is all or nothing.** A step that fails partway leaves nothing behind.
2. **The receipt is exact.** It reads "Done 2 of 3 steps ("…" on Chart (NVDA); …), then stopped at "…": why. Not done: …". A partial run never says "all done".
3. **A changed board stops the run.** If another layout or board opens while the steps run, nothing after that runs. A step that opens a layout itself (part of what you asked for) does not stop it.
4. **One Undo.** "undo" takes back exactly the steps that ran, together. If you changed something by hand in between, your change is kept.
5. **Bounded.** At most 6 steps per request. A 60-second limit on starting new steps. No retries. Instant sequences make no model call. A request that goes to the model costs at most 2 paid calls (the server's per-request cap).

Also:
- The ticker a step switches to no longer counts as naming a chart. "switch to AAPL, weekly, hide the volume and draw a line at 120" stays on the clicked chart.
- "Every chart except that one" adds to every chart but that one, without asking which.

### The chart you were talking about (ship-5)
- After a change on one chart, or a request that names one chart, that chart counts as the clicked chart until you click again.
- A fresh click always redirects, including a re-click.
- "this" and "here" mean the click.
- After a change on several charts, a bare follow-up asks which chart.

### Options Flow (ship-4)
- Every filter chip (minimum premium, calls / puts, print type, direction, view, scope) is read and set in the chips' own words.
- The server's screen-word check no longer throws away a plan made only of Options Flow chip changes. Plans for any other widget are checked as before.

### Answers to the Agent's own question
When the Agent asks "which chart?", an answer like "2", "the bottom one" or "the AMD one" picks from the options it offered. If two options fit, it asks again with just those two.

### Drawings
- Hide or show all drawings on a chart, lock or unlock one, and hide or show one. Each works on the chart you mean and can be undone.
- **Drawing Boards** (new): switch, create, rename or delete a board by name.
  - Switch, create and rename can be undone.
  - Delete is always shown first and has no Undo, because its drawings go with it.
  - A missing, ambiguous or already-used name is refused, listing your real board names.
  - The last board is never deleted.

### Indicator settings
- Every built-in indicator's settings can be changed from its own definition: numbers, choices, on/off settings, every colour its settings panel offers (histogram up / down included), line width where it exists, and hide / show.
- This is proven across all 53 built-ins.

### Widget controls
- **Scanner:** go back to its scan picker, or search the picker's scan list.
- **Market Map:** turn "Follow the linked list" on or off.
- **News widget filter presets:**
  - apply a preset;
  - rename one (can be undone);
  - delete one (shown first, no Undo);
  - a missing, ambiguous, already-used or too-long name is refused, listing the real names.

## Files
- **Agent source:** `useAgent.js`, `deixis.js`, `compound.js`, `fastPath.js`, `host.js`, `memory.js`, `convTarget.js`, `routing.js`, `discovery.js`, `builtins.js`, `widgetNames.js`.
- **Agent capabilities:** `capabilities/board.js`, `capabilities/chart.js`, `capabilities/indicatorAuthoring.js`, and the new `capabilities/drawingBoards.js`.
- **Widgets:** `ChartsWorkspace.jsx` (a click token), `ScannerPicker.jsx` (search door), `TradeExchangeNewsWidget.jsx` (preset rename / delete through its own menu functions).
- **Server:**
  - `api/services/uct_agent/turn.py`: the Options Flow plan check. Its pytest is `tests/test_uct_agent_flow_widget_gate.py`.
  - `api/services/uct_agent/turn_v2.py`: planner v2 files Drawing Boards under the drawing domain, not history.
  - `tests/test_uct_agent_contract.py` and the capability-regression baseline lock: they now list the new action.
- **Tests:** 27 new or updated test files. Held-out phrasings were committed before each change.
- **Fixtures:** the manifest golden, the NL-1 parity fixture and the capability-regression contract / coverage, re-pinned.
- **Manifest size:** the manifest sent to the model grows by **803 bytes** (154,341 to 155,144 compact), all of it from the one new action `drawingBoard.set`. Everything else adds no manifest bytes. The Drawing Boards context is only sent when boards come up, so ordinary requests are unchanged.

## Verification
- **Development (local, scripted model):**
  - Full Agent suite on the integrated branch at 1368c64e8b: **9665 passed, 0 failed, 6 skipped**.
  - Targeted folders were run after each of the six merges, with 0 failures each time.
  - The held-out sets pass.
  - ship-4's server change went through AUDIT rounds 1–2. The rest of this PR, including the 803-byte manifest growth (`AUDIT-r8-drawings.md`), is for AUDIT to review at this head.
- **pytest** (the Options Flow gate, the breadth_current changes, the v2 cost rail, the NL-1 parity fixture reader) runs in Agent CI on this branch. It was not run locally.
- **Production: not yet verified.** It will be checked after merge (gate, promotion, web deploy, health).

Details: `docs/agent/program/R8-INTEGRATION.md` (merge order, conflicts, re-pins).

🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_01Dhm4qhJhGoto7iixuJEEzM
