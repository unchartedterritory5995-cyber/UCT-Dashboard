import { useState, useMemo } from 'react'
import useSWR from 'swr'
import styles from './Breadth.module.css'
import CotData from './CotData'

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

const COLS = [
  // ── Score ─────────────────────────────────────────────────────────────────
  { key: 'breadth_score', label: 'Health', group: G.SCORE,
    fmt: v => fmtDec(v, 0),
    colorFn: v => v == null ? '' : v >= 80 ? 'g3' : v >= 65 ? 'g2' : v >= 52 ? 'g1' : v >= 45 ? 'a' : v >= 35 ? 'r1' : v >= 20 ? 'r2' : 'r3' },
  { key: 'uct_exposure', label: 'UCT Exp', group: G.SCORE, fmt: v => fmtDec(v, 0),
    colorFn: v => v == null ? '' : v >= 80 ? 'g3' : v >= 65 ? 'g2' : v >= 50 ? 'g1' : v >= 35 ? 'a' : v >= 20 ? 'r1' : v >= 10 ? 'r2' : 'r3' },

  // ── Primary Breadth ───────────────────────────────────────────────────────
  { key: 'up_4pct_today', label: 'Up 4%+', group: G.PRIMARY,
    colorFn: v => v == null ? '' : v > 500 ? 'g3' : v > 300 ? 'g2' : v > 150 ? 'g1' : v < 50 ? 'r2' : v < 100 ? 'r1' : '' },
  { key: 'down_4pct_today', label: 'Dn 4%+', group: G.PRIMARY,
    colorFn: v => v == null ? '' : v > 500 ? 'r3' : v > 300 ? 'r2' : v > 150 ? 'r1' : v < 50 ? 'g2' : v < 100 ? 'g1' : '' },
  { key: 'ratio_5day', label: '5D Ratio', group: G.PRIMARY, fmt: v => fmtDec(v, 2),
    colorFn: v => v == null ? '' : v >= 1.5 ? 'g3' : v >= 1.2 ? 'g2' : v >= 1.05 ? 'g1' : v >= 0.95 ? 'a' : v >= 0.8 ? 'r1' : v >= 0.6 ? 'r2' : 'r3' },
  { key: 'ratio_10day', label: '10D Ratio', group: G.PRIMARY, fmt: v => fmtDec(v, 2),
    colorFn: v => v == null ? '' : v >= 1.5 ? 'g3' : v >= 1.2 ? 'g2' : v >= 1.05 ? 'g1' : v >= 0.95 ? 'a' : v >= 0.8 ? 'r1' : v >= 0.6 ? 'r2' : 'r3' },
  { key: 'up_25pct_quarter', label: 'Up25%/Qtr', group: G.PRIMARY,
    colorFn: v => v == null ? '' : v > 800 ? 'g3' : v > 500 ? 'g2' : v > 300 ? 'g1' : v < 80 ? 'r2' : v < 150 ? 'r1' : '' },
  { key: 'down_25pct_quarter', label: 'Dn25%/Qtr', group: G.PRIMARY,
    colorFn: v => v == null ? '' : v > 800 ? 'r3' : v > 500 ? 'r2' : v > 300 ? 'r1' : v < 60 ? 'g2' : v < 100 ? 'g1' : '' },
  { key: 'up_25pct_month', label: 'Up25%/Mo', group: G.PRIMARY,
    colorFn: v => v == null ? '' : v > 400 ? 'g3' : v > 200 ? 'g2' : v > 100 ? 'g1' : v < 30 ? 'r2' : v < 60 ? 'r1' : '' },
  { key: 'down_25pct_month', label: 'Dn25%/Mo', group: G.PRIMARY,
    colorFn: v => v == null ? '' : v > 400 ? 'r3' : v > 200 ? 'r2' : v > 100 ? 'r1' : v < 30 ? 'g2' : v < 60 ? 'g1' : '' },
  { key: 'up_50pct_month', label: 'Up50%/Mo', group: G.PRIMARY,
    colorFn: v => v == null ? '' : v > 100 ? 'g3' : v > 50 ? 'g2' : v > 20 ? 'g1' : '' },
  { key: 'down_50pct_month', label: 'Dn50%/Mo', group: G.PRIMARY,
    colorFn: v => v == null ? '' : v > 100 ? 'r3' : v > 50 ? 'r2' : v > 20 ? 'r1' : '' },
  { key: 'magna_up', label: 'Up13%/34d', group: G.PRIMARY,
    colorFn: v => v == null ? '' : v > 1200 ? 'g3' : v > 800 ? 'g2' : v > 500 ? 'g1' : v < 150 ? 'r2' : v < 250 ? 'r1' : '' },
  { key: 'magna_down', label: 'Dn13%/34d', group: G.PRIMARY,
    colorFn: v => v == null ? '' : v > 1200 ? 'r3' : v > 800 ? 'r2' : v > 500 ? 'r1' : v < 100 ? 'g2' : v < 150 ? 'g1' : '' },
  { key: 'universe_count',     label: 'Universe',   group: G.PRIMARY },
  { key: 'is_ftd',            label: 'FTD',        group: G.PRIMARY,
    fmt: v => v ? 'FTD' : '—',
    colorFn: v => v ? 'g2' : '' },

  // ── MA Breadth ────────────────────────────────────────────────────────────
  { key: 'spy_ma_stack', label: 'SPY MAs', group: G.MA, type: 'ma_stack',
    keys: ['spy_above_10sma', 'spy_above_20sma', 'spy_above_50sma', 'spy_above_200sma'],
    maLabels: ['10', '20', '50', '200'] },
  { key: 'qqq_ma_stack', label: 'QQQ MAs', group: G.MA, type: 'ma_stack',
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
  { key: 'avg_10d_vix', label: '10d VIX', group: G.REGIME, fmt: v => fmtDec(v, 2),
    colorFn: v => v == null ? '' : v < 15 ? 'g3' : v < 18 ? 'g2' : v < 20 ? 'g1' : v < 22 ? 'a' : v < 26 ? 'r1' : v < 30 ? 'r2' : 'r3' },
  { key: 'mcclellan_osc', label: 'McClellan', group: G.REGIME, fmt: v => fmtDec(v, 1),
    colorFn: v => v == null ? '' : v > 200 ? 'a' : v > 80 ? 'g3' : v > 20 ? 'g2' : v > 0 ? 'g1' : v > -20 ? 'r1' : v > -80 ? 'r2' : v > -200 ? 'r3' : 'a' },
  { key: 'market_phase', label: 'Phase', group: G.REGIME,
    colorFn: v => {
      if (v == null) return ''
      const p = v.toLowerCase()
      if (['power trend','ftd confirmed'].some(k => p.includes(k))) return 'g3'
      if (['uptrend','bull'].some(k => p.includes(k)))               return 'g2'
      if (['recovery'].some(k => p.includes(k)))                     return 'g1'
      if (['liquidation','correction','circuit breaker'].some(k => p.includes(k))) return 'r3'
      if (['distribution'].some(k => p.includes(k)))                 return 'r2'
      return 'a'
    } },

  // ── Highs / Lows ──────────────────────────────────────────────────────────
  { key: 'new_52w_highs', label: '52W Hi', group: G.HIGHS,
    colorFn: v => v == null ? '' : v > 300 ? 'g3' : v > 150 ? 'g2' : v > 80 ? 'g1' : v < 10 ? 'r2' : v < 20 ? 'r1' : '' },
  { key: 'new_52w_lows', label: '52W Lo', group: G.HIGHS,
    colorFn: v => v == null ? '' : v > 300 ? 'r3' : v > 150 ? 'r2' : v > 80 ? 'r1' : v < 10 ? 'g2' : v < 20 ? 'g1' : '' },
  { key: 'new_20d_highs', label: '20D Hi', group: G.HIGHS,
    colorFn: v => v == null ? '' : v > 400 ? 'g3' : v > 200 ? 'g2' : v > 100 ? 'g1' : v < 30 ? 'r2' : v < 50 ? 'r1' : '' },
  { key: 'new_20d_lows', label: '20D Lo', group: G.HIGHS,
    colorFn: v => v == null ? '' : v > 400 ? 'r3' : v > 200 ? 'r2' : v > 100 ? 'r1' : v < 30 ? 'g2' : v < 50 ? 'g1' : '' },
  { key: 'new_ath', label: 'ATH', group: G.HIGHS,
    colorFn: v => v == null ? '' : v > 200 ? 'g3' : v > 100 ? 'g2' : v > 40 ? 'g1' : '' },
  { key: 'near_52w_high', label: 'Near52W', group: G.HIGHS,
    colorFn: v => v == null ? '' : v > 1000 ? 'g3' : v > 600 ? 'g2' : v > 350 ? 'g1' : v < 80 ? 'r2' : v < 150 ? 'r1' : '' },
  { key: 'hi_ratio', label: 'Hi%', group: G.HIGHS, fmt: v => fmtDec(v, 2),
    colorFn: v => v == null ? '' : v > 8 ? 'g3' : v > 4 ? 'g2' : v > 2 ? 'g1' : v < 0.25 ? 'r2' : v < 0.5 ? 'r1' : '' },
  { key: 'lo_ratio', label: 'Lo%', group: G.HIGHS, fmt: v => fmtDec(v, 2),
    colorFn: v => v == null ? '' : v > 8 ? 'r3' : v > 4 ? 'r2' : v > 2 ? 'r1' : v < 0.25 ? 'g2' : v < 0.5 ? 'g1' : '' },

  // ── Setups ────────────────────────────────────────────────────────────────
  { key: 'stage2_count', label: 'Stage 2', group: G.SETUPS,
    colorFn: v => v == null ? '' : v > 1200 ? 'g3' : v > 800 ? 'g2' : v > 500 ? 'g1' : v < 150 ? 'r2' : v < 300 ? 'r1' : '' },
  { key: 'stage4_count', label: 'Stage 4', group: G.SETUPS,
    colorFn: v => v == null ? '' : v > 1200 ? 'r3' : v > 800 ? 'r2' : v > 500 ? 'r1' : v < 100 ? 'g2' : v < 200 ? 'g1' : '' },

  // ── Sentiment ─────────────────────────────────────────────────────────────
  { key: 'cboe_putcall', label: 'CBOE P/C', group: G.SENTIMENT, fmt: v => fmtDec(v, 2),
    colorFn: v => v == null ? '' : v >= 1.0 ? 'g3' : v >= 0.9 ? 'g2' : v >= 0.85 ? 'g1' : v >= 0.75 ? 'a' : v >= 0.7 ? 'r1' : v >= 0.65 ? 'r2' : 'r3' },
  { key: 'avg_10d_cpc', label: '10d P/C', group: G.SENTIMENT, fmt: v => fmtDec(v, 2),
    colorFn: v => v == null ? '' : v >= 0.95 ? 'g3' : v >= 0.88 ? 'g2' : v >= 0.82 ? 'g1' : v >= 0.74 ? 'a' : v >= 0.68 ? 'r1' : v >= 0.62 ? 'r2' : 'r3' },
  { key: 'cnn_fear_greed', label: 'CNN F/G', group: G.SENTIMENT, fmt: v => fmtDec(v, 0),
    colorFn: v => v == null ? '' : v <= 15 ? 'g3' : v <= 25 ? 'g2' : v <= 40 ? 'g1' : v <= 60 ? 'a' : v <= 70 ? 'r1' : v <= 80 ? 'r2' : 'r3' },
  { key: 'aaii_bulls',    label: 'AAII Bulls', group: G.SENTIMENT, fmt: v => fmtDec(v, 1) },
  { key: 'aaii_neutral',  label: 'Neutral',    group: G.SENTIMENT, fmt: v => fmtDec(v, 1) },
  { key: 'aaii_bears',    label: 'AAII Bears', group: G.SENTIMENT, fmt: v => fmtDec(v, 1) },
  { key: 'aaii_spread', label: 'B-B Sprd', group: G.SENTIMENT, fmt: v => fmtDec(v, 1),
    colorFn: v => v == null ? '' : v < -35 ? 'g3' : v < -20 ? 'g2' : v < -10 ? 'g1' : v < 10 ? 'a' : v < 20 ? 'r1' : v < 30 ? 'r2' : 'r3' },
  { key: 'naaim', label: 'NAAIM', group: G.SENTIMENT, fmt: v => fmtDec(v, 2),
    colorFn: v => v == null ? '' : v < 15 ? 'g3' : v < 25 ? 'g2' : v < 40 ? 'g1' : v < 65 ? 'a' : v < 80 ? 'r1' : v < 95 ? 'r2' : 'r3' },
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
            <button className={`${styles.tab} ${styles.tabActive}`}>COT Data</button>
          </div>
        </div>
        <CotData />
      </div>
    )
  }

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <h1 className={styles.heading}>Breadth</h1>
        <div className={styles.tabs}>
          <button className={`${styles.tab} ${styles.tabActive}`}>Monitor</button>
          <button className={styles.tab} onClick={() => setActiveTab('cot')}>COT Data</button>
        </div>
        <span className={styles.meta}>
          {rows.length > 0
            ? `${rows.length} trading days${lastUpdated ? ` · updated ${lastUpdated}` : ''}`
            : isLoading ? 'Loading…' : 'No data'}
        </span>
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

      {rows.length > 0 && (() => {
        const latest = rows[0]
        const score = latest?.breadth_score
        const phase = latest?.webster_phase ?? latest?.market_phase ?? '—'
        const exp = latest?.uct_exposure
        const dd = latest?.spy_dist_days
        return (
          <div className={styles.scoreSummary}>
            <div className={styles.scoreGauge}>
              <span className={styles.scoreLabel}>HEALTH</span>
              <span className={`${styles.scoreValue} ${
                score >= 65 ? styles.scoreGreen : score <= 35 ? styles.scoreRed : styles.scoreAmber
              }`}>{score != null ? score : '—'}</span>
              <div className={styles.scoreBar}>
                <div
                  className={styles.scoreBarFill}
                  style={{ width: `${score ?? 0}%`, background:
                    score >= 65 ? 'var(--ut-green-bright)' :
                    score <= 35 ? 'var(--loss)' : 'var(--ut-gold)'
                  }}
                />
              </div>
            </div>
            <div className={styles.scoreMeta}>
              <span className={styles.scoreMetaItem}>Phase: <strong>{phase}</strong></span>
              <span className={styles.scoreMetaItem}>Exposure: <strong>{exp != null ? `${exp}%` : '—'}</strong></span>
              <span className={styles.scoreMetaItem}>SPY DD: <strong>{dd ?? '—'}</strong></span>
            </div>
          </div>
        )
      })()}

      {rows.length > 0 && (
        <div className={styles.tableWrap}>
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
                      return (
                        <td key={col.key} className={`${styles.td} ${styles.maStackCell}`}>
                          <div className={styles.maStack}>
                            {col.keys.map((k, i) => {
                              const v = row[k]
                              const isCheck = v === 1
                              const isCross = v === 0
                              return (
                                <div key={k} className={styles.maItem}>
                                  <span className={styles.maLabel}>{col.maLabels[i]}</span>
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
                    return (
                      <td
                        key={col.key}
                        className={`${styles.td} ${cellClass(col, val, row)} ${isStaleAaii ? styles.aaiiStale : ''}`}
                        title={isStaleAaii ? `Survey: ${row.aaii_survey_date}` : undefined}
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
    </div>
  )
}
