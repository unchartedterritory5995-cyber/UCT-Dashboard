import { useCallback, useMemo, useRef, useState } from 'react'

// The breadth drill's WorkspaceContext value — "one component, three hosts".
// /charts, the journal note (frozenWorkspace.js) and now the breadth drill all
// mount the SAME workspace widgets; only the context under them differs.
//
// ⛔ BUILD RULE (inherited verbatim from frozenWorkspace.js, and it is the rule
// that matters most in this file): the ENTIRE surface the real provider
// supplies is enumerated here, every member either LIVE or stubbed
// DELIBERATELY — a member accidentally falling through to WorkspaceContext's
// FALLBACK (or to undefined) is a silent dead end.
//
// ⛔⛔ DO NOT "just spread WORKSPACE_FALLBACK". Its own doc comment invites you
// to, and that is the trap: the FALLBACK carries 19 members while the real
// provider carries 23. The four it omits are all read by widgets —
//   widgetCanvasByType / widgetCanvasById → WidgetHost; without them a widget's
//     chrome stops following that widget's own canvas colour.
//   chartApiById → ChartWidget registers its imperative API here. Without it
//     Send to Journal (getCaptureState) and Compare Symbols go dead SILENTLY.
//   activeWatchlistRef → Watchlists' `isActiveWidget()` is
//     `!activeRef || activeRef.current == null || activeRef.current === widgetKey`,
//     so an undefined ref passes VACUOUSLY and the list answers every arrow key
//     and every Shift+F regardless of focus.
// drillWorkspace.test.jsx derives the real provider's key set from
// ChartsWorkspace.jsx's SOURCE and fails BY NAME when the workspace grows a
// member this file does not carry.
//
// ── How this host differs from the journal's ──────────────────────────────
// The journal embed is FROZEN: every write is inert and the owner refs are
// sentinels, deliberately, so an embed can never swallow the page's keys.
// The drill is LIVE: the list must drive the chart, own ↑/↓ and Shift+F, and
// the chart must own its own hotkeys. So the refs here are REAL refs seeded
// null — never sentinels, and never left undefined.

/** Members that are inert in a two-widget modal, each with the reason.
 *  Kept as a named function (not inlined) so the completeness rail can see the
 *  keys and a reader can see, in one place, exactly what the drill gives up. */
function inertWorkspaceMembers() {
  return {
    // No AI Search widget is mounted in the drill, so nothing can receive a
    // request. This costs nothing: ChartWidget's "Ask AI about {sym}" does NOT
    // use this bus — it navigates to the canonical /research/:sym?section=ai
    // route (see ChartWidget's comment on why a security-scoped AI action must
    // mean the same canonical Ask AI everywhere).
    aiSearchBus: { subscribe: () => () => {}, request: () => false },

    // Custom-Period Sort is a whole-board mode driven by the Period Sort widget,
    // which the drill does not host.
    periodSortMode: false,
    onPeriodSelected: () => {},
    onPeriodCancel: () => {},

    // Replay Mode is a whole-board mode driven by the workspace's Replay panel.
    replayCutoff: null,
    exitReplay: () => {},
    replayArmPick: false,
    onReplayCutoffPicked: () => {},
    onReplayPickCancel: () => {},
    startMarker: null,
    startMarkerStyle: 'line',

    // The chart's right-click "Add widget ▸" submenu floats a NEW widget onto
    // the board. The drill's board is exactly two widgets by construction.
    floatNewWidget: () => {},

    // "Apply theme to all charts / all widgets" walks the saved layout. The
    // drill's two widgets carry their own opts in breadth_drill_board and are
    // not part of charts_workspace_layout.
    applyThemeToAllCharts: () => {},
    applyThemeToAllWidgets: () => {},
  }
}

/** A crosshair bus scoped to ONE board — per-instance on purpose, so two boards
 *  can never cross-talk. One throwing subscriber must not stop the rest. */
function makeCrosshairBus() {
  const subs = new Set()
  return {
    emit: (payload) => { subs.forEach(fn => { try { fn(payload) } catch { /* a bad subscriber must not stop the rest */ } }) },
    subscribe: (fn) => { subs.add(fn); return () => subs.delete(fn) },
  }
}

/** Build the drill host's context value from its live pieces.
 *  Pure + exported so the completeness rail can assert the full key set without
 *  standing up React state. */
export function drillWorkspaceValue({
  groupSyms,
  setGroupSym,
  chartsTheme = 'default',
  widgetCanvasByType = {},
  widgetCanvasById = {},
  crosshairBus,
  activeChartRef,
  chartApiById,
  activeWatchlistRef,
}) {
  return {
    // ── LIVE: the drill is an interactive host ──
    groupSyms,
    setGroupSym,
    chartsTheme,
    widgetCanvasByType,
    widgetCanvasById,
    crosshairBus,
    activeChartRef,
    chartApiById,
    activeWatchlistRef,
    // ── INERT, deliberately ──
    ...inertWorkspaceMembers(),
  }
}

/** React hook owning the drill board's live workspace state.
 *  `initialSym` seeds colour group A so the chart paints the first row's symbol
 *  on the very first frame rather than after a selection round-trip. */
export default function useDrillWorkspace({ initialSym = null, chartsTheme = 'default', widgetCanvasByType, widgetCanvasById } = {}) {
  const [groupSyms, setGroupSyms] = useState(() => ({ A: initialSym, B: null, C: null, D: null }))

  // Stable across renders: Watchlists memoizes its row-select handler on this,
  // so an unstable identity would re-render every row on every selection.
  const setGroupSym = useCallback((color, sym) => {
    setGroupSyms(prev => (prev[color] === sym ? prev : { ...prev, [color]: sym }));
  }, [])

  // Per-instance registries and owner refs. Per-instance matters for the same
  // reason it does in the journal host: two boards must never share a chart-api
  // map. Seeded null (NOT a sentinel) because the drill's widgets are supposed
  // to win their hotkeys once hovered.
  // ⛔ Built with useState's LAZY INITIALISER, not `useRef(null)` plus an
  // assign-on-first-render. Reading or writing a ref DURING RENDER is unsafe under
  // concurrent rendering (and the lint rule says so). The initialiser runs exactly
  // once per mount, which is what "per-instance registry" actually asks for.
  const [crosshairBus] = useState(makeCrosshairBus)
  const activeChartRef = useRef(null)
  const activeWatchlistRef = useRef(null)
  // ChartWidget does `chartApiById.current.set(id, …)`, so the context member is a
  // REF-SHAPED box whose .current IS the Map — not the Map itself.
  const [chartApiById] = useState(() => ({ current: new Map() }))

  // The ref OBJECTS are packaged into the context value; nothing dereferences
  // `.current` here. The widgets read them in effects and event handlers, which is
  // exactly where refs belong. Satisfying the rule literally would mean inlining
  // drillWorkspaceValue, and the completeness rail asserts against that shared
  // factory — so the rule is wrong about this call, not the code.
  // eslint-disable-next-line react-hooks/refs
  return useMemo(() => drillWorkspaceValue({
    groupSyms,
    setGroupSym,
    chartsTheme,
    widgetCanvasByType,
    widgetCanvasById,
    crosshairBus,
    activeChartRef,
    chartApiById,
    activeWatchlistRef,
  }), [groupSyms, setGroupSym, chartsTheme, widgetCanvasByType, widgetCanvasById, crosshairBus, chartApiById])
}
