---
id: D-11
title: State, persistence, and the existing workspace/widget system
role: State, persistence, and existing workspace/widget system specialist
wave: 1
group: D
category: internal-system
scope: uct-dashboard worktree (app/src + api/) — branch terminal-research @ dcedd9fc8
confidence: 🟢
evidence_ceiling: No production DB or live pod was read; every schema/shape statement is read from source, not from data. Runtime claims (what a real user's blob contains, how large it is, how often writes land) are CLAIM-only.
sources: app/src/hooks/usePreferences.js, api/routers/auth.py, api/services/auth_service.py, api/services/auth_db.py, app/src/pages/charts/ChartsWorkspace.jsx, app/src/pages/charts/grid/useMultiChartState.js, api/services/charts_layout_service.py, api/routers/charts_layouts.py, api/services/user_definitions.py, app/src/components/chart/instanceShape.js, app/src/components/chart/chartDefaults.js, app/src/components/chart/drawingsStore.js, app/src/components/chart/useTracingsSync.js, app/src/hooks/useAppFocus.js, app/src/pages/Calendar.jsx, app/src/pages/calendar/useEarningsModalRoute.js, app/src/lib/chartDeepLink.js, app/src/pages/breadth/useBreadthViews.js
uct_relevance: high
status: draft
date: 2026-09-02
---

# D-11 — State, persistence, and the existing workspace/widget system

**Read this first.** TERMINAL-CURRENT is the surface at route `/calendar` (display-named
"UCT Terminal" since 2026-09-01). It is **not** where the workspace/widget machinery lives.
The system TERMINAL-NEXT would be re-building already exists, and it lives at **`/charts`**
(`app/src/pages/charts/ChartsWorkspace.jsx`, 2,623 lines) plus its multi-chart grid mode.
Anyone reading "workspace" in this program's charter should read `/charts`, not `/calendar`.

**The one-sentence finding.** The app has exactly one general per-user persistence
primitive — an **unversioned, uncapped, undeletable key→TEXT table** (`user_preferences`
in `auth.db`) — and the entire `/charts` workspace is a set of **eight loosely-coupled
keys written non-atomically** on top of it; every hard problem a terminal workspace has
(versioning, instance identity, merge-under-concurrency, tombstoned deletes, cross-device
sync, corrupt-blob recovery) has already been solved **once** somewhere in this repo, but
each solution sits in a different module and none of them is the workspace blob itself.

---

## SECTION 1 — The preference system (Q1)

### 1.1 The API and the storage

**OBSERVATION.** Exactly two HTTP routes serve all per-user preferences, and one table
backs them.

**EVIDENCE.**
- `api/routers/auth.py:1640 get_preferences()` — `GET /api/auth/preferences`, returns a
  flat `{key: value}` dict for the authenticated user.
- `api/routers/auth.py:1645 upsert_preference()` — `POST /api/auth/preferences`, body is
  `SetPreferenceRequest{key: str, value: str}` (`auth.py:1635`).
- **There is no DELETE route.** `delete_user_preference` is imported at
  `api/routers/auth.py:72` and appears **exactly once** in the file — the import line. The
  function exists (`api/services/auth_service.py:1446`) and has no caller anywhere in
  `api/`. CONFIRMED by source count.
- Storage: `api/services/auth_db.py:227`
  ```sql
  CREATE TABLE IF NOT EXISTS user_preferences (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL,
      pref_key TEXT NOT NULL, pref_value TEXT,
      UNIQUE(user_id, pref_key));
  ```
  plus `idx_user_preferences_user` on `user_id` (`auth_db.py:234`).
- CRUD: `auth_service.py:1422 get_user_preferences()` (SELECT all for user),
  `:1434 set_user_preference()` (INSERT … ON CONFLICT DO UPDATE, via
  `execute_with_retry`), `:1446 delete_user_preference()` (unrouted).
- Preferences are ALSO inlined into the session/`/me` payload:
  `api/routers/auth.py:323` selects them and `:362` returns them under `"preferences"`.
- The table lives in `auth.db` — the single-writer SQLite file on the web pod's `/data`
  volume, `busy_timeout` 10s (CLAUDE.md "Performance & Scale", CLAIM).

**INTERPRETATION.** This is a **key/value bag, not a schema**. Values are opaque TEXT;
the server never parses, validates, sizes, or versions them. There is no per-key type, no
migration hook, no delete, and no size cap. It is the correct primitive for a scalar
setting ("theme = oled") and it is being used as the store for structured documents up
to and including a whole 24-column grid workspace.

The repo already says this in its own words, and measured it. `api/services/user_definitions.py`
(the store for user-authored indicator formulas) opens with a section titled
**"WHY NOT `user_preferences` — ALSO MEASURED"**:

> `user_preferences` has NO SIZE LIMIT and NO DELETE ROUTE. A store for content a user
> can author in a loop needs both, and inheriting neither is how a table becomes unbounded
> quietly. This store names its caps (`MAX_DEFINITION_BYTES`, `MAX_DEFINITIONS_PER_USER`)
> and ships a delete.

That module then defines `MAX_DEFINITION_BYTES = 64 * 1024` (`user_definitions.py:172`)
and `MAX_DEFINITIONS_PER_USER = 50` (`:175`). **A team already reached the conclusion
"the preference bag is not a document store" and acted on it — for formulas only.** The
workspace layout never got that treatment.

**RELEVANCE TO UCT.** If TERMINAL-NEXT persists a workspace, `user_preferences` is the
path of least resistance and the wrong one for the same three reasons already written
down in this repo: unbounded size, no delete, no version. Note also that every preference
is returned in **one flat dict on every `usePreferences()` fetch and on `/me`** — so a
large workspace blob is paid for on every page load by every surface, not just the
workspace page.

**CONFIDENCE.** 🟢 for routes/schema/absence-of-delete (all read from source).
🟡 for the size claim: I did not measure a real user's blob (**EVIDENCE CEILING** — reading
`/data/auth.db` is out of scope; a `SELECT length(pref_value)` histogram on a copy would
settle it).

**RECOMMENDATION.** Treat `user_preferences` as the SCALAR-SETTINGS store. Give a
TERMINAL-NEXT workspace its own store, modelled on `charts_layout_service.py` /
`user_definitions.py` (own SQLite file, WAL, `_WRITE_LOCK`, `contextlib.closing`, explicit
caps, an explicit delete). Both precedents are in-repo and one of them exists specifically
because someone hit this wall.

**OPEN QUESTION.** What is the actual p50/p99 byte size of `charts_workspace_layout` and
`chart_settings` in production, and how much of every `/api/auth/preferences` response is
workspace state?

### 1.2 The client hook

**OBSERVATION.** `app/src/hooks/usePreferences.js` is the single client authority. It is
far more sophisticated than the server it talks to.

**EVIDENCE** (all `app/src/hooks/usePreferences.js`):
- SWR over `PREFS_URL = '/api/auth/preferences'`, `dedupingInterval: 300000` (5 min),
  `revalidateOnFocus: false`. So **prefs are effectively read once per page load**; a
  change made in another tab or on another device is not picked up for 5 minutes at best.
- `DEFAULTS = { default_chart_tf: 'D', theme: 'oled' }`, merged **client-side** over the
  server dict. The server knows nothing about defaults.
