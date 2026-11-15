# PR: walkthroughs for the chart right-click menu's remaining rows, plus three guide and runner fixes

> Branch `agent/pl/teach-chart-menu`, stacked on #1020 (`agent/pl/chart-menu-add-indicator` `30fd2bea90`), off master
> `96230b5598`. Built by pl-teach. Changes are guide/** and the teach runner only, with no product code.

## Scope
- **New walkthroughs:** `guide/actions.js` `CHART_MENU`. Each one is a right-click followed by the menu's own row
  (`data-menu-id`).
  - `journalChoose`, C1-177 (Send to Journal, choose where). It sits before `journal`.
  - `askAi`, C1-178. It needs a chart, bar, candle, right-click or menu word. The card says it opens AI Research in
    place of the charts page, since it navigates on the member's own click.
  - The location-aware settings row: `candleSettings`, `canvasSettings` and `watermarkSettings`. The candle step says to
    right-click away from the watermark, because on the watermark the row is Watermark settings (finding (b) below).
- **Words fix:** `guide/words.js` `conceptsOf`. "right-click" / "right click" / "right-clicking" / "rightclick" is read
  as a click, not the word "right". Before this, the watermark's Alignment control (any: right) took right-click asks.
  "on the right", "right side", "move the label right", "right edge" and "right-align" stay directional.
- **Ring fix:** `guide/targets.js` `clipOf`/`rectOf`. The ring of a `position: fixed` control is no longer clipped by
  overflow ancestors it shows past, unless an ancestor holds it (transform, filter, perspective, contain, will-change).
  Members saw a ring cut short on a chart-menu row past the cell's edge.
- **Runner (test-only):** `testing/agent/guide/teach.mjs`.
  - A step that names a candle, the watermark or the empty chart tries points down the plot. The watermark's points go
    centre-out; a candle's are the chart's own painted candles first, from the edges inward.
  - When Escape leaves a chart menu open (the desktop menu had no Escape handler: see #chart-menu-escape), the runner
    clicks its backdrop. Before this, every other scan point only closed the last menu.
  - REGIONS is a template string, so a `\b` there was a backspace. Fixed.

## Commits by kind
| kind | commits |
|---|---|
| test first | `30067d743e` (held-out; BEFORE 0/9 asks, 6 controls passed), `2acd4b8d9d` (the right-click word family + M3 controls), `17fcd1df30` (ring-clip rail; BEFORE 1 failed, 3 controls passed) |
| guide fixes | `6575c5475e` (rows + words), `ace70a8e8c` (candle step text + runner backdrop/columns), `99f4da0cd2` (ring clip) |
| runner | `f1ab045af7`, `b2a58f0cd7`, `64d00b1e0d`, `c645113712` (and the runner half of `ace70a8e8c`) |
| raw evidence | held-out attempts 1-9, `candle-diag` attempt-1 (`4c2a87e3d5`), `edge-diag` attempt-1 (`2895648104`), full inventory attempts 1-2 |

## Evidence
| what | label | result |
|---|---|---|
| Held-out (jsdom) | LOCAL | 19/19: 9 asks, the right-click word family, M3 controls and the other rows unchanged |
| Mutations | LOCAL | All killed: row removed (3), order swapped (2), no chart-word lookahead (2), words fix reverted (2), over-broad "right" strip (1), click dropped (1), candle row on canvas (1), ring: no hold check (1), no fixed tracking (1) |
| Guide files (jsdom) | LOCAL | `src/agent/agentGuide*` + `src/agent/guide`: 32/32 files, 1091 passed, 8 skipped |
| Held-out in the browser | LOCAL, BROWSER-MOCK-MODEL | **9/9 at one head**: attempt-9 at `99f4da0cd2`, fresh Vite, CPU 77% at start |
| Earlier attempts (kept) | LOCAL, BROWSER-MOCK-MODEL | 1: 7/9 (the `\b` bug). 2: 8/9 (CM-9 hit the 150 s timeout under load). 3: CM-9 solo passes. 4 and 5: CM-7 timed out on the blind candle scan. 6: CM-4 ring read off its row at 100% CPU. 7: CM-4 solo passes. 8: CM-4/6 off the row, CPU 85%, which led to edge-diag and the ring fix. The timeout was never raised. |
| candle-diag attempt-1 | REAL BROWSER (CDP, LOCAL harness) | A candle behind the centred watermark offers Watermark settings. The chart menu did not close on Escape. |
| edge-diag attempt-1 | REAL BROWSER | Past the cell's right edge the fixed menu's last row is visible (elementFromPoint), but the ring stopped at the cell |
| Full inventory attempt-1 (code `ace70a8e8c`) | LOCAL, BROWSER-MOCK-MODEL | 297/319. **0 newly failing** against `runs/2026-11-09.cov5b`, by id. Newly passing: C1-153. The new case C1-123 passes. |
| Full inventory attempt-2 (code `99f4da0cd2`, fresh Vite) | LOCAL, BROWSER-MOCK-MODEL | 297/319, identical to attempt-1 by id. **0 newly failing** against cov5b and against attempt-1. |

Known failures, all failing in cov5b too: C1-045, C1-152, C2-007, C2-070, C2-071, C2-091, C2-092, C2-100, C3-023, C3-058,
C3-120, C3-122, C3-136, C3-146, C3-183, C3-184, C3-198, C3-199, C3-200, C3-203, C3-210 and C3-219. Thirteen of them
(C1-045, C2-007, C2-070, C2-071, C2-091, C2-092, C2-100, C3-122, C3-198, C3-199, C3-200, C3-203, C3-210) pass on
teach-givens (#1024), whose givens and gap fixes are not on this base.

## Findings (recorded in INVENTORY-FINDINGS on teach-keys, `1cf33485dc`)
- (a) The desktop chart right-click menu had no Escape. Fixed separately on `agent/pl/chart-menu-escape`.
- (b) A candle behind the watermark offers Watermark settings, not Candle settings. This is a design question for the
  owner and is unchanged here; the walkthrough teaches it as it is.

## Scoped suite
- Command, from `app/`, under the lock at BelowNormal:
  `python ../tools/agent_suite_lock.py run --who pl-teach -- node node_modules/vitest/vitest.mjs run src/agent src/testing/agent src/pages/charts/widgets src/components/chart/engine/__tests__/stockChartWiring.test.jsx`
- Commit: `a4cb46cb98` (code `99f4da0cd2`).
- Scope: 390 test files (`src/agent`, `src/testing/agent`, `src/pages/charts/widgets` and `stockChartWiring`). `find app/src -name "*.test.*"` finds 4600 in the whole tree, 4 of them `.snap` files.
- Totals: Test Files 385 passed | 5 skipped (390). Tests 10987 passed | 14 skipped (11001).
- **No failing files.**
- Whole tree: at the release boundary, serialized.

## Follow-up
- The overlay branch (`agent/pl/guide-overlay-geometry`, on HOLD) also edits `targets.js`. When this merges, it is
  rebased onto it and its geometry rails gain the fixed-menu case (the ring follows a `position: fixed` menu past the
  cell edge).
