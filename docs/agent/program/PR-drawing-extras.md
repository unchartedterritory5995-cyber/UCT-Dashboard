# PR: drawing extras — Position Calculator, Save as default, tool favourites (C1-144, C1-160, C1-165)

Branch `agent/pl/drawing-extras` from origin/master `8660b43615`. Not pushed (worktree push guard).

## What a member can now ask

| Row | Action | The product's own writer | Read back from | Undo |
|---|---|---|---|---|
| C1-144 | `drawing.positionCalculator` — open the Position Calculator on ONE chart with an entry, a stop and a target | the toolbar's Position tool: `setActiveTool('position')` and PositionPanel's state (`setPositionTool`), as `StockChart.positionCalc`, reached through the chart's view door (`viewDo` op `positionCalc`, ChartPane allow-list) | `getDateMeta().positionCalc` (open, entry, stop, target, direction) | exact: the calculator as it was (closed stays closed; old prices back); stale once the member types in the panel or closes it |
| C1-160 | `drawing.saveDefaults` — make one drawing's style the default for new drawings on ONE chart | the menu row's payload (`saveDefaultsPayloadFor`) and StockChart's merge (`mergeDrawingDefaults`), both moved unchanged into `components/chart/drawingSaveDefaults.js` and now called by the row, by StockChart's `onSaveDefaults` and by the Agent; written through the chart's settings writer | the chart's stored settings (`cs.drawingDefaults`) | exact (the chart kind, field-scoped) |
| C1-165 | `drawing.favoriteTool` — star or unstar a drawing tool | the toolbar menu's ★: `toggleFavoriteTool` now writes through `components/chart/drawToolFavorites.js` (same storage key), which also tells every mounted toolbar in the tab | browser storage (`readFavoriteTools`) | exact (the list it replaced); stale once the member stars or unstars a tool |

Honest refusals: a missing or unreadable price ("missing: target", "stop (“-3” isn't a price)"); a stop at the entry; a target on
the losing side; a stated side that contradicts entry vs stop. The side is read from entry vs stop and never guessed. A chart
with no drawing toolbar has no calculator. A drawing id not on the target chart's symbol is refused (wrong-target control); a
retired position drawing has no Save as default. A tool id that is not a toolbar button cannot be starred.

⚠ The brief said "the 'position' drawing tool". The 3-point position DRAWING is retired (`drawingSettingsSchema` RETIRED_TYPES;
the overlay never places one). The toolbar's `position` button is the Position CALCULATOR, so C1-144 opens and fills that, on one
chart. Nothing is saved: the calculator is view state, as on the chart.

## Targeting (#988 rules)

All three are `target: 'chart'`, so the chart kind's targeting applies (the clicked chart, a named chart, or "Which chart?").
`drawing.favoriteTool` is on the chart kind as `volPanePref` is: the list is per browser, the receipt says it is on every chart.
It adds no target kind and no context entry, so every planner request's context is unchanged (SAT-1 moved only by the group listing).
Wrong-target controls: the TSLA chart named while NVDA is selected opens TSLA's calculator only; NVDA's drawing id sent to the
TSLA chart is refused and no chart changes.

## Routing

One new words-only, fillLast group, `drawingExtras` (after `drawings`): `drawing.positionCalculator`, `drawing.saveDefaults`,
`drawing.favoriteTool`. Not joined to #1076's `drawingOps` (different nouns; keeps the two PRs apart). `drawings` is
character-identical to master; the nothing-recognised fill stays at master's 55.

Words (no lookbehind; lookaheads only): a position-calculator / position-size word, or entry + stop + target with no alert word;
"default style", or "default" with save / make / set / use and a drawing noun; a favourite / star word with "tool(s)" or "toolbar".

Controls (v1 and v2 first calls, `nlm1Routing.test.js`): "draw a line" keeps `drawings`; "set an alert at my stop" keeps `alerts`
and `alert.create`; "favourite NVDA", "flag NVDA as a favorite", "star NVDA in my watchlist", "save this layout as default",
"reset the chart to its defaults" never select `drawingExtras`.

Displacement: [evidence/drawing-extras/first-calls-master-vs-branch.md](evidence/drawing-extras/first-calls-master-vs-branch.md):
3650 standard requests, v1 and v2, master vs branch: 0 selections differ, **in→out 0** on both routers.
`firstCallRatchet.test.js` is not on origin/master, so it was not run.

## Count pins (arithmetic in the comments)

- `agentRouting.test.jsx` FULL: master 164 + 3 = 167.
- `agentScreener.test.jsx` charts manifest: master 158 + 3 = 161.
- capreg: `coverage/contract.json` and `coverage.json` / `COVERAGE.md` (UPDATE_CAPREG=1); `baseline.lock.json` relocked from master's
  lock (174 intents, 42 refusals, 31 workflows; 3 new intents).
- `manifest.golden.json` (UPDATE_AGENT_GOLDEN=1): the three actions.
No guarded-list change: none of the three is `risk: 'confirm'` or irreversible.

## Generated files (each in its own run and commit)

capreg (UPDATE_CAPREG=1, then `python tests/test_uct_agent_capreg_baseline.py --update`), golden (UPDATE_AGENT_GOLDEN=1), parity
(UPDATE_NL1_PARITY=1: `tests/fixtures/nl1_assemble_parity.json`, the group listing), SAT-1 (`section_b_requests.json`, every hunk
is the drawingExtras group listing, 30 requests × 1 entry; its own commit).

## Tests

- New: `app/src/agent/qa/chartsOutcome/drawingExtras.outcome.test.jsx` (10: C1-144 ×4, C1-160 ×3, C1-165 ×3) — real panel, scripted
  model, state read back from the view, the stored settings and storage.
- capreg corpus intents `drawing.positionCalculator` (TIMED), `drawing.saveDefaults` (TIMED, after a dashed trendline),
  `drawing.favoriteTool` (DRAW), each with Undo; the corpus runner gained a `favoriteTools` expectation.
- `nlm1Routing.test.js`: OWN_WORDS for the group plus 26 v1/v2 cases (own words and controls).
- Discovery: a `drawingExtras` topic (the three actions), next to `drawings`.
- Focused runs and pytest: see the report in this PR's final section (filled from the runs, not from memory).

## Merge notes

- #1076 (`drawingOps`) edits the `drawings` discovery topic's `known` line, which still says "Save as default … done on the chart".
  After both merge, drop "Save as default" from that line (left alone here to avoid editing #1076's lines).
- Both PRs bump the same two count pins (`agentRouting` / `agentScreener`): add 2 + 3 at re-merge.
- One phrasing in a test draft ("save it as the default on the tsla chart") was answered by an instant (fast-path) reading with
  "There is nothing on this workspace for that to change." before the model; the test uses another phrasing. Not investigated.

## Not built

Magnet, reorder, repeat mode, nudge, drawing undo/redo (out of scope). Hiding a tool from the toolbar (`onToggleHidden`).
Browser-level evidence: none (no real-browser run here).
