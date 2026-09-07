# Breadth drill → real charts widgets

**Date:** 2026-09-07
**Branch:** `feat/breadth-drill-charts-widgets`
**Status:** design, awaiting owner review

---

## 1. Objective

The breadth drill popup is currently a bespoke surface: its own table, its own
chart wiring, its own CSS. The charts workspace has a watchlist widget and a
chart widget that are strictly more capable. Members therefore learn two
different list UIs and two different chart UIs depending on which door they came
through.

**The objective is structural convergence.** Clicking a breadth cell must open
the *actual* charts-tab widgets — same components, same customization, same
capabilities — differing only in

- **where** they are (a popup reached from the breadth page), and
- **what populates them** (the breadth cell's constituents instead of a saved
  watchlist).

This is not a restyle. Nothing in the drill may be a lookalike of a widget; it
must *be* the widget.

---

## 2. Current state

### 2.1 What exists

`DrillModal` — `app/src/pages/Breadth.jsx:361`, roughly 340 lines of JSX — plus
its stylesheet block in `app/src/pages/Breadth.module.css` (`.drill*`, lines
435–846 and 1504–1540).

It renders:

| Region | Today |
|---|---|
| Header | `.drillTitle` + `.drillSub` + `GroupControls` + `CopyTickersButton` + `.drillClose` |
| Left | A hand-built `<table class="drillTable">` — 8 fixed columns, industry group rows, row heat tint, `GroupSummaryStrip` chip rail |
| Right | `.drillChartBar` (symbol, name, flag button, "↑ ↓ to navigate") over a bare `<ChartPane>` |

### 2.2 Why the chart "isn't identical"

`DrillModal` renders **`ChartPane` directly**. `ChartPane` is only the chart
shell. `ChartWidget` (`app/src/pages/charts/widgets/ChartWidget.jsx`, 722 lines)
is what the charts tab actually mounts, and it adds everything the drill lacks:

- chart **tabs** (multiple independent chart profiles in one slot)
- **color groups** (the link mechanism)
- the **crosshair bus**
- **hotkey arbitration** (`activeChartRef`)
- the **right-click menu** — Set alert · Reset view · Chart settings · AI search
- saved **chart-settings templates** (`chart_templates`)
- **per-widget settings persistence** (`opts.settings` / per-tab blobs)

Note that `stored={null}` with no `onStore` is *not* a defect: `ChartPane`
documents that combination as "this surface IS the user's one chart", so global
`chart_settings` already flow through. The gap is the widget wrapper, not the
settings.

### 2.3 Why the list "isn't identical"

The drill's table is hand-built. The charts watchlist is `Watchlists.jsx`
(`app/src/pages/Watchlists.jsx`, 2,992 lines) which supplies column
add/remove/reorder/resize, the right-click column menu, sorting, the ⚙
appearance panel, the flag star, live streamed prices, and the per-symbol
context menu.

Critically, **`Watchlists` already supports ad-hoc membership**. Scan mode
(`pickList="__scan__"` + `scanSymbols=[…]`) renders the full table with
membership supplied by the caller. `ScannerResults.jsx` and
`PeriodSortResults.jsx` already use it. Its relevant props:

```
scanSymbols  scanGroups  metaOverride  perfOverride  scanFooter  scanCriteria
backLabel    colStorageKey  defaultColCfg  scanEmptyText  ephemeralCols
widgetKey    activeRef      settingsOverride  onSettingsPersist  onScanVisibleSyms
```

So the list requires **no new table**. It requires pointing the existing one at
breadth data.

### 2.4 Measured parity gap

Captured 2026-09-07 from production at 1800×1100, same session, same window
size — the charts board and the `UP 4%+ · 2026-09-04` drill side by side.

**Chart**

| Element | Charts widget | Breadth drill |
|---|---|---|
| Widget header — colour dot, `+`, `▣`, `⧉`, `✕` | present | **absent entirely** |
| Chart tab strip (`1D`, `1D ×`, `+`) | present | **absent** |
| Company logo before the symbol | present | **absent** |
| Symbol + name treatment | muted grey | gold |
| Date navigator `◀ 9/4/2026 ▶ ⌄` | present | **absent** |
| Theme + chart-type icons, right of the tf bar | present | **absent** |
| Drawing toolbar, left group | 19 tools, ends in `★` | ~17, **no `★`** |
| Drawing toolbar, right group | right-aligned, separated | runs inline after the left group |
| `FLAG` button + symbol bar above the chart | absent | present (breadth-only) |
| `↑ ↓ to navigate` hint | absent | present (breadth-only) |
| Session toggle · market clock · tf row · cap/earnings/rating | present | present |

