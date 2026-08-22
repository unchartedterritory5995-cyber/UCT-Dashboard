// app/src/components/research/sections/StatementPanels.jsx
//
// Six statement panels over 24 quarters — the shape a fundamentals page wants:
// small multiples you can scan in one pass, rather than a grid of numbers.
//
// Fed by /api/research/financial-history, which reads FMP (24q / 12y). The
// older /api/research/financials reads yfinance and returns about five
// quarters; five points cannot show a cycle, so a business compounding for six
// years and one that just bounced look identical.
//
// Pairs share a panel where the RELATIONSHIP is the point — revenue against
// operating income, gross profit against opex, assets against liabilities.
// The panels themselves are data in ./statementSeries.js.
//
// Any panel pops out into a larger modal (click the card, or its expand
// button). Small multiples are for scanning; the pop-out is for reading one
// chart closely — 24 bars at 168px tall hide the shape of a single quarter.
import { memo, useCallback, useRef, useState } from 'react'
import useSWR from 'swr'
import { SeriesChart } from '../../research-kit'
import { SkeletonBlock } from '../../Skeleton'
import Sheet from '../../mobile/Sheet'
import UIcon from '../../ui/UIcon'
import { useIsPhone } from '../../../hooks/useBreakpoint'
import { EXPANDED_HEIGHT, PANEL_HEIGHT, PANEL_SPECS, panelSeries, spanLabel } from './statementSeries'
import styles from './StatementPanels.module.css'

const fetcher = (u) => fetch(u).then((r) => (r.ok ? r.json() : null)).catch(() => null)

const NO_HISTORY = 'Statement history is unavailable for this ticker.'
const FOCUSABLE = 'button:not([disabled]), a[href], input, select, textarea, [tabindex]:not([tabindex="-1"])'

/** Year-ago + Quarterly/Annual. Rendered above the grid AND inside the
 *  pop-out, bound to the same state, so a flip in either place is one flip. */
function Controls({ period, setPeriod, yoy, setYoy }) {
  return (
    <>
      <label className={styles.yoy}>
        <input type="checkbox" checked={yoy} onChange={e => setYoy(e.target.checked)} />
        Year-ago
      </label>
      <div className={styles.toggle} role="group" aria-label="Reporting period">
        <button type="button" aria-pressed={period === 'quarter'}
                className={period === 'quarter' ? styles.on : styles.off}
                onClick={() => setPeriod('quarter')}>Quarterly</button>
        <button type="button" aria-pressed={period === 'annual'}
                className={period === 'annual' ? styles.on : styles.off}
                onClick={() => setPeriod('annual')}>Annual</button>
      </div>
    </>
  )
}

/**
 * One card shell for the skeleton and the data grid, so both reserve the same
 * box and nothing shifts when the data lands. The expand affordance is a real
 * button only when there is something to expand; the skeleton gets an inert
 * placeholder of the same size.
 */
function PanelCard({ spec, onExpand, children }) {
  const open = onExpand ? () => {
    // A drag-select that ends inside the card is a selection, not a click.
    if (window.getSelection?.()?.toString()) return
    onExpand(spec.key)
  } : undefined
  return (
    <section className={`${styles.panel} ${onExpand ? styles.clickable : ''}`} onClick={open}>
      <div className={styles.titleRow}>
        <div className={styles.title}>{spec.title}</div>
        {onExpand ? (
          // The whole card opens the pop-out; this is the keyboard and
          // screen-reader door, and its click bubbles to the same handler.
          <button type="button" className={styles.expand} aria-label={`Expand ${spec.title}`}>
            <UIcon name="expand" size={13} gold={false} />
          </button>
        ) : (
          <span className={styles.expand} aria-hidden="true" />
        )}
      </div>
      {children}
    </section>
  )
}

/** Memoised so opening or closing the pop-out re-renders zero cards — six
 *  ECharts canvases would otherwise re-lay out behind the backdrop. */
const PanelChart = memo(function PanelChart({ spec, periods, series, period, yoy, onExpand }) {
  return (
    <PanelCard spec={spec} onExpand={onExpand}>
      <SeriesChart
        periods={periods}
        mode="bars"
        height={PANEL_HEIGHT}
        valueFormatter={spec.fmt}
        ariaLabel={`${spec.title} by period`}
        series={panelSeries(spec, series, period, yoy)}
      />
    </PanelCard>
  )
})

