# teach-cov-4: givens batch 2, runner abilities, Chart Settings rows, drawing rows

Base: `agent/pl/teach-cov-3` (cov-4 branch cut at `c674b8348f`; plan at `0463bbe08a`). Local only; pushed by the Lead. Evidence: LOCAL native Windows Node v24, BROWSER-MOCK-MODEL / SIMULATED. Not gate evidence.

**Production: not yet verified.**

Plan: `docs/agent/program/TEACH-COV-4-PLAN.md`. Product (guide) commits and harness commits are separate.

## Product (guide) commits
- **`648c84c2ca`**
  - **Chart Settings rows by their own words**, in any order, and in British spelling ("colour", "grey"). A longer label whose every word is present beats a shorter one ("IPO marker color" over "IPO marker"). Change: `guide/slots.js` `readSetting`.
  - **A circle or an arrow by name.** "Arrow keys" stays the list's keyboard walk.
  - **A drawing's anchors.** "edit anchors" reaches the drawing move row.

## Harness commits (test tooling)
- **`6ab5bea45f`**: a grid chart with settings of its own; a Volume Surge widget on one of the member's own lists.
- **`6ea8c880bd`**: a walkthrough that ends `done` on the member's press of its ringed control counts as a pass. Example: a widget added where the board had room, so the optional Place step never comes.
- **`0c734c40c5`**:
  - C1-076 reassigned by hand to the Restore defaults button (panelAction).
  - The cov-4 known miss is listed in `knownMisses.json`.
- **`39aa6ae2ea`**: cases regenerated, 298 → 304.

## Tried and reverted (not committed)
- **A blocked-alert given (C2-100).** The harness answers an empty catalog, so the popover's `catalogReady` never holds.
- **A "choose X first" select pick (C2-091).** The alert form's indicator list offers only indicators that are on the chart, and MACD isn't.

## Held-out (`agentGuideHeldOutCov4.test.js`, written first: `81f532710c`)
- **Routing:** 6/12 before, 11/12 after, plus **1 KNOWN MISS**. "how do I show the market cap in the info row" reaches the info row's own panel walkthrough, "The header's info row", which is the matrix's assignment for C1-066.

- **Browser, final single run:** 12/12. In the browser, the known-miss case reaches the info row's own walkthrough, which is what its case names.

## Browser single runs per item
- C3-059 and C3-123 pass. C3-122 still shows "You have no lists of your own here yet".
- C3-001 passes.

## Status
One fresh full runner pass (Vite restarted), each case run once:
- **Result:** 278 VERIFIED of 304 cases, up from 270 of 298. Program total: 278 of 499.
- **Gained:**
  - New cases: C1-017, C1-071, C1-076, C1-135, C1-136, C1-155.
  - Previously failing, now passing: C3-001, C3-059, C3-123.
- **One runner exception: C1-163** ("magnet for drawing"). The run recorded `Cannot read properties of null (reading 'x')` before its first step, a harness error rather than a guide failure. It passed in each of two single re-runs. It is still counted as not VERIFIED in this pass's 278.
- **KNOWN MISSES** are listed in `CHARTS_TEACH_STATUS.md`: cov-3 ×3 and cov-4 ×1.

## Items (5)–(7), after the suite above (LOCAL / SIMULATED)
**Held-out `agentGuideHeldOutCov4b.test.js`** (written first, `b9b0fd095d`):
- Routing: 6/9 before, 8/9 after, plus **1 KNOWN MISS**.
- The miss: "get alerted at a fib level" now reaches the price alert. A fib has no Set alert of its own (`drawingSettingsSchema.js`), so that is the truthful walkthrough.

**Product commits**
- **`f7cb3b89c4`: (5) alerts.** "Alerted" and what an alert watches now route: a trendline, or a signal line named before "alert". An alert ask never becomes an indicator-settings walkthrough.
- **`c7211cfdfe`: truthfulness.** A fib's alert is a price alert, never a drawing-menu row the fib lacks, and never fib levels.
- **`8a6f6432a6`: (7) closing a widget tab.** It selects the extra tab first, because its × shows only on the selected one.
- **`62f4ee8d64`: truthfulness. A settings row that shows only in some state says so** when it isn't on the tab. Thin bars shows only while the chart type is Bars or HLC; the old fallback said "scroll down for it".

**Harness commits**
- **`9dc00c9442`**: `knownMisses.json`, with the fib-alert miss.
- **`87deb3ac56`**: a bar chart given for the Thin bars row.

