/**
 * Shared, framework-free helpers for the Breadth Views (Rings / Tug / Meters /
 * Treemap). Keeping these pure means every view renders from one source of
 * truth and a future compose-canvas can reuse them.
 *
 * Spec: docs/superpowers/specs/2026-06-01-breadth-views-multi-style-design.md
 */

export const clamp = (v) => Math.max(0, Math.min(100, v))

// MA-stack metrics are a count of 4 boolean columns; expose the count.
const MA_STACK_COLS = {
  spy_ma_stack: ['spy_above_10sma', 'spy_above_20sma', 'spy_above_50sma', 'spy_above_200sma'],
  qqq_ma_stack: ['qqq_above_10sma', 'qqq_above_20sma', 'qqq_above_50sma', 'qqq_above_200sma'],
}

export function metricValue(metric, row) {
  const k = metric.key
  if (MA_STACK_COLS[k]) return MA_STACK_COLS[k].filter(c => row[c] === 1).length
  if (k === 'is_ftd') return row.is_ftd ? 1 : 0
  const v = row[k]
  if (v == null || isNaN(Number(v))) return null
  return Number(v)
}

// Percent of the sorted ascending array <= v.
export function percentileRank(sorted, v) {
  if (!sorted || sorted.length < 1) return null
  return Math.round(sorted.filter(x => x <= v).length / sorted.length * 100)
}

// Keys whose raw value is already on a 0..100 scale.
const NATIVE_PCT = (k) => k.startsWith('pct_above_') || k === 'cnn_fear_greed'

export function normalizeMetric(metric, row, pctileByKey) {
  const k = metric.key
  const v = metricValue(metric, row)
  if (v == null) return null
  if (MA_STACK_COLS[k]) return clamp(v / 4 * 100)
  if (k === 'mcclellan_osc') return clamp((v + 150) / 300 * 100)
  if (NATIVE_PCT(k)) return clamp(v)
  return percentileRank(pctileByKey?.[k], v)  // null if no series
}

// Bright, saturated colors for rings/bars (the treemap keeps its own dark fills).
const VIEW_TIER_COLOR = {
  g3: '#22c55e', g2: '#4ade80', g1: '#86efac', a: '#fbbf24',
  r1: '#fca5a5', r2: '#f87171', r3: '#ef4444', '': '#475569',
}
export function metricColor(metric, row) {
  const tier = metric.getTier ? (metric.getTier(row) || '') : ''
  return VIEW_TIER_COLOR[tier] ?? VIEW_TIER_COLOR['']
}

// Metrics where a HIGH reading is bearish (everything else is bullish).
const BEARISH_KEYS = new Set([
  'down_4pct_today', 'down_25pct_quarter', 'down_50pct_month', 'magna_down',
  'stage4_count', 'new_52w_lows', 'new_20d_lows', 'vix', 'cnn_fear_greed',
])
export function polarityOf(key) {
  return BEARISH_KEYS.has(key) ? 'bear' : 'bull'
}

// Up/down metric pairs for the tug-of-war. side 'up' = bull side.
export const PAIRS = [
  ['up_4pct_today', 'down_4pct_today'],
  ['up_25pct_quarter', 'down_25pct_quarter'],
  ['up_50pct_month', 'down_50pct_month'],
  ['magna_up', 'magna_down'],
  ['stage2_count', 'stage4_count'],
  ['new_52w_highs', 'new_52w_lows'],
  ['new_20d_highs', 'new_20d_lows'],
]

// Signed net bull share across visible pairs, -100..100. null if none usable.
export function netPosture(metrics, row) {
  const ups = metrics.filter(m => m.pair && m.pair.side === 'up')
  let acc = 0, n = 0
  for (const up of ups) {
    const down = metrics.find(m => m.key === up.pair.partnerKey)
    const u = metricValue(up, row)
    const d = down ? metricValue(down, row) : null
    if (u == null || d == null || (u + d) === 0) continue
    acc += (u - d) / (u + d)
    n++
  }
  if (!n) return null
  return Math.round(acc / n * 100)
}
