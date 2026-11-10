# PR: walkthroughs for the rest of pl-grid's Multi Chart ops

> Branch `agent/pl/teach-grid-ops`. **Stacked on `agent/pl/teach-grid-widget` (26b4424c4e)**, so on #1024 too; it gets
> rebased when those merge. Built by pl-teach. It pairs with pl-grid's `agent/pl/exec-multichart-grid`
> (multiChart.set / multiChart.cell).

## Scope
- These are walkthroughs for the grid ops pl-grid executes that teach-grid-widget left out: Groups mode on and off,
  picking a group, Prev and Next, the also-in switch, refreshing the group, saving, opening and deleting a saved grid, the
  shared settings, and un-maximizing.
- **`guide/actions.js` GRID_ACTIONS:**
  - `groupPrev` (new): "previous group" rings ‹ Prev (`aria-label="Previous group"`), not Next.
  - `groupAlso` (new): rings the group header's also-in chips by their own title (`nameRe: '^Switch to '`). When no chip
    is showing it rings Layouts ▾ and says why.
  - `groupPick` learns load, put, bring up and use. It yields "a stock's group automatically" to Groups mode.
  - `groupRefresh` learns re-rank, reload and update.
  - `gridDelete` learns "get rid of", trash and discard.
  - `cellMax` learns maximizing, restoring and "back on screen".
- **`guide/words.js`:** the scan concept no longer reads "on screen", "off screen" or "full screen" as a screener. The
  un-maximize ask had landed on the Scanner's ‹ back.
- **Product, attribute only (Lead-approved):** `data-guide="multiChart.groupHeader"` on GroupHeatHeader's root, in its
  own commit `4222f8bdef` with `agentGuideGroupHeader.test.jsx`. No other product change. pl-grid doesn't touch that
  file. On a rebase conflict, take both sides.
- **Rails:**
  - `agentGuideTargets` checks a `nameRe` target by its fixed lead in the source (`title={\`Switch to `).
  - The `agentGuideNamed` row "go back to the previous group" now expects `groupPrev`. That is a deliberate change.
- **given.mjs:** the new group rows start from a grid with a group loaded. The also-in row's group has one also-in entry.
- No change to routing.js or useAgent.js.

## Evidence
| what | label | result |
|---|---|---|
| Held-out `agentGuideHeldOutGridOps.test.js`, written first (`20befc964c`) | LOCAL, jsdom | BEFORE: 7 failed / 5 passed (12) (`fc112c05ae`). Attempt-1 guide files: 3 failed, kept raw (`54f591687c`). AFTER-2: see below |
| Held-out in the browser, attempt-1 at a400c2f06b | LOCAL, BROWSER-MOCK-MODEL | 11/12. GO-12 (restore) landed on the Scanner's back. Kept raw. |
| Held-out in the browser, attempt-2 at 0f11836754 (fresh Vite) | LOCAL, BROWSER-MOCK-MODEL | **12/12**. GO-06 rings an also-in chip in the real grid header. |
| Guide files `src/agent/agentGuide*` + `src/agent/guide` + `src/testing/agent/guide`, AFTER-2 | LOCAL | PENDING (queued on the suite lock) |

## Known limits
- "switch back a group in the grid" still rings Next. The `groupPrev` words leave out "back", which `groupExit` and
  `exit` also read. The existing Named rail pins it as `groupStep`.
- Admin and global saved grids (C3-054) stay owner-blocked, as in pl-grid.