- `parsePref(raw, fallback)` — exported; every structured key is JSON-in-TEXT and is
  parsed defensively at each read site, falling back silently on malformed input.
- `setPref(key, value)` — optimistic `mutate`, JSON-stringifies non-strings (the server's
  `value: str` would 422 otherwise), reverts by refetch on a thrown fetch.
- `setPrefMerged(key, updater)` — the concurrency-safe writer. The updater runs **inside**
  the SWR cache update so it sees the freshest value; returning `undefined` abandons the
  write; a throwing updater re-throws rather than silently dropping.
- `_writeChains` — a **module-level per-key write queue** (`queueWrite`). The comment
  states the reason explicitly: sixteen grid cells call the hook sixteen times, so a
  per-hook ref would serialise nothing, and two in-flight POSTs for one key can land in
  either order with the server keeping whichever ARRIVES last. The queue stores a
  *neutralised* handle so a failed write cannot wedge the chain.
- `resolveWriteValue` — **only `chart_settings` gets a merge rule.** Every other key,
  including `charts_workspace_layout`, is last-write-wins.

**INTERPRETATION.** The hardest persistence problem in the app — concurrent writers to one
structured blob — has been solved, in one place, for exactly one key. The comment is candid
about the ceiling: *"last-write-wins still governs any scalar both writers name. This is
add-and-delete protection, not a CRDT."*

**RELEVANCE TO UCT.** `setPrefMerged` + `_writeChains` is a working, tested, in-repo
pattern for multi-panel concurrent writes and is the natural seed for a TERMINAL-NEXT
autosave. Its limits are also the shape of what a terminal needs beyond it: no server-side
conflict detection (no `If-Match`/version), no cross-tab awareness, no merge for anything
but `chart_settings`.

**CONFIDENCE.** 🟢 (whole file read).

### 1.3 Persisted preference key inventory

**OBSERVATION.** 30+ distinct pref keys, owned by six surfaces. Derived by grepping
`setPref(`/`setPrefMerged(` and `parsePref(prefs`/`prefs.<key>` across `app/src`
(tests excluded).

| Key | Shape | Owning surface | Written at |
|---|---|---|---|
| `theme` | string (app theme; default `'oled'`) | Settings | `Settings.jsx:2016` |
| `default_chart_tf` | string (`'D'`) | Settings | `Settings.jsx:2004` |
| `alert_sound` | bool/string | Settings | `Settings.jsx:2033` |
| `alert_sound_type` | string | Settings | `Settings.jsx:2049` |
| `watchlist_digest` | string (frequency) | Settings | `Settings.jsx:2114` |
| `tag_labels` | object (7-colour tag names) | `useTagColors.js:27` | hook |
| `chart_settings` | **JSON blob, versioned (`settingsVersion:2`)** | StockChart / Settings / ChartPane / every chart widget | 10+ sites incl. `StockChart.jsx:2569,3571`, `useChartIndicatorBus.js:80` (merged) |
| `chart_saved_colors` | array | `useSavedColors.js:21,25`, `ChartPane.jsx:510,514` | hooks |
| `chart_templates` | array, capped `MAX_TEMPLATES` client-side | `ChartSettingsModal.jsx:26,260` | modal |
| `charts_workspace_layout` | **JSON `{widgets[], cols, layoutTheme?}`** | ChartsWorkspace | `:965,977,1704,1762,1818,1882` |
| `charts_workspace_groups` | `{A,B,C,D}` tickers — **also the app-wide focus** | ChartsWorkspace / `useAppFocus` | `:770,1821,1883` |
| `charts_theme` | string | ChartsWorkspace | `:834` |
| `charts_merged` | bool | ChartsWorkspace | `:677` |
| `charts_active_template` | `{id,name,scope}` | ChartsWorkspace | `:1748,1782,1835,1864` |
| `charts_vol_pane_pct` | number/string | ChartPane / ChartsWorkspace | `ChartPane.jsx:526`, `:1743,1780` |
| `charts_default_chart_widget` | widget id | read by `ownChartSettings.js:87` | forward-wiring |
| `multichart_state` | `{mode,layout,cells[],syncCrosshair,…}` | grid mode | `useMultiChartState.js:59,69` |
| `watchlist_settings` | JSON (widget look) | `watchlistSettings.js:12` | `:1712,1772,1828` |
| `watchlist_templates` | array | `watchlistTemplates.js:13` | watchlist |
| `theme_tracker_settings` | JSON | `themeTrackerSettings.js:13` | `:1713,1773,1829` |
| `fundamentals_settings` | JSON | `fundamentalsSettings.js:13` | `:1714,1774,1830` |
| `breadth_widget_settings` | JSON | `breadthWidgetSettings.js:13` | `:1715,1775,1831` |
| `aisearch_settings` | JSON | `AiSearchWidget.jsx:17` | widget |
| `breadth_views_config` | JSON (presets per view style + compare quad) | `useBreadthViews.js:23` | `:215,240` |
| `volume_scan_lists` | array | `VolumeScanWidget.jsx:182,196` | widget |
| `tracings_doc` | `{updatedAt, doc}` — **LWW-synced document** | `useTracingsSync.js:22` | hook |
| `calendar_view_v3` | string (`board｜table｜month`) | Calendar | `Calendar.jsx:171` |
| `calendar_filters_v2` | JSON | Calendar | `Calendar.jsx:172` |
| `calendar_event_types_v2` | array | Calendar | `Calendar.jsx:191` |
| `calendar_mystocks_sources` | array | Calendar / MyStocksHub | `Calendar.jsx:173`, `MyStocksHub.jsx:352` |
| `calendar_view_v2`, `calendar_filters`, `calendar_density` | **legacy, read-only** | Calendar | never written; read at `Calendar.jsx:144-172` |
| `j2_calendar_pnl_basis` | string | J2 CalendarTab | `CalendarTab.jsx:121` |
| `j2_custom_dashboard` | JSON | J2 MetricsDashboard | `MetricsDashboard.jsx:78` |

`WIDGET_GLOBAL_PREF_KEYS` (`app/src/components/chart/chartThemes.js:456`) is the map from
widget type to its single GLOBAL pref key — `themes→theme_tracker_settings`,
`fundamentals→fundamentals_settings`, `breadth→breadth_widget_settings`,
`aisearch→aisearch_settings`. `ChartsWorkspace.jsx:1330` iterates it. Every other widget
type stores its look **per-instance** in `widget.opts.settings` inside the layout blob
(`_PER_WIDGET_TYPES`, `chartThemes.js:462`).

**INTERPRETATION.** ⛔ **There are two competing widget-appearance models in one board.**
Four widget types are GLOBAL (one blob shared by every instance of that type, on every
layout); the rest are PER-INSTANCE. That is why applying a saved layout has to write five
keys plus a localStorage entry (§2.3) — the "look" of a board is not inside the board.

**RELEVANCE TO UCT.** A terminal workspace should decide this once. Two panels of the same
type on one screen that cannot be styled differently is a real product limit; a shared
blob that changes when you open a saved layout is a real data-loss surprise. The existing
split is the seam a workspace schema has to close.

**CONFIDENCE.** 🟢 for the key list (derived by grep over the source, not typed from memory).
🟡 that it is exhaustive — a key constructed at runtime would not appear (**EVIDENCE
CEILING**: an AST sweep of `setPref` arguments, mirroring `feature_flag_index.py`'s approach,
would make this a measurement instead of a grep).

