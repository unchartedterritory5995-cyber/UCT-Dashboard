/**
 * Analytics tab — single-scroll page with 4 sections (Equity / Performance /
 * Distribution / Attribution) covering ~14 charts via ECharts.
 *
 * Filtered by the global Scope (P3 §6): the URL-backed `useScope` supplies a
 * snake_case FilterSpec (`apiParams`) — account + date range + symbol/side/
 * setup/tag — that `useJ2Analytics` sends to `GET /api/j2/analytics`. The old
 * local Range pill row (afrom/ato) was replaced by `<ScopeBar>` in A10; the
 * date-range presets now live in the ScopeBar's date facet. Live unrealized
 * equity toggle (J2.0-unique) lands in Phase 3 / Step 7.
 */

import { useMemo, useState } from 'react'
import ReactECharts from 'echarts-for-react'
import { CHART_FONT_FAMILY } from '../../../utils/chartFont'
import useJ2Analytics from '../hooks/useJ2Analytics'
import useJ2Positions from '../hooks/useJ2Positions'
import useJ2SelectedAccount from '../hooks/useJ2SelectedAccount'
import useScope from '../hooks/useScope'
import PerformancePanel from '../components/PerformancePanel'
import CollapsibleSection from '../components/CollapsibleSection'
import ScopeBar from '../components/scope/ScopeBar'
import RiskExitsSection from '../components/analytics/RiskExitsSection'
import InsightsHub from '../components/insights/InsightsHub'
import useRealtimePrices from '../../../hooks/useRealtimePrices'
import {
  fmtSignedDollar,
  fmtSignedPct,
  fmtSignedR,
  todayET,
} from '../lib/calendar'
import { money } from '../../../lib/journal-2-0'
import styles from './AnalyticsTab.module.css'

// ── Theme tokens for ECharts ─────────────────────────────────────────────────

const CHART_COLORS = {
  gain: '#3cb868',
  loss: '#e74c3c',
  gold: '#c9a84c',
  text: '#a8a290',
  textBright: '#e0dac8',
  border: '#2e3127',
  bg: '#1a1c17',
}

const baseChart = {
  backgroundColor: 'transparent',
  textStyle: {
    fontFamily: CHART_FONT_FAMILY,
    color: CHART_COLORS.text,
  },
  grid: { left: 50, right: 18, top: 20, bottom: 30, containLabel: true },
  tooltip: {
    backgroundColor: '#22251e',
    borderColor: CHART_COLORS.border,
    textStyle: { color: CHART_COLORS.textBright },
    confine: true,
  },
}

const moneyAxis = {
  type: 'value',
  axisLine: { lineStyle: { color: CHART_COLORS.border } },
  splitLine: { lineStyle: { color: CHART_COLORS.border, type: 'dashed' } },
  axisLabel: {
    color: CHART_COLORS.text,
    formatter: (v) => `$${Math.round(v).toLocaleString()}`,
  },
}

const categoryAxis = {
  type: 'category',
  axisLine: { lineStyle: { color: CHART_COLORS.border } },
  axisLabel: { color: CHART_COLORS.text },
}

// ── AnalyticsTab ─────────────────────────────────────────────────────────────