**List**

| Element | Watchlist widget | Breadth drill list |
|---|---|---|
| Widget header chrome | present | absent |
| `‹ Lists` · centred gold title · `+` · ⚙ | present | absent |
| Appearance panel | full (below) | **none** |
| Columns | 23 available, user-configurable | **8, fixed** |
| Column right-click menu | present | absent |
| Sort by clicking a header | present | absent |
| Star / flag column | present | absent (flag is a chart-bar button) |
| Company logos | present, toggleable | absent |
| Tick flash on price update | present, toggleable | absent |
| Footer count (`1 stock`) | present | absent (count sits in the modal title) |
| Row heat tint · group rows · chip strip | absent | present (breadth-only) |

**The watchlist appearance panel**, in full — none of which the drill has:
Templates ▾ · Save as Template · Reset · UCT theme (whole-widget look) ·
Canvas background Solid/Gradient + colour · Text size (whole watchlist) · Text
colour (all columns except % change) · % Change up/down colours · Gridlines line
colour (all column + row lines) · Tick flash background tint + up/down tints ·
Symbol column company-logos toggle.

**The 23 watchlist columns:** Price · Vol · % Chg · Company Name · RVOL · IPO
Date · Market Cap · Next Earnings · UCT Rating · $ Change · % from Open · % from
High · % from Low · Daily Closing Range · Dollar Volume · **Sector** ·
**Industry** · **Theme** · 5-Day Change · 30-Day Change · 60-Day Change · 90-Day
Change · Attention — plus Reset columns.

### 2.5 Second sweep — menus and handlers

A second live pass opened the menus the first missed.

- **Chart right-click menu** carries nine items, two of which the design had not
  accounted for: **Send to Journal** and **Send to Journal (choose where)…**.
  Both route through `sendCaptureToJournal`, which reads `getCaptureState()` off
  `chartApiById` — so they are a second, independent reason that member must be
  real rather than stubbed.
- **Ask AI is safe.** `ChartWidget:445-451` deliberately does *not* use
  `aiSearchBus`; it navigates to the canonical `/research/:sym?section=ai` route,
  with a comment explaining that a security-scoped AI action must mean the same
  canonical Ask AI everywhere. An inert `aiSearchBus` therefore costs nothing.
- **The watchlist's right-click is the COLUMNS menu everywhere in the table** —
  header row and data rows alike. There is no separate per-symbol right-click
  menu on this path; the per-symbol actions live elsewhere in the row UI.
- ⚠️ **`/ai-search` has the same latent bug.** `AiSearchPage.jsx:284` does
  `{ ...WORKSPACE_FALLBACK, aiSearchBus: busRef.current }`, so it inherits the
  four-member gap too. Fixing `WORKSPACE_FALLBACK` (§8) repairs that host for
  free.

⭐ **Two findings that change the plan:**

1. **Sector, Industry and Theme are already watchlist columns.** The grouping
   dimensions exist as data in the watchlist today. §5's endpoint work is about
   *bucketing* rows by theme, not about sourcing the value.
2. **ATR% and 50SMA are NOT watchlist columns.** They are breadth-only fields.
   For the uniformity the owner asked for they must become **real watchlist
   columns available to every list**, not breadth-private extras — otherwise the
   breadth list is once again a table with columns no other list can show, which
   is the exact divergence this work exists to remove.

---

## 3. Target architecture

```
Breadth cell click
  └─ BreadthDrillModal                       (overlay + slim title bar + close)
      └─ WorkspaceContext.Provider           ({...WORKSPACE_FALLBACK, overrides})
          └─ BreadthDrillBoard               (resizable two-pane split)
              ├─ WidgetHost  type="watchlist"   → WatchlistWidget → Watchlists (scan mode)
              └─ WidgetHost  type="chart"       → ChartWidget    → ChartPane
```

Both widgets sit on **colour group A**. Selecting a row calls
`setGroupSym('A', sym)`; the chart reads `groupSyms.A`. That is the same
mechanism the charts tab uses — the link is not new code.

