# Indicators backlog, prioritized (started 2026-11-02)

The single list of Indicators work that is open and not yet scheduled. Update it in place: move an item to
"Done" with its commit or PR when it lands, and add new items rather than starting a second list. Each
item names its evidence; re-read the code before acting on a line number.

**Ranking.** Member impact first, then the risk of the fix, then its size. "Owner" is whose code changes.

## In flight (draft PRs, not merged)

| PR | What | State |
|---|---|---|
| #670 | Full indicator names reach the model; Bollinger Bands by name; no internal column note under a working indicator | Direction approved 11-02; draft until CI and review pass |
| #671 | A saved `fund:` / Market Cap / `econ:` indicator draws right after a reload | Approved in principle. Browser-verified 11-02 (base blank, fix paints). Workstream reviews pending |
| #680 | `/converse` refuses a line rename the member did not ask for | New 11-02; review findings fixed; draft |

## Open, prioritized

| # | Item | Evidence | Size | Owner | Next step |
|---|---|---|---|---|---|
| 1 | **A deleted line's key can be reused, and dependents silently re-attach** (other indicators' sources, info values, re-armed alerts) | `OUTPUT-IDENTITY-PROPOSAL-2026-11-02.md`; `p2x.sourceref.truth.test.js` `it.todo` | M | Indicators (both lanes) | Owner review of option 1 (retire keys per definition) |
| 2 | **Grid-cell and `EtfHoldingsPanel` indicator edits write the global `chart_settings`** | `CHART-SETTINGS-SCOPE-PROPOSAL-2026-11-02.md` | M | chart/workspace, reviewed by Indicators | Owner approval of policy (A) |
| 3 | **The Save receipt covers the legend** and top-left chart objects; a partial receipt stays until it is dismissed | OPEN-FINDINGS-2026-10 §2; `studio/SaveReceipt.jsx` | S | Indicators | Move the card where chart objects are not drawn (bottom-centre above the time axis), with a rail on its rect against the legend's rect in the pane harness |
| 4 | **Credit and auth failures read as `model:transport`**, so monitoring cannot tell an outage from a billing problem | memory `indicator-model-unavailable-gate` | S | Indicators | Split the gate. Needed before `/converse` rollout stage 2 |
| 5 | **Builder-derived names read like formulas in chat** ("EMA 9 > EMA 20") | memory `indicator-formula-derived-names` | S–M | Indicators | Plain-word derived names in `derivedName.js` |
| 6 | **Deleting a line other things use gives no warning** ("this line is used by …") | `OUTPUT-IDENTITY-PROPOSAL-2026-11-02.md` | M | Indicators | Design together with #1 |
| 7 | **`scanKey` moves silently** when the scanned line is deleted | `applyPatch.js` `remove_output` | XS | Indicators | One change entry; the read-back then says so |
| 8 | **Paper (light) theme: low-contrast plain text** in tables, the legend and OHLC labels | OPEN-FINDINGS-2026-10 §9 | S–M | chart-theme | Raise Paper's `textColor` contrast to WCAG AA. Needs the chart-theme owner |
| 9 | **The stored drill-board blob keeps removed instances** (`breadth_drill_board.widgets[1].opts.settings`) | FINDINGS-FOR-OTHER-OWNERS §2 | S–M | chart-settings / Breadth | Harmless to members today. Decide with the scope policy (#2), since both are "which blob is the truth" |
| 10 | **Legend menu keyboard access**: re-verify, likely already closed | Listed on 11-01. ⚠️ Read on 11-02: the legend chip menu renders through `ContextPopover`, whose desktop branch now calls `useFocusTrap` | XS | Indicators | One keyboard check in a browser (Tab stays in the menu, Escape returns focus to the chip). Close it if it passes |
| 11 | **`ChartPane` hosts read the widget blob but write the full blob to global** (TickerPopup, Watchlists page, Theme Tracker, DarkPool, OptionsFlow and others) | `CHART-SETTINGS-SCOPE-PROPOSAL-2026-11-02.md` | S–M | chart/workspace | Track separately from #2 |
| 12 | **`/propose` and the scan concierge still refuse full indicator names** | #670 rail (recorded as a follow-up) | XS code, needs coordination | Screener + Indicators | Assess the effect on screens with the Screener owner first (owner ruling 11-02) |
| 13 | **"Average of RSI" restates the RSI subtree** (no output-reference node) | PLAIN-ENGLISH-AUTHORING-2026-11-01 §3.4 | L, a format change | Indicators | Proposal only; owner review before any work |
| 14 | **Investigate: an AST member definition given a `source` input fetched the data but never painted.** In the #671 browser run, the AST lane appeared to ignore `ctx.source`. It is not yet known whether a member can reach this, or whether only the harness's construction could | #671 browser run, 2026-11-02 (`pr671-browser/evidence.json`, local) | S to investigate | Indicators | Read the AST lane's source handling; decide whether it is a defect |

## Programme items (not defects)

- **The `/converse` staged rollout.** See `CONVERSE-ROLLOUT-PROPOSAL-2026-11-02.md`. It needs owner approval per stage.
- **The live-model end-to-end evaluation.** See `E2E-EVAL-DESIGN-2026-11-02.md`. It needs spend approval and an owner-provided key.
- **IC-1 v1.1 P1/P2.** See `IC-1-V1.1-P1-P2-PLAN-2026-11-02.md`. It waits for #573 to land. P3 is held for the Screener owner, and `isCondition` waits for Sprint 3.

## Done

(none yet)