export default function AnalyticsTab() {
  const { accountId, account } = useJ2SelectedAccount()
  // Analytics honors the FULL global Scope — date range + symbol/side/setup/tag.
  // `apiParams` is the snake_case FilterSpec the fetch layer sends verbatim; the
  // date-range presets that used to live in a local pill row now live in the
  // ScopeBar's date facet (unified `from`/`to`), replacing the old afrom/ato.
  const { apiParams } = useScope()

  const { data, isLoading, error } = useJ2Analytics(apiParams)

  return (
    <div className={styles.wrap}>
      <div className={styles.header}>
        <div>
          <h2 className={styles.title}>Analytics</h2>
          <p className={styles.subtitle}>
            Detailed performance analysis
            {data && ` across ${data.tradeCount} trade${data.tradeCount === 1 ? '' : 's'}`}
          </p>
        </div>
      </div>

      <ScopeBar surface="analytics" />

      {account?.balanceSource === 'broker' && accountId && (
        <div className={styles.section}>
          <h3 className={styles.sectionHeader}>Account Balance</h3>
          <p className={styles.sectionCaption}>
            Real net-liquidation value — cash plus open positions marked to market.
          </p>
          <PerformancePanel accountId={accountId} account={account} />
        </div>
      )}

      {error && (
        <div className={styles.errorBanner} role="alert">
          Couldn't load analytics: {String(error.message || error)}
        </div>
      )}

      {isLoading && !data && (
        <p className={styles.hint}>Loading analytics…</p>
      )}

      {data && data.tradeCount === 0 && (data.strategyCount ?? 0) === 0 && (
        <div className={styles.empty}>
          <p>No trades or option strategies in this range.</p>
          <p className={styles.emptyHint}>
            Try expanding the date range or switching accounts.
          </p>
        </div>
      )}

      {data && data.tradeCount > 0 && (
        <>
          {/* Insights hub — the organized entry (Playbook · Exit Quality · Edge
              · Psychology · Regime). The classic accordion stays below under
              "More analytics" so nothing is lost. */}
          <InsightsHub analytics={data} />

          <div className={styles.moreDivider}>
            <h3 className={styles.moreHeading}>More analytics</h3>
          </div>

          {data.edgeScore && (
            <CollapsibleSection id="edge" title="Edge Score" defaultOpen>
              <EdgeScorecard edge={data.edgeScore} />
            </CollapsibleSection>
          )}
          <CollapsibleSection id="equity" title="Closed-Trade Equity" defaultOpen>
            <EquitySection equity={data.equity} />
          </CollapsibleSection>
          <CollapsibleSection id="performance" title="Performance">
            <PerformanceSection performance={data.performance} />
          </CollapsibleSection>
          <CollapsibleSection id="distribution" title="Distribution">
            <DistributionSection distribution={data.distribution} />
          </CollapsibleSection>
          <CollapsibleSection id="attribution" title="Attribution">
            <AttributionSection attribution={data.attribution} />
          </CollapsibleSection>
          {data.exitQuality && (
            <CollapsibleSection id="riskExits" title="Risk & Exits">
              <RiskExitsSection data={data.exitQuality} />
            </CollapsibleSection>
          )}
        </>
      )}
      {data && (data.strategyCount ?? 0) > 0 && data.options && (
        <CollapsibleSection
          id="options"
          title="Options Breakdown"
          meta={
            `${data.options.headline.count} strateg` +
            `${data.options.headline.count === 1 ? 'y' : 'ies'} · ` +
            `${fmtSignedDollar(data.options.headline.totalPnl)} P&L` +
            (data.options.headline.winRate != null
              ? ` · ${(data.options.headline.winRate * 100).toFixed(0)}% win`
              : '')
          }
        >
          <OptionsSection options={data.options} />
        </CollapsibleSection>
      )}
      {data && data.tradeCount === 0 && data.equity?.curve?.length > 0 && (
        // Shouldn't happen but guard — keep blank
        null
      )}
    </div>
  )
}

// ── Edge Scorecard (J2-unique) ───────────────────────────────────────────────

function EdgeScorecard({ edge }) {
  const trendOption = useMemo(() => {
    const t = edge.trend || []
    return {
      ...baseChart,
      grid: { ...baseChart.grid, top: 10, bottom: 18, left: 30, right: 10 },
      tooltip: {
        ...baseChart.tooltip, trigger: 'axis',
        formatter: (params) => `Trade #${t[params[0].dataIndex].tradeIndex}: ${params[0].value.toFixed(3)}`,
      },
      xAxis: { type: 'category', show: false, data: t.map((d) => d.tradeIndex), boundaryGap: false },
      yAxis: { type: 'value', show: false, min: 0 },
      series: [{
        type: 'line', data: t.map((d) => d.score), symbol: 'none', smooth: true,
        lineStyle: { color: CHART_COLORS.gold, width: 2 },
        areaStyle: { color: 'rgba(201, 168, 76, 0.15)' },
      }],
    }
  }, [edge])

  const score = edge.score
  const c = edge.components || {}

  return (
    <section className={styles.edgeSection}>
      <div className={styles.edgeRow}>
        <div className={styles.edgeMain}>
          {score == null ? (
            <>
              <span className={styles.edgeValueDim}>—</span>
              <span className={styles.edgeNeed}>
                Need 10+ trades with R-multiples to compute
              </span>
            </>
          ) : (
            <>
              <span className={styles.edgeValue}>{score.toFixed(3)}</span>
              <span className={styles.edgeFormula}>
                = Win × PF × R-consistency
              </span>
            </>
          )}
        </div>
        {c.winRate != null && (
          <div className={styles.edgeBreakdown}>
            <Component label="Win Rate" value={`${(c.winRate * 100).toFixed(1)}%`} />
            <Component label="Profit Factor" value={c.profitFactor === 5 ? '5.0+' : c.profitFactor.toFixed(2)} />
            <Component label="R Consistency" value={c.rConsistency != null ? `${(c.rConsistency * 100).toFixed(0)}%` : '—'} />
            <Component label="Trades" value={c.tradeCount} />
          </div>
        )}
        {edge.trend && edge.trend.length > 0 && (
          <div className={styles.edgeTrend}>
            <span className={styles.trendLabel}>Trend (rolling-30)</span>
            <ReactECharts option={trendOption} style={{ height: 50, width: 180 }} />
          </div>
        )}
      </div>
    </section>
  )
}

function Component({ label, value }) {
  return (
    <div className={styles.edgeComp}>
      <span className={styles.edgeCompLabel}>{label}</span>
      <span className={styles.edgeCompValue}>{value}</span>
    </div>
  )
}

// ── Section 1: Equity ────────────────────────────────────────────────────────

