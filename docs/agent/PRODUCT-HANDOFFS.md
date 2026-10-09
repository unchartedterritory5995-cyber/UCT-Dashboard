# UCT Agent — product safety handoffs (from the 2026-10-08 Charts audit)

These issues are in **product code outside UCT Agent**. Batch 4 fixed none of them, and none of them is triggered by an Agent operation. Each section gives the evidence, the risk, a suggested owner, and the smallest fix we recommend.

Evidence labels:
- **[V]** — verified by reading the code in this repository.
- **[I]** — inferred, not reproduced.

## 1. Dock "New layout" can overwrite an existing layout [V] — ✅ FIXED in Batch 5 (`b2f7d16762`)

- **Fix:** `pages/charts/dockCreate.js` creates the empty layout first, create-only (a clash → 409 → a notice; nothing changes), then blanks the board and opens the new layout in the same board commit. Regression: `dockCreate.test.js`; verified against the real server in Batch 5 acceptance.

- **Where:** `app/src/pages/charts/ChartsWorkspace.jsx` `handleDockCreate` saves `{ name, layout: { widgets: [] … }, scope: 'user' }` **without `createOnly`**. The server (`api/routers/charts_layouts.py` `save_layout`) then **upserts by name** (`svc.upsert`).
- **Risk:** in the Dock library, a member who types the name of one of their existing layouts under "＋ New layout" replaces that layout with an empty board, with no warning.
- **Agent:** not affected. `layout.create` sends `createOnly: true` and refuses an existing name before writing.
- **Owner:** Charts workspace (Layout Dock).
- **Smallest fix:** pass `createOnly: true` in `handleDockCreate` and surface the server's 409 ("You already have a layout with that name"), as the Agent path already does.

## 2. Moving a widget into tabs loses its settings [V] — ✅ FIXED in Batch 5 (`b2f7d16762`)

- **Fix:** `addWidgetTab` copies the caller's `opts`; regression tests pin both callers' shapes (`widgetTabs.test.js`).

- **Where:** `app/src/pages/charts/widgetTabs.js` `addWidgetTab(widget, { type, color })` always builds the new tab with `opts: {}`. Two callers pass `opts`, and it is dropped:
  - **Float → "Move into another widget's tabs"** (`ChartsWorkspace.jsx` `handleFloatWidgetToTab`) loses the source widget's list and settings.
  - **Period Sort "add as tab"** loses start/end/group, so the tab falls back to its default of the last 30 days.
- **Risk:** silent loss of the widget's configuration. No test covers either path.
- **Owner:** Charts workspace (widget tabs).
- **Smallest fix:** accept `opts` in `addWidgetTab` (`opts = {}` default), then add one test per caller.

## 3. Pop Out Layout may lose widgets after an interruption [I — unverified]

- **Where:** `handlePopOutLayout` saves the main board **without** the popped widgets. The ids of popped and floating widgets live only in React state.
- **Risk:** if the tab is closed or crashes before the member re-docks, those widgets are missing from `charts_workspace_layout`. **This has not been reproduced.**
- **Owner:** Charts workspace (pop-out).
- **Suggested next step:** reproduce it (pop out, close the main tab, reload). If it is real, persist the popped ids alongside the board, or save the full board and hide popped widgets at render time.

## 4. Price alerts have no independent background monitor [V]

- **Where:** `api/services/watchlist_alert_service.py` `run_alert_check` runs only from the `/api/live-prices` request path, and only for the symbols in that request.
- **Risk:** an alert on a symbol that nobody is currently polling never fires.
- **Agent:** `alert.create` writes correctly. Its capability answer now says that UCT checks price alerts as live prices are fetched and that there is no separate background monitor yet.
- **Owner:** Alerts / backend.
- **Smallest fix:** a scheduled evaluator over all armed price alerts, like the indicator-alert evaluator (`indicator_alert_evaluator.start_evaluator(interval_sec=60)`).

