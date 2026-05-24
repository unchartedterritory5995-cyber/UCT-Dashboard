# Charts Hub Unification — Design Spec

**Date:** 2026-05-23
**Status:** Approved, ready for implementation planning
**Phase:** 1 (shell + routing only; polish items deferred)

## Goal

Merge three existing left-nav pages — **Theme Tracker**, **Watchlists**, and **Multi-Chart** — into a single unified left-nav entry called **📈 Charts**, where each becomes a sub-tab. Adds a new fourth sub-tab — **Chart** — that opens a clean single-symbol chart with SPY as the first-visit default.

This is a *shell-and-routing* unification, not a rewrite. The three existing pages render inside the new hub **as-is**; their internal layouts, state, components, and tests are untouched.

## Non-goals (Phase 1)

- No restructure of Watchlists, ThemeTrackerPage, or MultiChart internals.
- No new backend endpoints, no DB schema changes, no migrations.
- No changes to alerts, tags, drag-and-drop, theme taxonomy, real-time streaming, or any feature inside the three subsumed pages.
- No update to the intro animation pill grid (deferred to a polish pass).
- No "auto-apply current ticker" mode for Multi-Chart cells (Multi-Chart gets a manual button instead — see below).

## Decisions locked during brainstorming

| Decision | Choice |
|---|---|
| **Scope** | Only Theme Tracker + Watchlists + Multi-Chart fold in. Screener, Custom Scan, UCT 20, Patterns, etc. stay separate. |
| **Tab name** | `Charts` (URL: `/charts`) |
| **Layout pattern** | Sub-tabs across the top (Option A from brainstorming). Each sub-tab keeps its native internal layout. |
| **Sub-tabs (4)** | `Chart` · `Watchlist` · `Themes` · `Multi-Chart` |
| **Default landing (first-ever visit)** | `Chart` sub-tab pre-loaded with **SPY** |
| **Default landing (returning visit)** | Last-viewed sub-tab restored from `usePreferences` |
| **Old nav entries** | Removed from `NavBar.jsx` and `MobileNav.jsx`. Old URLs (`/theme-tracker`, `/watchlists`, `/multi-chart`) redirect to `/charts?tab=…` with query params preserved. |
| **Free-tier access** | All four sub-tabs free. `/charts` plus all three old URLs added to `FREE_PAGES`. |
| **Ticker carry-over** | Selected ticker is **shared across all four sub-tabs** via a React Context (`ChartsSymContext`). Click NVDA in Watchlist → Chart sub-tab loads NVDA · Themes highlights NVDA's themes · Multi-Chart shows an "Apply current ticker" button that pushes NVDA into the focused cell. |
| **Mobile sub-tab pattern** | Horizontal-scroll strip with snap points (matches existing Breadth tab pattern). |

## Architecture

### New files (4)

```
app/src/pages/charts/
├── ChartsHub.jsx              # The shell — header, sub-tab strip, lazy-mounted sub-tabs
├── ChartsHub.module.css       # Hub-specific styles (header, sub-tab strip, mobile scroll)
├── ChartTab.jsx               # The new single-chart sub-tab (StockChart wrapper)
└── ChartsSymContext.jsx       # React Context + useChartsSym() hook for shared ticker
```

### Modified files (5)

| File | Change |
|---|---|
| `app/src/App.jsx` | Add `<Route path="/charts" element={<ChartsHub />} />`. Replace direct routes for `/theme-tracker`, `/watchlists`, `/multi-chart` with `<Navigate>` redirects to `/charts?tab=<name>` preserving query params. |
| `app/src/components/NavBar.jsx` | Remove `Theme Tracker`, `Watchlists`, `Multi-Chart` items. Insert `📈 Charts` at the position currently held by Theme Tracker (between Breadth and Calendar). |
| `app/src/components/MobileNav.jsx` | Mirror the same nav changes. |
| `app/src/components/AuthGuard.jsx` | Add `/charts`, `/theme-tracker`, `/watchlists`, `/multi-chart` to `FREE_PAGES` (the three legacy paths must still pass the gate so the redirect can fire). |
| `app/src/pages/Watchlists.jsx` + `app/src/pages/ThemeTrackerPage.jsx` | Tiny adapter (≤10 lines each): pull `useChartsSym()` via null-safe `useContext`; on ticker click, also call `setSym(ticker)`. Stay backwards-compatible when context is absent (so the components still render correctly if visited outside the hub during transition). |

