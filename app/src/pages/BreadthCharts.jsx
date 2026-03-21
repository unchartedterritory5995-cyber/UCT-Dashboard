import { useState, useMemo } from 'react'
import useSWR from 'swr'
import ReactECharts from 'echarts-for-react'
import styles from './BreadthCharts.module.css'

const fetcher = url => fetch(url).then(r => r.json())

const CHART_GROUPS = [
  {
    group: 'Score',
    metrics: [
      { key: 'breadth_score', label: 'Health Score' },
      { key: 'uct_exposure',  label: 'UCT Exposure' },
    ],
  },
  {
    group: 'Primary Breadth',
    metrics: [
      { key: 'up_4pct_today',       label: 'Up 4%+' },
      { key: 'down_4pct_today',     label: 'Dn 4%+' },
      { key: 'ratio_5day',          label: '5D Ratio' },
      { key: 'ratio_10day',         label: '10D Ratio' },
      { key: 'up_25pct_quarter',    label: 'Up 25%/Qtr' },
      { key: 'down_25pct_quarter',  label: 'Dn 25%/Qtr' },
      { key: 'up_25pct_month',      label: 'Up 25%/Mo' },
      { key: 'down_25pct_month',    label: 'Dn 25%/Mo' },
      { key: 'up_50pct_month',      label: 'Up 50%/Mo' },
      { key: 'down_50pct_month',    label: 'Dn 50%/Mo' },
      { key: 'magna_up',            label: 'Up 13%/34d' },
      { key: 'magna_down',          label: 'Dn 13%/34d' },
      { key: 'universe_count',      label: 'Universe Count' },
    ],
  },
  {
    group: 'MA Breadth',
    metrics: [
      { key: 'pct_above_5sma',   label: '% Above 5SMA' },
      { key: 'pct_above_10sma',  label: '% Above 10SMA' },
      { key: 'pct_above_20ema',  label: '% Above 20EMA' },
      { key: 'pct_above_40sma',  label: '% Above 40SMA' },
      { key: 'pct_above_50sma',  label: '% Above 50SMA' },
      { key: 'pct_above_100sma', label: '% Above 100SMA' },
      { key: 'pct_above_200sma', label: '% Above 200SMA' },
    ],
  },
  {
    group: 'Regime',
    metrics: [
      { key: 'sp500_close',   label: 'S&P 500' },
      { key: 'qqq_close',     label: 'QQQ' },
      { key: 'vix',           label: 'VIX' },
      { key: 'mcclellan_osc', label: 'McClellan Osc' },
      { key: 'stage2_count',  label: 'Stage 2 Count' },
      { key: 'stage4_count',  label: 'Stage 4 Count' },
    ],
  },
  {
    group: 'Highs / Lows',
    metrics: [
      { key: 'new_52w_highs', label: '52W Highs' },
      { key: 'new_52w_lows',  label: '52W Lows' },
      { key: 'new_20d_highs', label: '20D Highs' },
      { key: 'new_20d_lows',  label: '20D Lows' },
      { key: 'new_ath',       label: 'ATH Count' },
    ],
  },
  {
    group: 'Sentiment',
    metrics: [
      { key: 'cnn_fear_greed', label: 'CNN Fear/Greed' },
      { key: 'aaii_bulls',     label: 'AAII Bulls' },
      { key: 'aaii_neutral',   label: 'AAII Neutral' },
      { key: 'aaii_bears',     label: 'AAII Bears' },
      { key: 'aaii_spread',    label: 'Bull-Bear Spread' },
      { key: 'naaim',          label: 'NAAIM' },
      { key: 'cboe_putcall',   label: 'CBOE P/C' },
    ],
  },
]

const ALL_METRICS = CHART_GROUPS.flatMap(g => g.metrics)
const LABEL_MAP = Object.fromEntries(ALL_METRICS.map(m => [m.key, m.label]))
const PRICE_KEYS = new Set(['sp500_close', 'qqq_close'])

const PALETTE = [
  '#60a5fa', '#34d399', '#f59e0b', '#f87171',
  '#a78bfa', '#fb923c', '#38bdf8', '#4ade80',
  '#e879f9', '#fbbf24',
]

function offsetDate(days) {
  const d = new Date()
  d.setDate(d.getDate() + days)
  return d.toISOString().slice(0, 10)
}

