# PR: Drawing Boards execution: switch, create, rename, delete (C1-167..170)

Branch `agent/pl/drawing-boards-exec` (pl-exec), on master `381f91acbd`. It is one family and can be released on its own. It does not touch deixis.js, spatialCheck.js, clickRef.js, fastPath.js, the useAgent approval path or Indicator Intelligence.

## What a member can now ask

A Drawing Board is a named sheet of drawings shared by every chart and symbol (the stacked-sheets button at the end of the chart's drawing tools). The Agent now does the four things the Boards panel does, through the panel's own writers:

| Row | Request | What runs (components/chart/drawingsStore.js, the writers TracingsPanel uses) | Undo |
|---|---|---|---|
| C1-167 | "switch to my Swing board" | `setActiveTracing` (a click on a board row) | switches back |
| C1-168 | "create a new drawing board called Earnings" | `createTracing`, then `setActiveTracing` ("New board" makes a board and switches to it) | removes it, only while it is still empty, and switches back |
| C1-169 | "rename Board 2 to Breakouts" | `renameTracing` (the row's pencil) | renames it back |
| C1-170 | "delete the Breakouts board" | `deleteTracing` (the row's bin and its ✓) | none: the store keeps no copy of a deleted board |

Each receipt waits for the server's copy: useTracingsSync pushes `exportTracings()` into the `tracings_doc` preference, and the receipt polls it for these boards and the active one. When the server's copy is not seen, the receipt says the change is on this device and the save to the account was not confirmed. It never claims a save it did not see.

## Delete rules (Lead, 2026-11-11)

1. Delete is always a confirmation card (`risk: 'confirm'`, `reversible: false`). The card names the exact board and its drawings: "Delete the drawing board “Earnings” (2 drawings on 2 symbols). This can't be undone." Nothing is deleted before Apply. At Apply, the board must still match the card (same name, same number of drawings, same active state), or nothing is deleted.
2. If the member gives no name ("delete my board", "delete this board", "delete the current drawing board"), the Agent asks with the real names and does not show a card. On the model path, a board argument that is not exactly one board's name is refused with the names. When two boards share a name, the Agent asks the member to rename one first.
3. The panel lets you delete the board you are drawing on. It then moves you to the first board left. The Agent mirrors that, but only when the board is named, and the card says it: "It's the board you draw on now; afterwards you'll draw on “Earnings”." You always keep at least one board, the same as the panel's disabled bin.
4. The card and the receipt both say "This can't be undone", because the store has no restore.
5. Rails: `agentDrawingBoards.test.jsx` (runtime) and `qa/chartsOutcome/drawingBoards.outcome.test.jsx` (the real panel). Mutant 1 made delete `risk: 'local'` and reversible, which skips the card: 2 tests went red (the card test and the rail). Mutant 2 resolved an ambiguous name to its first match and dropped the one-chart answer: 2 tests went red (the ambiguity and wrong-target tests). Both were reverted.

## Targeting

- A board is named the way the panel shows it: its name, or "Board N" for an unnamed board. The match ignores case and quotes, and takes "my/the" and "(drawing) board". A fast phrase is claimed only when it says "board" and names exactly one board. To create a board it must say "drawing board". Anything else goes to the model. A layout or watchlist that has the same name makes the phrase ambiguous, so the model decides.
- ⛔ Boards apply to every chart. A request aimed at one chart ("switch to my Earnings board on the NVDA chart", "… on the left chart", "… only on this chart") changes nothing. The reply says: "Drawing boards are shared by every chart, so I can't change the board for one chart only. Nothing was changed. …"
- A question ("how do I create a board") is never claimed: every phrase starts with its verb. The walkthroughs for C1-167..170 already exist (`agent/guide/controls.js`, `boards.*`, VERIFIED in a browser 2026-11-09 in CHARTS_TEACH_STATUS.md). Their step text matches the panel: the pencil, the bin then ✓, New board, a click on a row.

## Files (git diff --name-status origin/master...HEAD)

```
M	app/src/agent/agentOperatorLive.test.jsx            the guarded-actions list + drawing.deleteBoard
A	app/src/agent/agentDrawingBoards.test.jsx           runtime rails (13)
M	app/src/agent/agentRouting.test.jsx                 action count 157 → 161
M	app/src/agent/builtins.js                           registers the module
A	app/src/agent/capabilities/drawingBoards.js         target kind, context, 4 capabilities, phrases
M	app/src/agent/contract/manifest.golden.json         regenerated (UPDATE_AGENT_GOLDEN=1)
M	app/src/agent/host.js                               buildDrawingBoardSource + host.drawingBoards
A	app/src/agent/qa/chartsOutcome/drawingBoards.outcome.test.jsx   real panel (6)
M	app/src/agent/routing.js                            the drawings group: title + a board-verb word (add-only)
M	docs/agent/CHARTS_EXECUTION_STATUS.md               C1-167..170 VERIFIED (SIMULATED); counts +4
A	docs/agent/program/PR-exec-drawing-boards.md        this file
M	tests/fixtures/nl1_assemble_parity.json             regenerated (UPDATE_NL1_PARITY=1)
M	tests/test_uct_agent_autoapply.py                   the guarded-actions list + drawing.deleteBoard
```

## Tests run (single files, no whole tree)

- vitest: agentDrawingBoards 13/13, drawingBoards.outcome 6/6. Also agentRouting, agentContracts, agentNl1Selection, agentSurfaces, agentManifestCaps, agentOperatorLive, agentDrawings, agentGuideHeldOutControls, agentRoutingS6, agentNlCorpus, agentEvalBaseline, agentCore, agentReservedWords, agentNoLookbehindStrings and agentLayouts all passed (278 tests across the 11-file run).
- pytest (the server tests that read the golden or parity json): contract, eval_run, nl1_selection, turn_cap, program_ownership, args_live_shapes, autoapply, nl1, eval_proxy, acceptance_stabilization, presentation, undo_hotfix, breadth, breadth_history, data_reply, f16_calls_control, f16_flow_chips, screen_research. 867 passed.
- eslint is clean on the changed source files.

## Try it live (admin, /charts)

1. "create a new drawing board called Earnings". The Boards panel shows Earnings with the check, and new lines go on it.
2. "switch to Board 1" (or the name of your first board), then "undo".
3. "rename my Earnings board to Breakouts".
4. "delete the Breakouts board". A card names it and its drawings and says it can't be undone. Dismiss once, then ask again and Apply. Also try "delete my board": it asks which one.
5. "how do I switch drawing boards?" runs the walkthrough. "switch to Board 1 on the left chart" changes nothing and explains that boards are shared.

## Known limits

- Evidence is SIMULATED: jsdom, a scripted model, the real store and the real panel. The Agent has not run these in a browser, and the real model's choice is not proven.
- No Undo for a delete. Undo for a create works only while the new board is still empty.
- The Agent will not create or rename to a name another board already has. The panel allows that, but it would make names ambiguous. Two existing boards with one name are asked about, never picked.
- An unnamed board's "Board N" number is its place in the list. It moves up after a delete, as it does in the panel.
- Not covered: board visibility, order and colour (the panel has no controls for them), and the mobile Boards sheet.
- The sync check reads the `tracings_doc` preference. If `TRACINGS_STORE_ENABLED` (compiled, default OFF) is ever switched on, receipts will say the save was not confirmed until this check follows the new store.
- On the model path, an unnamed delete is caught by the hint, by a board argument that must be exactly one board's name, and by the card that names the board. The fast path asks deterministically for the common phrasings.
