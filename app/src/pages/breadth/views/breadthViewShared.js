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
  if (MA_STACK_COLS[k]) {
    const cols = MA_STACK_COLS[k]
    if (cols.every(c => row[c] == null)) return null
    return cols.filter(c => row[c] === 1).length
  }
  if (k === 'is_ftd') return row.is_ftd == null ? null : (row.is_ftd ? 1 : 0)
  const v = row[k]
  if (v == null || isNaN(Number(v))) return null
  return Number(v)
}

// Percent of the sorted ascending array <= v.
export function percentileRank(sorted, v) {
  if (!sorted?.length) return null
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

// Bullishness on a 0..100 scale regardless of polarity (bear metrics inverted),
// so signals can be compared across metrics. null when the metric has no value.
export function bullishness(metric, row, pctileByKey) {
  const n = normalizeMetric(metric, row, pctileByKey)
  if (n == null) return null
  return metric.polarity === 'bear' ? (100 - n) : n
}

// Minimum divergence (points off the board mean, on the 0..100 bullishness scale)
// before a metric is flagged "notable". Below this, nothing pulses — no fake alarms.
export const NOTABLE_MIN_DEV = 20

// A move (vs prevRow) below this counts as "nothing happened" → signal falls back
// to the most-extreme reading instead of the biggest mover.
export const SIGNAL_MIN_MOVE = 5

/**
 * Pick the two cross-cutting callouts for the day:
 *  - signalKey  : "Signal of the Day" — the metric that moved most vs prevRow
 *                 (~3 trading days ago); falls back to the most extreme reading
 *                 when nothing moved meaningfully.
 *  - notableKey : the metric most diverging from the board's overall tilt
 *                 (leaning against the crowd), only when |dev| >= NOTABLE_MIN_DEV.
 * Returns { signalKey, notableKey, signalReason, notableReason } — keys may be null.
 */
export function pickSignals(metrics, currentRow, prevRow, pctileByKey) {
  const stats = []
  for (const m of metrics) {
    const cur = bullishness(m, currentRow, pctileByKey)
    if (cur == null) continue
    const prev = prevRow ? bullishness(m, prevRow, pctileByKey) : null
    const move = prev == null ? 0 : Math.abs(cur - prev)
    stats.push({ key: m.key, cur, move, extreme: Math.abs(cur - 50) })
  }
  if (stats.length === 0) {
    return { signalKey: null, notableKey: null, signalReason: '', notableReason: '' }
  }

  // Signal: biggest mover; if nothing moved meaningfully, the most extreme reading.
  const maxMove = Math.max(...stats.map(s => s.move))
  let signal, signalReason
  if (maxMove >= SIGNAL_MIN_MOVE) {
    signal = stats.reduce((a, b) => (b.move > a.move ? b : a))
    signalReason = 'biggest move'
  } else {
    signal = stats.reduce((a, b) => (b.extreme > a.extreme ? b : a))
    signalReason = 'most extreme'
  }

  // Notable: largest divergence from the board mean, leaning against the tilt.
  const mean = stats.reduce((s, x) => s + x.cur, 0) / stats.length
  const tilt = mean - 50  // >0 board bullish, <0 board bearish
  let notable = null, maxDev = 0
  for (const s of stats) {
    if (s.key === signal.key) continue
    const dev = s.cur - mean
    const opposing = tilt === 0 ? true : (Math.sign(dev) !== Math.sign(tilt))
    if (opposing && Math.abs(dev) > maxDev) { maxDev = Math.abs(dev); notable = s }
  }
  if (maxDev < NOTABLE_MIN_DEV) notable = null

  return {
    signalKey: signal.key,
    notableKey: notable ? notable.key : null,
    signalReason,
    notableReason: notable ? (tilt >= 0 ? 'lagging the board' : 'leading the board') : '',
  }
}

const TIER_RANK = { g3: 0, g2: 1, g1: 2, a: 3, r1: 4, r2: 5, r3: 6, '': 7 }

/**
 * Order visible metrics for the value/tier/bullishness sorts shared by Scoreboard,
 * Levels, and Meters. Unknown/`group`/`board` modes preserve the incoming order.
 *   normalize(metric,row) → 0..100 or null.
 */
export function sortVisibleMetrics(metrics, mode, normalize, row) {
  if (mode === 'value' || mode === 'bull') {
    const score = (m) => {
      const n = normalize(m, row)
      if (n == null) return -1
      return mode === 'bull' && m.polarity === 'bear' ? 100 - n : n
    }
    return [...metrics].sort((a, b) => score(b) - score(a))
  }
  if (mode === 'tier') {
    const rank = (m) => TIER_RANK[(m.getTier ? m.getTier(row) : '') || ''] ?? 7
    return [...metrics].sort((a, b) => rank(a) - rank(b))
  }
  return metrics  // group / board / undefined → original order
}

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
