import { lazy, memo, Suspense, useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react'
import StockChart from '../../../../components/StockChart'
import ErrorBoundary from '../../../../components/ErrorBoundary'
import CompanyLogo from '../../../../components/CompanyLogo'
import { PANE_LOOK } from '../../../../components/chart/pane/paneLook'
import { mergeChartSettings, mergeSettingsOverride } from '../../../../components/chart/chartDefaults'
import usePreferences from '../../../../hooks/usePreferences'
import { prefetchListDeep } from '../../../../utils/prefetchBars'
import { fmtPct } from './scanDeckModel'
import { GRID_SORTS, sortGridRows } from './gridSort'
import { DRILL_POPOVER_ATTR } from './scanFacets'
import { claimMount, releaseMount, noteScroll } from './gridMountQueue'
import styles from './ScanDeck.module.css'

// GRID — the whole list as a sheet of real UCT charts (StockChart with the
// member's /charts look), so a glance down the sheet shows which setups are worth
// a closer look.
//
// ⭐ OWNER RULES (2026-11-09, round 2 the same evening):
//  • The scroll wheel SCROLLS THE SHEET, wherever the mouse is. A chart only takes
//    the wheel (zoom) and a press-and-drag (pan) once the member CLICKS it; that
//    card goes gold. The selecting click itself never reaches the chart, so
//    letting go and moving the mouse does NOT pan (only a held drag does).
//  • The mouse leaving the card lets the chart go (gold off): the wheel scrolls
//    the sheet again.
//  • The corner button ENLARGES the chart in place (the classic UCT chart); a card
//    click no longer jumps to Focus.
//  • Smooth with 900+ names: only the rows on or near the screen exist at all
//    (logos and charts included), charts are created one at a time nearest-first
//    (gridMountQueue), and the bars for the rows just ahead are warmed.

const SIZES = [['l', 'Large'], ['m', 'Medium'], ['s', 'Small']]
const TFS = [['D', 'Daily'], ['W', 'Weekly']]
// Card geometry per size: the narrowest a column may be, and the row height.
// The column count is computed from these (not CSS auto-fill) so the windowing
// below knows exactly which cards sit on which row.
const GEOM = { l: { min: 560, h: 400 }, m: { min: 400, h: 300 }, s: { min: 290, h: 230 } }
const GAP = 10
const PAD = 10
const OVERSCAN_ROWS = 2   // rows kept alive above and below the screen
const WARM_AHEAD_ROWS = 3 // rows whose bars are warmed past the bottom of the screen

const chartLook = { ...PANE_LOOK }

// The full Chart Settings window, for the enlarged chart's gear. Loaded on first
// open only.
const ChartSettingsModal = lazy(() => import('../../../../components/chart/ChartSettingsModal'))

const MiniChart = memo(function MiniChart({ sym, tf, settings, big = false, onPersist = null }) {
  // A card borrows the grid's look (the Focus chart's template); an edit on a
  // card (legend chip, right-click) stays on that card for the session, never in
  // global settings. The enlarged chart's edits go to the grid's look instead
  // (`onPersist`), the same place its settings gear writes.
  // (Inline, not useSessionChartSettings: importing that would split it into a
  // shared chunk the app's entry lists, which costs the Notebook byte budget.)
  const [edited, setEdited] = useState(null)
  const onSettingsPersist = useCallback((next) => {
    const v = next && typeof next === 'object' ? next : null
    if (onPersist) { if (v) onPersist(v) } else setEdited(v)
  }, [onPersist])
  return (
    <ErrorBoundary fallback={<div className={styles.cardEmpty}>Chart unavailable</div>}>
      <StockChart
        sym={sym}
        tf={tf}
        chartId={big ? `breadth-grid-big-${sym}` : `breadth-grid-${sym}`}
        showDrawingTools={false}
        hideReplay hidePatterns hideCompare hideCountdown disablePatterns
        backgroundWarm={false}
        hotkeysActive={() => false}
        // The member's /charts look, from the ONE authority every chart surface
        // reads: bold candles on the THEME's canvas (userCanvas), not the fixed
        // Model Book navy a hand-copied prop list fell back to.
        {...chartLook}
        // A grid card keeps no saved pan/zoom on the device. Said outright (after the
        // spread) so the settings census can read it: persistenceManifest.test.js.
        viewLockKey={null}
        // A card's header already names the stock: its OHLC/MA legend shows on
        // hover only, flush with the top edge. The enlarged chart keeps the
        // classic always-on legend.
        alwaysShowLegend={big}
        legendFlush
        compactAxes
        hideWatermark={!big}
        carryDragPlacement={false}
        lockWatermark
        rightPadBars={big ? 6 : 4}
        dailyDefaultBars={tf === 'W' ? 104 : big ? 189 : 126}
        volumePaneHeightPct={big ? 16 : 14}
        priceScaleTopMargin={0.1} priceScaleBottomMargin={0.08}
        hideExtHoursToolbarToggle
        // The Focus chart's look (its template), so a card and the big chart match.
        settingsOverride={(!onPersist && edited) || settings || undefined}
        onSettingsPersist={onSettingsPersist}
      />
    </ErrorBoundary>
  )
})

// "Sector · Industry" after the % change (a name repeated is shown once).
const metaText = (row) => {
  const parts = []
  for (const v of [row.sector, row.industry]) {
    const t = typeof v === 'string' ? v.trim() : ''
    if (t && !parts.some(p => p.toLowerCase() === t.toLowerCase())) parts.push(t)
  }
  return parts.join(' · ')
}
const fmtPx = (v) => (Number.isFinite(v) ? v.toFixed(2) : '—')

// Events a chart must NOT see until its card is active. The wheel passes on to
// the sheet (it scrolls); a press activates the card instead of panning.
const PRESS_EVENTS = ['pointerdown', 'mousedown', 'touchstart']
const AFTER_PRESS_EVENTS = ['pointerup', 'mouseup', 'touchend', 'click', 'dblclick', 'contextmenu']
const END_EVENTS = ['pointerup', 'mouseup', 'touchend', 'pointercancel', 'touchcancel']

function useChartGate(active, onActivate) {
  const ref = useRef(null)
  const activeRef = useRef(active)
  const activateRef = useRef(onActivate)
  useLayoutEffect(() => {
    activeRef.current = active
    activateRef.current = onActivate
  }, [active, onActivate])
  useEffect(() => {
    const el = ref.current
    if (!el) return undefined
    // While the SELECTING press is in progress, EVERY event of it is kept from
    // the chart, until the button is let go. ⛔ It used to check "is the card
    // active?" per event: the press's pointerdown activated the card, React
    // re-rendered in the microtask before the mousedown, so the mousedown went
    // through to the chart (start of a drag) while the mouseup was still
    // swallowed. The chart never saw the release and panned with the mouse
    // afterwards (owner, 2026-11-09).
    let swallowing = false
    let endTimer = 0
    const endPress = () => {
      if (!swallowing || endTimer) return
      // After this tick: the press's own mouseup / click are dispatched first.
      endTimer = setTimeout(() => { endTimer = 0; swallowing = false }, 0)
    }
    // Capture phase on the card, so the chart's own listeners never fire. The
    // wheel is NOT prevented: the browser scrolls the sheet as if the chart
    // were not there.
    const onWheel = (e) => { if (!activeRef.current) e.stopPropagation() }
    const onPress = (e) => {
      if (swallowing) { e.stopPropagation(); return }
      if (activeRef.current) return
      e.stopPropagation()
      swallowing = true
      // The release can land outside the card; the window always sees it.
      for (const t of END_EVENTS) window.addEventListener(t, endPress, { capture: true, once: true })
      activateRef.current?.()
    }
    const onAfter = (e) => {
      if (!swallowing) return
      e.stopPropagation()
      if (e.type === 'click' || e.type === 'contextmenu') endPress()
    }
    el.addEventListener('wheel', onWheel, { capture: true, passive: true })
    for (const t of PRESS_EVENTS) el.addEventListener(t, onPress, { capture: true })
    for (const t of AFTER_PRESS_EVENTS) el.addEventListener(t, onAfter, { capture: true })
    return () => {
      el.removeEventListener('wheel', onWheel, { capture: true })
      for (const t of PRESS_EVENTS) el.removeEventListener(t, onPress, { capture: true })
      for (const t of AFTER_PRESS_EVENTS) el.removeEventListener(t, onAfter, { capture: true })
      for (const t of END_EVENTS) window.removeEventListener(t, endPress, { capture: true })
      if (endTimer) clearTimeout(endTimer)
    }
  }, [])
  return ref
}

// A card waits its turn before creating its chart (one chart per frame,
// nearest the middle of the screen first). Leaving the window cancels the wait.
function useMountTicket(cardRef, scrollRef) {
  const [granted, setGranted] = useState(false)
  useEffect(() => {
    const entry = {
      priority: () => {
        const el = cardRef.current
        const sc = scrollRef.current
        if (!el || !sc) return 1e9
        const r = el.getBoundingClientRect()
        const s = sc.getBoundingClientRect()
        const mid = s.top + s.height / 2
        // On screen first, then by distance from the screen's middle.
        const onScreen = r.bottom > s.top && r.top < s.bottom
        return (onScreen ? 0 : 1e6) + Math.abs(r.top + r.height / 2 - mid)
      },
      grant: () => setGranted(true),
    }
    claimMount(entry)
    return () => releaseMount(entry)
  }, [cardRef, scrollRef])
  return granted
}

const GridCard = memo(function GridCard({ row, tf, active, onActivate, onRelease, onExpand, settings, scrollRef }) {
  const cardRef = useRef(null)
  const activate = useCallback(() => onActivate(row.sym), [onActivate, row.sym])
  // Leaving the card lets the chart go. Mid-drag (a button held), wait for the
  // release so the drag is not cut off.
  const onPointerLeave = useCallback((e) => {
    if (!active) return
    if (!e.buttons) { onRelease(row.sym); return }
    window.addEventListener('pointerup', () => {
      if (!cardRef.current?.matches(':hover')) onRelease(row.sym)
    }, { once: true })
  }, [active, onRelease, row.sym])
  const chartRef = useChartGate(active, activate)
  const granted = useMountTicket(cardRef, scrollRef)
  const up = Number.isFinite(row.pct) && row.pct >= 0
  const pctCls = `${styles.cardPct} ${up ? styles.up : styles.dn}`
  const meta = metaText(row)
  // Owner pick 2026-11-09 (style B), thinned the same evening: ONE line —
  // logo, symbol, price, % change — sector · industry — and an Enlarge button.
  return (
    <div ref={cardRef} className={`${styles.card} ${styles.cardFloat}`} data-selected={active || undefined}
      onPointerLeave={onPointerLeave}>
      <div className={styles.floatHead}>
        <button type="button" className={styles.floatIdBtn} onClick={activate}
          aria-pressed={active} title={active ? `${row.sym} selected` : `Select ${row.sym}`}>
          <CompanyLogo sym={row.sym} name={row.name} size={20} round />
          <span className={styles.floatLine}>
            <span className={styles.cardSym}>{row.sym}</span>
            <span className={styles.floatPx}>{fmtPx(row.price)}</span>
            <span className={pctCls}>{fmtPct(row.pct, 2)}</span>
            {meta && <span className={styles.cardMeta}><span className={styles.metaDash} aria-hidden="true">—</span>{meta}</span>}
          </span>
        </button>
        <button type="button" className={styles.expandBtn} onClick={() => onExpand(row.sym)}
          title={`Enlarge ${row.sym}`} aria-label={`Enlarge ${row.sym} chart`}>
          <svg width="13" height="13" viewBox="0 0 16 16" aria-hidden="true">
            <path d="M9.5 2.5h4v4M13.5 2.5 9 7M6.5 13.5h-4v-4M2.5 13.5 7 9" fill="none" stroke="currentColor"
              strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </div>
      <div ref={chartRef} className={styles.cardChart} data-active={active || undefined}>
        {granted ? <MiniChart sym={row.sym} tf={tf} settings={settings} /> : <div className={styles.cardEmpty} />}
      </div>
    </div>
  )
})

function ExpandedChart({ row, tf, settings, onSettingsChange, onClose }) {
  const [settingsOpen, setSettingsOpen] = useState(false)
  const gearRef = useRef(null)
  useEffect(() => {
    const onKey = (e) => {
      // The settings window owns Escape while it is open.
      if (e.key !== 'Escape' || settingsOpen) return
      e.preventDefault()
      onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, settingsOpen])
  // The settings window edits the look the grid's charts draw with: the
  // member's chart settings with the grid's template over them, exactly what
  // StockChart resolves for these charts.
  const { prefs, setPref } = usePreferences()
  const modalCs = useMemo(() => mergeSettingsOverride(mergeChartSettings(prefs.chart_settings), settings || null),
    [prefs.chart_settings, settings])
  const savedColors = useMemo(() => {
    try {
      const raw = prefs.chart_saved_colors
      const arr = typeof raw === 'string' ? JSON.parse(raw) : raw
      return Array.isArray(arr) ? arr : []
    } catch { return [] }
  }, [prefs.chart_saved_colors])
  const saveColor = useCallback((hex) => {
    if (!hex) return
    const h = String(hex).toLowerCase()
    setPref('chart_saved_colors', JSON.stringify([h, ...savedColors.filter(c => String(c).toLowerCase() !== h)].slice(0, 24)))
  }, [savedColors, setPref])
  const deleteColor = useCallback((hex) => {
    const h = String(hex).toLowerCase()
    setPref('chart_saved_colors', JSON.stringify(savedColors.filter(c => String(c).toLowerCase() !== h)))
  }, [savedColors, setPref])
  const up = Number.isFinite(row.pct) && row.pct >= 0
  const meta = metaText(row)
  return (
    // The drill window ignores Escape while this attribute is on screen, so
    // Escape closes the enlarged chart, not the whole window.
    <div className={styles.expanded} role="dialog" aria-label={`${row.sym} chart`} {...{ [DRILL_POPOVER_ATTR]: '' }}>
      <div className={styles.expandedHead}>
        <CompanyLogo sym={row.sym} name={row.name} size={28} round />
        <span className={styles.floatId}>
          <span className={styles.floatLine}>
            <span className={styles.expandedSym}>{row.sym}</span>
            <span className={styles.floatPx}>{fmtPx(row.price)}</span>
            <span className={`${styles.cardPct} ${up ? styles.up : styles.dn}`}>{fmtPct(row.pct, 2)}</span>
            {row.name && <span className={styles.cardMeta}>{row.name}</span>}
          </span>
          {meta && <span className={styles.cardMeta}>{meta}</span>}
        </span>
        <button ref={gearRef} type="button" className={styles.expandClose} onClick={() => setSettingsOpen(true)}
          title="Chart settings" aria-label="Chart settings" aria-haspopup="dialog">
          <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
            <circle cx="12" cy="12" r="3" fill="none" stroke="currentColor" strokeWidth="1.8" />
            <path fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"
              d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
          </svg>
        </button>
        <button type="button" className={styles.expandClose} onClick={onClose} title="Back to the grid (Esc)" aria-label="Close enlarged chart">
          <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
            <path d="M3.5 12.5 7 9M3.5 9H7v3.5M12.5 3.5 9 7M9 3.5V7h3.5" fill="none" stroke="currentColor"
              strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </div>
      <div className={styles.expandedChart}>
        <MiniChart sym={row.sym} tf={tf} settings={settings} big onPersist={onSettingsChange} />
      </div>
      {settingsOpen && (
        <Suspense fallback={null}>
          <ChartSettingsModal
            open
            onClose={() => setSettingsOpen(false)}
            returnFocusRef={gearRef}
            chartTf={tf}
            settings={modalCs}
            onChange={onSettingsChange}
            savedColors={savedColors}
            onSaveColor={saveColor}
            onDeleteColor={deleteColor}
            volumeOpts={{ volumeSeparatePane: true, blankVolume: false }}
          />
        </Suspense>
      )}
    </div>
  )
}

// Which rows are on (or near) the screen. Re-renders only when that RANGE
// changes, never per scroll frame. (Keeping scrolled-off rows alive until the
// scroll paused was measured and was slower: more live charts cost more than
// the teardown it postponed.)

function rangeFor(top, height, stride, rowCount) {
  const base = Math.floor(Math.max(0, top - PAD) / stride)
  // Before the first measure (and in a test DOM with no layout) show a screenful.
  const visRows = height > 0 ? Math.ceil(height / stride) + 1 : 4
  const first = Math.max(0, base - OVERSCAN_ROWS)
  const last = Math.max(first, Math.min(rowCount - 1, base + visRows + OVERSCAN_ROWS))
  return { first, last }
}

function useRowWindow(scrollRef, rowCount, rowH) {
  const stride = rowH + GAP
  const [state, setState] = useState({ width: 0, first: 0, last: -1 })
  const geomRef = useRef({ stride, rowCount })
  useLayoutEffect(() => { geomRef.current = { stride, rowCount } }, [stride, rowCount])
  const measure = useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    const { stride: st, rowCount: n } = geomRef.current
    const r = rangeFor(el.scrollTop, el.clientHeight, st, n)
    const width = el.clientWidth
    setState(prev => (prev.width === width && prev.first === r.first && prev.last === r.last
      ? prev : { width, first: r.first, last: r.last }))
  }, [scrollRef])

  useLayoutEffect(() => {
    measure()
    const el = scrollRef.current
    if (!el || typeof ResizeObserver === 'undefined') return undefined
    const ro = new ResizeObserver(() => measure())
    ro.observe(el)
    return () => ro.disconnect()
  }, [measure, scrollRef, stride, rowCount])

  const frame = useRef(0)
  const onScroll = useCallback(() => {
    noteScroll()
    if (!frame.current) frame.current = requestAnimationFrame(() => { frame.current = 0; measure() })
  }, [measure])
  useEffect(() => () => { if (frame.current) cancelAnimationFrame(frame.current) }, [])
  const fallback = state.last < state.first ? rangeFor(0, 0, stride, rowCount) : state
  return { width: state.width, first: fallback.first, last: Math.min(fallback.last, rowCount - 1), onScroll, measure }
}

