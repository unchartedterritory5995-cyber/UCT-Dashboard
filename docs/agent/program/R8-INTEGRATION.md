# r8-integration: the six round-8 branches merged onto ship-5

Local branch `agent/pl/r8-integration` (worktree C:\w\pl-mc-f7), not pushed. Base: ship-5 6339030e1e. Evidence: LOCAL native
Windows Node v24, jsdom, BROWSER-MOCK-MODEL / SIMULATED (scripted model). It gets one full-suite run when the Lead clears the lock.

## Merge order (each `--no-ff`, targeted folders run after each one)

| # | Branch | Merged head | Merge commit | Conflicts | Targeted folders after (SIMULATED) |
|---|---|---|---|---|---|
| 1 | r8-multistep | a5aee1cf49 | 2bd6cdf7bc | none | 5191 passed, 0 failed, 1 skipped (125 files) |
| 2 | r8-scanner-filter | 6e9b4e7dad | 063722a3bb | 1 (below) | 5207 / 0 / 1 (125) |
| 3 | r8-indicator-style | 5e9b22f1cf | 5e5b47b3d0 | none | 5269 / 0 / 1 (127) |
| 4 | r8-errors | 4535c7b8e0 | 7b88131195 | none (deixis.js, useAgent.js auto-merged) | 5283 / 0 / 1 (129) |
| 5 | r8-drawings | cdda9c6261 | cd19f3ac1a | none (manifest.golden.json auto-merged) | 5318 / 0 / 1 (132) |
| 6 | r8-presets | 44c9e38de8 | ecc5f07d99 | none | 5324 / 0 / 1 (132) |

The targeted folders were run on every step with `scratchpad/pl-exec/integ-tests.sh`:

- the whole capability-regression folder and the whole charts-outcome folder;
- routing (`agentRouting*`, `routing*`), widgets (`agentWidget*`, `pages/charts/widgets`);
- multi-step: `agentMultiStep*`, `agentWorkspaceCompose*`, `agentConversationP2`, `agentAcceptanceP2`;
- contracts / SAT-1 requests / NL-1 selection;
- the files each branch re-pinned or fixed: `agentDrawingBoards*`, `agentBatch4`, `agentScreener`, `agentPhase2B`,
  `agentChoiceAnswer*`, `agentIndicatorStyle*`.

## Conflicts and how they were resolved

- **#2, `qa/chartsOutcome/widgetDoorRows.outcome.test.jsx`.** Git marked r8-scanner-filter's appended round-8 block (C3-108,
  C3-109, C3-194) as conflicting with an EMPTY integration side. The integration side had no change to the file since the
  merge base (`git diff <base> HEAD` is empty). The marking came from a line with a different line ending. Resolved as the
  r8-scanner-filter version, which keeps every earlier test and adds the round-8 ones: both behaviours kept.
- **#4, auto-merged code (no textual conflict).**
  - `deixis.js`: r8-multistep's `withoutArgTickers` (an arg's ticker is not a target word) sits beside r8-errors'
    `pickOffered` (a typed answer read against the offered options). These are separate functions.
  - `useAgent.js`: r8-multistep's GO-bar compound run (receipt, premise re-read after a layouts step, wall cap) sits beside
    r8-errors' answer-to-a-local-choice step in send (pickOffered, then chooseTarget; two fits are asked again).
  - Both kept. Their rails pass together: agentMultiStep*, agentChoiceAnswer*, agentPhase2B, agentConversationP2,
    agentWorkspaceComposeP3.
- **#5, `contract/manifest.golden.json` auto-merged.** ship-5 carries master's dotSize op; r8-drawings adds drawingBoard.set.
  The re-pin below confirms the merged file is exactly what the registry builds.

## Re-pins (once, at the end)

All were run once on ecc5f07d99 with the update switches. **Each produced content-identical files** (only line endings
differed; nothing to commit), so the auto-merged pins already match what the merged code builds:

- `UPDATE_AGENT_GOLDEN=1`: contract/manifest.golden.json
- `UPDATE_SAT1_REQUESTS=1`: api/services/uct_agent/scan/sat/section_b_requests.json (unchanged from ship-5: Drawing Boards'
  context is gated)
- `UPDATE_NL1_PARITY=1`: tests/fixtures/nl1_assemble_parity.json (carries r8-drawings' +4/-1)
- `UPDATE_CAPREG=1`: capabilityRegression coverage/contract.json, coverage.json, COVERAGE.md (inventory 676/676)

The count pins hold as merged: the route-group capability count is 158 (`agentRouting.test.jsx`) and the Charts manifest
length is 152 (`agentScreener.test.jsx`). Both moved only by drawingBoard.set.

## Combined manifest byte growth

The compact manifest the model is sent grows by **+803 bytes** (154,341 to 155,144), all of it from r8-drawings' one new
capability `drawingBoard.set`. The golden file (LF) grows from 195,835 to 196,931 bytes (+1,096 pretty-printed). Every other
branch is byte-neutral on the manifest:

- r8-multistep, r8-scanner-filter, r8-indicator-style, r8-errors: no manifest change;
- r8-presets: +0, an item list of widget.setOption.

## pytest still owed (not run here: C:\data holds real data; AUDIT / CI)

- tests/test_uct_agent_flow_widget_gate.py
- tests/test_uct_agent_breadth_current.py (the changes carried from the ship series)
- the v2 cost rail (UCT_AGENT_MAX_CALLS_PER_REQUEST, budget.py)
- whatever reads tests/fixtures/nl1_assemble_parity.json (re-pinned by r8-drawings)

## Full suite

Not run yet: the suite lock is held for release runs. One full 4-shard run is owed on this branch when the Lead clears it.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