function EquitySection({ equity }) {
  const { kpis, curve } = equity
  const [showDD, setShowDD] = useState(false)
  const [showLive, setShowLive] = useState(false)
  const { accountId } = useJ2SelectedAccount()
  const { positions } = useJ2Positions()

  // Open positions live prices
  const symbols = useMemo(
    () => (showLive ? positions.map((p) => p.symbol) : []),
    [positions, showLive],
  )
  const { prices } = useRealtimePrices(symbols)

  // Unrealized P&L from currently open positions (single account only)
  const liveUnrealized = useMemo(() => {
    if (!showLive || accountId == null) return null
    if (!positions.length) return 0
    let total = 0
    for (const p of positions) {
      const cur = prices[p.symbol]?.price
      if (cur == null || !Number.isFinite(cur)) continue
      const delta = (cur - p.entryPrice) * p.shares
      total += p.side === 'Short' ? -delta : delta
    }
    return total
  }, [showLive, positions, prices, accountId])

  const option = useMemo(() => {
    const dates = curve.map((d) => d.date)
    const equitySeries = curve.map((d) => d.equity)
    const ddSeries = curve.map((d) => d.drawdown)

    // Append "now" dashed point when live toggle is on
    let liveSeries = null
    if (showLive && liveUnrealized != null && curve.length > 0) {
      const lastEq = curve[curve.length - 1].equity
      const liveEq = lastEq + liveUnrealized
      const today = todayET()
      dates.push(today)
      // build a parallel series with null for all prior indices + the live point
      liveSeries = new Array(equitySeries.length).fill(null)
      liveSeries.push(liveEq)
      equitySeries.push(null)  // don't draw solid through "now"
      ddSeries.push(null)
    }
    return {
      ...baseChart,
      tooltip: {
        ...baseChart.tooltip,
        trigger: 'axis',
        formatter: (params) => {
          const eq = params.find((p) => p.seriesName === 'Equity')
          const dd = params.find((p) => p.seriesName === 'Drawdown')
          return `<div><b>${eq?.axisValue}</b><br/>` +
            `Equity: $${(eq?.value ?? 0).toLocaleString()}<br/>` +
            (showDD ? `Drawdown: $${(dd?.value ?? 0).toLocaleString()}` : '') +
            `</div>`
        },
      },
      xAxis: { ...categoryAxis, data: dates, boundaryGap: false },
      yAxis: showDD
        ? [moneyAxis, { ...moneyAxis, name: 'DD', position: 'right', axisLabel: { ...moneyAxis.axisLabel, color: CHART_COLORS.loss } }]
        : moneyAxis,
      series: [
        {
          name: 'Equity',
          type: 'line',
          data: equitySeries,
          smooth: true,
          symbol: 'circle',
          symbolSize: 4,
          itemStyle: { color: CHART_COLORS.gain },
          areaStyle: {
            color: {
              type: 'linear', x: 0, y: 0, x2: 0, y2: 1,
              colorStops: [
                { offset: 0, color: 'rgba(60, 184, 104, 0.3)' },
                { offset: 1, color: 'rgba(60, 184, 104, 0)' },
              ],
            },
          },
        },
        ...(showDD ? [{
          name: 'Drawdown', type: 'line', data: ddSeries, yAxisIndex: 1,
          symbol: 'none',
          itemStyle: { color: CHART_COLORS.loss },
          areaStyle: {
            color: {
              type: 'linear', x: 0, y: 0, x2: 0, y2: 1,
              colorStops: [
                { offset: 0, color: 'rgba(231, 76, 60, 0)' },
                { offset: 1, color: 'rgba(231, 76, 60, 0.3)' },
              ],
            },
          },
        }] : []),
        ...(liveSeries ? [{
          name: 'Live (unrealized)',
          type: 'line',
          data: liveSeries,
          connectNulls: true,
          symbol: 'circle',
          symbolSize: 7,
          lineStyle: { color: CHART_COLORS.gold, type: 'dashed' },
          itemStyle: { color: CHART_COLORS.gold },
        }] : []),
      ],
    }
  }, [curve, showDD, showLive, liveUnrealized])

  return (
    <div className={styles.section}>
      <p className={styles.sectionCaption}>
        Running balance from realized P&amp;L only — excludes open-position mark-to-market.
      </p>
      <div className={styles.kpiStrip}>
        <Kpi label="Peak P&L" value={fmtSignedDollar(kpis.peakPnl)} positive={kpis.peakPnl > 0} />
        <Kpi label="Max Drawdown" value={fmtSignedDollar(kpis.maxDrawdown)} negative={kpis.maxDrawdown < 0} />
        <Kpi label="Max DD %" value={fmtSignedPct(kpis.maxDrawdownPct, 2)} negative={kpis.maxDrawdownPct < 0} />
        <Kpi label="Current DD" value={fmtSignedDollar(kpis.currentDrawdown)} negative={kpis.currentDrawdown < 0} />
        <Kpi label="Longest Underwater" value={`${kpis.longestUnderwaterDays}d`} />
      </div>
      <div className={styles.chartCard}>
        <div className={styles.chartHeader}>
          <h4 className={styles.chartTitle}>Closed-Trade Equity Curve</h4>
          <div className={styles.toggleGroup}>
            <button
              type="button"
              className={`${styles.toggle} ${showDD ? styles.toggleOn : ''}`}
              onClick={() => setShowDD((x) => !x)}
            >
              Drawdown overlay
            </button>
            <button
              type="button"
              className={`${styles.toggle} ${showLive ? styles.toggleOn : ''}`}
              onClick={() => setShowLive((x) => !x)}
              disabled={accountId == null}
              title={accountId == null ? 'Select a single account to show live unrealized' : ''}
            >
              Live unrealized
            </button>
          </div>
        </div>
        {showLive && accountId != null && liveUnrealized != null && (
          <p className={styles.liveHint}>
            Live unrealized: <strong className={liveUnrealized >= 0 ? styles.pos : styles.neg}>
              {fmtSignedDollar(liveUnrealized)}
            </strong> from {positions.length} open position{positions.length === 1 ? '' : 's'}
          </p>
        )}
        <ReactECharts option={option} style={{ height: 280 }} />
      </div>
    </div>
  )
}

