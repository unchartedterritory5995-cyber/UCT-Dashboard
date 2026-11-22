# PR: Layout bar execution: pin, take off, reorder (C3-037..039)

Branch `agent/pl/layout-dock-exec` (pl-exec3), on master `9c9e64681a`. One family, releasable on its own. It does not touch deixis.js, spatialCheck.js, clickRef.js, fastPath.js, the useAgent approval path or Indicator Intelligence, and it overlaps no open PR (#1027, #1059, #1070, compare groups, #1030).

## What a member can now ask

The Layout Dock along the bottom of /charts has a library (every layout; the only place a layout is deleted) and a bar (slots that point into the library). The Agent now does the bar's three actions through the dock's own door (`LayoutDock.jsx` `agentRef`, via `useImperativeHandle`): the dock's writer `writeDock` (the `charts_layout_dock` preference) and the menu's own positional helpers.

| Row | Request | What runs | Undo |
|---|---|---|---|
| C3-037 | "pin my Breadth layout to the bar" | `addPin` (the library's add-to-bar), slot on the end | takes that slot off |
| C3-038 | "move Breadth to the front of the bar", "… to the right on the bar", "… to spot 2 on the bar" | `shiftPin` = `movePin` (Move left / Move right) repeated, one write | moves it back |
| C3-039 | "take Main Trading off the bar" | `removePin` (the slot menu's Close). Never a delete: the layout stays in the library | puts it back in the same spot |

All three are low-risk and reversible, so there is no confirmation card (the bar never deletes anything). The guarded-actions list is unchanged.

## Safety rules

1. Receipts only on a confirmed write. `setPref` answers true only once the server accepted the preference. If the server refuses, the bar is put back and the Agent says "Saving the layout bar to your account did not go through, so I put it back. Nothing was changed." There is no receipt.
2. The Agent never writes over a bar that changed since it was read. The runtime fingerprint is the bar's slots, and commit checks the slots again before writing.
3. The Agent never guesses a target. Layout words resolve the way `layout.open` resolves them (`layoutCandidates`). If the words could mean two layouts, the Agent asks with both names and changes nothing. If a layout sits on the bar twice, it names both spots and changes nothing.
4. A bar action never opens, deletes or saves a layout, and it never touches the board.

Mutants. Each was run against both new test files and then reverted:

| Mutant | Red |
|---|---|
| M0: not registered (stands in for the tree before this change) | 12 of 14 |
| M1: no stale-bar check (commit check and fingerprint both removed) | 1, the stale test |
| M2: an ambiguous name picks the first match | 2, the runtime ambiguity test and the outcome wrong-target test |
| M3: a refused write is still receipted | 1, the refusal test |
| M4: a layout on the bar twice picks the first slot | 1, the twice-on-bar test |

## Targeting

- The fast path claims a phrase only when the sentence says "bar" or "dock" ("pin/unpin … layout" also counts) and the words name exactly one layout. Anything else goes to the model. The model gets a `layoutDock` context entry that lists the bar's slots as `{ spot, layout, id }`.
- Wrong-target control: none of these sentences produce a bar action: "move the chart to the left", "delete Main Trading", "remove Main Trading", "open Breadth", "close the Breadth tab".
- Routing (re-merge onto `64421f770d`): the three actions are their OWN words-only group `layoutBar` (by action name, `fillLast`), like `watchlistShow` / `compareGroups`; `layouts` is unchanged from master. Its words: a preposition followed by "bar" or "dock" (never a bar-info noun after "bar": the chart header's readout), `unpin`, and `pin … layout`. Why, and the v2 / NL-1 evidence: `evidence/layout-bar-1074/v2-first-calls.md`.

## Files (git diff --name-status origin/master...HEAD)

```
A	app/src/agent/agentLayoutBar.test.jsx                    runtime rails over the real LayoutDock (10)
M	app/src/agent/agentRouting.test.jsx                      action count 157 → 160
M	app/src/agent/builtins.js                                registers the module
A	app/src/agent/capabilities/layoutBar.js                  target kind layoutDock, context, 3 capabilities, phrases
M	app/src/agent/contract/manifest.golden.json              regenerated (UPDATE_AGENT_GOLDEN=1)
M	app/src/agent/host.js                                    buildLayoutDockSource + host.layoutDock
A	app/src/agent/qa/chartsOutcome/layoutBar.outcome.test.jsx real panel + real LayoutDock (4)
M	app/src/agent/routing.js                                 + layoutBar group (words-only, the 3 bar actions)
M	app/src/pages/charts/ChartsWorkspace.jsx                 agentDockRef → LayoutDock agentRef and the host
M	app/src/pages/charts/LayoutDock.jsx                      the door (useImperativeHandle); writeDock returns setPref's answer
M	app/src/pages/charts/layoutDockPins.js                   shiftPin (movePin repeated)
A	docs/agent/program/PR-exec-layout-bar.md                 this file
M	tests/fixtures/nl1_assemble_parity.json                  regenerated (UPDATE_NL1_PARITY=1)
```

## Status rows (for the status doc owner; CHARTS_EXECUTION_STATUS.md is not edited here)

- C3-037, C3-038, C3-039: MISSING → VERIFIED (SIMULATED outcome test, scripted model, jsdom). Evidence: `layoutBar.outcome.test.jsx` (4 passed) and `agentLayoutBar.test.jsx` (10 passed).
- C3-040 (view a layout's version history) and C3-041 (restore a layout version): unchanged, MISSING. They are not in this PR because the feature is dark (`ARTIFACT_VERSIONS_ENABLED`: every route answers 404 and the dock hides the menu entry). They belong in their own PR once the flag is armed. Restore would need a confirmation card.

## Tests run (single files, no whole tree)

- vitest, 22 files in one run: agentApprovalBinding, agentBoard, agentContracts, agentCore, agentEvalBaseline, agentLayoutBar, agentLayouts, agentManifestCaps, agentNl1Selection, agentNl1SelectionCoverage, agentNlCorpus, agentNoLookbehindStrings, agentNoLookbehindOracle, agentOperatorLive, agentProtectedLayouts, agentReservedWords, agentRouting, agentRoutingLayoutStabilization, agentRoutingS6, agentSurfaces, LayoutDock.test, LayoutDock.history.test. Result: 539 passed.
- After the door moved to useImperativeHandle: the outcome test, the runtime test, LayoutDock and LayoutDock.history (55 passed). Then ChartsWorkspace, its doorInPage, layoutUndoAgent, previousLayout and artifactHistory tests, plus agentContracts, agentRouting, agentNl1Selection, agentOperatorLive and agentLayouts (175 passed).
- pytest on every server test that reads the golden or parity json: eval_proxy, eval_run, acceptance_stabilization, args_live_shapes, autoapply, breadth, breadth_history, contract, data_reply, f16_calls_control, f16_flow_chips, nl1, nl1_selection, presentation, program_ownership, screen_research, turn_cap, undo_hotfix. Result: 864 passed.
- eslint is clean on the new and changed agent/dock files. ChartsWorkspace.jsx has older errors on lines this PR does not touch.

## Try it live (admin, /charts)

1. "pin my Breadth layout to the bar". Use a layout you closed off the bar earlier. It appears at the end of the bar, and the board does not change. Then say "undo".
2. "move Breadth to the front of the bar", then "move Breadth to the right on the bar".
3. "take Main Trading off the bar". It leaves the bar, but ＋ (the library) still lists it.
4. "take my trading layout off the bar" when two layouts have "Trading" in their names. The Agent asks which one, and nothing changes.
5. "put my Swing layout first on the layouts bar". Use any layout that is on the bar once.

## Known limits

- Evidence is SIMULATED: jsdom, a scripted model, the real LayoutDock and the real panel, with the preference store stubbed. It has not run in a browser, and the real model's choice is not proven.
- Pinning does not open the layout. The dock's own library click does open it. Switching is `layout.open`, which asks first when unsaved edits would be lost.
- The Agent will not put a second copy of a layout on the bar. The dock allows it, but that would make "move X" ambiguous. A layout that is already on the bar twice gets a question, never a pick.
- One bar change per request: "pin X and move it first" does the first change and asks for the next.
- A hidden bar (`hidden: true` in the preference) is refused. No UI control sets it today.
- Not covered: C3-040/041 version history (dark), and the phone, which has no dock.

## Capability-regression corpus (follow-up)

- Three capreg intents, one per action: `layout.pinToBar` (board LAYOUT_BAR, "pin my Breadth layout to the bar"), `layout.moveOnBar` and `layout.unpinFromBar` (board LAYOUT_BAR_FULL, "move Breadth to the front of the bar", "take Main Trading off the bar"). Each checks the `charts_layout_dock` preference after the change and after "undo", and that the open layout and the library are unchanged.
- The capreg harness gets a dock door (`extra.layoutDock`) that mirrors LayoutDock's `agentRef`: the same `addPin` / `removePin` / `shiftPin` helpers over the preference, read through `buildLayoutDockSource`.
- Regenerated: capreg `coverage/*` (UPDATE_CAPREG=1, additive contract) and `baseline.lock.json` (`tests/test_uct_agent_capreg_baseline.py --update`, additive only).
