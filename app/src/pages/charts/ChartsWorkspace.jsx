import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Responsive, WidthProvider } from 'react-grid-layout'
import 'react-grid-layout/css/styles.css'
import usePreferences, { parsePref } from '../../hooks/usePreferences'
import useMediaQuery from '../../hooks/useMediaQuery'
import useChartLayouts from '../../hooks/useChartLayouts'
import { useAuth } from '../../context/AuthContext'
import UIcon from '../../components/ui/UIcon'
import { WorkspaceContext } from './WorkspaceContext'
import WidgetHost from './WidgetHost'
import MobileWorkspace from './widgets/MobileWorkspace'
import { findPlacement } from './findOpenSlot'
import MultiChartGrid from './grid/MultiChartGrid'
import MultiChartMenu from './grid/MultiChartMenu'
import useMultiChartState from './grid/useMultiChartState'
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
const UCT_DEFAULT_CHART_SETTINGS_JSON = '{"chartType":"candles","candles":{"upColor":"#1ae51a","downColor":"#c41f2d","upBorder":"#1ae51a","downBorder":"#c41f2d","upWick":"#1ae51a","downWick":"#c41f2d","oneColor":"#1ae51a"},"candleColorMode":"netchange","background":"#0f0f0f","bgMode":"solid","bgGradient":{"top":"#001e5a","bottom":"#ffffff"},"textColor":"#cfcfcf","textSize":11,"grid":{"color":"#ffffff08","visible":true},"crosshair":{"color":"#9a9a9a","style":1,"width":1,"magnet":false},"header":{"titleMode":"both","showChange":true,"timeframes":["5","15","30","D","W","1","M","60"],"customTimeframes":[],"showMarketCap":true,"showNextEarnings":true,"showUctRating":true,"showLegend":true,"colors":{"dayChange":"#1ae51a","legend":"#cfcfcf","dayChangeUp":"#1ae51a","dayChangeDown":"#c41f2d","marketCap":"#c9a84c","nextEarnings":"#6dc9c0","uctRating":"#1ae51a"}},"overlays":[{"enabled":true,"type":"EMA","period":9,"color":"#4ade80"},{"enabled":true,"type":"EMA","period":20,"color":"#f472b6"},{"enabled":true,"type":"SMA","period":50,"color":"#60a5fa"},{"enabled":true,"type":"SMA","period":200,"color":"#fb923c"}],"volume":{"visible":true,"upColor":"rgba(0,200,83,0.3)","downColor":"rgba(255,23,68,0.3)","hvcEnabled":true,"separatePane":false,"paneHeightPct":22},"watermark":{"visible":true,"opacity":0.5176470588235295,"color":"#ffffff","sizeScale":1,"lines":{"ticker":true,"company":true,"sector":true,"industry":true,"theme":true},"x":0.5,"y":0.5},"drawingDefaults":{"color":"#c9a84c","width":1},"indicators":{"rsi":{"enabled":false,"period":14,"color":"#7b68ee"},"macd":{"enabled":false,"fastPeriod":12,"slowPeriod":26,"signalPeriod":9,"macdColor":"#2196F3","signalColor":"#FF9800"},"bb":{"enabled":false,"period":20,"stdDev":2,"color":"rgba(156,39,176,0.85)"},"vwap":{"enabled":false,"color":"#26C6DA"},"stoch":{"enabled":false,"kPeriod":14,"dPeriod":3,"kColor":"#FF6B6B","dColor":"#4ECDC4"},"atr":{"enabled":false,"period":14,"color":"#FFA726"},"sar":{"enabled":false,"step":0.02,"maxStep":0.2,"color":"#ffeb3b"},"ichimoku":{"enabled":false,"tenkanColor":"#26C6DA","kijunColor":"#EF5350","spanAColor":"rgba(76,175,80,0.2)","spanBColor":"rgba(239,83,80,0.2)","chikouColor":"rgba(255,235,59,0.7)"},"volumeProfile":{"enabled":false,"bins":24,"color":"rgba(120,160,100,0.25)","pocColor":"rgba(200,160,40,0.65)"},"mfi":{"enabled":false,"period":14,"color":"#c084fc"},"cci":{"enabled":false,"period":20,"color":"#fbbf24"},"williamsR":{"enabled":false,"period":14,"color":"#60a5fa"},"adx":{"enabled":false,"period":14,"adxColor":"#e5e7eb","plusDIColor":"#22c55e","minusDIColor":"#ef4444"},"obv":{"enabled":false,"color":"#9ca3af"},"donchian":{"enabled":false,"period":20,"color":"rgba(96,165,250,0.5)"}},"swingLabels":{"enabled":true,"sensitivity":"low","color":"#000000","tintByType":true,"upColor":"#cfcfcf","downColor":"#cfcfcf","bgEnabled":false,"bg":"#ffffff"},"heikinAshi":false,"logScale":false,"percentScale":false,"comparisonSymbols":[],"markers":{"earnings":true,"splits":false,"dividends":false,"news":false,"earningsBeat":"#1ae51a","earningsMiss":"#c41f2d"},"countdown":false,"showPatterns":false,"hideDrawings":false,"extendedHoursShading":false,"volumeOverlayIndicators":[],"theme":"dark","positionCalc":{"accountSize":50000,"riskPct":1},"preset":"custom"}'

