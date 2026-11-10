# PR: teach-cov-5, item 1: hand review of the NO ASSIGNED rows

> LOCAL / SIMULATED (BROWSER-MOCK-MODEL). Branch `agent/pl/teach-cov-5`, stacked on `teach-cov-4-wl` `6056e91cd4`.

## What was reviewed
All 87 NO ASSIGNED WALKTHROUGH rows were reviewed (probe of `6056e91cd4`). For each row I checked which walkthrough
its own inventory words reach: the "how do I" + action words, and the "show me how to" + example words. I read that
walkthrough's title and the control its last step rings. A row is assigned only when that last step rings **the
row's own control**. The rule is the same as in the cov-1 to cov-4 hand reviews. A walkthrough for the right task
that rings a different control is not assigned.

## Assigned: 9 rows (harness commit `9368047eb7`; cases 304 → 313)
| Row | Words | Walkthrough reached | Last step |
|---|---|---|---|
| C1-067 Header colours | how do I header colours | Changing Header colors | Chart Settings → Header → Title color |
| C1-173 Cycle grid layout | show me how to 2x2 grid | Setting up a 2×2 chart grid | the grid control |
| C2-011 Enable classic overlay average | show me how to turn on moving average 3 | Adding MA | the indicator list row |
| C2-017 Remove an unavailable indicator | how do I remove an unavailable indicator | Removing an indicator | chip menu → Remove |
| C3-007 Change a tool panel's colour group | how do I change a tool panel's colour group | Linking charts and widgets | `widget.link` |
| C3-009 Drag or resize a floating widget | how do I drag or resize a floating widget | Resizing a chart or widget | `widget.resize.se` |
| C3-011 Move a floating widget into tabs | how do I move a floating widget into another widget's tabs | Moving a chart or widget | `widget.headerBar` |
| C3-015 Close a popped widget | how do I close a popped widget | Widget controls: Close | `widget.close` |
| C3-175 Edit a theme set | how do I edit a set (add, hide, reset, custom theme) | Theme presets | `themes.sets` |

## Not assigned: right task, a different control (inputs for item 3: routing, held-out first)
- **C1-012, C1-014, C1-021:** the right-click and price-axis menu routes. The walkthroughs ring the toolbar menu,
  Settings → Type and the session toggle instead.
- **C1-053 Magnet crosshair:** the walkthrough rings the Crosshair section, and the setting's own control is on the
  price-axis menu.
- **C1-046, C3-211:** replay play/step/scrub and pick-the-cutoff. Both end on Start replay.
- **C2-028:** Cancel in settings. The walkthrough reaches Undo history.
- **C2-040:** series order within a pane. The walkthrough reaches pane order.
- **C2-045:** Edit formula from the legend. The walkthrough reaches the builder's formula box.
- **C2-094, C2-095, C1-117, C1-118:** these alert options all end on the generic alert button or form.
- **C2-051 to C2-054, C2-075, C3-032, C3-036, C3-071:** these are indicator, list and admin templates. All of them
  reach *chart* templates.
- **C3-080, C3-102, C3-126:** bulk remove-starred, attention facts and the Volume Surge rows. They reach the
  single-row watchlist actions.
- **C3-142, C3-195, C3-207:** a headline note, Market Map zoom and Period Sort dock. They reach another widget's
  control.

## Not assigned: the walkthrough reached is wrong, or nothing the row names is rung
The remaining rows reach the generic catalog ("Finding a control" / "Finding chart settings"), or a walkthrough
for another subject:
- sharing a chart, for the indicator share, install and screenshot rows;
- changing the symbol, for tags, peers and review stepping;
- Using watchlists, which rings no list;
- applying a chart theme, for the Themes-widget and widget-theme rows.

The Watchlists-page rows (C3-073, C3-092 to C3-096, C3-066, C3-091) wait on the page decision. See
`PR-watchlists-page-host.md`: `/watchlists` redirects to Charts on master.

