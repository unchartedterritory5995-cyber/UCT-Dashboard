# PR: Multi Chart grid walkthroughs for pl-grid's families

> Branch `agent/pl/teach-grid-widget`. **It depends on #1024 (teach-givens)**: it is stacked on it by a merge
> (`241444add8`), and gets rebased when #1024 merges. Built by pl-teach. Changes are guide/** only, plus held-out tests
> and evidence.

## Scope
- These are the walkthroughs for the grid families pl-grid executes: maximize or restore a cell, reset a cell to my
  chart, the grid's size, crosshair and time-range sync, and leaving the grid.
- **The main gap:** "grid" in "grid chart", "in the grid" or "my grid" was read as the chart's grid LINES.
- **`guide/actions.js` GRID_ACTIONS:**
  - `cellMax` learns "fill the whole grid", "normal size" and "un-maximize".
  - `cellReset` learns "custom look", "my own chart settings" and "use my chart". `cellSettings` yields those words
    to it.
  - `exit` learns "back from the grid to my normal board".
- **`guide/slots.js` GRID_PRESETS and `guide/registry.js` multiChart:** "N by M", spelled out or in digits
  ("four by four").
- No product code, no new data-guide attribute, and no change to routing.js or useAgent.js.
- **A `gridOpen` given was not added.** given.mjs already seeds `multichart_state` by rule for every gridAction case.
  Its rail was written first (`6d9a179904`) and then reverted (`055776ff78`).

## Evidence
| what | label | result |
|---|---|---|
| Held-out (`agentGuideHeldOutGridFamily.test.js`, written first) | LOCAL | BEFORE on master code: 6 failed / 5 passed (11). AFTER: 11/11, plus 5 controls (grid lines, the shared settings and a plain reset keep their walkthroughs). Two preset needles were corrected after the first run; the test-design error is recorded in the file. |
| Mutations | LOCAL | 7/7 killed: preset by-words, multiChart by-word, cellSettings lookahead, exit words, cellMax words (2 fail), cellReset words. A first grid-lines guard was removed as dead code (its mutant survived). |
| Guide files `src/agent/agentGuide*` + `src/agent/guide` at `67cd0524c5` | LOCAL | 30/30 files, 1073 passed, 8 skipped |
| Held-out in the browser, attempt-1 at `055776ff78` | LOCAL, BROWSER-MOCK-MODEL | **11/11** (fresh Vite, CPU 49%) |
| The inventory's grid cases (gridAction, multiChart, Grid lines: 23), attempt-1 | LOCAL, BROWSER-MOCK-MODEL | 22/23. C3-058 is pre-existing; it fails in teach-givens' 318 run too. 0 newly failing. |
| Inventory cases regenerated | LOCAL | 318, none moved |

## Scoped suite
NOT RUN YET.