---

## SECTION 2 — Workspace and layout persistence (Q2)

### 2.1 `charts_workspace_layout` — the real schema

**OBSERVATION.** Project memory's claim is CONFIRMED: `chart_settings` is a seed, and the
live per-widget settings are `charts_workspace_layout → widgets[].opts.settings`.

**EVIDENCE.**
- Blob shape (`ChartsWorkspace.jsx:77`, `:103`, `:297 parseLayout`):
  ```js
  { widgets: [ { id, type, color, x, y, w, h, opts: { tf?, settings?, … } } ],
    cols: 24,
    layoutTheme?: { id, scope: 'charts'|'widgets' } }   // :1286, :1314
  ```
- `id` is minted as **`w-${type}-${Date.now()}`** (`ChartsWorkspace.jsx:1390`), plus
  `w-periodsort-${Date.now()}` (`:1644`). Frozen template ids are literals (`uctd-themes`,
  `w-watchlist`, …).
- Widget defaults/registry: `WIDGET_REGISTRY` in `app/src/widgets/registry.js`, viewed as
  `WIDGET_DEFAULTS` at `ChartsWorkspace.jsx:250`.
- Grid: `GRID_COLS = 24` (`:53`); `COLS` is **the same 24 at every breakpoint** (`:64`) with
  a load-bearing comment — a narrowing ladder made RGL re-map x/w and `handleLayoutChange`
  persisted the squeezed coords over the only saved layout, destroying it permanently.
  `BREAKPOINTS` (`:65`) exist but every one maps to 24 columns.
- `FIXED_ROWS` from `./rowHeight` (`:66`); `clampWidgetsToRows` keeps every widget inside
  the viewport-locked grid because `.workspaceBody` is `overflow:hidden` and an overhang
  simply vanishes.
- Named layouts (server-side): `POST/GET/DELETE /api/charts/layouts`
  (`api/routers/charts_layouts.py`) → `api/services/charts_layout_service.py`, own DB at
  `/data/charts_layouts.db`, `UNIQUE(scope, user_id, name)`, `scope ∈ {global, user}`,
  global = admin-authored prebuilt visible to everyone, `_GLOBAL_UID = 0`.
- Grid-mode named boards ride the SAME table with `layout.kind = 'multichart'` and
  `widgets: []` (CLAIM from CLAUDE.md; the router validates only
  `isinstance(layout.get("widgets"), list)` — `charts_layouts.py:43` — so `widgets: []`
  does pass, CONFIRMED by reading the validator).

**INTERPRETATION.** The blob is a flat widget array with absolute grid coords and no
version field. There is **no `version` or `schemaVersion` key anywhere in the layout blob** —
migrations are inferred from data shape instead (§2.2).

**RELEVANCE TO UCT.** A terminal that wants tabs, split panes, saved arrangements and
per-panel state needs an explicitly versioned document. This one is a flat array whose
migrations are heuristics.

**CONFIDENCE.** 🟢.

### 2.2 Migration, recovery, and what happens when the blob is bad

**OBSERVATION.** Two migrations run inside `parseLayout`, both **shape-sniffed rather than
version-gated**, and a blob that fails to parse is silently replaced by an **empty board**.

**EVIDENCE** (`ChartsWorkspace.jsx:297-340`):
1. **12→24 columns**: `if (cols !== GRID_COLS)` → double every `x` and `w`, then stamp
   `cols = 24`. The marker IS the detection: "old saves have cols:12 or none".
2. **Viewport-lock auto-fit**: if `maxBottom <= FIXED_ROWS / 2`, scale every `y`/`h` by
   `floor(FIXED_ROWS / maxBottom)` — a heuristic for pre-viewport-lock saves.
3. `catch {}` → `return null`. The single consumer is
   `useState(() => parseLayout(prefs?.charts_workspace_layout) || DEFAULT_LAYOUT)`
   (`:724`), and `DEFAULT_LAYOUT = { widgets: [], cols: 24 }` (`:77`) — **an empty
   workspace**.

**INTERPRETATION.** 🔴 **This is a silent data-loss path.** A truncated, quota-clipped, or
otherwise malformed `charts_workspace_layout` value renders as "you have no widgets" with
no error, no toast, and no distinction from a genuinely new user — and because the board
then autosaves (§2.3), the empty state overwrites the corrupt-but-possibly-recoverable
original within 500 ms of the first grid event. There is **no backup, no prior-version
copy, and no undo for layout** (grep for `undo`/`Undo` in `ChartsWorkspace.jsx` returns
nothing; the only undo in this area is per-symbol *drawings* undo in `drawingsStore.js`,
`MAX_HISTORY = 100`).

⛔ The mitigation that exists is a **hydration gate**, and it is load-bearing:
`hydratedRef` (`:742`) is set only when `prefsLoading` goes false (`:744`), and every save
path checks it (`:974, :1004, :1022, :1182`). The comment at `:1019` names the failure it
prevents: *"Don't persist until prefs have hydrated — RGL fires onLayoutChange on"* first
mount, which would write the pre-hydration DEFAULT (empty) over the user's real board.
`useMultiChartState.js` reproduces the identical gate for `multichart_state` and calls it
"the V1 hydration-clobber race".

**RELEVANCE TO UCT.** Two things a terminal workspace must have that this does not:
(a) a durable prior-version copy so a bad parse is recoverable rather than fatal, and
(b) an explicit distinction between "empty because new" and "empty because unreadable".
The hydration gate is a pattern worth copying verbatim — it is the shape of the bug that
destroys a board.

**CONFIDENCE.** 🟢 for the code path. 🟡 that it has ever fired in production
(**EVIDENCE CEILING** — no support ticket, log line, or artifact was read; the JSON is
written by `JSON.stringify` so corruption would require truncation or storage failure).

**OPEN QUESTION.** Has any member reported a workspace that came back empty? A single
support-ticket search would move this from 🟡 to a confirmed incident class or retire it.

### 2.3 The write path — debounce, flush, and the non-atomic template

**OBSERVATION.** Autosave is a 500 ms debounce with an unmount flush; applying or saving a
named layout is **six-to-seven independent writes with no transaction**.

**EVIDENCE.**
- `scheduleSave` (`ChartsWorkspace.jsx:963`): `clearTimeout` → 500 ms → `setPref('charts_workspace_layout', JSON.stringify(next))`.
- Flush on unmount (`:970-980`), gated on `hydratedRef.current`, so an SPA navigation
  within the 500 ms window still persists.
- `useMultiChartState.js:53-72` mirrors this exactly for `multichart_state` (500 ms,
  hydration gate, flush-on-unmount, `queueMicrotask(scheduleSave)` so the ref holds `next`).
- **`applyTemplate` (`:1690-1752`)** writes, in sequence and independently:
  `charts_workspace_layout`, `watchlist_settings`, `theme_tracker_settings`,
  `fundamentals_settings`, `breadth_widget_settings`, conditionally `chart_settings`,
  `charts_vol_pane_pct`, `charts_active_template` — **plus** `localStorage['uct.watchlist.cols']`.
- **`handleSaveAs` (`:1840-1870`)** inverts it: it reads those same five prefs plus
  `readWatchlistColumns()` and nests them INSIDE the `layout` object sent to
  `POST /api/charts/layouts`.
