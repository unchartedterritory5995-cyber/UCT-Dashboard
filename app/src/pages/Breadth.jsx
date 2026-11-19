import { useState, useMemo, useEffect, useLayoutEffect, useCallback, useRef, Suspense } from 'react'
import { lazyDeferrable } from '../utils/lazyWithRetry'
import { useSearchParams } from 'react-router-dom'
import useSWR, { useSWRConfig } from 'swr'
import { useVirtualizer } from '@tanstack/react-virtual'
import styles from './Breadth.module.css'
import CotData from './CotData'
import BreadthCharts from './BreadthCharts'
import TickerPopup from '../components/TickerPopup'
import MarketBreadth from '../components/tiles/MarketBreadth'
import { SkeletonTileContent } from '../components/Skeleton'
import { useAuth } from '../context/AuthContext'
import { formatETFull } from '../utils/timeAgo'
// The chart's own UCT Signature floating menu (`signature`): the Monitor's header
// menu and its ⋯ menu wear exactly its panel and rows.
import ContextPopover from '../components/mobile/ContextPopover'
import useBreadthCustomize from './breadth/useBreadthCustomize'
import { useLiveBreadth } from '../hooks/useLiveBreadth'
import { drillTarget } from './breadth/liveDrill'
import { shadeFor } from './breadth/shading'
import { defaultsFor } from './breadth/defaultColumns'
import { columnInfo } from './breadth/columnInfo'
import { fetchDrill, peekDrill, prefetchDrill, forgetDrill } from './breadth/drillFetch'
import LiveSessionStrip from './breadth/LiveSessionStrip'
import BreadthDateNav from './breadth/BreadthDateNav'
import useMonitorGrid from './breadth/useMonitorGrid'
import ScreenshotPopover from '../components/chart/ScreenshotPopover'
import { downloadBreadthSnapshot, copyBreadthSnapshot, copyBreadthShareUrl } from './breadth/breadthShare'
import DailyOverview from './breadth/DailyOverview'
import ColumnsMenu from './breadth/ColumnsMenu'
import customizeStyles from './breadth/CustomizePanel.module.css'
import {
  pctColor, pairedUpColor, pairedDnColor, getMaStackTier,
  TIER_SCORES, TIER_LABELS, TIER_TIP_COLORS, TIER_CELL_COLORS,
  HM_METRICS, HM_METRICS_BY_KEY, FFILL_KEYS, PCTILE_KEYS, TREEMAP_DEF,
} from './breadth/heatmapMetrics'
import BreadthViews from './breadth/BreadthViews'
import UnmountReporter from './breadth/UnmountReporter'
import useBreadthUrlState from './breadth/useBreadthUrlState'
import useBreadthHubSection, { resolveBreadthTabs } from '../hub/sections/breadthSection'
import { naaimAge } from './breadth/naaimAge'
import FreshnessBadge from '../components/provenance/FreshnessBadge'
import { aaiiAge, dailyCarryAge, storedSessionFresh } from './breadth/sentimentAge'

// The metric registry moved to breadth/heatmapMetrics.js (2026-07-22) so the
// /charts Breadth widget can use it without bundling this whole page. Re-export
// everything so existing importers (BreadthViews, TreemapView, InternalsRender)
// keep working unchanged.
export {
  TIER_SCORES, TIER_LABELS, TIER_TIP_COLORS, TIER_CELL_COLORS,
  HM_METRICS, HM_METRICS_BY_KEY, FFILL_KEYS, PCTILE_KEYS, TREEMAP_DEF,
}
import SurfaceHeader from './SurfaceHeader'
import { useInTerminalPanel, PanelState } from '../components/terminal'
import jsonFetcher from '../utils/jsonFetcher'
import { formatNumber, formatNumberMax, formatPercentAsSent } from '../lib/presentation/presentationPrimitives'
import { AgentDockButton } from '../agent/AgentProvider'
import { useBreadthAgentHost } from '../agent/hosts/usePageAgentHosts'

// The SAME chart the /charts workspace renders — identity row, session
// toggle, market clock, timeframe bar, market-cap/earnings/UCT-rating meta,
// settings gear and drawing tools. Lazy, so none of it lands in the eager
// entry chunk.
const ChartPane = lazyDeferrable(() => import('../components/chart/pane/ChartPane'))

// Throws on a non-2xx / network / 30 s deadline (jsonFetcher). The bare `r.json()` turned a
// 402 or 5xx {detail} into a payload with no rows, which read "No data yet. Run python ...".
const fetcher = url => jsonFetcher(url)

/** Member copy for a failed breadth read; never the raw error text. */
export function breadthErrorText(error, what = 'Breadth data') {
  if (error?.status === 402) return `${what} requires a paid plan.`
  return `${what} could not be read right now. That is a gap in what we could read, not a market reading.`
}

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
// The Monitor sheet no longer offers 30/60/90 window pills — its Time Navigator
// (date box) drives WHERE the fixed window ends instead of how wide it is. This
// is the fixed span it always shows (was the 90d default the pills topped out at).
export const MONITOR_WINDOW = 90
// Fixed Monitor row height in px — must match `.table` --br-row-h in Breadth.module.css.
// A fixed height keeps virtual scroll-to-index pixel-exact across the whole timeline.
export const MONITOR_ROW_H = 32
// Wide screens (owner 2026-11-19): the sheet is ~10% larger at this width and up —
// the SAME query as the `@media (min-width: 1700px)` block in Breadth.module.css.
export const MONITOR_WIDE_QUERY = '(min-width: 1700px)'
export const MONITOR_ROW_H_WIDE = 35

/** The active Monitor row height: follows the wide-screen breakpoint live, so the
 *  virtualizer's fixed size always equals the CSS row height. */
function useMonitorRowH() {
  const read = () => (typeof window !== 'undefined' && window.matchMedia?.(MONITOR_WIDE_QUERY).matches
    ? MONITOR_ROW_H_WIDE : MONITOR_ROW_H)
  const [h, setH] = useState(read)
  useEffect(() => {
    const mq = typeof window !== 'undefined' ? window.matchMedia?.(MONITOR_WIDE_QUERY) : null
    if (!mq) return undefined
    const on = () => setH(mq.matches ? MONITOR_ROW_H_WIDE : MONITOR_ROW_H)
    mq.addEventListener?.('change', on)
    return () => mq.removeEventListener?.('change', on)
  }, [])
  return h
}

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
  { key: 'pct_above_20sma',  label: '>20SMA',   group: G.MA, fmt: fmtPct,
    colorFn: pctColor(35, 50, 65) },
  { key: 'pct_above_40sma',  label: '>40SMA',   group: G.MA, fmt: fmtPct,
    colorFn: pctColor(35, 50, 65) },
  { key: 'pct_above_50sma',  label: '>50SMA',   group: G.MA, fmt: fmtPct,
    colorFn: pctColor(35, 50, 65) },
  { key: 'pct_above_100sma', label: '>100SMA',  group: G.MA, fmt: fmtPct,
    colorFn: pctColor(35, 50, 65) },
  { key: 'pct_above_150sma', label: '>150SMA',  group: G.MA, fmt: fmtPct,
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
  // Round 13 (owner 2026-11-19): metrics already in every stored row, now columns.
  // Distribution days: the Morning Wire's count (api/services/breadth_eod_extras.py).
  { key: 'spy_dist_days', label: 'Dist Days', group: G.REGIME, fmt: fmtInt },
  { key: 'qqq_dist_days', label: 'QQQ Dist Days', group: G.REGIME, fmt: fmtInt },
  { key: 'rsp_spy_ratio', label: 'RSP/SPY', group: G.REGIME, fmt: v => fmtDec(v, 4) },
  { key: 'iwm_qqq_ratio', label: 'IWM/QQQ', group: G.REGIME, fmt: v => fmtDec(v, 4) },
  { key: 'vix_term_structure', label: 'VIX Term', group: G.REGIME, fmt: v => fmtDec(v, 2) },

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
  { key: 'net_new_high_low', label: 'Net NH-NL', group: G.HIGHS, fmt: fmtSigned },
  { key: 'near_52w_high', label: 'Near 52W Hi', group: G.HIGHS },
  { key: 'hi_ratio', label: '52W Hi %', group: G.HIGHS, fmt: v => fmtDec(v, 2) },
  { key: 'lo_ratio', label: '52W Lo %', group: G.HIGHS, fmt: v => fmtDec(v, 2) },

  // ── Volume / A-D (round 13) ───────────────────────────────────────────────
  { key: 'adv_decline', label: 'A/D', group: G.VOLUME, fmt: fmtSigned },
  { key: 'advancing', label: 'Advancing', group: G.VOLUME },
  { key: 'declining', label: 'Declining', group: G.VOLUME },
  { key: 'adv_decline_cum', label: 'A/D Line', group: G.VOLUME, fmt: fmtSigned },
  // Up volume ÷ down volume (a ratio, not a percent): breadth_live.compute_metrics.
  { key: 'up_vol_ratio', label: 'Up Vol', group: G.VOLUME, fmt: v => fmtDec(v, 2) },

  // ── Sentiment ─────────────────────────────────────────────────────────────
  { key: 'cnn_fear_greed', label: 'CNN F/G', group: G.SENTIMENT, fmt: v => fmtDec(v, 0),
    colorFn: v => v == null ? '' : v <= 15 ? 'g3' : v <= 25 ? 'g2' : v <= 40 ? 'g1' : v <= 60 ? 'a' : v <= 70 ? 'r1' : v <= 80 ? 'r2' : 'r3',
    // TERM-059: a print a heal CARRIED from an earlier session says so (breadth/sentimentAge.js).
    age: dailyCarryAge.cnn_fear_greed },
  // TERM-059: the weekly AAII survey states its own as-of at the value, like NAAIM.
  { key: 'aaii_bulls',    label: 'AAII Bulls', group: G.SENTIMENT, fmt: v => fmtDec(v, 1), age: aaiiAge.aaii_bulls },
  { key: 'aaii_neutral',  label: 'Neutral',    group: G.SENTIMENT, fmt: v => fmtDec(v, 1), age: aaiiAge.aaii_neutral },
  { key: 'aaii_bears',    label: 'AAII Bears', group: G.SENTIMENT, fmt: v => fmtDec(v, 1), age: aaiiAge.aaii_bears },
  { key: 'aaii_spread', label: 'B-B Sprd', group: G.SENTIMENT, fmt: v => fmtDec(v, 1), age: aaiiAge.aaii_spread },
  // TERM-059: the weekly survey states its own as-of AT THE VALUE. `age` hands
  // the cell TERM-006's verdict (freshnessAge.js) for this row; the cell only
  // renders it. See breadth/naaimAge.js for why "now" is the row's session.
  { key: 'naaim', label: 'NAAIM', group: G.SENTIMENT, fmt: v => fmtDec(v, 2), age: naaimAge },
  { key: 'cboe_putcall', label: 'CBOE P/C', group: G.SENTIMENT, fmt: v => fmtDec(v, 2), age: dailyCarryAge.cboe_putcall },
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
  return formatNumber(Number(v), { decimals: d, grouping: false })
}
function fmtPct(v) {
  if (v === null || v === undefined) return '—'
  return formatNumber(Number(v), { decimals: 1, grouping: false })
}
export function fmtPrice(v) {
  if (v === null || v === undefined) return '—'
  return formatNumberMax(Number(v), { maxDecimals: 2 })
}
function fmtBool(v) {
  if (v === null || v === undefined) return '—'
  return v === 1 ? '✓' : '✗'
}
// Signed counts (A/D, Net NH-NL, the A/D line): "+1,234" / "−663", thousands grouped.
function fmtSigned(v) {
  if (v === null || v === undefined) return '—'
  const n = Number(v)
  if (!Number.isFinite(n)) return '—'
  return `${n > 0 ? '+' : n < 0 ? '−' : ''}${formatNumber(Math.abs(n))}`
}
export function fmtInt(v) {
  if (v === null || v === undefined) return '—'
  return formatNumber(Number(v))
}

