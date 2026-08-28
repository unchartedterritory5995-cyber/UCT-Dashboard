import { createContext, useContext } from 'react'

export const WorkspaceContext = createContext(null)

const FALLBACK = {
  groupSyms: { A: null, B: null, C: null, D: null },
  setGroupSym: () => {},
  chartsTheme: 'default',   // workspace-wide chart theme ('default' | 'sunrise')
  crosshairBus: { emit: () => {}, subscribe: () => () => {} },
  // request(query) → delivers to any mounted AI Search widget; returns true if one
  // handled it (so the caller can fall back to a temporary popup when false).
  aiSearchBus: { subscribe: () => () => {}, request: () => false },
  // Ref holding the widgetId of the last-hovered chart widget. null = every
  // chart handles hotkeys (pre-first-hover baseline = the legacy behavior);
  // after a hover, only the active widget's document keydown fires, so a TF
  // key no longer retimes every mounted chart / fires N duplicate pref POSTs.
  activeChartRef: null,
  // Custom-Period Sort: when true, chart widgets enter drag-to-highlight mode; a
  // completed drag calls onPeriodSelected(sym, startYmd, endYmd, pctChange).
  periodSortMode: false,
  onPeriodSelected: () => {},
  onPeriodCancel: () => {},
  // Replay mode: an ISO 'YYYY-MM-DD' cutoff; linked charts hide every bar after it.
  replayCutoff: null,
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
}

export function useWorkspace() {
  return useContext(WorkspaceContext) || FALLBACK
}

// For hosts OUTSIDE the charts workspace that need to provide one real member
// (e.g. /ai-search provides a live aiSearchBus so a new deep-link appends a
// turn instead of remounting the widget). Spread this, override the member —
// never hand-copy the shape (second-authority defect).
export const WORKSPACE_FALLBACK = FALLBACK
