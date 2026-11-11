# PR: Drawing menu operations: Duplicate, and a position's entry/stop/target alerts (C1-157, C1-118)

Branch `agent/pl/drawing-ops-exec` (pl-exec5), on master `7e9d52d318` (merges cleanly onto `999d1e297f`). One family, releasable on its own. It does not touch deixis.js, spatialCheck.js, clickRef.js, fastPath.js, the useAgent approval path, Indicator Intelligence, chart settings, or any product (non-agent) file.

## What a member can now ask

Two rows of a drawing's own menu (`drawingSettingsSchema` ACTIONS / `positionAlerts`) that the drawing family did not reach. Both go through `drawingKind` (capabilities/drawings.js): the same drawings-store writer every other drawing capability uses, read back by id, undone by id.

| Row | Request | What runs | Undo | Card |
|---|---|---|---|---|
| C1-157 | "duplicate that trendline", "duplicate it" | the menu's own Duplicate: `addDrawing({...drawing without id, points: offsetPoints(points), locked: false})` (ChartDrawingOverlay onDuplicate) | removes the copy only | no (reversible, nothing deleted) |
| C1-118 | "alert me on my position's stop and target", "set all three alerts on that position", "alert on my entry" | the position menu's Alerts row: one bound `line` alert per level (`<drawing>#<0/1/2>`, boundIdFor), side from `positionLevelDirection`, POSTed through `alertLibraryKind` like `drawing.setAlert` | deletes exactly those alerts, refused if one already went off | yes, `risk: 'confirm'` (owner rule: alert creation is shown first) |

The copy becomes the drawing "it" means next (the menu also selects it). `drawing.setAlert` on a position used to say "set it on the chart"; it now points the member at these alerts.

## Safety rules (each has a mutant that goes red)

1. Duplicate does only what the menu offers. A retired type (the 3-point position) has no Duplicate in its menu (`RETIRED_ACTIONS`), so it is refused.
2. A hidden drawing is not duplicated (the copy keeps `hidden`, so it would be a write nobody can see). The member is told to show it first.
3. The ENTRY alert's side comes from the current price, as the chart's menu does with its last close. The Agent reads the price through the gateway's `quotes` (`quotesFor`, never /api/live-prices). If it can't be read, the entry is refused as unavailable. The side is never guessed and nothing is written. Stop and target don't need a price (the position's side fixes them).
4. A position whose points make neither a long nor a short has no alerts (the menu hides the row), so it is refused.
5. The alert book is read fresh before planning. If it can't be read, nothing is set.
6. "All three" skips a level that already has an active alert, as the menu's button does. One named level that already has one is refused.
7. Position alerts are always shown first (risk `confirm`), and Dismiss sets nothing.

| Mutant (run against drawingOps.outcome.test.jsx, then reverted) | Red |
|---|---|
| M0 not registered (stands in for the tree before this change) | 11 of 13 |
| M1 hidden drawing duplicated | 1 |
| M2 retired type duplicated | 1 |
| M3 entry side guessed with no price | 1 |
| M4 unreadable alert book not refused | 1 |
| M5 position alerts not confirm | 4 |
| M6 neither-long-nor-short treated as long | 1 |
| M7 "all three" does not skip a set level | 1 |

## Targeting

No new targeting. The model names the drawings entry (per symbol) and a drawing id from it, as for every drawing capability (`recent` = the drawing just drawn or changed). Wrong-target controls in the outcome test: duplicating on TSLA's entry copies TSLA's drawing and leaves NVDA's untouched. An NVDA id sent against TSLA's entry writes nothing anywhere and no copy is receipted.

Routing: the `alerts` group gains `drawing.setPositionAlerts` in its actions, and its title mentions position alerts. `drawing.duplicate` rides the `drawings` group by its domain. Discovery's drawings row lists both. Its "known" list drops "duplicating a drawing" and adds "copying a drawing to a different symbol".

## Files (git diff --name-status 7e9d52d318...HEAD)

```
M	app/src/agent/agentOperatorLive.test.jsx            guarded list + drawing.setPositionAlerts
M	app/src/agent/agentRouting.test.jsx                 action count 157 → 159
M	app/src/agent/capabilities/drawingFamily.js         setAlert on a position points to its own alerts
A	app/src/agent/capabilities/drawingOps.js            drawing.duplicate, drawing.setPositionAlerts
M	app/src/agent/capabilities/drawings.js              registers drawingOps (2 lines)
M	app/src/agent/contract/manifest.golden.json         regenerated (UPDATE_AGENT_GOLDEN=1)
M	app/src/agent/discovery.js                          drawings row: caps, canDo, known
A	app/src/agent/qa/chartsOutcome/drawingOps.outcome.test.jsx  real panel + real drawings store + fixture alert routes (13)
M	app/src/agent/routing.js                            alerts group: + drawing.setPositionAlerts
M	tests/fixtures/nl1_assemble_parity.json             regenerated (UPDATE_NL1_PARITY=1)
M	tests/test_uct_agent_autoapply.py                   server guarded list + drawing.setPositionAlerts
A	docs/agent/program/PR-exec-drawing-ops.md           this file
```

## Status rows (for the status doc owner; CHARTS_EXECUTION_STATUS.md is not edited here)

