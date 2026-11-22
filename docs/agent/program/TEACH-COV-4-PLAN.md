# TEACH-COV-4 plan: the 28 cases cov-3 did not verify, the biggest uncovered families, and a ranked cov-4

> **BROWSER-MOCK-MODEL / SIMULATED.** Counts are from the local agent harness with a scripted model (LOCAL native Windows Node v24, headless Chrome). They are not production evidence and not gate evidence.

Where the program stands (teach-cov-3 @ `c674b8348f`, `runs/2026-11-09.cov3.results.json`):
- **Browser runner:** 270 VERIFIED of 298 cases.
- **Inventory:** 270 VERIFIED of 499 rows (C1 Charts, C2 Indicators, C3 Workspace).
- **Held-out:** cov-1 27/27, cov-2 26/26, cov-3 18/21 plus 3 KNOWN MISSES.

## 1. The 28 unverified cov-3 cases, by root cause

| Root cause | # | Cases |
|---|---|---|
| A. Harness: missing pre-state (the walkthrough is right; its last step says truthfully that the control needs state the run didn't give) | 13 | C1-045, C3-210 (replay running); C2-007 (a saved indicator); C2-091 (MACD chosen in the alert form); C2-092 (a yes/no-signal indicator in the form); C2-100 (a blocked alert); C3-059 (a cell with its own settings); C3-122, C3-123 (own Volume Surge list); C3-198, C3-199, C3-200 (an AI Search answer); C3-203 (an open note) |
| B. Harness: runner action | 4 | C1-152, C1-153 (right-click on a fib's or measure's own pixels); C3-001 (grade "click any of these" on the press); C3-136 (follow a placed widget to its gear) |
| C. Guide gap (the control isn't addressable the way the walkthrough teaches it) | 6 | C1-018 Thin bars (scroll the settings row into view); C3-019 (select the widget's second tab before its ×); C3-023 (open the chart tab strip before its dot); C3-058 (a narrow grid cell: maximize first); C3-146 TE "Latest" (only while browsing a past day: ring the time control, and say so); C3-219 ETF holdings (needs the symbol's profile to say ETF, so it's also partly A) |
| D. Correctly unavailable (release switch off) | 3 | C3-120 (scan to Journal), C3-183, C3-184 (Indexes). All are truthful "isn't available yet". |
| E. Blocked on another team's anchor | 2 | C2-070, C2-071. They need `data-guide="builder.intent"` from the builder/Pine team. The request is in TEACH-COV-3-PLAN.md. |

## 2. The biggest uncovered families, by member value
These are rows that aren't VERIFIED and aren't in a browser case: NO WALKTHROUGH, NO ASSIGNED WALKTHROUGH, or ASSIGNED / NOT REACHED. Ranked by how often a member does the thing, then by how many rows it covers.

| Family | Uncovered rows | Member value | Root cause, in short |
|---|---|---|---|
| **Watchlist** list management (rename, export CSV/Excel, copy, import, make public, version history, remove starred, colour tags, reorder by hand, column presets) | 29 | High: daily list upkeep | Most rows live in the list's header and right-click menu. **Pick mode hides them in the Charts Watchlist widget** (an owner decision, Watchlists.module.css). They are reachable on the Watchlists page, a different surface. |
| **Chart Settings** rows (solid background, magnet crosshair, info-row fields, header colours, earnings/IPO colours, restore defaults, custom colours, light/dark) | 8 | High: the look of every chart | Mostly routing. Bare words ("solid background", "restore defaults") need the chart-setting reader to take them. |
| **Drawings** (ray, circle/arrow without a placing verb, text font, price label, duplicate, save as default, reorder front/back, edit anchors) | 9 | High | Routing for the drawing menu rows. "Ray" has no tool of its own (the nearest is the horizontal ray). Front/back has no control in the product. |
| **Indicator templates** (save, apply, delete, list) | 4 (+1 chart look) | Medium-high | The words reach Chart templates. Indicator templates need their own reading. |
| **Legend** menu (Modify with UCT Intelligence, Edit formula, accuracy upgrade, report mismatch) | 5 | Medium | Routing, plus legend-chip rows by their menu names. |
| **Alerts** (price alert at the cursor, a fib-level alert, position alerts, limit to this chart, override inputs, click an alert to load it) | 6 | High | Routing, and alert-form rows by their labels. |
| **Builder / Saved definitions** (open saved to edit, delete, share link, publish, install, restore version) | 7 + 6 | Medium | Routing. The "Saved" rows sit in the indicator library. |
| **Breadth, Market Map, NH/NL, Calendar, Options Flow** widget controls | 4 + 4 + 3 + 4 + 3 | Medium | Routing by what the control does, as cov-3 did for Themes. Breadth readings and drill-down need givens. |
| **Keyboard** chords and **Popout** | 5 + 3 | Medium | Mostly "teach the key": a card that names a chord is now pressable by the runner. |

## 3. teach-cov-4, ranked, with expected gains
Same method: held-out phrasings first; guide and harness commits kept apart; a browser single run, then a full runner pass and a suite.

| # | Work | Kind | Expected gain |
|---|---|---|---|
| 1 | **Givens batch 2 (A):** replay running (the app's own `chart.replay` with a scripted plan), a saved indicator, MACD and a signal indicator in the alert form, a blocked alert, a cell with its own settings, own Volume Surge list, an AI Search answer (scripted), an open note, an ETF profile | harness | **+13** cases (C2-091 and C2-092 need the select pick in item 2) |
| 2 | **Runner abilities 2 (B):** pick a named option in a select; right-click on a drawing's own pixels (fib levels, measure label); grade a "click any of these" step on the press; follow a placed widget | harness | **+4** (+2 with item 1) |
| 3 | **Chart Settings rows by their own names**: the settings table's row labels read as their own words | guide (routing) | about **+6** rows (C1-049, -053, -066, -067, -071, -076) |
| 4 | **Drawing menu rows by name** (text style, price label, duplicate, save as default, edit anchors; arrow/circle without a verb when the words say "on the chart") | guide (routing) | about **+6** rows |
| 5 | **Alert form rows and alerts by gesture** (at the cursor, on a fib level, position alerts, limit to this chart, override inputs, click an alert row) | guide (routing) | about **+5** rows |
| 6 | **Indicator templates and legend menu rows** | guide (routing) | about **+7** rows |
| 7 | **Guide gaps (C):** scroll a settings row into view; select a widget tab before its ×; open a chart's tab strip; maximize a narrow cell first; TE "Latest" via the time control | guide | **+5** |
| 8 | **Watchlist header rows on the Watchlists page** | guide (a page surface, like the Screener) | up to **+15** rows. It needs the page walkthroughs to be judged right for Charts-inventory rows (expected.json review); the owner decides whether a Charts row may be taught on the Watchlists page. |
| 9 | **Two-part titles**: keep a capitalised second title ("…, then Locking a drawing") | guide | clears 1 KNOWN MISS |

**Expected after cov-4:** about 270 + 13 + 6 + 6 + 6 + 5 + 7 + 5 = about **318 VERIFIED of the inventory's 499** (more cases, too, as new rows route), before item 8. With item 8: about 333.

**Stays out by design:**
- D: release switch off. These remain truthful "unavailable".
- E: blocked on another team's anchor.
- Rows whose inventory words stay ambiguous on purpose: "log", "take RSI off", "show that one".
- Product controls that don't exist: drawing front/back, a plain ray.

## Gates
- No lock slot without the Lead's clearance.
- Targeted vitest only, at BelowNormal, with a hard timeout.
- One full suite per reviewable head.
- Every result labelled LOCAL / SIMULATED.
- Held-out misses are named as KNOWN MISSES, never counted as passes.