## 5. Watchlist digest emails have no unsubscribe link [V — carried from Batch 2]

- **Risk:** recurring email without a one-click way to stop it. This is a compliance and deliverability concern.
- **Agent:** turning the digest on is always proposed first, and the receipt now says how to reverse it ("No Undo for this — ask me to change the digest again, or use Settings → Email Digest").
- **Owner:** Watchlists / email.
- **Smallest fix:** a signed unsubscribe link in the digest template, mapped to `frequency: off`.

## 6. Saved-screen revision protection is missing [V]

- **Where:** `screener_saved_screens` has no revision column. `PUT /api/screener/saved-screens/{id}` is last-write-wins. History exists only when `ARTIFACT_VERSIONS_ENABLED` is on.
- **Agent:** does not offer overwrite. Save as, copy, rename and delete re-read the list immediately before writing, and refuse on any mismatch.
- **Owner:** Screener.
- **Smallest fix:** add a `revision` column and require it on PUT (409 when stale), as the workspace documents already do.

## 7. Watchlist save-as is behind a disabled flag [V]

- **Where:** `POST /api/watchlists/{id}/save-as` returns 404 unless `WATCHLIST_COPY_OR_LINK_ENABLED` is set.
- **Agent:** copies a list by creating a new one and adding the symbols, which works today.
- **Owner:** Watchlists, plus an owner decision on the flag.

---

# Overnight 2026-10-08/09 additions

## 8. ⛔ LIVE DEFECT — small routed Agent requests are rejected by the model API [V, measured on production]

- **Where:** `api/services/uct_agent/turn.py` `envelope_schema`. A request with ≤ 10 actions (`STRICT_OP_VARIANTS_MAX`) embeds each action's args schema. Nullable enums (`{"type": ["string","null"], "enum": [...]}` — `screener.run.sort_dir`, `alert.list.status`, `settings.setAlertSound.sound`, `app.open.section`) are refused: *"output_config.format.schema: Invalid schema: Enum value 'asc' does not match declared type"* (Railway web logs, request ids `req_011CfqsmnamjSB2Ba7SNqi7d`, `req_011CfqsozrkW6U7mtMqA4vGY`).
- **Impact:** since Batch 5 routing (`e4c3466e38`), every screener-only, alerts-only and settings/app-only Agent turn fails with "UCT Agent is unavailable right now (BadRequestError)". Admin-only (the Agent is dark). Found by the Batch 6 real-model benchmark: 5 of 57 routed cases.
- **Fix (Agent-owned, NOT deployed):** local commit `b554a9f376` on `fix/uct-agent-nullable-enum` (also carried by `feat/uct-agent-overnight-1009`): `model_safe_schema()` rewrites each such node as `anyOf` of single-type enums with the same values; the model's answer is still validated against the capability's own args. Rail: `test_no_routed_request_sends_an_enum_under_a_union_type`.
- **Owner action:** release the fix (guard → gate → promote), then re-run the routed benchmark half to confirm the 5 cases.

## 9. Indicator writes by UCT Agent need the Indicator project to register the Agent [V]

- **Where:** `app/src/components/chart/engine/__tests__/controlDoorCensus.test.js` "door EIGHT" declares the exact files allowed to call `addInstance` / `removeInstance` / `setInstanceInput` / `setInstanceHidden` (compared by equality); `app/src/agent/README.md` (and `docs/indicators/INTEGRATION-READINESS.md`): *"this registry has no `indicator.*` or pane capabilities until that project exposes them."*
- **Agent:** Batch 7 implements NOTHING that touches indicators (a read-only prototype was written, then reverted the same night because the README agreement covers reads too). The design below is ready.
- **What the Agent would use (all existing, all Indicator-owned):**
  - read "what is on this chart": `indicatorRegistry.listAllIndicators(cs, nativeRegistry)` filtered by `readEnabled` — exactly the Chart Settings ▸ Indicators tab;
  - search the library: `BUILT_IN_ROWS` + `catalogRows` + `userCatalogRows` (minus `hiddenLibraryIds`, through `libraryRowFor`) filtered by `IndicatorLibraryDialog.matches`, "on this chart" = `isRowOn` — exactly the Library dialog (a `libraryRows(settings, registry)` export would remove the 3-line composition the Agent would otherwise repeat);
  - writes: `addInstance`, `setInstanceInput`, `setInstanceAppearance`, `setInstanceDisplayTarget`, `setInstanceHidden`, `removeInstance` inside the Agent's existing chart commit (one settings write, read-back, Undo = previous blob — the same path `chart.setSetting` uses).
