# Charts Hub V2 — Customizable Workspace Design Spec

**Date:** 2026-05-24
**Status:** Approved, ready for implementation planning
**Supersedes:** `2026-05-23-charts-hub-unification-design.md` (V1 sub-tabs)
**Phase:** MVP (drag-resize-save with 4 widget types; named layouts deferred)

## Goal

Replace the V1 sub-tab model (shipped 2026-05-23) with a **fully customizable workspace** on `/charts`. Users can place any supported widget anywhere on a drag-resizable grid, with same-color widgets sharing a ticker. The single, auto-saved layout persists per user.

This isn't an incremental polish of V1 — it's a different mental model. V1's sub-tabs (Chart / Watchlist / Themes / Multi-Chart) are removed entirely; those concepts become **widget types** that can be placed anywhere on the workspace.

## Non-goals (this spec)

- No named/multiple saved layouts (one layout per user; Phase 2)
- No widget marketplace / settings panel per widget beyond a header color picker
- No mobile workspace support (mobile gets a clean single full-screen chart only)
- No Multi-Chart sub-tab — its use case is solved by adding multiple Chart widgets to the workspace
- No COT / Patterns / Dashboard tiles as widgets in this phase (deferred)
- No backend changes; layout serializes into existing `usePreferences` blob
- No changes to widget internals (Watchlists / ThemeTrackerPage / Screener render unchanged inside widget shells)

## Decisions locked during brainstorming

| Decision | Choice |
|---|---|
| **Layout model** | Customizable grid via `react-grid-layout` library |
| **MVP widget types (4)** | Chart · Watchlist · Themes · Scanner |
| **Ticker linking** | TradingView-style **color groups** — same-color widgets share an active ticker (Groups A, B, C, D = gold, blue, green, purple) |
| **Saved layouts per user** | One auto-saved layout; named layouts deferred to Phase 2 |
| **Mobile (<640px)** | Fall back to a single full-screen `StockChart` with `SymbolSearch`. No widgets. |
| **Default layout (new user)** | Pre-populated with 3 widgets: Chart (Group A, large) + Watchlist (Group A, top-left small) + Themes (Group B, bottom-left small) |
| **V1 sub-tabs fate** | **Removed entirely.** `ChartsHub`, `ChartTab`, sub-tab strip — all deleted. `/charts` opens straight to the workspace. |
| **Legacy URL redirects** | Unchanged — `/theme-tracker`, `/watchlists`, `/multi-chart` still redirect to `/charts` (but without `?tab=` since sub-tabs no longer exist; query is stripped) |
| **Library version** | `react-grid-layout@^1.4.4` (latest stable as of this writing) |

## Architecture

### New top-level component

**`app/src/pages/charts/ChartsWorkspace.jsx`** replaces `ChartsHub.jsx`. It:

1. Reads/writes the layout JSON via `usePreferences('charts_workspace_layout')`
2. Reads/writes per-color-group active tickers via `usePreferences('charts_workspace_groups')`
3. Renders a `ResponsiveReactGridLayout` (from `react-grid-layout`) with the layout
4. Detects mobile (`<640px`) and short-circuits to `<MobileChartFallback />` instead
5. Provides `WorkspaceContext` (replacement for V1 `ChartsSymContext`) — color-group-aware ticker state
6. Renders the workspace toolbar: `+ Add Widget` button, `Reset layout` ghost button, auto-save indicator

### Widget system

A **widget** is `{ id, type, color, x, y, w, h, opts }`:

- `id` — UUID per widget instance
- `type` — `'chart' | 'watchlist' | 'themes' | 'scanner'`
- `color` — `'A' | 'B' | 'C' | 'D'` (which color group this widget belongs to)
- `x, y, w, h` — grid coordinates (managed by react-grid-layout)
- `opts` — type-specific options (e.g., for Chart: `{ tf: 'D' }`; for Watchlist: `{ list_id: 42 }`)

**Widget dispatcher** — `app/src/pages/charts/WidgetHost.jsx`:

```jsx
function WidgetHost({ widget, onRemove, onColorChange, onOptsChange }) {
  const inner = (() => {
    switch (widget.type) {
      case 'chart':     return <ChartWidget    color={widget.color} opts={widget.opts} onOptsChange={onOptsChange} />
      case 'watchlist': return <WatchlistWidget color={widget.color} opts={widget.opts} onOptsChange={onOptsChange} />
      case 'themes':    return <ThemesWidget    color={widget.color} opts={widget.opts} onOptsChange={onOptsChange} />
      case 'scanner':   return <ScannerWidget   color={widget.color} opts={widget.opts} onOptsChange={onOptsChange} />
      default:          return <UnknownWidget type={widget.type} />
    }
  })()
  return (
    <div className={styles.widget}>
      <WidgetHeader
        widget={widget}
        onRemove={onRemove}
        onColorChange={onColorChange}
      />
      <div className={styles.widgetBody}>{inner}</div>
    </div>
  )
}
```

The header (`<WidgetHeader>`) provides the drag handle (via react-grid-layout's `draggableHandle` className), a color-dot picker (A/B/C/D popover), a label, and a close ✕.

### Widget files (4 new + 1 mobile fallback + 1 header + 1 dispatcher)

| File | Wraps | Notes |
|---|---|---|
| `ChartWidget.jsx` | Existing `StockChart` | Reads ticker from its color group; calls `setGroupSym(widget.color, ticker)` on internal symbol changes. `opts.tf` overrides default timeframe. |
| `WatchlistWidget.jsx` | Existing `Watchlists` page | Renders the existing page component inside the widget shell. On row click, publishes ticker to color group. Hides its own internal chart panel via a prop (so the embedded version is list-only). |
| `ThemesWidget.jsx` | Existing `ThemeTrackerPage` | Same pattern: existing page rendered without its right-side chart, publishes ticker on holding click. |
| `ScannerWidget.jsx` | Existing `Screener` page | Same pattern: list-only mode, publishes ticker on candidate click. |
| `MobileChartFallback.jsx` | `StockChart` + `SymbolSearch` | Full-screen chart for `<640px`. No grid, no widgets. |
| `WidgetHeader.jsx` | — | Drag handle, label, color-dot picker, close button. |
| `WidgetHost.jsx` | — | Type dispatcher (above). |

### The "list-only mode" prop

`Watchlists.jsx`, `ThemeTrackerPage.jsx`, and `Screener.jsx` each have an internal right-side `StockChart` (from V1 days and earlier). Inside the workspace, they're rendered alongside dedicated Chart widgets — so the embedded chart is redundant and consumes space.

Add a single prop to each: `embedded={true}` (boolean, default false). When `embedded`, the component hides its internal chart panel and renders list-only. The page-level entry points (if they still exist after redirects) pass `embedded={false}` (or omit), preserving existing standalone behavior.

This is the smallest possible internal change to those files — a single conditional render, ~5 lines each.

### Color groups + WorkspaceContext

```jsx
// WorkspaceContext value shape
{
  groupSyms: { A: 'NVDA', B: 'SPY', C: null, D: null },
  setGroupSym: (color, sym) => void,
}
```

`setGroupSym('A', 'NVDA')` updates `groupSyms.A`, persists to `usePreferences('charts_workspace_groups')`, and triggers a re-render of all widgets that read from group A.

**Widget consumption pattern:**

```jsx
function ChartWidget({ color, opts }) {
  const { groupSyms, setGroupSym } = useWorkspace()
  const sym = groupSyms[color] || 'SPY'
  return <StockChart sym={sym} onSymbolChange={(s) => setGroupSym(color, s)} />
}
```

**Backwards compatibility with V1's `useChartsSym`:** the V1 hook stays in the codebase as a deprecated re-export that maps to Group A:

```jsx
// app/src/pages/charts/ChartsSymContext.jsx (deprecated, kept for safety)
export function useChartsSym() {
  const { groupSyms, setGroupSym } = useWorkspace()
  return { sym: groupSyms.A, setSym: (s) => setGroupSym('A', s) }
}
```

This ensures the V1 adapters in `Watchlists.jsx`, `ThemeTrackerPage.jsx`, `MultiChart.jsx` keep working unchanged during the transition. (They get replaced with the new color-aware pattern as part of the widget wrapping work, but the hook still exists so nothing breaks if missed.)

### Default layout (new users)

When `prefs.charts_workspace_layout` is null/empty, the workspace seeds itself with:

```json
{
  "widgets": [
    { "id": "w1", "type": "watchlist", "color": "A", "x": 0,  "y": 0, "w": 3, "h": 6, "opts": {} },
    { "id": "w2", "type": "chart",     "color": "A", "x": 3,  "y": 0, "w": 9, "h": 8, "opts": { "tf": "D" } },
    { "id": "w3", "type": "themes",    "color": "B", "x": 0,  "y": 6, "w": 3, "h": 4, "opts": {} }
  ],
  "cols": 12,
  "rowHeight": 40
}
```

Grid is 12 columns wide. Chart takes 9 columns × 8 rows (large), Watchlist 3×6 (top-left), Themes 3×4 (bottom-left). No Scanner by default — user adds it from `+ Add Widget`.

If user's preferences blob has `charts_last_tab` (a V1 leftover), it's ignored. Migration is destructive — no attempt to map V1 sub-tab state into a V2 layout.

### Layout persistence

```jsx
const [layout, setLayout] = useState(defaultLayout)
const { prefs, setPref } = usePreferences()

// Load on mount
useEffect(() => {
  if (prefs.charts_workspace_layout) {
    try {
      const parsed = typeof prefs.charts_workspace_layout === 'string'
        ? JSON.parse(prefs.charts_workspace_layout)
        : prefs.charts_workspace_layout
      if (parsed?.widgets?.length) setLayout(parsed)
    } catch {}
  }
}, [prefs.charts_workspace_layout])

// Save on change (debounced)
const debouncedSave = useDebounce(layout, 500)
useEffect(() => {
  setPref('charts_workspace_layout', JSON.stringify(debouncedSave))
}, [debouncedSave])
```

500 ms debounce prevents `setPref` storm during drag-resize (which fires `onLayoutChange` per pointer move).

### Add Widget UX

Clicking the `+ Add Widget` button in the toolbar opens a small dropdown menu with the 4 widget types (Chart · Watchlist · Themes · Scanner). Picking a type:

1. Generates a fresh UUID
2. Assigns the next available color group (cycles A→B→C→D→A based on what's already in use, defaulting to A if no widgets exist)
3. Inserts the new widget at the end of the layout (`y: Infinity` — react-grid-layout's bottom-pack)
4. Uses a default size per type: Chart `w:6 h:8 minW:3 minH:4`, Watchlist `w:3 h:6 minW:2 minH:3`, Themes `w:3 h:6 minW:2 minH:3`, Scanner `w:4 h:6 minW:3 minH:3`

No modal, no preview, no settings — just pick a type and it appears. Settings (color, size, position) are adjusted post-add via the header color dot and drag/resize handles.

### Mobile fallback

```jsx
function ChartsWorkspace() {
  const isMobile = useMediaQuery('(max-width: 640px)')
  if (isMobile) return <MobileChartFallback />
  // ... workspace renders
}
```

`MobileChartFallback.jsx`:

```jsx
function MobileChartFallback() {
  const [sym, setSym] = useState(() => localStorage.getItem('charts_mobile_sym') || 'SPY')
  useEffect(() => { localStorage.setItem('charts_mobile_sym', sym) }, [sym])
  return (
    <div className={styles.mobileChart}>
      <StockChart sym={sym} onSymbolChange={setSym} />
    </div>
  )
}
```

Mobile state is independent of desktop workspace state — no syncing across breakpoints. Resizing window above 640px wipes the mobile-only sym and uses the workspace's Group A sym instead.

## Files

### Created (10 files)

```
app/src/pages/charts/
├── ChartsWorkspace.jsx              # New top-level shell
├── ChartsWorkspace.module.css       # Workspace + widget styles
├── ChartsWorkspace.test.jsx         # Mount, layout-load, default-layout, mobile-detect, color-group-publish
├── WorkspaceContext.jsx             # Color group context + hook
├── WorkspaceContext.test.jsx
├── WidgetHost.jsx                   # Type dispatcher
├── WidgetHeader.jsx                 # Drag handle + color picker + close
├── WidgetHeader.test.jsx
├── widgets/ChartWidget.jsx
├── widgets/WatchlistWidget.jsx
├── widgets/ThemesWidget.jsx
├── widgets/ScannerWidget.jsx
├── widgets/MobileChartFallback.jsx
└── widgets/widgets.test.jsx         # Shared tests for the 4 widget types (color-group wiring, embedded prop)
```

(Above shows files inside `app/src/pages/charts/` — the `widgets/` subdirectory groups widget implementations.)

### Modified (6 files)

| File | Change |
|---|---|
| `app/src/App.jsx` | Replace `ChartsHub` import with `ChartsWorkspace`. Update `/charts` route element. Legacy redirects untouched (they still redirect to `/charts`). |
| `app/src/pages/Watchlists.jsx` | Add `embedded` prop. When `embedded={true}`, hide the right-side `StockChart` panel; render list-only. |
| `app/src/pages/ThemeTrackerPage.jsx` | Same — add `embedded` prop. Hide right-side chart when true. |
| `app/src/pages/Screener.jsx` | Same — add `embedded` prop. Hide internal chart-on-right pattern when true. |
| `app/src/pages/charts/ChartsSymContext.jsx` | Reduce to a deprecated thin wrapper around `useWorkspace()` (maps to Group A) for backwards compat. |
| `app/src/pages/charts/LegacyRedirect.jsx` | Strip the `?tab=` query param from the redirect target — `/charts` no longer takes a tab param. (Other query params still preserved.) |

### Deleted (5 files)

```
app/src/pages/charts/ChartsHub.jsx              # Replaced by ChartsWorkspace.jsx
app/src/pages/charts/ChartsHub.test.jsx
app/src/pages/charts/ChartsHub.module.css
app/src/pages/charts/ChartTab.jsx               # Replaced by widgets/ChartWidget.jsx
app/src/pages/charts/ChartTab.test.jsx
```

The deletes are surgical — `git rm` each, no dangling references.

### Existing files untouched

- `app/src/pages/MultiChart.jsx` — still exists as a code file (the workspace effectively replaces its use case, but the file isn't deleted). The "Apply ticker" button it gained in V1 still works because `useChartsSym` is shimmed. It's no longer reachable through nav, only via the now-redirecting `/multi-chart` URL.
- `NavBar.jsx`, `MobileNav.jsx`, `AuthGuard.jsx` — V1's nav swap + FREE_PAGES are correct; nothing changes.
- All backend, DB, tests for the page internals.

## Dependency addition

```bash
cd app && npm install react-grid-layout@^1.4.4
```

This is the only new runtime dependency. The library bundles its own minimal CSS (must be imported once: `import 'react-grid-layout/css/styles.css'` in `ChartsWorkspace.jsx`).

License: **MIT** ✓
Bundle size impact: **~30 KB** gzipped ✓
React 18 compatible: **Yes** ✓
Maintained: Active, weekly downloads ~1M ✓

## Mobile behavior detail

The `useMediaQuery` hook should be implemented inline (no new dependency) using `window.matchMedia`:

```jsx
function useMediaQuery(query) {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches)
  useEffect(() => {
    const mq = window.matchMedia(query)
    const handler = (e) => setMatches(e.matches)
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [query])
  return matches
}
```

Place this in `app/src/hooks/useMediaQuery.js` (small, reusable). If a similar hook already exists in the codebase, use that.

## Risks and mitigations

| Risk | Mitigation |
|---|---|
| `react-grid-layout` requires a container width prop; tricky inside flexbox parents | Use `WidthProvider` HOC (built-in to the library); pass a min/max width fallback |
| Embedded widgets (Watchlists, Themes, Screener) have their own scroll containers + internal `StockChart`s that get expensive when shrunk into a small cell | `embedded` prop hides their internal chart entirely; CSS overrides give widget body a fixed scroll container |
| User drags a widget down to size 1×1 — content unreadable | Set `minW: 2, minH: 3` on every widget layout entry; react-grid-layout enforces these |
| Layout serialization corruption (bad JSON in prefs) | Try/catch around parse; on failure, fall back to default layout. Log a warning to console. |
| Auto-save fires on every grid-layout-change event during a drag (storm) | 500 ms debounce on the persist effect |
| User on a low-resolution desktop (~1000 px) finds the 12-col grid too cramped | Library auto-collapses to fewer columns at responsive breakpoints — configure `breakpoints: { lg: 1200, md: 996, sm: 768 }` and matching `cols` |
| Multi-Chart route `/multi-chart` still exists as a redirect; some users may bookmark it | Acceptable — redirects to `/charts`. User loses their multi-chart cells but lands on the workspace, where they can recreate via Chart widgets. |
| V1's adapters in Watchlists.jsx/ThemeTrackerPage.jsx still call `useChartsSym` | Shim preserves V1 behavior (writes to Group A). Widget versions wrap them and pre-empt the call. Belt-and-suspenders safe. |
| `charts_last_tab` preference leftover from V1 lingers in users' prefs blob | Harmless — V2 just ignores it. No cleanup needed. |
| Intro animation pill grid still says "Theme Tracker" / "Watchlists" | Deferred to polish (same as V1 spec said). Eventually replace with "Customizable Charts Workspace" or similar. |
| Partner-collab branch | None of the new/deleted/modified files are partner files. Confirmed safe (`OptionsFlow.jsx`, `schwab_router.py` untouched). |

## Testing

### New tests

- **`WorkspaceContext.test.jsx`** — group state read/write, persistence, default values
- **`ChartsWorkspace.test.jsx`** — default layout seeds on first visit, saved layout restores on returning visit, layout changes trigger debounced save, mobile media query short-circuits to MobileChartFallback
- **`WidgetHeader.test.jsx`** — color dot click cycles A→B→C→D→A, close button calls `onRemove`
- **`widgets/widgets.test.jsx`** — each of the 4 widget types renders correctly, reads from its color group, writes back to its color group on internal selection events. Use mocks for the wrapped page components (similar pattern to V1's `ChartTab.test.jsx`).

### Existing tests stay green

- All Watchlists / ThemeTracker / Screener internal-component tests (the `embedded` prop change is purely additive)
- V1's `ChartsSymContext.test.jsx` should be UPDATED (since the file changes meaning) — replace its test logic with a smoke test that confirms the deprecated wrapper still returns `{ sym, setSym }` from Group A
- V1's `ChartTab.test.jsx` is **deleted** (file is deleted)
- V1's `ChartsHub.test.jsx` is **deleted** (file is deleted)
- V1's `LegacyRedirect.test.jsx` — one test needs an update because `/multi-chart?tab=multichart` now becomes `/charts` (no `?tab=`)
- V1's `NavBar.test.jsx` should still pass (nav structure unchanged)

## Implementation phases (this spec = MVP; follow-ons are separate specs)

**Phase 1 — this spec (MVP):**
- `react-grid-layout` installed
- `WorkspaceContext` with 4 color groups
- 4 widget types (Chart, Watchlist, Themes, Scanner) with shared header
- Default 3-widget layout on first visit
- Layout auto-save to `usePreferences`
- Mobile fallback
- V1 files deleted
- All redirects updated

**Phase 2 polish (future spec):**
- Named/multiple saved layouts ("Day trading" / "Swing setup" preset switcher)
- Add Widget modal with previews instead of a simple dropdown
- More widget types: COT · Patterns · Calendar · MA Relationship · UCT 20 leadership
- Widget settings popovers (timeframe per chart, list_id per watchlist, etc.)
- Intro animation pill grid cleanup

**Phase 3 — future, separate spec:**
- Cross-account workspace layouts (per-account workspace)
- Shareable workspace presets (community presets a la Watchlist sharing)
- Pause-on-hidden for inactive widgets (optimize live streams)

## Acceptance criteria

A user with no prior preferences visits `/charts`. They see a 3-widget layout: a large Chart widget (Group A gold dot, showing SPY), a Watchlist widget (Group A, top-left), and a Themes widget (Group B blue dot, bottom-left).

They click NVDA in the Watchlist → the Chart updates to NVDA (same Group A). The Themes widget does NOT change (Group B). They click `+ Add Widget` and pick Scanner → a Scanner widget appears at bottom-right with a default Group C green dot.

They drag the Chart widget by its header to a new position. They resize the Themes widget by its bottom-right corner. After 500 ms, the address bar / DevTools shows a `POST /api/auth/preferences` for `charts_workspace_layout`.

They refresh the page → all positions, sizes, colors, and contents are restored exactly.

They navigate to `/theme-tracker` → redirected to `/charts` (no `?tab=`); the workspace renders as last saved.

They open the page on a phone (`<640px`) → see a single full-screen `StockChart` of SPY with a `SymbolSearch` header. No workspace visible.

A free-tier user can do all of the above (workspace is part of the free tier, same as V1).

---

## Out of scope (call-outs)

- **No new backend or API work.** Layout JSON piggybacks on the existing `/api/auth/preferences` blob.
- **No DB migrations.**
- **No changes to Watchlists' alerts, drag-and-drop, tag system, sharing — none of that touches this spec.**
- **No changes to MorningWire, Breadth, Calendar, Journal, Compass, Voice, or any other page outside `/charts`.**
- **No "Apply ticker to cell" button on Multi-Chart** — the file is no longer reachable from nav, so the button is dead code that doesn't render. Cleanup deferred.