## Results (BROWSER-MOCK-MODEL / LOCAL / SIMULATED)
- **The baseline, cov-4-wl `6056e91cd4`:** one fresh full runner pass (Vite restarted, cases regenerated, identical to
  the committed 304).
  - **281 VERIFIED of 304.** It fails the same 23 cases as the cov-4 pass, so nothing was lost by the stack join.
  - Run record: `runs/2026-11-09.cov5.results.json`.
  - How the pass ran: one pass. The committed cases file changed during the run when this branch's commit landed,
    and each child process re-reads the cases file by index. So I judged each record by the case its child actually
    ran.
  - That left 295 of the 304 covered, and 9 (C3-200 to C3-219) were re-run separately on the same server (5 pass).
  - The 8 new cov-5 cases that ran inside the pass, plus C1-067 run alone, are counted below.
- **This branch:** **9 of 9 new cases VERIFIED**, giving **290 VERIFIED of 313 cases**, or 290 of 499 rows.
  - NO ASSIGNED WALKTHROUGH drops from 87 to 78. No other bucket moves.
  - Expected +8, got +9.
- `CHARTS_TEACH_STATUS.md` was regenerated from that run and `cov5-probe`.
- No product or guide code changed, so no suite run or byte measurement is owed for this item.

## Item 3: Chart Settings and drawing-menu routing (LOCAL / SIMULATED)
- **Held-out first:** `agentGuideHeldOutCov5.test.js` (`44b4e20073`), 18 phrasings of its own, written before any
  routing change. **15 of 18 reach what they named.** The 3 KNOWN MISSES are recorded both ways (test file and
  `knownMisses.json`):
  - "a solid colour behind the candles": no word of the background's own;
  - the magnet crosshair, twice. Its only toggles are StockChart's region menu and ChartToolbar's panel, and a desktop
    `/charts` right-click opens neither (the workspace chart menu has no such row). The row I first added for it was
    removed, because no walkthrough can ring it there yet.
- **Product guide change** (`a9fffcfbf8`):
  - `controls.js` "The chart's background": Canvas → Background. It does not fire for gradient, swing labels,
    text/notes, fonts, logos, widgets, watchlists, signals, palette or intensity.
  - `actions.js` chartView "Light or dark chart": Shift+T. It never fires for a UCT chart theme.
  - Drawing menu: "copy that line" is Duplicate (a drawing has no clipboard copy).
  - "show the price on my line" is Show price label.
  - A control that only the Text Note has takes "the note" as its drawing.
- **Hand assignments** (`c47b1d0001`):
  - C1-049 → The chart's background (was the matrix's chartSetting);
  - C1-078 → Light or dark chart;
  - C1-150 → Bold;
  - C1-154 → Show price label;
  - C1-157 → Duplicate.
  - Cases 313 → 318.
- **Browser:** the 5 new cases, run once: 5/5.
- **Fresh full runner pass at `c47b1d0001`** (Vite fresh, frozen cases file, each case run once):
  **295 VERIFIED of 318 cases**, or 295 of 499 rows.
  - The same 23 fail as before. None lost.
  - Run record: `runs/2026-11-09.cov5b.results.json`. Status regenerated.
- **Locked full suite at `c47b1d0001`** (`src/agent` + `src/pages/command`, BelowNormal):
  - `Test Files 2 failed | 307 passed | 5 skipped (314)`;
  - `Tests 3 failed | 9832 passed | 14 skipped (9849)`.
  - The 3 failures are `src/pages/command` keyListenerCensus ×2 and shortcutRegistry DrillPlayer ×1. They are the
    same 3 the joined cov-4-wl baseline suite fails, and this slice touches neither file.
  - `src/agent` is all green.
- **Notebook bytes:** cov-4-wl `6056e91cd4` 2,261,090 B → `c47b1d0001` 2,261,090 B. **Delta 0.**
  - This lineage's own merge-base budget check was already +297 B over before this slice, because the lineage
    predates master's later budget raise. That is not this item's doing.