**Browser single runs**
- Pass: C3-019 and H4b-08 (close a widget tab); C1-018 (Thin bars, with the bar-chart given).
- Still failing:
  - **C3-023 / H4b-09** (a chart tab's link dot). The dot shows only on the selected extra tab, and only while that tab is linked. Selecting the tab first wasn't enough on the harness board, so the change was reverted and not committed.
  - **C3-058** (a narrow grid cell): not attempted.
  - **H4b-06** (MACD signal-line alert): needs MACD on the chart.
- **Full runner pass for (5)–(7)** (Vite restarted, each case run once):
  - **Result: 281 VERIFIED of 304 cases**, up from 278 in the pass for items (1)–(4). None lost.
  - Gained: C1-018 (Thin bars), C3-019 (close a widget tab), and C1-163 (passes again; its last failure was a runner exception).
  - **Program total: 281 of 499.**
  - The run file `runs/2026-11-09.cov4.results.json` and `CHARTS_TEACH_STATUS.md` are regenerated.
- **Held-out cov-4b, final browser single run:** 7/9. H4b-06 needs MACD on the chart; H4b-09 is the chart tab dot.
- **Full suite on the head with items (5)–(7) and the price-scale entry:** one locked run at `788ab98573` (`src/agent`, BelowNormal, LOCAL / SIMULATED). Result: `Test Files 1 failed | 275 passed | 5 skipped (281)`, `Tests 1 failed | 9429 passed | 14 skipped (9444)`.
  - The 1 failure is `agentBreadthSelection` F1→F2→F3, a known wall-clock limit (350 ms against 300).
  - That file is not touched by this branch, and it passed 20/20 on its own right after.

## Price-scale reset entry (owner decision; pl-exec offers it)
- **`788ab98573`:** a `chartView` row, `priceScaleReset`, titled "Resetting the price scale". It rings the chart and says "Double-click the price axis to reset it to auto."
- **How pl-exec opens it:** `guide.show { feature: 'chartView', detail: 'reset the price scale' }`.
- **Held-out:** 0/5 before (`5e23b4e398`, written first), 5/5 after.
- **Unchanged:** no new feature id, so no golden change; no inventory row's routing changed.

## Plan vs actual
The plan expected about +31 for items (1)–(4). The actual gain was **+8** VERIFIED: 270 → 278.

| Item | Plan | Actual | Why short |
|---|---|---|---|
| (1) Givens batch 2 | +13 | +2 (C3-059, C3-123) | Of the planned givens, replay, saved indicator, AI Search answer, open note and ETF profile were not built. Each needs app state the harness can't seed through a pref or a fixture route. The two that were tried, a blocked alert and a select pick, didn't work and were reverted. |
| (2) Runner abilities 2 | +4 | +1 (C3-001) | The select pick and the drawing-pixel right-click are not done. |
| (3) Chart Settings rows | about +6 | +3 (C1-017, C1-071, C1-076) | The other rows' inventory words are terse ("background to black", "light chart") or reach a more specific walkthrough first. |
| (4) Drawing menu rows | about +6 | +3 (C1-135, C1-136, C1-155) | Duplicate, Save as default, price label and text style have no assigned walkthrough in expected.json, so they aren't cases. They route to the catalog, which asks. |

Items (5)–(7):

| Item | Plan | Actual | Why short |
|---|---|---|---|
| (5) Alerts | about +5 | 0 VERIFIED | The alert rows route now (held-out routing 8/9 plus 1 KNOWN MISS). The inventory's own alert rows need state the run doesn't seed (an indicator on the chart; a fib can't hold an alert, so C1-117 stays unassigned). |
| (6) Templates and legend | about +7 | 0 | Indicator templates are behind `VITE_INDICATOR_TEMPLATES_ENABLED` (off), so there is nothing truthful to teach. Legend rows were not reached. |
| (7) Guide gaps | +5 | +2 (C1-018, C3-019) | The chart tab dot shows only on a selected, linked extra tab (the attempt was reverted); the narrow-cell case was not attempted. |

Net for cov-4: **+11 VERIFIED** (270 → 281) against the plan's +47 for items (1)–(7). The plan was too optimistic about seeding state and about the inventory's terse words. Several gains were truthfulness fixes instead (fib alerts, Thin bars, Version history, release switches), which add no VERIFIED rows by design.

## Touches deixis / useAgent / runtime / host
No. Goldens are unchanged.

## Suite
One locked full suite (`src/agent`, BelowNormal, 40-minute limit, LOCAL / SIMULATED) at `821bcc75c1`: `Test Files 274 passed | 5 skipped (279)`, `Tests 9416 passed | 14 skipped (9430)`. No failures. The slot was released.