- The comment at `:1717` records the bug that forced watchlist columns into the bundle:
  *"added columns vanished after switching layouts and back, because Save captured them
  nowhere and opening a prebuilt wiped the localStorage key."*

**INTERPRETATION.** A "layout" is conceptually one thing and physically **eight**. The
server row is one atomic JSON document (good); the live working state is eight keys across
two storage systems (bad). A failed POST partway through `applyTemplate` leaves a board
whose arrangement is the new template and whose look is the old one, with nothing detecting
it. And `uct.watchlist.cols` in localStorage means **part of the workspace does not travel
between devices at all** — the saved template carries it, but the *working* board does not.

**RELEVANCE TO UCT.** This is the single strongest argument in the codebase for
TERMINAL-NEXT persisting **one versioned workspace document** rather than a family of keys.
The server-side named-layout row is already that shape; the working state is not.

**CONFIDENCE.** 🟢.

### 2.4 The `fix/charts-layouts-uuid` history

**OBSERVATION.** The hotfix is real, is in this worktree's history, and left a schema
inconsistency behind.

**EVIDENCE.** `git show 9c9aaf75e` —
*"fix(charts): user-scope layout saves 500'd — users.id is a UUID, drop int() coercion"*,
2026-07-17, from support ticket "Chart layouts won't save" (stephen.pineau). The diff
changes two signatures from `user_id: int` to untyped and deletes
`uid = _GLOBAL_UID if scope == "global" else int(user_id)`. The commit message states:
*"Global/prebuilt saves worked (they use `_GLOBAL_UID=0`), which masked the break since
ship."* Regression tests: `tests/test_charts_layout_service.py` (52 lines added).

⛔ **The schema was NOT changed.** `charts_layout_service.py:38` still declares
`user_id INTEGER NOT NULL DEFAULT 0` while every user-scope row now stores a UUID string.
SQLite's type affinity accepts this (a non-numeric string is stored as TEXT in an INTEGER
column), so it works — but the declared type is a lie, and `_GLOBAL_UID = 0` is an integer
sharing a column with UUID strings.

**INTERPRETATION.** The bug class is exactly the one the program should design against: a
feature shipped, was exercised only on the admin path (`_GLOBAL_UID`), and the member path
was broken **from ship until a support ticket**. Nothing measured it; a user reported it.

**RELEVANCE TO UCT.** ⭐ Any TERMINAL-NEXT save path needs a rail that exercises the
**member** identity, not just the staff one. An admin-only smoke test would have passed
here for months.

**CONFIDENCE.** 🟢 (commit read directly).

**RECOMMENDATION.** Note the residual: the `INTEGER` declaration on a UUID column is a
latent trap for anyone who later adds a JOIN, an index assumption, or a comparison.

### 2.5 Other layout persistence

| Surface | Where it persists | Notes |
|---|---|---|
| `/charts` workspace | pref `charts_workspace_layout` + 7 companions | §2.1–2.3 |
| Multi-chart grid | pref `multichart_state`; named boards in `charts_layouts.db` with `layout.kind='multichart'` | `gridLayouts.sanitizeState`, `GRID_MAX_CELLS = 16` (`gridLayouts.js:13`) |
| Breadth views/compare | pref `breadth_views_config` + localStorage `uct.breadth.views.v2` | dual-store; see §6.2 |
| Breadth monitor columns | localStorage `breadth_collapsed_cols` (`Breadth.jsx:980,992`) | device-local only |
| Watchlist columns | localStorage `uct.watchlist.cols` | device-local; rides saved templates only |
| J2 analytics sections | localStorage `uct.j2.analytics.section.<id>` | device-local |
| Dashboard | **none found** — the Dashboard is a fixed zone layout, not a persisted arrangement | CLAIM: no `dashboard_layout` pref exists; grep found none |
| Flow board | **NOT INSPECTED** — partner-owned `OptionsFlow.jsx` / `live_massive_router.py`; read-only by contract | |

---

## SECTION 3 — Saved objects: who owns what (Q3)

**OBSERVATION.** Twelve-plus distinct user-owned object stores across four ownership
classes, spread over ~40 SQLite files on one volume.

**EVIDENCE.** Enumerated by grepping `/data/*.db` literals and `*_DB_PATH` env reads across
`api/` — 41 distinct database files. The state-relevant ones:

| Object | Store | Ownership | Key evidence |
|---|---|---|---|
| Preferences | `auth.db` `user_preferences` | user | `auth_db.py:227` |
| Sessions | `auth.db` `sessions(token PK, user_id, expires_at)` | user | `auth_db.py:37` |
| Watchlists | `auth.db` `watchlists` + `watchlist_items` | user; `is_public` shares to Community; `is_flagged_list`, `is_prebuilt` flags | `auth_db.py` |
| Ticker tags | `auth.db` `ticker_tags` `UNIQUE(user_id, sym)` — 7 colours | user, shareable | `auth_db.py` |
| Price alerts | `auth.db` `watchlist_alerts` (+ `alert_type` `price｜line｜trendline`, anchor_t/p columns added by ALTER) | user | `auth_db.py` |
| Indicator alerts | `auth.db` `indicator_alerts` | user | `indicator_alert_service.py:88` |
| Named chart layouts | `charts_layouts.db` | `scope='user'` (owner) / `scope='global'` (admin-published) | `charts_layout_service.py` |
| Indicator/formula definitions | `user_definitions.db` — `user_definitions` (append-only, `UNIQUE(user_id, def_id, version)`), `definition_shares`, `definition_listings` | user-authored; firm setups arrive as **ordinary editable definitions** via `starter_library.py` | `user_definitions.py:201,217,233` |
| Journal 1.0 | `auth.db` `journal_entries`, `trade_executions`, `journal_screenshots`, `daily_journals`, `weekly_reviews`, `playbooks`, `journal_resources`, `import_sessions` | user | `auth_db._migrate_journal_v2` |
| Journal 2.0 / Notebook | `auth.db` `j2_*` (via `journal_two/db.ensure_schema`) | user | CLAUDE.md §Journal 2.0 (CLAIM) + `auth_db.py` import |
| My Playbook | `auth.db` `upb_sections`/`upb_entries`/`upb_charts`/`upb_note_links` | user (member-built Model Book) | `user_playbook/db.py:21,35,50,77` |
| Model Book | `/data/modelbook.db` | **staff-published, global** — reads any logged-in user, writes `require_admin` | CLAUDE.md §Model Book (CLAIM) |
| UCT20 book | wire_data push + `/data/uct20_compositions.json` | **system** — not user-owned at all | CLAUDE.md (CLAIM) |
| Chart drawings | **localStorage only** (`uct-chart-drawings`) + optional server mirror | user, device-local by default | `drawingsStore.js:27` |
| Drawing boards ("tracings") | localStorage `uct-chart-tracings` **+ pref `tracings_doc`** | user, cross-device | `drawingsStore.js:314`, `useTracingsSync.js` |
| Formula shares | `definition_shares`, route `/formulas/shared/:token` | user→user | `formulaShareLink.js:36` |

