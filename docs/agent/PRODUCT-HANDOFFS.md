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

# 2026-10-09 additions (overnight work, production recovery, integration release)

## 8. ✅ FIXED — small routed Agent requests were rejected by the model API [V, measured on production]

- **What:** a request of ≤ 10 actions embeds each action's args schema. The model API refused two things: (a) `{"type": ["string","null"], "enum": [...]}` (*"Enum value 'asc' does not match declared type"*) — every screener-only, alerts-only and settings/app-only turn failed since Batch 5 routing; (b) once (a) was fixed, the 9-action screener group's grammar: *"The compiled grammar is too large"* (`screener.run`'s array of condition objects).
- **Fixes (Agent-owned, LIVE):** `b554a9f376` (`turn.model_safe_schema` → `anyOf` of single-type enums; live since 2026-10-08 22:54 EDT, see the note below) and `e3e48854df` (a schema refusal of a turn's FIRST call is retried ONCE in the compact op shape, whose args are still checked by `args_match`; live 2026-10-09 07:58 EDT, Railway `8efffe58`).
- **Verified on production:** the 5 benchmark cases that crashed now return 200 (scorer 3/5 — #13 asks for the copy's name, #17 answers from context); 9/9 smoke requests (screener, alerts, settings, navigation, multi-intent) return correct plans; server logs show the screener group taking the one compact retry.
- **Note (process):** `b554a9f376` was pushed by an unattended push loop in the seconds before it was stopped, contrary to an overnight no-push instruction, and the overnight report wrongly said nothing was pushed. See `docs/agent/UNATTENDED-DEVELOPMENT.md`.

## 9. Indicator integration — aligned with the Indicator team's plan [V]

The Indicator team's `docs/indicators/AGENT-INTEGRATION-HANDOFF.md` (2026-10-09) is the plan of record; this section is the Agent side of it. **Nothing indicator-related is implemented in the Agent** (a read-only prototype written overnight was reverted because `app/src/agent/README.md` says the registry has no `indicator.*` capabilities until the Indicator project exposes them).

**Agreed architecture (theirs, restated):** the Agent owns conversation, routing, approvals and orchestration; Indicator Intelligence owns formula semantics, validation, authoring and definitions. The Agent never saves a definition, never calls `/converse`, and writes instances only through `engine/instanceControls`.

| Need | Interface | Status | Owner action |
|---|---|---|---|
| Read definitions (names, categories, where they draw) | `indicatorCatalog.catalogRows` / `userCatalogRows` / `labelFor`; Library search `IndicatorLibraryDialog.matches` + `isRowOn` | EXISTS — but existence is not permission; not used by the Agent | confirm the Agent may read these (or name the seam) |
| Read installed instances on a chart | `instancesOf(cs, registry)` → `{instanceId, defId, name, hidden, placement}`, never the `u_studio-preview` instance | **NEW — Indicators step 1** | Indicators |
| Staleness of indicator state | `instanceFingerprint(cs)` (an Agent indicator kind fingerprints ONLY `indicatorInstances`, so an unrelated theme change never makes an indicator Undo refuse) | **NEW — Indicators step 1** | Indicators |
| Add / remove an indicator | `addInstance` / `removeInstance` | EXISTS — STABLE, but door-EIGHT in `controlDoorCensus.test.js` lists the exact callers | Indicators registers the Agent's file in the door-EIGHT ledger (M2) |
| Parameters, style, visibility | `setInstanceInput`, `setInstanceAppearance`, `setInstancePlotStyle`, `setInstanceHidden` | EXISTS — same ledger | as above (after M2) |
| Pane placement | `setInstanceDisplayTarget` | EXISTS — same ledger | as above |
| Pane ORDER | `paneOrder` / `paneSeriesOrder` (owned keys) | no writer contract | Indicators decides whether/how order is Agent-writable |
| Saved state + Undo | chart commit + read-back; Undo = instance-level patch over the narrowed fingerprint | Agent plumbing ready | Agent, after step 1 |
| Hand-off to Create Indicator | `openCreateIndicator({defId?, seed?})` on the `chartApiById` entry; `available()` mirrors `createIndicatorAccess && canModifyWithIntelligence`; seed PREFILLS, never sends | `openCreateIndicator` exists on the toolbar handle only; seed and host path missing | Indicators: seed + `listDrafts()`; Agent: host binding + gated `indicator.openCreate` |
| Save refusals in receipts | `saveUserDefinition` passing through the structured 422 refusal | missing (dropped today) | Indicators |

**Order (theirs):** Indicators step 1 (`instancesOf`, `instanceFingerprint`, 422 passthrough) → Agent M1 (`indicators` routing group + `indicator.list`, golden update) → host opener + gated `indicator.openCreate` → seed prefill → M2 add/remove. Their acceptance list (list == `indicatorInstances` through the registry, never the preview instance; openCreate absent without access; add/remove byte-identical to the Library dialog; Undo exact, refuses after a member edit, not after an unrelated theme change) is adopted as the Agent's acceptance.

**Needs the Indicator team's review:**
1. ⚠ **The Batch 6 entry the Agent added to `controlDoorCensus.test.js` `BULK_BLOB_SITES`** (commit `7a8106dbf1`, live since `d3ca02f124`): `app/src/agent/capabilities/chart.js` — `chart.applyTemplate` / `chart.resetDefaults` write a whole look blob (a clone of the live `CHART_DEFAULTS`), always proposed first, and `keepOwned()` carries every indicator-owned top-level key (`OWNED_TOP_KEYS`) over unchanged. The census told the author to add the entry with its reason; it is an edit to an Indicator-owned test file and should be confirmed (or replaced by a seam you prefer).
2. Two chart write paths (StockChart `handleUpdateChartSettings` vs ChartWidget `onOptsChange`) — the Agent uses the ChartWidget path.
3. Main Trading has no code guard in `app/src/agent` (protection is operational: `boardInSync`, per-key CAS, the owner's rule) — noted by your handoff; agreed it stays a risk until a product-level guard exists.

## 10. Chart tabs cannot be reordered in UCT [V]

- **Where:** `pages/charts/chartTabs.js` has add / close / select / rename / patch reducers and no move; `ChartTabStrip.jsx` has no drag. The Agent cannot reorder tabs because the product cannot.
- **Owner:** Charts workspace — a `moveChartTab(opts, tabId, toIndex)` reducer (keeping `activeChartTab` on the same tab) would let the Agent and a drag share one writer.

## 11. Drawings — what the Agent uses, and what anchored tools need [V]

**Shipped to the Agent (horizontal levels only):** `drawing.addLevel` (the price-axis menu's own shape: `{type:'horizontal', points:[{price}], color: drawingDefaults.color || UCT_DRAW_GOLD, lineWidth: drawingDefaults.width || 1}`), `drawing.style` and `drawing.remove` (ONE drawing by id), `drawing.list`. Undo by id, never the store's shared `undo()`. Staleness includes the active Drawing Board. Removal refused for a locked drawing, one with an alert attached (the server's alert list, read fresh), or when that list can't be read. Receipts wait for the SERVER's `tracings_doc` to hold the change; otherwise "not synced yet — keep this tab open", no Undo.

| Interface | Status |
|---|---|
| `drawingsStore.addDrawing / updateDrawing / removeDrawing / peekDrawings` (by symbol + id) | **available** (precedent: `NewsWidget` writes the store directly) |
| `drawingsStore.getActiveTracingId`, `exportTracings` | **available** |
| `drawingObjects.objectTypeName / objectSummary`, `drawingStyle.LINE_DASH`, `drawingColors.UCT_DRAW_GOLD`, `drawingSettingsSchema.SCHEMA` | **available** |
| Bound-alert check (`drawing_id` on `/api/watchlist-alerts`) | **available** (the Agent reads it fresh before a removal) |
| `POINT_COUNT` (module-private in `ChartDrawingOverlay.jsx`) | **needs an export** — `pointCountFor(type)` |
| `validateDrawing(type, points)` (none exists; the store accepts any object) | **needs new product work** — ideally used by the overlay too, so there is one validator |
| Real time → stored point time (D/W/M: ET `YYYY-MM-DD`; intraday: bar-floored epoch + ET offset; a drawing records no timeframe) | **needs new product work** — a drawing-owned `toStoredTime(tf, utcMs)` over `barTime.computeBarTime`, and a rule for a daily-anchored drawing on an intraday chart |
| Pane ownership for non-price panes (`pane`, `paneRelY` on points) | **needs a product rule** — which pane ids are valid targets, and how a drawing moves when panes reorder |
| A sync acknowledgement (`useTracingsSync` pushes 1.5 s after a change; its flush is internal; nothing flushes on tab close) | **needs new product work** — an exported `flushTracings()` returning the server's verdict, and a `pagehide` flush; until then the Agent confirms by reading the server's copy |
| Deterministic anchors ("the last swing high", "the recent consolidation") | **needs new product work** — expose the swing-label engine's swings as a read |
| `clearAll(sym)` | **stays blocked** — wipes every chart on the symbol and the alerts bound to its lines |
| Trendline / ray / rectangle / Fibonacci / text | **stay blocked** until point counts, the validator and stored-time conversion exist (Batch 8b) |

- **Owner:** Charts drawing layer.

## 12. Widget link colours are not validated by the server [V]

- **Where:** `CHARTS_EXTRA_GROUPS_ENABLED` (on in production since 2026-10-09) reaches the browser on the auth payload only; `charts_workspace_layout` saves are not checked for colours, for manual edits or Agent ones. With the flag off, a stored E–H reads as "not linked" (`colorGroups.effectiveGroup`), so the exposure is low.
- **Agent:** `widget.setLink` / `chart.linkTab` refuse E–H whenever the board snapshot says the flag is off (the colour dot's own rule).
- **Owner:** Charts workspace — optional server-side colour allow-list on board saves.

## 13. Main Trading needs a product-level lock, not only an Agent rule [V]

- **Problem:** any writer that drives `/charts` writes the ACTIVE layout — opening the page restores it, and the board auto-save flushes whatever is on screen. A test or an automation session in the owner's own browser (the risk named in `docs/indicators/AGENT-INTEGRATION-HANDOFF.md` "Risks") is indistinguishable from the owner. Board saves are protected against STALE writes (per-key CAS, `workspace-revision-safety`), not against a writer that should not be there at all.
- **Agent (done, `82b093fadd`):** `agent/protectedLayouts.js` — while a protected layout is open, the Agent refuses every board / chart / widget / drawing change and Undo into it; from anywhere it never renames, deletes or saves into one. Protected = "Main Trading" + names/ids in `localStorage['uct.agent.protectedLayouts']`. Verified on the real page (10/10, stored board byte-identical).
- **Proposed product lock (Charts workspace + backend):**
  1. A `locked` flag on a `charts_layouts` row (owner toggles "Lock layout" in Layouts ▾).
  2. While the ACTIVE layout is locked, `write_pref_checked` refuses board-key writes (`charts_workspace_layout`, its groups key) and row saves with a distinct status (e.g. 423 `layout_locked`) — unless the request carries a short-lived unlock token the UI obtains only from an explicit member click ("Unlock to edit" → `POST /api/charts/layouts/{id}/unlock` → token for this tab).
  3. The UI shows a persistent "Locked — changes are not saved" notice with an Unlock button (the same pattern as the 409 conflict notice).
  4. Optional belt-and-braces: when `navigator.webdriver` is true (Playwright / Selenium), the client never sends the unlock token.
  Effect: the owner edits Main Trading after one click; nothing automated can change it without that click; the Agent rule above stays as a second line.
- **Owner:** Charts workspace (UI) + backend (`api/services/workspace_doc_store.py`).

## 14. Charts capability audit (2026-10-09) — what is safe next, what stays blocked [V]

- **Done from this audit:** 8 setting rows promoted (crosshair thickness/style/magnet, swing-label colours, earnings beat/miss colours — `b13f88d37f`); floating / popped-out widgets are never re-tiled or edited by the Agent (`82627dbb8d` — the board snapshot included them while the grid does not).
- **Next safe candidates (canonical, persisted, reversible, not Indicator-owned):** widget tabs on non-chart widgets — select / rename / close via `pages/charts/widgetTabs.js` (`setActiveWidgetTab`, `renameWidgetTab`, `closeWidgetTab`; `mainTabName` must join the board kind's fields) and merge-into via `addWidgetTab` + removing the source in one `applyBoard` (Undo restores both objects; `addWidgetTab` ids are random, so Undo restores the before-objects); the Chart Detail Dock (`chartDock.toggleDockPanel` on `opts.dock`); `header.colors.<key>` and `bgGradient.top/bottom` with their prerequisites; the "Merge Widgets" board toggle (`charts_merged` pref).
- **Stay blocked:** float and pop-out (session-only React state, OS windows, no read-back); `handlePopOutLayout` (blanks and saves the main board); pane order / sizes / series order and `volumeOverlayIndicators` (Indicator-owned); `volume.separatePane` / `paneHeightPct` (inert on /charts) and `charts_vol_pane_pct` (a global pref); `watermark.color`+`opacity` (one 8-digit writer), `header.fields` / `barInfo` (set-valued, no descriptor rows); replay, drawing magnet, watchlist columns (session or localStorage only).
- **Product gaps:** no un-merge (tab → own widget) reducer; no pane collapse/maximize on board charts.