function fmtCell(col, val) {
  if (col.fmt) return col.fmt(val)
  if (val === null || val === undefined) return '—'
  if (Number.isInteger(val)) return fmtInt(val)
  return String(val)
}

// Round 5 (owner 2026-11-19): a cell is shaded by how RARE its reading is across
// all breadth history (frozen cutoffs, breadth/shading.js) at three levels, colored
// bullish / bearish. The tier ladders above (colorFn / rowColorFn) still drive the
// Daily tab and the Views; the Monitor reads `shadeFor` only.
// A carried (older-than-its-cadence) value's note, for the tooltip and the
// accessible name: "Weekly survey · as of 2026-03-04" / "Daily print · undated".
function carriedNote(age) {
  const kind = `${age.cadence ? age.cadence[0].toUpperCase() + age.cadence.slice(1) : 'Earlier'} ${age.dataClass === 'weekly' ? 'survey' : 'print'}`
  return age.asOfDate ? `${kind} · as of ${age.asOfDate}` : `${kind} · undated`
}

// ── Stable column widths (owner 2026-11-19) ──────────────────────────────────
// The Monitor's rows are virtualized, so an auto-layout table re-measured as rows
// mounted and a column jumped wide when an unusually long value scrolled in. Each
// header (always mounted) now carries a min-width from the widest value its FORMAT
// can print, in `ch` (tabular digits are ≤ 1ch; commas/dots narrower), plus the
// cell padding — so no row can ever be wider than its header, and the widths do not
// depend on which rows are on screen.
const VALUE_CH = {
  sp500_close: 8, qqq_close: 7,           // 0,000.00 · 000.00
  breadth_score: 3, uct_exposure: 3, cnn_fear_greed: 3,
  ratio_5day: 5, ratio_10day: 5, vix: 5, naaim: 7, cboe_putcall: 5,   // 00.00
  mcclellan_osc: 7,                        // -000.0
  aaii_bulls: 5, aaii_neutral: 5, aaii_bears: 5, aaii_spread: 6,
  is_ftd: 3,
  // round 13
  net_new_high_low: 6, adv_decline: 6,     // +0,000
  adv_decline_cum: 8,                      // +000,000
  up_vol_ratio: 5,                         // 00.00
  spy_dist_days: 2, qqq_dist_days: 2,
  rsp_spy_ratio: 6, iwm_qqq_ratio: 6,      // 0.0000
  vix_term_structure: 4,                   // 0.00
  hi_ratio: 5, lo_ratio: 5,                // 00.00
}
function valueCh(col) {
  if (VALUE_CH[col.key] != null) return VALUE_CH[col.key]
  if (col.fmt === fmtPct) return 5          // 100.0
  // Counts: a count of stocks can never exceed the universe (~2,700 names), so the
  // widest is four digits and a comma, "0,000" — 5ch, not a 6ch "00,000".
  return 5
}

// ── Equal widths per visual group (owner 2026-11-19, round 11) ───────────────
// Columns in one family share ONE width: the widest thing any VISIBLE member needs
// (its widest value format or its header label), plus its padding. One map, keyed by
// metric key, covers the default view and every family a member can turn on from
// Columns. A column with no group keeps its own width (FTD, McClellan; the
// SPY/QQQ dot columns are fixed at the same width already).
const WIDTH_GROUP = {
  breadth_score: 'core', uct_exposure: 'core', up_4pct_today: 'core', down_4pct_today: 'core',
  ratio_5day: 'ratio', ratio_10day: 'ratio',
  up_25pct_quarter: 'moveQ', down_25pct_quarter: 'moveQ', magna_up: 'moveQ', magna_down: 'moveQ',
  up_20pct_5d: 'moveQ', down_20pct_5d: 'moveQ',   // round 14: with the 25%/13% counts
  up_25pct_month: 'moveMo', down_25pct_month: 'moveMo', up_50pct_month: 'moveMo', down_50pct_month: 'moveMo',
  pct_above_5sma: 'sma', pct_above_10sma: 'sma', pct_above_20sma: 'sma', pct_above_40sma: 'sma',
  pct_above_50sma: 'sma', pct_above_100sma: 'sma', pct_above_150sma: 'sma', pct_above_200sma: 'sma',
  vix: 'vol', cnn_fear_greed: 'vol',
  sp500_close: 'close', qqq_close: 'close',
  stage2_count: 'stage', stage4_count: 'stage',
  new_52w_highs: 'hilo', new_52w_lows: 'hilo', new_20d_highs: 'hilo', new_20d_lows: 'hilo',
  new_ath: 'lead', hvc_52w: 'lead', atr_ext_7: 'lead',
  aaii_bulls: 'aaii', aaii_neutral: 'aaii', aaii_bears: 'aaii', aaii_spread: 'aaii',
  naaim: 'survey', cboe_putcall: 'survey',
  // round 13
  net_new_high_low: 'net', adv_decline: 'net',
  up_vol_ratio: 'volDist', spy_dist_days: 'volDist', qqq_dist_days: 'volDist',
  advancing: 'advdec', declining: 'advdec',
  rsp_spy_ratio: 'idxRatio', iwm_qqq_ratio: 'idxRatio',
  near_52w_high: 'hilo',
  hi_ratio: 'hiloPct', lo_ratio: 'hiloPct',
  // round 14: Universe sits last in the default; a group of its own drops the family-
  // start padding it would otherwise carry there (8px that made 2048 overflow by ~1px).
  universe_count: 'universe',
}
export const widthGroupOf = (key) => WIDTH_GROUP[key] ?? null

// A header's width: its group's measured need (or, ungrouped, its own natural width),
// plus the even share of the window's leftover width (round 13). Before the first
// measurement, the format-based minimum.
function colWidthStyle(col, isMa, { need, solo, extra }) {
  const g = widthGroupOf(col.key)
  const base = g ? need[g] : solo[col.key]
  if (base) { const w = base + extra; return { minWidth: w, width: w } }
  return isMa ? undefined : { minWidth: colMinWidth(col) }
}
// 32px = the cell padding (incl. a family start). The live "≈" sits in the padding.
// `ch` here is the HEADER font's; × --br-fs-ratio makes it the cell font's, and the
// padding follows --br-cell-px, so the widths scale with the wide-screen size too.
const colMinWidth = (col) => `calc(${valueCh(col)}ch * var(--br-fs-ratio, 1.087) + 2 * var(--br-cell-px, 12px) + 8px)`

function cellClass(col, val, row = null) {
  const s = shadeFor(col.key, row)
  return s ? styles[`sh${s.tone === 'bull' ? 'Up' : 'Dn'}${s.level}`] : ''
}

// A column's name in plain words + what it measures (breadth/columnInfo.js): the
// top of the header's click menu, and its screen-reader description.
function ColumnInfoBlock({ colKey }) {
  const info = columnInfo(colKey)
  if (!info) return null
  // In the chart menu's panel (ContextPopover `signature`), the description header is a
  // real title + readable body (owner round 10): its own classes, so the chart menu's
  // grey section labels (`groupLabel`) are untouched.
  return (
    <div className={styles.colInfo}>
      <div className={styles.colInfoName}>{info.name}</div>
      <div className={styles.colInfoDesc}>{info.desc}</div>
      {info.weekly && <div className={styles.colInfoDesc}>A weekly survey: it updates once a week.</div>}
    </div>
  )
}

