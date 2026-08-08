/**
 * Breadth metric registry — the heatmap/views metric definitions, tier colors,
 * and treemap layout, EXTRACTED VERBATIM from Breadth.jsx (2026-07-22) so the
 * /charts Breadth widget can import them WITHOUT pulling the whole Breadth page
 * (CotData/Chart.js, BreadthCharts/echarts, Analogues…) into the workspace
 * bundle. Breadth.jsx re-exports everything here, so page-side importers
 * (BreadthViews, TreemapView, InternalsRender) are unchanged.
 *
 * This also breaks the Breadth.jsx ⇆ BreadthViews circular import that forced
 * BreadthViews to defer HM_METRICS reads into render time.
 */
import { polarityOf, PAIRS } from './views/breadthViewShared'

export function pctColor(low, mid, high) {
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
export function pairedUpColor(u, d) {
  if (u == null || d == null || u + d === 0) return ''
  const r = u / (u + d)
  if (r >= 0.70) return 'g3'
  if (r >= 0.60) return 'g2'
  if (r >= 0.50) return 'g1'
  return 'r1'  // bear wins; up is minority → lightest red
}
export function pairedDnColor(u, d) {
  if (u == null || d == null || u + d === 0) return ''
  const r = u / (u + d)
  if (r <= 0.30) return 'r3'
  if (r <= 0.40) return 'r2'
  if (r < 0.50)  return 'r1'
  return 'g1'  // bull wins; dn is minority → lightest green
}

export function getMaStackTier(col, row) {
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

// ── ECharts matrix heatmap ─────────────────────────────────────────────────
// Maps tier string → numeric score for visualMap
export const TIER_SCORES = { g3: 6, g2: 5, g1: 4, a: 3, r1: 2, r2: 1, r3: 0 }

// Human-readable tier labels (shown in tooltip)
export const TIER_LABELS = {
  6: 'Extreme Bullish', 5: 'Bullish', 4: 'Mild Bullish',
  3: 'Caution', 2: 'Mild Bearish', 1: 'Bearish', 0: 'Extreme Bearish',
}

// Bright colors for tooltip text readability
export const TIER_TIP_COLORS = {
  6: '#4ade80', 5: '#22c55e', 4: '#86efac',
  3: '#f59e0b', 2: '#fca5a5', 1: '#f87171', 0: '#ef4444',
}

// Flat metric list with group-header separators
// Each real metric has getTier(row)→tier and getFmt(row)→string
export const HM_METRICS = [
  { key: '__h_score',   label: 'SCORE',           isHeader: true, group: 'Score' },
  { key: 'breadth_score', label: 'Health',         group: 'Score',
    getTier: r => { const v = r.breadth_score; return v == null ? '' : v >= 80 ? 'g3' : v >= 65 ? 'g2' : v >= 52 ? 'g1' : v >= 45 ? 'a' : v >= 35 ? 'r1' : v >= 20 ? 'r2' : 'r3' },
    getFmt:  r => r.breadth_score == null ? '—' : Math.round(r.breadth_score).toString() },
  { key: 'uct_exposure', label: 'UCT Exp',         group: 'Score',
    getTier: r => { const v = r.uct_exposure; return v == null ? '' : v >= 110 ? 'g3' : v >= 90 ? 'g2' : v >= 70 ? 'g1' : v >= 50 ? 'a' : v >= 30 ? 'r1' : v >= 15 ? 'r2' : 'r3' },
    getFmt:  r => r.uct_exposure == null ? '—' : Math.round(r.uct_exposure).toString() },

  { key: '__h_primary', label: 'PRIMARY BREADTH',  isHeader: true, group: 'Primary' },
  { key: 'up_4pct_today',   label: 'Up 4%+',       group: 'Primary', drillKey: 'up_4pct_today_list',
    getTier: r => pairedUpColor(r.up_4pct_today, r.down_4pct_today),
    getFmt:  r => r.up_4pct_today ?? '—' },
  { key: 'down_4pct_today', label: 'Dn 4%+',       group: 'Primary', drillKey: 'down_4pct_today_list',
    getTier: r => pairedDnColor(r.up_4pct_today, r.down_4pct_today),
    getFmt:  r => r.down_4pct_today ?? '—' },
  { key: 'ratio_5day',      label: '5D Ratio',      group: 'Primary',
    getTier: r => { const v = r.ratio_5day; return v == null ? '' : v >= 2.0 ? 'g3' : v >= 1.5 ? 'g2' : v > 0.6 ? '' : v > 0.5 ? 'r1' : v > 0.4 ? 'r2' : 'r3' },
    getFmt:  r => r.ratio_5day == null ? '—' : Number(r.ratio_5day).toFixed(2) },
  { key: 'ratio_10day',     label: '10D Ratio',     group: 'Primary',
    getTier: r => { const v = r.ratio_10day; return v == null ? '' : v >= 2.0 ? 'g3' : v >= 1.5 ? 'g2' : v > 0.6 ? '' : v > 0.5 ? 'r1' : v > 0.4 ? 'r2' : 'r3' },
    getFmt:  r => r.ratio_10day == null ? '—' : Number(r.ratio_10day).toFixed(2) },
  { key: 'up_20pct_5d',        label: 'Up 20%/5d',   group: 'Primary', drillKey: 'up_20pct_5d_list',
    getTier: r => pairedUpColor(r.up_20pct_5d, r.down_20pct_5d),
    getFmt:  r => r.up_20pct_5d ?? '—' },
  { key: 'down_20pct_5d',      label: 'Dn 20%/5d',   group: 'Primary', drillKey: 'down_20pct_5d_list',
    getTier: r => pairedDnColor(r.up_20pct_5d, r.down_20pct_5d),
    getFmt:  r => r.down_20pct_5d ?? '—' },
  { key: 'up_25pct_quarter',   label: 'Up 25%/Qtr',  group: 'Primary', drillKey: 'up_25pct_quarter_list',
    getTier: r => pairedUpColor(r.up_25pct_quarter, r.down_25pct_quarter),
    getFmt:  r => r.up_25pct_quarter ?? '—' },
  { key: 'down_25pct_quarter', label: 'Dn 25%/Qtr',  group: 'Primary', drillKey: 'down_25pct_quarter_list',
    getTier: r => pairedDnColor(r.up_25pct_quarter, r.down_25pct_quarter),
    getFmt:  r => r.down_25pct_quarter ?? '—' },
  { key: 'up_50pct_month',     label: 'Up 50%/Mo',   group: 'Primary', drillKey: 'up_50pct_month_list',
    getTier: r => pairedUpColor(r.up_50pct_month, r.down_50pct_month),
    getFmt:  r => r.up_50pct_month ?? '—' },
  { key: 'down_50pct_month',   label: 'Dn 50%/Mo',   group: 'Primary', drillKey: 'down_50pct_month_list',
    getTier: r => pairedDnColor(r.up_50pct_month, r.down_50pct_month),
    getFmt:  r => r.down_50pct_month ?? '—' },
  { key: 'magna_up',        label: 'Up 13%/34d',    group: 'Primary', drillKey: 'magna_up_list',
    getTier: r => pairedUpColor(r.magna_up, r.magna_down),
    getFmt:  r => r.magna_up ?? '—' },
  { key: 'magna_down',      label: 'Dn 13%/34d',    group: 'Primary', drillKey: 'magna_down_list',
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
  { key: 'new_52w_highs', label: '52W Highs',       group: 'Highs/Lows', drillKey: 'new_52w_highs_list',
    getTier: r => pairedUpColor(r.new_52w_highs, r.new_52w_lows),
    getFmt:  r => r.new_52w_highs ?? '—' },
  { key: 'new_52w_lows',  label: '52W Lows',        group: 'Highs/Lows', drillKey: 'new_52w_lows_list',
    getTier: r => pairedDnColor(r.new_52w_highs, r.new_52w_lows),
    getFmt:  r => r.new_52w_lows ?? '—' },
  { key: 'new_20d_highs', label: '20D Highs',       group: 'Highs/Lows', drillKey: 'new_20d_highs_list',
    getTier: r => pairedUpColor(r.new_20d_highs, r.new_20d_lows),
    getFmt:  r => r.new_20d_highs ?? '—' },
  { key: 'new_20d_lows',  label: '20D Lows',        group: 'Highs/Lows', drillKey: 'new_20d_lows_list',
    getTier: r => pairedDnColor(r.new_20d_highs, r.new_20d_lows),
    getFmt:  r => r.new_20d_lows ?? '—' },
  { key: 'new_ath',       label: 'ATH Count',       group: 'Highs/Lows',
    // Re-derived 2026-08-06 with the collector's all-time-high fix (~0.59x the
    // old value); the previous 200/100/40 was calibrated on 52-week highs.
    getTier: r => { const v = r.new_ath; return v == null ? '' : v > 120 ? 'g3' : v > 60 ? 'g2' : v > 25 ? 'g1' : '' },
    getFmt:  r => r.new_ath ?? '—' },
  { key: 'hvc_52w',      label: 'HVC (52W Vol Hi)', group: 'Highs/Lows', drillKey: 'hvc_52w_list',
    getTier: r => { const v = r.hvc_52w; return v == null ? '' : v > 100 ? 'g3' : v > 40 ? 'g2' : v > 15 ? 'g1' : '' },
    getFmt:  r => r.hvc_52w ?? '—' },
  { key: 'atr_ext_7',  label: '>7× ATR Ext',  group: 'Highs/Lows', drillKey: 'atr_ext_7_list',
    getTier: r => { const v = r.atr_ext_7;  return v == null ? '' : v > 50 ? 'g3' : v > 30 ? 'g2' : v > 15 ? 'g1' : '' },
    getFmt:  r => r.atr_ext_7  ?? '—' },

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
// black "no data" cells on off-survey days.
//
// ⚠️ Everything here must genuinely be a WEEKLY survey, where carrying the
// reading across the days between surveys is what the number means. AAII and
// NAAIM qualify — and NAAIM ships `naaim_date` alongside, so the age of a
// carried reading stays visible.
//
// `cboe_putcall` was in this list and did not belong: it is a DAILY series that
// prints every session. Carrying it forward only ever fires when a session is
// genuinely unpublished — which is exactly the case the collector was changed
// to represent as an honest gap, after 86 of 150 stored rows turned out to hold
// the PREVIOUS session's ratio. Forward-filling it here re-created that defect
// one layer up: the API says "absent", two surfaces render yesterday's number
// as today's, and a put/call spike appears the day after it happened.
export const FFILL_KEYS = ['aaii_bulls', 'aaii_neutral', 'aaii_bears', 'aaii_spread', 'naaim']

// Keys that have a single numeric field we can compute percentile rank on
export const PCTILE_KEYS = new Set([
  'breadth_score', 'uct_exposure',
  'up_4pct_today', 'down_4pct_today', 'ratio_5day', 'ratio_10day', 'magna_up', 'magna_down',
  'up_20pct_5d', 'down_20pct_5d',
  'pct_above_20ema', 'pct_above_50sma', 'pct_above_200sma',
  'sp500_close', 'qqq_close', 'vix', 'mcclellan_osc', 'stage2_count', 'stage4_count',
  'new_52w_highs', 'new_52w_lows', 'new_20d_highs', 'new_20d_lows', 'new_ath', 'hvc_52w',
  'atr_ext_7',
  'cnn_fear_greed', 'aaii_spread', 'cboe_putcall',
])

// Solid tile fill colors per tier (used in treemap cells)
export const TIER_CELL_COLORS = {
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
export const HM_METRICS_BY_KEY = Object.fromEntries(
  HM_METRICS.filter(m => !m.isHeader).map(m => [m.key, m])
)

// Attach view metadata (polarity + tug pairing) to the registry once at load.
// Kept here so the metric definitions stay the single source of truth.
for (const m of HM_METRICS) {
  if (m.isHeader) continue
  m.polarity = polarityOf(m.key)
}
for (const [up, down] of PAIRS) {
  if (HM_METRICS_BY_KEY[up])   HM_METRICS_BY_KEY[up].pair   = { partnerKey: down, side: 'up' }
  if (HM_METRICS_BY_KEY[down]) HM_METRICS_BY_KEY[down].pair = { partnerKey: up, side: 'down' }
}

// Treemap layout definition: groups → weighted metric tiles
export const TREEMAP_DEF = [
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
      { metricKey: 'up_20pct_5d',        weight: 8 },
      { metricKey: 'down_20pct_5d',      weight: 8 },
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
      { metricKey: 'atr_ext_7',         weight: 6 },
    ],
  },
]
