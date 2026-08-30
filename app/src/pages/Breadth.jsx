import { useState, useMemo, useEffect, useCallback, useRef, Fragment, lazy, Suspense } from 'react'
import useSWR from 'swr'
import styles from './Breadth.module.css'
import CotData from './CotData'
import BreadthCharts from './BreadthCharts'
import TickerPopup from '../components/TickerPopup'
import MarketBreadth from '../components/tiles/MarketBreadth'
import { SkeletonTileContent, SkeletonTable } from '../components/Skeleton'
import { useFlagged } from '../hooks/useFlagged'
import { useAuth } from '../context/AuthContext'
import { prefetchBars, prefetchBarOnIntent } from '../utils/prefetchBars'
import { formatETFull } from '../utils/timeAgo'
import useBreadthCustomize from './breadth/useBreadthCustomize'
import { useLiveBreadth, formatLiveClock } from '../hooks/useLiveBreadth'
import { drillTarget } from './breadth/liveDrill'
import LiveSessionStrip from './breadth/LiveSessionStrip'
import DailyOverview from './breadth/DailyOverview'
import CustomizePanel from './breadth/CustomizePanel'
import customizeStyles from './breadth/CustomizePanel.module.css'
import {
  pctColor, pairedUpColor, pairedDnColor, getMaStackTier,
  TIER_SCORES, TIER_LABELS, TIER_TIP_COLORS, TIER_CELL_COLORS,
  HM_METRICS, HM_METRICS_BY_KEY, FFILL_KEYS, PCTILE_KEYS, TREEMAP_DEF,
} from './breadth/heatmapMetrics'
import BreadthViews from './breadth/BreadthViews'

// The metric registry moved to breadth/heatmapMetrics.js (2026-07-22) so the
// /charts Breadth widget can use it without bundling this whole page. Re-export
// everything so existing importers (BreadthViews, TreemapView, InternalsRender)
// keep working unchanged.
export {
  TIER_SCORES, TIER_LABELS, TIER_TIP_COLORS, TIER_CELL_COLORS,
  HM_METRICS, HM_METRICS_BY_KEY, FFILL_KEYS, PCTILE_KEYS, TREEMAP_DEF,
}
import useBreadthGrouping from './breadth/grouping/useBreadthGrouping'
import GroupControls from './breadth/grouping/GroupControls'
import GroupSummaryStrip from './breadth/grouping/GroupSummaryStrip'
import UIcon from '../components/ui/UIcon'
import PageHeader from '../components/PageHeader'

// The SAME chart the /charts workspace renders — identity row, session
// toggle, market clock, timeframe bar, market-cap/earnings/UCT-rating meta,
// settings gear and drawing tools. Lazy, so none of it lands in the eager
// entry chunk.
const ChartPane = lazy(() => import('../components/chart/pane/ChartPane'))

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

// pctColor / pairedUpColor / pairedDnColor / getMaStackTier moved to
// breadth/heatmapMetrics.js (imported above) — shared with the /charts widget.

// The Views tab reads windows the monitor never needs — a lens over 90 sessions
// can only ever say "not in the last 90", never "last fired in March". Each tab
// keeps its own window so switching tabs never moves the other one.
export const VIEWS_DAY_CHOICES = [90, 180, 365]
export const OTHER_DAY_CHOICES = [30, 60, 90]

