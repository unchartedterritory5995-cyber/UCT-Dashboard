/**
 * BrokerAccountHero — broker-app-style summary at the top of Open Positions.
 * Dominant account value + Today / period P&L + an INTERACTIVE equity curve
 * (Robinhood-style: drag/hover to scrub — the headline value, change, and date
 * follow your finger to that point in time) + a secondary balances strip.
 *
 * Curve + period P&L come from the cash-flow-adjusted performance engine
 * (/api/j2/broker/performance → equitySeries), which prepends ESTIMATED history
 * walked back through realized trades — so the curve is populated from day one
 * and converges to accurate daily net-liq snapshots over time. Account
 * value/cash/buying-power come from the account object; Open P&L / Invested%
 * from the already-computed portfolioAggregates. Renders null for non-broker.
 */
import { useMemo, useRef, useState } from 'react'
import { money, moneySigned, percent } from '../../../lib/journal-2-0'
import useJ2BrokerPerformance from '../hooks/useJ2BrokerPerformance'
import useIntradayEquityCurve from '../hooks/useIntradayEquityCurve'
import useAnimatedNumber from '../../../hooks/useAnimatedNumber'
import { SkeletonBlock, SkeletonLine } from '../../../components/Skeleton'
import styles from './BrokerAccountHero.module.css'

// Robinhood range tabs. 1D is an intraday reconstruction (bars); the rest come
// from the daily broker-performance equity series.
const RANGES = [
  { label: '1D', period: '1D' },
  { label: '1W', period: '1W' },
  { label: '1M', period: '1M' },
  { label: '3M', period: '3M' },
  { label: 'YTD', period: 'YTD' },
  { label: '1Y', period: '1Y' },
  { label: 'ALL', period: 'ALL' },
]

/** Map a 0..1 pointer fraction across the chart to a clamped data index. */
export function indexFromFraction(frac, n) {
  if (!n || n < 1) return 0
  const i = Math.round(frac * (n - 1))
  return Math.max(0, Math.min(n - 1, i))
}