### 3.1 Hosting widgets outside the workspace

⛔ **An earlier draft of this spec said "spread `WORKSPACE_FALLBACK` and override
a few members". That is wrong, and it is a documented trap.**

`ChartsWorkspace`'s provider supplies **23** members. `WORKSPACE_FALLBACK`
declares **19**. Four have drifted out of sync:

| Missing from the fallback | Read by | Consequence of `undefined` |
|---|---|---|
| `widgetCanvasByType` | `WidgetHost` | Widget chrome stops following the widget's own canvas colour |
| `widgetCanvasById` | `WidgetHost` | Same, per-widget |
| `chartApiById` | `ChartWidget:212` | The chart never registers its imperative API — capture state and compare-symbols go dead |
| `activeWatchlistRef` | `WatchlistWidget`, `ScannerResults`, `ThemesWidget`, `EtfHoldingsResults`, `PeriodSortResults` | `isActiveWidget()` is `!activeRef || …` — an undefined ref passes **vacuously**, so the list claims every arrow key and every Shift+F |

The precedent is already in the tree. `app/src/pages/journal-2-0/components/
notebook/frozenWorkspace.js` hosts these same widgets inside a note, and its
build rule is explicit:

> "the ENTIRE surface the real provider supplies is enumerated here, every
> member stubbed DELIBERATELY — a member accidentally falling through to
> WorkspaceContext's FALLBACK (or to undefined) is a silent dead end. The
> FALLBACK itself omits four members the real provider carries … so 'the
> fallback covers it' is exactly the trap."

It also records the vacuous-guard bug by name: a null `activeRef` means an
embedded widget "would swallow the page's arrow keys / capture hotkeys (P2 audit
finding)".

**So the drill follows `frozenWorkspace`, not the fallback.** A new
`drillWorkspaceValue()` enumerates all 23 members explicitly, and
`drillWorkspace.test.jsx` copies `frozenWorkspace.test.jsx` — deriving the real
provider's key set from `ChartsWorkspace.jsx`'s source and failing **by name**
when the workspace grows a member the drill doesn't carry.

The difference from the notebook: the notebook is a **frozen** host — every
write is inert. The drill is a **live** host. These must be real, not stubs:

| Member | Drill value | Why real |
|---|---|---|
| `groupSyms` / `setGroupSym` | Local state | The list → chart link |
| `crosshairBus` | Real bus | Crosshair behaves as on the board |
| `activeChartRef` | Real ref | Chart hotkeys arbitrate correctly |
| `activeWatchlistRef` | Real ref | **Not a sentinel** — the list must own ↑/↓ and Shift+F, and a null ref would make the guard pass vacuously |
| `chartApiById` | Real `{current: new Map()}` per board | Chart registers its API; capture state works |
| `widgetCanvasByType` / `ById` | Derived via `widgetChrome.js` | Per-widget canvas chrome, same as the board |
| `chartsTheme` | Mirrors the user's workspace theme pref | |

Deliberately inert, because they have no meaning in a two-widget modal —
each stubbed with a comment saying so, never left to fall through:
`aiSearchBus` (no AI Search widget to receive it), `floatNewWidget`,
`applyThemeToAllCharts`, `applyThemeToAllWidgets`, `periodSortMode` +
`onPeriodSelected` / `onPeriodCancel`, `replayCutoff` / `exitReplay` /
`replayArmPick` / `onReplayCutoffPicked` / `onReplayPickCancel`, `startMarker` /
`startMarkerStyle`.

⚠️ Those inert members are a **real functional divergence** from the charts tab —
Replay mode, Custom-Period Sort, "Add widget" from the chart's right-click menu,
and "apply theme to all charts" will not work inside the drill. They are listed
in §7.2 as accepted limits rather than hidden. If any must work, it is a
scoped addition, not a discovery mid-implementation.

### 3.2 The list widget — no new widget type

`WatchlistWidget` already receives `opts` and branches on `opts.watchKey`. It
gains **one branch** for an ad-hoc source:

```js
// Ad-hoc source: membership is supplied by the host, not a saved list.
// The payload rides a context, NOT opts — opts is persisted, and a 134-symbol
// payload must never enter the layout blob.
const drill = useContext(DrillSourceContext)
if (opts?.source === 'breadthDrill' && drill) {
  return <BreadthDrillList drill={drill} opts={opts} onOptsChange={onOptsChange} … />
}
if (!watchKey) return <WatchlistPicker … />
```