**INTERPRETATION.** Three ownership classes are cleanly separated and one is muddled.
User-owned, staff-published (Model Book, `scope='global'` layouts, starter library) and
system (UCT20, wire) are distinct. What is muddled is **where** user-owned state lives:
`auth.db` holds preferences, watchlists, alerts, both journals and the playbook, while
layouts and definitions each got their own file for stated reasons. The stated reason for
`user_definitions.db` (`user_definitions.py:33-40`) is that `charts_layout_service.py` is
"the shipped store for user-authored content" — so the pattern is deliberate and
documented, just unevenly applied.

⭐ **`user_definitions.py` is the strongest persistence design in the repo** and is worth
reading in full before designing any TERMINAL-NEXT store. Its invariants:
- **Append-only**: every save INSERTs a new `version`; the module contains no `UPDATE`
  against `user_definitions`, and that is asserted by an **AST walk over its own source**,
  not by grep.
- **Delete is a tombstone version**, not a stamp on existing rows — *"A delete that rewrote
  history would be the one UPDATE, and it would land on exactly the rows a pin points at."*
- **No triggers**: `sqlite_master` is read and asserted trigger-free, so "nothing rewrote
  the row" is a property of the file rather than of the module's good behaviour.
- Two numbers, `version` (every save) and `rev` (maths changed → force-migrate every bound
  alert).

**RELEVANCE TO UCT.** If TERMINAL-NEXT lets a user name and share workspaces, the pin
problem is identical to the formula pin problem: a shared workspace referencing a
definition that later changes under it. `user_definitions.py` already solved that with
`defId@version` pins and an append-only store. Reuse it; do not re-derive it.

**CONFIDENCE.** 🟢 for stores I opened (`user_definitions.py`, `charts_layout_service.py`,
`auth_db.py`, `indicator_alert_service.py`, `user_playbook/db.py`). 🟡 for Model Book /
Journal 2.0 / UCT20 ownership, which I took from CLAUDE.md and confirmed only at the level
of "the schema-init call exists" (**EVIDENCE CEILING**: I did not open `journal_two/db.py`
or `modelbook_service.py`).

---

## SECTION 4 — Client storage and URL state (Q4)

### 4.1 localStorage / sessionStorage inventory

**OBSERVATION.** ~70 static localStorage keys plus several dynamic-prefix families; exactly
**two** sessionStorage keys.

**EVIDENCE.** Grep over `app/src` (tests excluded), constants resolved at their declaration
sites.

**Chart / drawing state**
| Key | Purpose | File |
|---|---|---|
| `uct-chart-drawings` | **all drawings, per raw symbol string** | `drawingsStore.js:27` |
| `uct-chart-tracings` | drawing-board document `{v:1, tracings[], activeId, visibleIds, archive}` | `drawingsStore.js:314` |
| `uct-tracings-sync-hw` | highwatermark: last server `updatedAt` this browser saw | `useTracingsSync.js:23` |
| `uct-draw-repeat` | tool-repeat toggle | ChartToolbar |
| `uct.chart.drawtools.{hidden,favorites,favpos}.v1` | toolbar customisation | `ChartToolbar.jsx:99-101` |
| `uct.chart.toolbar.collapsed` | toolbar collapsed | `StockChart.jsx:2526` |
| `uct.drawings.tapHintSeen` | one-time hint | `ChartDrawingOverlay.jsx:93` |
| `charts_mobile_sym` | phone workspace ticker | MobileWorkspace |
| `uct.charts.mobileRecents`, `uct.charts.themeScope`, `uct.charts.breadthLine` | charts misc | ChartsWorkspace/mobile |
| `uct.watchlist.cols` | **watchlist column config — part of a layout, device-local** | `ChartsWorkspace.jsx:597,1723,1725,1777,1833` |

**Caches with TTL (safe to lose)**
`tmeta:<SYM>` (ticker meta, 7d — `useTickerMeta.js:16`), `tipo:<SYM>` (IPO date, 30d —
`useTickerIpo.js:10`), `barspack.version` / `barspack.hotVersion` (`barsPackClient.js`).
Bars themselves are in **IndexedDB** (`utils/barsIDB.js`, `CACHE_LOGIC_VERSION`), not
localStorage.

**Kill-switches / rollout buckets (operationally load-bearing)**
`uct.barsPush.enabled`, `uct.barsPush.bucket`, `uct.barsPool.disabled`, `uct.ssePool.disabled`,
`uct.barsHistory.enabled/bucket`, `uct.barsFetchMax`, `uct.listprewarm.off`,
`uct.j2.shell` + `uct.j2.shell.bucket` (`shellFlag.js:22-23`), `uct.gridspike.last`,
`uct.massiveStream`, `uct.massiveCuratedStream`, `uct_massive_lookback_days`,
`uct_massive_tune_collapsed`, `uct_show_darkpool`, `uct_liveflow_show_darkpool`.

**Per-surface UI state**
`uct_flagged` (`useFlagged.js:4` — the flagged list, with a debounced server shadow-sync),
`uct_leaders`, `uct.breadth.views.v1` / `.v2` (`useBreadthViews.js:16-17`),
`breadth_collapsed_cols`, `uct.j2.*` (~12 keys: `selectedAccountId`, `openPositions.view`,
`holdings.sort`, `nb.sidebarOpen/Width`, `analytics.section.<id>`, `nudges.dismissed.a1`,
`feature.*`), `uct.desk.*` (6), `modelbook_*` (4), `voice.*` (5), `desk_video_pos/progress`,
`readaloud.pos.<track>`, `readaloud.speed`, `uct.activity.sym`, `uct.aisearch.{mode,deep}`,
`uct.floor.avatarNudge.dismissed`, `uct.notebook.tickersOpen`, `uct.jw.lastNote`,
`uct_intro_seen_v1` (`introStorage.js:1`).

**sessionStorage — only two.** `uct_intro_seen_session` (`introStorage.js:31`) and
`uct.chunk-reload-attempted` (`lazyWithRetry.js:24`, deliberately session-scoped so the
flag clears on a new tab).

**INTERPRETATION.** Every localStorage read/write in this codebase is wrapped in
`try/catch` — private mode and quota are handled uniformly and well. But the boundary
between "device-local convenience" and "user state that should follow the account" is drawn
inconsistently: **chart drawings** and **watchlist columns** are user content living only
on one browser, while `tracings_doc` (the *organisation* of those drawings into boards) does
sync. A user who draws on a chart at the desk sees nothing on the laptop; the *board names*
follow them.

**RELEVANCE TO UCT.** ⭐⭐ For a terminal this is the sharpest question in the whole report:
**what follows the account and what stays on the machine?** The existing answer is an
accident of implementation order, not a decision. TERMINAL-NEXT should state the rule
explicitly and put every key on one side of it. `useTracingsSync.js` is the working bridge
pattern for moving a localStorage-first store to cross-device without rewriting it (§6.3).

**CONFIDENCE.** 🟢 for the keys listed. 🟡 for exhaustiveness — dynamic key families
(`posKey(id)`, `LS_PREFIX + sym`) are enumerated by prefix, not by value.

### 4.2 URL state conventions

**OBSERVATION.** Two well-designed, module-owned conventions, and both encode the same
principle: **a URL param is a one-shot instruction, never a second source of truth.**

**EVIDENCE.**
- **Charts deep link** — `app/src/lib/chartDeepLink.js`: `CHART_LINK_PARAMS = {sym, tf}`,
  `chartsLinkPath` / `readChartsLink` / `stripChartsLink`. The header states the rule
  explicitly: *"the workspace applies these through the authorities it already has
  (`setGroupSym`, `applyTfToCharts`) and then STRIPS the params, so the URL is a one-shot
  instruction rather than a second source of truth competing with the saved workspace."*
