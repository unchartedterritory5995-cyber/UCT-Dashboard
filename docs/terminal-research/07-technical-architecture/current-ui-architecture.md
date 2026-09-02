---
id: D-06
title: Current UI primitives — what could become a Terminal-Next building block
role: Terminal UI Architecture Engineer (Group D)
wave: 1
group: D
category: internal-system
scope: uct-dashboard `app/src/` (worktree `terminal-research`, HEAD a4ef6f240)
confidence: 🟢 high on inventory and structure; 🟡 on runtime/perf claims (static read only)
evidence_ceiling: Read-only static inspection. No browser was run, no test suite executed, no production surface touched — so every statement about RENDERED behaviour (paint, focus, contrast, virtualization under load) is inferred from source, not observed. Bundle sizes, render counts and real widget-count ceilings are NOT DETERMINED.
sources: app/src/widgets/registry.js, app/src/pages/charts/*, app/src/pages/charts/widgets/*, app/src/pages/charts/grid/*, app/src/pages/charts/popout/*, app/src/components/StockChart.jsx, app/src/components/chart/pane/ChartPane.jsx, app/src/components/research-kit/*, app/src/components/mobile/*, app/src/components/ui/UIcon.jsx, app/src/components/NavBar.jsx, app/src/components/navGroups.js, app/src/components/Layout.jsx, app/src/styles/{tokens.css,breakpoints.css,breakpoints.js,appThemes.js}, app/src/pages/screener/{columnDefs.js,shell/*}, app/src/pages/Watchlists.jsx, app/src/pages/Breadth.jsx, docs/ui-consistency-audit.md, docs/brand-design-system.md, CLAUDE.md
uct_relevance: high
status: draft
date: 2026-09-02
---

# Current UI primitives — Terminal-Next reusability assessment

**Scope note.** TERMINAL-CURRENT is the route `/calendar`, display-named "UCT Terminal".
It appears in this report in exactly two places: `NAV_ITEMS` in `NavBar.jsx` and the
`calendar` widget's labels in the widget registry. Everything else in `app/src/` still
says `calendar`. This report is about the *primitives* a TERMINAL-NEXT product would be
built from, not about TERMINAL-CURRENT's features (D-09 owns those).

---

## 0. Headline

**OBSERVATION.** The dashboard already contains a working, persisted, multi-window,
widget-based board — `/charts` — plus a second, independently-designed component kit
(`components/research-kit/`) that is closer to a terminal design system than anything in
`components/ui/`. The single biggest surprise is the *inverse* of what the docs claim:
`app/src/components/ui/` contains **one file** (`UIcon.jsx`). There is no shared
`Button`/`Input`/`Select`/`Modal` primitive layer, despite `docs/ui-consistency-audit.md`
naming all seven as "the source of truth".

**EVIDENCE.**
- `ls app/src/components/ui/` → `UIcon.jsx` only (17,200 bytes, 508 lines, 85 glyph keys in the `ICONS` map at `UIcon.jsx:17`). CONFIRMED by directory listing.
- `docs/ui-consistency-audit.md:31-33`: *"**Shared primitives:** `app/src/components/ui/` — `Button`, `Input`, `Select`, `Textarea`, `Checkbox`, `Toggle`, `Modal` (all token-driven). Use these for new surfaces…"* — a CLAIM, and it is FALSE against the tree. `find app/src/components -maxdepth 2 -name "Button*" -o -name "Modal*" -o -name "Input*" -o -name "Select*" -o -name "Toggle*"` returns nothing.
- `UIcon` is imported by **273** non-test files (`grep -rl UIcon app/src --include=*.jsx | grep -v test | wc -l`). CONFIRMED.

**INTERPRETATION.** The icon system is the *only* thing in `components/ui/` that ever
shipped, and it is universally adopted. The form-control layer the audit describes was
either never built or was removed, and the audit was never corrected. Its "Remaining
(intentionally not done)" §2 — *"Migrate remaining bespoke buttons/inputs onto
`components/ui/` primitives"* — is therefore an instruction to migrate onto components
that do not exist. This is the `lesson_a_comment_naming_a_mechanism_is_a_claim_about_a_run`
shape: a doc naming a mechanism nobody re-measured.

**RELEVANCE TO UCT.** Terminal-Next cannot "reuse the existing UI kit" — there isn't one
at the control level. What it *can* reuse is (a) `UIcon`, (b) the token system in
`styles/tokens.css`, (c) `research-kit`, (d) the whole `/charts` workspace machinery.
Budget for building the control layer, not for adopting it.

**CONFIDENCE.** 🟢 high — this is a directory listing against a written claim.

**RECOMMENDATION.** Treat `docs/ui-consistency-audit.md` as historical, not normative.
If Terminal-Next needs a control layer, build it once, in one directory, and make the
audit doc derive its roster from the directory rather than restating it.

**OPEN QUESTION.** Did the `components/ui/` control primitives ever exist and get
deleted, or was the audit aspirational when written? (`git log` on that path shows only
UIcon-touching commits in the last three — a fuller history walk would settle it.)

---

## 1. The `/charts` workspace (Contract Q1)

### 1.1 The widget registry is the single strongest primitive in the codebase

**OBSERVATION.** `app/src/widgets/registry.js` (706 lines) is a **metadata-only,
deep-frozen** registry of 18 widget types. It deliberately imports no components, no
hosts and no CSS, so any host — the `/charts` board, the journal notebook, a phone shell,
or a future Terminal-Next shell — can read it without pulling widget code into its bundle.
Hosts own their own id→component binding map.

**EVIDENCE.**
- `app/src/widgets/registry.js:149 WIDGET_REGISTRY = deepFreeze({…})`. The 18 ids, in declaration order: `chart, watchlist, themes, scanner, fundamentals, breadth, aisearch, news, notebook, profile, alerts, calendar, optionsflow, periodsort, nhnl, nhnlPulse, volumescan, scatter`.
- The count is pinned, not typed: `app/src/widgets/registry.test.js:41` — `it('registers exactly the 18 workspace widget types, in menu order')`.
- Per-entry fields: `labels.{header,menu,tab}` · `defaults {w,h,minW,minH}` in 24-col units · `placement {family: 'chart'|'panel', fill: 'wide'|'narrow', dock?}` · `menus {workspace, tab, mobile, journal}` · `themeFollow` · `paramsSchema[]` · `plainText(params)` · `reconstructable` · `liveCapable`.
- Derived exports at `registry.js:520-527`: `WIDGET_IDS`, `WORKSPACE_MENU_TYPES`, `TAB_MENU_TYPES`, `MOBILE_MENU_TYPES`, `JOURNAL_MENU_TYPES`, `THEME_FOLLOW_TYPES`. Plus `WIDGET_CATEGORIES` (`:536`), `WIDGET_CATALOG` (`:553`, icon + blurb per type), `catalogMeta` (`:574`), `menuGroups` (`:587`), `labelMap` (`:596`), `widgetMeta` (`:603`), `normalizeParams` (`:646`), `validateParams` (`:660`), `paramsPlainText` (`:692`), `isReconstructable` (`:700`).
- The `/charts` binding lives at `app/src/pages/charts/WidgetHost.jsx:44 WORKSPACE_WIDGETS` — 18 entries, each `{component, props}`. `registry.test.js:164` pins that every registry id has a binding; `:174` pins the exact prop shape each builder passes (breadth takes no `color`; themes takes no `onOptsChange`; aisearch takes only `color`; only chart gets `chartId`).
- `NotebookWidget` is the ONLY lazy binding (`WidgetHost.jsx:12`, `lazy(() => import('./widgets/NotebookWidget'))`) — to keep TipTap out of the base charts chunk. Every other widget is eagerly imported into the `/charts` chunk.

**INTERPRETATION.** This is a genuine plug-in architecture with a two-file contract
(registry entry + host binding line) and an AST-free structural test that fails when the
two drift. The `paramsSchema` layer is a second, orthogonal achievement: it defines what
a *frozen snapshot* of each widget stores, and classifies each widget into one of three
durability regimes (re-fetch / payload freeze / image-only). That is exactly the
serialization problem a terminal has to solve for saved workspaces, shared layouts and
embedded captures.

**RELEVANCE TO UCT.** Terminal-Next should adopt `registry.js` essentially unchanged as
its widget/panel manifest. It is the only artifact in the frontend designed from the
outset to serve multiple hosts. The `menus.*` flags already model per-shell availability,
which is precisely the "which panels exist on which surface" question a new shell asks.

**CONFIDENCE.** 🟢 high.

**RECOMMENDATION.** Add a `menus.terminal` flag rather than forking the registry.
Resist adding component refs to it — the no-component-imports rule is what makes it
portable, and it is stated in the file header as a deliberate constraint.

**OPEN QUESTION.** `defaults` are expressed in 24-column react-grid-layout units. If
Terminal-Next uses a different grid (dock/split-pane), these numbers need a translation
layer or a second unit system. Which?

### 1.2 Grid configuration — a *viewport-locked* board, not an infinite canvas

**OBSERVATION.** The board is a fixed 24 × 20 cell field that always exactly fills the
visible viewport. It never scrolls. Row height is computed as a **fractional** float from
a `ResizeObserver` measurement, deliberately un-rounded.

**EVIDENCE.**
- `ChartsWorkspace.jsx:52 GRID_COLS = 24` (migrated from 12; `parseLayout` at `:297` doubles legacy `x`/`w` once per user and stamps `cols: 24`).
- `ChartsWorkspace.jsx:63 COLS = {lg,md,sm,xs,xxs: 24}` — **every breakpoint has the same column count on purpose.** The in-file comment (`:56-62`) records why: a narrowing ladder made RGL re-map x/w to the narrower grid, fire `onLayoutChange` with the squeezed coords, and the single persisted layout got overwritten irreversibly.
- `ChartsWorkspace.jsx:64 BREAKPOINTS = {lg:1200, md:996, sm:768, xs:480, xxs:0}` — RGL's defaults, now inert given constant cols.
- `app/src/pages/charts/rowHeight.js:8 FIXED_ROWS = 20`, `:9 MARGIN_Y = 6`, `:10 BODY_PAD = 6`. `computeRowHeight(clientHeight, merged)` returns an exact quotient (`Math.max(12, available / FIXED_ROWS)`), with a written rationale that FLOOR leaves a fat gap above the taskbar and CEIL shears a chart's date axis off.
- RGL props (`ChartsWorkspace.jsx:2134-2196`): `maxRows={20}` · `isBounded={false}` · `compactType={null}` (free placement — no vertical compaction) · `preventCollision={false}` · `allowOverlap={!!onDragStop}` (main board only) · `margin={[gridGap, gridGap]}` · `resizeHandles={['nw','ne','sw','se']}` · `draggableHandle=".charts-widget-drag-handle"` · `draggableCancel="button, input, textarea, a, select, [role=tab], .charts-no-drag"` · `useCSSTransforms={false}`.
- `useCSSTransforms={false}` is load-bearing and documented: transform-positioned items composite each chart `<canvas>` onto a GPU layer that resamples at non-integer device-pixel offsets under fractional Windows display scaling, blurring the candles.
- RGL's own resize is **off** on the main board (`isResizable={!merged && !h.onStartResize}`); custom `onPointerDown` handles are rendered per widget (`ChartsWorkspace.jsx:2226-2240`, `CUSTOM_RESIZE_HANDLES`). Popped-out boards keep RGL's built-in resize.
- Drag semantics: nothing moves during a drag (`allowOverlap`); the board re-tiles exactly once on drop via `repackAroundMoved` (`ChartsWorkspace.jsx:381`, unit-tested in `repackAroundMoved.test.js`).

⚠️ CLAUDE.md's "Charts Hub V2" section says `cols={12}` and `margin=[6,6]`,
`compactType: 'vertical'`. Two of three are stale: cols is 24 and compaction is `null`.
Margin is right. Treat that section as a CLAIM.

**INTERPRETATION.** This is a *terminal* grid, not a dashboard grid: fixed rows, no page
scroll, free placement, drop-and-repack. The hard parts (fractional row math, the
one-arrangement/constant-cols invariant, the crisp-canvas positioning fix) are solved and
have written rationales attached to them.

**RELEVANCE TO UCT.** Directly transplantable. Terminal-Next's board can be this board.
The three invariants worth carrying verbatim: constant cols across breakpoints, fractional
row height, `useCSSTransforms={false}` wherever a canvas is inside a grid item.

**CONFIDENCE.** 🟢 high (source), 🟡 on whether the crisp-canvas fix still matters on
current Chrome — that was a browser-behaviour observation I could not re-run.

**RECOMMENDATION.** Keep `rowHeight.js` as its own module (it already is) so a second
board — popped-out window, Terminal-Next shell — runs identical math. The file header
states this is exactly why it was extracted.

**OPEN QUESTION.** 20 rows × 24 cols is a viewport-lock, not a workspace. Professional
terminals often want *more board than screen* (scrollable/paged boards, or virtual
desktops). Does Terminal-Next accept the viewport-lock?

### 1.3 Linked context: four colour groups, plus an explicit "not linked"

**OBSERVATION.** Widgets share a symbol through one of four colour groups (A/B/C/D) or
opt out with `'N'`. There is **no** symbol-agnostic context bus beyond this: linking is
purely `groupSyms[color]`.

**EVIDENCE.**
- `app/src/pages/charts/WorkspaceContext.jsx` — the context value shape: `groupSyms {A,B,C,D}` · `setGroupSym(color, sym)` · `chartsTheme` · `crosshairBus {emit, subscribe}` · `aiSearchBus {subscribe, request}` · `activeChartRef` · `periodSortMode`/`onPeriodSelected`/`onPeriodCancel` · `replayCutoff`/`exitReplay`/`replayArmPick`/`onReplayCutoffPicked` · `startMarker`/`startMarkerStyle` · `floatNewWidget` · `applyThemeToAllCharts` · `applyThemeToAllWidgets`.
- `WidgetHost.jsx:71-77`: `const key = color === 'N' ? \`N:${groupId}\` : color` — an unlinked widget gets a private group key derived from its per-tab id, so two "not linked" tabs in one slot stay independent.
- `ChartsSymContext.jsx` is a V1 compatibility shim: explicit Provider → WorkspaceContext Group A → null. That is why `Watchlists` / `ThemeTrackerPage` / `Screener` still work unmodified.
- `setPref('charts_workspace_groups', …)` at `ChartsWorkspace.jsx:770` persists the four group symbols, debounced separately from the layout.
- `useWorkspace()` has 28 consumers (`grep -rln useWorkspace app/src`), all inside `pages/charts/`. `WORKSPACE_FALLBACK` is exported so hosts outside `/charts` (e.g. `/ai-search`) can provide one real member without hand-copying the shape.

**INTERPRETATION.** The link model is one-dimensional: a *symbol*. There is no shared
timeframe group, no shared date/replay group per-colour (replay is board-wide, a single
`replayCutoff`), and no shared filter/universe context. Crosshair is a separate bus. For a
terminal, symbol-only linking is the table stakes; time-linking and filter-linking are the
common next asks and are absent.

**RELEVANCE TO UCT.** Four groups is a hard ceiling that already shows: `GridChartCell`
is composed on `StockChart` directly rather than on `ChartWidget` *specifically because*
"color groups cap at 4 independent syms" (CLAUDE.md Multi-Chart section, and
`grid/GridChartCell.jsx` composes StockChart, not ChartWidget — CONFIRMED by import).
Terminal-Next will hit the same wall.

**CONFIDENCE.** 🟢 high.

**RECOMMENDATION.** Generalise the link key from a colour letter to a *channel* record
(`{id, symbol?, tf?, range?, universe?}`) before Terminal-Next ships panels. The `'N'`
escape already proves the code path tolerates a non-letter key.

**OPEN QUESTION.** `crosshairBus` and `aiSearchBus` are ad-hoc members of the same
context. Should Terminal-Next have one typed event bus instead of N named buses on a
context object?

### 1.4 Persistence keys

**OBSERVATION.** Workspace state is spread across **14 server-side preference keys**,
plus at least one localStorage key for column layout. D-11 owns the schema; this is the
inventory of key *names* and which module writes each.

**EVIDENCE.** `grep -rhoE "setPref\('[a-zA-Z_0-9]+'" app/src/pages/charts/` yields, all
written from `pages/charts/`:

| Pref key | What it holds |
|---|---|
| `charts_workspace_layout` | the board: `{widgets[], cols}` — position, size, type, colour, per-widget `opts` |
| `charts_workspace_groups` | the four group symbols |
| `chart_settings` | the GLOBAL chart look (a SEED, see below) |
| `chart_saved_colors` | user colour swatches |
| `charts_active_template` | which named layout is loaded |
| `charts_merged` | merged (seamless) board mode on/off |
| `charts_theme` | workspace chart theme (`'default'` \| `'sunrise'`) |
| `charts_vol_pane_pct` | volume pane height |
| `multichart_state` | the N×M grid mode's working state |
| `watchlist_settings`, `theme_tracker_settings`, `fundamentals_settings`, `breadth_widget_settings`, `volume_scan_lists` | per-widget-TYPE global defaults |

Reads also touch `prefs.aisearch_settings` and `prefs.theme`.

- **`chart_settings` is a SEED, not the live value — CONFIRMED in code, not just memory.** `ChartsWorkspace.jsx:1265` — *"chart_settings blob is the SEED an un-customized surface inherits"* — and `:1273`/`:1303` read `const seed = mergeChartSettings(prefs.chart_settings)` when *creating* a widget's opts. The live per-widget value is `widget.opts.settings`, persisted inside `charts_workspace_layout`. `themeNewWidgetOpts(type, newOpts, storedTheme, mergeChartSettings(prefs.chart_settings))` at `:1484` and `:1577` is the stamping point.
- Named layouts are a *different* store: `useChartLayouts.js` → `GET/POST/DELETE /api/charts/layouts`, returning `{global: [], mine: []}`; admin-built prebuilt templates are global.
- Column layout for the watchlist table is localStorage, not a pref: `WL_COLS_LS` imported from `pages/watchlist/watchlistTemplates` (`Watchlists.jsx:78`), and the registry's `watchlist.paramsSchema` explicitly notes `cols` "lives in localStorage, NOT opts — freeze it".
- Versioning: the layout blob carries **no version field**. `parseLayout` (`ChartsWorkspace.jsx:297`) does two *inferred* migrations — 12→24 cols detected by `cols !== 24`, and a legacy-height auto-fit detected by `maxBottom <= FIXED_ROWS/2`. By contrast the chart-settings blob DOES carry `settingsVersion` (`ChartsWorkspace.jsx:236-242`, `uctDefaultChartSettings()`).

**INTERPRETATION.** Two different disciplines coexist: chart settings are versioned;
layout is heuristically sniffed. The layout heuristics are one-way and lossy — the
`maxBottom <= FIXED_ROWS/2` rule will misfire on any *legitimate* future layout whose
widgets all sit in the top half of the board.

**RELEVANCE TO UCT.** Terminal-Next inherits fourteen keys with no umbrella. A shell that
adds panels will add more. Memory already records that `calendar_view_v3` /
`calendar_filters_v2` / `calendar_mystocks_sources` are persisted prefs whose *names* are
load-bearing; the same is true of every key above.

**CONFIDENCE.** 🟢 high on the key inventory. Schema detail deferred to D-11 by contract.

**RECOMMENDATION.** Stamp a `version` on `charts_workspace_layout` before Terminal-Next
touches it, and retire the `maxBottom` heuristic in the same commit that adds the stamp.

**OPEN QUESTION.** Does the terminal want ONE workspace document (one key, versioned) or
the current fourteen? A single document also fixes the ordering problem
`usePreferences`'s per-key write chain currently works around.

### 1.5 Widget-level tabs, floating, pop-out, merged mode, multi-chart grid

**OBSERVATION.** The board has five composition modes beyond plain grid placement, all
already shipped.

**EVIDENCE.**
- **Tabs inside a slot** — `pages/charts/widgetTabs.js` (pure reducer). Tab 0 is the slot's base widget (byte-unchanged legacy shape); extra tabs live in `widget.wtabs`, `widget.activeWtab` indexes `[base, ...wtabs]`. Every mutation returns a new widget object. `WidgetHost.jsx:88-100` routes colour/opts edits to the active tab via `patchActiveTabColor` / `patchActiveTabOpts`. A per-tab `groupId` (`${widget.id}:${active.tabId}`) keeps two "not linked" tabs independent.
- **Chart-profile tabs INSIDE the chart widget** — a separate, parallel module `pages/charts/chartTabs.js`.
- **Float** — `FloatingWidgetPanel.jsx` + `onFloat`/`onDock`/`onFloatToTab` on `WidgetHost`: a widget pops out of the grid and floats over the canvas (TC2000-style), and can be dropped into another slot as a tab.
- **Pop-out to a real OS window** — `pages/charts/popout/PopoutWindow.jsx`. It is a **React portal into `window.open`**, not a second app: state/hooks/effects stay in the opener's JS context, only DOM nodes live in the other window. The file states the reason explicitly: every popped window shares the ONE browser-wide SSE pool (`priceStreamManager` / `barsStreamManager`), so ten popped widgets across three monitors cost the backend what one tab costs. Trade-off documented: a popped window dies with its opener.
- **Merged (seamless) mode** — `mergedSeams.js` + `MergedSeamOverlay.jsx`. Borders and headers vanish; shared edges become draggable *seams*; a widget with all four edges free stays independently draggable via `freeEdgesFor` (`ChartsWorkspace.jsx:2119`) and gets a `⠿` grip.
- **Multi-Chart grid mode** — `pages/charts/grid/` (23 files): fixed N×M CSS grid, `GRID_MAX_CELLS = 16` (`gridLayouts.js:13`), cells composed on `StockChart` directly, mount concurrency-limited by `useStaggeredMount` (`limit = 3`, `slotTimeoutMs = 5000`), container-driven warm through `prefetchGridWarm` on the bounded IDB queue.

**INTERPRETATION.** The pop-out portal is the single most terminal-shaped thing in this
codebase and the least likely to be rebuilt correctly from scratch: it gets multi-monitor
for free *without* multiplying server streams. That is a hard problem most competitors
solve by spawning a second app instance.

**RELEVANCE TO UCT.** Multi-monitor is table stakes for a professional terminal.
`PopoutWindow` already delivers it, at zero backend cost, today.

**CONFIDENCE.** 🟢 high on structure. 🟡 on the "ten windows cost what one tab costs"
claim — that is a design statement in the file, not a measurement I ran. It follows from
the portal architecture, so it is well-founded, but D-05 owns the measurement.

**RECOMMENDATION.** Make the pop-out the *default* multi-monitor story for Terminal-Next
and fix its one known limitation (dies with the opener) only if users complain — a second
app instance re-introduces the stream multiplication the portal exists to avoid.

**OPEN QUESTION.** Popup blockers. `PopoutWindow` takes an `onBlocked` callback, so the
failure path is handled — but what does a first-run user see, and is that acceptable for
a paid terminal?

### 1.6 How widgets embed other pages' data — three distinct strategies

**OBSERVATION.** The 18 widgets are not homogeneous. They fall into three groups by how
they get their content, and this matters for anyone estimating "how much of `/charts`
transplants".

**EVIDENCE.**

| Strategy | Widgets | Mechanism |
|---|---|---|
| **Wrap a whole page** with an `embedded` prop | `watchlist` (wraps `pages/Watchlists`), `themes` (wraps `pages/ThemeTrackerPage`) | `Watchlists.jsx:535` takes 20 props incl. `embedded`, `activeRef`, `widgetKey`, `settingsOverride`, `colStorageKey`, `scanSymbols`; `:2147` applies `styles.pageEmbedded`; `:2427` hides the standalone right panel |
| **Bespoke widget, shared data module** | `calendar`, `breadth`, `news`, `fundamentals`, `profile`, `alerts`, `optionsflow`, `nhnl`, `nhnlPulse`, `volumescan`, `scatter`, `periodsort` | Own component; imports the page's *pure* helpers. E.g. `CalendarWidget.jsx:31` imports `mondayOf`/`lastSessionDay` from `pages/calendar/weekAnchor` — and an AST rail (`CalendarWidget.weekIntent.test.jsx`) fails on any locally-declared week derivation |
| **Composed on a lower primitive** | `chart` (composes `ChartPane`), `scanner` (`ScannerPicker` + `ScannerResults`), `aisearch`, `notebook` | No page involved |

- `.widgetBody` is the `container-type: inline-size` root; embedded pages respond to the WIDGET's width via `@container`, not `@media`.
- Widget line counts (non-test): `AiSearchWidget` 1251 · `ChartWidget` 719 · `BreadthWidget` 581 · `ScatterWidget` 523 · `OptionsFlowWidget` 501 · `CalendarWidget` 497 · `NotebookWidget` 420 · `NewsWidget` 374. Total `pages/charts/widgets/` non-test: ~13,520 lines.

**INTERPRETATION.** The "wrap a page" strategy was used twice and then abandoned in favour
of bespoke widgets sharing pure helper modules. That is the right direction — the wrapped
pages carry 20-prop signatures and `embedded &&` branches through 2,700 lines — but it
means most widgets are *not* thin views over a page; they are second implementations that
happen to share a data module and endpoints. Notably `CalendarWidget` is a genuinely
separate renderer from `/calendar` (TERMINAL-CURRENT), sharing only `weekAnchor` and
`/api/calendar/*`.

**RELEVANCE TO UCT.** Estimating Terminal-Next as "reuse the widgets" is safe. Estimating
`/calendar`'s feature depth as "already available as a widget" is NOT — the calendar
widget renders one day, market-wide, with prev/next navigation, and the registry entry
says so verbatim (*"The widget renders ONE DAY (the week is only the fetch granularity)"*).

**CONFIDENCE.** 🟢 high.

**RECOMMENDATION.** Do not extend the "wrap a page with `embedded`" pattern. The two
existing cases should be the last two.

**OPEN QUESTION.** `AiSearchWidget` at 1,251 lines is the largest widget and duplicates
much of `/ai-search`. Is that a second implementation or the primary one?

### 1.7 Empty / error / loading states — and the missing per-widget boundary

**OBSERVATION.** 🔴 **There is no per-widget error boundary on the `/charts` board.** A
widget that throws during render takes the entire workspace down to the app-level
`RouteErrorBoundary`.

**EVIDENCE.**
- `grep -n "ErrorBoundary" app/src/pages/charts/ChartsWorkspace.jsx app/src/pages/charts/WidgetHost.jsx` → **no matches**. CONFIRMED.
- The app has exactly two boundary components — `components/ErrorBoundary.jsx` and `components/RouteErrorBoundary.jsx` — and five non-test mount sites: `App.jsx:302` (`RouteErrorBoundary`, wraps all routes), `components/tiles/CatalystFlow.jsx:164`, `pages/calendar/MyStocksHub.jsx:547`, `pages/Calendar.jsx:852`, `pages/Screener.jsx:84`. Plus a local class `ChartErrorBoundary` inside `pages/CotData.jsx:109` used at `:801`.
- `WidgetHost.jsx:76` handles an *unknown type* gracefully (`<div className={styles.unknownWidget}>Unknown widget type: {type}</div>`) and wraps the body in a `<Suspense>` with a "Loading…" fallback — but neither catches a throw.
- Empty/loading vocabulary exists but is not universal: `research-kit`'s `EmptyState` is imported by 23 non-test files; `components/Skeleton.jsx` (`SkeletonBlock`) by 45. The research-kit barrel explicitly bans a second `Skeleton`.

**INTERPRETATION.** This is the highest-severity structural gap I found for a terminal. On
a board where a user has arranged twelve panels, one bad payload from one provider blanks
the whole screen. It is also the cheapest fix in this report: one boundary inside
`WidgetHost`'s `WidgetBody`.

**RELEVANCE TO UCT.** A terminal's core promise is that panels are independent. Without a
per-widget boundary that promise is false at the render layer.

**CONFIDENCE.** 🟢 high that no boundary exists in the two files that would host one.
🟡 that no throw is possible another way — I did not trace every widget's render path,
and a widget that catches its own fetch errors will not throw. **EVIDENCE CEILING:** I
could not run the app to induce a throw; a browser repro (throw inside one widget, observe
whether the board survives) would raise this to CONFIRMED.

**RECOMMENDATION.** Add an error boundary in `WidgetBody` keyed on `groupId`, rendering
the widget's registry `labels.header` plus a Retry, before any Terminal-Next work. Pair it
with a rail that mounts a deliberately-throwing widget and asserts the siblings still
render — a boundary nobody has seen fire is not a boundary.

**OPEN QUESTION.** Should a crashed widget be *removable from the layout* by the boundary
UI, or only retryable? A widget that throws on every mount currently cannot be closed,
because its header is inside the subtree that fails.

### 1.8 Performance guards

**OBSERVATION.** Guards exist for the multi-chart grid; the widget board has none.

**EVIDENCE.**
- Grid: `GRID_MAX_CELLS = 16` hard cap (`gridLayouts.js:13`), clamped on every input path (`:31`, `:71`). `useStaggeredMount` bounds concurrent mounts to 3 with a 5s safety timer, and its header states the reason: a fixed `index*delay` stagger does NOT bound in-flight requests, which is the 2026-05-24 herd-incident condition.
- Board: `grep -n "MAX_WIDGETS\|widgets.length >" ChartsWorkspace.jsx` → **no matches**. There is no cap on how many widgets a user may place, and no staggered mount for them.
- SWR is globally configured in `App.jsx` (`revalidateOnFocus: false`, `dedupingInterval` 8s per CLAUDE.md — CLAIM, I did not re-read that block).
- Streams pool browser-wide: `lib/priceStreamManager.js` (Finnhub poll) and `lib/barsStreamManager.js` (Massive push) are separate pools by design.

**INTERPRETATION.** The board is bounded implicitly by geometry (20 rows × 24 cols, and
`minH` of 2-6 per type ⇒ realistically ~10-20 widgets), which is why no explicit cap was
needed. Terminal-Next with a scrolling or paged board would remove that implicit bound.

**RELEVANCE TO UCT.** If the viewport-lock is relaxed, a mount queue for widgets (not just
grid cells) becomes mandatory. The pattern already exists and is tested.

**CONFIDENCE.** 🟡 — the "geometry is the bound" inference is mine, not stated in code.

**RECOMMENDATION.** If Terminal-Next relaxes `FIXED_ROWS`, port `useStaggeredMount` to the
widget board in the same change.

**OPEN QUESTION.** What is the real per-widget cost at 20 widgets? NOT DETERMINED — D-05 owns it.

---

## 2. Shell and navigation (Contract Q2)

**OBSERVATION.** The shell is 109 lines. Nav is a 17-entry flat array bucketed by a
4-group taxonomy that is the single authority for both desktop and mobile.

**EVIDENCE.**
- `components/Layout.jsx` (109 lines) renders: `<TickerHubProvider>` → `<MoreSheetContext.Provider>` → `.shell` containing `<NavBar/>` (desktop, hidden ≤1024 by CSS), `<MobileNav onMenu/>` (shown ≤1024), `<main className={styles.main}>{children ?? <Outlet/>}</main>`, `<FeedbackWidget/>`, `<MoreSheet/>`, `<TickerHubSheet/>`.
- `Layout.module.css`: `.shell` is `overflow:hidden`, `.main` is `overflow-y:auto` — **the app scrolls an inner element, not `window`** (CLAUDE.md; consistent with the scroll-listener capture-phase requirement).
- Theme application lives in `Layout.jsx:56-76`: reads `prefs.theme`, writes a pre-paint cache (`writeThemeCache`), and either applies a UCT app theme's inline custom properties (`applyAppTheme`) or sets `el.dataset.theme` to `light` | `oled` | `dark`.
- `NavBar.jsx:16 NAV_ITEMS` — 17 entries, each `{to, label, icon}`. **`{to:'/calendar', label:'UCT Terminal', icon:'calendar'}` at `:23`** is the entire TERMINAL-CURRENT rename in this file. `NAV_ITEMS` is exported specifically so `navGroups.test.js` can verify bucketing without restating the list.
- `components/navGroups.js` (44 lines) — `NAV_GROUPS`: `home` (`/dashboard`, `/morning-wire`), `markets` (11 routes incl. `/calendar`), `charts` (`/charts`, `/watchlists`, `/theme-tracker`, `/model-book`, `/setup-library`), `journal` (`/journal`, `/community`, `/desk`, `/support`). Its header states `routes` doubles as a MATCH-PREFIX list and that `/catalysts` is deliberately a prefix that is **not** a route; `navGroups.route.test.jsx` asserts every navigated `to` resolves against `App.jsx` AND that `/catalysts` alone does not.
- `NavBar.jsx:47 GROUPED_NAV_ITEMS` buckets `NAV_ITEMS` under `NAV_GROUPS`; an unbucketed item falls into a headingless trailing group rather than vanishing.
- `FREE_PAGES = ['/morning-wire']` at `NavBar.jsx:38`, with an in-file note: *"Keep in sync with FREE_PAGES in AuthGuard.jsx + MoreSheet.jsx"* — three copies of one list.
- Mobile: one door. `MobileNav` top bar's menu button opens `MoreSheet` (the single comprehensive directory). The bottom `MobileTabBar` was removed 2026-09-01; `pages/charts/mobileShellHeight.test.js` guards against its resurrection.
- Icons: `UIcon` with an 85-key `ICONS` map, 273 non-test importers.
- Session cockpit: `components/dashboard/` — `ZoneDoors.jsx`, `ZoneRead.jsx`, `TheWeek.jsx`, `doors.js`, `useSessionState.js`, `sessionModel.js`. `sessionModel`/`nextOpenHint` are reused by `ChartMarketClock` in the charts header *specifically so the two can never disagree* (stated in `ChartMarketClock.jsx:5-7`).

**Touch points to register a new surface** (derived by walking the consumers, not typed
from a doc): (1) a `<Route>` in `App.jsx` inside the `AuthGuard` → `Layout` block;
(2) a `NAV_ITEMS` entry in `NavBar.jsx` with a `UIcon` name that exists in the `ICONS`
map; (3) a route string in the right `NAV_GROUPS` bucket in `navGroups.js` (or it lands in
the headingless bucket); (4) `MoreSheet.jsx` derives from `NAV_GROUPS`, so it follows —
but its own `FREE_PAGES` copy does not; (5) `AuthGuard.jsx`'s `FREE_PAGES` if the page is
free; (6) `tools/mobile_audit.py`'s hand-typed route list, which memory records as the
artifact that goes stale.

**INTERPRETATION.** Registering a surface is a 4-6 site edit with two of the sites being
hand-maintained duplicates of one list (`FREE_PAGES` ×3, the audit route list). The
taxonomy itself (`navGroups.js`) is exemplary — one authority, two consumers, a rail that
verifies both and a documented deliberate exception.

**RELEVANCE TO UCT.** If Terminal-Next is a *new surface in this shell*, it costs the six
edits above. If it is a new shell, `navGroups.js` is the one nav artifact worth carrying
over intact.

**CONFIDENCE.** 🟢 high on the file facts; 🟡 on the touch-point list being complete —
I derived it from consumers of `NAV_ITEMS`/`NAV_GROUPS`, and a surface with special
gating (admin, paid, dark-launch) has more.

**RECOMMENDATION.** Derive `FREE_PAGES` from one module before adding a Terminal-Next
entry. Three hand-copies of an entitlement list is the exact defect class this repo keeps
paying for.

**OPEN QUESTION.** Is Terminal-Next a route inside this shell (inherits NavBar/MoreSheet/
Layout scroll semantics/theme) or its own shell? The answer changes every estimate in §8.

---

## 3. Tables (Contract Q3)

**OBSERVATION.** There is **no shared table component**. Every dense-data surface has its
own implementation. Virtualization exists in exactly four files. The one documented
"reusable table primitive" — `components/mobile/ResponsiveTable.jsx` — has **zero
consumers**.

**EVIDENCE.**

| Surface | File | Impl | Virtualized | Column config | Sort | Keyboard | Export |
|---|---|---|---|---|---|---|---|
| Screener results | `pages/screener/shell/VirtualResults.jsx` (167 ln) | ARIA `grid` on CSS-grid rows | ✅ `useVirtualizer`, `estimateSize` 30/38 by density, `overscan:12` | `columnDefs.js` (462 ln, 157 columns) + `ColumnDesc` | ✅ `aria-sort`, live-value re-sort via `liveSort.js` | roving? not inspected | `screener/exportCsv.js` + `shell/csvExport.js` |
| Screener cards (phone) | `shell/ResultCards.jsx` | virtual cards | ✅ `estimateSize:64`, `overscan:8` | — | — | — | — |
| Watchlists | `pages/Watchlists.jsx` (2,699 ln) | bespoke | ✅ `estimateSize:30`, `overscan:12` (`:474`) | `colCfg {order, hidden, widths, sort}` in localStorage (`WL_COLS_LS`) + right-click COLUMNS menu | ✅ per-column | ✅ ↑/↓ + Space over `visibleSymsFlat` (`:1079`, `:1116-1180`), `scrollIntoView({block:'nearest'})` | ✅ CSV |
| Breadth monitor | `pages/Breadth.jsx` (1,523 ln) | `<table>` with `GROUP_SPANS.flatMap` | ✅ `MONITOR_ROW_H`, `overscan:14` (`:1033`) | column GROUPS collapse/expand | — | — | ✅ CSV |
| Journal trades / positions | `journal-2-0/components/{TradesTable,PositionsTable}.jsx` | `<table>` | ❌ | fixed | ✅ `aria-sort`, gold ▲/▼; shared `.thBtn`/`.sortCaret` CSS **duplicated in both modules** | ❌ | ❌ |
| UCT20 | `pages/UCT20.jsx` (628 ln) | cards + `aria-sort` | ❌ | — | ✅ | — | — |
| Options Flow | `pages/OptionsFlow.jsx` (9,263 ln, **partner-owned**) | bespoke, all inline styles | ❌ | own | own | — | — |
| Calendar day | `pages/calendar/CalendarDayTable.jsx` | `<table>` | ❌ | — | ✅ `aria-sort` | — | — |

- `@tanstack/react-virtual` importers, complete list: `pages/Breadth.jsx`, `pages/Watchlists.jsx`, `pages/screener/shell/ResultCards.jsx`, `pages/screener/shell/VirtualResults.jsx`. **Four files.**
- `aria-sort` appears in exactly five non-test files (listed above).
- `ResponsiveTable`: `grep -rn "ResponsiveTable" app/src` outside its own file+test returns **one line** — `components/mobile/index.js:3`, the barrel re-export. No consumer. It is described in CLAUDE.md as a shipped reusable primitive ("`<table>` on desktop; on phone either card mode or frozen-first-column scroll — pick per surface"). That is a CLAIM; the code says nobody picked.
- Live-update handling is per-surface: `VirtualResults` overlays `livePrices` per cell and re-sorts through `sortRowsLive` only for `price`/`chg_pct_1d` (`liveSort.js:4 LIVE_SORTABLE`), with `LIVE_WINDOW = 300`. Its header records a real constraint: rows are positioned by `top`, **never `transform`**, because a transformed ancestor breaks `position:sticky` on the ticker column.
- The screener's column layer is the most terminal-grade artifact here: 157 columns, 55 carrying a member-facing `desc` string, ONE reader (`shell/ColumnDesc.jsx`) rendering that text in BOTH the results header and the filter control, and `columnDescCoverage.test.js` as a ratchet holding the count.

**INTERPRETATION.** The screener shell is a *near*-primitive: virtualized ARIA grid,
declarative column defs with formatters/heat classifiers/descriptions, density modes,
live overlay, CSV export, load-more. It is coupled to screener row shapes and
`ScannerShell.module.css`, but the seams are clean. Nothing else is close: the journal
tables duplicate their own sort CSS in two modules, Watchlists has the best keyboard
model and the worst reuse story (2,700 lines, 20 props), and Options Flow is untouchable
by convention.

**RELEVANCE TO UCT.** A terminal is mostly tables. Building Terminal-Next on any of these
except the screener shell means re-solving virtualization, sticky columns, live overlay
and column customization from scratch — four times.

**CONFIDENCE.** 🟢 high on the inventory. 🟡 on keyboard-navigation completeness — I read
Watchlists' handler and `SectionRail`'s roving tabindex, but did not audit every table for
focus management. **EVIDENCE CEILING:** no browser run; a11y claims here are from
attributes in source, not from a screen reader or an axe pass.

**RECOMMENDATION.** Extract `VirtualResults` + `columnDefs` + `ColumnDesc` + `liveSort`
into a `components/datagrid/` primitive with the row shape as a parameter, and make
Terminal-Next its second consumer. Delete `ResponsiveTable` or adopt it — an exported,
documented, unused primitive teaches the next engineer that the orphan is the idiom.

**OPEN QUESTION.** Does Terminal-Next need frozen/pinned columns beyond the sticky first
column, column resize by drag (Watchlists has `widths` in `colCfg`; the screener does
not), and row grouping? None of the three exists in a shared form today.

---

## 4. Charts as components (Contract Q4)

**OBSERVATION.** There are two layers: `StockChart` (15,500 lines, ~120 props) and
`ChartPane` (the shell that 17 surfaces actually mount). `ChartPane` is the reusable unit.

**EVIDENCE.**
- `components/StockChart.jsx:1522 export default function StockChart({…})` — I counted **~120 named props**, including `sym, tf, height, markers, priceLines, showVolume, overlays, watermark*(13 props), showDrawingTools, onSymbolChange, entryDate, exitDate, liveUpdates, backgroundWarm, deepWarm, onBarsReady, onTfChange, hotkeysActive, compareSymbol, onCompareChange, onCrosshairMove, onTimeRangeChange, externalCrosshair, subscribeCrosshair, externalTimeRange, showSavedDrawings, settingsOverride, onSettingsPersist, replayCutoff, periodSelect, startMarker, canvasTheme, modelBookLook, …`.
- Direct `StockChart` importers (non-test, 11): `components/IntradayDayPopover.jsx`, `components/chart/pane/ChartPane.jsx`, `pages/ChartRender.jsx`, `pages/ModelBook.jsx`, `pages/ThemeTrackerPage.jsx`, `pages/admin/PatternReview.jsx`, `pages/charts/grid/GridChartCell.jsx`, `pages/modelbook/{BottomsView,SetupsView,shared/ChartExampleKit}.jsx`, `pages/screener/ChartsGallery.jsx`.
- `components/chart/pane/ChartPane.jsx` — its own docstring: *"the chart shell every surface mounts… It owns everything that is true of a chart no matter where it lives: the identity row, the timeframe bar, the meta strip, the settings resolution + modal, the focus surface with click-to-focus / type-to-search, and the StockChart itself with the reference (`/charts`) look."* Siblings: `ChartIdentityRow.jsx`, `ChartMetaRow.jsx`, `ChartTfBar.jsx`, `headerFit.js`, `ownChartSettings.js`, `useChartSurfaceSettings.js`.
- `ChartPane` importers (non-test, **17**): `chart/builder/editor/PreviewPane`, `mobile/TickerHubSheet`, `screener/ScanResults`, `TickerPopup`, `video/VideoDockSlot`, `pages/Breadth`, `pages/charts/mobile/MobileChartsApp`, `pages/charts/widgets/ChartWidget`, `pages/DarkPool`, `pages/DiscordActivity`, `journal-2-0/components/notebook/ChartEmbed`, `journal-2-0/.../PositionDetailPage`, `journal-2-0/.../TradeDetailPage`, `pages/OptionsFlow`, `pages/research/tabs/OverviewTab`, `pages/ThemeTrackerPage`, `pages/Watchlists`.
- ⚠️ **Carried debt, self-declared:** `ChartPane.jsx:36-38` — *"Phase-A carried debt: the pane still reads the charts workspace's CSS module rather than owning its own."* It imports `pages/charts/ChartsWorkspace.module.css`. So `ChartPane` is not yet independent of `/charts`.
- Multi-instance: proven. 16 cells in the grid, N widgets on the board, N popped windows — all sharing one SSE pool per stream family. `GridChartCell` is `React.memo`'d and controlled (`{id, sym, tf, chartType}`), composed on `StockChart` *not* `ChartWidget` because colour groups cap at 4.
- Compare mode: `compareSymbol`/`onCompareChange`/`hideCompare` props + `pages/charts/CompareSymbolsPanel.jsx` + `components/chart/ComparisonPicker.jsx`.
- Export/share: `utils/chartCapture.js` — `captureChartPng(wrapperEl)` composites every `<canvas>` in a wrapper at true device scale (reads the real scale from a canvas, NOT `window.devicePixelRatio`, because those disagree under fractional Windows scaling). Plus the `/r/chart` render route (`pages/ChartRender.jsx`) — a headless screenshot door used by the chart-renderer service.
- Indicator engine: `components/chart/engine/` with an AST layer (`ast/pine.js` 7,218 ln, `ast/thinkscript.js` 4,728, `ast/interpret.js` 2,809, `ast/pcf.js` 1,935), `nativeRegistry.js` (2,270), `defSchema.js` (2,002). `ChartDrawingOverlay.jsx` is 3,263 lines.
- Chart library: `lightweight-charts@5.2.0`. COT charts are Chart.js (`react-chartjs-2`); research-kit charts are ECharts through one `echartsCore.js`; `recharts` is also a dependency. **Four charting libraries ship.**

**INTERPRETATION.** `ChartPane` is a real, widely-adopted chart primitive and is the
correct Terminal-Next building block. `StockChart` beneath it is a 15,500-line
single-file component with a ~120-prop interface — the largest single piece of debt in the
frontend, and the thing that makes every chart change expensive. It is also, empirically,
extremely load-bearing and heavily railed (e.g. `singleWriterIndex.test.js` derives the
developing-bar writer set from the file's AST).

**RELEVANCE TO UCT.** Terminal-Next gets charts for free by mounting `ChartPane`. It does
NOT get a maintainable chart component — that is a separate, large project.

**CONFIDENCE.** 🟢 high on structure and adoption. 🟡 on the prop count (~120 by my count
of the destructured names; a parser would be exact).

**RECOMMENDATION.** Mount `ChartPane`, never `StockChart`, from Terminal-Next. Finish the
Phase-C CSS extraction (`ChartPane` owning its own module) first, or Terminal-Next imports
`/charts`' stylesheet transitively. Do not attempt a `StockChart` rewrite as part of
Terminal-Next scope.

**OPEN QUESTION.** Four charting libraries (lightweight-charts, ECharts, Chart.js,
recharts) is a bundle and a consistency problem. Which does Terminal-Next standardise on
for non-price visuals? (D-05 owns the bundle cost; the *consistency* question is a design
decision nobody has recorded.)

---

## 5. Search and command surfaces (Contract Q5)

**OBSERVATION.** There is a good ticker autocomplete and **no global command palette**.
The one component named `CommandPalette` is a private function inside `Settings.jsx` that
searches settings only.

**EVIDENCE.**
- `components/chart/SymbolSearch.jsx` — the ticker autocomplete. Imported by 11 non-test files: `chart/pane/ChartIdentityRow`, `chart/pane/ChartPane`, `StockChart`, `watchlist/TickerCombobox`, `charts/grid/GridChartCell`, `charts/mobile/MobileSymbolSheet`, `charts/widgets/FundamentalsWidget`, `research/ResearchHeader`, `ThemeTrackerPage`, `Watchlists`. Backed by `GET /api/ticker-search`. Exposes an imperative `openWith(text)` via `forwardRef`+`useImperativeHandle`, consumed by ChartWidget's type-to-search.
- `pages/Settings.jsx:2416 function CommandPalette({onClose, onPick})` — local, filters a `SEARCH_INDEX` of settings cards, `role="dialog" aria-label="Jump to setting"`, ↑/↓/Enter/Esc. Rendered at `Settings.jsx:2402`. It is a settings jump-list, not an app command palette. `grep -rln "CommandPalette\|cmdk\|GlobalSearch" app/src` returns only `Settings.jsx`.
- `pages/AiSearchPage` + `charts/widgets/AiSearchWidget.jsx` (1,251 ln) — a conversational search surface, wired into the workspace through `aiSearchBus` on `WorkspaceContext` so a deep-link appends a turn to a mounted widget instead of remounting it.
- **Keyboard: two disjoint systems.**
  - `react-hotkeys-hook` is used in **journal-2-0 only** — `JournalLayout.jsx` (`shift+/` help, `g>o`…`g>c` chords), `JournalTwoRoot.jsx` (same chord set for nested tabs), `OpenPositionsTab.jsx` (`a`, `c`), `TradeJournalTab.jsx` (`t`, `c`), `LogTradeButton.jsx`. Nowhere else.
  - Charts use a hand-rolled table: `components/chart/keyboardShortcuts.js` (444 ln) with `SHORTCUTS[]`, `INDICATOR_CHORDS` (4 chords declared once, frozen), `TF_ORDER`, `resolveTfCycle`, `matchShortcut`, `matchOverlayTool`. **Physical keys, not characters:** each chord carries `code` (`'KeyI'`) alongside its display `keys`.
  - **The Shift+F collision is FIXED and documented in place** — `keyboardShortcuts.js`, in the SHORTCUTS table: *"⛔ THESE TWO MOVED OFF `Shift+<letter>` ON 2026-08-28. `Shift+F` armed the Fibonacci extension and `Shift+P` the pitchfork, straight into the **flag-the-selected-ticker** chord every list surface binds."* They are now `Alt+E` (fibext, in the tool block) and `Alt+Y` (pitchfork).
  - Ownership arbitration: `WorkspaceContext.activeChartRef` holds the last-hovered chart widget id; `ChartWidget.jsx:477` passes `hotkeysActive`. The parallel rule for list widgets is railed by `pages/charts/widgets/widgetKeyboardOwnership.test.js` — a SOURCE rail asserting `widgetKey` and `activeRef` always travel together, written after `ScannerResults`/`PeriodSortResults`/`EtfHoldingsResults` each passed `widgetKey` alone and one Shift+F flagged a ticker in two widgets at once.
  - `Alt` chords are deliberately NOT matched by `matchShortcut` (so browser Alt shortcuts survive); `StockChart`'s own `e.altKey` block is the live handler and reads the same table for its `code`.

**INTERPRETATION.** The chart keyboard layer is more sophisticated than the app's — layout-
independent codes, a declared-once chord table, a cycle resolver, and an ownership ref. The
*app* has no keyboard model at all outside the journal. A terminal needs one command
surface and one binding registry; today there are two binding systems and zero global
command surfaces.

**RELEVANCE TO UCT.** "Command palette" is one of the most-cited terminal affordances.
Terminal-Next would be building it from scratch, but `Settings.jsx`'s local palette is a
usable interaction template and `keyboardShortcuts.js` is a usable binding-table template.

**CONFIDENCE.** 🟢 high.

**RECOMMENDATION.** Promote one binding registry (the chart one's `code`-based shape) to
app scope, and build the palette on top of it so every command is discoverable by the same
list that binds it. Do not add a third binding system.

**OPEN QUESTION.** `react-hotkeys-hook` is a dependency used by five journal files. Keep
it and migrate charts onto it, or drop it and generalise `keyboardShortcuts.js`? Nobody has
decided; both systems are actively maintained.

---

## 6. Modals and overlays (Contract Q6)

**OBSERVATION.** Three coexisting modal idioms: `Sheet` (the responsive primitive, ~30
consumers), the journal's `ModalShell.module.css` (CSS-only, 10 consumers, journal-only),
and bespoke `role="dialog"` divs (56 non-test files declare one). Focus trapping reaches 6
files.

**EVIDENCE.**
- `components/mobile/Sheet.jsx` — portal + focus trap + Escape + drag-to-dismiss +
  body-scroll-lock + safe-area. `variant: 'auto'|'modal'|'bottom-sheet'|'fullscreen'`;
  `auto` = centered modal on desktop, bottom-sheet on touch (via `useIsTouch`). Documented
  z-index contract: it sits on the shared `--z-modal` (1000) rung that the whole mobile
  stack relies on; a per-instance `zIndex` override exists for `ChartContextMenu` only,
  because that can open from inside `TickerPopup` whose overlay sits above `--z-modal`.
  ~30 non-test importers spanning charts, screener, calendar, desk, modelbook, journal.
- `journal-2-0/components/ModalShell.module.css` — a stylesheet, **not a component**
  (`find app/src -name ModalShell.jsx` → nothing). 10 importers, all journal. So the
  journal's 8 modals share a look but not a behaviour: each re-implements open/close/focus.
- `useFocusTrap` consumers (6, non-test): `chart/builder/BuilderSheet`,
  `chart/IndicatorSettingsDialog`, `mobile/ContextPopover`, `mobile/Sheet`,
  `research/EarningsResearchModal`, `research/sections/StatementPanels`. **56 files declare
  `role="dialog"`.** So ~50 dialogs have no trap.
- `createPortal` in 31 non-test files.
- **The earnings modal is the design-forward one.** `components/research/EarningsResearchModal.jsx` (403 ln): phone branch renders inside `Sheet variant="bottom-sheet"` (which traps through the same `useFocusTrap`); desktop branch is a bare `role="dialog"` of its own with `useFocusTrap(!isPhone, panelRef)` — the file states it is *"the ONLY surface"* doing that. Section navigation via `research-kit`'s `SectionRail` (roving tabindex, ArrowUp/Down/Left/Right, Home/End, `aria-controls` stamped only on the active tab because inactive panels are unmounted).
- **Token island — memory's `--glass-*` claim, verified with a correction.** The `--glass-*` tokens are used by `components/research/**` AND `components/research-kit/**` — 20+ stylesheets, not one surface. But `research-kit` *is* the earnings-modal/research-page kit, so the spirit of the claim holds: `--glass-*` belongs to the research family. The modal's own SHELL is pinned to `--menu-*` (theme-invariant) while its CONTENT reads `--text`/`--glass-*`/`--gain`/`--loss` off `:root`.
  `EarningsResearchModal.themeIsland.test.js` records the measured failure: at
  `data-theme="light"`, **20 of 20 sampled text nodes measured contrast 1.00** —
  rgb(11,14,17) ink on rgb(14,14,16) panel, i.e. invisible. The rail now DERIVES the token
  list by re-reading `tokens.css` every run rather than holding a typed roster.
- Fixed 720px: NOT VERIFIED in this pass. I did not open `EarningsResearchModal.module.css`
  and cannot confirm the width literal. (D-09 owns calendar feature semantics; the width is
  a design token question that should be re-measured, not quoted.)

**INTERPRETATION.** The overlay layer is the least consolidated part of the UI. The one
genuinely reusable piece (`Sheet`) is well-adopted; the accessibility floor beneath it is
not (50 untrapped dialogs). The theme-island incident is the most instructive datum in this
whole report: pinning a container to theme-invariant tokens ORPHANED its descendants, and
13,629 green tests did not see it — only a browser measurement did.

**RELEVANCE TO UCT.** Terminal-Next will add dialogs. If it adds them the bespoke way, it
adds to the 50. `Sheet` + `useFocusTrap` is the answer that already exists.

**CONFIDENCE.** 🟢 on counts; 🔴 on the 720px claim (not inspected).

**RECOMMENDATION.** Make `Sheet` mandatory for new overlays in Terminal-Next and port the
derived-token-island rail to any surface that pins container tokens.

**OPEN QUESTION.** Should `ModalShell.module.css` become a real component so the journal's
10 dialogs inherit `Sheet`'s trap and Escape handling, or should the journal migrate to
`Sheet` directly?

---

## 7. Density, theme, tokens (Contract Q7)

**OBSERVATION.** A single, well-organised 572-line token file with **three** theme blocks,
plus an 18-theme skin catalog applied as inline custom properties. Number formatting is
NOT centralised: 118 files define their own `fmt*` helper.

**EVIDENCE.**
- `app/src/styles/tokens.css`, 572 lines, exactly four top-level blocks:
  `:root` (`:12`), `[data-theme="oled"]` (`:338`), `[data-theme="light"]` (`:371`),
  `@media (prefers-reduced-motion: reduce)` (`:542`). **There is no `[data-theme="dim"]`**
  — `docs/brand-design-system.md` §7.3 documents "Dim — `[data-theme=dim]`" and is stale.
  `Layout.jsx:56-70` states the legacy `midnight`/`dim`/`system` values were removed
  2026-08-23 and now resolve to OLED.
- Token families present (from the full name list): brand (`--ut-gold*`, `--ut-green*`,
  `--ut-red*`, `--ut-cream`), surfaces (`--bg`, `--bg-base`, `--bg-surface`,
  `--bg-elevated`, `--bg-hover`), borders, text (7 rungs: `--text`, `--text-bright`,
  `--text-dim`, `--text-faint`, `--text-muted`, `--text-primary`, `--text-secondary`,
  `--text-heading`), type scale (`--text-xs`…`--text-3xl`, `--text-display`), fonts
  (`--font-sans`, `--font-mono`, `--font-heading`, `--font-display`), spacing
  (`--space-xs`…`--space-3xl`), radii/shadows (`--shadow-sm/md/lg/modal/popover`), motion
  (`--duration-fast/normal/slow`, `--ease-out`, `--ease-in-out`), z-scale (`--z-base`,
  `--z-sticky`, `--z-nav`, `--z-dropdown`, `--z-backdrop`, `--z-modal`, `--z-drawer`,
  `--z-fab`, `--z-toast`), controls (`--control-font`, `--control-pad-x/y`,
  `--control-radius`), `--focus-ring`, `--tap-min: 44px` (`:262`).
- **Semantics for a terminal, already tokenized:** `--gain: #2faf68` / `--loss: #df4646`
  with `-bg`/`-border` variants (`:52-57`), re-aliased as `--color-success`/`--color-danger`
  (`:96-98`); light theme redefines them darker (`:406-409`). An 8-tier heat scale
  `--heat-g3/g2/g1/a/r1/r2/r3`. A score scale `--score-strong/neutral/weak/poor`. Letter
  grades `--grade-a…f`. Indicator alphas `--ind-alpha-*`. `--tick-up-bg`/`--tick-down-bg`.
  Glass (`--glass-surface/elevated/chrome/border-*/inner-glow`) and menu
  (`--menu-bg/-top/border/divider/hover/accent/accent-bg/input-bg/shadow`) families.
- `appThemes.js`: **18 skins** — 12 dark (`slate, graphite, carbon, navy, forest, espresso,
  plum, nord, gunmetal, bordeaux, storm, umber`) + 6 light (`paper, cream, coolgray,
  softblue, sand, mint`). Each sets a base `data-theme` (`oled` or `light`) so
  un-overridden tokens stay legible, then writes its tokens as inline custom properties on
  `<html>`. Explicit invariant in the header: *"It does NOT change gain=green / loss=red
  (those stay constant across every theme)."* `ALL_APP_THEME_VARS` is cleared before each
  switch so a skin never inherits a stale inline value.
- Breakpoints: `styles/breakpoints.js` — `BP.phone = 640`, `BP.tablet = 1024`; `MQ.tabletDown`/`MQ.touchDown` are both `(max-width: 1024px)`. `styles/breakpoints.css` documents the four canonical `@media` strings and provides `.hideOnPhone`/`.showOnPhone`/`.hideOnTouch`/`.touchTarget`/`.hoverReveal`. **The touch tier is ≤1024 — CONFIRMED.**
- `styles/tapFloor.test.js` is the app-wide rail: no stylesheet may declare a finger target
  at 390px without also declaring it at 820px. Its header records the measurement that
  motivated it — **360 sub-44px targets at 820px vs 15 at 390px** across 28 routes — and it
  states its own ceiling: *"it reads declarations, not rendered boxes… Passing here is
  necessary, not sufficient."*
- `focus-visible` appears in **61** stylesheets.
- Density: exists as a *concept* in two places only — `components/mobile/DensitySwitcher.jsx`
  (`DENSITY_OPTIONS`) and the screener's `density = 'compact'|'comfortable'` prop driving
  `ROW_H = {compact: 30, comfortable: 38}`. It is not a token and not app-wide.
- **Number formatting is not a primitive.** `grep -rlE "(const|function) (fmt|fmtNum|fmtPct|fmtMoney|formatNum|formatPct)"` → **118 non-test files**. The most-duplicated names: `const fmt` ×22, `function fmtPct` ×16, `const fmtPct` ×14, `function fmtDate` ×12, `function fmtPrice` ×11, `function fmtTime` ×9. Shared formatters that DO exist are narrow: `utils/timeAgo.js` (`timeAgoShort`, `formatET`), `utils/feedFormat.js`, `utils/profileFormat.js`, `research-kit/charts/format.js` (`toNum`).
- **Freshness has no single primitive either.** Four unrelated implementations:
  `journal-2-0/components/SyncFreshnessChip.jsx`; `pages/breadth/staleWindowLabel`;
  `research-kit`'s `CoverageNote` (`coverageText`, `missingText`); and
  `pages/charts/widgets/ChartMarketClock.jsx` (session-tone dot + live ET clock + next-
  boundary popup, reusing `dashboard/sessionModel` so it *cannot* disagree with the
  Dashboard's session pill). The screener's `CoverageLine.jsx` is a fifth, and the most
  rigorous: four counts (evaluated · answered · dropped · not computable), `withheld`
  beside them never inside, a refusal to render a receipt whose arithmetic does not close,
  and a plain-language override when `answered === 0` with anything not-computable.

**INTERPRETATION.** The token layer is genuinely good and terminal-ready: gain/loss, heat,
score, grade and tick semantics all already exist as tokens, and the invariant that
gain/loss never move with a skin is exactly right for a trading product. What is missing is
everything *above* tokens: no formatter primitive, no density system, no freshness badge,
no control components. 118 hand-rolled formatters in a product where every number is a
price, a percentage or a timestamp is the clearest single measure of the gap.

**RELEVANCE TO UCT.** Terminal-Next inherits an excellent palette and an absent component
vocabulary. `research-kit` is the closest thing to that vocabulary and covers exactly one
domain (earnings research).

**CONFIDENCE.** 🟢 high on tokens, themes, breakpoints, counts. 🟡 on a11y posture:
`--focus-ring` exists and 61 stylesheets use `focus-visible`, but **EVIDENCE CEILING** — I
ran no contrast audit and no keyboard traversal. The one measured contrast datum in the
repo (20/20 nodes at 1.00 in the light theme before the island fix) shows source reading
does not settle this.

**RECOMMENDATION.** Before Terminal-Next, ship (a) one `format` module — price, percent,
volume, currency, compact-number, relative-time, ET timestamp — and (b) one
`FreshnessBadge` with `CoverageLine`'s honesty discipline. Both are small, both remove
whole classes of drift, and both are prerequisites for a consistent terminal.

**OPEN QUESTION.** Should density be a token (`--row-h`, `--pad-y`) so every panel responds
to one control, or stay per-surface? A terminal user expects one density switch for the
whole board.

---

## 8. Reusability verdict table (Contract Q8)

Verdicts: **reusable** = mount it as-is · **needs-extension** = real seam exists, gaps
named · **exists-but-limited** = works, coupled or single-consumer · **absent** = build it.

| Candidate primitive | Verdict | Seed file | Main limitation |
|---|---|---|---|
| **TerminalShell** | exists-but-limited | `components/Layout.jsx` (109 ln) + `components/navGroups.js` | 109-line shell is a nav + theme host, nothing more. `.shell`/`.main` scroll model (inner element, not `window`) is an inherited constraint every scroll listener must respect (capture phase). `FREE_PAGES` is hand-copied in 3 files. |
| **Panel (widget frame)** | **reusable** | `pages/charts/WidgetHost.jsx` + `WidgetHeader.jsx` (377 ln) + `widgets/registry.js` | 🔴 **No error boundary** (§1.7). Header assumes the `/charts` chrome-token vocabulary (`--widget-canvas`, `--widget-divider`, `--widget-text*`) and `ChartsWorkspace.module.css`. |
| **Grid / Dock** | **reusable** | `ChartsWorkspace.jsx` grid block (`:2134-2250`) + `pages/charts/rowHeight.js` + `repackAroundMoved.js` + `placement/place.js` | Viewport-locked to 20 rows — no scrolling board. No widget-count cap or mount queue if that lock is relaxed. Layout blob is unversioned (§1.4). |
| **Pop-out / multi-monitor** | **reusable** | `pages/charts/popout/PopoutWindow.jsx` | Popped windows die with the opener (documented, accepted). Popup-blocker first-run UX unverified. |
| **Tabs** | **reusable** | `pages/charts/widgetTabs.js` (pure reducer) + `chartTabs.js` | Two parallel tab systems (slot-level and chart-profile-level) that share no code. `WidgetTabs` is coupled to the widget object shape. |
| **Table / DataGrid** | needs-extension | `pages/screener/shell/VirtualResults.jsx` + `screener/columnDefs.js` + `shell/ColumnDesc.jsx` + `shell/liveSort.js` | Row shape and CSS module are screener-specific. No column drag-resize (Watchlists has it separately), no pinned columns beyond the sticky first, no row grouping. `ResponsiveTable` — the documented reusable table — has **zero consumers**. |
| **Chart** | **reusable** | `components/chart/pane/ChartPane.jsx` | Imports `pages/charts/ChartsWorkspace.module.css` (self-declared Phase-A debt). Sits on a 15,500-line `StockChart` with ~120 props. Four chart libraries ship. |
| **Search (symbol)** | **reusable** | `components/chart/SymbolSearch.jsx` | Ticker-only. No entity search (screens, notes, layouts, articles). |
| **Command palette** | **absent** | `pages/Settings.jsx:2416 CommandPalette` (interaction template only) | Settings-scoped, private to the file, not exported. No app-wide command registry to drive one. |
| **SecurityHeader** | **reusable (rename)** | `components/research-kit/shell/IdentityBanner.jsx` | Modelled on the *earnings report-night* lifecycle (`PRE → IMMINENT → PRINTED → CALL_LIVE → POST`). A general security header needs a different, or configurable, state machine. Pure display with slots — the right shape. Adjacent: `components/chart/pane/ChartIdentityRow.jsx`. |
| **Metric / StatTile** | **reusable** | `research-kit/StatTile.jsx` (+ `tones.js` `SCORE_TONES`) | `--score-*` tone vocabulary only; a terminal metric usually wants gain/loss tone — that is `VerdictChip`'s vocabulary, and `tones.js` states the two must never be blended. |
| **Sparkline** | exists-but-limited | `components/mobile/RowSpark.jsx`; breadth widget `tileStyle: 'spark'\|'area'`; `research-kit/charts/MetricTrendChart.jsx` | Three unrelated implementations; none is the general one. |
| **FreshnessBadge** | **absent** (five partial) | `research-kit/CoverageNote.jsx` + `components/screener/CoverageLine.jsx` (best discipline) + `charts/widgets/ChartMarketClock.jsx` + `journal-2-0/SyncFreshnessChip.jsx` + `breadth/staleWindowLabel` | No shared component, no shared vocabulary for LIVE / delayed / as-of / stale. `CoverageLine`'s four-count honesty rule is the standard to generalise. |
| **Empty / Error / Loading** | needs-extension | `research-kit/EmptyState.jsx` (23 importers) + `components/Skeleton.jsx` `SkeletonBlock` (45) + `components/ErrorBoundary.jsx` | Error is the hole: 5 boundary mount sites app-wide, **none on the /charts board**. Loading is inconsistent (`Suspense` text fallback in `WidgetHost`, `SkeletonBlock` elsewhere, `ChartSkeleton` for charts). |
| **ContextMenu** | **reusable** | `components/TickerActions.jsx` (universal right-click) + `components/mobile/ContextPopover.jsx` (Sheet on touch / anchored on desktop, 44px rows) + `components/mobile/useLongPress.js` (450ms, 10px tolerance, haptic, also accepts right-click) | Ticker-shaped. A general panel/row context menu would reuse `ContextPopover` but needs its own action model. |
| **Modal / Overlay** | **reusable** | `components/mobile/Sheet.jsx` + `components/mobile/useFocusTrap.js` | 56 files declare `role="dialog"`; only 6 trap focus. Journal's 10 modals share CSS (`ModalShell.module.css`) but not behaviour. |
| **Icons** | **reusable** | `components/ui/UIcon.jsx` (85 glyphs, 273 importers) | Gold-embossed by default (`gold={false}` to opt out) — a terminal may want neutral by default. Cannot nest inside SVG `<text>`. |
| **Tokens / theme** | **reusable** | `styles/tokens.css` + `styles/appThemes.js` + `styles/breakpoints.{js,css}` | No density tokens. `docs/brand-design-system.md` is stale on themes (documents a removed `dim`). |
| **Form controls** | **absent** | — | `components/ui/` contains only `UIcon.jsx`. `docs/ui-consistency-audit.md`'s claim of Button/Input/Select/Textarea/Checkbox/Toggle/Modal is FALSE (§0). `styles/buttons.css` provides classes, not components. |
| **Number formatting** | **absent** | `utils/timeAgo.js`, `research-kit/charts/format.js` (`toNum`) | 118 files define their own `fmt*`. |

---

## 9. Anti-patterns and debt relevant to a terminal (Contract Q9)

**OBSERVATION.** Five debt classes, in descending order of cost to a Terminal-Next build.

**EVIDENCE.**

1. **Giant components.** Non-test line counts: `StockChart.jsx` 15,500 · `OptionsFlow_admin.jsx` 9,972 · `OptionsFlow.jsx` 9,263 (partner-owned) · `chart/engine/ast/pine.js` 7,218 · `LiveFlowMassive.jsx` 4,911 · `ast/thinkscript.js` 4,728 · `DarkPool.jsx` 3,606 · `ChartDrawingOverlay.jsx` 3,263 · `ast/interpret.js` 2,809 · `Watchlists.jsx` 2,699 · `ChartsWorkspace.jsx` 2,623 · `Settings.jsx` 2,489 · `LiveFlow.jsx` 2,371 · `BuilderSheet.jsx` 2,351 · `ModelBook.jsx` 2,338. **Six files exceed 3,000 lines.**

2. **Duplicated fetch logic in components.** **186** non-test files under `components/` + `pages/` call `fetch(` directly; **71** call `useSWR(` directly. There are 117 files in `hooks/` and a shared `utils/jsonFetcher.js` with only **14** consumers. So the hook layer exists and is bypassed roughly 13× more often than it is used for the shared fetcher. Nearly every widget declares its own `const fetcher = url => fetch(url).then(...)` (e.g. `CalendarWidget.jsx:37`).

3. **Provider calls from UI.** Checked and NOT found: every fetch I read targets a same-origin `/api/*` path. No component calls a vendor domain directly. The one browser-native external dependency is the intro animation's asset loading and the logo proxy (`/api/ticker-logo/{sym}`), both internal. 🟢 This is a genuine strength.

4. **Unversioned layout state.** `charts_workspace_layout` carries no `version` field; `parseLayout` (`ChartsWorkspace.jsx:297`) infers migrations from data shape (`cols !== 24`; `maxBottom <= FIXED_ROWS/2`). The height heuristic will misfire on any future layout whose widgets legitimately occupy only the top half. Contrast `chart_settings`, which DOES carry `settingsVersion` and whose file comment explains that the stamp is what let fourteen sections be deleted from a captured default rather than merely ignored.

5. **Global state.** No Redux/Zustand/Jotai. State is React context (`AuthContext`, `WorkspaceContext`, `MoreSheetContext`, `TickerHubContext`, `PlacedThemeContext`, `ChartsSymContext`, `VoiceProvider`) plus SWR cache plus module-level singletons (`priceStreamManager`, `barsStreamManager`, `usePreferences`'s module-level `_writeChains` map). The module-level write queue in `usePreferences.js:44` is deliberate and documented: sixteen grid cells each call the hook, so a per-hook ref would serialise nothing, and two in-flight POSTs for one key can arrive out of order and lose a merge. This is sound; it is also *invisible* global state that a second app instance would break — the same single-process assumption the backend carries.

6. **CSS-Modules `#id` hashing hazard — currently CLEAN.** `grep -rnE "(^|[ ,>+~])#[a-zA-Z]" app/src --include=*.module.css` returns only hex colour literals inside `var()` fallbacks, no ID selectors. Memory's account (CSS Modules hashes bare `#id` selectors; geometry must go inline on anything a screenshotter targets by id) describes a hazard that has been remediated in source. It remains a live rule for new code, not a live defect.

7. **Hand-copied lists.** `FREE_PAGES` in `NavBar.jsx` / `AuthGuard.jsx` / `MoreSheet.jsx`. `.thBtn`/`.sortCaret`/`.thBtnActive` duplicated in `TradesTable.module.css` and `PositionsTable.module.css`. The `tools/mobile_audit.py` route list. The repo is unusually aware of this class — `navGroups.js`, `registry.js`, `tapFloor.test.js`, `columnDescCoverage.test.js`, `themeIsland.test.js` and `widgetKeyboardOwnership.test.js` are all rails built specifically to stop a typed roster drifting from the thing it describes.

**INTERPRETATION.** The debt is concentrated, not diffuse: six giant files, one missing
fetch discipline, one unversioned blob. The architectural hygiene *around* those (registry
derivation, source rails, documented invariants) is well above average. A Terminal-Next
build that mounts `ChartPane`, `WidgetHost` and the grid inherits `StockChart`'s 15,500
lines whether it wants to or not — that is the single largest carried risk.

**RELEVANCE TO UCT.** Item 4 (unversioned layout) is the one that will bite Terminal-Next
directly and immediately, because a new shell will want to change the layout schema.

**CONFIDENCE.** 🟢 on counts (all mechanical). 🟡 on item 3 — I sampled fetch targets
rather than auditing all 186 files. **EVIDENCE CEILING:** a full audit of every `fetch(`
argument would raise it; a network trace in a browser would CONFIRM it.

**RECOMMENDATION.** Version `charts_workspace_layout` before touching it. Introduce one
`useApiSWR(path)` and require it in new Terminal-Next code so the 186 does not become 250.

**OPEN QUESTION.** Is `StockChart` decomposition in Terminal-Next scope, adjacent scope, or
explicitly out? The answer determines whether "reuse the chart" is a week or a quarter.

---

## 10. Verification of the contract's KNOWN FACTS

| Claim (contract / project memory) | Verdict | Evidence |
|---|---|---|
| Deps present: react-grid-layout, @dnd-kit/*, @tanstack/react-virtual, lightweight-charts, echarts, chart.js, recharts, react-hotkeys-hook | **CONFIRMED** | `app/package.json` dependencies: `react-grid-layout ^1.5.3`, `@dnd-kit/{core ^6.3.1, sortable ^10.0.0, utilities ^3.2.2}`, `@tanstack/react-virtual ^3.13.24`, `lightweight-charts 5.2.0`, `echarts ^6.0.0` + `echarts-for-react ^3.0.6`, `chart.js ^4.4.0` + `react-chartjs-2 ^5.2.0`, `recharts ^2.15.4`, `react-hotkeys-hook ^5.2.4` |
| `chart_settings` is only a seed; the real layout lives in `charts_workspace_layout` → `widgets[].opts.settings` | **CONFIRMED in code** | `ChartsWorkspace.jsx:1265` comment *"chart_settings blob is the SEED an un-customized surface inherits"*; `:1273`/`:1303` `const seed = mergeChartSettings(prefs.chart_settings)`; `:1484`/`:1577` stamp it into new widget `opts` |
| The calendar modal is the only surface on `--glass-*` tokens | **PARTLY CONFIRMED — needs restating** | 20+ stylesheets use `--glass-*`, all inside `components/research/**` and `components/research-kit/**` (plus `components/calendar/SentimentGauge.module.css`). The modal is not the only *file*; the research family is the only *domain*. The modal's SHELL is `--menu-*`; its CONTENT reads `:root` tokens — `EarningsResearchModal.themeIsland.test.js` |
| The touch tier is ≤1024 | **CONFIRMED** | `styles/breakpoints.js` `BP.tablet = 1024`, `MQ.touchDown = '(max-width: 1024px)'`; `styles/breakpoints.css` TOUCH `@media (max-width: 1024px)`; `styles/tapFloor.test.js` enforces the 390↔820 relationship app-wide |
| CSS Modules hash bare `#id` selectors | **RULE STANDS, NO CURRENT VIOLATION** | No ID selector exists in any `*.module.css` today |
| CLAUDE.md "Charts Hub V2": `cols={12}`, `compactType:'vertical'`, `margin=[6,6]` | **2 of 3 STALE** | `GRID_COLS = 24` (`:52`); `compactType={null}` (`:2175`); margin `[6,6]` correct (`rowHeight.js:9`) |
| CLAUDE.md: `WIDGET_REGISTRY` + `WORKSPACE_WIDGETS` are the authorities, pinned by `registry.test.js` | **CONFIRMED** | `registry.test.js:41` (18 types), `:164` (every id has a binding), `:174` (prop shapes) |
| CLAUDE.md / `docs/ui-consistency-audit.md`: `components/ui/` holds Button/Input/Select/Textarea/Checkbox/Toggle/Modal | 🔴 **FALSE** | Directory contains `UIcon.jsx` only |
| `docs/brand-design-system.md` §7.3: a `[data-theme="dim"]` theme | 🔴 **STALE** | `tokens.css` has `:root`, `oled`, `light` only; `Layout.jsx:58-61` says `dim` was removed 2026-08-23 |
| CLAUDE.md: `components/mobile/ResponsiveTable.jsx` is a shipped reusable primitive | 🔴 **ORPHANED** | Zero consumers; only a barrel re-export in `components/mobile/index.js:3` |

---

## GAPS

Reached the end of the contract's nine questions within budget, but the following were
deliberately shallow or skipped:

- **Rendered behaviour.** No browser, no test run, no screenshot. Everything about paint,
  focus order, contrast, virtualization under load, and the per-widget error-boundary
  hypothesis (§1.7) is source-inferred. The repo's own history — 20/20 text nodes at
  contrast 1.00 while 13,629 tests were green — is the standing warning that source
  reading does not settle rendering.
- **`EarningsResearchModal.module.css`** — not opened. The "fixed 720px" claim is
  therefore unverified, as is the modal's tab layout and the 12-rail→5-tab consolidation.
- **`StockChart.jsx` internals.** I read its prop signature and importer set only. The
  indicator engine (`chart/engine/**`, ~20,000 lines across the AST modules), the drawing
  overlay (3,263 lines) and the six developing-bar writer sites were not inspected.
- **`WidgetHeader.jsx` (377 lines)** — read only through its call site in `WidgetHost`.
  Its tab strip, colour dot, float/pop-out/close controls and `addMenuTheme` handling are
  described from the props passed to it, not from its own source.
- **Exact prop count for `StockChart`** — ~120 by hand count of destructured names; not
  parsed.
- **`MobileChartsApp` / the phone chart shell** — listed, not read. The registry's
  `menus.mobile` says exactly 5 types are phone-usable (`registry.test.js:122`), which is
  the fact a mobile terminal story would start from.
- **`placement/place.js` + `regions.js`** (smart adaptive placement, `SMART_PLACEMENT =
  true`) — identified as the auto-placement engine but not read. It is the direct answer
  to "where does a new panel go", which Terminal-Next will need.
- **Bundle sizes, render counts, memory** — out of scope by contract (D-05) and not
  measurable read-only.
- **Which of the 56 `role="dialog"` sites are user-reachable** vs admin/dev-only — I
  counted declarations, not doors.

## NOT INSPECTED

- **`api/`** — the entire backend. Out of contract scope (`app/src/` only). Endpoint names
  cited here come from frontend fetch strings, never from the routers.
- **Partner-owned files** — `OptionsFlow.jsx` (9,263 ln), `OptionsFlow_admin.jsx` (9,972),
  `schwab_router.py`, `live_massive_router.py`, `massive_ws_worker.py`,
  `massive_processor.py`. `OptionsFlow.jsx` is noted in §3 only for its existence, size and
  all-inline-styles character (both already public facts in CLAUDE.md). Not read in depth,
  per the preamble.
- **`app/src/pages/journal-2-0/`** beyond the two table components and the hotkey files —
  a very large subtree with its own shell, own modal CSS and own keyboard system. A
  Terminal-Next primitives pass would benefit from a dedicated look at `JournalLayout.jsx`
  as the app's only worked example of a chorded-navigation shell.
- **Production runtime** — no `/api/health` call, no Railway command, no local backend
  probe (port 8077 explicitly avoided per the preamble).
- **`docs/superpowers/specs/**` design docs** for the workspace, multi-chart grid and
  research kit — the contract named `docs/ui-consistency-audit.md` and
  `docs/brand-design-system.md`, which I read; the specs would add design *intent* that
  code alone does not carry.
- **Git history** — no `git log` walk beyond one 3-line check on `components/ui/`, so
  "was the control layer deleted or never built" is unresolved (§0's open question).
