import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Responsive, WidthProvider } from 'react-grid-layout'
import 'react-grid-layout/css/styles.css'
import usePreferences, { parsePref } from '../../hooks/usePreferences'
import useMediaQuery from '../../hooks/useMediaQuery'
import useChartLayouts from '../../hooks/useChartLayouts'
import { useAuth } from '../../context/AuthContext'
import UIcon from '../../components/ui/UIcon'
import { WorkspaceContext } from './WorkspaceContext'
import { WATCHLIST_DEFAULTS, mergeWatchlistSettings } from '../watchlist/watchlistSettings'
import { THEME_TRACKER_DEFAULTS, mergeThemeTrackerSettings } from '../theme-tracker/themeTrackerSettings'
import { FUNDAMENTALS_DEFAULTS, mergeFundamentalsSettings } from './widgets/fundamentalsSettings'
import { BREADTH_WIDGET_DEFAULTS, mergeBreadthWidgetSettings } from './widgets/breadthWidgetSettings'
import { mergeChartSettings } from '../../components/chart/chartDefaults'
import { dividerFor, chromeFor, panelFor, toolbarFor } from '../../utils/dividerColor'
import { widgetOwnChrome } from './widgetChrome'
import MergedSeamOverlay from './MergedSeamOverlay'
import WidgetHost from './WidgetHost'
import MobileWorkspace from './widgets/MobileWorkspace'
import { findPlacement } from './findOpenSlot'
import MultiChartGrid from './grid/MultiChartGrid'
import MultiChartMenu from './grid/MultiChartMenu'
import useMultiChartState from './grid/useMultiChartState'
import PopoutWindow from './popout/PopoutWindow'
import PopoutShell from './popout/PopoutShell'
import PoppedLayout from './popout/PoppedLayout'
import styles from './ChartsWorkspace.module.css'

const ResponsiveGridLayout = WidthProvider(Responsive)


// 24-col grid (doubled from the original 12) so widgets can size in half-of-the-
// old-column steps — e.g. the Theme widget now has a width between the old "1 col
// (too thin)" and "2 cols". Every breakpoint is doubled in lockstep so relative
// sizing is unchanged; legacy 12-col saved layouts are migrated in parseLayout().
const GRID_COLS = 24
// EVERY breakpoint uses the SAME column count on purpose — do not re-introduce a
// narrowing ladder (md:20, sm:12, …). We persist ONE arrangement (layout.widgets),
// so a breakpoint whose col count differs made RGL re-map x/w to fit the narrower
// grid, fire onLayoutChange with those squeezed coords, and handleLayoutChange
// persisted them over the only layout we keep — permanently destroying it. Widening
// the window back could never restore it (the original x/w were gone), which is why
// widgets stayed bunched in the left of a maximized window after a shrink.
// With cols constant, a resize only changes colWidth (containerWidth / 24), so widgets
// scale proportionally and land back exactly where they were. This mirrors how
// rowHeight already scales vertically via the ResizeObserver below.
const COLS = { lg: GRID_COLS, md: GRID_COLS, sm: GRID_COLS, xs: GRID_COLS, xxs: GRID_COLS }
const BREAKPOINTS = { lg: 1200, md: 996, sm: 768, xs: 480, xxs: 0 }
const FIXED_ROWS = 20            // workspace is viewport-locked to this many rows
const MARGIN_Y = 6                // px gap between widgets vertically
const BODY_PAD = 6                // px padding around the grid (matches .workspaceBody)

// New users (and Reset) land on an EMPTY workspace + the "get started" panel.
// Their most recent arrangement is persisted and restored on every later visit.
const DEFAULT_LAYOUT = {
  widgets: [],
  cols: GRID_COLS,
}

// The classic watchlist + chart + themes arrangement, offered as a one-click
// "Starter layout" on the get-started panel.
const STARTER_LAYOUT = {
  widgets: [
    { id: 'w-watchlist', type: 'watchlist', color: 'A', x: 0, y: 0, w: 4,  h: 7,  opts: {} },
    { id: 'w-chart',     type: 'chart',     color: 'A', x: 4, y: 0, w: 20, h: 20, opts: { tf: 'D' } },
    { id: 'w-themes',    type: 'themes',    color: 'B', x: 0, y: 7, w: 4,  h: 13, opts: {} },
  ],
  cols: GRID_COLS,
}

// ── LOCKED "UCT Default" template ──────────────────────────────────────────
// The canonical starting workspace, FROZEN in code. Clicking "UCT Default" under
// Open Layout loads these constants into the working board; applying never writes
// back to them, so nothing a user does in the app can mutate the default — only a
// code edit here can. To officially update the default, re-capture the owner's
// live layout + chart_settings and replace the two constants below.
//
// Option A (owner decision 2026-07-19): the layout SHELL (widget positions/sizes/
// types) + ALL chart settings are baked in; tickers/theme CONTENT load live/
// personal each time (color groups are left untouched on apply).
const UCT_DEFAULT_LAYOUT = {
  widgets: [
    { id: 'uctd-themes',       type: 'themes',       color: 'A', x: 0,  y: 0,  w: 3,  h: 20, opts: {} },
    { id: 'uctd-chart',        type: 'chart',        color: 'A', x: 3,  y: 0,  w: 17, h: 17, opts: {} },
    { id: 'uctd-fundamentals', type: 'fundamentals', color: 'A', x: 3,  y: 17, w: 17, h: 3,  opts: {} },
    { id: 'uctd-watchlist',    type: 'watchlist',    color: 'A', x: 20, y: 0,  w: 4,  h: 11, opts: {} },
    { id: 'uctd-aisearch',     type: 'aisearch',     color: 'A', x: 20, y: 11, w: 4,  h: 9,  opts: {} },
  ],
  cols: GRID_COLS,
}

// The exact chart_settings that are PART of the frozen default (captured from the
// owner's live workspace). JSON.parse keeps it byte-faithful; it's the full blob
// so applying it fully defines the chart look (header shows ticker + company via
// titleMode 'both'). Parsed fresh so the frozen source is never mutated in place.
const UCT_DEFAULT_CHART_SETTINGS_JSON = '{"chartType":"candles","candles":{"upColor":"#1ae51a","downColor":"#c41f2d","upBorder":"#1ae51a","downBorder":"#c41f2d","upWick":"#1ae51a","downWick":"#c41f2d","oneColor":"#1ae51a"},"candleColorMode":"netchange","background":"#0f0f0f","bgMode":"solid","bgGradient":{"top":"#001e5a","bottom":"#ffffff"},"textColor":"#cfcfcf","textSize":11,"grid":{"color":"#ffffff08","visible":true},"crosshair":{"color":"#9a9a9a","style":1,"width":1,"magnet":false},"header":{"titleMode":"both","showChange":true,"timeframes":["5","15","30","D","W","1","M","60"],"customTimeframes":[],"showMarketCap":true,"showNextEarnings":true,"showUctRating":true,"showLegend":true,"colors":{"dayChange":"#1ae51a","legend":"#cfcfcf","dayChangeUp":"#1ae51a","dayChangeDown":"#c41f2d","marketCap":"#c9a84c","nextEarnings":"#6dc9c0","uctRating":"#1ae51a"}},"overlays":[{"enabled":true,"type":"EMA","period":9,"color":"#4ade80"},{"enabled":true,"type":"EMA","period":20,"color":"#f472b6"},{"enabled":true,"type":"SMA","period":50,"color":"#60a5fa"},{"enabled":true,"type":"SMA","period":200,"color":"#fb923c"}],"volume":{"visible":true,"upColor":"#1ae51a","downColor":"#c41f2d","hvcEnabled":true,"separatePane":false,"paneHeightPct":22},"watermark":{"visible":true,"opacity":0.5176470588235295,"color":"#ffffff","sizeScale":1,"lines":{"ticker":true,"company":true,"sector":true,"industry":true,"theme":true},"x":0.5,"y":0.5},"drawingDefaults":{"color":"#c9a84c","width":1},"indicators":{"rsi":{"enabled":false,"period":14,"color":"#7b68ee"},"macd":{"enabled":false,"fastPeriod":12,"slowPeriod":26,"signalPeriod":9,"macdColor":"#2196F3","signalColor":"#FF9800"},"bb":{"enabled":false,"period":20,"stdDev":2,"color":"rgba(156,39,176,0.85)"},"vwap":{"enabled":false,"color":"#26C6DA"},"stoch":{"enabled":false,"kPeriod":14,"dPeriod":3,"kColor":"#FF6B6B","dColor":"#4ECDC4"},"atr":{"enabled":false,"period":14,"color":"#FFA726"},"sar":{"enabled":false,"step":0.02,"maxStep":0.2,"color":"#ffeb3b"},"ichimoku":{"enabled":false,"tenkanColor":"#26C6DA","kijunColor":"#EF5350","spanAColor":"rgba(76,175,80,0.2)","spanBColor":"rgba(239,83,80,0.2)","chikouColor":"rgba(255,235,59,0.7)"},"volumeProfile":{"enabled":false,"bins":24,"color":"rgba(120,160,100,0.25)","pocColor":"rgba(200,160,40,0.65)"},"mfi":{"enabled":false,"period":14,"color":"#c084fc"},"cci":{"enabled":false,"period":20,"color":"#fbbf24"},"williamsR":{"enabled":false,"period":14,"color":"#60a5fa"},"adx":{"enabled":false,"period":14,"adxColor":"#e5e7eb","plusDIColor":"#22c55e","minusDIColor":"#ef4444"},"obv":{"enabled":false,"color":"#9ca3af"},"donchian":{"enabled":false,"period":20,"color":"rgba(96,165,250,0.5)"}},"swingLabels":{"enabled":true,"sensitivity":"low","color":"#000000","tintByType":true,"upColor":"#cfcfcf","downColor":"#cfcfcf","bgEnabled":false,"bg":"#ffffff"},"heikinAshi":false,"logScale":false,"percentScale":false,"comparisonSymbols":[],"markers":{"earnings":true,"splits":false,"dividends":false,"news":false,"earningsBeat":"#1ae51a","earningsMiss":"#c41f2d"},"countdown":false,"showPatterns":false,"hideDrawings":false,"extendedHoursShading":false,"volumeOverlayIndicators":[],"theme":"dark","positionCalc":{"accountSize":50000,"riskPct":1},"preset":"custom"}'