// Widths/minW are in 24-col units (2 units = one old column). themes minW is 2
// so the widget can still go narrow, but the reachable middle size (3 units = 1.5
// old cols) is the "in between" the too-thin and the good size.
const WIDGET_DEFAULTS = {
  chart:     { w: 12, h: 12, minW: 6, minH: 6 },
  watchlist: { w: 6,  h: 10, minW: 2, minH: 4 },
  themes:    { w: 6,  h: 10, minW: 2, minH: 4 },
  scanner:   { w: 8,  h: 10, minW: 6, minH: 4 },
  fundamentals: { w: 8, h: 6, minW: 6, minH: 2 },
  aisearch:  { w: 7,  h: 10, minW: 3, minH: 3 },
}

const WIDGET_TYPES = ['chart', 'watchlist', 'themes', 'scanner', 'fundamentals', 'aisearch']
const WIDGET_LABELS = {
  chart: 'Chart',
  watchlist: 'Watchlist',
  themes: 'Theme Tracker',
  scanner: 'Scanner',
  fundamentals: 'Fundamentals',
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

  // Viewport-locked sizing: measure the workspace body and divide its height
  // by FIXED_ROWS so the grid always fills the visible area exactly. The page
  // itself never scrolls — widget max size = visible chart area.
  const bodyRef = useRef(null)
  const [rowHeight, setRowHeight] = useState(34)
  useEffect(() => {
    const el = bodyRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const measure = () => {
      const h = el.clientHeight - BODY_PAD * 2
      const available = h - MARGIN_Y * (FIXED_ROWS - 1)
      const rh = Math.max(12, Math.floor(available / FIXED_ROWS))
      setRowHeight(rh)
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

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

  const setGroupSym = useCallback((color, sym) => {
    setGroupSymsState(prev => {
      const next = { ...prev, [color]: sym }
      setPref('charts_workspace_groups', JSON.stringify(next))
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

  const workspaceValue = useMemo(
    () => ({ groupSyms, setGroupSym, chartsTheme, crosshairBus: crosshairBusRef.current, aiSearchBus: aiSearchBusRef.current, activeChartRef }),
    [groupSyms, setGroupSym, chartsTheme],
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
    // Switch the ARRANGEMENT only — keep whatever tickers are currently loaded in
    // each color group. A template must not swap the stock you're looking at.
    // parseLayout keeps extra fields (`...parsed`), so pull chartSettings OUT of
    // the board layout — it belongs in the chart_settings pref, not the
    // charts_workspace_layout arrangement blob.
    const { chartSettings, ...boardLayout } = parseLayout(tpl.layout) || tpl.layout
    setLayout(boardLayout)
    setPref('charts_workspace_layout', JSON.stringify(boardLayout))
    // Restore the chart settings the template was saved with, if it has them.
    // Arrangement-only / older templates carry none → leave the current settings
    // untouched (never silently reset to default; only "UCT Default" applies the
    // frozen default settings).
    if (chartSettings) {
      setPref('chart_settings', chartSettings)
    }
    // Remember which named template is now open, so "Save current arrangement"
    // can update THIS template in place with later edits. Persisted so the link
    // survives a refresh.
    setPref('charts_active_template', JSON.stringify({ id: tpl.id, name: tpl.name, scope: tpl.scope || 'user' }))
    setOpenMenuOpen(false)
    flashSaved()
  }, [setPref, flashSaved])

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
    setChartsTheme('default')
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
    // Blank board is not a named template.
    setPref('charts_active_template', 'null')
  }, [setPref])

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
      const scope = isAdmin ? saveAsScope : 'user'
      const saved = await saveLayout({
        name: nm,
        layout: { ...layout, chartSettings },
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
  }, [saveAsName, layout, prefs?.chart_settings, isAdmin, saveAsScope, saveLayout, setPref, flashSaved])

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
        try {
          await saveLayout({ name: active.name, layout: { ...layout, chartSettings }, groups: null, scope: active.scope })
        } catch { /* surfaced by SWR revalidate */ }
      }
    }
    flashSaved()
  }, [layout, groupSyms, setPref, flashSaved, prefs?.charts_active_template, prefs?.chart_settings, isAdmin, globalLayouts, myLayouts, saveLayout])

  const handleDeleteTemplate = useCallback(async (id) => {
    try { await deleteLayout(id) } catch { /* surfaced by SWR revalidate */ }
    // If the layout you just deleted was the one open on screen, fall back to the
    // UCT Default so you're never left staring at a now-gone layout.
    const active = parsePref(prefs?.charts_active_template, null)
    if (active?.id === id) applyUctDefault()
  }, [deleteLayout, prefs?.charts_active_template, applyUctDefault])

  const [addMenuOpen, setAddMenuOpen] = useState(false)

  // ── Multi-Chart grid mode (fixed N×M grid of independent chart cells) ──
  const mc = useMultiChartState()
  const [mcMenuOpen, setMcMenuOpen] = useState(false)
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
          <div className={styles.workspace} data-charts-theme={chartsTheme} style={{ height: '100%' }}>
            <MultiChartGrid mc={mc} />
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

  const rglLayouts = {
    lg: layout.widgets.map(w => {
      const defaults = WIDGET_DEFAULTS[w.type] || {}
      return {
        i: w.id, x: w.x, y: w.y, w: w.w, h: w.h,
        minW: defaults.minW || 4, minH: defaults.minH || 3,
      }
    }),
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
                    never writes back, so no in-app edit can mutate the default.
                    (The 'sunrise' / TSDR theme option is temporarily hidden — theme
                    code kept intact, see charts-layout-presets-snapshot.) */}
                <div className={styles.menuRow}>
                  <button
                    type="button"
                    className={styles.addMenuItem}
                    style={{ flex: 1 }}
                    onClick={applyUctDefault}
                  >UCT Default</button>
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

          {gridMode && (
            <button type="button" className={styles.toolbarBtn} onClick={mc.exitGrid}>
              Workspace
            </button>
          )}
        </header>
        <main className={styles.workspaceBody} ref={bodyRef}>
          {gridMode ? (
            <MultiChartGrid mc={mc} />
          ) : (
          <ResponsiveGridLayout
            className="layout"
            layouts={rglLayouts}
            breakpoints={BREAKPOINTS}
            cols={COLS}
            rowHeight={rowHeight}
            maxRows={FIXED_ROWS}
            isBounded={true}
            onLayoutChange={handleLayoutChange}
            draggableHandle=".charts-widget-drag-handle"
            compactType="vertical"
            margin={[6, MARGIN_Y]}
            resizeHandles={['nw', 'ne', 'sw', 'se']}
            /* Position grid items with top/left, NOT transform: translate().
               RGL's default CSS-transform positioning composites each widget's
               chart <canvas> onto a GPU layer that, under fractional Windows
               display scaling, gets resampled at a non-integer device-pixel
               offset — blurring + desaturating the candles. top/left keeps the
               canvas on the root layer so it paints crisp (matches Setup Library). */
            useCSSTransforms={false}
          >
            {layout.widgets.map(w => (
              <div key={w.id}>
                <WidgetHost
                  widget={w}
                  onRemove={() => handleRemoveWidget(w.id)}
                  onColorChange={(c) => handleColorChange(w.id, c)}
                  onOptsChange={(opts) => handleOptsChange(w.id, opts)}
                />
              </div>
            ))}
          </ResponsiveGridLayout>
          )}
        </main>
      </div>
    </WorkspaceContext.Provider>
  )
}