- **Calendar / earnings modal** — `app/src/pages/calendar/useEarningsModalRoute.js`:
  `EARNINGS_PARAM='earnings'`, `SECTION_PARAM='esection'`, `WEEK_PARAM='week'` (plus `?d`
  owned by `Calendar.jsx:88`). Normative history semantics are documented in-file:
  `open()` PUSH, `step()`/`setSection()`/`jumpToWeek()` REPLACE, `close()` pops only when
  we still OWN the top entry. Raw `window.history.pushState` is **banned** in that module —
  every write goes through `mergeParams` so unrelated params survive.
  `ROUTED_PATHS = ['/calendar', '/calendar/mystocks']` bounds where the param is honoured.
- Share links follow the same "one module owns the path" idiom:
  `formulaShareLink.js` (`SHARED_FORMULA_PATH = '/formulas/shared'`), `screenShareLink.js`,
  `noteShareLink.js`.

**INTERPRETATION.** ⭐ These modules are the best-designed state code in the repo and their
headers explain *why* in terms of a defect that actually happened: `formulaShareLink.js`
exists because `SharePanel.jsx` hand-typed `/formulas/shared/${token}` and **no route was
ever registered**, so every share link a member ever copied resolved to the 404 catch-all —
and the one test that touched it pasted the URL into an input, so it could never notice.

**RELEVANCE TO UCT.** A terminal will want deep links (open this symbol, this layout, this
panel, this time range). The convention to copy is already written down: one module owns
the path AND the param names, both the writer and the reader derive from it, and applying a
link strips it. The anti-pattern to avoid is equally documented.

**CONFIDENCE.** 🟢.

### 4.3 What survives a refresh

| Survives refresh, same device | Survives refresh, ANY device | Does not survive |
|---|---|---|
| everything in §4.1 | every pref key in §1.3 | React state: `monthCursor`, `quickQ` (Calendar — *deliberately*: `Calendar.jsx:175`, "a stale saved search silently blanking next session reads as data loss") |
| chart drawings | named layouts (`charts_layouts.db`) | in-memory server TTL caches (reset on redeploy) |
| watchlist columns | watchlists/alerts/tags/journals | `openSeq`/modal-ownership refs |
| barsIDB bars | drawing BOARDS (`tracings_doc`) but not the drawings | floating-widget positions (`floatSpawns`) |

---

## SECTION 5 — Server-side per-user state and caching (Q5)

**OBSERVATION.** The server caches almost nothing per user, and that is deliberate.

**EVIDENCE.**
- `api/services/cache.py` — one `TTLCache` class (thread-safe `OrderedDict`, RLock,
  `_MAX_SIZE = 1000` default LRU). The header comment states the lock is load-bearing
  because `/api/bars` handlers on the anyio threadpool race background SWR threads, and the
  KeyErrors surfaced as bare 500s.
- A grep for user-scoped cache keys across `api/services/*.py` + `api/routers/*.py` returns
  **two**: `discord_relay.py:29` `f"discord::{user_id}"` and
  `voice_briefings_proactive.py:65` `f"briefing::{user_id}::{today}"`.
- The contrary discipline is documented at `cache.py:16-22`: `_MAX_SIZE` used to be read
  inside `set()`, silently capping the dedicated `live_prices` cache; above ~970 distinct
  tickers it thrashed permanently (31.7% miss / ~3.1k upstream fetches per 2s poll round at
  200 users × 50 tickers) and funnelled into `live_prices._MASSIVE_SEM`, reproducing the
  launch-day 524 from a different direction.
- `/api/live-prices` is explicitly **de-fragmented per user**: a shared per-ticker cache
  (`live_px1_{TK}`, 15s) rather than one entry per user's ticker set (CLAUDE.md
  §Performance, CLAIM — the file `api/routers/live_prices.py` was not opened).
- Auth session storage: `sessions(token TEXT PK, user_id, expires_at, created_at)`
  (`auth_db.py:37`), cookie `uct_session`, `httponly`, `samesite=lax`, `max_age = 30 days`
  (`auth.py:1653`). `auth_service._should_write_last_login` throttles the per-request
  `last_login` write to 300s — CLAUDE.md names the unthrottled version as the keystone of
  the 2026-07-01 524 outage (CLAIM).

**INTERPRETATION.** The rule the codebase converged on, the hard way, is
**"never fragment a cache by user."** Per-user server state is limited to durable SQLite
rows plus the session token. There is no server-side per-user session/workspace cache to
inherit or to invalidate.

**RELEVANCE TO UCT.** ⛔ A TERMINAL-NEXT design that adds a per-user server-side workspace
cache, live session object, or per-user websocket state re-opens the exact fragmentation
class that caused the 524. The web pod is one uvicorn process with one event loop and one
64-worker anyio threadpool shared by every user (CLAUDE.md, CLAIM), so per-user server
state does not amortise.

**CONFIDENCE.** 🟢 for cache.py, session schema and the two user-scoped keys (source read).
🟡 for the 524 causality (CLAUDE.md is a CLAIM; **EVIDENCE CEILING** — the incident memory
`incident_524_single_process_overload_2026_07_01` and Railway logs were not read).

---

## SECTION 6 — Versioning and migration practice (Q6)

The repo has shipped persisted-schema changes **four different ways**. All four are live.

### 6.1 Read-fallback shim, key renamed (the calendar pattern)

**EVIDENCE** (`app/src/pages/Calendar.jsx:144-192`, all comments in-file):
```js
const _viewV2 = prefs.calendar_view_v2
const _savedViewV3 = prefs.calendar_view_v3
const view = _savedViewV3 || (
  _viewV2 === 'month' ? 'month'
  : (_viewV2 === 'feed' && prefs.calendar_density === 'rows') ? 'table'
  : 'board')
```
Same shape for `calendar_filters` → `calendar_filters_v2` (legacy metric filters carry
over; `audience`/`sort` deliberately reset) and for `calendar_event_types_v2` (key bumped
*specifically* to reset everyone, because macro used to be a locked always-on chip so every
legacy pref carries it "not by choice").

**INTERPRETATION.** The v2 keys are **never deleted and never written** — they are read
forever. This confirms project memory's warning: renaming a persisted key wipes saved views
**unless a read-fallback shim ships in the same change**. The cost is that
`user_preferences` accumulates dead keys permanently, and with no DELETE route (§1.1) there
is no way to reclaim them.

🔴 **No test pins this.** `app/src/pages/calendar/*.test.js*` contains 20 files; a grep for
`calendar_view_v2` / `calendar_density` / `calendar_filters` across all test files returns
**nothing**. The migration that protects every existing user's saved calendar view is
guarded by a hand-written ternary and by nobody.

**CONFIDENCE.** 🟢 for the code, 🟢 for the absence of a test (grep over all `*.test.js*`).

### 6.2 Version-in-the-key, both stores (the breadth pattern)

`app/src/pages/breadth/useBreadthViews.js:16-17` exports `STORAGE_KEY = 'uct.breadth.views.v2'`
**and** `V1_KEY = 'uct.breadth.views.v1'`, with `PREF_KEY = 'breadth_views_config'` as the
server copy (`:23`, written at `:215` and `:240`). So the same configuration exists in
localStorage (versioned by key) and in a preference (unversioned). This is a dual-store with
one of the two versioned — the worst of both.

