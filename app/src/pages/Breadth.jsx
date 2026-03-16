import { useState, useMemo } from 'react'
import useSWR from 'swr'
import styles from './Breadth.module.css'

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
  return v => {
    if (v === null || v === undefined) return ''
    if (v >= high) return 'green'
    if (v <= low)  return 'red'
    if (v >= mid)  return 'amber'
    return ''
  }
}

const COLS = [
  // ── Score ─────────────────────────────────────────────────────────────────
  { key: 'breadth_score', label: 'Health', group: G.SCORE,
    fmt: v => fmtDec(v, 0),
    colorFn: v => v == null ? '' : v >= 65 ? 'green' : v <= 35 ? 'red' : 'amber' },

  // ── Regime ────────────────────────────────────────────────────────────────
  { key: 'uct_exposure',   label: 'UCT Exp',     group: G.REGIME, fmt: v => fmtDec(v, 0),
    colorFn: v => v == null ? '' : v >= 70 ? 'green' : v <= 30 ? 'red' : 'amber' },
  { key: 'sp500_close',    label: 'S&P 500',    group: G.REGIME, fmt: fmtPrice },
  { key: 'qqq_close',      label: 'QQQ',         group: G.REGIME, fmt: fmtPrice },
  { key: 'vix',            label: 'VIX',          group: G.REGIME, fmt: v => fmtDec(v, 2),
    colorFn: v => v == null ? '' : v > 30 ? 'red' : v > 20 ? 'amber' : 'green' },
  { key: 'avg_10d_vix',    label: '10d VIX',      group: G.REGIME, fmt: v => fmtDec(v, 2),
    colorFn: v => v == null ? '' : v > 28 ? 'red' : v > 20 ? 'amber' : 'green' },
  { key: 'spy_ma_stack', label: 'SPY MAs', group: G.REGIME, type: 'ma_stack',
    keys: ['spy_above_10sma', 'spy_above_20sma', 'spy_above_50sma', 'spy_above_200sma'],
    maLabels: ['10', '20', '50', '200'] },
  { key: 'qqq_ma_stack', label: 'QQQ MAs', group: G.REGIME, type: 'ma_stack',
    keys: ['qqq_above_10sma', 'qqq_above_20sma', 'qqq_above_50sma', 'qqq_above_200sma'],
    maLabels: ['10', '20', '50', '200'] },
  { key: 'market_phase',      label: 'Phase',      group: G.REGIME,
    colorFn: v => v == null ? '' :
      ['uptrend','bull','recovery'].some(p => v.toLowerCase().includes(p)) ? 'green' :
      ['distribution','liquidation','correction'].some(p => v.toLowerCase().includes(p)) ? 'red' : 'amber' },
  { key: 'rsp_spy_ratio',     label: 'RSP/SPY',    group: G.REGIME, fmt: v => fmtDec(v, 4),
    colorFn: v => v == null ? '' : v > 0.46 ? 'green' : v < 0.43 ? 'red' : '' },
  { key: 'iwm_qqq_ratio',     label: 'IWM/QQQ',    group: G.REGIME, fmt: v => fmtDec(v, 4),
    colorFn: v => v == null ? '' : v > 0.18 ? 'green' : v < 0.15 ? 'red' : '' },

  // ── Primary Breadth ───────────────────────────────────────────────────────
  { key: 'up_4pct_today',      label: 'Up 4%+',     group: G.PRIMARY,
    colorFn: v => v == null ? '' : v > 300 ? 'green' : v < 100 ? 'red' : '' },
  { key: 'down_4pct_today',    label: 'Dn 4%+',     group: G.PRIMARY,
    colorFn: v => v == null ? '' : v > 300 ? 'red' : v < 100 ? 'green' : '' },
  { key: 'ratio_5day',         label: '5D Ratio',   group: G.PRIMARY, fmt: v => fmtDec(v, 2),
    colorFn: v => v == null ? '' : v >= 1.2 ? 'green' : v <= 0.8 ? 'red' : '' },
  { key: 'ratio_10day',        label: '10D Ratio',  group: G.PRIMARY, fmt: v => fmtDec(v, 2),
    colorFn: v => v == null ? '' : v >= 1.2 ? 'green' : v <= 0.8 ? 'red' : '' },
  { key: 'up_25pct_quarter',   label: 'Up25%/Qtr',  group: G.PRIMARY,
    colorFn: v => v == null ? '' : v > 500 ? 'green' : v < 150 ? 'red' : '' },
  { key: 'down_25pct_quarter', label: 'Dn25%/Qtr',  group: G.PRIMARY,
    colorFn: v => v == null ? '' : v > 500 ? 'red' : v < 100 ? 'green' : '' },
  { key: 'up_25pct_month',     label: 'Up25%/Mo',   group: G.PRIMARY,
    colorFn: v => v == null ? '' : v > 200 ? 'green' : v < 60 ? 'red' : '' },
  { key: 'down_25pct_month',   label: 'Dn25%/Mo',   group: G.PRIMARY,
    colorFn: v => v == null ? '' : v > 200 ? 'red' : v < 60 ? 'green' : '' },
  { key: 'up_50pct_month',     label: 'Up50%/Mo',   group: G.PRIMARY,
    colorFn: v => v == null ? '' : v > 50 ? 'green' : '' },
  { key: 'down_50pct_month',   label: 'Dn50%/Mo',   group: G.PRIMARY,
    colorFn: v => v == null ? '' : v > 50 ? 'red' : '' },
  { key: 'magna_up',           label: 'Up13%/34d',  group: G.PRIMARY,
    colorFn: v => v == null ? '' : v > 800 ? 'green' : v < 250 ? 'red' : '' },
  { key: 'magna_down',         label: 'Dn13%/34d',  group: G.PRIMARY,
    colorFn: v => v == null ? '' : v > 800 ? 'red' : v < 150 ? 'green' : '' },
  { key: 'universe_count',     label: 'Universe',   group: G.PRIMARY },
  { key: 'qqq_day_pct',       label: 'QQQ%',       group: G.PRIMARY, fmt: v => fmtDec(v, 2),
    colorFn: v => v == null ? '' : v >= 1.25 ? 'green' : v <= -1.25 ? 'red' : '' },
  { key: 'spy_day_pct',       label: 'SPY%',       group: G.PRIMARY, fmt: v => fmtDec(v, 2),
    colorFn: v => v == null ? '' : v >= 1.25 ? 'green' : v <= -1.25 ? 'red' : '' },
  { key: 'is_ftd',            label: 'FTD',        group: G.PRIMARY,
    fmt: v => v ? 'FTD' : '—',
    colorFn: v => v ? 'green' : '' },

  // ── MA Breadth ────────────────────────────────────────────────────────────
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

  // ── Highs / Lows ──────────────────────────────────────────────────────────
  { key: 'new_52w_highs',  label: '52W Hi',    group: G.HIGHS,
    colorFn: v => v == null ? '' : v > 150 ? 'green' : v < 20 ? 'red' : '' },
  { key: 'new_52w_lows',   label: '52W Lo',    group: G.HIGHS,
    colorFn: v => v == null ? '' : v > 150 ? 'red' : v < 20 ? 'green' : '' },
  { key: 'new_20d_highs',  label: '20D Hi',    group: G.HIGHS,
    colorFn: v => v == null ? '' : v > 200 ? 'green' : v < 50 ? 'red' : '' },
  { key: 'new_20d_lows',   label: '20D Lo',    group: G.HIGHS,
    colorFn: v => v == null ? '' : v > 200 ? 'red' : v < 50 ? 'green' : '' },
  { key: 'new_ath',        label: 'ATH',       group: G.HIGHS,
    colorFn: v => v == null ? '' : v > 100 ? 'green' : '' },
  { key: 'near_52w_high',  label: 'Near52W',   group: G.HIGHS,
    colorFn: v => v == null ? '' : v > 600 ? 'green' : v < 150 ? 'red' : '' },
  { key: 'hi_ratio',          label: 'Hi%',        group: G.HIGHS, fmt: v => fmtDec(v, 2),
    colorFn: v => v == null ? '' : v > 4 ? 'green' : v < 0.5 ? 'red' : '' },
  { key: 'lo_ratio',          label: 'Lo%',        group: G.HIGHS, fmt: v => fmtDec(v, 2),
    colorFn: v => v == null ? '' : v > 4 ? 'red' : v < 0.5 ? 'green' : '' },

  // ── Setups ────────────────────────────────────────────────────────────────
  { key: 'stage2_count', label: 'Stage 2', group: G.SETUPS,
    colorFn: v => v == null ? '' : v > 800 ? 'green' : v < 300 ? 'red' : '' },
  { key: 'stage4_count', label: 'Stage 4', group: G.SETUPS,
    colorFn: v => v == null ? '' : v > 800 ? 'red' : v < 200 ? 'green' : '' },

  // ── Volume / A-D ──────────────────────────────────────────────────────────
  { key: 'adv_decline',   label: 'A-D',        group: G.VOLUME,
    colorFn: v => v == null ? '' : v > 500 ? 'green' : v < -500 ? 'red' : '' },
  { key: 'up_vol_ratio',  label: 'UpVol',      group: G.VOLUME, fmt: v => fmtDec(v, 2),
    colorFn: v => v == null ? '' : v > 2 ? 'green' : v < 0.5 ? 'red' : '' },
  { key: 'mcclellan_osc', label: 'McClellan', group: G.VOLUME, fmt: v => fmtDec(v, 1),
    colorFn: v => v == null ? '' : v > 150 ? 'amber' : v > 0 ? 'green' : v < -150 ? 'amber' : 'red' },
  { key: 'adv_decline_cum',   label: 'A-D Cum',    group: G.VOLUME, fmt: v => fmtDec(v, 0),
    colorFn: v => v == null ? '' : v > 0 ? 'green' : 'red' },

  // ── Sentiment ─────────────────────────────────────────────────────────────
  { key: 'cboe_putcall',  label: 'CBOE P/C',   group: G.SENTIMENT, fmt: v => fmtDec(v, 2),
    colorFn: v => v == null ? '' : v >= 0.85 ? 'green' : v <= 0.65 ? 'red' : '' },
  { key: 'avg_10d_cpc',   label: '10d P/C',    group: G.SENTIMENT, fmt: v => fmtDec(v, 2),
    colorFn: v => v == null ? '' : v >= 0.82 ? 'green' : v <= 0.68 ? 'red' : '' },
  { key: 'cnn_fear_greed',label: 'CNN F/G',    group: G.SENTIMENT, fmt: v => fmtDec(v, 0),
    colorFn: v => v == null ? '' : v <= 25 ? 'green' : v >= 75 ? 'red' : v <= 40 ? 'amber' : '' },
  { key: 'aaii_bulls',    label: 'AAII Bulls', group: G.SENTIMENT, fmt: v => fmtDec(v, 1) },
  { key: 'aaii_neutral',  label: 'Neutral',    group: G.SENTIMENT, fmt: v => fmtDec(v, 1) },
  { key: 'aaii_bears',    label: 'AAII Bears', group: G.SENTIMENT, fmt: v => fmtDec(v, 1) },
  { key: 'aaii_spread', label: 'B-B Sprd', group: G.SENTIMENT, fmt: v => fmtDec(v, 1),
    colorFn: v => v == null ? '' : v < -20 ? 'green' : v > 30 ? 'red' : v < -10 ? 'amber' : '' },
  { key: 'naaim',         label: 'NAAIM',      group: G.SENTIMENT, fmt: v => fmtDec(v, 2),
    colorFn: v => v == null ? '' : v > 90 ? 'amber' : v < 25 ? 'green' : '' },
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

function cellClass(col, val) {
  if (!col.colorFn || val === null || val === undefined) return ''
  const c = col.colorFn(val)
  if (c === 'green') return styles.cellGreen
  if (c === 'red')   return styles.cellRed
  if (c === 'amber') return styles.cellAmber
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
  if (['uptrend', 'bull', 'recovery'].some(k => p.includes(k))) return styles.phaseGreen
  if (['distribution', 'liquidation', 'correction'].some(k => p.includes(k))) return styles.phaseRed
  return styles.phaseAmber
}

export default function Breadth() {
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
  const [sortKey, setSortKey] = useState(null)
  const [sortDir, setSortDir] = useState('desc')

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

  const sortedRows = useMemo(() => {
    if (!sortKey) return rows
    return [...rows].sort((a, b) => {
      const av = a[sortKey] ?? (sortDir === 'asc' ? Infinity : -Infinity)
      const bv = b[sortKey] ?? (sortDir === 'asc' ? Infinity : -Infinity)
      if (typeof av === 'string' && typeof bv === 'string') {
        return sortDir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av)
      }
      return sortDir === 'asc' ? av - bv : bv - av
    })
  }, [rows, sortKey, sortDir])

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

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <h1 className={styles.heading}>Breadth Monitor</h1>
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
          onClick={() => exportCsv(sortedRows, COLS)}
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
        const phase = latest?.market_phase ?? '—'
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
                  onDoubleClick={() => setSortKey(null)}
                  title="Double-click to reset sort"
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
                      title={isColCollapsed ? `Click to expand ${col.label}` : `Click to sort by ${col.label} (double-click to hide)`}
                      className={`${styles.th} ${styles.colLabel} ${styles.colLabelClickable} ${isColCollapsed ? styles.colLabelCollapsed : ''}`}
                      onClick={() => {
                        if (isColCollapsed) {
                          toggleCol(col.key)
                        } else if (sortKey === col.key) {
                          setSortDir(d => d === 'desc' ? 'asc' : 'desc')
                        } else {
                          setSortKey(col.key)
                          setSortDir('desc')
                        }
                      }}
                      onDoubleClick={() => {
                        if (!isColCollapsed) toggleCol(col.key)
                      }}
                    >
                      {isColCollapsed
                        ? <span className={styles.colCollapsedLabel}>{col.label}</span>
                        : <>
                            {col.label}
                            {sortKey === col.key && (
                              <span className={styles.sortIndicator}>{sortDir === 'desc' ? ' ▾' : ' ▴'}</span>
                            )}
                          </>
                      }
                    </th>
                  )
                })}
              </tr>
            </thead>
            <tbody>
              {sortedRows.map((row, ri) => (
                <tr key={row.date} className={`${ri % 2 === 0 ? styles.rowEven : styles.rowOdd} ${phaseClass(row.market_phase, styles)}`}>
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
                        className={`${styles.td} ${cellClass(col, val)} ${isStaleAaii ? styles.aaiiStale : ''}`}
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
