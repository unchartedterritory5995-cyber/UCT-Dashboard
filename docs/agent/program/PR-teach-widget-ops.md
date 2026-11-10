# PR: walkthroughs for pl-widget's widget ops (#1027) and the Options Flow filters

> Branch `agent/pl/teach-widget-ops`. **Stacked on #1014 (`agent/pl/teach-wl-widget`, 0078b9f401)**, and rebased when
> #1014 merges. Built by pl-teach. It pairs with #1027 (`agent/pl/exec-widget-actions`) and with the owner-approved
> Options Flow filter family.

## Scope
- **What was taught already:** #1014 already teaches the watchlist look and appearance, list rename, column order, export
  and copy. The Scanner's Refresh and a watchlist column's width (`list.colResize`) already ring their controls: both
  passed BEFORE, and no change was made to them.
- **New in `guide/actions.js`:**
  - `psRefresh`: Period Sort's footer Refresh (`aria-label="Refresh"` in a periodsort cell). Period Sort is never in
    Widgets ▾. When none is open, the step rings Tools ▾ and says how to open one. `registry.js periodSort` gets
    `except` for the refresh words.
  - `flaggedRename`: opens Flagged first (‹ Lists, then Flagged), then rings the list menu's Rename. The Rename it rings is
    always Flagged's own, never the Rename of whichever list was open.
  - `flowCalls`, `flowPuts`, `flowSweep`, `flowBlock`, `flowBull`, `flowBear`: the funnel, then the one button that does
    it (`{ within: 'flow.filter.cp', label: 'Calls' }`, and so on). An ask that names both sides ("calls or puts") keeps
    the group's control. `controls.js CONTROL_FEATURE` gets `except: FLOW_ONLY_ASK`, so a one-sided ask reaches the
    button's walkthrough.
- **given.mjs:** a `periodsort` board (a Custom-Period Sort open in a cell) for the Refresh rows.
- **#1014's held-out:** the needle for "how do I rename my flagged list" is now "Renaming the Flagged list". The file
  notes why.
- No product code, no data-guide attribute, and no change to routing.js or useAgent.js.

## Evidence
| what | label | result |
|---|---|---|
| Held-out `agentGuideHeldOutWidgetOps.test.js`, written first (`f105a5c2d5`) | LOCAL, jsdom | BEFORE: 9 failed / 5 passed (14) (`df7c030ffd`). Attempt-1 guide files: 6 failed, kept raw (`97167888e2`). AFTER-2: see below |
| Held-out in the browser, attempt-1 at 5a831e7c22 (fresh Vite) | LOCAL, BROWSER-MOCK-MODEL | **14/14** (`f1c7eddd51`) |
| Guide files `src/agent/agentGuide*` + `src/agent/guide` + `src/testing/agent/guide`, AFTER-2 | LOCAL | PENDING (queued on the suite lock) |