### 6.3 Versioned document + highwatermark LWW sync (the tracings pattern) ⭐

`app/src/components/chart/useTracingsSync.js` is the closest thing in the repo to a
cross-device workspace sync, and it is only ~110 lines:
- Server copy is the pref `tracings_doc` = `{updatedAt, doc}`; the doc itself carries
  `{v: 1, tracings, activeId, visibleIds, archive}` (`drawingsStore.js:_virtualDoc`).
- Local highwatermark in localStorage (`uct-tracings-sync-hw`) = the last server `updatedAt`
  this browser has seen.
- Hydrate once: `server.updatedAt > hw` → `importTracings(server.doc)`; else our copy is
  truth and we push.
- Push is debounced 1500 ms and **flushed on unmount**; `updatedAt` is monotonic
  (`Math.max(Date.now(), lastPushed + 1)`) as a clock-skew guard.
- The limitation is stated, not discovered: *"a device with unsynced local drawings adopts
  the cloud copy on its first sync, and two devices editing at once keep the later writer's
  whole document. This is add/replace-consistent, not a field-merge."*
- ⭐ *"The doc is only persisted once the user TOUCHES the tracing system"* — a member who
  never opens the UI writes no new key, which is why every pre-existing test stayed green.

### 6.4 Read-time versioned migration with tombstones (the chart-settings pattern) ⭐⭐

This is the most sophisticated persisted-schema machinery in the app and the only place a
**version number lives in the data**.

**EVIDENCE** (`app/src/components/chart/chartDefaults.js`, `instanceShape.js`):
- `CHART_DEFAULTS.settingsVersion = 2` (`chartDefaults.js:230`).
- `mergeChartSettings(userSettings)` (`:420`) reads `parsed.settingsVersion` **once**
  (`:449`, defaulting to 1) and, when the blob is v1, folds fourteen enumerated indicator
  sections into `indicatorInstances[]` via `migrateLegacyToInstances` (`:574-649`), then
  stamps `settingsVersion: 2` on the way out so it never re-runs.
- ⛔ `mergeChartSettings` is a **HARD ALLOW-LIST**: its return is an object literal, so any
  key absent from that literal is **destroyed on every read**. This is deliberate — it is
  the mechanism used to delete fourteen legacy sections and the `engineEnabled` flag — and
  it is precisely why `user_definitions.py` refused to store formulas in `chart_settings`.
  `tests/test_user_definitions.py` proves it by **running the shipped function under node**
  and asserting the key is gone while a sibling survives (with a control so "gone" cannot be
  satisfied by a merge that ran on nothing).
- **Deletion is a tombstone.** `instanceShape.js:54 instanceTombstone(id)` returns
  `{instanceId, deleted: true}`; `mergeSettingsOverride` (`:86`) is a **union by
  `instanceId`**. The header explains why omission cannot mean deletion: *"the writer that
  resurrects a deleted instance is not a buggy one, it is an ordinary grid cell whose
  snapshot predates the delete and which names the instance in full on its next unrelated
  write."* Known limit, stated: tombstones accumulate, one per id ever deleted.
- Rails: `app/src/components/chart/engine/__tests__/{settingsBlobMigration,engineEnabledMigration,computeRevMigration}.test.js`.
  `engineEnabledMigration.test.js` runs a **source scan** because `JSON.stringify` drops an
  `undefined` value — deleting the key and assigning `undefined` produce byte-identical
  output, so an output-only test cannot tell them apart.
- ⭐ `instanceShape.js` was split out of `chartDefaults.js` for a **measured bundle reason**:
  `usePreferences` is on the eager path and its import of `mergeSettingsOverride` dragged
  42 kB raw / 13.9 kB gzip of indicator maths into the entry chunk (`index` 379,254 →
  421,032 bytes). *"`manualChunks` CANNOT FIX AN EAGER STATIC IMPORT — the EDGE has to move."*

**INTERPRETATION.** Everything a versioned workspace schema needs — an in-data version, a
read-time idempotent fold, stated deletion, union-merge under concurrency, and rails that
survive `JSON.stringify` erasing the difference — **exists and works, for `chart_settings`
only.** `charts_workspace_layout` has none of it.

**RELEVANCE TO UCT.** ⭐⭐ **This is the seed.** A TERMINAL-NEXT workspace schema should be
`chart_settings`-shaped (`settingsVersion` + read-time fold + tombstones + union merge),
persisted in a `user_definitions`-shaped store (own file, append-only, capped, deletable),
written through the `usePreferences.setPrefMerged` write-queue, hydration-gated and
flush-on-unmount like `ChartsWorkspace`/`useMultiChartState`, and synced cross-device with
`useTracingsSync`'s highwatermark. Every piece already ships. **None of them is currently
applied to the layout.**

**CONFIDENCE.** 🟢.

---

## SECTION 7 — Gap analysis for a terminal workspace state model (Q7)

The five tiers, what exists, and which module is the natural seed. **Observations, not
requirements.**

### 7.1 Global state (app-wide, not workspace-scoped)

| Need | Exists? | Evidence / seed |
|---|---|---|
| Current symbol, app-wide | ✅ **yes, and it is already unified** | `app/src/hooks/useAppFocus.js` — owner's call 2026-08-14: *"charts Group A IS the app focus"*, stored in `charts_workspace_groups.A`, no second authority. `useAppFocus.test.js` reads the key out of `ChartsWorkspace.jsx`'s SOURCE rather than trusting the copy. |
| Theme | ✅ | pref `theme`; `charts_theme` + `layoutTheme` are per-board overrides |
| Auth/session | ✅ | `AuthProvider`, `sessions` table |
| Date anchor / trade ref app-wide | ❌ | `useAppFocus` header states the ceiling verbatim: *"Focus is a SYMBOL only… Date anchors and trade refs still travel by explicit link (`lib/chartDeepLink.js`)"* |
| Live focus propagation | ⚠️ **known limit, deliberate** | ChartsWorkspace hydrates groups from the pref ONCE per mount, so a focus change made elsewhere while `/charts` is mounted lands on the next mount. Navigation unmounts, so the intended case works. |

### 7.2 Workspace state (arrangement, panels, links)