This matters: the `watchlist` entry in `WORKSPACE_WIDGETS` keeps `standardProps`
(`{ color, opts, onOptsChange }`) unchanged, so **`registry.test.js` needs no
edit and no new widget type appears in the /charts add-widget catalog.**

`BreadthDrillList` is a near-clone of `ScannerResults`: it renders `Watchlists`
in scan mode with the drill's symbols, `metaOverride` carrying the breadth
fields (ATR%, 50SMA distance, %chg), `scanFooter` showing the count and as-of
stamp, and `backLabel` returning to the group controls.

### 3.3 Persistence

The board keeps a small pref, `breadth_drill_board`, holding the two widgets'
`opts` — nothing else. Both widgets are seeded on first open exactly the way a
newly added charts widget is (`themeNewWidgetOpts` / `uctDefaultChartSettings`),
so the drill's chart starts as a normal chart and keeps whatever the user then
customises.

Symbols, meta and group buckets are **never** persisted — they arrive per-open
through `DrillSourceContext`.

Columns use the **global watchlist column key** (`WL_COLS_LS`, i.e. no
`colStorageKey` override). Change columns anywhere and the breadth list matches.
This is the deliberate reading of "exactly like the watchlist widgets"; passing
a breadth-private key is a one-word change if the owner later wants divergence.

**ATR% and 50SMA become real watchlist columns** (§2.4 finding 2). They join
`EXTRA_COLS` in `Watchlists.jsx` alongside the existing 23, so every list can
show them and the breadth list is not a special case. Both are already computed
per-symbol on the breadth payload; for a normal watchlist they resolve through
the same meta path the other derived columns use, and render `—` where absent —
the behaviour every optional column already has.

---

## 4. Changes by file

### 4.1 New

| File | Purpose |
|---|---|
| `app/src/pages/breadth/drill/BreadthDrillModal.jsx` | Overlay, slim title bar, Esc/✕, the `WorkspaceContext` provider |
| `app/src/pages/breadth/drill/BreadthDrillBoard.jsx` | Two `WidgetHost`s + resizable split + pop-out plumbing |
| `app/src/pages/breadth/drill/BreadthDrillList.jsx` | `Watchlists` scan-mode adapter (models `ScannerResults`) |
| `app/src/pages/breadth/drill/DrillSourceContext.js` | Carries `{ symbols, meta, groups, label, date, asOf, live }` |
| `app/src/pages/breadth/drill/drillBoardPrefs.js` | Read/seed/write `breadth_drill_board` |
| `app/src/pages/breadth/drill/drillWorkspace.js` | All 23 context members enumerated explicitly — modelled on `frozenWorkspace.js`, live rather than frozen (§3.1) |
| `app/src/pages/breadth/drill/drillWorkspace.test.jsx` | Copy of `frozenWorkspace.test.jsx` — derives the provider's key set from `ChartsWorkspace.jsx` source, fails **by name** on drift |

### 4.2 Changed (shared frontend — the only three)

1. **`app/src/pages/Watchlists.jsx`** — two additions:
   - a **`groupExpand`** prop, `'accordion' | 'multi'`, **defaulting to
     `'accordion'`**. Only the `toggleGroupExpand` reducer and the initial
     expanded set change. Scanner and Period-Sort pass nothing and are
     byte-identical afterward; breadth passes `'multi'` for all-groups-open with
     per-group collapse.
     ⚠️ Named `groupExpand`, **not** `groupMode` as an earlier draft of this spec
     said: `Watchlists.jsx` already has a local `const groupMode = scanMode &&
     scanGroups && …` boolean, and a prop of that name would shadow it.
   - **`atr` and `a50` added to `EXTRA_COLS`** (+ `COL_LABELS`, `COL_META`,
     `COL_FULL_MINW`) so ATR% and 50SMA become columns every watchlist can show.
     Additive — no existing column, order or stored layout changes, and a list
     without the data renders `—` like any other optional column.

2. **`app/src/pages/charts/widgets/WatchlistWidget.jsx`** — the ad-hoc source
   branch in §3.2. Prop shape unchanged.

