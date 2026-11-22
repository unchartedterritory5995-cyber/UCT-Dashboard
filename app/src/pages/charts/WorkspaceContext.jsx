import { createContext, useContext, useLayoutEffect, useMemo, useState, useSyncExternalStore } from 'react'

export const WorkspaceContext = createContext(null)

const FALLBACK = {
  groupSyms: { A: null, B: null, C: null, D: null },
  // The /charts board's store of `groupSyms` (groupSymsStore.js), which useWorkspace() subscribes a reader
  // to; null here and on every host that supplies a plain `groupSyms`.
  groupSymsStore: null,
  setGroupSym: () => {},
  // The timeframe each color group's chart is CURRENTLY showing, broadcast by
  // ChartWidget so list widgets in the same group warm the cache key the chart
  // will actually read. ⚠️ EPHEMERAL, never persisted: `opts.tf` on the chart
  // widget stays the one authority for what a layout restores to (a second
  // stored copy would fight it). Seeded 'D' to match ChartWidget's own default.
  groupTfs: { A: 'D', B: 'D', C: 'D', D: 'D' },
  setGroupTf: () => {},
  // every chart's timeframe per colour group (registerGroupTf), for lists that warm ALL of them
  groupTfSets: {},
  registerGroupTf: () => () => {},
  // COV-10 — may a list widget subscribe to its group's scan? The board derives it from
  // the auth payload; every other host (and the fallback) says no.
  chartsTheme: 'default',   // workspace-wide chart theme ('default' | 'sunrise')
  // Per-widget canvas maps, read by WidgetHost to publish a widget's own canvas
  // colour into its subtree. Empty (not undefined) so a host that supplies
  // neither still gets the default tokens instead of `undefined[type]`.
  widgetCanvasByType: {},
  widgetCanvasById: {},
  crosshairBus: { emit: () => {}, subscribe: () => () => {} },
  // request(query) → delivers to any mounted AI Search widget; returns true if one
  // handled it (so the caller can fall back to a temporary popup when false).
  aiSearchBus: { subscribe: () => () => {}, request: () => false },
  // Ref holding the widgetId of the last-hovered chart widget. null = every
  // chart handles hotkeys (pre-first-hover baseline = the legacy behavior);
  // after a hover, only the active widget's document keydown fires, so a TF
  // key no longer retimes every mounted chart / fires N duplicate pref POSTs.
  activeChartRef: null,
  // Registry of per-chart imperative APIs (getCaptureState etc). ChartWidget
  // guards with `if (!chartApiById) return undefined`, so null is safe here —
  // it simply skips registration. ⚠️ A host that wants Send to Journal or
  // Compare Symbols to WORK must supply a real `{ current: new Map() }`.
  chartApiById: null,
  // Ref holding the widgetKey of the active watchlist-ish widget.
  // ⚠️ Watchlists' guard is `!activeRef || activeRef.current == null || ...`,
  // so null means "always active" — correct for the standalone /watchlists
  // page, WRONG for a multi-widget host, where every list would answer every
  // arrow key and Shift+F. A widget host MUST supply a real ref.
  activeWatchlistRef: null,
  // Custom-Period Sort: when true, chart widgets enter drag-to-highlight mode; a
  // completed drag calls onPeriodSelected(sym, startYmd, endYmd, pctChange).
  periodSortMode: false,
  onPeriodSelected: () => {},
  onPeriodCancel: () => {},
  // Replay mode: an ISO 'YYYY-MM-DD' cutoff; linked charts hide every bar after it.
  replayCutoff: null,
  // (Breadth drill "Mark day" — `markDay` / `markDayColor` — and `replayWarmIntraday: false` are
  // supplied only by the drill's own workspace value; absent here = no mark, normal Replay warm.
  // Kept OUT of this default so the Notebook's frozen workspace (Rule 12) needs no change.)
  exitReplay: () => {},
  // Replay Mode "Pick on chart": arm click/drag on the active chart to choose the cutoff.
  replayArmPick: false,
  onReplayCutoffPicked: () => {},
  onReplayPickCancel: () => {},
  // Custom-Period Sort "Mark start date": an ISO 'YYYY-MM-DD' + style ('line' gold
  // vertical line | 'candle' gold start-date candle). Cleared by exitReplay.
  startMarker: null,
  startMarkerStyle: 'line',
  // Create a NEW widget of `type` and immediately float it on top of the canvas
  // (TC2000-style overlay), opening small at `at` = {x,y} (the right-click point).
  // Used by a chart's right-click "Add widget" submenu.
  floatNewWidget: () => {},
  // Apply a UCT chart theme's visual layer to EVERY chart in the layout at once
  // (base widgets + chart tabs + widget tabs). null-safe no-op off the workspace.
  applyThemeToAllCharts: () => {},
  // Apply a theme to EVERY widget in the layout — chart or not (watchlist, theme
  // tracker, fundamentals, breadth, …). null-safe no-op off the workspace.
  applyThemeToAllWidgets: () => {},
  // Chart Settings → "Apply to all charts" (owner 11-16): `countOtherCharts(source)` = how many OTHER chart surfaces
  // the open layout holds (null when `source` is not one of them), `applyAppearanceToOtherCharts(source, settings)`
  // copies that chart's LOOK onto them in one layout write and returns how many changed (chartAppearanceAll.js).
  // `source` = `{ chartId, tabId }`. null off the workspace ⇒ ChartWidget offers no such door.
  countOtherCharts: null,
  applyAppearanceToOtherCharts: null,
  // UCT RS 3-09: this host mounts the Compare Symbols panel and opens it on a
  // `uct:compare-open` event (the desktop Charts workspace alone), so a chart's
  // readout may offer "Open the rotation map". Off everywhere else.
  canOpenCompare: false,
}

