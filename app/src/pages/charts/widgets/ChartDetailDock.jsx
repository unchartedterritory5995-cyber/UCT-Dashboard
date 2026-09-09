/**
 * ChartDetailDock — the Company Intelligence panel that docks onto the right of a
 * chart. One panel, one tab bar (Overview · Financials · Earnings · Ownership ·
 * News) plus an in-header Search. Visibility is owned by the toolbar toggle
 * (ChartPanelsButton, which replaces Share-to-Floor) — the panel has no close X.
 *
 * The chart (StockChart, autoSize) sits in .dockChartCol; opening the panel steals
 * width so the chart reflows automatically. State persists via opts.dock.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import UIcon from '../../../components/ui/UIcon'
import DockProfile from './DockProfile'
import DockNews from './DockNews'
import ErrorBoundary from '../../../components/ErrorBoundary'
import DockFinancials from './DockFinancials'
import DockEarnings from './DockEarnings'
import DockOwnership from './DockOwnership'
import CompanySearch from './CompanySearch'
import { COMPANY_TABS, MAX_STRIP_FRAC, MIN_RIGHT_W, MIN_STRIP_H, DEFAULT_RIGHT_W } from './chartDock'
import { dockColorVars } from './dockThemeColors'
import { clearNewsPrefetch, prefetchPanel } from './dockPrefetch'
import ChartEarningsStrip from './ChartEarningsStrip'
import styles from './ChartDetailDock.module.css'

/* ── Toolbar toggle (replaces Share to Floor) ────────────────────────────────
   A single, direct action: open/close the Company Intelligence panel. No menu,
   no panel picker — the button IS the panel's on/off, with a clear active state. */
export function ChartPanelsButton({ dock, setDock, btnClassName }) {
  const open = !!dock.open
  // Opening always resets to the designed default width, so the panel looks
  // identical every time (the owner's "consistent default size" requirement);
  // in-session resizing still works, it just doesn't carry across a close/reopen.
  return (
    <button
      type="button"
      className={btnClassName}
      onClick={() => setDock(d => (d.open ? { ...d, open: false } : { ...d, open: true, rightW: DEFAULT_RIGHT_W }))}
      title={open ? 'Hide company info' : 'Company info'}
      aria-label="Company info panel"
      aria-pressed={open}
      style={open ? { color: 'var(--accent, #c9a84c)' } : undefined}
    >
      <UIcon name="columns" size={15} gold={open} />
    </button>
  )
}

/* ── Earnings-strip toggle ───────────────────────────────────────────────────
   Sits beside ChartPanelsButton in the timeframe bar's end slot, because that
   slot is already where this widget's other LAYOUT-visibility control lives.
   Deliberately not near the drawing tools, the timeframe pills or the chart
   type: this changes what the widget shows, not how price is drawn. */
export function ChartEarningsButton({ dock, setDock, btnClassName }) {
  const on = !!dock.strip
  return (
    <button
      type="button"
      className={btnClassName}
      onClick={() => setDock(d => ({ ...d, strip: !d.strip }))}
      title={on ? 'Hide earnings strip' : 'Show earnings strip'}
      aria-label="Earnings strip"
      aria-pressed={on}
      style={on ? { color: 'var(--accent, #c9a84c)' } : undefined}
    >
      <UIcon name="scale" size={15} gold={on} />
    </button>
  )
}

// Drag the divider to resize the panel width. Kept in local state during the drag
// (smooth chart reflow), committed to opts on release.
function useDockResize(current, commit, rootRef, min, axis = 'x', maxFrac = 0.62) {
  const [live, setLive] = useState(null)
  const startRef = useRef(null)
  const onDown = useCallback((e) => {
    e.preventDefault()
    const rect = rootRef.current?.getBoundingClientRect()
    // Both axes GROW when dragged toward the widget's interior — left for the
    // panel, up for the strip — so the delta is start-minus-current either way.
    const vertical = axis === 'y'
    const span = rect ? (vertical ? rect.height : rect.width) : null
    startRef.current = {
      pos: vertical ? e.clientY : e.clientX,
      size: current,
      max: span ? span * maxFrac : 9999,
    }
    setLive(current)
    const onMove = (ev) => {
      const s = startRef.current
      if (!s) return
      const now = vertical ? ev.clientY : ev.clientX
      setLive(Math.max(min, Math.min(s.max, s.size + (s.pos - now))))
    }
    const onUp = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      startRef.current = null
      setLive(v => { if (v != null) commit(v); return null })
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }, [current, commit, rootRef, min, axis, maxFrac])
  return { size: live == null ? current : live, onDown }
}