// SPY / QQQ MA columns: the header shows just the symbol; the title says what the
// four dots are (owner 2026-11-17).
const maStackSym = (col) => col.label.split(' ')[0]
const maStackTitle = (col) => `${maStackSym(col)} above its ${col.maLabels.slice(0, -1).join(', ')} and ${col.maLabels[col.maLabels.length - 1]}-day averages`


// ── The drill modal ───────────────────────────────────────────────────────
// Clicking a breadth cell opens the REAL charts-workspace widgets — a watchlist
// widget holding the cell's constituents and the user's own chart widget, linked
// by colour group A. The bespoke table + bare ChartPane that used to live here
// (CopyTickersButton, DrillModal, ~320 lines) are deleted: the whole point is that
// this surface is not a lookalike of those widgets, it IS them.
// Lazy so the breadth bundle does not pull the charts workspace until a cell is
// actually clicked.
// The window's code is fetched ahead of the click (on idle, and on hovering a
// cell) so opening it never waits on a chunk download.
const loadDrillModal = () => import('./breadth/drill/BreadthDrillModal')
const BreadthDrillModal = lazyDeferrable(loadDrillModal)
function preloadDrillModal() { loadDrillModal().catch(() => {}) }

// ── COLS lookup map ────────────────────────────────────────────────────────
const COLS_BY_KEY = Object.fromEntries(COLS.map(c => [c.key, c]))
const MONITOR_DEFAULTS = defaultsFor(COLS.map(c => c.key))

// The member's column order (a preset's saved `order`, known keys only), then
// every metric it does not name, in code order — so a new metric still appears.
function orderedColKeys(order) {
  const saved = Array.isArray(order) ? order.filter(k => COLS_BY_KEY[k]) : []
  const seen = new Set(saved)
  return [...saved, ...COLS.map(c => c.key).filter(k => !seen.has(k))]
}
// Every column a member can drill, in table order — the scan window's list picker.
const DRILL_COLS = COLS.filter(c => c.drillKey).map(c => ({ key: c.key, label: c.label, drillKey: c.drillKey }))