3. **`app/src/pages/breadth/grouping/useBreadthGrouping.js`** — allow
   `'theme'` alongside `'industry' | 'sector'` (see §5).

### 4.3 Deleted

From `Breadth.jsx`: `DrillModal`'s table renderer, group-header rows, heat
classes, `GroupSummaryStrip` usage, `CopyTickersButton` (the watchlist has its
own copy affordance), and the bespoke chart panel — roughly 340 lines.

From `Breadth.module.css`: `.drillTable`, `.drillTh*`, `.drillTd*`,
`.drillRow*`, `.drillHeat*`, `.drillGroup*`, `.drillChart*`, `.drillFlagBtn`,
`.flagToast` — roughly 400 lines. `.drillOverlay` / `.drillDialog` /
`.drillHeader` survive as the modal shell.

**The grouping toolkit has exactly one consumer, and it is this modal.** Verified
against `origin/master`:

| Symbol | Call sites |
|---|---|
| `useBreadthGrouping` | `Breadth.jsx:381` — inside `DrillModal`, only |
| `GroupControls` | `Breadth.jsx:500` — inside `DrillModal`, only |
| `GroupSummaryStrip` | `Breadth.jsx:522` — inside `DrillModal`, only |

The comments in `useBreadthGrouping.js` and `groupItems.js` claim the toolkit is
"shared by the drill modal AND the CustomScan scanner". **That is stale** —
`CustomScan` appears nowhere in `app/src` except in those two comments. Nothing
else consumes the toolkit.

Consequences:

- `useBreadthGrouping` + `GroupControls` move wholesale into
  `BreadthDrillList`; no compatibility shim is owed to a second consumer.
- Dropping the chip strip makes `GroupSummaryStrip.jsx`, its `.module.css` and
  its `.test.jsx` **dead code — delete all three.** Leaving them would be a
  third grouping surface with no renderer.
- Correct the two stale comments in the same commit so the next reader is not
  misled the way this design initially was.

---

## 5. Theme grouping — RESOLVED, and better than this section predicted

> **Implemented 2026-09-07.** The section below is kept as the reasoning that led
> here, but its central worry was wrong in the right direction: the ranking
> authority already existed. `api/services/groups.py::resolve_primary_theme`
> decides which of a ticker's themes is *the* one — owner memberships outrank
> engine ones, then tier, then smallest theme, factor buckets excluded — and
> `ticker_meta` already displays that answer. So `/api/breadth/industries` gained
> a `themes` map that CALLS it rather than re-ranking, which means the drill's
> theme can never disagree with the theme shown anywhere else.
>
> Two constraints the implementation had to respect:
> - It is **one SQLite query per ticker**, so it runs through `asyncio.to_thread`.
>   134 sequential queries on the single shared event loop is the 2026-07-01 524
>   outage class. A rail spies on `to_thread` and fails if it is ever inlined.
> - A ticker in no theme returns **`None`, never a missing key** — the client
>   buckets it as `Unclassified`. Dropping the key would silently shrink the drill
>   below the count on the cell that opened it.

## 5b. The original reasoning (superseded)

`useGroupMeta` fetches `/api/breadth/industries` and returns
`{ industries, sectors }` only. **There is no per-ticker theme map**, so Theme
grouping cannot be wired client-side without either N lookups or intersecting
`/api/groups` membership against the drill's tickers.

**Recommendation:** extend the existing `/api/breadth/industries` response with a
`themes` map (`{TICKER: theme|null}`). The server already holds the membership
that `/api/groups` serves, so this is one additional map on a round-trip that
already happens — no new endpoint, no second fetch, and every grouped breadth
surface gains Theme at once.

A ticker may belong to several themes, so the endpoint contract must state which
one it returns. **This is a requirement on the new field, not an existing
property** — the current response has no theme concept at all. Proposed
contract: return one theme per ticker, chosen by the same ordering
`/api/groups` already uses to rank a ticker's memberships, and `null` for a
ticker in none. Nulls bucket under `Unclassified`, which the grouping toolkit
already filters out of summaries. If that ordering turns out not to exist
server-side, the field ships as `themes: {TICKER: [names]}` and the client takes
the first — decided during implementation, against the real endpoint.

This is the only backend change in the plan. If the owner would rather not touch
the endpoint now, Theme ships in a follow-up and Sector/Industry land unchanged.

---

## 6. Decisions taken