- **Asks of the Indicator project:** (a) say yes/no to `indicator.*` capabilities in the Agent registry (read-only first); (b) add `app/src/agent/capabilities/indicators.js` to the door-EIGHT ledger with its reason, or name the seam the Agent should call instead; (c) decide pane ordering ownership (`paneSeriesOrder` / `paneOrder`); (d) a headless authoring seam for Create Indicator (INTEGRATION-READINESS gaps 1–2) — until then the Agent can at most open the Create Indicator panel for the member.
- **Disclosure:** Batch 6 (`7a8106dbf1`, released in `d3ca02f124`) added ONE entry to `controlDoorCensus.test.js` `BULK_BLOB_SITES` (the census's own instruction for a new whole-blob site): the Agent's template / restore-defaults look writes, which carry every indicator-owned key over unchanged (`keepOwned`). Please review that entry.

## 10. Chart tabs cannot be reordered in UCT [V]

- **Where:** `pages/charts/chartTabs.js` has add / close / select / rename / patch reducers and no move; `ChartTabStrip.jsx` has no drag. The Agent cannot reorder tabs because the product cannot.
- **Owner:** Charts workspace — a `moveChartTab(opts, tabId, toIndex)` reducer (keeping `activeChartTab` on the same tab) would let the Agent and a drag share one writer.

## 11. Anchored drawings need the drawing layer's point and time rules exported [V]

- **What the Agent does now (overnight Batch 8, narrow):** horizontal levels only — the price-axis menu's own shape (`{type:'horizontal', points:[{price}]}`, the member's drawing defaults), plus restyle / remove ONE drawing by id and list, all through `drawingsStore` (`addDrawing` / `updateDrawing` / `removeDrawing` / `peekDrawings`). Undo is by id, never `drawingsStore.undo` (that history is shared with the member's own edits). Verified on the real page: the line renders, syncs to `tracings_doc`, Undo removes exactly it.
- **What blocks trendlines, rectangles, Fibonacci, text (Batch 8b):**
  1. `POINT_COUNT` is module-private in `ChartDrawingOverlay.jsx` — please export it (or a `pointCountFor(type)`).
  2. There is no `validateDrawing(type, points)`; the store accepts any object. An exported validator would let every non-overlay writer (`NewsWidget` today, the Agent tomorrow) refuse a malformed drawing instead of storing it.
  3. `point.time` is the chart's DISPLAY time (D/W/M: ET `YYYY-MM-DD`; intraday: epoch seconds floored to the bar + ET offset) and a drawing does not record its timeframe. A drawing-owned `toStoredTime(tf, utcMs)` (over `barTime.computeBarTime`) — and a rule for what a daily-anchored drawing means on an intraday chart — is needed before the Agent places time anchors.
  4. "The last swing high / the recent consolidation" need a deterministic detector the product already trusts (e.g. the swing-label engine) exposed as a read; until then the Agent asks for explicit dates and prices.
- **Not offered on purpose:** "clear all drawings" — `clearAll(sym)` wipes every chart on the symbol and, through `useBoundDrawingAlerts`, the alerts bound to those lines.
- **Owner:** Charts drawing layer.