export default function BreadthCharts() {
  const { data, isLoading } = useSWR('/api/breadth-monitor?days=365', fetcher)

  const [selected, setSelected] = useState(['breadth_score', 'pct_above_50sma'])
  const [expanded, setExpanded] = useState({})
  const [fromDate, setFromDate] = useState(() => offsetDate(-90))
  const [toDate, setToDate]     = useState(() => offsetDate(0))

  const rows = useMemo(() => {
    if (!data?.rows) return []
    return data.rows
      .filter(r => r.date >= fromDate && r.date <= toDate)
      .sort((a, b) => a.date.localeCompare(b.date))
  }, [data, fromDate, toDate])

  function toggleMetric(key) {
    setSelected(prev =>
      prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key]
    )
  }

  function toggleGroup(group) {
    setExpanded(prev => ({ ...prev, [group]: !prev[group] }))
  }

  const option = useMemo(() => {
    const series = selected.map((key, i) => ({
      name: LABEL_MAP[key] ?? key,
      type: 'line',
      data: rows.map(r => [r.date, r[key] ?? null]),
      yAxisIndex: PRICE_KEYS.has(key) ? 1 : 0,
      symbol: 'none',
      lineStyle: { width: 2 },
      itemStyle: { color: PALETTE[i % PALETTE.length] },
      connectNulls: false,
    }))

    return {
      backgroundColor: 'transparent',
      textStyle: { color: '#e2e8f0' },
      legend: {
        top: 8,
        textStyle: { color: '#cbd5e1', fontSize: 12 },
        icon: 'circle',
        itemWidth: 8,
        itemHeight: 8,
      },
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'cross', crossStyle: { color: '#475569' } },
        backgroundColor: '#1e293b',
        borderColor: '#334155',
        textStyle: { color: '#e2e8f0', fontSize: 12 },
        formatter(params) {
          if (!params.length) return ''
          const date = params[0].axisValue
          const lines = params
            .filter(p => p.value[1] != null)
            .map(p => {
              const color = p.color
              const val = typeof p.value[1] === 'number'
                ? p.value[1] % 1 === 0 ? p.value[1] : p.value[1].toFixed(2)
                : p.value[1]
              return `<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${color};margin-right:6px"></span>${p.seriesName}: <b>${val}</b>`
            })
          return `<div style="font-size:11px;color:#94a3b8;margin-bottom:4px">${date}</div>` + lines.join('<br/>')
        },
      },
      grid: { left: 64, right: 64, top: 48, bottom: 56 },
      xAxis: {
        type: 'category',
        boundaryGap: false,
        axisLine: { lineStyle: { color: '#334155' } },
        axisTick: { lineStyle: { color: '#334155' } },
        axisLabel: {
          color: '#94a3b8',
          fontSize: 11,
          formatter: v => v.slice(5).replace('-', '/'),
        },
        splitLine: { show: false },
      },
      yAxis: [
        {
          type: 'value',
          axisLine: { lineStyle: { color: '#334155' } },
          axisTick: { show: false },
          axisLabel: { color: '#94a3b8', fontSize: 11 },
          splitLine: { lineStyle: { color: '#1e293b' } },
        },
        {
          type: 'value',
          axisLine: { lineStyle: { color: '#334155' } },
          axisTick: { show: false },
          axisLabel: { color: '#94a3b8', fontSize: 11 },
          splitLine: { show: false },
        },
      ],
      dataZoom: [
        { type: 'inside', zoomOnMouseWheel: true },
        {
          type: 'slider',
          bottom: 4,
          height: 22,
          fillerColor: 'rgba(96,165,250,0.10)',
          borderColor: '#334155',
          handleStyle: { color: '#60a5fa' },
          textStyle: { color: '#94a3b8' },
        },
      ],
      series,
    }
  }, [selected, rows])

  return (
    <div className={styles.container}>
      {/* ── Controls ─────────────────────────────────────────────────── */}
      <div className={styles.controls}>
        <div className={styles.metricPanel}>
          <div className={styles.groupRow}>
            {CHART_GROUPS.map(g => {
              const selectedInGroup = g.metrics.filter(m => selected.includes(m.key)).length
              return (
                <button
                  key={g.group}
                  className={`${styles.groupBtn} ${expanded[g.group] ? styles.groupBtnActive : ''}`}
                  onClick={() => toggleGroup(g.group)}
                >
                  {g.group}
                  {selectedInGroup > 0 && (
                    <span className={styles.badge}>{selectedInGroup}</span>
                  )}
                  <span className={styles.arrow}>{expanded[g.group] ? '▾' : '▸'}</span>
                </button>
              )
            })}
          </div>

          {CHART_GROUPS.map(g => expanded[g.group] && (
            <div key={g.group} className={styles.metricList}>
              {g.metrics.map(m => (
                <label key={m.key} className={styles.metricItem}>
                  <input
                    type="checkbox"
                    checked={selected.includes(m.key)}
                    onChange={() => toggleMetric(m.key)}
                  />
                  <span>{m.label}</span>
                </label>
              ))}
            </div>
          ))}
        </div>

        <div className={styles.dateRow}>
          <label className={styles.dateLabel}>
            From
            <input
              type="date"
              className={styles.dateInput}
              value={fromDate}
              max={toDate}
              onChange={e => setFromDate(e.target.value)}
            />
          </label>
          <label className={styles.dateLabel}>
            To
            <input
              type="date"
              className={styles.dateInput}
              value={toDate}
              min={fromDate}
              onChange={e => setToDate(e.target.value)}
            />
          </label>
          {rows.length > 0 && (
            <span className={styles.rowCount}>{rows.length} days</span>
          )}
        </div>
      </div>

      {/* ── Chart ────────────────────────────────────────────────────── */}
      <div className={styles.chartWrap}>
        {isLoading && <div className={styles.placeholder}>Loading data…</div>}
        {!isLoading && rows.length === 0 && (
          <div className={styles.placeholder}>No data in selected range.</div>
        )}
        {!isLoading && rows.length > 0 && selected.length === 0 && (
          <div className={styles.placeholder}>Select metrics above to plot.</div>
        )}
        {!isLoading && rows.length > 0 && selected.length > 0 && (
          <ReactECharts
            option={option}
            style={{ height: 680, width: '100%' }}
            notMerge
            lazyUpdate
          />
        )}
      </div>
    </div>
  )
}