const NO_SUBSCRIPTION = () => () => {}

/**
 * Which renders of ONE component read `groupSyms`, so only those subscribe to it.
 *
 * `getSnapshot` is what `useSyncExternalStore` compares: the store's value while the component's last
 * committed render read `groupSyms`, and otherwise the value it last saw, frozen, so a symbol switch does
 * not re-render a component that does not print one. A read is the `groupSyms` getter on the returned
 * value (destructuring it in render is a read). Every read returns the store's CURRENT value, so a
 * component reading it in a handler or an effect is never handed a stale one, whether it re-renders or not.
 * Starts as a reader: a first render that reads nothing is settled by its own commit.
 */
function makeSymsReadTracker(store) {
  let readThisRender = false
  let reads = true
  let frozen
  return {
    store,
    beginRender: () => { readThisRender = false },
    commit: () => { reads = readThisRender },
    getSnapshot: () => { if (reads) frozen = store.get(); return frozen },
    read: () => { readThisRender = true; return store.get() },
  }
}

/**
 * The workspace a widget lives in.
 *
 * ⭐ (switch render cuts, 2026-11-20) The /charts board keeps its colour groups' symbols in a store
 * (`groupSymsStore.js`) and puts the STORE on the value, so the value does not change on a symbol switch
 * and the board does not re-render for one. Here the value's `groupSyms` is a getter onto that store, and
 * a component whose render reads it re-renders when a symbol changes, exactly as it did when the whole
 * value changed; one that only takes `setGroupSym`, the theme or a bus (every widget host, most list
 * widgets) does not. A host that supplies a plain `groupSyms` (the breadth drill, the screener, the
 * Notebook's frozen workspaces) is returned as it is.
 */
export function useWorkspace() {
  const value = useContext(WorkspaceContext) || FALLBACK
  const store = value.groupSymsStore || null
  const [tracker, setTracker] = useState(() => (store ? makeSymsReadTracker(store) : null))
  // A host that swaps its store (a different board) gets a tracker of its own (a render-phase update).
  const live = tracker && store && tracker.store === store ? tracker : null
  if (store && !live) setTracker(makeSymsReadTracker(store))
  if (live) live.beginRender()
  useLayoutEffect(() => { if (live) live.commit() })
  const syms = useSyncExternalStore(
    live ? store.subscribe : NO_SUBSCRIPTION,
    live ? live.getSnapshot : () => value.groupSyms,
  )
  return useMemo(() => {
    if (!live) return value
    const out = { ...value }
    Object.defineProperty(out, 'groupSyms', { enumerable: true, configurable: true, get: live.read })
    return out
    // `syms` is read by the getter, not here: a reader still gets a NEW value object when a symbol changes,
    // as before, so a memo or effect keyed on the whole workspace re-runs for it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, live, syms])
}

// For hosts OUTSIDE the charts workspace that need to provide one real member
// (e.g. /ai-search provides a live aiSearchBus so a new deep-link appends a
// turn instead of remounting the widget). Spread this, override the member —
// never hand-copy the shape (second-authority defect).
export const WORKSPACE_FALLBACK = FALLBACK
