import { useState, useMemo, useEffect, useCallback, useRef } from 'react'
import useSWR from 'swr'
import ReactECharts from 'echarts-for-react'
import styles from './Breadth.module.css'
import CotData from './CotData'
import BreadthCharts from './BreadthCharts'
import { useTileCapture } from '../hooks/useTileCapture'
import TickerPopup from '../components/TickerPopup'

const fetcher = url => fetch(url).then(r => r.json())

function exportCsv(rows, cols) {
  const headers = ['date', ...cols.map(c => c.key)]
  const lines = [
    headers.join(','),
    ...rows.map(row =>
      headers.map(h => {
        const v = row[h]
        if (v === null || v === undefined) return ''
        if (typeof v === 'string' && v.includes(',')) return `"${v}"`
        return v
      }).join(',')
    )
  ]
  const blob = new Blob([lines.join('\n')], { type: 'text/csv' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `breadth-monitor-${new Date().toISOString().slice(0, 10)}.csv`
  a.click()
  URL.revokeObjectURL(url)
}

function Sparkline({ values, color = 'var(--text-muted)', width = 50, height = 18 }) {
  const vals = values.filter(v => v != null)
  if (vals.length < 2) return null
  const min = Math.min(...vals)
  const max = Math.max(...vals)
  const range = max - min || 1
  const pts = vals.map((v, i) => {
    const x = (i / (vals.length - 1)) * width
    const y = height - ((v - min) / range) * (height - 2) - 1
    return `${x},${y}`
  })
  return (
    <svg width={width} height={height} className={styles.sparkline}>
      <polyline
        points={pts.join(' ')}
        fill="none"
        stroke={color}
        strokeWidth="1.5"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  )
}

// ── Column definitions ────────────────────────────────────────────────────────
// Each entry: { key, label, group, fmt?, colorFn? }
// colorFn(val) → 'green' | 'red' | 'amber' | ''

const G = {
  SCORE:     'Score',
  REGIME:    'Regime',
  PRIMARY:   'Primary Breadth',
  MA:        'MA Breadth',
  HIGHS:     'Highs / Lows',
  SETUPS:    'Setups',
  VOLUME:    'Volume / A-D',
  SENTIMENT: 'Sentiment',
}

function pctColor(low, mid, high) {
  const vHigh = Math.round((high + 100) / 2)
  const vLow  = Math.round(low / 2)
  const vMid  = Math.round((low + mid) / 2)
  return v => {
    if (v == null) return ''
    if (v >= vHigh) return 'g3'
    if (v >= high)  return 'g2'
    if (v >= mid)   return 'g1'
    if (v >= vMid)  return 'a'
    if (v >= low)   return 'r1'
    if (v >= vLow)  return 'r2'
    return 'r3'
  }
}

// Paired up/down coloring: color family is set by whichever side is dominant.
// upRatio = up/(up+dn). ≥0.5 = bull wins → both green. <0.5 = bear wins → both red.
// The winning side escalates (g1→g3 or r1→r3); the losing side stays at the mildest shade.
function pairedUpColor(u, d) {
  if (u == null || d == null || u + d === 0) return ''
  const r = u / (u + d)
  if (r >= 0.70) return 'g3'
  if (r >= 0.60) return 'g2'
  if (r >= 0.50) return 'g1'
  return 'r1'  // bear wins; up is minority → lightest red
}
function pairedDnColor(u, d) {
  if (u == null || d == null || u + d === 0) return ''
  const r = u / (u + d)
  if (r <= 0.30) return 'r3'
  if (r <= 0.40) return 'r2'
  if (r < 0.50)  return 'r1'
  return 'g1'  // bull wins; dn is minority → lightest green
}

const COLS = [
  // ── Score ─────────────────────────────────────────────────────────────────
  { key: 'breadth_score', label: 'Health', group: G.SCORE,
    fmt: v => fmtDec(v, 0),
    colorFn: v => v == null ? '' : v >= 80 ? 'g3' : v >= 65 ? 'g2' : v >= 52 ? 'g1' : v >= 45 ? 'a' : v >= 35 ? 'r1' : v >= 20 ? 'r2' : 'r3' },
  { key: 'uct_exposure', label: 'UCT Exp', group: G.SCORE, fmt: v => fmtDec(v, 0),
    colorFn: v => v == null ? '' : v >= 80 ? 'g3' : v >= 65 ? 'g2' : v >= 50 ? 'g1' : v >= 35 ? 'a' : v >= 20 ? 'r1' : v >= 10 ? 'r2' : 'r3' },

  // ── Primary Breadth ───────────────────────────────────────────────────────
  { key: 'up_4pct_today', label: 'Up 4%+', group: G.PRIMARY,
    rowColorFn: row => pairedUpColor(row.up_4pct_today, row.down_4pct_today),
    drillKey: 'up_4pct_today_list' },
  { key: 'down_4pct_today', label: 'Dn 4%+', group: G.PRIMARY,
    rowColorFn: row => pairedDnColor(row.up_4pct_today, row.down_4pct_today),
    drillKey: 'down_4pct_today_list' },
  { key: 'ratio_5day', label: '5D Ratio', group: G.PRIMARY, fmt: v => fmtDec(v, 2),
    colorFn: v => v == null ? '' : v >= 2.0 ? 'g3' : v >= 1.5 ? 'g2' : v > 0.6 ? '' : v > 0.5 ? 'r1' : v > 0.4 ? 'r2' : 'r3' },
  { key: 'ratio_10day', label: '10D Ratio', group: G.PRIMARY, fmt: v => fmtDec(v, 2),
    colorFn: v => v == null ? '' : v >= 2.0 ? 'g3' : v >= 1.5 ? 'g2' : v > 0.6 ? '' : v > 0.5 ? 'r1' : v > 0.4 ? 'r2' : 'r3' },
  { key: 'up_25pct_quarter', label: 'Up25%/Qtr', group: G.PRIMARY,
    rowColorFn: row => pairedUpColor(row.up_25pct_quarter, row.down_25pct_quarter),
    drillKey: 'up_25pct_quarter_list' },
  { key: 'down_25pct_quarter', label: 'Dn25%/Qtr', group: G.PRIMARY,
    rowColorFn: row => pairedDnColor(row.up_25pct_quarter, row.down_25pct_quarter),
    drillKey: 'down_25pct_quarter_list' },
  { key: 'up_25pct_month', label: 'Up25%/Mo', group: G.PRIMARY,
    rowColorFn: row => pairedUpColor(row.up_25pct_month, row.down_25pct_month),
    drillKey: 'up_25pct_month_list' },
  { key: 'down_25pct_month', label: 'Dn25%/Mo', group: G.PRIMARY,
    rowColorFn: row => pairedDnColor(row.up_25pct_month, row.down_25pct_month),
    drillKey: 'down_25pct_month_list' },
  { key: 'up_50pct_month', label: 'Up50%/Mo', group: G.PRIMARY,
    rowColorFn: row => pairedUpColor(row.up_50pct_month, row.down_50pct_month),
    drillKey: 'up_50pct_month_list' },
  { key: 'down_50pct_month', label: 'Dn50%/Mo', group: G.PRIMARY,
    rowColorFn: row => pairedDnColor(row.up_50pct_month, row.down_50pct_month),
    drillKey: 'down_50pct_month_list' },
  { key: 'magna_up', label: 'Up13%/34d', group: G.PRIMARY,
    rowColorFn: row => pairedUpColor(row.magna_up, row.magna_down),
    drillKey: 'magna_up_list' },
  { key: 'magna_down', label: 'Dn13%/34d', group: G.PRIMARY,
    rowColorFn: row => pairedDnColor(row.magna_up, row.magna_down),
    drillKey: 'magna_down_list' },
  { key: 'universe_count', label: 'Universe', group: G.PRIMARY,
    drillKey: 'universe_list' },
  { key: 'is_ftd', label: 'FTD', group: G.PRIMARY,
    fmt: v => v ? 'FTD' : '—',
    colorFn: v => v ? 'g2' : '' },

  // ── MA Breadth ────────────────────────────────────────────────────────────
  { key: 'spy_ma_stack', label: 'SPY MA', subLabels: '10  20  50  200', group: G.MA, type: 'ma_stack',
    keys: ['spy_above_10sma', 'spy_above_20sma', 'spy_above_50sma', 'spy_above_200sma'],
    maLabels: ['10', '20', '50', '200'] },
  { key: 'qqq_ma_stack', label: 'QQQ MA', subLabels: '10  20  50  200', group: G.MA, type: 'ma_stack',
    keys: ['qqq_above_10sma', 'qqq_above_20sma', 'qqq_above_50sma', 'qqq_above_200sma'],
    maLabels: ['10', '20', '50', '200'] },
  { key: 'pct_above_5sma',   label: '>5SMA',    group: G.MA, fmt: fmtPct,
    colorFn: pctColor(30, 50, 65) },
  { key: 'pct_above_10sma',  label: '>10SMA',   group: G.MA, fmt: fmtPct,
    colorFn: pctColor(30, 50, 65) },
  { key: 'pct_above_20ema',  label: '>20EMA',   group: G.MA, fmt: fmtPct,
    colorFn: pctColor(35, 50, 65) },
  { key: 'pct_above_40sma',  label: '>40SMA',   group: G.MA, fmt: fmtPct,
    colorFn: pctColor(35, 50, 65) },
  { key: 'pct_above_50sma',  label: '>50SMA',   group: G.MA, fmt: fmtPct,
    colorFn: pctColor(35, 50, 65) },
  { key: 'pct_above_100sma', label: '>100SMA',  group: G.MA, fmt: fmtPct,
    colorFn: pctColor(35, 50, 65) },
  { key: 'pct_above_200sma', label: '>200SMA',  group: G.MA, fmt: fmtPct,
    colorFn: pctColor(30, 45, 60) },

  // ── Regime ────────────────────────────────────────────────────────────────
  { key: 'sp500_close', label: 'S&P 500', group: G.REGIME, fmt: fmtPrice,
    rowColorFn: row => { const p = row.spy_day_pct; return p == null ? '' : p >= 1.5 ? 'g3' : p >= 0.5 ? 'g2' : p > 0 ? 'g1' : p <= -1.5 ? 'r3' : p <= -0.5 ? 'r2' : 'r1' } },
  { key: 'qqq_close', label: 'QQQ', group: G.REGIME, fmt: fmtPrice,
    rowColorFn: row => { const p = row.qqq_day_pct; return p == null ? '' : p >= 1.5 ? 'g3' : p >= 0.5 ? 'g2' : p > 0 ? 'g1' : p <= -1.5 ? 'r3' : p <= -0.5 ? 'r2' : 'r1' } },
  { key: 'vix', label: 'VIX', group: G.REGIME, fmt: v => fmtDec(v, 2),
    colorFn: v => v == null ? '' : v < 14 ? 'g3' : v < 18 ? 'g2' : v < 20 ? 'g1' : v < 22 ? 'a' : v < 25 ? 'r1' : v < 30 ? 'r2' : 'r3' },
  { key: 'mcclellan_osc', label: 'McClellan', group: G.REGIME, fmt: v => fmtDec(v, 1),
    colorFn: v => v == null ? '' : v > 200 ? 'a' : v > 80 ? 'g3' : v > 20 ? 'g2' : v > 0 ? 'g1' : v > -20 ? 'r1' : v > -80 ? 'r2' : v > -200 ? 'r3' : 'a' },
  { key: 'stage2_count', label: 'Stage 2', group: G.REGIME,
    rowColorFn: row => pairedUpColor(row.stage2_count, row.stage4_count),
    drillKey: 'stage2_list' },
  { key: 'stage4_count', label: 'Stage 4', group: G.REGIME,
    rowColorFn: row => pairedDnColor(row.stage2_count, row.stage4_count),
    drillKey: 'stage4_list' },

  // ── Highs / Lows ──────────────────────────────────────────────────────────
  { key: 'new_52w_highs', label: '52W Hi', group: G.HIGHS,
    rowColorFn: row => pairedUpColor(row.new_52w_highs, row.new_52w_lows),
    drillKey: 'new_52w_highs_list' },
  { key: 'new_52w_lows', label: '52W Lo', group: G.HIGHS,
    rowColorFn: row => pairedDnColor(row.new_52w_highs, row.new_52w_lows),
    drillKey: 'new_52w_lows_list' },
  { key: 'new_20d_highs', label: '20D Hi', group: G.HIGHS,
    rowColorFn: row => pairedUpColor(row.new_20d_highs, row.new_20d_lows),
    drillKey: 'new_20d_highs_list' },
  { key: 'new_20d_lows', label: '20D Lo', group: G.HIGHS,
    rowColorFn: row => pairedDnColor(row.new_20d_highs, row.new_20d_lows),
    drillKey: 'new_20d_lows_list' },
  { key: 'new_ath', label: 'ATH', group: G.HIGHS,
    colorFn: v => v == null ? '' : v > 200 ? 'g3' : v > 100 ? 'g2' : v > 40 ? 'g1' : '',
    drillKey: 'new_ath_list' },

  // ── Sentiment ─────────────────────────────────────────────────────────────
  { key: 'cnn_fear_greed', label: 'CNN F/G', group: G.SENTIMENT, fmt: v => fmtDec(v, 0),
    colorFn: v => v == null ? '' : v <= 15 ? 'g3' : v <= 25 ? 'g2' : v <= 40 ? 'g1' : v <= 60 ? 'a' : v <= 70 ? 'r1' : v <= 80 ? 'r2' : 'r3' },
  { key: 'aaii_bulls',    label: 'AAII Bulls', group: G.SENTIMENT, fmt: v => fmtDec(v, 1) },
  { key: 'aaii_neutral',  label: 'Neutral',    group: G.SENTIMENT, fmt: v => fmtDec(v, 1) },
  { key: 'aaii_bears',    label: 'AAII Bears', group: G.SENTIMENT, fmt: v => fmtDec(v, 1) },
  { key: 'aaii_spread', label: 'B-B Sprd', group: G.SENTIMENT, fmt: v => fmtDec(v, 1) },
  { key: 'naaim', label: 'NAAIM', group: G.SENTIMENT, fmt: v => fmtDec(v, 2) },
  { key: 'cboe_putcall', label: 'CBOE P/C', group: G.SENTIMENT, fmt: v => fmtDec(v, 2) },
]

// ── Group spans ────────────────────────────────────────────────────────────
function buildGroupSpans(cols) {
  const spans = []
  let cur = null
  for (const c of cols) {
    if (cur && cur.group === c.group) {
      cur.span++
    } else {
      cur = { group: c.group, span: 1 }
      spans.push(cur)
    }
  }
  return spans
}

const GROUP_SPANS = buildGroupSpans(COLS)

// ── Heatmap column set (curated — most color-meaningful metrics) ───────────
const HEATMAP_COL_KEYS = new Set([
  'breadth_score', 'uct_exposure',
  'up_4pct_today', 'down_4pct_today', 'ratio_5day', 'ratio_10day',
  'up_25pct_quarter', 'down_25pct_quarter', 'magna_up', 'magna_down',
  'spy_ma_stack', 'qqq_ma_stack',
  'pct_above_20ema', 'pct_above_50sma', 'pct_above_200sma',
  'sp500_close', 'qqq_close', 'vix', 'mcclellan_osc', 'stage2_count', 'stage4_count',
  'new_52w_highs', 'new_52w_lows', 'new_20d_highs', 'new_20d_lows', 'new_ath',
  'cnn_fear_greed', 'aaii_spread', 'cboe_putcall',
])
const HEATMAP_COLS = COLS.filter(c => HEATMAP_COL_KEYS.has(c.key))
const HEATMAP_GROUP_SPANS = buildGroupSpans(HEATMAP_COLS)

function getMaStackTier(col, row) {
  const above10  = row[col.keys[0]] === 1
  const above20  = row[col.keys[1]] === 1
  const above50  = row[col.keys[2]] === 1
  const above200 = row[col.keys[3]] === 1
  const hasData  = col.keys.some(k => row[k] != null)
  if (!hasData) return ''
  if (above50) {
    if (above10 && above20 && above200) return 'g3'
    if (above200 && (above10 || above20)) return 'g2'
    if (above200) return 'g1'
    return 'a'
  } else {
    if (above200) return 'r1'
    if (above10 || above20) return 'r2'
    return 'r3'
  }
}

function getCellTier(col, row) {
  if (col.type === 'ma_stack') return getMaStackTier(col, row)
  const val = row[col.key]
  if (col.rowColorFn) return col.rowColorFn(row)
  if (col.colorFn && val != null) return col.colorFn(val)
  return ''
}

function tierToClass(tier, s) {
  if (tier === 'g3') return s.bgG3
  if (tier === 'g2') return s.bgG2
  if (tier === 'g1') return s.bgG1
  if (tier === 'a')  return s.bgA
  if (tier === 'r1') return s.bgR1
  if (tier === 'r2') return s.bgR2
  if (tier === 'r3') return s.bgR3
  return s.hmEmpty
}

function fmtTooltipVal(col, row) {
  if (col.type === 'ma_stack') {
    return col.keys.map((k, i) => `${col.maLabels[i]}:${row[k] === 1 ? '✓' : row[k] === 0 ? '✗' : '—'}`).join('  ')
  }
  return fmtCell(col, row[col.key])
}

// ── Formatters ─────────────────────────────────────────────────────────────
function fmtDec(v, d = 1) {
  if (v === null || v === undefined) return '—'
  return Number(v).toFixed(d)
}
function fmtPct(v) {
  if (v === null || v === undefined) return '—'
  return Number(v).toFixed(1)
}
function fmtPrice(v) {
  if (v === null || v === undefined) return '—'
  return Number(v).toLocaleString('en-US', { maximumFractionDigits: 2 })
}
function fmtBool(v) {
  if (v === null || v === undefined) return '—'
  return v === 1 ? '✓' : '✗'
}
function fmtInt(v) {
  if (v === null || v === undefined) return '—'
  return Number(v).toLocaleString('en-US')
}

function fmtCell(col, val) {
  if (col.fmt) return col.fmt(val)
  if (val === null || val === undefined) return '—'
  if (Number.isInteger(val)) return fmtInt(val)
  return String(val)
}

function cellClass(col, val, row = null) {
  let c = ''
  if (col.rowColorFn && row) {
    c = col.rowColorFn(row)
  } else if (col.colorFn && val != null) {
    c = col.colorFn(val)
  }
  if (c === 'g3') return styles.bgG3
  if (c === 'g2') return styles.bgG2
  if (c === 'g1') return styles.bgG1
  if (c === 'a')  return styles.bgA
  if (c === 'r1') return styles.bgR1
  if (c === 'r2') return styles.bgR2
  if (c === 'r3') return styles.bgR3
  return ''
}

const GROUP_HEADER_CLASS = {
  [G.SCORE]:     styles.ghScore,
  [G.REGIME]:    styles.ghRegime,
  [G.PRIMARY]:   styles.ghPrimary,
  [G.MA]:        styles.ghMA,
  [G.HIGHS]:     styles.ghHighs,
  [G.SETUPS]:    styles.ghSetups,
  [G.VOLUME]:    styles.ghVolume,
  [G.SENTIMENT]: styles.ghSentiment,
}

// ── CopyTickersButton ─────────────────────────────────────────────────────
function CopyTickersButton({ items }) {
  const [copied, setCopied] = useState(false)
  function handleCopy() {
    const text = (items ?? []).map(i => i.t).join(',')
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }
  return (
    <button className={styles.copyBtn} onClick={handleCopy} title="Copy all tickers to clipboard">
      {copied ? '✓ Copied' : 'Copy List'}
    </button>
  )
}

// ── TvChart ── TradingView tv.js widget with 9/20 EMA + 50/200 SMA ────────
let tvScriptLoaded = false

// Suppress async errors thrown by TradingView's internals when its iframe is
// removed from the DOM mid-load (e.g. rapid arrow-key navigation).
function suppressTvError(e) {
  const src = (e.filename || '') + (e.message || '')
  if (src.includes('tradingview') || src.includes('tv.js')) { e.preventDefault(); return true }
}
function suppressTvRejection(e) {
  const msg = String(e.reason || e.message || '')
  if (msg.includes('tradingview') || msg.includes('Cannot read')) e.preventDefault()
}

function TvChart({ sym }) {
  const containerRef = useRef(null)

  useEffect(() => {
    if (!sym || !containerRef.current) return
    const container = containerRef.current
    let cancelled = false

    window.addEventListener('error', suppressTvError)
    window.addEventListener('unhandledrejection', suppressTvRejection)

    function initWidget() {
      if (cancelled || !container) return
      try {
        container.innerHTML = ''
        const divId = `tv_${Math.random().toString(36).slice(2)}`
        const div = document.createElement('div')
        div.id = divId
        div.style.cssText = 'width:100%;height:100%'
        container.appendChild(div)

        const w = new window.TradingView.widget({
          autosize: true,
          symbol: sym,
          interval: 'D',
          timezone: 'America/New_York',
          theme: 'dark',
          style: '1',
          locale: 'en',
          toolbar_bg: '#0e0e0e',
          enable_publishing: false,
          hide_side_toolbar: true,
          allow_symbol_change: true,
          container_id: divId,
        })

        w.onChartReady(() => {
          if (cancelled) return
          try {
            const chart = w.chart()
            chart.createStudy('Moving Average Exponential', false, false, [9],   { 'Plot.color': '#4ade80', 'Plot.linewidth': 1 })
            chart.createStudy('Moving Average Exponential', false, false, [20],  { 'Plot.color': '#f472b6', 'Plot.linewidth': 1 })
            chart.createStudy('Moving Average',             false, false, [50],  { 'Plot.color': '#60a5fa', 'Plot.linewidth': 1 })
            chart.createStudy('Moving Average',             false, false, [200], { 'Plot.color': '#fb923c', 'Plot.linewidth': 1 })
          } catch (_) {}
        })
      } catch (_) {}
    }

    if (window.TradingView) {
      initWidget()
    } else if (!tvScriptLoaded) {
      tvScriptLoaded = true
      const script = document.createElement('script')
      script.src = 'https://s3.tradingview.com/tv.js'
      script.async = true
      script.onload = () => { if (!cancelled) initWidget() }
      document.head.appendChild(script)
    } else {
      const poll = setInterval(() => {
        if (window.TradingView) { clearInterval(poll); if (!cancelled) initWidget() }
      }, 100)
      return () => {
        cancelled = true
        clearInterval(poll)
        window.removeEventListener('error', suppressTvError)
        window.removeEventListener('unhandledrejection', suppressTvRejection)
      }
    }

    return () => {
      cancelled = true
      window.removeEventListener('error', suppressTvError)
      window.removeEventListener('unhandledrejection', suppressTvRejection)
    }
  }, [sym])

  return <div ref={containerRef} style={{ width: '100%', height: '100%' }} />
}

// ── DrillModal ────────────────────────────────────────────────────────────
function DrillModal({ drill, onClose }) {
  const items = drill.items ?? []
  const [selectedIdx, setSelectedIdx] = useState(0)
  const rowRefs = useRef([])

  // Keyboard: Escape closes, arrows navigate
  useEffect(() => {
    const handler = e => {
      if (e.key === 'Escape') { onClose(); return }
      if (e.key === 'ArrowDown') { e.preventDefault(); setSelectedIdx(i => Math.min(i + 1, items.length - 1)) }
      if (e.key === 'ArrowUp')   { e.preventDefault(); setSelectedIdx(i => Math.max(i - 1, 0)) }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose, items.length])

  // Scroll selected row into view
  useEffect(() => {
    rowRefs.current[selectedIdx]?.scrollIntoView({ block: 'nearest' })
  }, [selectedIdx])

  const selected = items[selectedIdx]

  return (
    <div className={styles.drillOverlay} onClick={onClose} role="dialog" aria-modal="true">
      <div className={styles.drillDialog} onClick={e => e.stopPropagation()}>
        <div className={styles.drillHeader}>
          <div>
            <div className={styles.drillTitle}>
              {drill.label}
              {drill.items && <span className={styles.drillCount}> ({drill.items.length.toLocaleString()} stocks)</span>}
            </div>
            <div className={styles.drillSubRow}>
              <span className={styles.drillSub}>{drill.date}</span>
              <CopyTickersButton items={items} />
            </div>
          </div>
          <button className={styles.drillClose} onClick={onClose} aria-label="Close">✕</button>
        </div>

        <div className={styles.drillSplit}>
          {/* ── Left: table ── */}
          <div className={styles.drillTablePanel}>
            {!drill.items ? (
              <div className={styles.drillLoading}>Loading…</div>
            ) : items.length === 0 ? (
              <div className={styles.drillEmpty}>No stocks matched this filter on {drill.date}.</div>
            ) : (
              <table className={styles.drillTable}>
                <thead>
                  <tr>
                    <th className={`${styles.drillTh} ${styles.drillThNum}`}>#</th>
                    <th className={styles.drillTh}>Ticker</th>
                    <th className={styles.drillTh}>Company</th>
                    <th className={`${styles.drillTh} ${styles.drillThRight}`}>Price</th>
                    <th className={`${styles.drillTh} ${styles.drillThRight}`}>Vol</th>
                    <th className={`${styles.drillTh} ${styles.drillThRight}`}>ATR%</th>
                    <th className={`${styles.drillTh} ${styles.drillThRight}`}>50SMA</th>
                    <th className={`${styles.drillTh} ${styles.drillThRight}`}>Change</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item, i) => {
                    const absPct = Math.abs(item.pct)
                    const rowHeat = item.pct >= 0
                      ? absPct >= 15 ? styles.drillHeatG3 : absPct >= 8 ? styles.drillHeatG2 : styles.drillHeatG1
                      : absPct >= 15 ? styles.drillHeatR3 : absPct >= 8 ? styles.drillHeatR2 : styles.drillHeatR1
                    const isSelected = i === selectedIdx
                    return (
                      <tr
                        key={item.t}
                        ref={el => rowRefs.current[i] = el}
                        className={`${i % 2 === 0 ? styles.drillRowEven : styles.drillRowOdd} ${rowHeat} ${isSelected ? styles.drillRowSelected : ''}`}
                        onClick={() => setSelectedIdx(i)}
                      >
                        <td className={styles.drillTdNum}>{i + 1}</td>
                        <td className={styles.drillTdTicker}>
                          <TickerPopup sym={item.t} />
                        </td>
                        <td className={styles.drillTdName}>{item.n ?? ''}</td>
                        <td className={styles.drillTdPrice}>
                          {item.c != null ? `$${item.c.toFixed(2)}` : '—'}
                        </td>
                        <td className={item.vr >= 2 ? styles.drillTdVolHigh : item.vr >= 1.2 ? styles.drillTdVolMid : styles.drillTdVol}>
                          {item.vr != null ? `${item.vr}x` : '—'}
                        </td>
                        <td className={styles.drillTdAtr}>
                          {item.atr != null ? `${item.atr}%` : '—'}
                        </td>
                        <td className={item.a50 != null ? (item.a50 >= 0 ? styles.drillTdA50Up : styles.drillTdA50Dn) : styles.drillTdAtr}>
                          {item.a50 != null ? `${item.a50 > 0 ? '+' : ''}${item.a50}` : '—'}
                        </td>
                        <td className={item.pct >= 0 ? styles.drillTdUp : styles.drillTdDn}>
                          {item.pct > 0 ? '+' : ''}{item.pct}%
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            )}
          </div>

          {/* ── Right: TradingView chart ── */}
          {selected && (
            <div className={styles.drillChartPanel}>
              <div className={styles.drillChartBar}>
                <span className={styles.drillChartSym}>{selected.t}</span>
                {selected.n && <span className={styles.drillChartName}>{selected.n}</span>}
                <span className={styles.drillChartHint}>↑ ↓ to navigate</span>
              </div>
              <div className={styles.drillChartFrame}>
                <TvChart sym={selected.t} />
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ── COLS lookup map ────────────────────────────────────────────────────────
const COLS_BY_KEY = Object.fromEntries(COLS.map(c => [c.key, c]))

// ── ECharts matrix heatmap ─────────────────────────────────────────────────
// Maps tier string → numeric score for visualMap
const TIER_SCORES = { g3: 6, g2: 5, g1: 4, a: 3, r1: 2, r2: 1, r3: 0 }

// Human-readable tier labels (shown in tooltip)
const TIER_LABELS = {
  6: 'Extreme Bullish', 5: 'Bullish', 4: 'Mild Bullish',
  3: 'Caution', 2: 'Mild Bearish', 1: 'Bearish', 0: 'Extreme Bearish',
}

// Bright colors for tooltip text readability
const TIER_TIP_COLORS = {
  6: '#4ade80', 5: '#22c55e', 4: '#86efac',
  3: '#f59e0b', 2: '#fca5a5', 1: '#f87171', 0: '#ef4444',
}

// Y-axis label colors per group
const HM_GROUP_COLORS = {
  Score: '#c9a84c', Primary: '#b8c94a', MA: '#4ac97d',
  Regime: '#7b9fc7', 'Highs/Lows': '#c9944a', Sentiment: '#b44ac9',
}

// Flat metric list with group-header separators
// Each real metric has getTier(row)→tier and getFmt(row)→string
const HM_METRICS = [
  { key: '__h_score',   label: 'SCORE',           isHeader: true, group: 'Score' },
  { key: 'breadth_score', label: 'Health',         group: 'Score',
    getTier: r => { const v = r.breadth_score; return v == null ? '' : v >= 80 ? 'g3' : v >= 65 ? 'g2' : v >= 52 ? 'g1' : v >= 45 ? 'a' : v >= 35 ? 'r1' : v >= 20 ? 'r2' : 'r3' },
    getFmt:  r => r.breadth_score == null ? '—' : Math.round(r.breadth_score).toString() },
  { key: 'uct_exposure', label: 'UCT Exp',         group: 'Score',
    getTier: r => { const v = r.uct_exposure; return v == null ? '' : v >= 80 ? 'g3' : v >= 65 ? 'g2' : v >= 50 ? 'g1' : v >= 35 ? 'a' : v >= 20 ? 'r1' : v >= 10 ? 'r2' : 'r3' },
    getFmt:  r => r.uct_exposure == null ? '—' : Math.round(r.uct_exposure).toString() },

  { key: '__h_primary', label: 'PRIMARY BREADTH',  isHeader: true, group: 'Primary' },
  { key: 'up_4pct_today',   label: 'Up 4%+',       group: 'Primary',
    getTier: r => pairedUpColor(r.up_4pct_today, r.down_4pct_today),
    getFmt:  r => r.up_4pct_today ?? '—' },
  { key: 'down_4pct_today', label: 'Dn 4%+',       group: 'Primary',
    getTier: r => pairedDnColor(r.up_4pct_today, r.down_4pct_today),
    getFmt:  r => r.down_4pct_today ?? '—' },
  { key: 'ratio_5day',      label: '5D Ratio',      group: 'Primary',
    getTier: r => { const v = r.ratio_5day; return v == null ? '' : v >= 2.0 ? 'g3' : v >= 1.5 ? 'g2' : v > 0.6 ? '' : v > 0.5 ? 'r1' : v > 0.4 ? 'r2' : 'r3' },
    getFmt:  r => r.ratio_5day == null ? '—' : Number(r.ratio_5day).toFixed(2) },
  { key: 'ratio_10day',     label: '10D Ratio',     group: 'Primary',
    getTier: r => { const v = r.ratio_10day; return v == null ? '' : v >= 2.0 ? 'g3' : v >= 1.5 ? 'g2' : v > 0.6 ? '' : v > 0.5 ? 'r1' : v > 0.4 ? 'r2' : 'r3' },
    getFmt:  r => r.ratio_10day == null ? '—' : Number(r.ratio_10day).toFixed(2) },
  { key: 'up_25pct_quarter',   label: 'Up 25%/Qtr',  group: 'Primary',
    getTier: r => pairedUpColor(r.up_25pct_quarter, r.down_25pct_quarter),
    getFmt:  r => r.up_25pct_quarter ?? '—' },
  { key: 'down_25pct_quarter', label: 'Dn 25%/Qtr',  group: 'Primary',
    getTier: r => pairedDnColor(r.up_25pct_quarter, r.down_25pct_quarter),
    getFmt:  r => r.down_25pct_quarter ?? '—' },
  { key: 'up_50pct_month',     label: 'Up 50%/Mo',   group: 'Primary',
    getTier: r => pairedUpColor(r.up_50pct_month, r.down_50pct_month),
    getFmt:  r => r.up_50pct_month ?? '—' },
  { key: 'down_50pct_month',   label: 'Dn 50%/Mo',   group: 'Primary',
    getTier: r => pairedDnColor(r.up_50pct_month, r.down_50pct_month),
    getFmt:  r => r.down_50pct_month ?? '—' },
  { key: 'magna_up',        label: 'Up 13%/34d',    group: 'Primary',
    getTier: r => pairedUpColor(r.magna_up, r.magna_down),
    getFmt:  r => r.magna_up ?? '—' },
  { key: 'magna_down',      label: 'Dn 13%/34d',    group: 'Primary',
    getTier: r => pairedDnColor(r.magna_up, r.magna_down),
    getFmt:  r => r.magna_down ?? '—' },
  { key: 'is_ftd',          label: 'FTD',           group: 'Primary',
    getTier: r => r.is_ftd ? 'g2' : '',
    getFmt:  r => r.is_ftd ? 'FTD ✓' : '—' },

  { key: '__h_ma',     label: 'MA BREADTH',         isHeader: true, group: 'MA' },
  { key: 'pct_above_5sma',   label: '>5 SMA',      group: 'MA',
    getTier: r => pctColor(30, 50, 65)(r.pct_above_5sma),
    getFmt:  r => r.pct_above_5sma   == null ? '—' : `${Number(r.pct_above_5sma).toFixed(1)}%` },
  { key: 'pct_above_10sma',  label: '>10 SMA',     group: 'MA',
    getTier: r => pctColor(30, 50, 65)(r.pct_above_10sma),
    getFmt:  r => r.pct_above_10sma  == null ? '—' : `${Number(r.pct_above_10sma).toFixed(1)}%` },
  { key: 'pct_above_40sma',  label: '>40 SMA',     group: 'MA',
    getTier: r => pctColor(35, 50, 65)(r.pct_above_40sma),
    getFmt:  r => r.pct_above_40sma  == null ? '—' : `${Number(r.pct_above_40sma).toFixed(1)}%` },
  { key: 'pct_above_100sma', label: '>100 SMA',    group: 'MA',
    getTier: r => pctColor(35, 50, 65)(r.pct_above_100sma),
    getFmt:  r => r.pct_above_100sma == null ? '—' : `${Number(r.pct_above_100sma).toFixed(1)}%` },
  { key: 'spy_ma_stack', label: 'SPY MA',           group: 'MA',
    getTier: r => getMaStackTier({ keys: ['spy_above_10sma','spy_above_20sma','spy_above_50sma','spy_above_200sma'] }, r),
    getFmt:  r => {
      const keys = ['spy_above_10sma','spy_above_20sma','spy_above_50sma','spy_above_200sma']
      const n = keys.filter(k => r[k] === 1).length
      return `${n} / 4`
    }},
  { key: 'qqq_ma_stack', label: 'QQQ MA',          group: 'MA',
    getTier: r => getMaStackTier({ keys: ['qqq_above_10sma','qqq_above_20sma','qqq_above_50sma','qqq_above_200sma'] }, r),
    getFmt:  r => {
      const keys = ['qqq_above_10sma','qqq_above_20sma','qqq_above_50sma','qqq_above_200sma']
      const n = keys.filter(k => r[k] === 1).length
      return `${n} / 4`
    }},
  { key: 'pct_above_20ema',  label: '>20 EMA',     group: 'MA',
    getTier: r => pctColor(35, 50, 65)(r.pct_above_20ema),
    getFmt:  r => r.pct_above_20ema  == null ? '—' : `${Number(r.pct_above_20ema).toFixed(1)}%` },
  { key: 'pct_above_50sma',  label: '>50 SMA',     group: 'MA',
    getTier: r => pctColor(35, 50, 65)(r.pct_above_50sma),
    getFmt:  r => r.pct_above_50sma  == null ? '—' : `${Number(r.pct_above_50sma).toFixed(1)}%` },
  { key: 'pct_above_200sma', label: '>200 SMA',    group: 'MA',
    getTier: r => pctColor(30, 45, 60)(r.pct_above_200sma),
    getFmt:  r => r.pct_above_200sma == null ? '—' : `${Number(r.pct_above_200sma).toFixed(1)}%` },

  { key: '__h_regime', label: 'REGIME',             isHeader: true, group: 'Regime' },
  { key: 'sp500_close',  label: 'S&P 500',          group: 'Regime',
    getTier: r => { const p = r.spy_day_pct; return p == null ? '' : p >= 1.5 ? 'g3' : p >= 0.5 ? 'g2' : p > 0 ? 'g1' : p <= -1.5 ? 'r3' : p <= -0.5 ? 'r2' : 'r1' },
    getFmt:  r => r.sp500_close == null ? '—' : Number(r.sp500_close).toLocaleString('en-US', { maximumFractionDigits: 0 }) },
  { key: 'qqq_close',    label: 'QQQ',              group: 'Regime',
    getTier: r => { const p = r.qqq_day_pct; return p == null ? '' : p >= 1.5 ? 'g3' : p >= 0.5 ? 'g2' : p > 0 ? 'g1' : p <= -1.5 ? 'r3' : p <= -0.5 ? 'r2' : 'r1' },
    getFmt:  r => r.qqq_close == null ? '—' : Number(r.qqq_close).toFixed(2) },
  { key: 'vix',          label: 'VIX',              group: 'Regime',
    getTier: r => { const v = r.vix; return v == null ? '' : v < 14 ? 'g3' : v < 18 ? 'g2' : v < 20 ? 'g1' : v < 22 ? 'a' : v < 25 ? 'r1' : v < 30 ? 'r2' : 'r3' },
    getFmt:  r => r.vix == null ? '—' : Number(r.vix).toFixed(2) },
  { key: 'mcclellan_osc', label: 'McClellan',       group: 'Regime',
    getTier: r => { const v = r.mcclellan_osc; return v == null ? '' : v > 200 ? 'a' : v > 80 ? 'g3' : v > 20 ? 'g2' : v > 0 ? 'g1' : v > -20 ? 'r1' : v > -80 ? 'r2' : v > -200 ? 'r3' : 'a' },
    getFmt:  r => r.mcclellan_osc == null ? '—' : Number(r.mcclellan_osc).toFixed(1) },
  { key: 'stage2_count', label: 'Stage 2',          group: 'Regime',
    getTier: r => pairedUpColor(r.stage2_count, r.stage4_count),
    getFmt:  r => r.stage2_count ?? '—' },
  { key: 'stage4_count', label: 'Stage 4',          group: 'Regime',
    getTier: r => pairedDnColor(r.stage2_count, r.stage4_count),
    getFmt:  r => r.stage4_count ?? '—' },

  { key: '__h_highs', label: 'HIGHS / LOWS',        isHeader: true, group: 'Highs/Lows' },
  { key: 'new_52w_highs', label: '52W Highs',       group: 'Highs/Lows',
    getTier: r => pairedUpColor(r.new_52w_highs, r.new_52w_lows),
    getFmt:  r => r.new_52w_highs ?? '—' },
  { key: 'new_52w_lows',  label: '52W Lows',        group: 'Highs/Lows',
    getTier: r => pairedDnColor(r.new_52w_highs, r.new_52w_lows),
    getFmt:  r => r.new_52w_lows ?? '—' },
  { key: 'new_20d_highs', label: '20D Highs',       group: 'Highs/Lows',
    getTier: r => pairedUpColor(r.new_20d_highs, r.new_20d_lows),
    getFmt:  r => r.new_20d_highs ?? '—' },
  { key: 'new_20d_lows',  label: '20D Lows',        group: 'Highs/Lows',
    getTier: r => pairedDnColor(r.new_20d_highs, r.new_20d_lows),
    getFmt:  r => r.new_20d_lows ?? '—' },
  { key: 'new_ath',       label: 'ATH Count',       group: 'Highs/Lows',
    getTier: r => { const v = r.new_ath; return v == null ? '' : v > 200 ? 'g3' : v > 100 ? 'g2' : v > 40 ? 'g1' : '' },
    getFmt:  r => r.new_ath ?? '—' },

  { key: '__h_sentiment', label: 'SENTIMENT',       isHeader: true, group: 'Sentiment' },
  { key: 'cnn_fear_greed', label: 'CNN F/G',        group: 'Sentiment',
    getTier: r => { const v = r.cnn_fear_greed; return v == null ? '' : v <= 15 ? 'g3' : v <= 25 ? 'g2' : v <= 40 ? 'g1' : v <= 60 ? 'a' : v <= 70 ? 'r1' : v <= 80 ? 'r2' : 'r3' },
    getFmt:  r => r.cnn_fear_greed == null ? '—' : Math.round(r.cnn_fear_greed).toString() },
  { key: 'aaii_spread',   label: 'B-B Spread',      group: 'Sentiment',
    getTier: () => '',
    getFmt:  r => r.aaii_spread == null ? '—' : Number(r.aaii_spread).toFixed(1) },
  { key: 'cboe_putcall',  label: 'CBOE P/C',        group: 'Sentiment',
    getTier: () => '',
    getFmt:  r => r.cboe_putcall == null ? '—' : Number(r.cboe_putcall).toFixed(2) },
]

// Keys that are weekly/sparse and should be forward-filled so rows don't show
// black "no data" cells on off-survey days
const FFILL_KEYS = ['aaii_bulls', 'aaii_neutral', 'aaii_bears', 'aaii_spread', 'naaim', 'cboe_putcall']

// Keys that have a single numeric field we can compute percentile rank on
const PCTILE_KEYS = new Set([
  'breadth_score', 'uct_exposure',
  'up_4pct_today', 'down_4pct_today', 'ratio_5day', 'ratio_10day', 'magna_up', 'magna_down',
  'pct_above_20ema', 'pct_above_50sma', 'pct_above_200sma',
  'sp500_close', 'qqq_close', 'vix', 'mcclellan_osc', 'stage2_count', 'stage4_count',
  'new_52w_highs', 'new_52w_lows', 'new_20d_highs', 'new_20d_lows', 'new_ath',
  'cnn_fear_greed', 'aaii_spread', 'cboe_putcall',
])

// Solid tile fill colors per tier (used in treemap cells)
const TIER_CELL_COLORS = {
  g3: '#0a3216',
  g2: '#166030',
  g1: '#1a3d24',
  a:  '#5a4510',
  r1: '#3d1a1a',
  r2: '#a01919',
  r3: '#370606',
  '': '#181818',
}

// Fast lookup: metricKey → HM_METRICS entry
const HM_METRICS_BY_KEY = Object.fromEntries(
  HM_METRICS.filter(m => !m.isHeader).map(m => [m.key, m])
)

// Treemap layout definition: groups → weighted metric tiles
const TREEMAP_DEF = [
  { key: 'main', label: '', weight: 100,
    bgColor: 'transparent', borderColor: '#0a0f1a', labelColor: 'transparent',
    items: [
      { metricKey: 'breadth_score',      weight: 14 },
      { metricKey: 'uct_exposure',       weight: 10 },
      { metricKey: 'up_4pct_today',      weight: 8 },
      { metricKey: 'down_4pct_today',    weight: 8 },
      { metricKey: 'spy_ma_stack',       weight: 9 },
      { metricKey: 'qqq_ma_stack',       weight: 9 },
      { metricKey: 'cnn_fear_greed',     weight: 7 },
      { metricKey: 'up_25pct_quarter',   weight: 8 },
      { metricKey: 'down_25pct_quarter', weight: 8 },
      { metricKey: 'up_50pct_month',     weight: 6 },
      { metricKey: 'down_50pct_month',   weight: 6 },
      { metricKey: 'magna_up',           weight: 8 },
      { metricKey: 'magna_down',         weight: 8 },
      { metricKey: 'pct_above_5sma',    weight: 7 },
      { metricKey: 'pct_above_10sma',   weight: 7 },
      { metricKey: 'pct_above_20ema',   weight: 7 },
      { metricKey: 'pct_above_40sma',   weight: 7 },
      { metricKey: 'pct_above_50sma',   weight: 7 },
      { metricKey: 'pct_above_100sma',  weight: 7 },
      { metricKey: 'pct_above_200sma',  weight: 7 },
      { metricKey: 'sp500_close',       weight: 9 },
      { metricKey: 'qqq_close',         weight: 8 },
      { metricKey: 'new_52w_highs',     weight: 7 },
      { metricKey: 'new_52w_lows',      weight: 7 },
      { metricKey: 'new_20d_highs',     weight: 7 },
      { metricKey: 'new_20d_lows',      weight: 7 },
    ],
  },
]

// ── BreadthHeatmap (ECharts treemap) ────────────────────────────────────────
// Spatial treemap: groups as containers, metrics as colored tiles.
// Tile color = 8-tier bull/bear system. Navigate by date with ←/→ or arrow keys.
// Tooltip shows value + tier label + percentile rank.
// Trend arrows (▲/▼) compare current day vs 3 days prior.
function BreadthHeatmap({ rows, onDrill }) {
  const [rowIdx, setRowIdx] = useState(0)  // 0 = latest row (rows[0])

  // Arrow-key date navigation
  useEffect(() => {
    const handler = e => {
      if (e.key === 'ArrowLeft')  setRowIdx(p => Math.min(p + 1, rows.length - 1))
      if (e.key === 'ArrowRight') setRowIdx(p => Math.max(p - 1, 0))
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [rows.length])

  // Forward-fill weekly/sparse fields (AAII, NAAIM, CBOE)
  const filledRows = useMemo(() => {
    const asc   = [...rows].reverse()
    const carry = {}
    const result = []
    for (const row of asc) {
      const filled = { ...row }
      for (const k of FFILL_KEYS) {
        if (filled[k] == null && carry[k] != null) filled[k] = carry[k]
        else if (filled[k] != null) carry[k] = filled[k]
      }
      result.push(filled)
    }
    return result.reverse()  // newest-first
  }, [rows])

  const currentRow = filledRows[rowIdx] ?? filledRows[0]
  const prevRow    = filledRows[rowIdx + 3]  // ~3 trading days ago for trend arrows

  // Sorted value arrays per key for percentile rank in tooltip
  const pctileByKey = useMemo(() => {
    const out = {}
    for (const k of PCTILE_KEYS) {
      const vals = rows.map(r => r[k]).filter(v => v != null && !isNaN(Number(v)))
      if (vals.length > 1) out[k] = vals.map(Number).sort((a, b) => a - b)
    }
    return out
  }, [rows])

  // Tier helpers for score strip
  const healthTier = currentRow?.breadth_score == null ? '' :
    currentRow.breadth_score >= 80 ? 'g3' : currentRow.breadth_score >= 65 ? 'g2' :
    currentRow.breadth_score >= 52 ? 'g1' : currentRow.breadth_score >= 45 ? 'a'  :
    currentRow.breadth_score >= 35 ? 'r1' : currentRow.breadth_score >= 20 ? 'r2' : 'r3'
  const expTier = currentRow?.uct_exposure == null ? '' :
    currentRow.uct_exposure >= 80 ? 'g3' : currentRow.uct_exposure >= 65 ? 'g2' :
    currentRow.uct_exposure >= 50 ? 'g1' : currentRow.uct_exposure >= 35 ? 'a'  :
    currentRow.uct_exposure >= 20 ? 'r1' : currentRow.uct_exposure >= 10 ? 'r2' : 'r3'

  const option = useMemo(() => {
    if (!currentRow) return {}

    // Build treemap nodes: groups → children (metric tiles)
    const treeData = TREEMAP_DEF.map(group => {
      const children = group.items.map(item => {
        const metric = HM_METRICS_BY_KEY[item.metricKey]
        if (!metric) return null
        const tier  = metric.getTier(currentRow)
        const val   = metric.getFmt(currentRow)
        const color = TIER_CELL_COLORS[tier] ?? TIER_CELL_COLORS['']

        // Trend arrow: current tier score vs 3 days ago
        let arrow = ''
        if (prevRow && tier) {
          const prevTier  = metric.getTier(prevRow)
          const currScore = TIER_SCORES[tier]     ?? 3
          const prevScore = TIER_SCORES[prevTier] ?? 3
          if (currScore > prevScore) arrow = ' ▲'
          else if (currScore < prevScore) arrow = ' ▼'
        }

        return {
          name:      item.metricKey,
          value:     item.weight,
          labelText: metric.label,
          valText:   val + arrow,
          tier,
          itemStyle: { color, borderColor: 'rgba(0,0,0,0.35)', borderWidth: 1 },
        }
      }).filter(Boolean)

      return {
        name:       group.key,
        value:      group.weight,
        labelText:  group.label,
        labelColor: group.labelColor,
        itemStyle:  { color: group.bgColor, borderColor: '#0a0f1a', borderWidth: 0 },
        children,
      }
    })

    return {
      backgroundColor: 'transparent',
      animation: false,
      tooltip: {
        trigger: 'item',
        backgroundColor: 'rgba(8,8,8,0.96)',
        borderColor: '#c9a84c',
        borderWidth: 1,
        padding: [8, 12],
        textStyle: { color: '#e0e0e0', fontFamily: 'IBM Plex Mono, monospace', fontSize: 11 },
        formatter: params => {
          const d = params.data
          if (!d || !d.tier) return ''
          const metric = HM_METRICS_BY_KEY[d.name]
          if (!metric) return ''
          const score     = TIER_SCORES[d.tier]
          const tierLabel = score != null ? (TIER_LABELS[score] ?? '') : 'No signal'
          const tierColor = score != null ? (TIER_TIP_COLORS[score] ?? '#666') : '#666'
          let pctileStr = ''
          const rawVal = currentRow[d.name]
          const sorted = pctileByKey[d.name]
          if (sorted && rawVal != null && !isNaN(Number(rawVal))) {
            const v   = Number(rawVal)
            const pct = Math.round(sorted.filter(x => x <= v).length / sorted.length * 100)
            pctileStr = `p${pct} of ${sorted.length}d`
          }
          return (
            `<div style="min-width:145px;font-family:IBM Plex Mono,monospace">` +
            `<div style="color:#c9a84c;font-weight:700;margin-bottom:3px">${metric.label}</div>` +
            `<div style="color:#555;font-size:10px;margin-bottom:6px">${currentRow.date}</div>` +
            `<div style="font-size:16px;font-weight:700;margin-bottom:4px">${metric.getFmt(currentRow)}</div>` +
            `<div style="color:${tierColor};font-size:10px;letter-spacing:0.5px${pctileStr ? ';margin-bottom:3px' : ''}">${tierLabel}</div>` +
            (pctileStr ? `<div style="color:#555;font-size:10px">${pctileStr}</div>` : '') +
            `</div>`
          )
        },
      },
      label: {
        show:      true,
        formatter: params => {
          if (!params.data.labelText) return ''
          return `{lbl|${params.data.labelText.toUpperCase()}}\n{val|${params.data.valText ?? '—'}}`
        },
        rich: {
          lbl: {
            fontSize:   11,
            fontFamily: 'IBM Plex Mono, monospace',
            fontWeight: 700,
            color:      'rgba(255,255,255,0.60)',
            lineHeight: 18,
          },
          val: {
            fontSize:   30,
            fontFamily: 'IBM Plex Mono, monospace',
            fontWeight: 700,
            color:      '#ffffff',
            lineHeight: 40,
          },
        },
        position:      'inside',
        align:         'center',
        verticalAlign: 'middle',
        overflow:      'truncate',
      },
      upperLabel: { show: false },
      series: [{
        type:      'treemap',
        data:      treeData,
        width:     '100%',
        height:    '100%',
        top: 0, bottom: 0, left: 0, right: 0,
        roam:      false,
        nodeClick: false,
        breadcrumb: { show: false },
        visibleMin: 200,
        levels: [
          {
            // single group container — no border, no label
            itemStyle: { borderWidth: 0, gapWidth: 1, borderColor: '#0a0f1a' },
            upperLabel: { show: false },
            label:      { show: false },
          },
          {
            // metric tiles — hairline border
            itemStyle: { borderWidth: 1, gapWidth: 0, borderColor: '#0a0f1a' },
            emphasis:  { itemStyle: { borderColor: '#c9a84c', borderWidth: 2 } },
          },
        ],
      }],
    }
  }, [currentRow, prevRow, pctileByKey])

  if (!currentRow) return null

  return (
    <div className={styles.tmOuter} style={{ display: 'flex', flexDirection: 'column' }}>
      {/* ── Date navigation ─────────────────────────────────────────────── */}
      <div className={styles.tmDateNav}>
        <button
          className={styles.tmNavBtn}
          onClick={() => setRowIdx(p => Math.min(p + 1, rows.length - 1))}
          disabled={rowIdx >= rows.length - 1}
        >←</button>
        <span className={styles.tmNavDate}>{currentRow.date}</span>
        <button
          className={styles.tmNavBtn}
          onClick={() => setRowIdx(p => Math.max(p - 1, 0))}
          disabled={rowIdx === 0}
        >→</button>
        {rowIdx > 0 && (
          <button className={styles.tmNavLatest} onClick={() => setRowIdx(0)}>LATEST</button>
        )}
      </div>
      {/* ── ECharts treemap ─────────────────────────────────────────────── */}
      <div style={{ flex: 1, minHeight: 0 }}>
        <ReactECharts
          option={option}
          style={{ width: '100%', height: '100%' }}
          opts={{ renderer: 'canvas' }}
          notMerge
          onEvents={{
            click: params => {
              if (!onDrill || !currentRow) return
              const metric = HM_METRICS_BY_KEY[params.data?.name]
              if (metric?.drillKey) onDrill(currentRow.date, metric)
            },
          }}
        />
      </div>
    </div>
  )
}

// ── Component ─────────────────────────────────────────────────────────────
const phaseClass = (phase, styles) => {
  if (!phase) return ''
  const p = phase.toLowerCase()
  if (['uptrend', 'bull', 'recovery', 'power trend', 'ftd confirmed'].some(k => p.includes(k))) return styles.phaseGreen
  if (['distribution', 'liquidation', 'correction', 'circuit breaker'].some(k => p.includes(k))) return styles.phaseRed
  return styles.phaseAmber   // rally attempt, under pressure, late stage
}

export default function Breadth() {
  const [activeTab, setActiveTab] = useState('breadth')
  const { tileRef: tableRef, capturing, capture } = useTileCapture('breadth-monitor')
  const [days, setDays] = useState(90)
  const { data, isLoading, error } = useSWR(
    `/api/breadth-monitor?days=${days}`,
    fetcher,
    { refreshInterval: 5 * 60 * 1000 }
  )
  const [collapsed, setCollapsed] = useState(() => {
    try {
      const raw = localStorage.getItem('breadth_collapsed_groups')
      return raw ? new Set(JSON.parse(raw)) : new Set()
    } catch { return new Set() }
  })

  const [collapsedCols, setCollapsedCols] = useState(() => {
    try {
      const raw = localStorage.getItem('breadth_collapsed_cols')
      return raw ? new Set(JSON.parse(raw)) : new Set()
    } catch { return new Set() }
  })
  const toggleGroup = group => {
    setCollapsed(prev => {
      const next = new Set(prev)
      next.has(group) ? next.delete(group) : next.add(group)
      try { localStorage.setItem('breadth_collapsed_groups', JSON.stringify([...next])) } catch {}
      return next
    })
  }

  const toggleCol = key => {
    setCollapsedCols(prev => {
      const next = new Set(prev)
      next.has(key) ? next.delete(key) : next.add(key)
      try { localStorage.setItem('breadth_collapsed_cols', JSON.stringify([...next])) } catch {}
      return next
    })
  }

  const [drill, setDrill] = useState(null)
  // drill = { date, label, items: [{t,pct}] | null }

  const openDrill = useCallback((date, col) => {
    setDrill({ date, label: col.label, items: null })
    fetch(`/api/breadth-monitor/${date}/drill/${col.drillKey}`)
      .then(r => r.json())
      .then(data => setDrill(prev => prev ? { ...prev, items: data.items ?? [] } : null))
      .catch(() => setDrill(prev => prev ? { ...prev, items: [] } : null))
  }, [])

  const AAII_KEYS = new Set(['aaii_bulls', 'aaii_neutral', 'aaii_bears', 'aaii_spread'])

  const rows = data?.rows ?? []
  const lastUpdated = rows[0]?._created_at
    ? new Date(rows[0]._created_at + 'Z').toLocaleString('en-US', {
        month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit'
      })
    : null
  const visibleCols = COLS.filter(col => !collapsed.has(col.group))

  const sparkData = useMemo(() => {
    const out = {}
    const sparkCols = COLS.filter(c => c.type === 'sparkline')
    if (!sparkCols.length) return out
    // rows is newest-first; reverse to get oldest-first
    const asc = [...rows].reverse()
    const dateToIdx = Object.fromEntries(asc.map((r, i) => [r.date, i]))
    for (const col of sparkCols) {
      out[col.key] = {}
      for (const row of rows) {
        const idx = dateToIdx[row.date]
        if (idx != null) {
          out[col.key][row.date] = asc
            .slice(Math.max(0, idx - 9), idx + 1)
            .map(r => r[col.key] ?? null)
        }
      }
    }
    return out
  }, [rows])

  if (activeTab === 'cot') {
    return (
      <div className={`${styles.page} ${styles.pageCot}`}>
        <div className={`${styles.header} ${styles.cotTabHeader}`}>
          <h1 className={styles.heading}>Breadth</h1>
          <div className={styles.tabs}>
            <button className={styles.tab} onClick={() => setActiveTab('breadth')}>Monitor</button>
            <button className={styles.tab} onClick={() => setActiveTab('heatmap')}>Heatmap</button>
            <button className={`${styles.tab} ${styles.tabActive}`}>COT Data</button>
            <button className={styles.tab} onClick={() => setActiveTab('charts')}>Data Charts</button>
          </div>
        </div>
        <CotData />
      </div>
    )
  }

  if (activeTab === 'charts') {
    return (
      <div className={styles.page}>
        <div className={styles.header}>
          <h1 className={styles.heading}>Breadth</h1>
          <div className={styles.tabs}>
            <button className={styles.tab} onClick={() => setActiveTab('breadth')}>Monitor</button>
            <button className={styles.tab} onClick={() => setActiveTab('heatmap')}>Heatmap</button>
            <button className={styles.tab} onClick={() => setActiveTab('cot')}>COT Data</button>
            <button className={`${styles.tab} ${styles.tabActive}`}>Data Charts</button>
          </div>
        </div>
        <BreadthCharts />
      </div>
    )
  }

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <h1 className={styles.heading}>Breadth</h1>
        <div className={styles.tabs}>
          <button className={`${styles.tab} ${activeTab === 'breadth' ? styles.tabActive : ''}`} onClick={() => setActiveTab('breadth')}>Monitor</button>
          <button className={`${styles.tab} ${activeTab === 'heatmap' ? styles.tabActive : ''}`} onClick={() => setActiveTab('heatmap')}>Heatmap</button>
          <button className={styles.tab} onClick={() => setActiveTab('cot')}>COT Data</button>
          <button className={styles.tab} onClick={() => setActiveTab('charts')}>Data Charts</button>
        </div>
        <span className={styles.meta}>
          {rows.length > 0
            ? `${rows.length} trading days${lastUpdated ? ` · updated ${lastUpdated}` : ''}`
            : isLoading ? 'Loading…' : 'No data'}
        </span>
        {activeTab !== 'heatmap' && (
          <>
            <div className={styles.daysPills}>
              {[30, 60, 90].map(d => (
                <button
                  key={d}
                  className={`${styles.daysPill} ${days === d ? styles.daysPillActive : ''}`}
                  onClick={() => setDays(d)}
                >
                  {d}d
                </button>
              ))}
            </div>
            <button
              className={styles.exportBtn}
              onClick={() => exportCsv(rows, COLS)}
              title="Download as CSV"
            >
              ↓ CSV
            </button>
            <button
              className={styles.exportBtn}
              onClick={capture}
              disabled={capturing || rows.length === 0}
              title="Export as PNG"
            >
              {capturing ? '…' : '📷'}
            </button>
          </>
        )}
      </div>

      {error && (
        <div className={styles.errorBanner}>
          Could not load breadth data — {error.message ?? 'network error'}. Retrying in 5m.
        </div>
      )}

      {!error && rows.length === 0 && !isLoading && (
        <div className={styles.empty}>
          No data yet. Run <code>python scripts/breadth_collector.py</code> in uct-intelligence.
        </div>
      )}


      {rows.length > 0 && activeTab === 'heatmap' && (
        <BreadthHeatmap rows={rows} onDrill={openDrill} />
      )}

      {rows.length > 0 && activeTab === 'breadth' && (
        <div className={styles.tableWrap} ref={tableRef}>
          <table className={styles.table}>
            <thead>
              {/* Group header row */}
              <tr>
                <th
                  className={`${styles.th} ${styles.dateCol} ${styles.ghDate}`}
                  rowSpan={2}
                >
                  Date
                </th>
                {GROUP_SPANS.map((gs, i) => {
                  const isCollapsed = collapsed.has(gs.group)
                  // Count how many individual cols in this group are collapsed (they still occupy 1 slot each)
                  const groupCols = COLS.filter(c => c.group === gs.group)
                  const visibleSpan = isCollapsed ? 1 : groupCols.reduce((acc, c) => acc + 1, 0)
                  return (
                    <th
                      key={i}
                      colSpan={visibleSpan}
                      rowSpan={isCollapsed ? 2 : 1}
                      title={isCollapsed ? `Click to expand ${gs.group}` : `Click to collapse ${gs.group}`}
                      className={`${styles.th} ${styles.groupHeader} ${GROUP_HEADER_CLASS[gs.group] ?? ''} ${styles.groupHeaderClickable} ${isCollapsed ? styles.groupHeaderCollapsed : ''}`}
                      onClick={() => toggleGroup(gs.group)}
                    >
                      {isCollapsed
                        ? <span className={styles.groupCollapsedLabel}>{gs.group}</span>
                        : <span className={styles.groupExpandedLabel}>{gs.group} <span className={styles.groupChevron}>▾</span></span>
                      }
                    </th>
                  )
                })}
              </tr>
              {/* Column label row — only visible (non-collapsed) groups */}
              <tr>
                {visibleCols.map(col => {
                  const isColCollapsed = collapsedCols.has(col.key)
                  return (
                    <th
                      key={col.key}
                      title={isColCollapsed ? `Click to expand ${col.label}` : `Click to collapse ${col.label}`}
                      className={`${styles.th} ${styles.colLabel} ${styles.colLabelClickable} ${isColCollapsed ? styles.colLabelCollapsed : ''}`}
                      onClick={() => toggleCol(col.key)}
                    >
                      {isColCollapsed
                        ? <span className={styles.colCollapsedLabel}>{col.label}</span>
                        : col.subLabels
                          ? <><div>{col.label}</div><div className={styles.colSubLabel}>{col.subLabels}</div></>
                          : col.label
                      }
                    </th>
                  )
                })}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, ri) => (
                <tr key={row.date} className={`${ri % 2 === 0 ? styles.rowEven : styles.rowOdd} ${phaseClass(row.webster_phase ?? row.market_phase, styles)}`}>
                  <td className={`${styles.td} ${styles.dateCell}`}>{row.date}</td>
                  {visibleCols.map(col => {
                    if (collapsedCols.has(col.key)) {
                      return <td key={col.key} className={`${styles.td} ${styles.colCollapsedCell}`} />
                    }
                    if (col.type === 'sparkline') {
                      const val = row[col.key]
                      const last10 = sparkData[col.key]?.[row.date] ?? []
                      // Determine line color from cell color class
                      const colorResult = col.colorFn ? col.colorFn(val) : ''
                      const lineColor = colorResult === 'green' ? 'var(--ut-green-bright)'
                        : colorResult === 'red' ? 'var(--loss)' : 'var(--text-muted)'
                      return (
                        <td key={col.key} className={`${styles.td} ${styles.sparklineCell}`} title={val != null ? String(val) : '—'}>
                          <Sparkline values={last10} color={lineColor} />
                        </td>
                      )
                    }
                    if (col.type === 'ma_stack') {
                      // keys order: [10sma, 20sma, 50sma, 200sma]
                      const above10  = row[col.keys[0]] === 1
                      const above20  = row[col.keys[1]] === 1
                      const above50  = row[col.keys[2]] === 1
                      const above200 = row[col.keys[3]] === 1
                      const hasData  = col.keys.some(k => row[k] != null)
                      let stackBg = ''
                      if (hasData) {
                        if (above50) {
                          // Green side — above 50SMA
                          if (above10 && above20 && above200) stackBg = styles.bgG3  // all 4
                          else if (above200 && (above10 || above20)) stackBg = styles.bgG2  // 50+200+1 short
                          else if (above200)                         stackBg = styles.bgG1  // 50+200 only
                          else                                       stackBg = styles.bgA   // above 50, not 200
                        } else {
                          // Red side — below 50SMA
                          if (above200)              stackBg = styles.bgR1  // below 50, still above 200
                          else if (above10 || above20) stackBg = styles.bgR2  // below 50+200, short-term bounce
                          else                         stackBg = styles.bgR3  // below all
                        }
                      }
                      return (
                        <td key={col.key} className={`${styles.td} ${styles.maStackCell} ${stackBg}`}>
                          <div className={styles.maStack}>
                            {col.keys.map((k, i) => {
                              const v = row[k]
                              const isCheck = v === 1
                              const isCross = v === 0
                              return (
                                <div key={k} className={styles.maItem}>
                                  <span className={isCheck ? styles.maCheck : isCross ? styles.maCross : styles.maDash}>
                                    {v === null || v === undefined ? '—' : isCheck ? '✓' : '✗'}
                                  </span>
                                </div>
                              )
                            })}
                          </div>
                        </td>
                      )
                    }
                    const val = row[col.key]
                    const isStaleAaii = AAII_KEYS.has(col.key) &&
                      row.aaii_survey_date &&
                      row.aaii_survey_date !== row.date
                    const isDrillable = !!col.drillKey
                    return (
                      <td
                        key={col.key}
                        className={`${styles.td} ${cellClass(col, val, row)} ${isStaleAaii ? styles.aaiiStale : ''} ${isDrillable ? styles.drillable : ''}`}
                        title={isStaleAaii ? `Survey: ${row.aaii_survey_date}` : isDrillable ? `Click to see stocks` : undefined}
                        onClick={isDrillable ? () => openDrill(row.date, col) : undefined}
                      >
                        {fmtCell(col, val)}
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {drill && <DrillModal drill={drill} onClose={() => setDrill(null)} />}
    </div>
  )
}