function fmtDate(iso) {
  if (!iso) return ''
  const d = new Date(`${String(iso).slice(0, 10)}T00:00:00`)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

// Label for a series point — intraday points carry `t` (unix seconds, shown as
// an ET clock time), daily points carry `date` (ISO).
function pointLabel(p) {
  if (!p) return ''
  if (typeof p.t === 'number') {
    return new Date(p.t * 1000).toLocaleTimeString('en-US', {
      timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit',
    })
  }
  return fmtDate(p.date)
}

export default function BrokerAccountHero({
  account, aggregates, liveSummary = null, isLive = false,
  positions = [], prices = {}, optionMarketValue = 0,
}) {
  const [range, setRange] = useState(RANGES[0]) // default 1D (Robinhood default)
  const [scrub, setScrub] = useState(null)       // hovered/dragged data index
  const wrapRef = useRef(null)

  const isIntraday = range.period === '1D'
  // Daily equity curve across ALL brokers for the multi-day ranges; for 1D we
  // reconstruct an intraday curve from each holding's bars (still fetch a light
  // perf window so endEquity/fallbacks stay available).
  const { data, isLoading: perfLoading } = useJ2BrokerPerformance(
    null, isIntraday ? '1W' : range.period, { portfolio: true },
  )
  const { series: intradaySeries, loading: intraLoading } = useIntradayEquityCurve({
    positions, prices, optionMarketValue, cash: account?.brokerCash ?? 0, enabled: isIntraday,
  })

  const series = isIntraday ? (intradaySeries || []) : (data?.equitySeries || [])
  const isLoading = isIntraday ? intraLoading : perfLoading

  const model = useMemo(() => {
    if (series.length < 2) return null
    const ys = series.map((p) => p.value)
    const min = Math.min(...ys)
    const max = Math.max(...ys)
    const span = max - min || 1
    const n = series.length
    const coords = series.map((p, i) => ({
      x: (i / (n - 1)) * 100,
      y: 100 - ((p.value - min) / span) * 100,
    }))
    const line = coords.map((c, i) => `${i ? 'L' : 'M'}${c.x.toFixed(2)} ${c.y.toFixed(2)}`).join(' ')
    const area = `${line} L100 100 L0 100 Z`
    // Robinhood line color: green if the window ended up, red if down.
    const up = series[n - 1].value >= series[0].value
    return { line, area, up, coords, baselineY: coords[0].y, estimated: series.some((p) => p.estimated) }
  }, [series])

  // Tween target = the non-scrub headline (live net-liq, else perf base).
  // Called before the early return so the hook order is stable for
  // non-broker accounts too.
  const baseValue = data?.endEquity ?? account?.brokerTotalEquity
  const netLiqVal = liveSummary?.netLiq
  const animatedHead = useAnimatedNumber(netLiqVal != null ? netLiqVal : baseValue)

  const isBroker = account?.balanceSource === 'broker' && account?.brokerTotalEquity != null
  if (!isBroker) return null

  const marginUsed = account.brokerCash != null && account.brokerCash < 0 ? -account.brokerCash : 0
  const curveColor = model && !model.up ? 'var(--loss, #e74c3c)' : 'var(--gain, #3cb868)'

  // Scrub state → what the headline shows.
  const scrubbing = scrub != null && model && series[scrub]
  // Headline = the live net-liq (cash + live market value of holdings — the
  // Robinhood-accurate number), or the scrub point, or the portfolio perf base.
  // RH-style "slides, doesn't jump" — ticks tween via animatedHead; scrubbing
  // stays instant (the finger IS the animation).
  const shownValue = scrubbing ? series[scrub].value : animatedHead

  // ONE change line that rebaselines to the selected range (Robinhood behavior):
  // 1D = today's move (prefer the live summary), else the change over the window
  // (last − first of the series).
  const first = series[0]?.value
  const last = series[series.length - 1]?.value
  let rangeChange = (Number.isFinite(first) && Number.isFinite(last)) ? last - first : null
  let rangePct = (rangeChange != null && first) ? rangeChange / Math.abs(first) : null
  if (isIntraday && liveSummary?.today != null) {
    rangeChange = liveSummary.today
    rangePct = liveSummary.todayPct
  }
  const rangeUp = (rangeChange ?? 0) >= 0
  const rangeLabel = isIntraday ? 'Today' : range.label

  const scrubChange = scrubbing ? series[scrub].value - series[0].value : null
  const scrubPct = scrubbing && series[0].value ? scrubChange / Math.abs(series[0].value) : null
  const scrubUp = (scrubChange ?? 0) >= 0

  const onScrub = (e) => {
    const el = wrapRef.current
    if (!el || !model) return
    const rect = el.getBoundingClientRect()
    if (!rect.width) return
    const frac = (e.clientX - rect.left) / rect.width
    setScrub(indexFromFraction(frac, series.length))
  }
  const clearScrub = () => setScrub(null)

  return (
    <section className={styles.hero} aria-label="Account summary">
      <header className={styles.top}>
        <div className={styles.valueBlock}>
          <div className={styles.label}>
            Account Value
            {isLive && <span className={styles.liveBadge}> LIVE</span>}
          </div>
          <div className={styles.value}>{money(shownValue)}</div>
          <div className={styles.changes}>
            {scrubbing ? (
              <span className={`${styles.change} ${scrubUp ? styles.pos : styles.neg}`}>
                {scrubUp ? '▲' : '▼'} {moneySigned(scrubChange)}
                {scrubPct != null && <>{' '}({percent(scrubPct, { signed: true, dp: 1, isRatio: true })})</>}
                <span className={styles.changeLabel}> {pointLabel(series[scrub])}</span>
              </span>
            ) : (
              rangeChange != null && (
                <span className={`${styles.change} ${rangeUp ? styles.pos : styles.neg}`}>
                  {rangeUp ? '▲' : '▼'} {moneySigned(rangeChange)}
                  {rangePct != null && <>{' '}({percent(rangePct, { signed: true, dp: 1, isRatio: true })})</>}
                  <span className={styles.changeLabel}> {rangeLabel}{model?.estimated ? ' · est.' : ''}</span>
                </span>
              )
            )}
          </div>
        </div>
        <div className={styles.ranges} role="tablist" aria-label="Range">
          {RANGES.map((r) => (
            <button
              key={r.label}
              type="button"
              role="tab"
              aria-selected={r.label === range.label}
              className={`${styles.rangeBtn} ${r.label === range.label ? styles.rangeActive : ''}`}
              onClick={() => { setScrub(null); setRange(r) }}
            >
              {r.label}
            </button>
          ))}
        </div>
      </header>

      {!model && isLoading && (
        <div className={styles.chartSkeleton} role="status" aria-busy="true" aria-label="Loading equity curve">
          <SkeletonBlock width="100%" height={120} />
          <div className={styles.chartSkeletonAxis} aria-hidden="true">
            <SkeletonLine width="52px" height={9} />
            <SkeletonLine width="52px" height={9} />
          </div>
        </div>
      )}

      {model && (
        <>
          <div
            ref={wrapRef}
            className={styles.chartWrap}
            onPointerDown={onScrub}
            onPointerMove={(e) => { if (scrub != null || e.buttons || e.pointerType === 'mouse') onScrub(e) }}
            onPointerLeave={clearScrub}
            onPointerUp={clearScrub}
            style={{ touchAction: 'none' }}
          >
            <svg className={styles.svg} viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
              <defs>
                <linearGradient id="heroFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={curveColor} stopOpacity="0.42" />
                  <stop offset="55%" stopColor={curveColor} stopOpacity="0.12" />
                  <stop offset="100%" stopColor={curveColor} stopOpacity="0" />
                </linearGradient>
              </defs>
              {/* period-open baseline (dotted) */}
              <line x1="0" y1={model.baselineY} x2="100" y2={model.baselineY}
                    stroke="var(--text-muted, #8a8a8a)" strokeWidth="1" strokeDasharray="2 3"
                    vectorEffect="non-scaling-stroke" opacity="0.4" />
              <path d={model.area} fill="url(#heroFill)" />
              <path
                d={model.line}
                fill="none"
                stroke={curveColor}
                strokeWidth="2.5"
                vectorEffect="non-scaling-stroke"
                strokeLinejoin="round"
                strokeLinecap="round"
              />
            </svg>
            {scrubbing && (
              <>
                <div className={styles.tracker} style={{ left: `${model.coords[scrub].x}%` }} />
                <div
                  className={`${styles.dot} ${scrubUp ? styles.dotPos : styles.dotNeg}`}
                  style={{ left: `${model.coords[scrub].x}%`, top: `${model.coords[scrub].y}%` }}
                />
              </>
            )}
            {isLoading && <span className={styles.loading}>…</span>}
          </div>
          <div className={styles.dateAxis}>
            <span>{pointLabel(series[0])}</span>
            <span>{pointLabel(series[series.length - 1])}</span>
          </div>
        </>
      )}

      <div className={styles.strip}>
        <Metric label="Open P&L" value={moneySigned(aggregates?.unrealized ?? 0)}
                tone={(aggregates?.unrealized ?? 0) >= 0 ? 'pos' : 'neg'} />
        {account.brokerCash != null && <Metric label="Cash" value={money(account.brokerCash)} />}
        {account.brokerBuyingPower != null && <Metric label="Buying Power" value={money(account.brokerBuyingPower)} />}
        <Metric label="Margin Used" value={money(marginUsed)} tone={marginUsed > 0 ? 'neg' : undefined} />
        <Metric label="Invested"
                value={aggregates?.invested == null ? '—' : percent(aggregates.invested, { dp: 1 })} />
      </div>
    </section>
  )
}

function Metric({ label, value, tone }) {
  return (
    <div className={styles.metric}>
      <span className={styles.metricLabel}>{label}</span>
      <span className={`${styles.metricValue} ${tone === 'pos' ? styles.pos : tone === 'neg' ? styles.neg : ''}`}>
        {value}
      </span>
    </div>
  )
}
