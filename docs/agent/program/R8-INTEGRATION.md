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

The compact manifest the model is sent grows by **+1,243 bytes** (154,341 to 155,584; +803 before AUDIT (a) split off `drawingBoard.delete`, 48e0eabce1), all of it from r8-drawings' two Drawing Board
actions, `drawingBoard.set` and `drawingBoard.delete`. (At the first integration it was one action: golden file, LF, 195,835 to 196,931 bytes.) Every other
branch is byte-neutral on the manifest:

- r8-multistep, r8-scanner-filter, r8-indicator-style, r8-errors: no manifest change;
- r8-presets: +0, an item list of widget.setOption.

## Targets for pl-auto's unseen9 batch

This branch should turn the cases below from failing to passing. A fresh unseen9 batch should aim at them with new phrasings,
NOT the ones listed here: those are the tuning and held-out phrasings already in the tests.

### unseen8 cases this branch fixes

| unseen8 | What failed | Fix (branch) | Rails here |
|---|---|---|---|
| class 1, u8-sequences-02 | "switch to AAPL, weekly, hide the volume and draw a line at 120" with the LEFT chart clicked and AAPL on the right: the ticker the step switches TO was read as naming the right chart | `withoutArgTickers` in deixis: an op's own ticker argument names no chart (screenUnnamedTargets, the click check, screenDeicticOps) (r8-multistep) | agentMultiStep "unseen8" block |
| class 2 | An answer to the Agent's own choice question ("2", "the bottom one") was not understood, and it asked again | `pickOffered`: the answer is read against the OFFERED options (a number, an ordinal, "option N", "last", label words such as a position or a ticker); two that fit are asked again with just those two (r8-errors) | agentChoiceAnswer, agentChoiceAnswerHeldOut 8/8 |
| class 4 | "every chart except that one" / "all but the SPY chart" asked "Which charts should it go on?" | `multiChartAmbiguity` EXCEPT_WORDS in indicatorAuthoring.js: every chart here but the ones set aside (the click for a negated pointer, or the charts named after "except") (r8-multistep) | agentMultiStep "every chart except that one" |
| class 3 | A saved screen | **NOT in this branch**: still waiting on pl-auto's fixture check | none |

Also new in this branch and worth probing in unseen9:

- multi-step runs: the exact per-step receipt "Done n of m steps (…), then stopped at …";
- a changed premise: a layout opened from OUTSIDE the run stops it, while the run's own layout-open step does not;
- Undo of a partial run;
- Drawing Boards by name;
- News preset rename / delete.

### C-ids this branch should move to VERIFIED

The exec-gen-1 status doc (d64d6f127a) already records these from the r8 branches. unseen9 can confirm them on this
integrated build:

- **Drawings (r8-drawings):**
  - C1-126 hide / show every drawing on a chart;
  - C1-158 lock / unlock one;
  - C1-159 hide / show one;
  - C1-167 switch a Drawing Board;
  - C1-168 create one;
  - C1-169 rename one;
  - C1-170 delete one (shown first, no Undo);
  - C1-116 an alert at a line's fixed level (cited from drawingFamily.outcome; already on the base).
- **Indicator settings (r8-indicator-style):** C2-026 flip an on/off setting; C2-031 histogram up / down colours.
- **Widgets (r8-scanner-filter):**
  - C3-108 a Scanner back to its picker;
  - C3-109 search the Scanner preset list (first-call reach is 0/2 as pinned; the reroute reaches it);
  - C3-194 the Market Map's Follow the linked list.
- **C3-140, News filter presets: apply (r8-scanner-filter) plus rename and delete (r8-presets).** exec-gen-1 still lists it as
  IMPLEMENTED / UNVERIFIED (apply only). On this branch the whole row is covered, so it should move to VERIFIED.

Not moved by this branch: C3-138 / C3-139 (already VERIFIED in rounds 6-7); the saved-screen row behind unseen8 class 3.

## pytest still owed (not run here: C:\data holds real data; AUDIT / CI)

- tests/test_uct_agent_flow_widget_gate.py
- tests/test_uct_agent_breadth_current.py (the changes carried from the ship series)
- the v2 cost rail (UCT_AGENT_MAX_CALLS_PER_REQUEST, budget.py)
- whatever reads tests/fixtures/nl1_assemble_parity.json (re-pinned by r8-drawings)

## Full suite

Full 4-shard vitest at 1368c64e8b, run through agent_suite_lock at BelowNormal (LOCAL native Windows Node v24, BROWSER-MOCK-MODEL / SIMULATED): **9665 passed, 0 failed, 6 skipped** (2358+3 / 3338 / 1889+1 / 2080+2), 04:46-04:59 ET. It replaces the separate r8-errors, r8-drawings and r8-presets reruns. pytest not run (C:\data rule): owed to AUDIT / CI, listed above.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