// ── Section 2: Performance ───────────────────────────────────────────────────

function PerformanceSection({ performance }) {
  const [granularity, setGranularity] = useState('byMonth')

  const histOption = useMemo(() => {
    const series = performance[granularity] || []
    const labels = series.map((d) => {
      if (granularity === 'byDay') return d.date.slice(5)  // MM-DD
      if (granularity === 'byWeek') return d.weekStart.slice(5)
      if (granularity === 'byMonth') return d.month
      return String(d.year)
    })
    const values = series.map((d) => d.pnl)
    return {
      ...baseChart,
      tooltip: { ...baseChart.tooltip, trigger: 'axis' },
      xAxis: { ...categoryAxis, data: labels },
      yAxis: moneyAxis,
      series: [{
        type: 'bar',
        data: values.map((v) => ({
          value: v, itemStyle: { color: v >= 0 ? CHART_COLORS.gain : CHART_COLORS.loss },
        })),
      }],
    }
  }, [performance, granularity])

  const hourlyOption = useMemo(() => {
    const data = performance.hourly || []
    return {
      ...baseChart,
      tooltip: { ...baseChart.tooltip, trigger: 'axis' },
      xAxis: { ...categoryAxis, data: data.map((h) => `${h.hour}:00`) },
      yAxis: moneyAxis,
      series: [{
        type: 'bar',
        data: data.map((h) => ({
          value: h.pnl,
          itemStyle: { color: h.pnl >= 0 ? CHART_COLORS.gain : CHART_COLORS.loss },
        })),
      }],
    }
  }, [performance])

  const dowOption = useMemo(() => {
    const data = performance.dayOfWeek || []
    return {
      ...baseChart,
      tooltip: { ...baseChart.tooltip, trigger: 'axis' },
      xAxis: { ...categoryAxis, data: data.map((d) => `${d.day} (${d.tradeCount})`) },
      yAxis: moneyAxis,
      series: [{
        type: 'bar',
        data: data.map((d) => ({
          value: d.pnl,
          itemStyle: { color: d.pnl >= 0 ? CHART_COLORS.gain : CHART_COLORS.loss },
        })),
      }],
    }
  }, [performance])

  return (
    <div className={styles.section}>
      <div className={styles.grid2}>
        <div className={styles.chartCard}>
          <div className={styles.chartHeader}>
            <h4 className={styles.chartTitle}>P&L Histogram</h4>
            <div className={styles.miniPills}>
              {[
                ['byDay', 'D'], ['byWeek', 'W'],
                ['byMonth', 'M'], ['byYear', 'Y'],
              ].map(([k, lbl]) => (
                <button
                  key={k}
                  type="button"
                  className={`${styles.miniPill} ${granularity === k ? styles.miniPillActive : ''}`}
                  onClick={() => setGranularity(k)}
                >{lbl}</button>
              ))}
            </div>
          </div>
          <ReactECharts option={histOption} style={{ height: 220 }} />
        </div>
        <div className={styles.chartCard}>
          <h4 className={styles.chartTitle}>Hourly Performance (ET)</h4>
          <ReactECharts option={hourlyOption} style={{ height: 220 }} />
        </div>
        <div className={styles.chartCard}>
          <h4 className={styles.chartTitle}>Day of Week</h4>
          <ReactECharts option={dowOption} style={{ height: 220 }} />
        </div>
      </div>
    </div>
  )
}

// ── Section 3: Distribution ──────────────────────────────────────────────────