- C1-157 Duplicate: MISSING → VERIFIED (SIMULATED outcome test, scripted model, jsdom). Evidence: `drawingOps.outcome.test.jsx`, the C1-157 describe block (4 tests).
- C1-118 Position alerts (three lines): MISSING → VERIFIED (SIMULATED outcome test, scripted model, jsdom). Evidence: the C1-118 describe block (9 tests). The entry alert is covered with a stubbed current price. No browser run.
- Not in this PR: C1-160 Save as default (it writes `cs.drawingDefaults` through the chart-settings writer, which is #1059/#1072 territory), and C1-161 reorder (no UI control exists).

## Tests run (single files, no whole tree)

- vitest, 24 files in one run: drawingOps/drawingFamily/drawings/alerts outcome, agentDrawings, agentDrawingsAnchored, agentDrawingFamilyTimeframes, agentAlerts, agentAlertBook, agentChartsOperatorP1, agentContracts, agentNl1Selection, agentRouting, agentManifestCaps, agentCore, agentSurfaces, agentDiscoveryWordBoundary, agentKnowledge, agentNoLookbehindStrings, agentNoLookbehindOracle, agentReservedWords, agentOperatorLive, qa/noLivePrices, agentEvalBaseline. Result: 613 passed.
- pytest on the server tests that read the golden or parity json (eval_proxy, eval_run, acceptance_stabilization, args_live_shapes, autoapply, breadth, breadth_history, contract, data_reply, f16_calls_control, f16_flow_chips, nl1, nl1_selection, presentation, program_ownership, screen_research, turn_cap, undo_hotfix). Result: 863 passed. The first run caught `minItems`/`maxItems` in the args schema: the server's structured subset drops a capability that uses them, so they were removed. The level list is checked in `check` instead.
- eslint is clean on the new and changed agent files.

## Try it live (admin, /charts)

1. Draw a trendline, then say "duplicate it". A copy appears just below the original, unlocked. Then say "make it blue" (the copy changes), then "undo" twice (only the copy goes).
2. Hide a drawing, then say "duplicate the hidden trendline". The Agent asks you to show it first, and nothing is drawn.
3. On a chart with an existing long/short position drawing, say "set alerts on my position's stop and target". A card appears. Apply it, and the position's menu shows the Stop and Target bells on. Then say "undo".
4. "set all three alerts on that position". When the current price can be read, all three are set (the entry side follows the price). When it can't, the Agent says it couldn't read the price for the entry, and nothing is set.

## Known limits

- Evidence is SIMULATED: jsdom, a scripted model, the real panel and the real drawings store, with fixture alert routes and a stubbed current price. It has not run in a browser, and the real model's choice is not proven.
- The entry alert's side uses the current quote, where the chart uses its last loaded close. The two agree while the chart is live. They can differ on a stale chart.
- New position drawings can't be created (the type is retired), so C1-118 applies only to positions a member already has.
- Duplicate copies within the same symbol only. Copying a drawing to another symbol (the overlay's Ctrl+C / Ctrl+V) is not offered: prices rarely carry across symbols, so the copy would often land off-screen.
- A duplicated drawing does not copy its alerts. The menu doesn't either: alerts are bound to the original's id.

## Merge notes

- Conflicts expected only on shared lines: `manifest.golden.json` and `nl1_assemble_parity.json` (regenerate), the guarded lists in `agentOperatorLive.test.jsx` / `test_uct_agent_autoapply.py` (#1070 adds `drawing.deleteBoard` on the same line; keep both, sorted), and the action count in `agentRouting.test.jsx` (sum the additions).
- No product files changed, so nothing for the web build beyond the agent bundle.

## Routing fix and capreg corpus (follow-up)

- Reachability regression fixed: under routing v2, "create a custom copy of the rsi indicator" lost the `definitions` group (definition.duplicate unreachable). Cause: `drawing.duplicate`'s summary used the generic word "copy", so v2's BM25 index counted "copy" in the drawings document too and weighted it lower for definitions (6.14 → 5.91, under STRONG 6.0). The summary now says "duplicate drawing" and "the duplicate"; a drawing copy is named by drawing words, an indicator copy keeps routing to indicators / definitions (definitions back to 6.15). No routing regex changed, so there are no lookbehinds and the frozen baselines are unchanged.
- New rail `qa/capabilityRegression/duplicateRouting.test.js` (v1 and v2): "duplicate my RSI" and "copy that indicator" reach indicators/definitions, never drawings; "duplicate this trendline", "duplicate the drawing" and "copy this trendline" carry drawing.duplicate; under v2, "create a custom copy of the rsi indicator" carries definition.duplicate. Mutation: with the old summary, that last test goes red.
- Capreg intents `drawing.duplicate` (TIMED: draw a trendline, duplicate it, Undo removes only the copy) and `drawing.setPositionAlerts` (DRAW + a seeded long position: proposal first, nothing written; Apply writes the stop alert below and the target alert above). The harness takes `seed.drawings` for a drawing the Agent cannot draw itself.
- Regenerated: `manifest.golden.json` (one summary), capreg `coverage/*` (UPDATE_CAPREG=1), `baseline.lock.json` (additive). Parity was regenerated in its own run and did not change.