// Widths/minW are in 24-col units (2 units = one old column). themes minW is 2
// so the widget can still go narrow, but the reachable middle size (3 units = 1.5
// old cols) is the "in between" the too-thin and the good size.
const WIDGET_DEFAULTS = {
  chart:     { w: 12, h: 12, minW: 6, minH: 6 },
  watchlist: { w: 6,  h: 10, minW: 2, minH: 4 },
  themes:    { w: 6,  h: 10, minW: 2, minH: 4 },
  scanner:   { w: 8,  h: 10, minW: 6, minH: 4 },
  fundamentals: { w: 8, h: 6, minW: 6, minH: 2 },
  breadth:   { w: 8,  h: 10, minW: 4, minH: 4 },
  aisearch:  { w: 7,  h: 10, minW: 3, minH: 3 },
}

// A blocked window.open returns null with no error, so this is the only way the
// user learns why their board didn't appear on the other monitor.
const POPUP_BLOCKED_MSG = 'Your browser blocked the pop-out window. Allow pop-ups for this site, then try again.'

const WIDGET_TYPES = ['chart', 'watchlist', 'themes', 'scanner', 'fundamentals', 'breadth', 'aisearch']
const WIDGET_LABELS = {
  chart: 'Chart',
  watchlist: 'Watchlist',
  themes: 'Theme Tracker',
  scanner: 'Scanner',
  fundamentals: 'Fundamentals',
  breadth: 'Breadth',
  aisearch: 'AI Search',
}

function parseLayout(raw) {
  if (!raw) return null
  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw
    if (parsed?.widgets && Array.isArray(parsed.widgets)) {
      // Migrate legacy 12-col layouts to the 24-col grid. Detected by the
      // absence of the cols:GRID_COLS marker (old saves have cols:12 or none).
      // Double x AND w so every widget keeps its exact on-screen position + size,
      // then stamp the new marker so this runs exactly once per user.
      let widgets = parsed.widgets
      let cols = parsed.cols
      if (cols !== GRID_COLS) {
        widgets = widgets.map(w => ({
          ...w,
          x: (w.x || 0) * 2,
          w: Math.max(2, (w.w || 2) * 2),
        }))
        cols = GRID_COLS
      }
      // Auto-fit legacy layouts (h values < ~5) saved before the viewport-lock
      // change so they don't appear tiny on resume. Detect by checking if max
      // y+h is well below FIXED_ROWS — scale all h values up uniformly.
      const maxBottom = widgets.reduce((m, w) => Math.max(m, (w.y || 0) + (w.h || 0)), 0)
      if (maxBottom > 0 && maxBottom <= FIXED_ROWS / 2) {
        const scale = Math.floor(FIXED_ROWS / maxBottom)
        if (scale > 1) {
          widgets = widgets.map(w => ({
            ...w,
            y: (w.y || 0) * scale,
            h: Math.max(4, (w.h || 4) * scale),
          }))
        }
      }
      return { ...parsed, widgets: clampWidgetsToRows(widgets), cols }
    }
  } catch {}
  return null
}

// Keep every widget within the viewport-locked grid: no widget's bottom (y+h)
// may exceed FIXED_ROWS, or it hangs off the bottom of the screen (the body is
// overflow:hidden, so the overhang just vanishes — the fundamentals-widget bug).
// Shrink h to fit the space below y; y is first clamped so at least minH fits.
// Applied on load, add, template-open, and every layout change before persist.
function clampWidgetsToRows(widgets) {
  return widgets.map(w => {
    const minH = WIDGET_DEFAULTS[w.type]?.minH || 3
    const y = Math.max(0, Math.min(w.y || 0, FIXED_ROWS - minH))
    let h = Math.max(minH, Math.min(w.h || minH, FIXED_ROWS))
    if (y + h > FIXED_ROWS) h = FIXED_ROWS - y  // y ≤ FIXED_ROWS-minH ⇒ h ≥ minH
    return { ...w, y, h }
  })
}

// The watchlist column config (added columns / widths / order) lives in
// localStorage (WL_COLS_LS in Watchlists.jsx), not a pref — read it for
// template capture. null when unset/unreadable (JSON drops the key).
function readWatchlistColumns() {
  try {
    const v = JSON.parse(localStorage.getItem('uct.watchlist.cols'))
    return (v && typeof v === 'object') ? v : null
  } catch { return null }
}

function nextColor(currentColors) {
  // Cycle A→B→C→D→A based on what's already in use.
  const order = ['A', 'B', 'C', 'D']
  for (const c of order) {
    if (!currentColors.includes(c)) return c
  }
  return 'A'
}

// Color to assign a NEWLY added widget. Prefer the group of an existing chart
// that already has a symbol (so the new widget lands on the ticker you're
// looking at — not an empty group showing a blank Fundamentals panel or a chart
// stuck on the SPY fallback). Fall back to the first populated group, then to
// the next free color for a genuinely empty board.
function pickWidgetColor(widgets, groupSyms) {
  const g = groupSyms || {}
  const chartW = widgets.find((w) => w.type === 'chart' && g[w.color])
  if (chartW) return chartW.color
  const anyW = widgets.find((w) => g[w.color])
  if (anyW) return anyW.color
  return nextColor(widgets.map((w) => w.color))
}

// Inline "Delete?" confirm shown in place of a layout's ✕ so an accidental click
// can't wipe a saved layout. Yes deletes; Go back cancels.
function DeleteConfirm({ onYes, onCancel }) {
  return (
    <span className={styles.delConfirm} role="group" aria-label="Confirm delete layout">
      <span className={styles.delConfirmMsg}>Delete?</span>
      <button type="button" className={styles.delConfirmYes} onClick={onYes}>Yes</button>
      <button type="button" className={styles.delConfirmNo} onClick={onCancel}>Go back</button>
    </span>
  )
}