function DistributionSection({ distribution }) {
  const longShortOption = useMemo(() => {
    const ls = distribution.longVsShort
    return {
      ...baseChart,
      tooltip: { ...baseChart.tooltip, trigger: 'axis' },
      legend: { textStyle: { color: CHART_COLORS.text }, top: 0 },
      xAxis: { ...categoryAxis, data: ['Total P&L', 'Win Rate %', 'Avg P&L', 'Trades'] },
      yAxis: moneyAxis,
      series: [
        {
          name: 'Long', type: 'bar',
          itemStyle: { color: CHART_COLORS.gain },
          data: [
            ls.long.totalPnl,
            (ls.long.winRate ?? 0) * 100,
            ls.long.avgPnl ?? 0,
            ls.long.tradeCount,
          ],
        },
        {
          name: 'Short', type: 'bar',
          itemStyle: { color: CHART_COLORS.loss },
          data: [
            ls.short.totalPnl,
            (ls.short.winRate ?? 0) * 100,
            ls.short.avgPnl ?? 0,
            ls.short.tradeCount,
          ],
        },
      ],
    }
  }, [distribution])

  const pnlDistOption = useMemo(() => {
    const buckets = distribution.pnlBuckets || []
    return {
      ...baseChart,
      tooltip: { ...baseChart.tooltip, trigger: 'axis' },
      xAxis: { ...categoryAxis, data: buckets.map((b) => b.bucket), axisLabel: { ...categoryAxis.axisLabel, rotate: 30, fontSize: 9 } },
      yAxis: { ...moneyAxis, axisLabel: { ...moneyAxis.axisLabel, formatter: (v) => v } },
      series: [{
        type: 'bar',
        data: buckets.map((b, i) => ({
          value: b.count,
          itemStyle: { color: i < buckets.length / 2 ? CHART_COLORS.loss : CHART_COLORS.gain },
        })),
      }],
    }
  }, [distribution])

  const rDistOption = useMemo(() => {
    const buckets = distribution.rMultiples || []
    return {
      ...baseChart,
      tooltip: { ...baseChart.tooltip, trigger: 'axis' },
      xAxis: { ...categoryAxis, data: buckets.map((b) => b.bucket) },
      yAxis: { ...moneyAxis, axisLabel: { ...moneyAxis.axisLabel, formatter: (v) => v } },
      series: [{
        type: 'bar',
        data: buckets.map((b, i) => ({
          value: b.count,
          itemStyle: { color: i < 3 ? CHART_COLORS.loss : (i === 3 ? CHART_COLORS.text : CHART_COLORS.gain) },
        })),
      }],
    }
  }, [distribution])

  const streaksOption = useMemo(() => {
    const streaks = distribution.winLossStreaks || []
    return {
      ...baseChart,
      tooltip: {
        ...baseChart.tooltip,
        trigger: 'axis',
        formatter: (params) => {
          const p = params[0]
          const streak = streaks[p.dataIndex]
          return `Streak #${streak.index}: ${streak.length} ${streak.type}${streak.length === 1 ? '' : 's'}`
        },
      },
      xAxis: { ...categoryAxis, data: streaks.map((s) => `#${s.index}`) },
      yAxis: { ...moneyAxis, axisLabel: { ...moneyAxis.axisLabel, formatter: (v) => v } },
      series: [{
        type: 'bar',
        data: streaks.map((s) => ({
          value: s.length,
          itemStyle: { color: s.type === 'win' ? CHART_COLORS.gain : CHART_COLORS.loss },
        })),
      }],
    }
  }, [distribution])

  return (
    <div className={styles.section}>
      <div className={styles.grid2}>
        <div className={styles.chartCard}>
          <h4 className={styles.chartTitle}>Long vs Short</h4>
          <ReactECharts option={longShortOption} style={{ height: 240 }} />
        </div>
        <div className={styles.chartCard}>
          <h4 className={styles.chartTitle}>P&L Distribution</h4>
          <ReactECharts option={pnlDistOption} style={{ height: 240 }} />
        </div>
        <div className={styles.chartCard}>
          <h4 className={styles.chartTitle}>R-Multiple Distribution</h4>
          <ReactECharts option={rDistOption} style={{ height: 220 }} />
        </div>
        <div className={styles.chartCard}>
          <h4 className={styles.chartTitle}>Win/Loss Streaks</h4>
          {streaksOption.series[0].data.length > 0 ? (
            <ReactECharts option={streaksOption} style={{ height: 220 }} />
          ) : (
            <p className={styles.hint}>Not enough data for streak analysis.</p>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Section 4: Attribution ───────────────────────────────────────────────────

function AttributionSection({ attribution }) {
  const [setupSort, setSetupSort] = useState('totalPnl')
  const [symbolSort, setSymbolSort] = useState('totalPnl')
  const [rwrWindow, setRwrWindow] = useState('20')

  const setupSorted = useMemo(() => {
    return [...(attribution.bySetup || [])].sort((a, b) => {
      if (setupSort === 'tradeCount') return b.tradeCount - a.tradeCount
      if (setupSort === 'winRate') return (b.winRate || 0) - (a.winRate || 0)
      return b.totalPnl - a.totalPnl
    })
  }, [attribution, setupSort])

  const symbolSorted = useMemo(() => {
    return [...(attribution.bySymbol || [])].sort((a, b) => {
      if (symbolSort === 'tradeCount') return b.tradeCount - a.tradeCount
      if (symbolSort === 'winRate') return (b.winRate || 0) - (a.winRate || 0)
      return b.totalPnl - a.totalPnl
    })
  }, [attribution, symbolSort])

  const setupOption = useMemo(() => barChart(setupSorted, 'setup', setupSort), [setupSorted, setupSort])
  const symbolOption = useMemo(() => barChart(symbolSorted, 'symbol', symbolSort), [symbolSorted, symbolSort])

  const rwrOption = useMemo(() => {
    const data = attribution.rollingWinRate?.windows?.[rwrWindow] || []
    return {
      ...baseChart,
      tooltip: { ...baseChart.tooltip, trigger: 'axis' },
      xAxis: { ...categoryAxis, data: data.map((d) => `#${d.tradeIndex}`), boundaryGap: false },
      yAxis: { ...moneyAxis, min: 0, max: 1, axisLabel: { ...moneyAxis.axisLabel, formatter: (v) => `${(v * 100).toFixed(0)}%` } },
      series: [{
        name: 'Win rate', type: 'line', data: data.map((d) => d.winRate),
        symbol: 'none', smooth: true, itemStyle: { color: CHART_COLORS.gold },
      }],
    }
  }, [attribution, rwrWindow])

  return (
    <div className={styles.section}>
      <div className={styles.grid2}>
        <div className={styles.chartCard}>
          <div className={styles.chartHeader}>
            <h4 className={styles.chartTitle}>P&L by Setup</h4>
            <SortPills active={setupSort} onChange={setSetupSort} />
          </div>
          {setupSorted.length === 0 ? (
            <p className={styles.hint}>Tag your trades with a setup to see attribution.</p>
          ) : (
            <ReactECharts option={setupOption} style={{ height: 240 }} />
          )}
        </div>
        <div className={styles.chartCard}>
          <div className={styles.chartHeader}>
            <h4 className={styles.chartTitle}>P&L by Symbol</h4>
            <SortPills active={symbolSort} onChange={setSymbolSort} />
          </div>
          <ReactECharts option={symbolOption} style={{ height: 240 }} />
        </div>
        <div className={`${styles.chartCard} ${styles.full}`}>
          <div className={styles.chartHeader}>
            <h4 className={styles.chartTitle}>Rolling Win Rate</h4>
            <div className={styles.miniPills}>
              {['10', '20', '50', '100', '200'].map((w) => (
                <button
                  key={w}
                  type="button"
                  className={`${styles.miniPill} ${rwrWindow === w ? styles.miniPillActive : ''}`}
                  onClick={() => setRwrWindow(w)}
                >{w}</button>
              ))}
            </div>
          </div>
          {(attribution.rollingWinRate?.windows?.[rwrWindow] || []).length === 0 ? (
            <p className={styles.hint}>
              Need at least {rwrWindow} trades in range. Try a smaller window.
            </p>
          ) : (
            <ReactECharts option={rwrOption} style={{ height: 240 }} />
          )}
        </div>
      </div>
      <SymbolMiniCards symbols={symbolSorted} />
    </div>
  )
}

function barChart(items, labelKey, sortKey) {
  const labels = items.map((x) => x[labelKey])
  const sortedKey = sortKey === 'totalPnl' ? 'totalPnl' : (sortKey === 'tradeCount' ? 'tradeCount' : 'winRate')
  const data = items.map((x) => sortedKey === 'winRate' ? (x.winRate ?? 0) * 100 : x[sortedKey])
  return {
    ...baseChart,
    grid: { ...baseChart.grid, left: 80 },
    tooltip: {
      ...baseChart.tooltip,
      trigger: 'axis',
      formatter: (params) => {
        const p = params[0]
        const item = items[p.dataIndex]
        return `<b>${item[labelKey]}</b><br/>` +
          `P&L: ${fmtSignedDollar(item.totalPnl)}<br/>` +
          `Trades: ${item.tradeCount}<br/>` +
          (item.winRate != null ? `Win rate: ${(item.winRate * 100).toFixed(1)}%<br/>` : '') +
          (item.avgR != null ? `Avg R: ${item.avgR.toFixed(2)}` : '')
      },
    },
    yAxis: { ...categoryAxis, data: labels.slice().reverse() },  // top-to-bottom
    xAxis: sortedKey === 'totalPnl'
      ? moneyAxis
      : { ...moneyAxis, axisLabel: { ...moneyAxis.axisLabel, formatter: (v) => sortedKey === 'winRate' ? `${v}%` : v } },
    series: [{
      type: 'bar',
      data: data.slice().reverse().map((v) => ({
        value: v,
        itemStyle: { color: v >= 0 ? CHART_COLORS.gain : CHART_COLORS.loss },
      })),
    }],
  }
}

function SortPills({ active, onChange }) {
  return (
    <div className={styles.miniPills}>
      {[['totalPnl', 'P&L'], ['tradeCount', 'Count'], ['winRate', 'Win%']].map(([k, lbl]) => (
        <button
          key={k}
          type="button"
          className={`${styles.miniPill} ${active === k ? styles.miniPillActive : ''}`}
          onClick={() => onChange(k)}
        >{lbl}</button>
      ))}
    </div>
  )
}

function SymbolMiniCards({ symbols }) {
  if (!symbols || symbols.length === 0) return null
  return (
    <div className={styles.symbolGrid}>
      {symbols.slice(0, 12).map((s) => (
        <div key={s.symbol} className={styles.symbolCard}>
          <div className={styles.symbolHead}>
            <span className={styles.symbolSym}>{s.symbol}</span>
            <span className={styles.symbolCount}>{s.tradeCount} trade{s.tradeCount === 1 ? '' : 's'}</span>
          </div>
          <div className={`${styles.symbolPnl} ${s.totalPnl >= 0 ? styles.pos : styles.neg}`}>
            {fmtSignedDollar(s.totalPnl)}
          </div>
          <div className={styles.symbolMeta}>
            Win rate: {s.winRate != null ? `${(s.winRate * 100).toFixed(0)}%` : '—'}
          </div>
        </div>
      ))}
    </div>
  )
}

// ── Shared ────────────────────────────────────────────────────────────────────

function Kpi({ label, value, positive, negative }) {
  return (
    <div className={styles.kpi}>
      <span className={styles.kpiLabel}>{label}</span>
      <span className={`${styles.kpiValue} ${positive ? styles.pos : ''} ${negative ? styles.neg : ''}`}>
        {value}
      </span>
    </div>
  )
}

// ── Section 5: Options breakdown (Phase 5 Step 6) ─────────────────────────

function OptionsSection({ options }) {
  const { byAssetType, byStrategyType, creditVsDebit, dteScatter } = options
  const byAssetOption = useMemo(() => ({
    ...baseChart,
    tooltip: { ...baseChart.tooltip, trigger: 'axis', axisPointer: { type: 'shadow' } },
    grid: { ...baseChart.grid, bottom: 45 },
    xAxis: { ...categoryAxis, data: ['Equity', 'Options'] },
    yAxis: moneyAxis,
    series: [{
      type: 'bar',
      data: [byAssetType.equity.totalPnl || 0, byAssetType.options.totalPnl || 0].map((v) => ({
        value: v,
        itemStyle: { color: v >= 0 ? CHART_COLORS.gain : CHART_COLORS.loss },
      })),
      label: {
        show: true, position: 'top', color: CHART_COLORS.textBright,
        formatter: (p) => fmtSignedDollar(p.value),
      },
      barWidth: '45%',
    }],
  }), [byAssetType])

  const byStrategyOption = useMemo(() => {
    if (!byStrategyType || byStrategyType.length === 0) return null
    const labels = byStrategyType.map((e) => prettyType(e.strategyType))
    const values = byStrategyType.map((e) => e.totalPnl)
    return {
      ...baseChart,
      grid: { ...baseChart.grid, left: 140 },
      tooltip: {
        ...baseChart.tooltip,
        trigger: 'axis',
        axisPointer: { type: 'shadow' },
        formatter: (p) => {
          const e = byStrategyType[p[0].dataIndex]
          return `<strong>${prettyType(e.strategyType)}</strong><br/>
                  Count: ${e.count}<br/>
                  P&L: ${fmtSignedDollar(e.totalPnl)}<br/>
                  Win Rate: ${e.winRate == null ? '—' : `${(e.winRate*100).toFixed(0)}%`}<br/>
                  Avg R: ${e.avgR == null ? '—' : e.avgR.toFixed(2) + 'R'}`
        },
      },
      xAxis: moneyAxis,
      yAxis: { ...categoryAxis, data: labels, axisLabel: { color: CHART_COLORS.text } },
      series: [{
        type: 'bar',
        data: values.map((v) => ({
          value: v,
          itemStyle: { color: v >= 0 ? CHART_COLORS.gain : CHART_COLORS.loss },
        })),
        label: {
          show: true, position: 'right', color: CHART_COLORS.textBright,
          formatter: (p) => fmtSignedDollar(p.value),
        },
        barWidth: '55%',
      }],
    }
  }, [byStrategyType])

  const creditVsDebitOption = useMemo(() => {
    const cr = creditVsDebit.credit
    const de = creditVsDebit.debit
    if (cr.count === 0 && de.count === 0) return null
    return {
      ...baseChart,
      tooltip: { ...baseChart.tooltip, trigger: 'item' },
      legend: {
        data: ['Credit', 'Debit'],
        textStyle: { color: CHART_COLORS.text },
        bottom: 0,
      },
      grid: { ...baseChart.grid, bottom: 45 },
      series: [{
        type: 'pie',
        radius: ['40%', '70%'],
        center: ['50%', '45%'],
        data: [
          {
            value: Math.abs(cr.totalPnl),
            name: 'Credit',
            itemStyle: { color: cr.totalPnl >= 0 ? CHART_COLORS.gain : CHART_COLORS.loss },
          },
          {
            value: Math.abs(de.totalPnl),
            name: 'Debit',
            itemStyle: { color: de.totalPnl >= 0 ? CHART_COLORS.gain : CHART_COLORS.loss },
          },
        ],
        label: {
          color: CHART_COLORS.textBright,
          formatter: (p) => {
            const data = p.name === 'Credit' ? cr : de
            return `${p.name}\n${fmtSignedDollar(data.totalPnl)}\n(${data.count})`
          },
        },
      }],
    }
  }, [creditVsDebit])

  const dteScatterOption = useMemo(() => {
    if (!dteScatter || dteScatter.length === 0) return null
    return {
      ...baseChart,
      tooltip: {
        ...baseChart.tooltip,
        trigger: 'item',
        formatter: (p) => {
          const d = p.data
          return `<strong>${d[3]} ${prettyType(d[4])}</strong><br/>
                  Days held: ${d[0]}<br/>
                  R-Multiple: ${fmtSignedR(d[1])}<br/>
                  P&L: ${fmtSignedDollar(d[2])}`
        },
      },
      xAxis: {
        type: 'value',
        name: 'Days Held',
        nameLocation: 'middle',
        nameGap: 25,
        nameTextStyle: { color: CHART_COLORS.text, fontSize: 11 },
        axisLine: { lineStyle: { color: CHART_COLORS.border } },
        splitLine: { lineStyle: { color: CHART_COLORS.border, type: 'dashed' } },
        axisLabel: { color: CHART_COLORS.text },
      },
      yAxis: {
        type: 'value',
        name: 'R-Multiple',
        nameLocation: 'middle',
        nameGap: 36,
        nameTextStyle: { color: CHART_COLORS.text, fontSize: 11 },
        axisLine: { lineStyle: { color: CHART_COLORS.border } },
        splitLine: { lineStyle: { color: CHART_COLORS.border, type: 'dashed' } },
        axisLabel: { color: CHART_COLORS.text, formatter: (v) => `${v}R` },
      },
      series: [{
        type: 'scatter',
        symbolSize: (p) => Math.min(30, 6 + Math.sqrt(Math.abs(p[2]) / 10)),
        data: dteScatter.map((s) => [
          s.daysHeld,
          s.rMultiple,
          s.pnlDollar,
          s.underlying,
          s.strategyType,
        ]),
        itemStyle: {
          color: (p) => (p.data[1] >= 0 ? CHART_COLORS.gain : CHART_COLORS.loss),
          opacity: 0.7,
        },
      }],
      grid: { ...baseChart.grid, left: 60, bottom: 50 },
    }
  }, [dteScatter])

  return (
    <div className={styles.section}>
      <div className={styles.chartGrid}>
        <ChartCard title="Equity vs Options">
          <ReactECharts option={byAssetOption} style={{ height: 260, width: '100%' }} />
        </ChartCard>

        {byStrategyOption && (
          <ChartCard title="P&L by Strategy Type">
            <ReactECharts option={byStrategyOption} style={{ height: Math.max(180, byStrategyType.length * 30 + 60), width: '100%' }} />
          </ChartCard>
        )}

        {creditVsDebitOption && (
          <ChartCard title="Credit vs Debit Structures">
            <ReactECharts option={creditVsDebitOption} style={{ height: 260, width: '100%' }} />
          </ChartCard>
        )}

        {dteScatterOption && (
          <ChartCard title="Days Held vs R-Multiple">
            <ReactECharts option={dteScatterOption} style={{ height: 280, width: '100%' }} />
          </ChartCard>
        )}
      </div>
    </div>
  )
}

function ChartCard({ title, children }) {
  return (
    <div className={styles.chartCard}>
      <div className={styles.chartTitle}>{title}</div>
      {children}
    </div>
  )
}

function prettyType(t) {
  const map = {
    long_call: 'Long Call',
    long_put: 'Long Put',
    short_call: 'Short Call',
    short_put: 'Short Put',
    vertical_debit_call: 'Call Debit Spread',
    vertical_credit_call: 'Call Credit Spread',
    vertical_debit_put: 'Put Debit Spread',
    vertical_credit_put: 'Put Credit Spread',
    calendar: 'Calendar',
    diagonal: 'Diagonal',
    straddle: 'Straddle',
    strangle: 'Strangle',
    iron_condor: 'Iron Condor',
    iron_butterfly: 'Iron Butterfly',
    call_butterfly: 'Call Butterfly',
    put_butterfly: 'Put Butterfly',
    custom: 'Custom',
  }
  return map[t] || t
}