export default function ChartDetailDock({ sym, dock, setDock, onPickSymbol, chartSettings, children }) {
  const rootRef = useRef(null)
  const chartColRef = useRef(null)
  const [colW, setColW] = useState(0)
  // The panel's directional numbers follow THIS chart widget's theme, not a
  // global one — two charts side by side on different themes each colour their
  // own panel. Null when the settings carry nothing parseable, which leaves the
  // stylesheet defaults in place rather than half-theming the panel.
  const themeVars = useMemo(() => dockColorVars(chartSettings), [chartSettings])

  const commitRightW = useCallback((w) => setDock(d => ({ ...d, rightW: Math.round(w) })), [setDock])
  const rightResize = useDockResize(dock.rightW, commitRightW, rootRef, MIN_RIGHT_W)
  // The strip's own divider. Measured against the CHART COLUMN, not the whole
  // widget, so the ceiling means "45% of the space the chart actually has".
  const commitStripH = useCallback(
    (h) => setDock(d => ({ ...d, stripH: Math.round(h) })), [setDock])
  const stripResize = useDockResize(
    dock.stripH, commitStripH, chartColRef, MIN_STRIP_H, 'y', MAX_STRIP_FRAC)
  const setTab = useCallback((key) => setDock(d => ({ ...d, tab: key })), [setDock])
  const setNewsFilter = useCallback((f) => setDock(d => ({ ...d, newsFilter: f })), [setDock])

  const rightOpen = !!dock.open
  const stripOpen = !!dock.strip

  // The strip sizes off the CHART COLUMN's measured width, never the browser's:
  // opening or dragging the Company Panel changes one and not the other.
  useEffect(() => {
    const el = chartColRef.current
    if (!el || !stripOpen) return undefined
    const ro = new ResizeObserver(([e]) => {
      setColW(Math.round(e.contentRect.width))
    })
    ro.observe(el)
    setColW(Math.round(el.getBoundingClientRect().width))
    return () => ro.disconnect()
  }, [stripOpen])
  // Ask for every tab's payload as soon as the panel has a symbol, not when the
  // member clicks the tab. The server is already fast once warm (the news feed
  // measures 1-12ms); what was felt on a tab click was the round trip, because
  // each tab only started its request when it mounted.
  useEffect(() => {
    if (!rightOpen || !sym) return
    clearNewsPrefetch()          // a previous symbol's page must never be served
    prefetchPanel(sym)
  }, [rightOpen, sym])
  const tab = dock.tab

  // ── Search (Ctrl/⌘+K) — an inline exploration mode, not navigation ──────────
  const [searchOpen, setSearchOpen] = useState(false)
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reset transient search when the panel is closed
    if (!rightOpen) { setSearchOpen(false); return undefined }
    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && (e.key === 'k' || e.key === 'K')) { e.preventDefault(); setSearchOpen(true) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [rightOpen])

  return (
    <div className={styles.dockRoot} ref={rootRef} style={themeVars || undefined}>
      <div className={styles.dockUpper}>
        <div className={styles.dockChartCol} ref={chartColRef}>
          <div className={styles.dockChartPane}>{children}</div>
          {stripOpen && (
            <div className={styles.stripWrap} style={{ height: stripResize.size }}>
              {/* The gridline between the volume pane and the strip IS the grab
                  handle — same affordance as the Company Panel's own divider. */}
              <div
                className={styles.resizerH}
                onPointerDown={stripResize.onDown}
                title="Drag to resize the earnings strip"
              />
              <ChartEarningsStrip sym={sym} width={colW} />
            </div>
          )}
        </div>

        {rightOpen && (
          <div className={styles.dockRight} style={{ width: rightResize.size }}>
            <div className={styles.resizerV} onPointerDown={rightResize.onDown} />
            <div className={styles.rdHeader}>
              <div className={styles.rdTabs}>
                {COMPANY_TABS.map(t => (
                  <button
                    key={t.key}
                    type="button"
                    className={`${styles.rdTab}${tab === t.key ? ' ' + styles.rdTabOn : ''}`}
                    onClick={() => setTab(t.key)}
                  >{t.label}</button>
                ))}
              </div>
              <button
                type="button"
                className={`${styles.rdSearch}${searchOpen ? ' ' + styles.rdSearchOn : ''}`}
                onClick={() => setSearchOpen(true)}
                title="Search company information (Ctrl+K)"
                aria-label="Search company information"
              >
                <UIcon name="search" size={14} gold={false} />
              </button>
            </div>
            <div className={styles.dockBody}>
              {/* ⛔ RELEASE SAFETY. Without this boundary a render error in any
                  ONE tab unmounts the whole React tree — taking the CHART down
                  with it, which is the core product. Keyed on the tab + symbol
                  so a failure on one company clears when you move to the next
                  instead of latching. */}
              <ErrorBoundary
                key={`${tab}:${sym || ''}`}
                fallback={
                  <div className={styles.emptyState}>
                    This panel could not be displayed. Switch tabs or symbols to retry.
                  </div>
                }
              >
                {tab === 'overview' && <DockProfile sym={sym} onPickSymbol={onPickSymbol} />}
                {tab === 'financials' && <DockFinancials sym={sym} />}
                {tab === 'earnings' && <DockEarnings sym={sym} />}
                {tab === 'ownership' && <DockOwnership sym={sym} />}
                {tab === 'news' && <DockNews sym={sym} sentiment={dock.newsFilter} onSentiment={setNewsFilter} />}
              </ErrorBoundary>
              {searchOpen && <CompanySearch sym={sym} onClose={() => setSearchOpen(false)} />}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
