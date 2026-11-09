import { memo, useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import StockChart from '../../../../components/StockChart'
import ErrorBoundary from '../../../../components/ErrorBoundary'
import CompanyLogo from '../../../../components/CompanyLogo'
import { PANE_LOOK } from '../../../../components/chart/pane/paneLook'
import { fmtPct } from './scanDeckModel'
import { GRID_SORTS, sortGridRows } from './gridSort'
import styles from './ScanDeck.module.css'

// GRID — the whole list as a sheet of real UCT charts (StockChart, the same
// engine and "grid lite" profile the /charts Multi-Chart grid cells use), so a
// glance down the sheet shows which setups are worth a closer look. Clicking a
// card opens that stock in Focus.
//
// Charts mount only once their card scrolls near the viewport: a 90-name list
// must not start 90 chart engines at once.

const SIZES = [['l', 'Large'], ['m', 'Medium'], ['s', 'Small']]
const TFS = [['D', 'Daily'], ['W', 'Weekly']]

const MiniChart = memo(function MiniChart({ sym, tf, settings }) {
  // A card borrows the Focus chart's look; an edit on a card (legend chip,
  // right-click) stays on that card for the session, never in global settings.
  // (Inline, not useSessionChartSettings: importing that would split it into a
  // shared chunk the app's entry lists, which costs the Notebook byte budget.)
  const [edited, setEdited] = useState(null)
  const onSettingsPersist = useCallback((next) => setEdited(next && typeof next === 'object' ? next : null), [])
  return (
    <ErrorBoundary fallback={<div className={styles.cardEmpty}>Chart unavailable</div>}>
      <StockChart
        sym={sym}
        tf={tf}
        chartId={`breadth-grid-${sym}`}
        showDrawingTools={false}
        hideReplay hidePatterns hideCompare hideCountdown disablePatterns
        backgroundWarm={false}
        hotkeysActive={() => false}
        // The member's /charts look, from the ONE authority every chart surface
        // reads: bold candles on the THEME's canvas (userCanvas), not the fixed
        // Model Book navy a hand-copied prop list fell back to.
        {...PANE_LOOK}
        // A card's header already names the stock; the full OHLC/MA legend on
        // every card buried the candles.
        alwaysShowLegend={false}
        hideWatermark
        carryDragPlacement={false}
        lockWatermark
        rightPadBars={4}
        dailyDefaultBars={tf === 'W' ? 104 : 126}
        volumePaneHeightPct={14}
        priceScaleTopMargin={0.1} priceScaleBottomMargin={0.08}
        hideExtHoursToolbarToggle
        // The Focus chart's look (its template), so a card and the big chart match.
        settingsOverride={edited || settings || undefined}
        onSettingsPersist={onSettingsPersist}
      />
    </ErrorBoundary>
  )
})

function useNear() {
  const ref = useRef(null)
  // No IntersectionObserver (old browser, test DOM): mount straight away.
  const [near, setNear] = useState(() => typeof IntersectionObserver === 'undefined')
  useEffect(() => {
    const el = ref.current
    if (!el || near) return undefined
    const io = new IntersectionObserver((ents) => {
      if (ents.some(e => e.isIntersecting)) { setNear(true); io.disconnect() }
    }, { rootMargin: '300px 0px' })
    io.observe(el)
    return () => io.disconnect()
  }, [near])
  return [ref, near]
}

const metaText = (row) => [row.industry || row.sector, row.theme].filter(Boolean).join(' · ') || '—'
const fmtPx = (v) => (Number.isFinite(v) ? v.toFixed(2) : '—')

function GridCard({ row, tf, selected, onOpen, settings }) {
  const [ref, near] = useNear()
  const up = Number.isFinite(row.pct) && row.pct >= 0
  const pctCls = `${styles.cardPct} ${up ? styles.up : styles.dn}`
  const chart = (
    <div className={styles.cardChart}>
      {near ? <MiniChart sym={row.sym} tf={tf} settings={settings} /> : <div className={styles.cardEmpty} />}
    </div>
  )
  // Owner pick 2026-11-09 (style B): rounded, spaced cards with a two-line
  // identity: logo, symbol, price, % change; industry · theme; RVOL on the right.
  return (
    <div ref={ref} className={`${styles.card} ${styles.cardFloat}`} data-selected={selected || undefined}>
      <button type="button" className={styles.floatHead} onClick={() => onOpen(row.sym)} title={`Open ${row.sym} in Focus`}>
        <CompanyLogo sym={row.sym} name={row.name} size={26} round />
        <span className={styles.floatId}>
          <span className={styles.floatLine}>
            <span className={styles.cardSym}>{row.sym}</span>
            <span className={styles.floatPx}>{fmtPx(row.price)}</span>
            <span className={pctCls}>{fmtPct(row.pct, 2)}</span>
          </span>
          <span className={styles.cardMeta}>{metaText(row)}</span>
        </span>
        {Number.isFinite(row.rvol) && <span className={styles.floatRvol}><b>{row.rvol.toFixed(1)}x</b>RVOL</span>}
      </button>
      {chart}
    </div>
  )
}

export default function ScanGrid({ rows, dir = 1, selectedSym, onOpen, toolbarStart = null, chartSettings = null }) {
  const sortId = useId()
  const [sortKey, setSortKey] = useState('pct')
  const [size, setSize] = useState('m')
  const [tf, setTf] = useState('D')
  const sorted = useMemo(() => sortGridRows(rows, sortKey, dir), [rows, sortKey, dir])
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
      <div className={styles.gridScroll}>
        {sorted.length
          ? (
            <div className={styles.gridSheet} data-size={size}>
              {sorted.map(r => (
                <GridCard key={r.sym} row={r} tf={tf} selected={r.sym === selectedSym} onOpen={onOpen} settings={chartSettings} />
              ))}
            </div>
          )
          : <div className={styles.gridEmpty}>No stocks matched this filter.</div>}
      </div>
    </div>
  )
}