| Decision | Call | Reasoning |
|---|---|---|
| Group rows | All expanded, per-group collapse | Seeing which industries dominate *is* the point of a breadth drill; an accordion destroys it |
| Grouping controls | Inside the list widget | The widget must stay self-contained so it survives being ejected to its own window |
| Columns | Global watchlist layout; ATR% and 50SMA **promoted to real watchlist columns** for every list | "Exactly like the watchlist widgets" — a breadth-private column set would recreate the divergence this work removes. Sector/Industry/Theme already exist as columns (§2.4) |
| Chip strip | Dropped | Breadth-only invention; sorted group headers give the same read |
| Row heat tint | Dropped | No charts-page analogue; % Chg is already coloured |
| Modal title bar | Slim: `UP 4%+ · 134 stocks · 2026-09-04` + ✕ | Drill identity and date have no other home; modal needs an unambiguous close |
| Chart tabs | Included | Part of the real widget |
| Date navigator | Included | The honest home for the snapshot date, currently expressed as a white-painted candle |
| Board layout | Resizable split, not the RGL grid | `renderGrid` is a closure inside the 2,623-line `ChartsWorkspace`; lifting it is a separate refactor. Widget *capabilities* are unaffected — only free-form rearranging inside the modal |
| Pop-out | Enabled per widget via existing `PopoutWindow` | Delivers "separate popouts but linked" without that refactor |

---

## 7. Functional parity

Visual parity is the easy half. This section is the functional contract.

### 7.1 Capability audit

**Chart widget.** Every capability below comes from `ChartWidget`, not
`ChartPane`, so the drill gains all of them the moment it mounts the widget:

| Capability | Depends on | Works in the drill |
|---|---|---|
| Chart tabs — add / close / rename / switch | `onReplaceWidget` from the host | ✅ host supplies it |
| Per-tab independent settings blobs | `opts.chartTabs[i].settings` | ✅ |
| Colour groups (link / unlink, cycle) | `groupSyms` / `setGroupSym` | ✅ real |
| Crosshair sync | `crosshairBus` | ✅ real |
| Hotkey arbitration (one TF keypress retimes one chart) | `activeChartRef` | ✅ real |
| Right-click menu, full inventory captured live: **Set alert @ $x · Send to Journal · Send to Journal (choose where)… · Reset view · Watermark settings · Chart settings · Chart template ▸ · Add widget ▸ · Ask AI about SYM** | see rows below | ✅ except Add widget |
| ↳ Ask AI | canonical `navigate('/research/:sym?section=ai')` — **not** `aiSearchBus` (ChartWidget:445-451 says so explicitly) | ✅ works |
| ↳ Send to Journal (both) | `sendCaptureToJournal` + `getCaptureState()` via `chartApiById` | ✅ **only because `chartApiById` is real** (§3.1) |
| ↳ Add widget ▸ | `floatNewWidget` | ❌ inert — §7.2 |
| Context-aware settings targets — watermark · axis · MA · volume · candles · canvas | `paneRef.openSettings(target)` | ✅ |
| Saved chart-settings templates (`chart_templates`) | pref | ✅ |
| Alerts scoped to this chart | `chartId` | ✅ host supplies a stable id |
| Imperative API registration / capture state | `chartApiById` | ✅ real map |
| Drawing tools, indicators, compare, date nav, session toggle | `ChartPane` | ✅ |
| Replay mode · Custom-Period Sort · Add-widget · theme-all | workspace-level state | ❌ inert — §7.2 |

**Watchlist widget.** All of these are `Watchlists` behaviour and survive scan
mode:

| Capability | Works in the drill |
|---|---|
| 23 configurable columns, add/remove via right-click menu | ✅ |
| Column reorder by dragging a header, and resize-drag | ✅ |
| Sort by clicking a header | ✅ |
| Flag star (and Shift+F) | ✅ |
| Live streamed prices + tick flash | ✅ |
| Full appearance panel — templates, UCT theme, canvas, text, % change, gridlines, tick flash, company logos | ✅ per-widget via `settingsOverride` / `onSettingsPersist` |
| Per-symbol context menu incl. Research / Ask AI | ✅ |
| Virtualized rendering for large lists (`ScanRows`) | ✅ — and it already renders group/member rows, which is what the breadth grouping rides on |
| Arrow-key navigation owning its own scroll | ✅ **provided `activeWatchlistRef` is real** (§3.1) |
| Footer | ✅ scan mode uses `scanFooter` (count · updated · refresh) rather than the plain `wlCountFooter` |
| Add / remove / reorder symbols, per-symbol notes | ❌ — §7.2 |