### Untouched files

- `app/src/pages/MultiChart.jsx` — receives the ticker via a small new toolbar button only; no internal changes to cell state.
- `app/src/pages/Watchlists.module.css`, `app/src/pages/ThemeTrackerPage.module.css`, `app/src/pages/MultiChart.module.css`
- All backend code (`api/**`)
- All DB schemas and migrations
- All existing tests for the three subsumed pages

## Component design

### `ChartsHub.jsx`

Responsibilities:

1. Render the page header — `📈 Charts` title + horizontal sub-tab strip.
2. Read `?tab=` query param; fall back to `usePreferences('charts_last_tab')`; fall back to `'chart'`.
3. On sub-tab change, update both the URL (`navigate(\`/charts?tab=${id}\`, { replace: true })`) and the preference.
4. Provide `ChartsSymContext` to all sub-tabs.
5. Lazy-mount sub-tabs with `React.lazy` + `Suspense`. Once mounted, sub-tabs stay alive (`display: none` switching, not unmount), so live streams don't reboot on every switch — but inactive sub-tabs that have never been visited stay completely unmounted, avoiding three concurrent streams on first load.

Pseudocode:

```jsx
const SUB_TABS = [
  { id: 'chart',      label: 'Chart',       component: lazy(() => import('./ChartTab')) },
  { id: 'watchlist',  label: 'Watchlist',   component: lazy(() => import('../Watchlists')) },
  { id: 'themes',     label: 'Themes',      component: lazy(() => import('../ThemeTrackerPage')) },
  { id: 'multichart', label: 'Multi-Chart', component: lazy(() => import('../MultiChart')) },
]

function ChartsHub() {
  const [sym, setSym] = useState(/* see Chart sub-tab section */)
  const [activeId, setActiveId] = useChartsTab()  // URL ↔ pref sync
  const [mountedIds, setMountedIds] = useState(new Set([activeId]))

  useEffect(() => { setMountedIds(prev => new Set([...prev, activeId])) }, [activeId])

  return (
    <ChartsSymContext.Provider value={{ sym, setSym }}>
      <Header activeId={activeId} onTabChange={setActiveId} />
      <Body>
        {SUB_TABS.map(tab => (
          mountedIds.has(tab.id) && (
            <div key={tab.id} style={{ display: tab.id === activeId ? 'block' : 'none' }}>
              <Suspense fallback={<Loading />}>
                <tab.component />
              </Suspense>
            </div>
          )
        ))}
      </Body>
    </ChartsSymContext.Provider>
  )
}
```

### `ChartTab.jsx`

Minimal single-chart surface:

```jsx
function ChartTab() {
  const { sym, setSym } = useChartsSym()
  const symbol = sym || 'SPY'  // SPY default on first-ever visit
  return (
    <div className={styles.chartTab}>
      <StockChart symbol={symbol} onSymbolChange={setSym} />
    </div>
  )
}
```

Reuses the existing `StockChart` component verbatim — inherits the full chart toolbar (timeframe tabs, EXT/RTH, settings gear, drawing tools, crosshair OHLCV legend, watermark, etc.). The hub doesn't impose a separate header above; `StockChart`'s built-in `SymbolSearch` (already a clickable title) handles symbol changes.

### `ChartsSymContext.jsx`

```jsx
const ChartsSymContext = createContext(null)

export function useChartsSym() {
  const ctx = useContext(ChartsSymContext)
  // Null-safe — sub-tabs may render outside the hub during transition.
  return ctx || { sym: null, setSym: () => {} }
}

export { ChartsSymContext }
```

### Watchlists.jsx adapter

Tiny addition:

```jsx
import { useChartsSym } from './charts/ChartsSymContext'

function Watchlists() {
  const { sym: hubSym, setSym: setHubSym } = useChartsSym()
  // ... existing state, with one wrapper around the row-click handler:
  const handleRowClick = (ticker) => {
    setSelectedSym(ticker)        // existing internal state
    setHubSym(ticker)             // new: also publish to hub context
  }
  // Optional: useEffect to react to hubSym changes from other sub-tabs
}
```

### ThemeTrackerPage.jsx adapter

Same pattern — on holding chip click, also call `setHubSym(ticker)`. Optional `useEffect` to highlight the matching theme/holding when `hubSym` changes.

### MultiChart.jsx — "Apply current ticker" button

The lightest possible integration. Add one button to MultiChart's header controls (alongside "Watch Panel"):

```jsx
const { sym: hubSym } = useChartsSym()
// ...
<button
  onClick={() => updateCell(focusedIdx, { ...state.cells[focusedIdx], sym: hubSym })}
  disabled={!hubSym}
>
  Apply {hubSym || 'ticker'} to focused cell
</button>
```

Requires tracking a `focusedIdx` (the last-clicked cell). If that's more invasive than a 10-line change, fallback: button applies the ticker to cell #0. (Implementation plan can decide.)

## URL behavior

| Path | Behavior |
|---|---|
| `/charts` | Land on default sub-tab (last-visited or `chart`) |
| `/charts?tab=chart` | Open Chart sub-tab |
| `/charts?tab=chart&sym=NVDA` | Open Chart sub-tab pre-loaded with NVDA |
| `/charts?tab=watchlist` | Open Watchlist sub-tab |
| `/charts?tab=themes` | Open Themes sub-tab |
| `/charts?tab=multichart` | Open Multi-Chart sub-tab |
| `/theme-tracker` *(legacy)* | Redirect to `/charts?tab=themes` (preserve any extra query params) |
| `/watchlists` *(legacy)* | Redirect to `/charts?tab=watchlist` (preserve extra query params) |
| `/multi-chart` *(legacy)* | Redirect to `/charts?tab=multichart` |

The `?sym=` param on `?tab=chart` is bidirectional — if the URL has it, it seeds `ChartsSymContext`; if user changes ticker in the chart, the URL updates.

## Free-tier wiring

Currently `FREE_PAGES` in `AuthGuard.jsx` (mirrored in `NavBar.jsx` and `MobileNav.jsx`) includes `/watchlists` and `/theme-tracker` but **not** `/multi-chart`. After this change:

- **Add to `FREE_PAGES`:** `/charts`, `/multi-chart` (the legacy paths must remain free so their redirect fires before the auth gate kicks unauthenticated free users back to `/dashboard`).
- **Keep in `FREE_PAGES`:** `/watchlists`, `/theme-tracker` (legacy redirect targets).

Net effect: free users gain access to Multi-Chart (small expansion in free tier).

## Mobile pattern

Sub-tab strip:

```css
.subtabStrip {
  display: flex;
  gap: 4px;
  overflow-x: auto;
  scroll-snap-type: x mandatory;
  -webkit-overflow-scrolling: touch;
}
.subtab { scroll-snap-align: start; flex-shrink: 0; }
```

Matches the existing Breadth tab strip pattern (Monitor | Heatmap | COT Data | Data Charts | Analogues), so no new conventions.

The page header still shows `📈 Charts` as the page title on mobile (consumed by the existing mobile hamburger header).

## Lazy-mount strategy

| Behavior | Why |
|---|---|
| **On hub mount:** only the active sub-tab mounts | Avoid spinning up Watchlists' alert poll + ThemeTracker's SSE + MultiChart's WebSocket all at once before user has visited them. |
| **On sub-tab switch:** previously-mounted sub-tabs stay mounted (toggle `display: none`) | Preserve scroll position, chart state, draft notes, alert subscription state. Live streams don't reboot. |
| **Newly-visited sub-tabs mount once and persist** | After 10 minutes of browsing all four, all four are mounted and live. This is fine — same as the old world where the user could navigate between three separate routes. |

Trade-off accepted: a long session can end up with all three live streams running. Mitigation later if it matters (e.g., pause inactive streams). Phase 1 keeps it simple.

