# ship-1: widget controls by name, Send to Journal, widget items, chart header fields, timeframe next/previous

Local branch, not pushed. Evidence: LOCAL native Windows Node v24, jsdom, BROWSER-MOCK-MODEL / SIMULATED (scripted model). Built by cherry-picking ONLY this slice's commits from agent/pl/exec-gen-1 (doc commits left out); no Multi Chart family code (da498735c3 onward) and no 2c9457ea9b runtime read-back is carried. Left on exec-gen-1 because it needs Multi Chart: 5cad3da0e3 (the receipt note naming a left-out empty Multi Chart cell).

Base: `agent/pl/wrong-chart-fix-otherone` 05dba2dbe2. Depends on: nothing else in this series.
Shared targeting core touched: `host.js` (widget item names for routing), `routing.js`: AUDIT full suite.

## Behaviour changes AUDIT must review

- A widget on THIS board named by its registry label routes `widget.setOption` on the first call, only beside a word of that widget's own controls (corpus side effect 0 of 693, `agentExecSideEffect`). Names compare as words (punctuation, connectors, plurals ignored).
- The control list sent to the model narrows to the named widgets only on a turn routed to them.
- Door rows run over the REAL widgets: Volume Surge list, Breadth readings, Market Map universes and axes, Indexes, UCT Terminal, New Highs/Lows, Theme Tracker period / sort / basis / open theme / set.
- `widget.sendToJournal` over each widget's own capture door; proposed first, nothing sent before Apply.
- Theme Tracker set rename / delete through its own set menu (`ThemeTrackerPage.jsx` door: `renameSet` / `deleteSet`); a delete is proposed first and has no Undo.
- A widget's own item named by its own name routes its control ("rename my Mine theme set", no widget named).
- `chart.setSetting` takes `header.fields` / `header.barInfo` with `+field` / `-field`, written by the product's own writers. Manifest +3 bytes.
- `chart.setTimeframe` takes `next` / `previous`: one rung on the timeframe keys' own order, ends said, never wrapped. Manifest +3 bytes.
- Golden files changed: `contract/manifest.golden.json` and `api/services/uct_agent/scan/sat/section_b_requests.json` (the two entries above). pytest for the v2 cost rail is owed (server input +6 bytes).

## AUDIT round 1 (CHANGES REQUIRED) — fixed

- **S1-A (member data loss):** the Theme Tracker door no longer reconciles the whole set list. Each change is ONE operation
  (`{ op: 'delete' | 'rename', id, name }`) through the set menu's own `deleteSet` / `renameSet`, read back by its own effect
  only; a whole list handed to the door does nothing. The board's freshness fingerprint now covers the door item lists
  (ITEM_LISTS), so an item made, renamed or deleted between plan and commit makes the plan stale. Rails
  (`themeTracker.outcome`, "AUDIT S1"): a set created while a delete card is open survives the Apply; a set created during the
  model call survives a rename; the door ignores the old whole-list form.
- **S1-B:** the card and the receipt name the set the words resolved to ("mine" → "Mine growth"), never the fragment.
- **S1-C:** an item delete offers no Undo (`undoPatch` returns null, the `undoable` contract); a rename is undone by the inverse
  rename of that one set. "undo" after a delete never times out on it.

- **S1-D (CI server rail):** `tests/test_uct_agent_breadth_current.py::test_ENDPOINTS_the_agent_never_calls_them_over_http`
  text-scans every Agent `.js/.jsx` for "breadth-monitor"; ship-1's `widgetDoorRows.outcome.test.jsx` mocks that endpoint for the
  real Breadth widget it mounts. **Choice: AUDIT's option (a)** — the rail skips `*.test.*` files (a test that mocks an endpoint
  is not the Agent calling it), and a new control, `test_ENDPOINTS_the_scan_still_flags_a_non_test_agent_file`, proves the scan
  still flags a non-test Agent file that names it (and skips a test file). pytest NOT run on this PC: CI on the PR head is the proof.

## Full suite

Suite on 122e08a071 (code head; this doc commit adds only this file): shards 2223/2226, 3101/3102, 1974/1975, 1821/1823 = 9119 passed, 1 failed, 6 skipped. The one failure, agentGuidePages "W2-C2 /screener SHOW where do I change the filters", passed 18/18 twice when re-run alone on this head and passes in every later slice: a load flake, not this slice.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