// TIER_SCORES / TIER_LABELS / TIER_TIP_COLORS moved to breadth/heatmapMetrics.js
// (imported + re-exported above).

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
  new_52w_highs: '52W Highs',
  new_52w_lows: '52W Lows',
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
        <span className={styles.analogueSim}>{formatPercentAsSent(similarity)} match</span>
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
                {val > 0 ? '+' : ''}{formatPercentAsSent(val)}
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
            if (key === 'sp500_close') return formatNumberMax(Number(v), { maxDecimals: 0 })
            return formatNumber(Number(v), { decimals: key === 'ratio_5day' ? 2 : key === 'vix' ? 1 : 0, grouping: false })
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
    return `Last time breadth looked like this was ${top.date} — SPY ${dir} ${formatPercentAsSent(Math.abs(fwd20))} over the next month`
  }, [analogues])

  if (isLoading) {
    return <div className={styles.analoguesWrap}><SkeletonTileContent lines={4} /></div>
  }

  if (error) {
    return (
      <div className={styles.analoguesWrap}>
        <div className={styles.analoguesEmpty}>{breadthErrorText(error, 'Breadth analogues')}</div>
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
        <h2 className={styles.analoguesTitle}>Historical analogues</h2>
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
// it scrolls horizontally as a chip strip.
//
// ⛔ THE LIST AND THE ADMIN APPEND MOVED TO `hub/sections/breadthSection.js`.
// The joystick hub's tap / double-tap / scrub all walk this same strip, and the ONE way an
// admin and a member can end up with different behaviour from identical code is two copies of
// "which tabs exist". `resolveBreadthTabs` is that answer; both the strip below and the hub
// call it. Do not re-inline the array here.
//
// `hub/sections/breadthSection.test.jsx` asserts the hub's gestures against THIS strip — it
// mounts the whole page rather than a stand-in, because a harness with its own tab strip could
// not notice the page rendering a different list from the one the gesture walks.
function BreadthTabs({ active, onChange, isAdmin }) {
  const items = resolveBreadthTabs(isAdmin)
  return (
    <div className={styles.tabs} data-guide="breadth.tabs">
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
  // In a UCT Terminal panel the shell insets the body; the page drops its own padding.
  const inPanel = useInTerminalPanel()
  const pageCls = inPanel?.inset ? `${styles.page} ${styles.pageInPanel}` : styles.page
  const { user } = useAuth()
  const isAdmin = user?.role === 'admin'

  // ── the shareable link (spec §5) ───────────────────────────────────────────
  //
  // The PAGE owns the router, because `days` is the page's state and
  // `view`/`date`/`compare` are the Views tab's — one writer per key, merged
  // through `mergeParams`, exactly the split `useEarningsModalRoute` uses for
  // `?week`/`?d` beside `?earnings`.
  const url = useBreadthUrlState({ dayChoices: VIEWS_DAY_CHOICES })
  const urlInitial = url.initial

  // ⛔ `?tab=` IS A SEPARATE, ADDITIVE READ — NOT PART OF THE VIEWS URL CONTRACT
  // (spec §5) `useBreadthUrlState` owns above. That contract's `initial` is
  // parsed once by ONE hook and its shape (`view`/`date`/`days`/`compare`) is
  // spec'd and tested; folding a general tab selector into it would make it a
  // second, unrelated authority riding the same object. This reads the
  // router's own query (never `window.location` — under `MemoryRouter` in
  // tests, and in principle anywhere the router hasn't pushed a real browser
  // navigation yet, those two can disagree) and, like `urlInitial` above, only
  // its value on the FIRST render is ever used — the `useState` initializer
  // below runs once, so a later `?tab=` write from elsewhere cannot loop back
  // in as a forced tab change.
  const [tabSearchParams] = useSearchParams()

  // Phones land on the readable Overview; desktop/tablet keep the Monitor.
  // ⭐ A LINK CARRYING VIEWS STATE OPENS THE VIEWS TAB — otherwise the Discord
  // bot's `?view=clock` lands a phone on Daily and the read it linked to is two
  // taps away, which is the same as not linking to it.
  //
  // An explicit `?tab=` wins over that inference — a direct tab request is
  // more specific than "this link happens to carry Views state" — and an
  // unresolvable key, or an admin-only one opened by a non-admin, falls
  // through to the existing rules rather than landing on a tab the reader
  // cannot actually reach.
  const [activeTab, setActiveTab] = useState(() => {
    const requestedTab = tabSearchParams.get('tab')
    if (requestedTab && resolveBreadthTabs(isAdmin).some(t => t.key === requestedTab)) {
      return requestedTab
    }
    if (urlInitial.view || urlInitial.compare) return 'heatmap'
    try { return window.matchMedia('(max-width: 640px)').matches ? 'overview' : 'breadth' }
    catch { return 'breadth' }
  })
  // ── the joystick hub's mount point (Phase 3 §3.2) ─────────────────────────
  // Registers this page as the hub's controller while it is mounted: tap = next tab,
  // double-tap = previous, scrub = tab index. It reads `resolveBreadthTabs(isAdmin)` — the same
  // resolved list `BreadthTabs` renders — so the gesture can never walk a list the member is
  // not looking at. Inert with no `HubProvider` above it (`useHub`'s no-op default), which is
  // what keeps the headless `BreadthRender` path unaffected.
  useBreadthHubSection({ isAdmin, activeTab, setActiveTab })

  const [viewsDays, setViewsDays] = useState(urlInitial.days ?? 90)
  const isViewsTab = activeTab === 'heatmap'
  const effectiveDays = isViewsTab ? viewsDays : MONITOR_WINDOW

  /**
   * 🔴 THE LINK IS AN ENTRY CONDITION FOR THE PAGE VISIT — NOT FOR EVERY MOUNT.
   *
   * `BreadthViews` is rendered conditionally on `activeTab === 'heatmap'`, so an
   * ordinary tab switch UNMOUNTS it and coming back MOUNTS A FRESH ONE.
   * `urlInitial` is parsed once and frozen for the life of this page, so every
   * remount handed the child the ORIGINAL link again and `useBreadthViews`
   * re-applied its `view` / `compare` / `layout` over whatever the reader had
   * chosen in between. `?date=` was re-seeked the same way.
   *
   * ⛔ AND THE REVERSION IS PERSISTED. `useBreadthViews` debounce-writes every
   * state change to localStorage and, once hydrated, to the server preference —
   * so opening a `?view=` link, picking a different style, and glancing at
   * another tab silently stomped the standing preference, and it stayed stomped
   * on later visits carrying no query at all (`loadFromStorage` reads the
   * corrupted blob).
   *
   * ⭐ SO THE "ALREADY APPLIED" MEMORY LIVES HERE, ABOVE THE CHILD'S MOUNT
   * BOUNDARY. A ref inside `useBreadthViews` cannot hold it: it dies with the
   * mount that is the problem. Once a mounted Views tab has been left, the link
   * is SPENT and the next mount is handed nothing — the child's own state,
   * restored from the preference blob it just flushed, is the authority.
   *
   * The spend is on LEAVING a mount, not on the first report back: an
   * out-of-window `?date=` legitimately keeps retrying while the tab is up
   * (widen the window with the day pills and the link lands), and clearing on
   * the first `onUrlChange` would kill that inside the very mount it serves.
   *
   * 🔴 AND "LEAVING" IS THE CHILD'S OWN LIFECYCLE, NOT A TAB COMPARISON.
   *
   * This was `if (!isViewsTab && urlVisit === 'open') setUrlVisit('spent')` — a
   * proxy that could only ever catch the unmount reason someone had thought of.
   * `BreadthViews` is ALSO gated on `rows.length > 0`, and `rows` empties on an
   * ordinary window change: the day pill moves `effectiveDays`, the SWR key
   * changes, and `data` is `undefined` until the new window resolves. With no
   * live row to carry (outside RTH, or once the 4:15 collector has written the
   * day) `rows` is empty for that stretch, the child unmounts and remounts, the
   * tab never changed — so the link was still live and the whole persisted
   * reversion came back, on a SUCCESSFUL fetch. `keepPreviousData` below removes
   * that trigger; `UnmountReporter` removes the assumption, which is the fix.
   *
   * `setUrlSpent` is called from an effect cleanup inside the mounted subtree,
   * so this is a plain state update from a committed child, not the
   * "adjusting state during render" shape the rest of this wave uses.
   */
  const [urlSpent, setUrlSpent] = useState(false)
  const spendLink = useCallback(() => setUrlSpent(true), [])
  // Only ever undoes a report StrictMode's dev-mode double-invoke made about a
  // mount that never actually ended — see the header of `UnmountReporter.jsx`.
  const unspendLink = useCallback(() => setUrlSpent(false), [])
  const viewsUrlState = urlSpent ? null : urlInitial

  // What BreadthViews last reported about itself; composed with `days` here so
  // the query is written from ONE place.
  const [viewsUrl, setViewsUrl] = useState(null)
  useEffect(() => {
    // Only the Views tab owns these params. On any other tab the query is left
    // exactly as it was rather than being scrubbed — a tab switch is not a
    // statement about the link.
    if (!isViewsTab) return
    url.write({ ...(viewsUrl ?? {}), days: viewsDays })
  }, [isViewsTab, viewsUrl, viewsDays, url])

  useEffect(() => {
    if (activeTab === 'analogues' && !isAdmin) setActiveTab('breadth')
  }, [activeTab, isAdmin])
  /**
   * ⭐ `keepPreviousData` — the window pills change this key, and without it
   * `data` is `undefined` for the whole of an ordinary first-of-session fetch.
   * Every tab that reads `rows` blanked and rebuilt on each widen, and on the
   * Views tab the blank UNMOUNTED `BreadthViews` (see the link-spend block
   * above). Holding the previous window until the new one lands is both the
   * honest thing on screen — the rows shown are real rows, just the narrower
   * set, and the counts beside them describe exactly what is drawn — and the
   * removal of that unmount trigger. COT and Data Charts return before `rows`
   * is read at all, so they cannot see this either way.
   */
  const { data, isLoading, isValidating, error } = useSWR(
    `/api/breadth-monitor?days=${effectiveDays}`,
    fetcher,
    { refreshInterval: 5 * 60 * 1000, keepPreviousData: true }
  )

  /**
   * ⛔ `isLoading` (`!data && isValidating`) is permanently false here once any
   * window has loaded once this session — `keepPreviousData` means `data` is
   * never undefined again, so it cannot flag a window change in flight.
   *
   * `data.days` is the server's own stamp of which window the payload it
   * returned actually covers (`{"rows": ..., "days": days}` in
   * `api/routers/breadth_monitor.py`) — the knowing side, not a client re-guess.
   * While a fetch for a NEW window is in flight, `data` still holds the OLD
   * window's payload (that is the point of `keepPreviousData`), so
   * `data.days !== effectiveDays` for exactly the stretch where the meta line
   * would otherwise caption the active pill with a count it doesn't describe.
   * Gating on `isValidating` too keeps this quiet on an ordinary 5-minute
   * background refresh of the SAME window, where the two never disagree.
   */
  const windowMismatch = isValidating && data != null && data.days !== effectiveDays
  // ⚰️ Click-to-collapse columns retired 2026-11-17 (replaced by the header menu).
  // A member may still hold the old `breadth_collapsed_cols` key; it is ignored
  // and dropped here, once.
  useEffect(() => {
    try { localStorage.removeItem('breadth_collapsed_cols') } catch { /* private mode */ }
  }, [])

  // UCT Core = the focused core set (breadth/defaultColumns.js), computed, never stored;
  // an edit to it is an unsaved draft ("UCT Core · edited") until saved as a template.
  const customize = useBreadthCustomize({ defaults: MONITOR_DEFAULTS })
  const [shareOpen, setShareOpen] = useState(false)
  // The one floating as-of tooltip over a carried (older-than-its-cadence) cell.
  const [ageTip, setAgeTip] = useState(null)

  // The one header menu (chart Signature ContextPopover): { key, index, anchor }. It is
  // the ONLY popup a header has (owner 2026-11-19: no hover card).
  const [colMenu, setColMenu] = useState(null)
  const colMenuBtn = useRef(null)
  const [moreMenu, setMoreMenu] = useState(null)
  const openColMenu = useCallback((key, index, btn) => {
    if (colMenu?.key === key) { setColMenu(null); return }
    colMenuBtn.current = btn
    const r = btn.getBoundingClientRect()
    setColMenu({ key, index, anchor: { x: r.left - 4, y: r.bottom + 6 } })
  }, [colMenu])
  const closeColMenu = useCallback(() => setColMenu(null), [])

  const [drill, setDrill] = useState(null)
  // drill = { date, label, items: [{t,pct}] | null }

  // Takes the ROW, not a date: only the row knows whether it is the live one,
  // and `drillTarget` needs that to pick between the live endpoint, the dated
  // one, and the session a carried metric came from.
  // ⛔ A FAILED LOAD IS NOT AN EMPTY RESULT. This used to `.catch()` into
  // `items: []`, which renders as "No stocks matched this filter" — a confident,
  // wrong answer. A pod restart mid-request (every deploy) or one dropped
  // connection told the member the market was quiet. `error` keeps the two
  // states apart and the list offers a retry instead of a lie.
  const loadDrill = useCallback((url, live = false) => {
    fetchDrill(url, { live })
      .then(data => setDrill(prev => (prev && prev.url === url
        ? { ...prev, items: data.items ?? [], error: null }
        : prev)))
      .catch(() => setDrill(prev => (prev && prev.url === url
        ? { ...prev, items: [], error: 'load' }
        : prev)))
  }, [])

  const openDrill = useCallback((row, col, live = null) => {
    const target = drillTarget(row, col, live)
    if (!target) return
    // `url` is kept so a retry re-runs THIS request, and so a response that
    // arrives after the user has opened a different cell is discarded rather
    // than painted into the wrong drill.
    // `colKey` + `drillKey` let the scan window rank the day, step to the next
    // session and switch lists without closing.
    // A list already fetched (the hover started it, or it was open before)
    // paints on the first frame; otherwise it lands when the request does.
    const cached = peekDrill(target.url)
    setDrill({ date: target.date, label: col.label, live: target.live,
               colKey: col.key, drillKey: col.drillKey,
               asOf: target.live ? live?.asOf ?? null : null,
               url: target.url, items: cached ? (cached.items ?? []) : null, error: null })
    if (!cached) loadDrill(target.url, target.live)
  }, [loadDrill])

  const retryDrill = useCallback(() => {
    setDrill(prev => {
      if (!prev?.url) return prev
      forgetDrill(prev.url)
      loadDrill(prev.url, prev.live)
      return { ...prev, items: null, error: null }
    })
  }, [loadDrill])

  const AAII_KEYS = new Set(['aaii_bulls', 'aaii_neutral', 'aaii_bears', 'aaii_spread'])

  const storedRows = data?.rows ?? []

  // Intraday breadth sits ON TOP of the stored history, never in place of it.
  // The backend withholds the live read the moment the 4:15 collector writes
  // today's row, so an estimate never sits beside the number it estimated.
  const liveBreadth = useLiveBreadth({ enabled: activeTab === 'breadth' || activeTab === 'heatmap' || activeTab === 'overview' })

  // ⌨️ THE DRILL'S DOOR WAS MOUSE-ONLY. Every drillable cell was a bare
  // `<td onClick>` — no role, no tabIndex, no key handling — so it was invisible
  // to the keyboard and announced as a plain table cell. None of the dialog's own
  // keyboard work could be reached, because the thing that OPENS it could not be.
  //
  // ⛔ ONE TAB STOP PER ROW, not per cell. There are 473 drillable cells rendered
  // (43 rows x ~11) against 43 tabbable elements on the whole page, so making each
  // one tabbable would take the tab order from 43 stops to 516 — worse for the
  // keyboard users it is meant to help. The first drillable cell in each row is
  // the stop; the arrows move along the row from there.
  //
  // ⛔ And that is also why vertical movement is left to Tab rather than the up/down
  // arrows: this table is VIRTUALIZED, so a row outside the rendered window is not
  // in the DOM and cannot be focused. Tab reaches each row as it renders; an arrow
  // handler would have to drive the virtualizer to scroll first, which is a second
  // authority over the scroll position.
  const onCellKey = useCallback((e, row, col) => {
    if (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar') {
      e.preventDefault()
      openDrill(row, col, liveBreadth)
      return
    }
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return
    const cell = e.currentTarget
    const cells = Array.from(cell.closest('tr')?.querySelectorAll('td[data-drill]') || [])
    if (!cells.length) return
    const i = cells.indexOf(cell)
    const next = e.key === 'Home' ? cells[0]
      : e.key === 'End' ? cells[cells.length - 1]
        : cells[i + (e.key === 'ArrowRight' ? 1 : -1)]
    if (!next || next === cell) return
    e.preventDefault()
    // Roving tabindex: the single stop travels with the focus, so Shift+Tab comes
    // back to where you were rather than to the start of the row.
    cell.tabIndex = -1
    next.tabIndex = 0
    next.focus()
  }, [openDrill, liveBreadth])

  // Views/Overview read the latest window, today's live row on top.
  const rows = useMemo(
    () => (liveBreadth.row ? [liveBreadth.row, ...storedRows] : storedRows),
    [liveBreadth.row, storedRows],
  )

  // The scan window's own navigation: another session of the same list, or
  // another list on the same session, without closing. Resolves the ROW and the
  // COLUMN and goes through `openDrill`, so live/carried routing stays decided
  // in one place (drillTarget), never re-derived here.
  // Hovering a cell starts its list (and the window's code) loading, so the
  // click opens onto rows rather than "Loading…".
  const prefetchCell = useCallback((row, col) => {
    preloadDrillModal()
    const t = drillTarget(row, col, liveBreadth)
    if (t) prefetchDrill(t.url, { live: t.live })
  }, [liveBreadth])
  useEffect(() => {
    const idle = window.requestIdleCallback || ((fn) => setTimeout(fn, 2500))
    const cancel = window.cancelIdleCallback || clearTimeout
    const id = idle(preloadDrillModal)
    return () => cancel(id)
  }, [])
  // While a list is open, the sessions either side of it load in the
  // background, so stepping a day ( ‹ › or [ ] ) is instant too.
  const drillUrl = drill?.url || null
  const drillColKey = drill?.colKey || null
  const drillDateNow = drill?.date || null
  const drillIsLive = !!drill?.live
  useEffect(() => {
    if (!drillUrl || !drillColKey) return
    const col = COLS_BY_KEY[drillColKey]
    if (!col?.drillKey) return
    const i = drillIsLive ? rows.findIndex(r => r?._live) : rows.findIndex(r => !r?._live && r?.date === drillDateNow)
    if (i < 0) return
    for (const j of [i + 1, i - 1]) {
      const t = rows[j] ? drillTarget(rows[j], col, liveBreadth) : null
      if (t) prefetchDrill(t.url, { live: t.live })
    }
  }, [drillUrl, drillColKey, drillDateNow, drillIsLive, rows, liveBreadth])

  const navigateDrill = useCallback(({ colKey, date, live }) => {
    const col = COLS_BY_KEY[colKey]
    if (!col?.drillKey) return
    const row = live ? rows.find(r => r?._live) : rows.find(r => !r?._live && r?.date === date)
    if (row) openDrill(row, col, liveBreadth)
  }, [rows, openDrill, liveBreadth])

  // ── Monitor grid: virtualized over the FULL timeline index, rows loaded on
  //    demand in blocks (see useMonitorGrid). A teleport to any year is an instant
  //    scroll-to-index; only the visible rows fetch, so scrolling stays light. ──
  const grid = useMonitorGrid({ enabled: activeTab === 'breadth', liveRow: liveBreadth.row })
  const tableWrapRef = useRef(null)
  const rowH = useMonitorRowH()
  const rowVirtualizer = useVirtualizer({
    count: grid.count,
    getScrollElement: () => tableWrapRef.current,
    // FIXED row height (enforced in CSS: .table --br-row-h, 32px or 35px on wide
    // screens; `rowH` follows the same breakpoint). No dynamic measurement — a fixed
    // size makes scrollToIndex pixel-exact across all ~4,700 rows, so a jump to any
    // year lands on the right session with zero drift.
    estimateSize: () => rowH,
    overscan: 14,
  })
  const virtualItems = rowVirtualizer.getVirtualItems()
  // The row at the scroll top — derived from the scroll offset (fixed row height),
  // NOT virtualItems[0], which is the first OVERSCAN row rendered above the
  // viewport and would put the date box ~14 rows off.
  const monitorTopIndex = grid.count
    ? Math.min(grid.count - 1, Math.max(0, Math.round((rowVirtualizer.scrollOffset ?? 0) / rowH)))
    : 0
  const monitorTopDate = grid.allDates[monitorTopIndex] ?? null
  // Crossing the breakpoint changes every row's size: re-measure, and keep the same
  // session at the top (the index read at the OLD height, before this render's change).
  const topIndexRef = useRef(0)
  const lastRowH = useRef(rowH)
  useEffect(() => {
    if (lastRowH.current === rowH) { topIndexRef.current = monitorTopIndex; return }
    lastRowH.current = rowH
    rowVirtualizer.measure()
    // Fixed rows: the session's offset is exactly index × height.
    const el = tableWrapRef.current
    if (el) el.scrollTop = topIndexRef.current * rowH
  })

  // Keep the visible (and just-off-screen) rows loaded as the user scrolls.
  const visFirst = virtualItems[0]?.index ?? 0
  const visLast = virtualItems[virtualItems.length - 1]?.index ?? 0
  useEffect(() => {
    if (activeTab === 'breadth') grid.ensureRange(visFirst, visLast)
  }, [activeTab, visFirst, visLast, grid.ensureRange, grid.count]) // eslint-disable-line react-hooks/exhaustive-deps

  const monitorScrollTo = useCallback((idx, align = 'start') => {
    if (idx == null || idx < 0 || !grid.count) return
    rowVirtualizer.scrollToIndex(Math.min(idx, grid.count - 1), { align })
  }, [rowVirtualizer, grid.count])

  // Teleport = an instant scroll-to-index over the FULL timeline (rows fetch as
  // they arrive on screen). Works for any date/year, loaded or not.
  const onDatePick = useCallback((iso) => monitorScrollTo(grid.indexOfDate(iso)),
    [grid, monitorScrollTo])
  const onYearPick = useCallback((y) => monitorScrollTo(grid.indexOfYearStart(y)),
    [grid, monitorScrollTo])
  const onDateStep = useCallback((dir) => {
    // ◀ (dir<0) steps to an OLDER day = one row down; ▶ steps newer = one row up.
    monitorScrollTo(Math.max(0, monitorTopIndex + (dir < 0 ? 1 : -1)))
  }, [monitorTopIndex, monitorScrollTo])

  // Jump straight back to the present day (index 0 = the latest/top row).
  const onJumpToday = useCallback(() => monitorScrollTo(0), [monitorScrollTo])

  // A shared snapshot link (`/breadth?d=YYYY-MM-DD`) teleports to that day once
  // the timeline index is ready. Fires exactly once; a bad/missing param no-ops.
  const deepLinkedRef = useRef(false)
  useEffect(() => {
    if (deepLinkedRef.current || activeTab !== 'breadth' || !grid.ready || !grid.count) return
    deepLinkedRef.current = true
    const d = new URLSearchParams(window.location.search).get('d')
    if (!d || !/^\d{4}-\d{2}-\d{2}$/.test(d)) return
    const id = requestAnimationFrame(() => monitorScrollTo(grid.indexOfDate(d)))
    return () => cancelAnimationFrame(id)
  }, [activeTab, grid.ready, grid.count, grid, monitorScrollTo])

  // Manual refresh: revalidate every breadth-monitor SWR key (the live/today row,
  // the timeline index, the Views window) AND re-pull the Monitor's visible block
  // rows. The brief `refreshing` flag spins the icon for feedback.
  const { mutate } = useSWRConfig()
  const [refreshing, setRefreshing] = useState(false)
  const onManualRefresh = useCallback(() => {
    setRefreshing(true)
    try { mutate((k) => typeof k === 'string' && k.startsWith('/api/breadth-monitor')) } catch { /* best-effort */ }
    grid.refresh?.()
    setTimeout(() => setRefreshing(false), 700)
  }, [mutate, grid])

  const lastUpdated = storedRows[0]?._created_at
    ? formatETFull(storedRows[0]._created_at + 'Z')
    : null

  // The top bar's status button (owner round 3). Fresh = the stored session is
  // inside the end-of-day age threshold (TERM-006's authority, the same one every
  // FreshnessBadge reads), or a live intraday reading is on screen.
  const lastStamp = storedRows[0]?._created_at ? storedRows[0]._created_at + 'Z' : null
  const statusFresh = !!liveBreadth?.data
    || storedSessionFresh(lastStamp)
  // The clock part of `lastUpdated` ("Aug 24, 2026, 7:24 PM EDT" → "7:24 PM").
  // ⛔ Not formatETTime: no main-bundle code uses it, so importing it here would
  // keep it (and its export) in the entry chunk — +280 B on the notebook budget.
  const statusTime = lastUpdated ? (/,\s*([^,]+?)\s+[A-Z]{2,5}$/.exec(lastUpdated)?.[1] ?? '') : ''
  const statusCount = isViewsTab
    ? (rows.length > 0
        ? (windowMismatch ? 'Updating…' : `${rows.length} trading days shown`)
        : isLoading ? 'Loading…' : 'No data')
    : (grid.count > 0
        ? `${formatNumber(grid.count)} sessions shown`
        : grid.ready ? 'No data' : grid.datesFailed ? 'Could not load' : 'Loading…')
  const statusLabel = `${statusCount}${lastUpdated ? ` · updated ${lastUpdated}` : ''} · click to refresh`
  const statusText = (isViewsTab ? windowMismatch : false)
    ? 'Updating…'
    : statusTime ? `Updated ${statusTime}`
      : (isViewsTab ? (isLoading ? 'Loading…' : 'No data') : (grid.ready ? 'No data' : grid.datesFailed ? 'Could not load' : 'Loading…'))

  // ── Share: a branded UCT snapshot of the on-screen sheet. The capture target
  //    is the scroll container (tableWrapRef), so it's exactly what's visible. ──
  const shareSubtitle = lastUpdated ? `updated ${lastUpdated}` : ''
  const onShareDownload = () => downloadBreadthSnapshot(tableWrapRef.current, shareSubtitle)
  const onShareCopy = () => copyBreadthSnapshot(tableWrapRef.current, shareSubtitle)
  const onShareUrl = () => copyBreadthShareUrl(monitorTopDate)

  const liveClock = liveBreadth.clock ?? 'LIVE'
  const liveTitle = liveBreadth.row
    ? `Provisional — computed ${liveClock} ET across ${liveBreadth.measured ?? '—'} names. `
      + `The 4:15 PM collector writes the day's authoritative row.`
    : undefined
  // The member's full column order: the preset's saved order (known keys only),
  // then any metric it does not name, in code order.
  const orderedKeys = useMemo(() => orderedColKeys(customize.order), [customize.order])
  const visibleCols = useMemo(
    () => orderedKeys.map(k => COLS_BY_KEY[k]).filter(col => !customize.hidden.has(col.key)),
    [orderedKeys, customize.hidden],
  )

  // ── Column header menu (Move left / Move right / Hide column) ──
  // Same state the Columns menu edits, applied at once: on the built-in UCT Core it becomes
  // the unsaved "edited" state (Columns offers Save as new / Revert), never a prompt.
  const applyColChange = useCallback((change) => {
    if (change.order) customize.setOrder(change.order)
    if (change.hidden) customize.setHiddenSet([...customize.hidden, ...change.hidden])
  }, [customize])
  const moveCol = useCallback((key, dir) => {
    const i = visibleCols.findIndex(c => c.key === key)
    const other = visibleCols[i + dir]?.key
    if (i < 0 || !other) return
    const next = [...orderedKeys]
    const a = next.indexOf(key), b = next.indexOf(other)
    next[a] = other; next[b] = key
    applyColChange({ order: next })
  }, [visibleCols, orderedKeys, applyColChange])
  const hideCol = useCallback((key) => applyColChange({ hidden: [key] }), [applyColChange])
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

  // Equal widths per group (round 11). Measured from the HEADER row only (always
  // mounted), so the result never depends on which rows are on screen: each visible
  // column's need = max(its label, its widest value format) + its
  // own padding; each group takes its widest member's need. Re-measured when the
  // visible columns, the sheet size (breakpoint) or the web font change.
  const headRowRef = useRef(null)
  const chProbeRef = useRef(null)
  // { need: {group: px}, solo: {key: px}, extra: px } — see the effect below.
  const [colSizing, setColSizing] = useState({ need: {}, solo: {}, extra: 0 })
  const extraRef = useRef(0)
  // Round 13: re-measure when the sheet's width changes (window resize, sidebar push).
  const [wrapW, setWrapW] = useState(0)
  useEffect(() => {
    const el = tableWrapRef.current
    if (!el || typeof ResizeObserver === 'undefined') return undefined
    const ro = new ResizeObserver(() => setWrapW(Math.round(el.clientWidth)))
    ro.observe(el)
    return () => ro.disconnect()
  }, [activeTab, grid.count > 0]) // eslint-disable-line react-hooks/exhaustive-deps
  const [fontsReady, setFontsReady] = useState(0)
  useEffect(() => {
    let live = true
    document.fonts?.ready?.then(() => { if (live) setFontsReady(n => n + 1) })
    return () => { live = false }
  }, [])
  const visibleKeySig = visibleCols.map(c => c.key).join(',')
  useLayoutEffect(() => {
    const row = headRowRef.current
    const probe = chProbeRef.current
    if (!row || !probe) return
    const ch = probe.getBoundingClientRect().width / 10   // 1ch of the CELL font
    if (!ch) return
    const need = {}
    for (const th of row.querySelectorAll('th[data-width-group]')) {
      const key = th.getAttribute('data-col-key')
      const btn = th.querySelector('button')
      const cs = getComputedStyle(th)
      const pad = parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight)
      let label = 0
      if (btn) {
        const r = document.createRange()
        r.selectNodeContents(btn)
        label = r.getBoundingClientRect().width
      }
      // The live "≈" sits in the cell's right padding (round 12), so no extra 1ch.
      const value = valueCh(COLS_BY_KEY[key]) * ch
      const g = th.getAttribute('data-width-group')
      need[g] = Math.max(need[g] ?? 0, Math.ceil(Math.max(label, value) + pad))
    }
    // ── Flush right edge (round 13) ──
    // The leftover window width is spread EVENLY over the real columns (not Date):
    // every column — so every group — grows by the same amount, capped at 12px each;
    // past the cap the trailing filler takes the rest. A table wider than the window
    // gets nothing and scrolls. Natural widths come from the header row only, so
    // scrolling never changes them; an ungrouped column's natural width is its
    // current width less the extra already applied.
    const solo = {}
    let natural = 0
    let n = 0
    let dateW = 0
    for (const th of row.querySelectorAll('th')) {
      const key = th.getAttribute('data-col-key')
      const w = th.getBoundingClientRect().width
      if (!key) { if (!th.className.includes('fillCol')) dateW += w; continue }
      n += 1
      const g = th.getAttribute('data-width-group')
      if (g) natural += need[g]
      else { solo[key] = Math.round((w - extraRef.current) * 10) / 10; natural += solo[key] }
    }
    const avail = tableWrapRef.current?.clientWidth ?? 0
    const extra = n ? Math.max(0, Math.min(12, (avail - dateW - natural) / n)) : 0
    const next = { need, solo, extra: Math.floor(extra * 100) / 100 }
    extraRef.current = next.extra
    setColSizing(prev => (JSON.stringify(prev) === JSON.stringify(next) ? prev : next))
  }, [visibleKeySig, rowH, fontsReady, grid.count > 0, activeTab, wrapW]) // eslint-disable-line react-hooks/exhaustive-deps -- re-measure on these only

  const errorBanner = error ? (
    <div className={styles.errorBanner} role="alert">
      <span>
        {breadthErrorText(error)}
      </span>
      {/* ⛔ A 5-minute auto-retry with no manual lever leaves a reader who
          already knows the network recovered staring at a stale error for
          up to five more minutes. `onManualRefresh` is the same
          revalidation the header's refresh icon fires. */}
      <button
        type="button"
        className={styles.errorRetryBtn}
        onClick={onManualRefresh}
        disabled={refreshing}
      >
        {refreshing ? 'Retrying…' : 'Retry now'}
      </button>
    </div>
  ) : null

  // ⭐ W2-C1: what UCT Agent may read of this page (read only: tab, window, newest session, rows, columns).
  // Called BEFORE the tab branches below — a hook after an early return changes the hook count when the
  // member switches tab (React: "Rendered fewer hooks than expected"; breadth/breadthTabHookOrder.test.jsx).
  useBreadthAgentHost({ tab: activeTab, days: effectiveDays, topDate: monitorTopDate, rowCount: rows.length, columns: visibleCols.map(c => c.label || c.key || String(c)), live: !!liveBreadth?.data, loading: isLoading })

  if (activeTab === 'overview') {
    // 2026-10-07 completeness audit: this branch returned before the error banner, so a failed
    // read (or the first load still in flight) reached DailyOverview with no rows and read
    // "No session recorded yet" — a failure drawn as an empty day. The banner and a loading
    // state now come first, and DailyOverview only speaks for rows that were actually read.
    const noRows = !rows.length
    return (
      <div className={pageCls}>
        <SurfaceHeader title="Breadth" className={styles.sigHeader}>
          <BreadthTabs active={activeTab} onChange={setActiveTab} isAdmin={isAdmin} />
        </SurfaceHeader>
        <div className={styles.overviewBody}>
          {errorBanner}
          {noRows && isLoading && !error
            ? <div className={styles.empty} data-testid="breadth-overview-loading"><SkeletonTileContent lines={4} /></div>
            : !(noRows && error) && (
              <DailyOverview rows={rows} live={liveBreadth} cols={COLS}
                             phaseClassFn={phaseClass} onDrill={openDrill} />
            )}
          <MarketBreadth />
        </div>
        {drill && (
          <Suspense fallback={null}>
            <BreadthDrillModal drill={drill} latestDate={rows[0]?.date} onRetry={retryDrill} onClose={() => setDrill(null)}
              rows={rows} drillCols={DRILL_COLS} onNavigate={navigateDrill} />
          </Suspense>
        )}
      </div>
    )
  }

  if (activeTab === 'cot') {
    return (
      <div className={`${pageCls} ${styles.pageCot}`}>
        <SurfaceHeader title="Breadth" className={`${styles.cotTabHeader} ${styles.sigHeader}`}>
          <BreadthTabs active={activeTab} onChange={setActiveTab} isAdmin={isAdmin} />
        </SurfaceHeader>
        <CotData />
      </div>
    )
  }

  if (activeTab === 'charts') {
    return (
      <div className={pageCls}>
        <SurfaceHeader title="Breadth" className={styles.sigHeader}>
          <BreadthTabs active={activeTab} onChange={setActiveTab} isAdmin={isAdmin} />
        </SurfaceHeader>
        <BreadthCharts />
      </div>
    )
  }

  if (activeTab === 'analogues' && isAdmin) {
    return (
      <div className={pageCls}>
        <SurfaceHeader title="Breadth" className={styles.sigHeader}>
          <BreadthTabs active={activeTab} onChange={setActiveTab} isAdmin={isAdmin} />
        </SurfaceHeader>
        <BreadthAnalogues />
      </div>
    )
  }

  return (
    <div className={isViewsTab ? `${pageCls} ${styles.pageFlushBottom}` : pageCls}>
      {/* ⭐ THE TOP BAR (owner round 3, 2026-11-17): the view tabs alone on the left;
          everything actionable grouped on the right — status · date · Columns · ⋯.
          Views keeps its window pills in the date's place; the other tabs carry
          the tabs only. */}
      <SurfaceHeader
        title="Breadth"
        className={styles.sigHeader}
        right={(
          <>
            <AgentDockButton className={styles.hdrBtn} />
            {/* One status button replaces the "N sessions · updated …" line and the
                refresh icon: the dot is the theme's up colour while the stored
                session is fresh (the TERM-006 age authority), grey once stale;
                clicking it refreshes. */}
            <button
              type="button"
              className={styles.status}
              data-testid="breadth-status"
              onClick={onManualRefresh}
              aria-busy={refreshing || undefined}
              aria-label={statusLabel}
              title={statusLabel}
            >
              <span
                className={`${styles.statusDot} ${statusFresh ? styles.statusFresh : ''} ${refreshing ? styles.statusPulse : ''}`}
                aria-hidden="true"
              />
              {refreshing ? 'Refreshing…' : statusText}
            </button>
            {isViewsTab ? (
              // Views keeps its window pills (a lens is defined by how many sessions
              // it spans). The Monitor sheet instead scrolls freely across all time.
              <div className={styles.daysPills}>
                {VIEWS_DAY_CHOICES.map(d => (
                  <button
                    key={d}
                    className={`${styles.daysPill} ${effectiveDays === d ? styles.daysPillActive : ''}`}
                    onClick={() => setViewsDays(d)}
                  >
                    {d}d
                  </button>
                ))}
              </div>
            ) : (
              <>
                <BreadthDateNav
                  topDate={monitorTopDate}
                  minDate={grid.min}
                  maxDate={grid.max}
                  canForward={monitorTopIndex > 0}
                  onStep={onDateStep}
                  onPickDate={onDatePick}
                  onPickYear={onYearPick}
                />
                {/* Only when an earlier session is framed: on the latest one there is
                    nothing to go back to. */}
                {monitorTopIndex > 0 && (
                  <button
                    type="button"
                    className={`${styles.hdrBtn} ${styles.todayBtn}`}
                    onClick={onJumpToday}
                    title="Jump back to the latest session (top of the sheet)"
                  >
                    Back to latest
                  </button>
                )}
                <div className={customizeStyles.anchor}>
                  <ColumnsMenu
                    cols={COLS}
                    customize={customize}
                    buttonClassName={`${styles.hdrBtn} ${styles.hdrBtnPrimary}`}
                    openClassName={styles.hdrBtnOpen}
                    chevronClassName={styles.hdrChevron}
                  />
                </div>
                {/* ⋯ — the chart's Signature menu (ContextPopover `signature`):
                    Share (branded snapshot) and Export CSV. */}
                <div className={customizeStyles.anchor}>
                  <button
                    type="button"
                    className={`${styles.hdrBtn} ${styles.moreBtn}`}
                    aria-label="More"
                    aria-haspopup="menu"
                    aria-expanded={!!moreMenu}
                    data-testid="breadth-more-menu"
                    onClick={(e) => {
                      if (moreMenu) { setMoreMenu(null); return }
                      const r = e.currentTarget.getBoundingClientRect()
                      setMoreMenu({ x: r.right - 180, y: r.bottom + 6 })
                    }}
                  >
                    <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
                      <circle cx="3.5" cy="8" r="1.4" fill="currentColor" /><circle cx="8" cy="8" r="1.4" fill="currentColor" /><circle cx="12.5" cy="8" r="1.4" fill="currentColor" />
                    </svg>
                  </button>
                  <ContextPopover
                    open={!!moreMenu}
                    anchor={moreMenu}
                    onClose={() => setMoreMenu(null)}
                    width={180}
                    signature
                    items={[
                      { key: 'share', label: 'Share', onClick: () => setShareOpen(true) },
                      { key: 'csv', label: 'Export CSV', onClick: () => exportCsv(rows, visibleCols) },
                    ]}
                  />
                  {shareOpen && (
                    <ScreenshotPopover
                      title="Share Breadth"
                      onDownload={onShareDownload}
                      onCopy={onShareCopy}
                      onShare={onShareUrl}
                      onClose={() => setShareOpen(false)}
                    />
                  )}
                </div>
              </>
            )}
          </>
        )}
      >
        <BreadthTabs active={activeTab} onChange={setActiveTab} isAdmin={isAdmin} />
      </SurfaceHeader>

      {errorBanner}

      {!error && rows.length === 0 && !isLoading && (
        <div className={styles.empty}>
          No breadth history has been recorded yet. Each session is recorded after the close
          (about 4:30 PM ET).
        </div>
      )}


      {/* ⛔ THE REPORTER WRAPS THE CHILD RATHER THAN SITTING BESIDE IT: its
          cleanup has to be the child's own unmount, for every reason the child
          can leave — not a second copy of the conditions above it. */}
      {rows.length > 0 && activeTab === 'heatmap' && (
        <UnmountReporter onUnmount={spendLink} onReattached={unspendLink}>
          <BreadthViews rows={rows} onDrill={openDrill} live={liveBreadth} liveStamp={liveClock}
                        urlState={viewsUrlState} onUrlChange={setViewsUrl} />
        </UnmountReporter>
      )}

      {grid.count > 0 && activeTab === 'breadth' && visibleCols.length === 0 && (
        <div className={styles.empty}>
          All metrics are hidden. Open <strong>Columns</strong> to show some.
        </div>
      )}

      {/* Every row below describes a finished day. None of them can say what
          today is doing, because today isn't a row yet — this is that answer,
          and it disappears the moment the 4:15 collector makes it one. It only
          belongs above the LATEST window; teleported back in time, "today" has
          no business sitting over a historical sheet. */}
      {activeTab === 'breadth' && <LiveSessionStrip live={liveBreadth} />}

      {/* Completeness audit 2026-10-07: the Monitor grid swallowed a failed timeline read and
          failed row blocks -- "Loading…" forever, rows that never filled. Said, with a Retry;
          a failed row is never drawn as data (it stays an unfilled row under this notice). */}
      {activeTab === 'breadth' && (grid.datesFailed || grid.blocksFailed > 0) && (
        <PanelState kind="error" compact role="status" testId="breadth-monitor-failed"
          title={grid.datesFailed
            ? (grid.count > 0
                ? "The breadth timeline couldn't be refreshed; the saved sessions are shown."
                : "The breadth monitor couldn't be loaded right now.")
            : "Some breadth sessions couldn't be loaded; their rows are left empty, not zero."}
          action={<button type="button" onClick={() => grid.retry()}>Retry</button>} />
      )}

      {grid.count > 0 && activeTab === 'breadth' && visibleCols.length > 0 && (
        <div className={styles.tableWrap} ref={tableWrapRef} data-guide="breadth.table"
             onScroll={ageTip ? () => setAgeTip(null) : undefined}>
          <table className={styles.table} aria-label="Breadth monitor">
            <thead>
              {/* Single column-label row — the colored group-header strip was
                  retired 2026-08-26; families are separated by a hairline rule
                  on each group's first column instead. */}
              <tr ref={headRowRef}>
                <th scope="col" className={`${styles.th} ${styles.dateCol}`} style={{ minWidth: 72 }}>Date
                  {/* 10ch of the CELL font, measured for the equal-width groups. */}
                  <span ref={chProbeRef} className={styles.chProbe} aria-hidden="true" />
                </th>
                {visibleCols.map((col, ci) => {
                  const isMa = col.type === 'ma_stack'
                  const label = isMa
                    // Just the symbol: the dots' order (10 → 200) is spelled out
                    // in the header's title.
                    ? maStackSym(col)
                    : col.subLabels
                      ? <>{col.label}<span className={styles.colSubLabel}>{col.subLabels}</span></>
                      : col.label
                  return (
                    <th
                      scope="col"
                      key={col.key}
                      // No native title and no hover card: the column's meaning is the
                      // header of its click menu (and the hidden description below).
                      className={`${styles.th} ${styles.colLabel} ${groupStartKeys.has(col.key) && !widthGroupOf(col.key) ? styles.groupStart : ''} ${isMa ? styles.thMa : ''}`}
                      data-col-key={col.key}
                      data-width-group={widthGroupOf(col.key) ?? undefined}
                      style={colWidthStyle(col, isMa, colSizing)}
                    >
                      {/* The header opens the chart's Signature menu (one ContextPopover
                          for the sheet, below): Enter/Space opens it, Esc closes it and
                          focus returns here. */}
                      <button
                        type="button"
                        className={styles.thBtn}
                        data-testid={`col-menu-${col.key}`}
                        aria-label={isMa ? `${maStackTitle(col)} — column options` : `${col.label} column options`}
                        aria-haspopup="menu"
                        aria-expanded={colMenu?.key === col.key}
                        aria-describedby={columnInfo(col.key) ? `breadth-col-info-${col.key}` : undefined}
                        onClick={(e) => openColMenu(col.key, ci, e.currentTarget)}
                      >
                        {label}
                      </button>
                      {/* The explanation for screen readers (the visible one is the
                          menu's header): visually hidden, never a native title. */}
                      {columnInfo(col.key) && (
                        <span id={`breadth-col-info-${col.key}`} className={styles.srOnly}>
                          {`${columnInfo(col.key).name}. ${columnInfo(col.key).desc}`}
                        </span>
                      )}
                    </th>
                  )
                })}
                {/* Filler: takes the width the table gains from filling the window, so every
                    real column keeps its natural width (owner 2026-11-19: Date had slack). */}
                <th className={styles.fillCol} aria-hidden="true" />
              </tr>
            </thead>
            <tbody>
              {/* Virtualized: only the visible slice of the full timeline is in
                  the DOM, so scrolling 18 years of sessions stays smooth. Spacer
                  rows hold the scroll height above and below the rendered window. */}
              {virtualItems.length > 0 && (
                <tr aria-hidden="true" data-snapshot-skip="">
                  <td colSpan={visibleCols.length + 2} style={{ height: virtualItems[0].start, padding: 0, border: 0 }} />
                </tr>
              )}
              {virtualItems.map((vi) => {
                const ri = vi.index
                const row = grid.getRow(ri)
                if (!row) {
                  // Not fetched yet — the date is known from the timeline index;
                  // the metric cells fill in the instant the block lands.
                  const skelDate = grid.allDates[ri]
                  return (
                    <tr key={skelDate ?? ri}
                        className={`${ri % 2 === 0 ? styles.rowEven : styles.rowOdd} ${styles.skeletonRow}`}>
                      <td className={`${styles.td} ${styles.dateCell}`}>{skelDate}</td>
                      {visibleCols.map(col => (
                        <td key={col.key} className={`${styles.td} ${groupStartKeys.has(col.key) && !widthGroupOf(col.key) ? styles.groupStart : ''}`}>
                          <span className={styles.skelDot} aria-hidden="true">·</span>
                        </td>
                      ))}
                      <td className={styles.fillCol} aria-hidden="true" />
                    </tr>
                  )
                }
                // The row's single tab stop. Derived from `visibleCols` because
                // that IS the render order below — a second ordering here would
                // put the stop on a cell that is not the first one on screen.
                const firstDrillKey = visibleCols.find(
                  c => drillTarget(row, c, liveBreadth),
                )?.key ?? null
                return (
                <tr key={row.date} className={`${ri % 2 === 0 ? styles.rowEven : styles.rowOdd} ${row._live ? styles.liveRow : ''}`}>
                  <td className={`${styles.td} ${styles.dateCell}`}>
                    {row._live
                      ? (
                        <span className={styles.liveStamp} title={liveTitle}>
                          <span className={styles.livePulse} aria-hidden="true" />
                          {liveClock}
                        </span>
                      )
                      : row.date}
                    {/* Follow-Through Day: a quiet tag on the date instead of its own
                        column (owner 2026-11-19; the FTD column stays in Columns). */}
                    {!!row.is_ftd && (
                      <span className={styles.ftdExt}><span className={styles.ftdTag} title="Follow-Through Day" aria-label="Follow-Through Day">FTD</span></span>
                    )}
                  </td>
                  {visibleCols.map(col => {
                    const groupStart = groupStartKeys.has(col.key) && !widthGroupOf(col.key) ? styles.groupStart : ''
                    if (col.type === 'sparkline') {
                      const val = row[col.key]
                      const last10 = grid.trail(ri, col.key)
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
                      // keys order: [10sma, 20sma, 50sma, 200sma]. Four small dots:
                      // filled up colour = above that average, a hollow down-colour
                      // ring = below, a faint ring = no reading. The title and the
                      // label say which average is which.
                      const sym = maStackSym(col)
                      const said = col.keys.map((k, i) => {
                        const v = row[k]
                        return `${col.maLabels[i]}-day: ${v === 1 ? 'above' : v === 0 ? 'below' : 'no reading'}`
                      }).join(' · ')
                      return (
                        <td key={col.key} className={`${styles.td} ${styles.maStackCell} ${groupStart}`}
                            title={`${sym} vs its moving averages — ${said}`}>
                          <span className={styles.maDots} role="img" aria-label={`${sym} moving averages: ${said}`}>
                            {col.keys.map((k) => {
                              const v = row[k]
                              const cls = v === 1 ? styles.maDotUp : v === 0 ? styles.maDotDown : styles.maDotNone
                              return <span key={k} className={`${styles.maDot} ${cls}`} data-ma={k} />
                            })}
                          </span>
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
                    // TERM-059: the age authority (col.age → sentimentAge.js /
                    // naaimAge.js) still decides when a value is CARRIED from an
                    // earlier survey / print. Owner 2026-11-19: it is no longer
                    // printed inline (that widened the column and repeated on every
                    // row); a carried value reads muted, and its as-of goes in the
                    // cell's tooltip and accessible name.
                    const age = col.age ? col.age(row) : null
                    const carried = !!age?.mustLabel
                    const ageTitle = carried ? carriedNote(age) : null
                    return (
                      <td
                        key={col.key}
                        className={`${styles.td} ${cellClass(col, val, row)} ${isStaleAaii && !carried ? styles.aaiiStale : ''} ${carried ? styles.carriedValue : ''} ${isDrillable ? styles.drillable : ''} ${liveGrade === 'carried' ? styles.liveCarried : ''} ${liveGrade === 'approximate' ? styles.liveApprox : ''}`}
                        title={
                          liveGrade === 'carried'
                            ? `Last night's reading (${liveBreadth.carriedFrom}) — not live`
                            : liveGrade === 'approximate'
                              ? 'Provisional, reconciles to roughly 10%'
                              : liveBreadth.partial?.has(col.key) && row._live
                                ? 'Builds through the session — only complete at the close'
                                : carried ? undefined   // its as-of shows in the age tooltip below
                                  : isStaleAaii ? `Survey: ${row.aaii_survey_date}`
                                    : isDrillable ? 'Click to see stocks' : undefined
                        }
                        {...(carried ? {
                          'data-value-age': col.key,
                          'aria-label': `${col.label} ${fmtCell(col, val)}, ${ageTitle.toLowerCase()}`,
                          // Hover shows the value's own as-of as the provenance badge
                          // (FreshnessBadge), in one floating tooltip for the sheet.
                          onPointerEnter: (e) => {
                            const r = e.currentTarget.getBoundingClientRect()
                            setAgeTip({ left: r.left, top: r.bottom + 4, key: `${row.date}:${col.key}`, note: ageTitle, age })
                          },
                          onPointerLeave: () => setAgeTip(null),
                        } : {})}
                        onClick={isDrillable ? () => openDrill(row, col, liveBreadth) : undefined}
                        {...(isDrillable ? {
                          onPointerEnter: () => prefetchCell(row, col),
                          'data-drill': '',
                          role: 'button',
                          tabIndex: col.key === firstDrillKey ? 0 : -1,
                          onKeyDown: (e) => onCellKey(e, row, col),
                          // A bare role=button would be announced as just the
                          // number. Name it with the metric, the value and the
                          // session, because "134" alone says nothing about what
                          // pressing it opens.
                          'aria-label': `${col.label} ${val === null || val === undefined ? 'no reading' : val}`
                            + `${row._live ? ', live session' : `, ${row.date}`} — open the list of stocks`,
                        } : {})}
                      >
                        {fmtCell(col, val)}
                      </td>
                    )
                  })}
                  <td className={styles.fillCol} aria-hidden="true" />
                </tr>
                )
              })}
              {virtualItems.length > 0 && (
                <tr aria-hidden="true" data-snapshot-skip="">
                  <td colSpan={visibleCols.length + 2} style={{ height: Math.max(0, rowVirtualizer.getTotalSize() - virtualItems[virtualItems.length - 1].end), padding: 0, border: 0 }} />
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
      {activeTab === 'breadth' && (
        <ContextPopover
          open={!!colMenu}
          anchor={colMenu?.anchor}
          onClose={closeColMenu}
          returnFocusTo={colMenuBtn}
          width={264}
          signature
          header={colMenu ? <ColumnInfoBlock colKey={colMenu.key} /> : null}
          items={colMenu ? [
            { key: 'move-left', label: 'Move left', disabled: colMenu.index === 0, onClick: () => moveCol(colMenu.key, -1) },
            { key: 'move-right', label: 'Move right', disabled: colMenu.index === visibleCols.length - 1, onClick: () => moveCol(colMenu.key, 1) },
            { key: 'hide', label: 'Hide column', onClick: () => hideCol(colMenu.key) },
          ] : []}
        />
      )}
      {ageTip && activeTab === 'breadth' && (
        <div className={styles.ageTip} role="tooltip" data-testid="breadth-age-tip"
             style={{ left: ageTip.left, top: ageTip.top }}>
          <span className={styles.ageTipNote}>{ageTip.note}</span>
          <FreshnessBadge age={{ dataClass: ageTip.age.dataClass, asOfDate: ageTip.age.asOfDate }} />
        </div>
      )}
      {drill && (
          <Suspense fallback={null}>
            <BreadthDrillModal drill={drill} latestDate={rows[0]?.date} onRetry={retryDrill} onClose={() => setDrill(null)}
              rows={rows} drillCols={DRILL_COLS} onNavigate={navigateDrill} />
          </Suspense>
        )}
    </div>
  )
}
