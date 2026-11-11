# PR: "Add indicator…" on the desktop /charts right-click menu (C1-123)

> Branch `agent/pl/chart-menu-add-indicator`, off master `96230b5598`. Owner-approved 2026-11-10 (spec §6: right-click
> is the library's third entry point). Built by pl-teach.

## Scope
- **Product (one file):** `app/src/pages/charts/widgets/ChartWidget.jsx`.
  - Before this change, ChartWidget drew its own right-click menu and dropped the `sections` StockChart hands it. So
    StockChart's existing `ind-add` item never showed on desktop /charts. That item is `openIndicatorLibrary`, which
    falls back to settings and is present only with drawing tools, in the open price area.
  - Now `handleBarContextMenu` keeps that item from `p.sections`, and only when it has a handler. One row,
    `data-menu-id="ind-add"`, sits just above Chart settings. It calls the item's own `onSelect`, then closes the menu.
  - There is no new launcher, no new gate and no settings write. The row is absent wherever StockChart omits the item:
    read-only mounts, no drawing tools, and the price or time axis.
- **Teaching:** `app/src/agent/guide/actions.js`.
  - A new `chartMenu` row, `addIndicator`: "Right-click inside the chart, among the candles", then the menu's
    Add indicator… row. The card names Alt+Shift+A as the other way in.
  - `expected.json` C1-123 moves from `chartView` to `chartMenu`. `cases.inventory.json` is regenerated (318 → 319
    cases, +C1-123).
- **Not in scope:** grid cells (GridChartCell has its own menu), the app-root menu (unchanged), and any `data-guide`
  attribute (none added).

## Commits by kind
| kind | commits |
|---|---|
| test first | `56b6c23b2f` (ChartWidget rails), `3555240441` (walkthrough held-out) |
| product | `702a128b42` (the row) |
| teaching | `a704d1a521` (walkthrough, expected.json) |
| raw evidence | `437f8757d1` (probe attempt-1), `08901df3f3` (probe attempt-2), `6c4ce1cddc` (C1-123 in the browser + regenerated cases), `567bf117c7` (held-out asks in the browser) |
| test (mutation follow-up) | `30fd2bea90` (rail on the row's own words) |

## Evidence
| what | label | result | where |
|---|---|---|---|
| ChartWidget rails (jsdom) | LOCAL | BEFORE: 3 failed / 2 passed. AFTER: 5/5, and the B9 pane-menu file still passes (11/11 across both files) | `ChartWidget.addIndicator.test.jsx` |
| Mutations on the row | LOCAL | 4/4 killed: always shown, another handler, no handler check, no close | commit `702a128b42` message |
| Right-click reaches the row | REAL BROWSER (CDP mouse on the LOCAL harness, synthetic bars) | attempt-2: at two price-area points the menu offers `ind-add`, and `document.elementFromPoint` at the row's centre is the row (BUTTON, `ind-add`). The price-axis menu opens without it (the source's gate). A real left click at the centre closes the menu and opens the indicator library. 0 console errors. | `evidence/chart-menu-add-indicator/attempt-2.results.json`, `probe.mjs` |
| attempt-1 (kept) | REAL BROWSER | The menu rows and `elementFromPoint` passed. The click phase threw: the probe did not close each menu between tries, so the reopen found no row. Fixed in the probe, not the product, for attempt-2. | `attempt-1.results.json` |
| Walkthrough held-out (jsdom) | LOCAL | BEFORE 0/5. AFTER 11/11: 5 asks, 2 known misses recorded both ways, 4 controls (plain add, the key, add widget, journal, set alert) and the row-alone rail. Known misses are the ask gate, not this row: a bare phrase and a "can I…" question reach no walkthrough for any feature at master. Their how-do-I forms reach the row. | `agentGuideHeldOutChartMenuAdd.test.js` |
| Walkthrough mutations | LOCAL | 4/4 killed. No Alt+Shift+A: 3 fail. Wrong row: 5 fail. Row removed: 5 fail. A greedy `/add.*indicator/`: 4 fail after `30fd2bea90`. Before that rail it survived, because indicatorManage precedes chartMenu. | commits `a704d1a521`, `30fd2bea90` |
| C1-123 in the browser | LOCAL, BROWSER-MOCK-MODEL | 1/1: both steps ringed on their own controls, 0 console errors | `evidence/chart-menu-add-indicator/teach/C1-123.attempt-1.results.json` |
| Held-out asks in the browser | LOCAL, BROWSER-MOCK-MODEL | 5/5 | `teach/heldout.attempt-1.results.json`, `teach/cases.heldout.json` |

## Notebook first-open bytes
- 2,256,278 B on this branch (85 JS chunks) and 2,256,278 B on master `96230b5598`. **Delta 0 B**, verdict PASS against
  the budget of 2,260,793 B.
- Command: `python tools/notebook_perf_budgets.py --dist app/dist` after `vite build`, for each commit, in the same
  worktree.
- The ChartsWorkspace chunk hash differs between the two builds, so both builds are real. ChartWidget is not in the
  Notebook's first-open closure.

## Scoped suite
- Command, from `app/`, under the lock at BelowNormal:
  `python ../tools/agent_suite_lock.py run --who pl-teach -- node node_modules/vitest/vitest.mjs run src/agent src/pages/charts/widgets src/components/chart/engine/__tests__/stockChartWiring.test.jsx`
- Scope: `src/agent`, `src/pages/charts/widgets` and `stockChartWiring.test.jsx`, which is 387 test files.
  `find app/src -name "*.test.*"` finds 4598 in the whole tree, 4 of them `.snap` files.
- **Run 1, content `567bf117c7`:**
  - Test Files 382 passed | 5 skipped (387). Tests 10962 passed | 14 skipped (10976). No failing files.
  - `30fd2bea90`'s test edit landed on disk mid-run, so it does not match a single commit exactly.
  - At `30fd2bea90`, the 2 changed test files alone: 2 passed, 16/16.
- **Run 2, exactly at `30fd2bea90`** (clean worktree, the same command and scope): Test Files 382 passed | 5 skipped (387). Tests 10962 passed | 14 skipped (10976). **No failing files.**
  - Its totals equal Run 1, so Run 1 had already read the new rail file.
- Whole tree: not run yet. It will be batched with teach-keys at the release boundary (one run per branch,
  serialized). PASS means its failing file names are a subset of master's at the same master SHA.

## Risks
- The menu gains one row in the open price area. Row-order rails in `ChartWidget.addIndicator.test.jsx` pin it as the
  only change. Every other row is identical with and without it.
- A walkthrough ask with menu words now walks to this row. Asks without menu words keep their routes (rails above).