export default function ScanGrid({ rows, dir = 1, onSelect, toolbarStart = null, chartSettings = null, onChartSettingsChange = null }) {
  const sortId = useId()
  const [sortKey, setSortKey] = useState('pct')
  const [size, setSize] = useState('m')
  const [tf, setTf] = useState('D')
  const [activeSym, setActiveSym] = useState(null)
  const [expandedSym, setExpandedSym] = useState(null)
  const scrollRef = useRef(null)
  // The grid's look: the host's (the Focus chart's template). With no host to
  // keep an edit (the harness), the edit stays here.
  const [localCs, setLocalCs] = useState(null)
  const gridCs = (!onChartSettingsChange && localCs) || chartSettings
  const onChartSettingsChangeRef = useRef(onChartSettingsChange)
  useLayoutEffect(() => { onChartSettingsChangeRef.current = onChartSettingsChange }, [onChartSettingsChange])
  const changeGridCs = useCallback((next) => {
    if (!next || typeof next !== 'object') return
    if (onChartSettingsChangeRef.current) onChartSettingsChangeRef.current(next)
    else setLocalCs(next)
  }, [])
  const sorted = useMemo(() => sortGridRows(rows, sortKey, dir), [rows, sortKey, dir])

  const g = GEOM[size] || GEOM.m
  const [cols, setCols] = useState(1)
  const rowCount = Math.ceil(sorted.length / cols)
  const win = useRowWindow(scrollRef, rowCount, g.h)
  // Columns from the measured width: as many as fit at the size's minimum.
  const nextCols = win.width > 0 ? Math.max(1, Math.floor((win.width - PAD * 2 + GAP) / (g.min + GAP))) : cols
  if (nextCols !== cols) setCols(nextCols)

  const stride = g.h + GAP
  const lastRow = Math.max(0, rowCount - 1)
  const firstIdx = win.first * cols
  const lastIdx = Math.min(sorted.length, (Math.min(win.last, lastRow) + 1) * cols)
  const shown = sorted.slice(firstIdx, lastIdx)
  const padTop = PAD + win.first * stride
  const padBottom = PAD + Math.max(0, lastRow - Math.min(win.last, lastRow)) * stride

  // Warm the bars of the rows on screen and just ahead, in the timeframe shown.
  const ahead = useMemo(() => sorted.slice(firstIdx, Math.min(sorted.length, lastIdx + WARM_AHEAD_ROWS * cols)).map(r => r.sym),
    [sorted, firstIdx, lastIdx, cols])
  const aheadKey = `${tf}|${ahead.join(',')}`
  useEffect(() => {
    if (!ahead.length) return undefined
    const t = setTimeout(() => prefetchListDeep(ahead, { tfs: [tf], cap: 60, priority: true }), 120)
    return () => clearTimeout(t)
    // aheadKey carries both inputs
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aheadKey])

  // A new list, sort or size starts at the top with nothing selected.
  const listKey = `${sortKey}|${size}|${sorted.length}|${sorted[0]?.sym || ''}`
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = 0
    win.measure()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listKey])

  // The host's handler arrives as a fresh function each render; a ref keeps
  // these stable so the memoized cards are not all re-rendered with it.
  const onSelectRef = useRef(onSelect)
  useLayoutEffect(() => { onSelectRef.current = onSelect }, [onSelect])
  const onActivate = useCallback((sym) => {
    setActiveSym(sym)
    onSelectRef.current?.(sym)
  }, [])
  const onExpand = useCallback((sym) => {
    setActiveSym(sym)
    onSelectRef.current?.(sym)
    setExpandedSym(sym)
  }, [])
  const onRelease = useCallback((sym) => setActiveSym(prev => (prev === sym ? null : prev)), [])
  const closeExpanded = useCallback(() => setExpandedSym(null), [])
  // A press on the sheet's empty space (between or around cards) lets go of
  // the selected card, so nothing holds the wheel.
  const onSheetPress = useCallback((e) => {
    if (!e.target.closest?.('[data-grid-card]')) setActiveSym(null)
  }, [])

  const expandedRow = expandedSym ? sorted.find(r => r.sym === expandedSym) : null

  return (
    <div className={styles.gridView}>
      <div className={styles.bandRow}>
        {toolbarStart}
        <span className={styles.spacer} />
        <label className={styles.tbLabel} htmlFor={sortId}>Sort</label>
        <select id={sortId} className={styles.select} value={sortKey} onChange={e => setSortKey(e.target.value)}>
          {GRID_SORTS.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
        </select>
        <span className={styles.tbSep} aria-hidden="true" />
        <div className={`${styles.seg} ${styles.segSm}`} role="group" aria-label="Timeframe">
          {TFS.map(([k, l]) => <button key={k} type="button" aria-pressed={tf === k} onClick={() => setTf(k)}>{l}</button>)}
        </div>
        <span className={styles.tbSep} aria-hidden="true" />
        <div className={`${styles.seg} ${styles.segSm}`} role="group" aria-label="Card size">
          {SIZES.map(([k, l]) => <button key={k} type="button" aria-pressed={size === k} onClick={() => setSize(k)}>{l}</button>)}
        </div>
      </div>
      <div className={styles.gridBody}>
        <div ref={scrollRef} className={styles.gridScroll} onScroll={win.onScroll} onPointerDown={onSheetPress}>
          {sorted.length
            ? (
              <div className={styles.gridSheet}
                style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`, gridAutoRows: `${g.h}px`, paddingTop: padTop, paddingBottom: padBottom }}>
                {shown.map(r => (
                  <div key={r.sym} data-grid-card="" className={styles.cardSlot}>
                    <GridCard row={r} tf={tf} active={r.sym === activeSym}
                      onActivate={onActivate} onRelease={onRelease} onExpand={onExpand} settings={gridCs} scrollRef={scrollRef} />
                  </div>
                ))}
              </div>
            )
            : <div className={styles.gridEmpty}>No stocks matched this filter.</div>}
        </div>
        {expandedRow && <ExpandedChart row={expandedRow} tf={tf} settings={gridCs} onSettingsChange={changeGridCs} onClose={closeExpanded} />}
      </div>
    </div>
  )
}