export const COLS = [
  // ── Score ─────────────────────────────────────────────────────────────────
  { key: 'breadth_score', label: 'Health', group: G.SCORE,
    fmt: v => fmtDec(v, 0),
    colorFn: v => v == null ? '' : v >= 80 ? 'g3' : v >= 65 ? 'g2' : v >= 52 ? 'g1' : v >= 45 ? 'a' : v >= 35 ? 'r1' : v >= 20 ? 'r2' : 'r3' },
  { key: 'uct_exposure', label: 'UCT Exp', group: G.SCORE, fmt: v => fmtDec(v, 0),
    colorFn: v => v == null ? '' : v >= 110 ? 'g3' : v >= 90 ? 'g2' : v >= 70 ? 'g1' : v >= 50 ? 'a' : v >= 30 ? 'r1' : v >= 15 ? 'r2' : 'r3' },

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
  // Stockbee MM: 20%+ move over a rolling 5-session window
  { key: 'up_20pct_5d', label: 'Up20%/5d', group: G.PRIMARY,
    rowColorFn: row => pairedUpColor(row.up_20pct_5d, row.down_20pct_5d),
    drillKey: 'up_20pct_5d_list' },
  { key: 'down_20pct_5d', label: 'Dn20%/5d', group: G.PRIMARY,
    rowColorFn: row => pairedDnColor(row.up_20pct_5d, row.down_20pct_5d),
    drillKey: 'down_20pct_5d_list' },
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
  // MA stack only — see the note in heatmapMetrics.js. Minervini's full trend
  // template adds 52-week-low/high distance and an RS rating, so this counts
  // more names than the template would.
  { key: 'stage2_count', label: 'Stage 2 (MA Stack)', group: G.REGIME,
    rowColorFn: row => pairedUpColor(row.stage2_count, row.stage4_count),
    drillKey: 'stage2_list' },
  { key: 'stage4_count', label: 'Stage 4 (MA Stack)', group: G.REGIME,
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
  // Tiers re-derived 2026-08-06. new_ath used to be a 251-bar window over a
  // one-year frame — new_52w_highs by another name — and these thresholds were
  // calibrated on those inflated counts. The collector now sources a real
  // all-time high, which measures ~0.59x the old value on the live universe.
  { key: 'new_ath', label: 'ATH', group: G.HIGHS,
    colorFn: v => v == null ? '' : v > 120 ? 'g3' : v > 60 ? 'g2' : v > 25 ? 'g1' : '',
    drillKey: 'new_ath_list' },
  { key: 'hvc_52w', label: 'HVC', group: G.HIGHS,
    colorFn: v => v == null ? '' : v > 100 ? 'g3' : v > 40 ? 'g2' : v > 15 ? 'g1' : '',
    drillKey: 'hvc_52w_list' },
  // >N×ATR extended above the 50SMA (Jeff Sun extension). Strength/froth gauge —
  // graduated green; count thresholds are first-pass and tunable.
  { key: 'atr_ext_7', label: '>7×ATR', group: G.HIGHS,
    colorFn: v => v == null ? '' : v > 50 ? 'g3' : v > 30 ? 'g2' : v > 15 ? 'g1' : '',
    drillKey: 'atr_ext_7_list' },

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
      {copied ? <><UIcon name="check" size={13} style={{ verticalAlign: '-2px', marginRight: 4 }} />Copied</> : 'Copy List'}
    </button>
  )
}

