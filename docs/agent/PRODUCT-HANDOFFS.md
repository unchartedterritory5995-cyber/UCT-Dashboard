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