export default function StatementPanels({ sym }) {
  const [period, setPeriod] = useState('quarter')
  const [yoy, setYoy] = useState(true)
  // Key of the panel currently popped out, or null.
  const [expanded, setExpanded] = useState(null)
  // Click-triggered conditional rendering — the sanctioned useIsPhone case: the
  // pop-out mounts on a tap, so matchMedia is meaningful by then. The same
  // threshold the host modal uses to pick ITS shell, so a tablet gets a wide
  // modal over a wide modal rather than a 720px bottom sheet over one.
  const isPhone = useIsPhone()
  const popRef = useRef(null)
  const onExpand = useCallback((key) => setExpanded(key), [])
  const closeExpanded = useCallback(() => setExpanded(null), [])

  // A different company is a different pop-out. The host can step reporters
  // under us (the calendar keys it by open-sequence, not symbol), and a chart
  // that silently redraws as someone else's is worse than one that closes.
  // Reset during render (React's "information from previous renders" idiom)
  // rather than in an effect, so there is no frame showing the wrong company.
  const [seenSym, setSeenSym] = useState(sym)
  if (seenSym !== sym) { setSeenSym(sym); setExpanded(null) }

  const { data, isLoading } = useSWR(
    sym ? `/api/research/financial-history/${sym}?period=${period}` : null,
    fetcher,
    // keepPreviousData: a period flip keeps the previous bars on screen while
    // the next ones load — no skeleton flash, no ECharts re-init, and the
    // expand button focus returns to on close stays mounted.
    { revalidateOnFocus: false, keepPreviousData: true },
  )

  const periods = data?.periods || []
  const series = data?.series || {}
  // The period the bars on screen belong to — the payload echoes it. While a
  // flip is in flight the toggle already says the NEW period; the year-ago
  // shift has to follow the bars, not the toggle.
  const dataPeriod = data?.period === 'annual' ? 'annual' : 'quarter'

  const onKeyDown = useCallback((e) => {
    // Keys from the pop-out bubble here through the React tree even though
    // the Sheet is portaled to <body>. Anything from the page itself is not ours.
    const panel = popRef.current?.closest('[role="dialog"]')
    if (!panel || !panel.contains(e.target)) return
    // ←/→ step the host to the next reporter. Inside a chart they would swap
    // the company under the title; stop them here (stopPropagation from
    // React's root never lets the event reach the host's window listener).
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.stopPropagation(); return }
    if (e.key !== 'Tab') return
    // Sheet focuses its panel but does not trap. Without this, Tab walks out
    // of the portal into the page behind two backdrops.
    const items = [...panel.querySelectorAll(FOCUSABLE)]
    if (!items.length) return
    const first = items[0]
    const last = items[items.length - 1]
    const active = document.activeElement
    if (e.shiftKey && (active === first || active === panel)) { e.preventDefault(); last.focus() }
    else if (!e.shiftKey && active === last) { e.preventDefault(); first.focus() }
  }, [])

  if (!sym) return null

  const spec = PANEL_SPECS.find((s) => s.key === expanded) || null
  const caption = isLoading ? 'Loading…' : spanLabel(periods, dataPeriod)
  const controls = <Controls period={period} setPeriod={setPeriod} yoy={yoy} setYoy={setYoy} />

  let body
  if (data === undefined) {
    // The FIRST load — later loads keep the previous bars on screen. Only a
    // wait deserves a skeleton; a resolved absence gets words, never a
    // shimmer that promises content which is not coming.
    body = (
      <div className={styles.grid} aria-hidden="true">
        {PANEL_SPECS.map((s) => (
          <PanelCard key={s.key} spec={s}><SkeletonBlock height={PANEL_HEIGHT} /></PanelCard>
        ))}
      </div>
    )
  } else if (!periods.length) {
    // The controls stay: the reader flipped to a period with no history and
    // needs the other button to get back.
    body = (
      <>
        <div className={styles.head}><span className={styles.count}>{caption}</span>{controls}</div>
        <p className={styles.note}>{NO_HISTORY}</p>
      </>
    )
  } else {
    body = (
      <>
        <div className={styles.head}><span className={styles.count}>{caption}</span>{controls}</div>
        <div className={styles.grid}>
          {PANEL_SPECS.map((s) => (
            <PanelChart key={s.key} spec={s} periods={periods} series={series}
                        period={dataPeriod} yoy={yoy} onExpand={onExpand} />
          ))}
        </div>
      </>
    )
  }

  return (
    <div onKeyDown={onKeyDown}>
      {/* inert while the pop-out is open: the page's own controls are the
          same controls, and a screen reader must not meet them twice. */}
      <div className={styles.wrap} inert={spec ? true : undefined}>{body}</div>
      {/* lockScroll={false}: the host earnings modal already owns the body
          scroll lock; a second lock's cleanup can run after the host's and
          strand the page on overflow:hidden. */}
      <Sheet open={!!spec} onClose={closeExpanded}
             variant={isPhone ? 'bottom-sheet' : 'modal'} maxWidth={1100} lockScroll={false}
             title={spec ? <>{spec.title}<span className={styles.expandedSym}>{sym}</span></> : null}
             ariaLabel={spec ? `${spec.title} — ${sym}` : undefined}>
        {spec && (
          <div ref={popRef} className={styles.expanded}>
            <div className={styles.head}><span className={styles.count}>{caption}</span>{controls}</div>
            {data === undefined ? (
              <SkeletonBlock height={EXPANDED_HEIGHT} />
            ) : !periods.length ? (
              <p className={styles.note}>{NO_HISTORY}</p>
            ) : (
              <SeriesChart
                periods={periods}
                mode="bars"
                height={EXPANDED_HEIGHT}
                valueFormatter={spec.fmt}
                ariaLabel={`${spec.title} by period, expanded`}
                series={panelSeries(spec, series, dataPeriod, yoy)}
              />
            )}
          </div>
        )}
      </Sheet>
    </div>
  )
}
