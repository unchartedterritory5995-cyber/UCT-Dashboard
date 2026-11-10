# PR: Escape closes the desktop /charts right-click menu

> Branch `agent/pl/chart-menu-escape`, off master `5fed0561f1`. It is NOT stacked on #1020. Both touch ChartWidget.jsx, on
> different lines: this one adds an effect after `closeCtx` and two imports. Built by pl-teach. The Lead asked for it after
> pl-teach's candle-diag finding (`4c2a87e3d5` on `agent/pl/teach-chart-menu`).

## The defect
- ChartWidget's right-click menu on desktop /charts closed only on a click or right-click of its backdrop. Escape did
  nothing.
- The app-root ChartContextMenu and the screener layout menu both close on Escape. This is a keyboard and
  accessibility gap.

## Scope
- **`app/src/pages/charts/widgets/ChartWidget.jsx`.** While the menu is open, the effect binds the declared
  `charts.ctxMenuClose`. On Escape:
  - with a modal layer above the page, it stands down;
  - otherwise it stops the press, closes the menu (`closeCtx`, unchanged) and focuses the chart (`paneRef.current.focus()`,
    as Reset view does).
- **`app/src/pages/command/shortcutRegistry.js`.**
  - Declares `charts.ctxMenuClose`: Escape, window capture, `inEditable: true`, `repeat: true`. It mirrors
    `screener.gridMenuClose`.
  - Joins `SURFACE_ESCAPES`, whose generated acks (guide, palette, video, tour) describe exactly this behaviour.
  - Three new acknowledged overlaps:
    - archive lightbox and study review: `surface`. ChartWidget mounts only through WidgetHost, so on /charts and the
      screener Charts view, never on those pages.
    - screener layout menu: `layer`. Both can mount on the screener Charts view, but they are never open together. The
      layout menu closes on any press outside it, and the chart menu's backdrop takes the press that would open it.
- Why the registry and not a listener: the key-listener census ratchet holds ChartWidget at 1 raw listener and only
  shrinks.
- Unchanged: every menu row, the backdrop click and right-click, the add-widget picker, and the guide's own Escape. Its
  capture gate already counts an open `[data-guide$="Menu"]` as owning the press.

## Commits by kind
| kind | commits |
|---|---|
| test first | `934b901e79` (rails; BEFORE 3 failed, 2 controls passed) |
| product | `091f6dc540` (the fix), `a5e0e74898` (shorter shipped strings; the reasons moved to comments) |
| raw evidence | `cdc8acd106` (attempt-1), `0fb8325227` (attempt-2) |

## Evidence
| what | label | result | where |
|---|---|---|---|
| Rails (jsdom) | LOCAL | 5/5. Escape closes the menu and focus lands on the chart's region. The press is the menu's: a later window listener never hears it, and does once the menu is closed. A modal layer keeps the menu open and the press goes on. It works from the add-widget picker, and other keys do nothing. The backdrop still closes it. | `ChartWidget.menuEscape.test.jsx` |
| Mutations | LOCAL | 3/3 killed: no stopPropagation, no modal check, no focus return (each fails 1) | commit `091f6dc540` |
| Real browser, attempt-1 | REAL BROWSER (CDP key and mouse input, LOCAL harness, synthetic bars) | A real Escape closes the menu, twice in a row. The backdrop click still closes it. 0 console errors. Focus was already on the chart (the right-click focuses it), so this run cannot show focus returning. | `evidence/chart-menu-escape/attempt-1.results.json`, `probe.mjs` |
| Real browser, attempt-2 | REAL BROWSER | Adds the return. With focus moved off the chart while the menu is open (`document.body`), Escape closes the menu and focus is the chart's region ("SPY daily price chart", tabIndex 0). 0 console errors. | `attempt-2.results.json` |
| `src/pages/command` | LOCAL | 3 reds, all master's. `keyListenerCensus` ×2 (136 vs 111) gives the identical result on a master-equivalent worktree, where ChartWidget stays at literal 1. `shortcutRegistry` DrillPlayer ×1. | |

## Notebook first-open bytes
- 2,256,434 B on this branch against 2,256,278 B on master `5fed0561f1`: **+156 B**, PASS against the budget of
  2,260,793 B. **Accepted by the Lead**: the gate is the budget, not a zero delta.
- Why it grows: the registry module is in the Notebook's entry chunk, and a declaration's `why` and each acknowledgement's
  `why` ship with it. The first build was +213 B. The shipped strings were then cut to one line each, and the reasons
  moved to source comments, which are stripped. What remains is the declaration object, the ids and the short texts.
- Command: `python tools/notebook_perf_budgets.py --dist app/dist` after `vite build`, at each commit, in the same
  worktree.

## Scoped suite
- Command, from `app/`, under the lock at BelowNormal:
  `python ../tools/agent_suite_lock.py run --who pl-teach -- node node_modules/vitest/vitest.mjs run src/pages/charts src/pages/command src/agent src/components/chart`
- Run at `a5e0e74898`, while a 319-case browser run was also going on the machine:
  - Scope: `src/pages/charts`, `src/pages/command`, `src/agent` and `src/components/chart`: 1940 test files. `find app/src -name "*.test.*"` finds 4587 in the whole tree, 4 of them `.snap` files.
  - Totals: Test Files 10 failed | 1897 passed | 33 skipped (1940). Tests 13 failed | 37578 passed | 186 skipped | 24 todo (37801).
- The 10 failing files:
  - **6 on master's dfc645ccb3 red list:** `symbolFoldParity`, `targetScriptReport.measure`, `hostParity.v8.rail`, `useServerColumns`, `keyListenerCensus` and `shortcutRegistry`. The last two are the DrillPlayer and census reds named above, the same as on master.
  - **4 not on that list, all load-sensitive:**
    - `agentBreadthSelection` (1 of 20 tests);
    - `TradeExchangeNewsWidget.saved` (1 of 12, "keeps the feed exactly as left");
    - `pineStrictCensus` (1 test, 41.5 s);
    - `vendorHarness.h1Ratchet` (1 of 10, 42.8 s).
  - Re-run alone in the same worktree, those four pass at this head (4 files, 43/43) and at master `5fed0561f1` (4 files, 43/43). No failure is this change's.
  - The comparison is by name against master `dfc645ccb3`'s whole-tree list, the newest complete one in the repo, plus the four solo runs at the current master `5fed0561f1`.
- Whole tree: at the release boundary, serialized with the other branches. PASS means its failing names are a subset of
  master's at the same master SHA.