| Need | Exists? | Gap / seed |
|---|---|---|
| Grid arrangement | ✅ | `charts_workspace_layout.widgets[]`, RGL, 24 cols at every breakpoint |
| **Versioned schema** | ❌ | No version field; migrations shape-sniffed (`parseLayout`). **Seed: `settingsVersion` + read-time fold in `chartDefaults.js:574`** |
| **Instance-based panel identity** | ⚠️ partial | Ids are `w-${type}-${Date.now()}` (`:1390`) — unique in practice, collidable in principle within one millisecond, and carry no stable meaning across a save/reapply. **Seed: `instanceId` + union-by-id in `instanceShape.js:86`, which already solved identity for indicator instances** |
| **Link groups** | ✅ **shipped** | Colour groups A/B/C/D via `WorkspaceContext` (`useWorkspace()` → `{groupSyms, setGroupSym}`); every widget wrapped in a scoped `ChartsSymContext.Provider`. `ChartsSymContext` is a shim resolving explicit Provider → Group A → null. **This is the strongest existing asset for a terminal.** Ceiling: exactly four groups, symbol-only (no timeframe/date linking) |
| **Autosave** | ✅ | 500 ms debounce + hydration gate + flush-on-unmount, in TWO places (`ChartsWorkspace.jsx:963`, `useMultiChartState.js:53`) |
| **Undo** | ❌ | None for layout. Drawings have per-symbol undo (`drawingsStore.js`, `MAX_HISTORY = 100`); grid mode has a `restoreCells` "verbatim board restore (Undo)" for cell contents only |
| **Corrupt-blob recovery** | 🔴 **none** | `parseLayout` → `null` → `DEFAULT_LAYOUT` (empty), indistinguishable from a new user, then autosaved over. §2.2 |
| **Atomic workspace write** | 🔴 **none** | 6–7 independent `setPref` calls + a localStorage write per template apply. §2.3 |
| Cross-device | ⚠️ split | Prefs travel; `uct.watchlist.cols` and all chart drawings do not. §4.1 |
| Multi-window | ✅ partial | Pop-out windows (`pages/charts/popout/PopoutWindow.jsx`, `poppedLayouts` with `pl-${Date.now()}` ids); popped state is in-memory, not persisted |

### 7.3 Server state

| Need | Exists? | Seed |
|---|---|---|
| Named saved workspaces, user + firm-published | ✅ | `charts_layout_service.py` — `UNIQUE(scope,user_id,name)`, `scope ∈ user｜global`, admin gate at `charts_layouts.py:38` |
| Versioned/append-only saved objects | ✅ (definitions only) | `user_definitions.py` — append-only, tombstone delete, no triggers, AST-asserted |
| Conflict detection on write | ❌ | No `If-Match`, no version echo, no 409. Client-side `_writeChains` serialises one browser; two browsers still race |
| Size caps / quota | ❌ for prefs, ✅ for definitions | `MAX_DEFINITION_BYTES`, `MAX_DEFINITIONS_PER_USER` |
| Delete | ❌ for prefs | `delete_user_preference` exists, unrouted (`auth.py:72`) |
| Per-user server cache | ❌ **by design** | §5 — do not add one |

### 7.4 Persisted-user state (settings)

Adequate as a scalar store. The gaps are structural, not functional: no namespacing (30+
flat keys), no schema, no per-key TTL/expiry, no way to enumerate or garbage-collect dead
keys (`calendar_view_v2` will be read forever). ⛔ The two-model widget-appearance split
(GLOBAL vs per-instance, §1.3) is the specific inconsistency a workspace schema would need
to resolve.

### 7.5 Transient state

Well handled and deliberately so. `quickQ` (Calendar search) is documented as
intentionally-not-persisted: *"a stale saved search silently blanking next session reads as
data loss."* Modal/history ownership is tracked with a re-derived ref rather than a boolean
(`useEarningsModalRoute.js`, with a worked example of why the boolean is a lie after a
browser-driven pop). React state is the right home and is being used as such.

### 7.6 The seed map — one line per tier

| Tier | Natural seed to build TERMINAL-NEXT on |
|---|---|
| Workspace document shape + versioning | `chartDefaults.js::mergeChartSettings` + `instanceShape.js` (version, read-time fold, tombstones, union-by-id) |
| Panel identity + link groups | `WorkspaceContext` / `ChartsSymContext` colour groups + `useAppFocus` |
| Autosave discipline | `ChartsWorkspace.jsx:963` + `useMultiChartState.js:53` (debounce + hydration gate + unmount flush) |
| Concurrent writers | `usePreferences.setPrefMerged` + `_writeChains` |
| Server store | `charts_layout_service.py` shape, `user_definitions.py` invariants |
| Cross-device sync | `useTracingsSync.js` (highwatermark LWW, monotonic stamp, flush-on-unmount) |
| Deep links | `lib/chartDeepLink.js` + `useEarningsModalRoute.js` |

**RECOMMENDATION (observations only).**
1. One versioned workspace document, in its own store, replacing the eight-key bundle —
   the strongest single change, and every ingredient is already in-repo.
2. Distinguish "empty because new" from "empty because unreadable", and keep a prior
   version so the second is recoverable.
3. Decide the device-local vs account-following rule explicitly and place every key.
4. Give panels stable instance ids that survive save/reapply, not `Date.now()`.
5. Do not add per-user server caching.
6. Rails must exercise the **member** path (the `fix/charts-layouts-uuid` lesson), and a
   key-rename shim needs a test — the calendar's has none.

**CONFIDENCE.** 🟢 for what exists (all read from source). 🟡 for the gap
characterisation, which is an interpretation, not a measurement.

---

## GAPS (what this budget did not reach)

- **No production data.** Byte sizes of real `charts_workspace_layout` / `chart_settings`
  blobs, the count of dead legacy pref keys in `auth.db`, and how many users hold a v1
  chart-settings blob are all unmeasured.
- **Journal 2.0 persistence read only at the schema-init call site.** `journal_two/db.py`
  (`_J2_SCHEMA`, `_PHASE_2_ALTERS`), the notebook tables and the note-sync connector tables
  were not opened; §3 takes their shape from CLAUDE.md as a CLAIM.
- **Model Book / UCT20 / Setup Library** ownership taken from CLAUDE.md, not from
  `modelbook_service.py`.
- **Flow board grid persistence not inspected** — `OptionsFlow.jsx` and
  `live_massive_router.py` are partner-owned and the preamble limits how deeply they may be
  described. Whether Live Flow persists any per-user board state is NOT DETERMINED.
- **`WIDGET_REGISTRY` not enumerated.** I read the registry's *role* (metadata + menu
  membership + journal-embed params, pinned against `WORKSPACE_WIDGETS` by
  `registry.test.js`) but did not list widget types or their `defaults`. D-06 covers
  component evaluation; a full type × persistence-model table would still be useful.
- **No test-suite run.** Contract did not authorise it and `C:\data` is real on this box.
  Every "the rail exists" statement is a file-presence + source-read claim, never an
  observed green run.
- **`entitlements.py` / toolkit limits on saved-object counts** not examined (D-10's scope,
  but it bears on workspace quotas).
- **IndexedDB** (`utils/barsIDB.js`) noted as the bars cache but its schema, eviction and
  `CACHE_LOGIC_VERSION` value were not read — it is cache, not user state, but it is the
  only other durable client store.

## NOT INSPECTED (and why)

- `C:\data\auth.db` and every other production DB file — out of scope; the repo-root
  `conftest.py` tripwire exists precisely because `/data` resolves to live files on this box.
- The production pod, `/api/health`, Railway logs and variables — not authorised by this
  contract.
- The local backend on port 8077 — the preamble forbids probing it and says it may serve
  stale data.
- `api/routers/live_prices.py`, `api/services/auth_service.py` beyond the preference
  functions and the referenced throttle, `api/main.py` lifespan — cited only via CLAUDE.md
  CLAIMS where they appear.
- `app/src/pages/OptionsFlow.jsx`, `api/schwab_router.py`, `api/live_massive_router.py`,
  `api/massive_ws_worker.py`, `api/massive_processor.py` — partner-owned.
- `external/morning-wire`, `external/uct-intelligence` submodules — not needed; no
  per-user workspace state lives there.