export default function ChartsWorkspace() {
  const isMobile = useMediaQuery('(max-width: 640px)')
  const { prefs, setPref, loading: prefsLoading } = usePreferences()

  // "Merge widgets": lock the board in place (no move / resize / delete / color
  // edits), drop every widget border + header bar, and tighten the inter-widget gap
  // to a thin 1px seam so the widgets blend together TC2000-style. Persisted so the
  // merged view survives reloads until the user unmerges.
  const merged = parsePref(prefs?.charts_merged, false) === true
  // Merged: zero gap so adjacent widget borders TOUCH into one continuous thin grey
  // line (no dark seam showing between them).
  const gridGap = merged ? 0 : MARGIN_Y
  const toggleMerged = useCallback(() => setPref('charts_merged', JSON.stringify(!merged)), [merged, setPref])

  // Viewport-locked sizing: measure the workspace body and divide its height
  // by FIXED_ROWS so the grid always fills the visible area exactly. The page
  // itself never scrolls — widget max size = visible chart area.
  const bodyRef = useRef(null)
  const [rowHeight, setRowHeight] = useState(34)
  // Grid content width (px) — needed to convert a merged-mode seam-drag from
  // pixels to whole grid columns. Merged has no body padding, so the grid inner
  // width IS the body width; unmerged we still track it (harmless, unused there).
  const [gridWidth, setGridWidth] = useState(0)

  // The viewport-lock row-height math, extracted so a popped-out board can run
  // it against ITS OWN window. Sharing the main tab's rowHeight would size a
  // board on a second monitor to the main window's height — the 20 rows would
  // either overflow it or leave dead space.
  const computeRowHeight = useCallback((clientHeight) => {
    // Merged view removes the body padding (below) so the blended surface fills
    // to the outer edge — the row-height math must drop it too, or the grid
    // overflows/clips by the padding it no longer has.
    const bodyPad = merged ? 0 : BODY_PAD
    const available = (clientHeight - bodyPad * 2) - gridGap * (FIXED_ROWS - 1)
    // 20 rows rarely tile an arbitrary pixel height evenly. Unmerged we floor
    // (the leftover hides in the dark margins). MERGED there are no margins, so
    // flooring left a dead black strip at the bottom — round UP so the grid
    // fills to the edge; the ≤(FIXED_ROWS-1)px excess is absorbed by the body's
    // overflow:hidden (no scrollbar — the viewport-lock still holds).
    return merged
      ? Math.max(12, Math.ceil(available / FIXED_ROWS))
      : Math.max(12, Math.floor(available / FIXED_ROWS))
  }, [gridGap, merged])

  useEffect(() => {
    const el = bodyRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const measure = () => {
      const bodyPad = merged ? 0 : BODY_PAD
      setRowHeight(computeRowHeight(el.clientHeight))
      setGridWidth(el.clientWidth - bodyPad * 2)
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [computeRowHeight, merged])

  // Layout state — seed from prefs or default.
  const [layout, setLayout] = useState(() => parseLayout(prefs?.charts_workspace_layout) || DEFAULT_LAYOUT)
  const layoutRef = useRef(layout)
  layoutRef.current = layout

  // If prefs arrive AFTER initial render (async fetch), pick them up.
  const loadedFromPrefsRef = useRef(false)
  useEffect(() => {
    if (loadedFromPrefsRef.current) return
    const parsed = parseLayout(prefs?.charts_workspace_layout)
    if (parsed) {
      setLayout(parsed)
      loadedFromPrefsRef.current = true
    }
  }, [prefs?.charts_workspace_layout])

  // Hydration gate: don't persist until server prefs have settled, so RGL's
  // on-mount onLayoutChange can't clobber a returning user's saved layout with the
  // default before it loads (the "resets to default" bug).
  const hydratedRef = useRef(false)
  useEffect(() => {
    if (!prefsLoading) hydratedRef.current = true
  }, [prefsLoading])

  // Color-group state — seed from prefs or empty.
  const [groupSyms, setGroupSymsState] = useState(() => {
    try {
      const raw = prefs?.charts_workspace_groups
      if (raw) {
        const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw
        if (parsed && typeof parsed === 'object') {
          return { A: null, B: null, C: null, D: null, ...parsed }
        }
      }
    } catch {}
    return { A: null, B: null, C: null, D: null }
  })

  // The linked ticker updates INSTANTLY (state), but persisting it is debounced —
  // otherwise fast arrow-scanning fires a POST /api/auth/preferences per keypress
  // (+ an optimistic SWR mutate that re-renders every prefs consumer). 400ms trailing.
  const groupsSaveTimerRef = useRef(null)
  const setGroupSym = useCallback((color, sym) => {
    setGroupSymsState(prev => {
      const next = { ...prev, [color]: sym }
      if (groupsSaveTimerRef.current) clearTimeout(groupsSaveTimerRef.current)
      groupsSaveTimerRef.current = setTimeout(() => {
        setPref('charts_workspace_groups', JSON.stringify(next))
      }, 400)
      return next
    })
  }, [setPref])

  // Crosshair sync bus: a stable pub/sub so a hovered chart can broadcast its
  // crosshair to same-color-group siblings WITHOUT re-rendering the grid at
  // mouse-move rate (only the receiving widgets re-render via local state).
  const crosshairBusRef = useRef(null)
  if (!crosshairBusRef.current) {
    const listeners = new Set()
    crosshairBusRef.current = {
      emit: (color, sourceId, payload) => listeners.forEach((fn) => fn({ color, sourceId, payload })),
      subscribe: (fn) => { listeners.add(fn); return () => listeners.delete(fn) },
    }
  }

  // Active chart widget (hotkey dedupe): the last-hovered ChartWidget's id.
  // Ref (not state) so hover crossings never re-render anything; each widget's
  // StockChart reads it through a hotkeysActive callback at keydown time.
  const activeChartRef = useRef(null)
  // Same idea for watchlists: the last hovered/focused Watchlist widget owns the
  // arrow keys + its own scroll-into-view, so 4 watchlists don't all fight over one
  // keypress (first-mounted-wins race) or all force a reflow on every selection.
  const activeWatchlistRef = useRef(null)

  // AI-search bus: a chart's "AI search" context action routes a query to any
  // mounted AI Search widget; request() returns false when none exist so the
  // caller can fall back to a temporary popup.
  const aiSearchBusRef = useRef(null)
  if (!aiSearchBusRef.current) {
    const subs = new Set()
    aiSearchBusRef.current = {
      subscribe: (fn) => { subs.add(fn); return () => subs.delete(fn) },
      request: (query) => { if (subs.size === 0) return false; subs.forEach((fn) => fn(query)); return true },
    }
  }

  // Workspace-wide chart theme ('default' | 'sunrise'), persisted like the layout.
  const chartsTheme = prefs.charts_theme || 'default'
  const setChartsTheme = useCallback((t) => setPref('charts_theme', t), [setPref])

  // Each widget's chrome (panel + border, header row, and its own top rows) paints
  // the canvas color of THAT widget's settings, published to the widget subtree as
  // --widget-canvas by WidgetHost. Keyed by widget type — a type absent here gets no
  // variable and keeps the default tokens (AI Search / Scanner have no canvas setting
  // of their own yet). (This was briefly set on the WORKSPACE root, which cascaded the
  // chart's color into every widget — do NOT hoist it back up.)
  // Resolution mirrors each surface's own: a gradient contributes its TOP stop, since
  // that's the edge the header actually meets; otherwise the solid color.
  const widgetCanvasByType = useMemo(() => {
    const cs = mergeChartSettings(prefs.chart_settings)
    const chart = chartsTheme === 'sunrise'
      ? '#eaf1fa'
      : (cs.bgMode === 'gradient' ? (cs.bgGradient?.top || cs.background) : cs.background)
    const wl = mergeWatchlistSettings(parsePref(prefs.watchlist_settings, null))
    const watchlist = wl.bgMode === 'gradient' ? (wl.bgGradient?.top || wl.bg) : wl.bg
    const tt = mergeThemeTrackerSettings(parsePref(prefs.theme_tracker_settings, null))
    const themes = tt.bgMode === 'gradient' ? (tt.bgGradient?.top || tt.bg) : tt.bg
    const fw = mergeFundamentalsSettings(parsePref(prefs.fundamentals_settings, null))
    const fundamentals = fw.bgMode === 'gradient' ? (fw.bgGradient?.top || fw.bg) : fw.bg
    const bw = mergeBreadthWidgetSettings(parsePref(prefs.breadth_widget_settings, null))
    const breadth = bw.bgMode === 'gradient' ? (bw.bgGradient?.top || bw.bg) : bw.bg
    // Theme Tracker / Fundamentals / Breadth publish ONLY when the user actually
    // customized their canvas (their settings model is emit-when-off-default): the
    // drag bar + panel then follow the chosen canvas, while an untouched widget
    // keeps the default chrome tokens byte-identical.
    const ttCustom = tt.bgMode === 'gradient' || String(tt.bg).toLowerCase() !== THEME_TRACKER_DEFAULTS.bg
    const fwCustom = fw.bgMode === 'gradient' || String(fw.bg).toLowerCase() !== FUNDAMENTALS_DEFAULTS.bg
    const bwCustom = bw.bgMode === 'gradient' || String(bw.bg).toLowerCase() !== BREADTH_WIDGET_DEFAULTS.bg
    const entry = (canvas) => ({
      canvas, divider: dividerFor(canvas), dividerStrong: dividerFor(canvas, { strong: true }),
      chrome: chromeFor(canvas), panel: panelFor(canvas), rowHover: toolbarFor(canvas)?.bg,
    })
    // The watchlist's explicit gridline color (Watchlist Settings → Gridlines)
    // must override the canvas-derived divider HERE too — inside the workspace
    // the widget CSS reads --widget-divider* before --wl-divider* (keep in sync
    // with watchlistStyleVars' identical override).
    const watchlistEntry = entry(watchlist)
    if (wl.gridColor) {
      watchlistEntry.divider = wl.gridColor
      watchlistEntry.dividerStrong = wl.gridColor
    }
    return {
      chart: entry(chart),
      watchlist: watchlistEntry,
      ...(ttCustom ? { themes: entry(themes) } : {}),
      ...(fwCustom ? { fundamentals: entry(fundamentals) } : {}),
      ...(bwCustom ? { breadth: entry(breadth) } : {}),
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chartsTheme, prefs.chart_settings, prefs.watchlist_settings, prefs.theme_tracker_settings, prefs.fundamentals_settings, prefs.breadth_widget_settings])

  // Per-WIDGET chrome canvas (keyed by widget id). Every chart/watchlist widget
  // now owns its settings, so its border/header/dividers must follow ITS canvas,
  // not the one-per-type global. Only diverged widgets get an entry; the rest
  // fall back to widgetCanvasByType (the global default) in WidgetHost. This is
  // what makes "changing one widget's canvas never touches another" true for the
  // chrome, matching the isolated list/chart surfaces.
  const widgetCanvasById = useMemo(() => {
    const out = {}
    for (const w of layout.widgets || []) {
      const entry = widgetOwnChrome(w, chartsTheme)
      if (entry) out[w.id] = entry
    }
    return out
  }, [layout.widgets, chartsTheme])

  const workspaceValue = useMemo(
    () => ({ groupSyms, setGroupSym, chartsTheme, widgetCanvasByType, widgetCanvasById, crosshairBus: crosshairBusRef.current, aiSearchBus: aiSearchBusRef.current, activeChartRef, activeWatchlistRef }),
    [groupSyms, setGroupSym, chartsTheme, widgetCanvasByType, widgetCanvasById],
  )

  // Debounced layout persist (500ms).
  const saveTimerRef = useRef(null)
  const scheduleSave = useCallback((nextLayout) => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    saveTimerRef.current = setTimeout(() => {
      setPref('charts_workspace_layout', JSON.stringify(nextLayout))
    }, 500)
  }, [setPref])

  // Flush any pending debounced save when leaving the page (SPA nav / unmount) so
  // the last arrangement is always what loads next time — no dependence on the
  // 500ms window having elapsed before the user navigates away.
  useEffect(() => {
    return () => {
      if (saveTimerRef.current && hydratedRef.current) {
        clearTimeout(saveTimerRef.current)
        saveTimerRef.current = null
        setPref('charts_workspace_layout', JSON.stringify(layoutRef.current))
      }
    }
  }, [setPref])

  // react-grid-layout fires onLayoutChange with the new x/y/w/h array.
  // Merge it back into our widget objects.
  const handleLayoutChange = useCallback((newGridLayout) => {
    setLayout(prev => {
      const byId = Object.fromEntries(newGridLayout.map(l => [l.i, l]))
      const widgets = prev.widgets.map(w => {
        const l = byId[w.id]
        if (!l) return w
        return { ...w, x: l.x, y: l.y, w: l.w, h: l.h }
      })
      const next = { ...prev, widgets: clampWidgetsToRows(widgets) }
      // Don't persist until prefs have hydrated — RGL fires onLayoutChange on
      // mount with the (empty) default, which would otherwise clobber a returning
      // user's saved layout before it loads.
      if (hydratedRef.current) scheduleSave(next)
      return next
    })
  }, [scheduleSave])

  const handleRemoveWidget = useCallback((id) => {
    setLayout(prev => {
      const next = { ...prev, widgets: prev.widgets.filter(w => w.id !== id) }
      scheduleSave(next)
      return next
    })
  }, [scheduleSave])

  // Merged-mode seam drag: MergedSeamOverlay hands back the whole widgets array
  // with the two sides of the dragged seam resized. Preview on every move
  // (commit=false → no persist thrash); persist once on release (commit=true).
  const minWFor = useCallback((w) => WIDGET_DEFAULTS[w.type]?.minW || 2, [])
  const minHFor = useCallback((w) => WIDGET_DEFAULTS[w.type]?.minH || 3, [])
  const handleSeamResize = useCallback((nextWidgets, commit) => {
    setLayout(prev => {
      const next = { ...prev, widgets: clampWidgetsToRows(nextWidgets) }
      if (commit) scheduleSave(next)
      return next
    })
  }, [scheduleSave])

  const handleColorChange = useCallback((id, color) => {
    setLayout(prev => {
      const next = { ...prev, widgets: prev.widgets.map(w => w.id === id ? { ...w, color } : w) }
      scheduleSave(next)
      return next
    })
  }, [scheduleSave])

  const handleOptsChange = useCallback((id, opts) => {
    setLayout(prev => {
      const next = { ...prev, widgets: prev.widgets.map(w => w.id === id ? { ...w, opts } : w) }
      scheduleSave(next)
      return next
    })
  }, [scheduleSave])

  const handleAddWidget = useCallback((type) => {
    setLayout(prev => {
      const color = pickWidgetColor(prev.widgets, groupSyms)
      const defaults = WIDGET_DEFAULTS[type]
      // Place into the first logical open spot (row-major scan), not column 0:
      // RGL vertical compaction preserves x, so a hardcoded x:0 stacks new
      // widgets below the left column and overflows. findPlacement shrinks the
      // widget toward its min size to squeeze into a smaller gap rather than
      // falling off-screen; it bottom-packs only when the grid is genuinely full.
      const { x, y, w, h } = findPlacement(prev.widgets, defaults, COLS.lg, FIXED_ROWS)
      const newWidget = {
        id: `w-${type}-${Date.now()}`,
        type, color,
        x, y, w, h,
        opts: {},
      }
      const next = { ...prev, widgets: clampWidgetsToRows([...prev.widgets, newWidget]) }
      scheduleSave(next)
      return next
    })
  }, [scheduleSave, groupSyms])

  const [savedFlash, setSavedFlash] = useState(false)
  const savedFlashTimerRef = useRef(null)
  const flashSaved = useCallback(() => {
    setSavedFlash(true)
    if (savedFlashTimerRef.current) clearTimeout(savedFlashTimerRef.current)
    savedFlashTimerRef.current = setTimeout(() => setSavedFlash(false), 1600)
  }, [])

  // ── Named layout templates (prebuilt + personal) ──
  const { user } = useAuth()
  const isAdmin = user?.role === 'admin'
  const { global: globalLayouts, mine: myLayouts, saveLayout, deleteLayout, isLoading: templatesLoading } = useChartLayouts()
  const [openMenuOpen, setOpenMenuOpen] = useState(false)
  const [saveMenuOpen, setSaveMenuOpen] = useState(false)
  // Which template's ✕ is awaiting delete confirmation (id), or null.
  const [confirmDeleteId, setConfirmDeleteId] = useState(null)
  const [saveAsName, setSaveAsName] = useState('')
  const [saveAsScope, setSaveAsScope] = useState('user')  // 'user' | 'global' (admin)
  const [saveErr, setSaveErr] = useState('')

  // Apply a saved/prebuilt layout: restore the arrangement (+ its color-group
  // tickers) and persist so it sticks across refreshes. Runs through parseLayout
  // so any older-shaped template is normalized to the current grid.
  const applyTemplate = useCallback((tpl) => {
    if (!tpl?.layout?.widgets) return
    // PREBUILT (global-scope) templates are LOCKED: opening one must reset EVERY
    // per-user override so nothing from the previously-open layout — theme, chart
    // styling, watchlist columns, volume-pane height — carries over. Personal
    // templates keep the current styling (they don't force a reset).
    const isPrebuilt = (tpl.scope || 'user') === 'global'
    // Switch the ARRANGEMENT only — keep whatever tickers are currently loaded in
    // each color group. A template must not swap the stock you're looking at.
    // parseLayout keeps extra fields (`...parsed`), so pull chartSettings OUT of
    // the board layout — it belongs in the chart_settings pref, not the
    // charts_workspace_layout arrangement blob.
    const { chartSettings, watchlistSettings, themeTrackerSettings, fundamentalsSettings, breadthSettings, watchlistColumns, ...boardLayout } = parseLayout(tpl.layout) || tpl.layout
    setLayout(boardLayout)
    setPref('charts_workspace_layout', JSON.stringify(boardLayout))
    // Restore the template's WIDGET appearance blobs (or defaults for a prebuilt/older
    // template that carries none) so a locked/prebuilt template never inherits the
    // user's personal widget styling. Watchlist / Theme Tracker / Fundamentals all
    // follow the same rule.
    setPref('watchlist_settings', JSON.stringify(watchlistSettings || WATCHLIST_DEFAULTS))
    setPref('theme_tracker_settings', JSON.stringify(themeTrackerSettings || THEME_TRACKER_DEFAULTS))
    setPref('fundamentals_settings', JSON.stringify(fundamentalsSettings || FUNDAMENTALS_DEFAULTS))
    setPref('breadth_widget_settings', JSON.stringify(breadthSettings || BREADTH_WIDGET_DEFAULTS))
    // Watchlist COLUMN config (added columns / widths / order — localStorage, not a
    // pref) rides the template too: owner-reported bug — added columns vanished after
    // switching layouts and back, because Save captured them nowhere and opening a
    // prebuilt wiped the localStorage key. Widgets remount on layout switch (new
    // widget ids), so they re-read this key on mount.
    try {
      if (watchlistColumns && typeof watchlistColumns === 'object') {
        localStorage.setItem('uct.watchlist.cols', JSON.stringify(watchlistColumns))
      } else if (isPrebuilt) {
        localStorage.removeItem('uct.watchlist.cols')
      }
    } catch { /* ignore */ }
    // Restore the chart settings the template was saved with, if it has them. A
    // PREBUILT template that carries none resets to the frozen default (never inherit
    // the previous layout's chart styling); a personal arrangement-only template
    // leaves the current settings untouched.
    if (chartSettings) {
      setPref('chart_settings', chartSettings)
    } else if (isPrebuilt) {
      setPref('chart_settings', UCT_DEFAULT_CHART_SETTINGS_JSON)
    }
    if (isPrebuilt) {
      // Wipe the standalone per-user overrides so a prebuilt layout always opens
      // clean: theme (e.g. TSDR Sunset), volume-pane height. (Watchlist columns
      // are handled by the watchlistColumns conditional above — restore when the
      // template carries them, wipe when a prebuilt carries none.)
      setChartsTheme('default')
      setPref('charts_vol_pane_pct', '')
    }
    // Remember which named template is now open, so "Save current arrangement"
    // can update THIS template in place with later edits. Persisted so the link
    // survives a refresh.
    setPref('charts_active_template', JSON.stringify({ id: tpl.id, name: tpl.name, scope: tpl.scope || 'user' }))
    setOpenMenuOpen(false)
    flashSaved()
  }, [setPref, setChartsTheme, flashSaved])

  // Apply the LOCKED "UCT Default" template: the frozen layout shell + the frozen
  // chart_settings + the default theme. Everything is loaded FROM the in-code
  // constants and written to the working prefs; the constants are never written
  // back, so this is the immutable restore point — any edits the user made are
  // wiped by re-opening it. Color-group tickers are left as-is (Option A: content
  // loads live/personal, only the shell + settings are frozen).
  const applyUctDefault = useCallback(() => {
    const normalized = parseLayout(UCT_DEFAULT_LAYOUT) || UCT_DEFAULT_LAYOUT
    setLayout(normalized)
    setPref('charts_workspace_layout', JSON.stringify(normalized))
    // Restore the exact chart settings baked into the default (parsed fresh each
    // apply so the frozen constant is never mutated).
    setPref('chart_settings', UCT_DEFAULT_CHART_SETTINGS_JSON)
    // Watchlist / Theme Tracker / Fundamentals appearance are part of the frozen
    // default too → reset them, so no personal widget styling leaks onto the
    // locked UCT Default.
    setPref('watchlist_settings', JSON.stringify(WATCHLIST_DEFAULTS))
    setPref('theme_tracker_settings', JSON.stringify(THEME_TRACKER_DEFAULTS))
    setPref('fundamentals_settings', JSON.stringify(FUNDAMENTALS_DEFAULTS))
    setPref('breadth_widget_settings', JSON.stringify(BREADTH_WIDGET_DEFAULTS))
    setChartsTheme('default')
    try { localStorage.removeItem('uct.watchlist.cols') } catch { /* ignore */ }  // reset columns too (mirrors WL_COLS_LS)
    // Volume-pane height is a SEPARATE global per-user override (charts_vol_pane_pct)
    // that otherwise survives — reset it so a dragged pane snaps back to the default.
    setPref('charts_vol_pane_pct', '')
    // UCT Default is the frozen default, not a saved template → no active template.
    setPref('charts_active_template', 'null')
    setOpenMenuOpen(false)
    flashSaved()
  }, [setPref, setChartsTheme, flashSaved])

  // The "default" layout (new users / no saved layout) = the frozen UCT Default
  // arrangement. (A DB "chart" prebuilt template, if one is ever added, still wins.)
  const resolveDefaultLayout = useCallback(() => {
    const byName = (arr) => arr.find(t => (t.name || '').trim().toLowerCase() === 'chart')
    const tpl = byName(globalLayouts) || byName(myLayouts)
    if (tpl?.layout?.widgets?.length) {
      return { layout: parseLayout(tpl.layout) || tpl.layout, groups: tpl.groups || null }
    }
    return { layout: parseLayout(UCT_DEFAULT_LAYOUT) || UCT_DEFAULT_LAYOUT, groups: null }
  }, [globalLayouts, myLayouts])

  // New users (no saved layout) open on the default; returning users keep their
  // most recent layout. Runs once, after prefs + templates settle.
  const appliedDefaultRef = useRef(false)
  useEffect(() => {
    if (appliedDefaultRef.current) return
    if (prefsLoading || templatesLoading) return
    if (parseLayout(prefs?.charts_workspace_layout)) { appliedDefaultRef.current = true; return }
    appliedDefaultRef.current = true
    const d = resolveDefaultLayout()
    setLayout(d.layout)
    if (d.groups) setGroupSymsState({ A: null, B: null, C: null, D: null, ...d.groups })
  }, [prefsLoading, templatesLoading, prefs?.charts_workspace_layout, resolveDefaultLayout])

  // New layout → wipe to a blank workspace (no widgets) so the user can build a
  // fresh board from scratch. Clears the color groups too. Persisted like any edit,
  // so a returning user stays on the blank board until they add a widget or open a
  // saved layout. (Named/saved layouts are untouched — only the working board is.)
  const handleNewLayout = useCallback(() => {
    const blank = { widgets: [], cols: GRID_COLS }
    setLayout(blank)
    setPref('charts_workspace_layout', JSON.stringify(blank))
    const g = { A: null, B: null, C: null, D: null }
    setGroupSymsState(g)
    setPref('charts_workspace_groups', JSON.stringify(g))
    // Reset the shared styling to the UCT DEFAULT so every widget you add to the new
    // board matches the default look instead of inheriting the previous layout's
    // personal styling (chart colors/volume, watchlist appearance + columns, theme).
    // Layout stays blank; a freshly-added watchlist widget mounts and re-reads the
    // reset column config from localStorage.
    setPref('chart_settings', UCT_DEFAULT_CHART_SETTINGS_JSON)
    setPref('watchlist_settings', JSON.stringify(WATCHLIST_DEFAULTS))
    setPref('theme_tracker_settings', JSON.stringify(THEME_TRACKER_DEFAULTS))
    setPref('fundamentals_settings', JSON.stringify(FUNDAMENTALS_DEFAULTS))
    setPref('breadth_widget_settings', JSON.stringify(BREADTH_WIDGET_DEFAULTS))
    setChartsTheme('default')
    try { localStorage.removeItem('uct.watchlist.cols') } catch { /* ignore */ }  // mirrors WL_COLS_LS in Watchlists.jsx
    // Blank board is not a named template.
    setPref('charts_active_template', 'null')
  }, [setPref, setChartsTheme])

  const handleSaveAsTemplate = useCallback(async () => {
    const nm = saveAsName.trim()
    if (!nm) { setSaveErr('Name required'); return }
    try {
      // Templates store the arrangement + the current CHART SETTINGS (so opening
      // one restores the exact chart look you saved) — but NEVER the tickers, so
      // opening a template never swaps the stock you're viewing. chartSettings is
      // nested in the layout blob (backend persists it as layout_json);
      // applyTemplate restores it. The frozen default settings are applied ONLY by
      // "UCT Default".
      const chartSettings = parsePref(prefs?.chart_settings, null)
      const watchlistSettings = parsePref(prefs?.watchlist_settings, null)
      const themeTrackerSettings = parsePref(prefs?.theme_tracker_settings, null)
      const fundamentalsSettings = parsePref(prefs?.fundamentals_settings, null)
      const breadthSettings = parsePref(prefs?.breadth_widget_settings, null)
      const watchlistColumns = readWatchlistColumns()
      const scope = isAdmin ? saveAsScope : 'user'
      const saved = await saveLayout({
        name: nm,
        layout: { ...layout, chartSettings, watchlistSettings, themeTrackerSettings, fundamentalsSettings, breadthSettings, watchlistColumns },
        groups: null,
        scope,
      })
      // The just-saved template becomes the active one, so "Save current
      // arrangement" updates it going forward.
      if (saved?.id != null) {
        setPref('charts_active_template', JSON.stringify({ id: saved.id, name: saved.name || nm, scope: saved.scope || scope }))
      }
      setSaveAsName(''); setSaveErr(''); setSaveMenuOpen(false)
      flashSaved()
    } catch (e) {
      setSaveErr(e.message || 'Save failed')
    }
  }, [saveAsName, layout, prefs?.chart_settings, prefs?.watchlist_settings, prefs?.theme_tracker_settings, prefs?.fundamentals_settings, isAdmin, saveAsScope, saveLayout, setPref, flashSaved])

  // Explicit "Save current arrangement" — flush the debounced auto-save + persist
  // the working board immediately (the auto-save is debounced 500ms, so a refresh
  // within that window could otherwise lose the last change). If a NAMED template
  // is currently open, ALSO update that template in place with the current widgets
  // + chart settings, so reopening it reflects the edits. Only updates a template
  // the user can write (their own, or a global one when admin); a stale/deleted
  // active ref is ignored (just saves the working board).
  const handleSaveLayout = useCallback(async () => {
    if (saveTimerRef.current) { clearTimeout(saveTimerRef.current); saveTimerRef.current = null }
    setPref('charts_workspace_layout', JSON.stringify(layout))
    setPref('charts_workspace_groups', JSON.stringify(groupSyms))
    const active = parsePref(prefs?.charts_active_template, null)
    if (active?.id != null && (active.scope !== 'global' || isAdmin)) {
      const list = active.scope === 'global' ? globalLayouts : myLayouts
      if (list.some(t => t.id === active.id)) {
        const chartSettings = parsePref(prefs?.chart_settings, null)
        const watchlistSettings = parsePref(prefs?.watchlist_settings, null)
        const themeTrackerSettings = parsePref(prefs?.theme_tracker_settings, null)
        const fundamentalsSettings = parsePref(prefs?.fundamentals_settings, null)
        const breadthSettings = parsePref(prefs?.breadth_widget_settings, null)
        const watchlistColumns = readWatchlistColumns()
        try {
          await saveLayout({ name: active.name, layout: { ...layout, chartSettings, watchlistSettings, themeTrackerSettings, fundamentalsSettings, breadthSettings, watchlistColumns }, groups: null, scope: active.scope })
        } catch { /* surfaced by SWR revalidate */ }
      }
    }
    flashSaved()
  }, [layout, groupSyms, setPref, flashSaved, prefs?.charts_active_template, prefs?.chart_settings, prefs?.watchlist_settings, prefs?.theme_tracker_settings, prefs?.fundamentals_settings, isAdmin, globalLayouts, myLayouts, saveLayout])

  const handleDeleteTemplate = useCallback(async (id) => {
    try { await deleteLayout(id) } catch { /* surfaced by SWR revalidate */ }
    // If the layout you just deleted was the one open on screen, fall back to the
    // UCT Default so you're never left staring at a now-gone layout.
    const active = parsePref(prefs?.charts_active_template, null)
    if (active?.id === id) applyUctDefault()
  }, [deleteLayout, prefs?.charts_active_template, applyUctDefault])

  const [addMenuOpen, setAddMenuOpen] = useState(false)

  // ── Pop-out: widgets and whole boards in their own OS windows ──────────────
  // Both kinds are React portals owned by this tab (see PopoutWindow), so every
  // monitor shares this tab's single live-price/bars stream pool.
  const [poppedWidgetIds, setPoppedWidgetIds] = useState([])
  const [poppedLayouts, setPoppedLayouts] = useState([])
  const [popoutNotice, setPopoutNotice] = useState(null)

  // A popped widget stays in layout.widgets — it's only hidden from the grid — so
  // its position survives the trip and it docks straight back where it was.
  const handlePopOutWidget = useCallback((id) => {
    setPoppedWidgetIds(prev => (prev.includes(id) ? prev : [...prev, id]))
  }, [])
  const handleDockWidget = useCallback((id) => {
    setPoppedWidgetIds(prev => prev.filter(x => x !== id))
  }, [])
  // Closing a widget from inside its own window should delete it, not dock it.
  const handleRemovePoppedWidget = useCallback((id) => {
    setPoppedWidgetIds(prev => prev.filter(x => x !== id))
    handleRemoveWidget(id)
  }, [handleRemoveWidget])

  // Deliberately NOT done inside a setLayout updater: React invokes updaters
  // twice under StrictMode, which would queue a second popped board and open a
  // duplicate window.
  const handlePopOutLayout = useCallback(() => {
    const live = layout.widgets.filter(w => !poppedWidgetIds.includes(w.id))
    if (!live.length) return
    setPoppedLayouts(ls => [...ls, { id: `pl-${Date.now()}`, widgets: live }])
    // Main goes back to a blank board so another layout can be built and popped
    // onto the next monitor.
    const next = { ...layout, widgets: layout.widgets.filter(w => poppedWidgetIds.includes(w.id)) }
    setLayout(next)
    scheduleSave(next)
  }, [layout, poppedWidgetIds, scheduleSave])

  const handleDockLayout = useCallback((popId, returning) => {
    setPoppedLayouts(ls => ls.filter(l => l.id !== popId))
    setLayout(prev => {
      // Straight back into an empty board. If a new layout has been built here
      // meanwhile, re-place the returning widgets so they don't land on top of it.
      let widgets
      if (!prev.widgets.length) {
        widgets = returning
      } else {
        widgets = [...prev.widgets]
        for (const w of returning) {
          // minW/minH come from the type defaults, but w/h must be the widget's
          // OWN size — spreading the defaults last would resize every docking
          // widget back to its type's default dimensions.
          const spec = { ...(WIDGET_DEFAULTS[w.type] || {}), w: w.w, h: w.h }
          widgets.push({ ...w, ...findPlacement(widgets, spec, COLS.lg, FIXED_ROWS) })
        }
      }
      const next = { ...prev, widgets: clampWidgetsToRows(widgets) }
      scheduleSave(next)
      return next
    })
  }, [scheduleSave])

  // ── Multi-Chart grid mode (fixed N×M grid of independent chart cells) ──
  const mc = useMultiChartState()
  const [mcMenuOpen, setMcMenuOpen] = useState(false)
  // (Flyout grace-timer machinery removed: Multi Chart is now its own header
  // button with a plain click-toggled dropdown — the hover flyout it guarded
  // no longer exists, which structurally fixes mega-review #10/#16.)
  // ?gridspike=N (admin-only) forces grid mode for the perf harness.
  const gridSpikeRequested = isAdmin && typeof window !== 'undefined'
    && new URLSearchParams(window.location.search).has('gridspike')
  const gridMode = mc.state.mode === 'grid' || gridSpikeRequested
  // Grid-kind templates live in the same /api/charts/layouts store; keep them
  // out of the workspace Open-layout menu (their {widgets:[]} shape would
  // apply as a blank board) — the Multi Charts dropdown lists them instead.
  const wsGlobalLayouts = globalLayouts.filter(t => t.layout?.kind !== 'multichart')
  const wsMyLayouts = myLayouts.filter(t => t.layout?.kind !== 'multichart')

  if (isMobile) {
    // Phone: tabbed widget stack (RGL drag/resize doesn't fit a phone). Rendered
    // inside the provider so widgets keep color-group ticker linking. Grid mode
    // renders as a vertically stacked cell list (its own @media CSS).
    return (
      <WorkspaceContext.Provider value={workspaceValue}>
        {gridMode ? (
          <div className={styles.workspace} data-charts-theme={chartsTheme} style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
            {/* Phone toolbar: grid mode persists from desktop, and without an
                exit control a phone user is TRAPPED in it (mega-review #15 —
                the desktop entry flyout doesn't exist on phone). */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 8px', borderBottom: '1px solid var(--border, #2a3340)', flex: '0 0 auto' }}>
              <span style={{ fontSize: 12, color: 'var(--ut-gold, #c9a84c)', fontWeight: 600 }}>▦ Multi Chart</span>
              <button
                type="button"
                className={styles.toolbarBtn}
                style={{ marginLeft: 'auto' }}
                onClick={() => mc.exitGrid()}
              >Exit Multi Chart</button>
            </div>
            <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
              <MultiChartGrid mc={mc} />
            </div>
          </div>
        ) : (
          <MobileWorkspace
            widgets={layout.widgets}
            onRemove={handleRemoveWidget}
            onColorChange={handleColorChange}
            onOptsChange={handleOptsChange}
            onAddWidget={handleAddWidget}
          />
        )}
      </WorkspaceContext.Provider>
    )
  }

  // A popped-out widget is hidden from the board but KEPT in layout.widgets: its
  // slot frees up and the grid recompacts while it's away, and its stored
  // position is still there to dock back into.
  const visibleWidgets = layout.widgets.filter(w => !poppedWidgetIds.includes(w.id))
  const poppedWidgets = layout.widgets.filter(w => poppedWidgetIds.includes(w.id))

  // ONE grid renderer, shared by the main board and every popped-out board. The
  // RGL configuration (viewport lock, 24 columns, computed row height) is
  // defined once here so a board on another monitor can't drift out of sync with
  // the workspace it came from.
  const renderGrid = (widgets, h, rowHeightOverride, widthOverride) => {
    // A popped-out board passes an explicit width (measured against its OWN
    // window); the main board leaves it undefined and uses WidthProvider's
    // auto-measurement.
    const GridComp = widthOverride > 0 ? Responsive : ResponsiveGridLayout
    const widthProps = widthOverride > 0 ? { width: widthOverride } : {}
    return (
    <GridComp
      className="layout"
      {...widthProps}
      layouts={{
        lg: widgets.map(w => {
          const defaults = WIDGET_DEFAULTS[w.type] || {}
          return {
            i: w.id, x: w.x, y: w.y, w: w.w, h: w.h,
            minW: defaults.minW || 4, minH: defaults.minH || 3,
          }
        }),
      }}
      breakpoints={BREAKPOINTS}
      cols={COLS}
      rowHeight={rowHeightOverride ?? rowHeight}
      maxRows={FIXED_ROWS}
      isBounded={true}
      onLayoutChange={h.onLayoutChange}
      draggableHandle=".charts-widget-drag-handle"
      isDraggable={!merged}
      isResizable={!merged}
      compactType="vertical"
      margin={[gridGap, gridGap]}
      resizeHandles={['nw', 'ne', 'sw', 'se']}
      /* Position grid items with top/left, NOT transform: translate().
         RGL's default CSS-transform positioning composites each widget's
         chart <canvas> onto a GPU layer that, under fractional Windows
         display scaling, gets resampled at a non-integer device-pixel
         offset — blurring + desaturating the candles. top/left keeps the
         canvas on the root layer so it paints crisp (matches Setup Library). */
      useCSSTransforms={false}
    >
      {widgets.map(w => {
        // Another widget sits DIRECTLY above this one (its bottom edge touches
        // this widget's top edge and their columns overlap) → drop this widget's
        // header to the bottom so the two blend at the seam.
        const hasAbove = widgets.some(o =>
          o.id !== w.id
          && (o.y + o.h) === w.y
          && o.x < w.x + w.w && w.x < o.x + o.w,
        )
        return (
          <div key={w.id}>
            <WidgetHost
              widget={w}
              headerAtBottom={hasAbove}
              merged={merged}
              onRemove={() => h.onRemove(w.id)}
              onColorChange={(c) => h.onColorChange(w.id, c)}
              onOptsChange={(opts) => h.onOptsChange(w.id, opts)}
              onPopOut={h.onPopOut ? () => h.onPopOut(w.id) : undefined}
            />
          </div>
        )
      })}
    </GridComp>
    )
  }

  const mainGridHandlers = {
    onLayoutChange: handleLayoutChange,
    onRemove: handleRemoveWidget,
    onColorChange: handleColorChange,
    onOptsChange: handleOptsChange,
    onPopOut: handlePopOutWidget,
  }

  return (
    <WorkspaceContext.Provider value={workspaceValue}>
      <div className={styles.workspace} data-charts-theme={chartsTheme}>
        <header className={styles.workspaceHeader}>
          <span className={styles.workspaceTitle}><UIcon name="equity" size={14} style={{ verticalAlign: '-2px', marginRight: 5 }} />Charts</span>
          {!gridMode && (<>
          <div className={styles.toolbarBtnGroup} style={{ position: 'relative' }}>
            <button
              type="button"
              className={styles.toolbarBtn}
              onClick={() => { setAddMenuOpen(o => !o); setOpenMenuOpen(false); setSaveMenuOpen(false); setMcMenuOpen(false) }}
            >+ Add Widget</button>
            {addMenuOpen && (
              <div className={styles.addMenu} onMouseLeave={() => setAddMenuOpen(false)}>
                {WIDGET_TYPES.map(t => (
                  <button
                    key={t}
                    type="button"
                    className={styles.addMenuItem}
                    onClick={() => { handleAddWidget(t); setAddMenuOpen(false) }}
                  >{WIDGET_LABELS[t]}</button>
                ))}
              </div>
            )}
          </div>

          {/* New layout — wipe to a blank board to build from scratch. */}
          <button type="button" className={styles.toolbarBtn} onClick={handleNewLayout}>
            New Layout
          </button>
          </>)}

          {/* Open a saved / prebuilt layout — visible in BOTH modes (it hosts
              the Multi Chart flyout, the grid mode's only entry point). */}
          <div className={styles.toolbarBtnGroup} style={{ position: 'relative' }}>
            <button
              type="button"
              className={styles.toolbarBtn}
              onClick={() => { setOpenMenuOpen(o => !o); setAddMenuOpen(false); setSaveMenuOpen(false); setMcMenuOpen(false) }}
            >Open layout ▾</button>
            {openMenuOpen && (
              <div className={styles.addMenu} style={{ minWidth: 210 }} onMouseLeave={() => { setOpenMenuOpen(false); setConfirmDeleteId(null) }}>
                <div className={styles.menuSection}>Prebuilt</div>
                {/* UCT Default — the LOCKED canonical layout (frozen shell +
                    chart settings, UCT_DEFAULT_LAYOUT / _CHART_SETTINGS_JSON).
                    Applying loads the frozen state into the working board and
                    never writes back, so no in-app edit can mutate the default. */}
                <div className={styles.menuRow}>
                  <button
                    type="button"
                    className={styles.addMenuItem}
                    style={{ flex: 1 }}
                    onClick={applyUctDefault}
                  >UCT Default</button>
                </div>
                {/* TSDR — Sunset (formerly "Sunrise"): the light sky-gradient theme.
                    Re-added as a THEME toggle for now (internal chartsTheme key is
                    still 'sunrise' — the CSS/StockChart look; only the label changed).
                    ✓ shows when active. Pending: an owner "manual override" to
                    capture a tweaked version into a LOCKED prebuilt template like
                    UCT Default. See charts-layout-presets-snapshot. */}
                <div className={styles.menuRow}>
                  <button
                    type="button"
                    className={styles.addMenuItem}
                    style={{ flex: 1, ...(chartsTheme === 'sunrise' ? { color: 'var(--ut-green-bright, #1ae51a)' } : {}) }}
                    onClick={() => { setChartsTheme('sunrise'); setPref('watchlist_settings', JSON.stringify(WATCHLIST_DEFAULTS)); setOpenMenuOpen(false) }}
                  >{chartsTheme === 'sunrise' ? '✓ ' : ''}TSDR — Sunset</button>
                </div>
                {wsGlobalLayouts.map(t => (
                  <div key={`g${t.id}`} className={styles.menuRow}>
                    <button type="button" className={styles.addMenuItem} style={{ flex: 1 }} onClick={() => { applyTemplate(t); if (gridMode) mc.exitGrid() }}>{t.name}</button>
                    {isAdmin && (
                      confirmDeleteId === t.id ? (
                        <DeleteConfirm
                          onYes={() => { handleDeleteTemplate(t.id); setConfirmDeleteId(null) }}
                          onCancel={() => setConfirmDeleteId(null)}
                        />
                      ) : (
                        <button type="button" className={styles.menuDel} title="Delete prebuilt template" onClick={() => setConfirmDeleteId(t.id)}>✕</button>
                      )
                    )}
                  </div>
                ))}
                {wsMyLayouts.length > 0 && <div className={styles.menuSection}>My layouts</div>}
                {wsMyLayouts.map(t => (
                  <div key={`m${t.id}`} className={styles.menuRow}>
                    <button type="button" className={styles.addMenuItem} style={{ flex: 1 }} onClick={() => { applyTemplate(t); if (gridMode) mc.exitGrid() }}>{t.name}</button>
                    {confirmDeleteId === t.id ? (
                      <DeleteConfirm
                        onYes={() => { handleDeleteTemplate(t.id); setConfirmDeleteId(null) }}
                        onCancel={() => setConfirmDeleteId(null)}
                      />
                    ) : (
                      <button type="button" className={styles.menuDel} title="Delete" onClick={() => setConfirmDeleteId(t.id)}>✕</button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Save current arrangement / save as a named template */}
          {!gridMode && (
          <div className={styles.toolbarBtnGroup} style={{ position: 'relative' }}>
            <button
              type="button"
              className={styles.toolbarBtn}
              onClick={() => { setSaveMenuOpen(o => !o); setAddMenuOpen(false); setOpenMenuOpen(false); setMcMenuOpen(false) }}
            >{savedFlash ? 'Saved ✓' : 'Save layout ▾'}</button>
            {saveMenuOpen && (
              <div className={styles.addMenu} style={{ minWidth: 230 }}>
                <button type="button" className={styles.addMenuItem} onClick={() => { handleSaveLayout(); setSaveMenuOpen(false) }}>
                  Save current arrangement
                </button>
                <div className={styles.menuDivider} />
                <div className={styles.menuForm}>
                  <div className={styles.menuSection} style={{ padding: 0 }}>Save as template</div>
                  <input
                    className={styles.menuInput}
                    placeholder="Template name"
                    value={saveAsName}
                    maxLength={60}
                    onChange={e => { setSaveAsName(e.target.value); setSaveErr('') }}
                    onKeyDown={e => { if (e.key === 'Enter') handleSaveAsTemplate() }}
                  />
                  {isAdmin && (
                    <label className={styles.menuCheck}>
                      <input
                        type="checkbox"
                        checked={saveAsScope === 'global'}
                        onChange={e => setSaveAsScope(e.target.checked ? 'global' : 'user')}
                      />
                      Prebuilt (available to all users)
                    </label>
                  )}
                  <button type="button" className={styles.toolbarBtn} style={{ alignSelf: 'flex-start' }} onClick={handleSaveAsTemplate}>
                    Save template
                  </button>
                  {saveErr && <div className={styles.menuErr}>{saveErr}</div>}
                </div>
              </div>
            )}
          </div>
          )}

          {/* Multi Chart — its own top-level dropdown (moved out of Open layout).
              Visible in BOTH modes: it's the grid-mode entry point AND hosts the
              layout presets / N×M / sync toggles / saved grids / "Back to
              workspace" once in grid mode. Same MultiChartMenu, now anchored
              below this button instead of flying out beside the Open menu. */}
          <div className={styles.toolbarBtnGroup} style={{ position: 'relative' }}>
            <button
              type="button"
              className={styles.toolbarBtn}
              style={gridMode ? { color: 'var(--ut-gold, #c9a84c)' } : undefined}
              onClick={() => { setMcMenuOpen(o => !o); setOpenMenuOpen(false); setAddMenuOpen(false); setSaveMenuOpen(false) }}
            >{gridMode ? '✓ ' : ''}▦ Multi Chart ▾</button>
            {mcMenuOpen && (
              <MultiChartMenu
                mc={mc}
                onClose={() => setMcMenuOpen(false)}
              />
            )}
          </div>

          {/* Merge widgets — locks the board, removes borders/headers, blends all
              widgets seamlessly with a thin seam. Workspace mode only. */}
          {!gridMode && (
            <button
              type="button"
              className={styles.toolbarBtn}
              style={merged ? { color: 'var(--ut-gold, #c9a84c)' } : undefined}
              onClick={toggleMerged}
              title={merged
                ? 'Unlock the board and restore widget borders'
                : 'Lock the board in place, remove all borders, and blend every widget together'}
            >{merged ? '⧉ Unmerge widgets' : '⧉ Merge widgets'}</button>
          )}

          {/* Pop the whole board into its own window to drag onto another
              monitor. Main returns to a blank board so the next layout can be
              built and popped onto the monitor after that. */}
          {!gridMode && (
            <button
              type="button"
              className={styles.toolbarBtn}
              onClick={handlePopOutLayout}
              disabled={!visibleWidgets.length}
              title={visibleWidgets.length
                ? 'Open this whole layout in its own window you can drag to another monitor'
                : 'Add a widget first — there is no layout to pop out'}
            >⧉ Pop out layout</button>
          )}

          {gridMode && (
            <button type="button" className={styles.toolbarBtn} onClick={mc.exitGrid}>
              Workspace
            </button>
          )}
        </header>
        <main className={`${styles.workspaceBody} ${merged ? styles.workspaceBodyMerged : ''}`} ref={bodyRef}>
          {gridMode ? (
            <MultiChartGrid mc={mc} />
          ) : renderGrid(visibleWidgets, mainGridHandlers)}
          {/* Merged mode: draggable seams between adjacent widgets (TC2000-style
              split-pane resize). RGL's own drag/resize is off while merged, so
              these bars are the only way to resize — grow one widget, shrink its
              neighbor, board stays gapless. */}
          {merged && !gridMode && gridWidth > 0 && (
            <MergedSeamOverlay
              widgets={visibleWidgets}
              cols={GRID_COLS}
              rows={FIXED_ROWS}
              colWidth={gridWidth / GRID_COLS}
              rowHeight={rowHeight}
              minWFor={minWFor}
              minHFor={minHFor}
              onResize={handleSeamResize}
            />
          )}
        </main>

        {/* Pop-outs live OUTSIDE <main> but INSIDE the provider: each renders
            through a portal into its own OS window, while its state, hooks and
            data subscriptions stay in this tab. That's what lets every monitor
            share this tab's single live-price/bars stream pool. */}
        {poppedWidgets.map(w => (
          <PopoutWindow
            key={w.id}
            title={`UCT — ${WIDGET_LABELS[w.type] || w.type}`}
            width={900}
            height={700}
            onClose={() => handleDockWidget(w.id)}
            onBlocked={() => { handleDockWidget(w.id); setPopoutNotice(POPUP_BLOCKED_MSG) }}
          >
            <PopoutShell theme={chartsTheme}>
              <WidgetHost
                widget={w}
                merged={false}
                onRemove={() => handleRemovePoppedWidget(w.id)}
                onColorChange={(c) => handleColorChange(w.id, c)}
                onOptsChange={(opts) => handleOptsChange(w.id, opts)}
              />
            </PopoutShell>
          </PopoutWindow>
        ))}

        {poppedLayouts.map(pl => (
          <PoppedLayout
            key={pl.id}
            title="UCT — Layout"
            theme={chartsTheme}
            initialWidgets={pl.widgets}
            renderGrid={renderGrid}
            computeRowHeight={computeRowHeight}
            initialRowHeight={rowHeight}
            onClose={(widgets) => handleDockLayout(pl.id, widgets)}
            onBlocked={(widgets) => { handleDockLayout(pl.id, widgets); setPopoutNotice(POPUP_BLOCKED_MSG) }}
          />
        ))}

        {popoutNotice && (
          <div className={styles.popoutNotice} role="alert">
            {popoutNotice}
            <button type="button" onClick={() => setPopoutNotice(null)} aria-label="Dismiss">✕</button>
          </div>
        )}
      </div>
    </WorkspaceContext.Provider>
  )
}
