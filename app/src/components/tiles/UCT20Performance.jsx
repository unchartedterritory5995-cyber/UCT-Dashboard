// app/src/components/tiles/UCT20Performance.jsx
import { useState, useEffect, useRef, useMemo } from 'react'
import { createChart, LineSeries } from 'lightweight-charts'
import useMobileSWR from '../../hooks/useMobileSWR'
import { SkeletonChart } from '../Skeleton'
import styles from './UCT20Performance.module.css'

const fetcher = url => fetch(url).then(r => r.json())

const PERIODS = [
  { label: '7D',  days: 7   },
  { label: '1M',  days: 30  },
  { label: '3M',  days: 90  },
  { label: 'YTD', days: null },
  { label: 'ALL', days: 0   },
]

// Design tokens (must be raw values for LW Charts canvas)
const CHART_BG    = '#1a1c17'  // --bg-surface
const COLOR_GREEN = '#3cb868'  // --ut-green-bright
const COLOR_MUTED = '#706b5e'  // --text-muted
const COLOR_BORDER = '#2e3127' // --border

function ytdStart() {
  return `${new Date().getFullYear()}-01-01`
}

function filterByPeriod(curve, days) {
  if (!curve?.length) return []
  if (days === 0) return curve
  const cutoff = days === null
    ? ytdStart()
    : new Date(Date.now() - days * 86400000).toISOString().slice(0, 10)
  return curve.filter(pt => pt.date >= cutoff)
}

function buildChartData(equityCurve, qqqCurve, days) {
  const eq = filterByPeriod(equityCurve, days)
  if (!eq.length) return []

  const qqqMap = {}
  if (qqqCurve?.length) {
    for (const pt of qqqCurve) qqqMap[pt.date] = pt.pct
  }

  const firstVal = eq[0].value
  const qqqBase  = qqqMap[eq[0].date] ?? 0

  return eq.map(pt => {
    const uct20Pct = firstVal > 0 ? ((pt.value / firstVal) - 1) * 100 : 0
    const qqqRaw   = qqqMap[pt.date] ?? null
    const qqqAdj   = qqqRaw !== null ? qqqRaw - qqqBase : null
    return {
      date:  pt.date,
      uct20: parseFloat(uct20Pct.toFixed(2)),
      qqq:   qqqAdj !== null ? parseFloat(qqqAdj.toFixed(2)) : null,
    }
  })
}

function fmtPct(v, sign = true) {
  if (v == null) return '—'
  return `${sign && v >= 0 ? '+' : ''}${v.toFixed(1)}%`
}

function fmtDollar(v) {
  if (v == null) return '—'
  const abs = Math.abs(v)
  return `${v < 0 ? '-' : '+'}$${abs.toLocaleString('en-US', { maximumFractionDigits: 0 })}`
}

function StatBox({ label, value, className }) {
  return (
    <div className={styles.stat}>
      <span className={styles.statLabel}>{label}</span>
      <span className={`${styles.statVal} ${className ?? ''}`}>{value}</span>
    </div>
  )
}