## Risks and mitigations

| Risk | Mitigation |
|---|---|
| Three live data streams running concurrently after user has visited all sub-tabs | Lazy-mount on first visit only. Phase 2 polish: pause streams when sub-tab hidden. |
| Breaking Watchlists' 1025 lines of internal logic (alerts, drag-and-drop, tags, etc.) | Render `Watchlists.jsx` unmodified except for a ≤10-line context adapter. All existing internals + tests stay intact. |
| Old URL bookmarks / Compass tool outputs / Discord links break | `<Navigate>` redirects preserve query params for `/theme-tracker`, `/watchlists`, `/multi-chart`. Legacy paths kept in `FREE_PAGES` so redirects run before the auth gate. |
| AuthGuard blocks free users on legacy paths before redirect fires | Add the three legacy paths to `FREE_PAGES`. |
| Intro animation pill grid still lists "Theme Tracker" and "Watchlists" | Deferred to polish pass per `feedback_ship_then_polish` — flagged for future cleanup. |
| Mobile 4-tab strip cramped | Horizontal-scroll with snap points (Breadth pattern). |
| Multi-Chart's `WATCH_PANEL_PRESET` (QQQ/SPY/IWM/DIA button) breaks | MultiChart rendered as-is; preset untouched. Verified safe. |
| Partner-collab branch conflicts | None of the three target files are partner files (per `project_partner_collab_branch.md`). Confirmed safe. |
| Watchlist deep-link query params dropped through redirect | `<Navigate>` is configured to merge query params from the source URL into the destination. |

## Testing

### New tests

- `app/src/pages/charts/ChartsHub.test.jsx`
  - Renders the four sub-tab labels
  - `?tab=` query param controls active sub-tab
  - Clicking a sub-tab updates URL + `usePreferences('charts_last_tab')`
  - First-ever visit (no preference) lands on `chart`
  - Returning visit (preference set) restores last-visited
  - Lazy-mount: inactive sub-tabs that have never been visited do not appear in the DOM
- `app/src/pages/charts/ChartTab.test.jsx`
  - Default SPY when context sym is null
  - Renders context sym when provided
  - Symbol change in StockChart updates context
- `app/src/App.test.jsx` (extend existing)
  - `/theme-tracker` redirects to `/charts?tab=themes`
  - `/watchlists?id=42` redirects to `/charts?tab=watchlist&id=42` (query merge)
  - `/multi-chart` redirects to `/charts?tab=multichart`
  - All three redirects pass the AuthGuard for free-tier users

### Existing tests stay green

- All current Watchlists tests
- All current ThemeTracker tests
- All current MultiChart tests
- All existing AuthGuard tests (with the expanded `FREE_PAGES` list)

## Implementation phases

This spec is **Phase 1**. Subsequent phases live in their own specs:

- **Phase 1 (this spec):** Shell, routing, sub-tabs, context, redirects, nav swap, FREE_PAGES update, ChartTab sub-tab with SPY default.
- **Phase 2 polish (future, separate spec):** Intro-animation pill grid cleanup (drop "Theme Tracker" + "Watchlists" pills); "Recently Viewed tickers" ribbon on Chart sub-tab; pause inactive sub-tab streams.
- **Phase 3 expansion (future, separate spec):** Optionally fold in Screener / Custom Scan / UCT 20 if the unified hub feels right after Phase 1 ships.

## Acceptance criteria

A user with no prior `charts_last_tab` preference, visiting `/charts`, sees the **Chart sub-tab with SPY loaded**. They click Watchlist sub-tab — Watchlists renders identically to today. They click a ticker (say NVDA) in their list. They click Chart sub-tab — NVDA is loaded. They click Multi-Chart sub-tab — see the existing Multi-Chart with a new "Apply NVDA to focused cell" button. They refresh the page — they're on Multi-Chart sub-tab (last visited). They navigate to `/theme-tracker?bookmark=old_link` — they end up at `/charts?tab=themes&bookmark=old_link` and Themes renders. A free-tier user can do all of the above.