// ── DrillModal ────────────────────────────────────────────────────────────
function DrillModal({ drill, latestDate, onClose }) {
  const items = drill.items ?? []
  // Paint the snapshot's own day white on each stock's chart so you can see the
  // bar that qualified it — UNLESS this is the most recent snapshot (its day is
  // already the live/rightmost candle, no need to flag it). Daily TF only; a
  // daily date won't match intraday/weekly bar times, so it simply no-ops there.
  const highlightDay = !drill.live && drill.date && drill.date !== latestDate ? drill.date : null
  // A live list is a moment inside an unfinished session, not a settled day —
  // stamping it with a date would read as final. Same helper the row's own
  // stamp uses, so the two can't drift apart.
  const whenLabel = drill.live ? `LIVE · ${formatLiveClock(drill.asOf)}` : drill.date
  const [selectedIdx, setSelectedIdx] = useState(0)
  const [chartPeriod, setChartPeriod] = useState('D')

  // Shared grouping toolkit (same engine used by CustomScan) — owns the
  // List|Grouped + Sector|Industry state, the industry/sector fetch, and the
  // grouped buckets / visible order / summary.
  const {
    viewMode, setViewMode, dimension, setDimension,
    grouped, visibleOrder, collapsedGroups, toggleGroupCollapse, summary,
  } = useBreadthGrouping(items, { tickerOf: i => i.t, pctOf: i => i.pct })

  // Reset the cursor whenever the view shape changes.
  useEffect(() => { setSelectedIdx(0) }, [viewMode, dimension])

  // When the drill list first loads, immediately prefetch ALL tickers into the
  // browser's SWR cache. For tickers already in server SQLite (the vast majority),
  // each request returns in <5ms via stale-while-revalidate. This means all 95+
  // items are client-cached before the user clicks any of them → zero spinner.
  const prefetchedListRef = useRef(null)
  useEffect(() => {
    if (!items.length || prefetchedListRef.current === items) return
    prefetchedListRef.current = items
    prefetchBars(items.map(i => i.t), 'D')
  }, [items])

  // Sliding window ahead of cursor for arrow-key scanning (keeps adjacent tickers hot).
  useEffect(() => {
    if (!items.length) return
    const t = setTimeout(() => {
      const start = Math.max(0, selectedIdx - 1)
      const end   = Math.min(items.length, selectedIdx + 4)
      prefetchBars(items.slice(start, end).map(i => i.t), chartPeriod)
    }, 250)
    return () => clearTimeout(t)
  }, [selectedIdx, items, chartPeriod])
  const [flagToast, setFlagToast] = useState(null)
  const { isFlagged, toggle: toggleFlag } = useFlagged()
  const rowRefs = useRef([])
  // Group-header refs (keyed by group key) so the summary strip can jump to a group.
  const groupRefs = useRef({})
  const pendingScrollKey = useRef(null)

  // Jump to a group when its chip is clicked in the summary strip. If the group
  // is collapsed, expand it first, then scroll once the rows have rendered.
  const jumpToGroup = useCallback(key => {
    if (collapsedGroups.has(key)) {
      pendingScrollKey.current = key
      toggleGroupCollapse(key)
    } else {
      groupRefs.current[key]?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }
  }, [collapsedGroups, toggleGroupCollapse])

  // Complete a deferred jump after a collapsed group has expanded.
  useEffect(() => {
    const key = pendingScrollKey.current
    if (key && !collapsedGroups.has(key)) {
      pendingScrollKey.current = null
      requestAnimationFrame(() => groupRefs.current[key]?.scrollIntoView({ behavior: 'smooth', block: 'start' }))
    }
  }, [collapsedGroups])

  // Clear flag toast after 1.5s
  useEffect(() => {
    if (!flagToast) return
    const t = setTimeout(() => setFlagToast(null), 1500)
    return () => clearTimeout(t)
  }, [flagToast])

  // Keyboard: Escape closes, arrows navigate, Shift+F flags selected ticker.
  // Nav operates over visibleOrder (grouped order, minus collapsed rows).
  useEffect(() => {
    const handler = e => {
      if (e.key === 'Escape') { onClose(); return }
      if (e.key === 'ArrowDown') { e.preventDefault(); setSelectedIdx(i => Math.min(i + 1, visibleOrder.length - 1)) }
      if (e.key === 'ArrowUp')   { e.preventDefault(); setSelectedIdx(i => Math.max(i - 1, 0)) }
      // ⛔ `(e.key === 'F' || e.key === 'f')` AND `!e.repeat` ARE BOTH LOAD-BEARING.
      // With CapsLock on, Shift+F yields the LOWERCASE 'f', so an 'F'-only test
      // silently stops flagging. And a held chord auto-repeats ~30x/sec, which on
      // a TOGGLE leaves the flag on whichever parity the release happens to catch.
      // Reported 2026-08-29.
      if (e.shiftKey && (e.key === 'F' || e.key === 'f') && !e.repeat) {
        setSelectedIdx(cur => {
          const sym = visibleOrder[cur]?.t
          if (sym) {
            const willFlag = !isFlagged(sym)
            toggleFlag(sym)
            setFlagToast(willFlag ? 'added' : 'removed')
          }
          return cur
        })
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose, visibleOrder, isFlagged, toggleFlag])

  // Clamp selection when the visible set shrinks (e.g. a group is collapsed)
  const safeIdx = Math.min(selectedIdx, Math.max(0, visibleOrder.length - 1))

  // Scroll selected row into view
  useEffect(() => {
    rowRefs.current[safeIdx]?.scrollIntoView({ block: 'nearest' })
  }, [safeIdx])

  const selected = visibleOrder[safeIdx]

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
              <span className={styles.drillSub}>{whenLabel}</span>
              {items.length > 0 && (
                <GroupControls
                  viewMode={viewMode}
                  setViewMode={setViewMode}
                  dimension={dimension}
                  setDimension={setDimension}
                />
              )}
              <CopyTickersButton items={grouped ? grouped.order : items} />
            </div>
          </div>
          <button className={styles.drillClose} onClick={onClose} aria-label="Close"><UIcon name="x" size={14} /></button>
        </div>

        <div className={styles.drillSplit}>
          {/* ── Left: table ── */}
          <div className={styles.drillTablePanel}>
            {!drill.items ? (
              <SkeletonTable rows={5} cols={3} />
            ) : items.length === 0 ? (
              <div className={styles.drillEmpty}>No stocks matched this filter {drill.live ? 'right now' : `on ${drill.date}`}.</div>
            ) : (
              <>
              {grouped && <GroupSummaryStrip summary={summary} dimension={dimension} onPick={jumpToGroup} />}
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
                  {(() => {
                    // Shared row renderer. flatIdx = position within visibleOrder
                    // so selection highlight, refs + ↑/↓ nav stay aligned in
                    // both List and Grouped modes.
                    const renderRow = (item, flatIdx) => {
                      const absPct = Math.abs(item.pct)
                      const rowHeat = item.pct >= 0
                        ? absPct >= 15 ? styles.drillHeatG3 : absPct >= 8 ? styles.drillHeatG2 : styles.drillHeatG1
                        : absPct >= 15 ? styles.drillHeatR3 : absPct >= 8 ? styles.drillHeatR2 : styles.drillHeatR1
                      const isSelected = flatIdx === safeIdx
                      return (
                        <tr
                          key={item.t}
                          ref={el => rowRefs.current[flatIdx] = el}
                          className={`${flatIdx % 2 === 0 ? styles.drillRowEven : styles.drillRowOdd} ${rowHeat} ${isSelected ? styles.drillRowSelected : ''}`}
                          onClick={() => setSelectedIdx(flatIdx)}
                          onPointerEnter={() => prefetchBarOnIntent(item.t, 'D')}
                          onFocus={() => prefetchBarOnIntent(item.t, 'D')}
                        >
                          <td className={styles.drillTdNum}>{flatIdx + 1}</td>
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
                    }

                    if (!grouped) return items.map((item, i) => renderRow(item, i))

                    // Grouped: industry header rows interleaved; flat counter
                    // only advances over rendered (non-collapsed) rows.
                    let flat = -1
                    return grouped.groups.map(g => {
                      const isCollapsed = collapsedGroups.has(g.key)
                      return (
                        <Fragment key={g.key}>
                          <tr
                            ref={el => groupRefs.current[g.key] = el}
                            className={styles.drillGroupRow}
                            onClick={() => toggleGroupCollapse(g.key)}
                          >
                            <td className={styles.drillGroupCell} colSpan={8}>
                              <span className={styles.drillGroupCaret}>{isCollapsed ? '▸' : '▾'}</span>
                              <span className={styles.drillGroupName}>{g.key}</span>
                              <span className={styles.drillGroupCount}>{g.count}</span>
                              <span className={g.avgPct >= 0 ? styles.drillGroupAvgUp : styles.drillGroupAvgDn}>
                                avg {g.avgPct > 0 ? '+' : ''}{g.avgPct.toFixed(1)}%
                              </span>
                            </td>
                          </tr>
                          {!isCollapsed && g.items.map(item => { flat += 1; return renderRow(item, flat) })}
                        </Fragment>
                      )
                    })
                  })()}
                </tbody>
              </table>
              </>
            )}
          </div>

          {/* ── Right: chart panel ── */}
          {selected && (
            <div className={styles.drillChartPanel}>
              <div className={styles.drillChartBar}>
                <span className={styles.drillChartSym}>{selected.t}</span>
                {selected.n && <span className={styles.drillChartName}>{selected.n}</span>}
                {flagToast && (
                  <span className={`${styles.flagToast} ${flagToast === 'added' ? styles.flagToastAdded : styles.flagToastRemoved}`}>
                    {flagToast === 'added' ? <><UIcon name="flag" size={13} style={{ verticalAlign: '-2px', marginRight: 4 }} />Flagged</> : <><UIcon name="flag" size={13} style={{ verticalAlign: '-2px', marginRight: 4 }} />Removed</>}
                  </span>
                )}
                <button
                  className={`${styles.drillFlagBtn}${isFlagged(selected.t) ? ' ' + styles.drillFlagBtnActive : ''}`}
                  onClick={() => { const willFlag = !isFlagged(selected.t); toggleFlag(selected.t); setFlagToast(willFlag ? 'added' : 'removed') }}
                  title={isFlagged(selected.t) ? 'Remove from Flagged (Shift+F)' : 'Add to Flagged (Shift+F)'}
                ><UIcon name="flag" size={13} style={{ verticalAlign: '-2px', marginRight: 5 }} />{isFlagged(selected.t) ? 'Flagged' : 'Flag'}</button>
                {/* The period tab row used to live here. Retired: ChartPane
                    (below) renders the canonical timeframe bar now.
                    `chartPeriod`/`setChartPeriod` stay — the prefetch effect
                    above still reads chartPeriod, and ChartPane's onTfChange
                    keeps it in sync with whatever the user picks. */}
                <span className={styles.drillChartHint}>↑ ↓ to navigate</span>
              </div>
              <div className={styles.drillChartFrame}>
                {/* The SAME chart the /charts workspace renders — identity
                    row, session toggle, market clock, timeframe bar,
                    market-cap/earnings/UCT-rating meta, settings gear and
                    drawing tools. `onSymbolChange` is deliberately omitted:
                    the symbol comes from the drill-list row the user
                    selected, so the identity row is a static label, not a
                    search box. */}
                <Suspense fallback={<div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--text-muted, #777)', fontSize: 12 }}>Loading chart…</div>}>
                  <ChartPane
                    sym={selected.t}
                    tf={chartPeriod}
                    onTfChange={setChartPeriod}
                    stored={null}
                    stockChartProps={{
                      highlightBarTime: chartPeriod === 'D' ? highlightDay : null,
                      highlightColor: '#ffffff',
                    }}
                  />
                </Suspense>
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

// TIER_SCORES / TIER_LABELS / TIER_TIP_COLORS moved to breadth/heatmapMetrics.js
// (imported + re-exported above).

// Y-axis label colors per group
const HM_GROUP_COLORS = {
  Score: '#c9a84c', Primary: '#b8c94a', MA: '#4ac97d',
  Regime: '#7b9fc7', 'Highs/Lows': '#c9944a', Sentiment: '#b44ac9',
}

// HM_METRICS / FFILL_KEYS / PCTILE_KEYS / TIER_CELL_COLORS / HM_METRICS_BY_KEY /
// TREEMAP_DEF moved to breadth/heatmapMetrics.js (imported + re-exported above).

// ── Analogues labels ──────────────────────────────────────────────────────
const ANALOGUE_METRIC_LABELS = {
  breadth_score: 'Health Score',
  uct_exposure: 'UCT Exposure',
  pct_above_50sma: '% > 50 SMA',
  pct_above_200sma: '% > 200 SMA',
  vix: 'VIX',
  mcclellan_osc: 'McClellan',
  ratio_5day: '5D Ratio',
  new_52w_highs: '52W Highs (Close)',
  new_52w_lows: '52W Lows (Close)',
  cnn_fear_greed: 'CNN F/G',
  aaii_spread: 'AAII B-B',
  sp500_close: 'S&P 500',
}

const FWD_LABELS = { fwd_5d: '5D', fwd_10d: '10D', fwd_20d: '20D', fwd_60d: '60D' }

function AnalogueCard({ analogue, refMetrics }) {
  const { date, similarity, metrics_then, forward_returns } = analogue
  return (
    <div className={styles.analogueCard}>
      <div className={styles.analogueCardHeader}>
        <span className={styles.analogueDate}>{date}</span>
        <span className={styles.analogueSim}>{similarity}% match</span>
      </div>

      {/* Forward SPY returns */}
      <div className={styles.analogueFwd}>
        {Object.entries(FWD_LABELS).map(([k, label]) => {
          const val = forward_returns[k]
          if (val == null) return (
            <div key={k} className={styles.analogueFwdItem}>
              <span className={styles.analogueFwdLabel}>{label}</span>
              <span className={styles.analogueFwdVal}>--</span>
            </div>
          )
          return (
            <div key={k} className={styles.analogueFwdItem}>
              <span className={styles.analogueFwdLabel}>{label}</span>
              <span className={`${styles.analogueFwdVal} ${val >= 0 ? styles.analogueGreen : styles.analogueRed}`}>
                {val > 0 ? '+' : ''}{val}%
              </span>
            </div>
          )
        })}
      </div>

      {/* Key metrics comparison */}
      <div className={styles.analogueMetrics}>
        {Object.entries(ANALOGUE_METRIC_LABELS).map(([key, label]) => {
          const then = metrics_then[key]
          const now = refMetrics[key]
          if (then == null) return null
          const fmtV = v => {
            if (v == null) return '--'
            if (key === 'sp500_close') return Number(v).toLocaleString('en-US', { maximumFractionDigits: 0 })
            return Number(v).toFixed(key === 'ratio_5day' ? 2 : key === 'vix' ? 1 : 0)
          }
          return (
            <div key={key} className={styles.analogueMetricRow}>
              <span className={styles.analogueMetricLabel}>{label}</span>
              <span className={styles.analogueMetricVal}>{fmtV(then)}</span>
              <span className={styles.analogueMetricNow}>now {fmtV(now)}</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function BreadthAnalogues() {
  const { data, isLoading, error } = useSWR(
    '/api/breadth-monitor/analogues',
    fetcher,
    { refreshInterval: 6 * 60 * 60 * 1000 }  // 6 hours
  )

  const analogues = data?.analogues ?? []
  const refDate = data?.reference_date
  const refMetrics = data?.reference_metrics ?? {}

  // Find the best forward narrative
  const bestNarrative = useMemo(() => {
    if (!analogues.length) return null
    const top = analogues[0]
    const fwd20 = top.forward_returns?.fwd_20d
    if (fwd20 == null) return null
    const dir = fwd20 >= 0 ? 'gained' : 'lost'
    return `Last time breadth looked like this was ${top.date} — SPY ${dir} ${Math.abs(fwd20)}% over the next month`
  }, [analogues])

  if (isLoading) {
    return <div className={styles.analoguesWrap}><SkeletonTileContent lines={4} /></div>
  }

  if (error) {
    return (
      <div className={styles.analoguesWrap}>
        <div className={styles.analoguesEmpty}>Could not load analogues — {error.message ?? 'network error'}</div>
      </div>
    )
  }

  if (!analogues.length) {
    return (
      <div className={styles.analoguesWrap}>
        <div className={styles.analoguesEmpty}>
          Not enough historical breadth data to compute analogues. Need at least 20 trading days.
        </div>
      </div>
    )
  }

  return (
    <div className={styles.analoguesWrap}>
      <div className={styles.analoguesHeader}>
        <h2 className={styles.analoguesTitle}>Historical Analogues</h2>
        <span className={styles.analoguesSub}>
          Matching against {refDate}
        </span>
      </div>

      {bestNarrative && (
        <div className={styles.analoguesNarrative}>{bestNarrative}</div>
      )}

      <div className={styles.analoguesGrid}>
        {analogues.map(a => (
          <AnalogueCard key={a.date} analogue={a} refMetrics={refMetrics} />
        ))}
      </div>

      <div className={styles.analoguesFooter}>
        Similarity computed via weighted normalized Euclidean distance on {Object.keys(ANALOGUE_METRIC_LABELS).length}+ breadth metrics.
        Forward returns show SPY performance after each historical match date. Past performance does not predict future results.
        <br />
        <em>* This view will become more useful as the historical breadth dataset grows over the coming months and years.</em>
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

// Shared tab strip (DRY — was duplicated across every render branch). On mobile
// it scrolls horizontally as a chip strip. Monitor leads — it's what people
// come for. "Overview" stays the mobile-default readable landing but sits
// demoted in the strip.
const BREADTH_TAB_ITEMS = [
  { key: 'breadth', label: 'Monitor' },
  { key: 'heatmap', label: 'Views' },
  { key: 'overview', label: 'Daily' },
  { key: 'cot', label: 'COT Data' },
  { key: 'charts', label: 'Data Charts' },
]
function BreadthTabs({ active, onChange, isAdmin }) {
  const items = isAdmin ? [...BREADTH_TAB_ITEMS, { key: 'analogues', label: 'Analogues' }] : BREADTH_TAB_ITEMS
  return (
    <div className={styles.tabs}>
      {items.map((t) => (
        <button
          key={t.key}
          className={`${styles.tab} ${active === t.key ? styles.tabActive : ''}`}
          onClick={() => onChange(t.key)}
        >
          {t.label}
        </button>
      ))}
    </div>
  )
}

export default function Breadth() {
  const { user } = useAuth()
  const isAdmin = user?.role === 'admin'
  // Phones land on the readable Overview; desktop/tablet keep the Monitor.
  const [activeTab, setActiveTab] = useState(() => {
    try { return window.matchMedia('(max-width: 640px)').matches ? 'overview' : 'breadth' }
    catch { return 'breadth' }
  })
  const [days, setDays] = useState(90)
  const [viewsDays, setViewsDays] = useState(90)
  const isViewsTab = activeTab === 'heatmap'
  const effectiveDays = isViewsTab ? viewsDays : days

  useEffect(() => {
    if (activeTab === 'analogues' && !isAdmin) setActiveTab('breadth')
  }, [activeTab, isAdmin])
  const { data, isLoading, error } = useSWR(
    `/api/breadth-monitor?days=${effectiveDays}`,
    fetcher,
    { refreshInterval: 5 * 60 * 1000 }
  )
  const [collapsedCols, setCollapsedCols] = useState(() => {
    try {
      const raw = localStorage.getItem('breadth_collapsed_cols')
      return raw ? new Set(JSON.parse(raw)) : new Set()
    } catch { return new Set() }
  })

  const customize = useBreadthCustomize()
  const [customizeOpen, setCustomizeOpen] = useState(false)
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

  // Takes the ROW, not a date: only the row knows whether it is the live one,
  // and `drillTarget` needs that to pick between the live endpoint, the dated
  // one, and the session a carried metric came from.
  const openDrill = useCallback((row, col, live = null) => {
    const target = drillTarget(row, col, live)
    if (!target) return
    setDrill({ date: target.date, label: col.label, live: target.live,
               asOf: target.live ? live?.asOf ?? null : null, items: null })
    fetch(target.url)
      .then(r => r.json())
      .then(data => setDrill(prev => prev ? { ...prev, items: data.items ?? [] } : null))
      .catch(() => setDrill(prev => prev ? { ...prev, items: [] } : null))
  }, [])

  const AAII_KEYS = new Set(['aaii_bulls', 'aaii_neutral', 'aaii_bears', 'aaii_spread'])

  const storedRows = data?.rows ?? []

  // Intraday breadth sits ON TOP of the stored history, never in place of it.
  // The backend withholds the live read the moment the 4:15 collector writes
  // today's row, so an estimate never sits beside the number it estimated.
  const liveBreadth = useLiveBreadth({ enabled: activeTab === 'breadth' || activeTab === 'heatmap' || activeTab === 'overview' })
  const rows = useMemo(
    () => (liveBreadth.row ? [liveBreadth.row, ...storedRows] : storedRows),
    [liveBreadth.row, storedRows],
  )

  const lastUpdated = storedRows[0]?._created_at
    ? formatETFull(storedRows[0]._created_at + 'Z')
    : null

  const liveClock = liveBreadth.clock ?? 'LIVE'
  const liveTitle = liveBreadth.row
    ? `Provisional — computed ${liveClock} ET across ${liveBreadth.measured ?? '—'} names. `
      + `The 4:15 PM collector writes the day's authoritative row.`
    : undefined
  const visibleCols = useMemo(
    () => COLS.filter(col => !customize.hidden.has(col.key)),
    [customize.hidden],
  )
  // First visible column of each metric family after the first — a hairline
  // rule keeps the families scannable now that the colored group-header row
  // is gone.
  const groupStartKeys = useMemo(() => {
    const keys = new Set()
    visibleCols.forEach((col, i) => {
      if (i > 0 && col.group !== visibleCols[i - 1].group) keys.add(col.key)
    })
    return keys
  }, [visibleCols])

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

  if (activeTab === 'overview') {
    return (
      <div className={styles.page}>
        <PageHeader icon="breadth" title="Breadth">
          <BreadthTabs active={activeTab} onChange={setActiveTab} isAdmin={isAdmin} />
        </PageHeader>
        <div className={styles.overviewBody}>
          <DailyOverview rows={rows} live={liveBreadth} cols={COLS}
                         phaseClassFn={phaseClass} onDrill={openDrill} />
          <MarketBreadth />
        </div>
        {drill && <DrillModal drill={drill} latestDate={rows[0]?.date} onClose={() => setDrill(null)} />}
      </div>
    )
  }

  if (activeTab === 'cot') {
    return (
      <div className={`${styles.page} ${styles.pageCot}`}>
        <PageHeader icon="breadth" title="Breadth" className={styles.cotTabHeader}>
          <BreadthTabs active={activeTab} onChange={setActiveTab} isAdmin={isAdmin} />
        </PageHeader>
        <CotData />
      </div>
    )
  }

  if (activeTab === 'charts') {
    return (
      <div className={styles.page}>
        <PageHeader icon="breadth" title="Breadth">
          <BreadthTabs active={activeTab} onChange={setActiveTab} isAdmin={isAdmin} />
        </PageHeader>
        <BreadthCharts />
      </div>
    )
  }

  if (activeTab === 'analogues' && isAdmin) {
    return (
      <div className={styles.page}>
        <PageHeader icon="breadth" title="Breadth">
          <BreadthTabs active={activeTab} onChange={setActiveTab} isAdmin={isAdmin} />
        </PageHeader>
        <BreadthAnalogues />
      </div>
    )
  }

  return (
    <div className={styles.page}>
      <PageHeader icon="breadth" title="Breadth">
        <BreadthTabs active={activeTab} onChange={setActiveTab} isAdmin={isAdmin} />
        <span className={styles.meta}>
          {rows.length > 0
            ? `${rows.length} trading days${lastUpdated ? ` · updated ${lastUpdated}` : ''}`
            : isLoading ? 'Loading…' : 'No data'}
        </span>
        <div className={styles.daysPills}>
          {(isViewsTab ? VIEWS_DAY_CHOICES : OTHER_DAY_CHOICES).map(d => (
            <button
              key={d}
              className={`${styles.daysPill} ${effectiveDays === d ? styles.daysPillActive : ''}`}
              onClick={() => (isViewsTab ? setViewsDays(d) : setDays(d))}
            >
              {d}d
            </button>
          ))}
        </div>
        {activeTab !== 'heatmap' && (
          <>
            {activeTab === 'breadth' && (
              <div className={customizeStyles.anchor}>
                <button
                  className={`${customizeStyles.triggerBtn} ${customizeOpen ? customizeStyles.triggerBtnActive : ''}`}
                  onClick={() => setCustomizeOpen(o => !o)}
                  title="Customize which metrics show in the sheet"
                >
                  <span className={customizeStyles.triggerIcon}><UIcon name="gear" size={14} /></span>
                  Customize
                </button>
                {customizeOpen && (
                  <CustomizePanel
                    cols={COLS}
                    activePreset={customize.activePreset}
                    hidden={customize.hidden}
                    presetNames={customize.presetNames}
                    isDefaultActive={customize.isDefaultActive}
                    onToggleHidden={customize.toggleHidden}
                    onSavePreset={customize.savePreset}
                    onRenamePreset={customize.renamePreset}
                    onDeletePreset={customize.deletePreset}
                    onSwitchPreset={customize.switchPreset}
                    onResetActive={customize.resetActive}
                    onClose={() => setCustomizeOpen(false)}
                  />
                )}
              </div>
            )}
            <button
              className={styles.exportBtn}
              onClick={() => exportCsv(rows, visibleCols)}
              title="Download as CSV"
            >
              ↓ CSV
            </button>
          </>
        )}
      </PageHeader>

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
        <BreadthViews rows={rows} onDrill={openDrill} live={liveBreadth} liveStamp={liveClock} />
      )}

      {rows.length > 0 && activeTab === 'breadth' && visibleCols.length === 0 && (
        <div className={styles.empty}>
          All metrics hidden — open <strong>Customize</strong> to show some.
        </div>
      )}

      {/* Every row below describes a finished day. None of them can say what
          today is doing, because today isn't a row yet — this is that answer,
          and it disappears the moment the 4:15 collector makes it one. */}
      {activeTab === 'breadth' && <LiveSessionStrip live={liveBreadth} />}

      {rows.length > 0 && activeTab === 'breadth' && visibleCols.length > 0 && (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              {/* Single column-label row — the colored group-header strip was
                  retired 2026-08-26; families are separated by a hairline rule
                  on each group's first column instead. */}
              <tr>
                <th className={`${styles.th} ${styles.dateCol}`}>Date</th>
                {visibleCols.map(col => {
                  const isColCollapsed = collapsedCols.has(col.key)
                  return (
                    <th
                      key={col.key}
                      title={isColCollapsed ? `Click to expand ${col.label}` : `Click to collapse ${col.label}`}
                      className={`${styles.th} ${styles.colLabel} ${styles.colLabelClickable} ${isColCollapsed ? styles.colLabelCollapsed : ''} ${groupStartKeys.has(col.key) ? styles.groupStart : ''}`}
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
                <tr key={row.date} className={`${ri % 2 === 0 ? styles.rowEven : styles.rowOdd} ${phaseClass(row.webster_phase ?? row.market_phase, styles)} ${row._live ? styles.liveRow : ''}`}>
                  <td className={`${styles.td} ${styles.dateCell}`}>
                    {row._live
                      ? (
                        <span className={styles.liveStamp} title={liveTitle}>
                          <span className={styles.livePulse} aria-hidden="true" />
                          {liveClock}
                        </span>
                      )
                      : row.date}
                  </td>
                  {visibleCols.map(col => {
                    const groupStart = groupStartKeys.has(col.key) ? styles.groupStart : ''
                    if (collapsedCols.has(col.key)) {
                      return <td key={col.key} className={`${styles.td} ${styles.colCollapsedCell} ${groupStart}`} />
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
                                    {v === null || v === undefined ? '—' : isCheck ? <UIcon name="check" size={12} /> : <UIcon name="x" size={12} />}
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
                    // A live cell drills what was MEASURED live; a carried one
                    // drills the session its number came from. `drillTarget`
                    // owns that choice so the tiles below make it identically.
                    const drillTo = drillTarget(row, col, liveBreadth)
                    const isDrillable = !!drillTo
                    // A number carried from last night is not a live reading,
                    // and one that reconciles to ~8% should not look like one
                    // that reconciles to a point.
                    const liveGrade = row._live
                      ? (liveBreadth.carried?.has(col.key) ? 'carried'
                        : liveBreadth.accuracy?.[col.key] ?? null)
                      : null
                    return (
                      <td
                        key={col.key}
                        className={`${styles.td} ${cellClass(col, val, row)} ${isStaleAaii ? styles.aaiiStale : ''} ${isDrillable ? styles.drillable : ''} ${liveGrade === 'carried' ? styles.liveCarried : ''} ${liveGrade === 'approximate' ? styles.liveApprox : ''}`}
                        title={
                          liveGrade === 'carried'
                            ? `Last night's reading (${liveBreadth.carriedFrom}) — not live`
                            : liveGrade === 'approximate'
                              ? 'Provisional, reconciles to roughly 10%'
                              : liveBreadth.partial?.has(col.key) && row._live
                                ? 'Builds through the session — only complete at the close'
                                : isStaleAaii ? `Survey: ${row.aaii_survey_date}`
                                  : isDrillable ? 'Click to see stocks' : undefined
                        }
                        onClick={isDrillable ? () => openDrill(row, col, liveBreadth) : undefined}
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
      {drill && <DrillModal drill={drill} latestDate={rows[0]?.date} onClose={() => setDrill(null)} />}
    </div>
  )
}