// ── Lightweight Charts equity curve ──────────────────────────────────────────
function EquityChart({ chartData }) {
  const containerRef = useRef(null)
  const chartRef     = useRef(null)
  const uct20Ref     = useRef(null)
  const qqqRef       = useRef(null)
  const [crosshair, setCrosshair] = useState(null)

  // Create chart once on mount
  useEffect(() => {
    if (!containerRef.current) return
    const chart = createChart(containerRef.current, {
      autoSize: true,
      height: 180,
      layout: {
        background: { type: 'solid', color: CHART_BG },
        textColor: COLOR_MUTED,
        fontFamily: "'Instrument Sans', sans-serif",
        fontSize: 9,
      },
      grid: {
        vertLines: { visible: false },
        horzLines: { color: COLOR_BORDER, visible: true },
      },
      rightPriceScale: {
        borderVisible: false,
        minimumWidth: 38,
      },
      timeScale: {
        borderVisible: false,
        fixLeftEdge: true,
        fixRightEdge: true,
        tickMarkFormatter: (t) => (typeof t === 'string' ? t.slice(5) : String(t)),
      },
      crosshair: {
        mode: 1,
        vertLine: { width: 1, color: COLOR_MUTED, style: 3, labelVisible: false },
        horzLine: { visible: false, labelVisible: false },
      },
      handleScroll: false,
      handleScale: false,
    })
    chartRef.current = chart

    const priceFmt = {
      type: 'custom',
      formatter: (v) => `${v >= 0 ? '+' : ''}${v.toFixed(0)}%`,
      minMove: 0.01,
    }

    // QQQ — gray dashed, rendered behind
    const qqqSeries = chart.addSeries(LineSeries, {
      color: COLOR_MUTED,
      lineWidth: 1,
      lineStyle: 2,  // dashed
      priceLineVisible: false,
      lastValueVisible: false,
      priceFormat: priceFmt,
    })
    qqqRef.current = qqqSeries

    // UCT20 — green solid, on top
    const uct20Series = chart.addSeries(LineSeries, {
      color: COLOR_GREEN,
      lineWidth: 2,
      priceLineVisible: false,
      lastValueVisible: false,
      priceFormat: priceFmt,
    })
    uct20Ref.current = uct20Series

    // Zero reference line
    uct20Series.createPriceLine({
      price: 0,
      color: COLOR_BORDER,
      lineWidth: 1,
      lineStyle: 2,
      axisLabelVisible: false,
    })

    // Crosshair tooltip
    chart.subscribeCrosshairMove((param) => {
      if (!param.point || !param.time) { setCrosshair(null); return }
      const u = param.seriesData.get(uct20Series)
      const q = param.seriesData.get(qqqSeries)
      setCrosshair({
        date:  param.time,
        uct20: u?.value ?? null,
        qqq:   q?.value ?? null,
      })
    })

    return () => {
      chart.remove()
      chartRef.current = null
      uct20Ref.current = null
      qqqRef.current = null
    }
  }, [])

  // Update data when chartData changes
  useEffect(() => {
    if (!uct20Ref.current || !qqqRef.current || !chartData.length) return

    uct20Ref.current.setData(
      chartData.map(d => ({ time: d.date, value: d.uct20 }))
    )
    qqqRef.current.setData(
      chartData.filter(d => d.qqq !== null).map(d => ({ time: d.date, value: d.qqq }))
    )
    chartRef.current?.timeScale().fitContent()
  }, [chartData])

  return (
    <div style={{ position: 'relative' }}>
      <div ref={containerRef} />
      {crosshair && (
        <div className={styles.tooltip} style={{ position: 'absolute', top: 8, left: 8, pointerEvents: 'none', zIndex: 10 }}>
          <div className={styles.tooltipDate}>{crosshair.date}</div>
          <div className={styles.tooltipRow}>
            <span className={styles.tooltipDotGreen} />
            <span>UCT 20</span>
            <span className={crosshair.uct20 >= 0 ? styles.gain : styles.loss}>{fmtPct(crosshair.uct20)}</span>
          </div>
          {crosshair.qqq !== null && (
            <div className={styles.tooltipRow}>
              <span className={styles.tooltipDotGray} />
              <span>QQQ</span>
              <span className={crosshair.qqq >= 0 ? styles.gain : styles.loss}>{fmtPct(crosshair.qqq)}</span>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ── Main tile ─────────────────────────────────────────────────────────────────
/* ── The risk-managed Book lane ───────────────────────────────────────────
   The tracker this tile draws is the NO-STOPS arm. The Book is the same list
   traded with triggers and stops, built from the plans the wire published.

   It is deliberately allowed to say almost nothing. `stats_published` is
   decided in uct_intelligence, not here, and while it is false this renders
   PROGRESS ONLY -- no return, no expectancy. On 2026-08-20 the Book held two
   closed trades and an expectancy of -11.56%; rendering that beside a
   1,119-session backtest showing +2.44% would misinform far more effectively
   than showing nothing at all. */

function BookLane() {
  // useMobileSWR, like the rest of this file. The Book changes once a day,
  // so no market-hours polling.
  const { data } = useMobileSWR('/api/uct20/book', fetcher, { refreshInterval: 3600000 })
  if (!data || !data.kind) return null

  const recording = !data.stats_published
  const have = data.closed_trades_min_arm ?? 0
  const need = data.min_trades_for_stats ?? 0

  return (
    <div className={styles.bookLane}>
      <div className={styles.bookHead}>
        <span className={styles.bookTitle}>RISK-MANAGED BOOK</span>
        <span className={`${styles.bookBadge} ${recording ? styles.bookRecording : styles.bookLive}`}>
          {recording ? 'RECORDING' : 'LIVE'}
        </span>
      </div>

      {recording ? (
        <p className={styles.bookNote}>
          The same list traded with triggers and stops. Building its record —{' '}
          <strong>{data.sessions ?? 0}</strong> sessions,{' '}
          <strong>{have}</strong> of <strong>{need}</strong> closed trades before
          performance is reported. Until then the measured backtest below is the
          evidence, not this.
        </p>
      ) : (
        <div className={styles.bookStats}>
          <div className={styles.bookStat}>
            <span className={styles.bookStatLabel}>TOTAL RETURN</span>
            <span className={styles.bookStatVal}>
              {data.variant?.total_return_pct != null
                ? `${data.variant.total_return_pct >= 0 ? '+' : ''}${data.variant.total_return_pct.toFixed(2)}%`
                : '—'}
            </span>
          </div>
          <div className={styles.bookStat}>
            <span className={styles.bookStatLabel}>EXPECTANCY / TRADE</span>
            <span className={styles.bookStatVal}>
              {data.variant?.expectancy_pct != null
                ? `${data.variant.expectancy_pct >= 0 ? '+' : ''}${data.variant.expectancy_pct.toFixed(2)}%`
                : '—'}
            </span>
          </div>
          <div className={styles.bookStat}>
            <span className={styles.bookStatLabel}>CLOSED TRADES</span>
            <span className={styles.bookStatVal}>{data.variant?.trade_count ?? '—'}</span>
          </div>
          <div className={styles.bookStat}>
            <span className={styles.bookStatLabel}>SESSIONS</span>
            <span className={styles.bookStatVal}>{data.sessions ?? '—'}</span>
          </div>
        </div>
      )}
    </div>
  )
}

export default function UCT20Performance() {
  const { data, isLoading } = useMobileSWR('/api/uct20/portfolio', fetcher, { refreshInterval: 60000, marketHoursOnly: true })
  const [period, setPeriod]       = useState('ALL')
  const [tradesOpen, setTradesOpen] = useState(false)

  const periodDays = PERIODS.find(p => p.label === period)?.days ?? 0

  const chartData = useMemo(() => {
    if (!data?.equity_curve) return []
    return buildChartData(data.equity_curve, data.qqq_curve, periodDays)
  }, [data, periodDays])

  const uct20WindowPct = chartData.length >= 2 ? chartData[chartData.length - 1].uct20 : (data?.total_return_pct ?? null)
  const qqqWindowPct   = chartData.length >= 2 ? chartData[chartData.length - 1].qqq   : null
  const alpha          = data?.alpha_vs_qqq ?? (uct20WindowPct != null && qqqWindowPct != null ? uct20WindowPct - qqqWindowPct : null)

  const hasData = !!data && Object.keys(data).length > 0
  const trades  = data?.trades ?? []

  return (
    <div className={styles.wrap}>
      <div className={styles.sectionHeader}>
        <span className={styles.sectionTitle}>UCT 20 PORTFOLIO TRACKER</span>
        <span className={styles.sectionSub}>
          Simulated $50K equal-weight list-follower · buys/sells at market open · no stops
          {data?.tracking_since ? ` · tracking since ${data.tracking_since}` : ''}
          {data?.as_of ? ` · as of ${data.as_of}` : ''}
        </span>
      </div>
      <p className={styles.simNote}>
        Simulation, not a real account — it mechanically follows the published list at
        real market prices so the record is exactly what following the list would have
        produced. Tracking restarted Aug 27, 2026 for a clean record alongside the
        risk-managed Book, with the measured 4% stop ceiling and repaired price data
        live from day one.
      </p>

      <BookLane />

      {isLoading && <SkeletonChart height={200} />}
      {!isLoading && !hasData && (
        <p className={styles.loading}>No portfolio data yet — run the Morning Wire engine to populate.</p>
      )}

      {!isLoading && hasData && (
        <>
          {/* ── Performance header ── */}
          <div className={styles.perfHeader}>
            <div className={styles.perfStat}>
              <span className={styles.perfDotGreen} />
              <span className={styles.perfLabel}>Holdings</span>
              <span className={`${styles.perfPct} ${uct20WindowPct != null && uct20WindowPct >= 0 ? styles.gain : styles.loss}`}>
                {fmtPct(uct20WindowPct)}
              </span>
            </div>
            <div className={styles.perfStat}>
              <span className={styles.perfDotGray} />
              <span className={styles.perfLabel}>QQQ</span>
              <span className={`${styles.perfPct} ${qqqWindowPct != null && qqqWindowPct >= 0 ? styles.gain : styles.loss}`}>
                {fmtPct(qqqWindowPct)}
              </span>
            </div>
            {alpha != null && (
              <div className={styles.perfStat}>
                <span className={styles.perfLabel}>Alpha</span>
                <span className={`${styles.perfPct} ${styles.perfAlpha} ${alpha >= 0 ? styles.gain : styles.loss}`}>
                  {fmtPct(alpha)}
                </span>
              </div>
            )}
            <div className={styles.perfPeriods}>
              {PERIODS.map(p => (
                <button
                  key={p.label}
                  className={`${styles.periodBtn} ${period === p.label ? styles.periodActive : ''}`}
                  onClick={() => setPeriod(p.label)}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>

          {/* ── Chart ── */}
          {chartData.length >= 2 ? (
            <div className={styles.chartWrap}>
              <EquityChart chartData={chartData} />
            </div>
          ) : (
            <p className={styles.loading}>Not enough data points for selected period.</p>
          )}

          {/* ── Stats grid ── */}
          <div className={styles.statsGrid}>
            <StatBox label="CURRENT VALUE"
              value={`$${(data.current_value ?? 50000).toLocaleString('en-US', { maximumFractionDigits: 0 })}`} />
            <StatBox label="TOTAL P&L"
              value={fmtDollar(data.total_pnl)}
              className={(data.total_pnl ?? 0) >= 0 ? styles.gain : styles.loss} />
            <StatBox label="ALPHA vs QQQ"
              value={fmtPct(data.alpha_vs_qqq)}
              className={data.alpha_vs_qqq != null && data.alpha_vs_qqq >= 0 ? styles.gain : styles.loss} />
            <StatBox label="WIN RATE"       value={`${data.win_rate ?? '—'}%`} />
            <StatBox label="AVG WIN"
              value={fmtPct(data.avg_win_pct)}
              className={styles.gain} />
            <StatBox label="AVG LOSS"
              value={fmtPct(data.avg_loss_pct)}
              className={styles.loss} />
            <StatBox label="OPEN POSITIONS" value={`${data.open_count ?? 0} / 20`} />
            <StatBox label="AVG HOLD"       value={`${data.avg_hold_days ?? '—'}d`} />
          </div>

          {/* ── Open positions ── */}
          {data.open_positions?.length > 0 && (
            <div className={styles.openWrap}>
              <div className={styles.openHeader}>OPEN POSITIONS ({data.open_positions.length})</div>
              <div className={styles.openList}>
                {data.open_positions.map(pos => (
                  <div key={pos.symbol} className={styles.openRow}>
                    <span className={styles.openSym}>{pos.symbol}</span>
                    <span className={styles.openEntry}>${pos.entry_price}</span>
                    {pos.stop_price != null && (
                      <span className={styles.openStop}>stop ${pos.stop_price}</span>
                    )}
                    <span className={`${styles.openPct} ${pos.pct_return >= 0 ? styles.gain : styles.loss}`}>
                      {fmtPct(pos.pct_return)}
                    </span>
                    <span className={styles.openDays}>{pos.days_held}d</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ── Trades dropdown ── */}
          {trades.length > 0 && (
            <div className={styles.tradesWrap}>
              <button
                className={styles.tradesToggle}
                onClick={() => setTradesOpen(o => !o)}
              >
                <span>ALL TRADES ({trades.length})</span>
                <span className={styles.tradesChevron}>{tradesOpen ? '▾' : '▸'}</span>
              </button>

              {tradesOpen && (
                <div className={styles.tradesTableScroll}>
                  <div className={styles.tradesTable}>
                    <div className={styles.tradesHead}>
                      <span>SYM</span>
                      <span>ENTRY</span>
                      <span>EXIT</span>
                      <span className={styles.alignRight}>ENTRY $</span>
                      <span className={styles.alignRight}>EXIT $</span>
                      <span className={styles.alignRight}>RETURN</span>
                      <span className={styles.alignRight}>DAYS</span>
                    </div>
                    {trades.map((t, i) => (
                      <div key={i} className={`${styles.tradesRow} ${t.win ? styles.tradeWin : styles.tradeLoss}`}>
                        <span className={styles.tradeSym}>{t.symbol}</span>
                        <span>{t.entry_date?.slice(5)}</span>
                        <span>{t.exit_date?.slice(5)}</span>
                        <span className={styles.alignRight}>${t.entry_price}</span>
                        <span className={styles.alignRight}>${t.exit_price}</span>
                        <span className={`${styles.alignRight} ${t.win ? styles.gain : styles.loss}`}>
                          {fmtPct(t.pct_return)}
                        </span>
                        <span className={styles.alignRight}>{t.days_held}d</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  )
}