### 7.2 Parity limits (accepted, and why)

These cannot be engineered away and should be stated rather than discovered:

1. **Membership is read-only.** Scan mode has no add/remove/reorder and no
   per-symbol notes, because the breadth cell *is* the membership. Flag star,
   price alerts, Research and Ask AI all still work.
2. **Widget `✕` is suppressed.** The modal owns closing; a closed widget would
   leave an empty pane. The `⧉` pop-out and `▣` float remain.
3. **The snapshot date is fixed** for a historical drill. The date navigator
   displays it; navigating away from it re-scopes the chart only, not the list.
4. **Workspace-level modes are inert.** Replay mode, Custom-Period Sort,
   "Add widget" from the chart's right-click menu, and "apply theme to all
   charts / all widgets" have no meaning in a two-widget modal and are stubbed
   deliberately (§3.1). Each stub carries a comment saying why, so a future
   reader does not mistake it for an oversight. Making any of them work is a
   scoped addition, not a bug.

---

## 8. Testing

| Level | What |
|---|---|
| Unit | `groupMode` reducer: `'accordion'` collapses siblings, `'multi'` does not; **a rail asserting the default is `'accordion'`** so Scanner/Period-Sort can't silently change |
| Unit | `drillBoardPrefs` seeds from `uctDefaultChartSettings` on first open and round-trips edits |
| Unit | `WatchlistWidget` renders the picker when `opts.source` is absent, and the drill list when present — pinning the branch cannot swallow normal watchlists |
| Integration | Selecting a row sets `groupSyms.A` and the chart re-renders on that symbol |
| Integration | `drillWorkspace.test.jsx` derives the provider key set from `ChartsWorkspace.jsx` source and fails BY NAME on drift (copy of `frozenWorkspace.test.jsx`) |
| Integration | `activeWatchlistRef` is a REAL ref: a rail asserting the list owns ↑/↓ and Shift+F, and that a chart hotkey does not reach it. Guards against the vacuous-pass bug `frozenWorkspace.js` records |
| Integration | Chart tabs add/close/rename inside the drill, proving `onReplaceWidget` is wired |
| Chore | While here, **fix `WORKSPACE_FALLBACK` itself** — add the four drifted members so the next out-of-workspace host is not trapped, and add a rail pinning fallback keys ⊇ provider keys |
| Regression | `ScannerResults` / `PeriodSortResults` snapshots unchanged |
| Pixel | Screenshot the deployed drill and diff against a charts-tab watchlist + chart. Per `project_breadth_daily_tab_2026_08_26`, the live pixel check has caught defects a green suite did not — **count the pixels, and count the tests across every master merge** |

---

## 9. Out of scope

- Lifting `renderGrid` out of `ChartsWorkspace` into a shared board component
  (follow-up; would give free-form arrangement inside the modal)
- Retiring the `CustomScan` grouping surface
- Mobile drill layout (the charts workspace has its own mobile app shell)
- Any change to `/charts` behaviour

---

## 10. Open question for the owner — CLOSED

Section 5's question ("extend the endpoint now, or follow up?") was answered by
building it: the owner said do all of it properly, and the theme authority turned
out to already exist, so it landed in the same pass. Nothing is outstanding here.

## 11. What is built, and what is still unproven

Built and pushed on `feat/breadth-drill-charts-widgets`:
the drill board, both widgets, the workspace host + its drift rail, theme
grouping, per-widget pop-out, and the deletion of the bespoke table (323 JSX
lines), its CSS (66 classes) and `GroupSummaryStrip`.

⚠️ **Unproven: this has never rendered in a browser.** All evidence to date is
code-level plus suite counts. A faithful local run is not possible — local
`C:\data\breadth_monitor.db` is 12KB (the real snapshots live on Railway), so a
sandboxed backend has nothing to drill into, and pointing a local server at the
real `C:\data` would write to the owner's live files. Verification therefore
happens after deploy, against production, and the live side-by-side against
`/charts` is the acceptance step this design has been aiming at throughout.
