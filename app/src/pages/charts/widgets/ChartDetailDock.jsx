/**
 * ChartDetailDock — the Company Intelligence panel that docks onto the right of a
 * chart. One panel, one tab bar (Overview · Financials · Earnings · Ownership ·
 * News) plus an in-header Search.
 *
 * TWO STATES, TWO OWNERS. Whether Company Info is ADDED (`dock.company`) is chart
 * configuration, owned by Indicators → Add to Chart (chartFeatures.js). Whether
 * it is EXPANDED (`dock.open`) is the member's temporary choice, owned right here:
 * the header chevron collapses it to a slim edge rail, the rail expands it. The
 * panel still has no close X — removing it is an Add to Chart action.
 *
 * The chart (StockChart, autoSize) sits in .dockChartCol; opening the panel steals
 * width so the chart reflows automatically. State persists via opts.dock.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import UIcon from '../../../components/ui/UIcon'
import DockProfile from './DockProfile'
import DockNews from './DockNews'
import ErrorBoundary from '../../../components/ErrorBoundary'
import DockFinancials from './DockFinancials'
import DockEarnings from './DockEarnings'
import DockOwnership from './DockOwnership'
import CompanySearch from './CompanySearch'
import { COMPANY_TABS, MAX_RIGHT_FRAC, MAX_STRIP_FRAC, MIN_RIGHT_W, MIN_STRIP_H, companyPanelFit } from './chartDock'
import { COMPANY_INFO, setFeatureOpen } from './chartFeatures'
import { dockColorVars } from './dockThemeColors'
import { clearNewsPrefetch, prefetchPanel } from './dockPrefetch'
import ChartEarningsStrip from './ChartEarningsStrip'
import styles from './ChartDetailDock.module.css'

// Drag the divider to resize the panel width. Kept in local state during the drag
// (smooth chart reflow), committed to opts on release.
function useDockResize(current, commit, rootRef, min, axis = 'x', maxFrac = MAX_RIGHT_FRAC) {
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
  const [rootW, setRootW] = useState(null)
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

  const companyAdded = !!dock.company
  const fit = companyPanelFit(rightResize.size, rootW)
  // Expanded only when added, chosen open AND there is room; otherwise an added
  // panel is the rail. A removed panel is neither.
  const rightOpen = companyAdded && !!dock.open && fit.fits
  const railShown = companyAdded && !rightOpen
  const tooNarrow = companyAdded && !!dock.open && !fit.fits
  const setCompanyOpen = useCallback(
    (open) => setDock(d => setFeatureOpen(d, COMPANY_INFO, open)), [setDock])
  const stripOpen = !!dock.strip

  // The widget's own width drives the fit rule above. Measured only while the
  // panel is added — a chart without Company Info pays for no observer.
  useLayoutEffect(() => {
    const el = rootRef.current
    if (!el || !companyAdded) return undefined
    const ro = new ResizeObserver(([e]) => setRootW(Math.round(e.contentRect.width)))
    ro.observe(el)
    setRootW(Math.round(el.getBoundingClientRect().width))
    return () => ro.disconnect()
  }, [companyAdded])

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

  // ── Search — an inline exploration mode, not navigation ─────────────────────
  // ⛔ NO KEYBOARD SHORTCUT. This used to listen for Ctrl/⌘+K on window, but the
  // global command palette owns that chord in the capture phase and stops it
  // (pages/command/shortcutRegistry.js 'palette.toggle'), so the panel's
  // listener never fired and its "(Ctrl+K)" tooltip promised a key that opens
  // the palette instead. The search button is the door.
  const [searchOpen, setSearchOpen] = useState(false)
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reset transient search when the panel is closed
    if (!rightOpen) setSearchOpen(false)
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
          <div className={styles.dockRight} style={{ width: fit.width }} data-testid="company-panel">
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
                title="Search company information"
                aria-label="Search company information"
              >
                <UIcon name="search" size={14} gold={false} />
              </button>
              <button
                type="button"
                className={styles.rdCollapse}
                onClick={() => setCompanyOpen(false)}
                title="Collapse company info"
                aria-label="Collapse company info"
              >
                <UIcon name="chevronRight" size={13} gold={false} />
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

        {/* The collapsed rail exists ONLY because Company Info is added — it is
            the panel folded to its edge, not a toolbar. When the widget is too
            narrow to show the panel it stands in for it, and says why. */}
        {railShown && (
          <div className={styles.dockRail}>
            <button
              type="button"
              className={styles.railBtn}
              onClick={tooNarrow ? undefined : () => setCompanyOpen(true)}
              disabled={tooNarrow}
              title={tooNarrow ? 'Widen this chart to show company info' : 'Show company info'}
              aria-label={tooNarrow ? 'Company info needs a wider chart' : 'Show company info'}
              data-testid="company-rail"
            >
              <UIcon name="columns" size={13} gold={false} />
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
