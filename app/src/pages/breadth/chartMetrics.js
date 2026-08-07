/**
 * Everything the Breadth → Data Charts tab knows about its metrics:
 * the catalog (groups + labels), the scale metadata (unit families), the
 * curated presets, and the rule that decides which y-axis a series lands on.
 *
 * Kept out of BreadthCharts.jsx so the axis rule is unit-testable without
 * mounting ECharts.
 */

// ── Catalog ───────────────────────────────────────────────────────────────────

export const CHART_GROUPS = [
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
      { key: 'up_20pct_5d',         label: 'Up 20%/5d' },
      { key: 'down_20pct_5d',       label: 'Dn 20%/5d' },
      { key: 'up_25pct_quarter',    label: 'Up 25%/Qtr' },
      { key: 'down_25pct_quarter',  label: 'Dn 25%/Qtr' },
      { key: 'up_25pct_month',      label: 'Up 25%/Mo' },
      { key: 'down_25pct_month',    label: 'Dn 25%/Mo' },
      { key: 'up_50pct_month',      label: 'Up 50%/Mo' },
      { key: 'down_50pct_month',    label: 'Dn 50%/Mo' },
      { key: 'magna_up',            label: 'Up 13%/34d' },
      { key: 'magna_down',          label: 'Dn 13%/34d' },
      { key: 'universe_count',      label: 'Universe Count' },
      { key: 'adv_decline',         label: 'Net Advancers' },
      { key: 'adv_decline_cum',     label: 'A/D Line' },
      { key: 'up_vol_ratio',        label: 'Up/Down Volume' },
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
      { key: 'rsp_spy_ratio', label: 'RSP/SPY (Equal-Wt)' },
      { key: 'iwm_qqq_ratio', label: 'IWM/QQQ (Small-Cap)' },
      { key: 'vxn',           label: 'VXN (Nasdaq)' },
      { key: 'avg_10d_vix',   label: 'VIX 10D Avg' },
      { key: 'avg_10d_vxn',   label: 'VXN 10D Avg' },
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
      { key: 'hvc_52w',       label: 'HVC (52W Vol Hi)' },
      { key: 'atr_ext_7',     label: '>7× ATR Ext (50SMA)' },
      { key: 'hi_ratio',      label: '% at 52W Highs' },
      { key: 'lo_ratio',      label: '% at 52W Lows' },
      { key: 'near_52w_high', label: 'Within 5% of High' },
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
      { key: 'avg_10d_cpc',    label: 'P/C 10D Avg' },
    ],
  },
]

export const ALL_METRICS = CHART_GROUPS.flatMap(g => g.metrics)
export const LABEL_MAP = Object.fromEntries(ALL_METRICS.map(m => [m.key, m.label]))

// ── Unit families ─────────────────────────────────────────────────────────────
// Series only share a y-axis with series of the same family. Without this,
// mixing a 0–5 ratio with a 0–1000 count renders the ratio flat on the floor.

export const UNIT = {
  PCT:    'pct',    // 0–150 bounded percentages and composite scores
  COUNT:  'count',  // number of stocks
  RATIO:  'ratio',  // unitless ~0–5
  INDEX:  'index',  // index / ETF price level
  VIX:    'vix',    // volatility points
  OSC:    'osc',    // oscillator, roughly -100..+100
  CUM:    'cum',    // running cumulative total, thousands
  NET:    'net',    // signed daily net, ±2,000
  SPREAD: 'spread', // intermarket price ratio, 0.27–0.44
}

export const UNIT_LABEL = {
  [UNIT.PCT]:    '%',
  [UNIT.COUNT]:  'stocks',
  [UNIT.RATIO]:  'ratio',
  [UNIT.INDEX]:  'index',
  [UNIT.VIX]:    'VIX',
  [UNIT.OSC]:    'osc',
  [UNIT.CUM]:    'A/D line',
  [UNIT.NET]:    'net',
  [UNIT.SPREAD]: 'spread',
}

export const METRIC_UNITS = {
  // Score
  breadth_score: UNIT.PCT,
  uct_exposure:  UNIT.PCT,

  // Primary Breadth
  up_4pct_today:      UNIT.COUNT,
  down_4pct_today:    UNIT.COUNT,
  ratio_5day:         UNIT.RATIO,
  ratio_10day:        UNIT.RATIO,
  up_20pct_5d:        UNIT.COUNT,
  down_20pct_5d:      UNIT.COUNT,
  up_25pct_quarter:   UNIT.COUNT,
  down_25pct_quarter: UNIT.COUNT,
  up_25pct_month:     UNIT.COUNT,
  down_25pct_month:   UNIT.COUNT,
  up_50pct_month:     UNIT.COUNT,
  down_50pct_month:   UNIT.COUNT,
  magna_up:           UNIT.COUNT,
  magna_down:         UNIT.COUNT,
  universe_count:     UNIT.COUNT,
  adv_decline:        UNIT.NET,
  adv_decline_cum:    UNIT.CUM,
  up_vol_ratio:       UNIT.RATIO,

  // MA Breadth
  pct_above_5sma:   UNIT.PCT,
  pct_above_10sma:  UNIT.PCT,
  pct_above_20ema:  UNIT.PCT,
  pct_above_40sma:  UNIT.PCT,
  pct_above_50sma:  UNIT.PCT,
  pct_above_100sma: UNIT.PCT,
  pct_above_200sma: UNIT.PCT,

  // Regime
  sp500_close:   UNIT.INDEX,
  qqq_close:     UNIT.INDEX,
  vix:           UNIT.VIX,
  mcclellan_osc: UNIT.OSC,
  stage2_count:  UNIT.COUNT,
  stage4_count:  UNIT.COUNT,
  rsp_spy_ratio: UNIT.SPREAD,
  iwm_qqq_ratio: UNIT.SPREAD,
  vxn:           UNIT.VIX,
  avg_10d_vix:   UNIT.VIX,
  avg_10d_vxn:   UNIT.VIX,

  // Highs / Lows
  new_52w_highs: UNIT.COUNT,
  new_52w_lows:  UNIT.COUNT,
  new_20d_highs: UNIT.COUNT,
  new_20d_lows:  UNIT.COUNT,
  new_ath:       UNIT.COUNT,
  hvc_52w:       UNIT.COUNT,
  atr_ext_7:     UNIT.COUNT,
  // hi/lo_ratio are nh/uni*100 (breadth_monitor.py:169) — percentages of the
  // universe, not ratios, so the axis must read '%'.
  hi_ratio:      UNIT.PCT,
  lo_ratio:      UNIT.PCT,
  near_52w_high: UNIT.COUNT,

  // Sentiment
  cnn_fear_greed: UNIT.PCT,
  aaii_bulls:     UNIT.PCT,
  aaii_neutral:   UNIT.PCT,
  aaii_bears:     UNIT.PCT,
  aaii_spread:    UNIT.PCT,
  naaim:          UNIT.PCT,
  cboe_putcall:   UNIT.RATIO,
  avg_10d_cpc:    UNIT.RATIO,
}

/** Unit family for a metric key. Unmapped keys fall back to COUNT — the
 *  `every metric has a unit` test is the gate that keeps that from happening. */
export function unitOf(key) {
  return METRIC_UNITS[key] ?? UNIT.COUNT
}

// ── Axis framing ──────────────────────────────────────────────────────────────
// Families whose axis frames its own data instead of including zero. The split
// is magnitude vs level: a count of stocks or a percent above a moving average
// is read against 0, but an index price, a VIX level, or a 0.03-wide
// intermarket spread is read as a shape and a zero anchor destroys it —
// rsp_spy_ratio (0.272–0.300) renders as a flat line at 93% height.

export const SCALED_UNITS = new Set([
  UNIT.INDEX, UNIT.VIX, UNIT.OSC, UNIT.CUM, UNIT.SPREAD,
])

/** True when the axis for this family should frame its data rather than anchor at 0. */
export function scaleForUnit(unit) {
  return SCALED_UNITS.has(unit)
}

// ── Series colour ─────────────────────────────────────────────────────────────
// Colour used to be PALETTE[seriesIndex], so index 1 was always green and every
// crossover preset drew its deterioration line — new_52w_lows, stage4_count,
// down_4pct_today — in green.
//
// Tone is assigned ONLY to metrics that exist as an opposed pair. Extending it
// to "rising VIX is bearish" would paint all three vol-complex series red and
// make them harder to tell apart, and setup-supply would draw near_52w_high and
// new_52w_highs as two greens. On crossover charts semantics win; everywhere
// else distinguishability does.

export const TONE = { BULL: 'bull', BEAR: 'bear', NEUTRAL: 'neutral' }

export const METRIC_TONE = {
  up_4pct_today:      TONE.BULL,  down_4pct_today:    TONE.BEAR,
  up_20pct_5d:        TONE.BULL,  down_20pct_5d:      TONE.BEAR,
  up_25pct_quarter:   TONE.BULL,  down_25pct_quarter: TONE.BEAR,
  up_25pct_month:     TONE.BULL,  down_25pct_month:   TONE.BEAR,
  up_50pct_month:     TONE.BULL,  down_50pct_month:   TONE.BEAR,
  magna_up:           TONE.BULL,  magna_down:         TONE.BEAR,
  new_52w_highs:      TONE.BULL,  new_52w_lows:       TONE.BEAR,
  new_20d_highs:      TONE.BULL,  new_20d_lows:       TONE.BEAR,
  hi_ratio:           TONE.BULL,  lo_ratio:           TONE.BEAR,
  stage2_count:       TONE.BULL,  stage4_count:       TONE.BEAR,
  aaii_bulls:         TONE.BULL,  aaii_bears:         TONE.BEAR,
  new_ath:            TONE.BULL,
}

export function toneOf(key) {
  return METRIC_TONE[key] ?? TONE.NEUTRAL
}

// Six neutrals because the largest single-tone group in any preset is
// `participation` with four.
export const TONE_RAMP = {
  [TONE.BULL]:    ['#34d399', '#4ade80', '#15803d'],
  [TONE.BEAR]:    ['#f87171', '#ef4444', '#b91c1c'],
  [TONE.NEUTRAL]: ['#60a5fa', '#f59e0b', '#a78bfa', '#38bdf8', '#fb923c', '#e879f9'],
}

/**
 * Colour for each selected metric: its tone's ramp, advanced per tone so two
 * bullish series never land on the same green.
 *
 * A hand-picked selection deeper than a ramp wraps and can repeat. Presets are
 * the guarded path and a test holds them collision-free.
 */
export function resolveColors(selected) {
  const used = { [TONE.BULL]: 0, [TONE.BEAR]: 0, [TONE.NEUTRAL]: 0 }
  const out = {}
  for (const key of selected ?? []) {
    const tone = toneOf(key)
    const ramp = TONE_RAMP[tone]
    out[key] = ramp[used[tone] % ramp.length]
    used[tone] += 1
  }
  return out
}

// ── Presets ───────────────────────────────────────────────────────────────────
// `metrics` order matters: on a tie for most-populated family, the family of
// the FIRST metric takes the left axis (see resolveAxes). Each preset is
// therefore ordered intended-left-first.
//
// NAAIM is deliberately absent. The collector bug that pinned it to 75.00 is
// fixed and its history is now complete and real (rebuilt 2026-08-05).
//
// It stays out of presets because its FORWARD coverage is unreliable: NAAIM
// moved the live index to a paid subscription on 2026-08-01, and the only free
// feed left runs a ~3-month delay. So the most recent weeks are routinely
// missing and backfill later. Fine to select deliberately; a poor default.

export const CHART_PRESETS = [
  {
    id: 'health',
    label: 'Market Health',
    hint: 'Composite score, UCT exposure, and mid-term participation — the daily read.',
    metrics: ['breadth_score', 'uct_exposure', 'pct_above_50sma'],
  },
  {
    id: 'breadth-vs-price',
    label: 'Breadth vs Price',
    hint: 'The index on the right axis against participation on the left — narrowing leadership shows up as divergence.',
    // ONE index series on purpose. Same unit family still means shared scale,
    // and the S&P (~7,700) against QQQ (~723) flattens QQQ into a dead line at
    // the bottom of the axis — the exact defect the family rule exists to stop.
    metrics: ['pct_above_50sma', 'pct_above_200sma', 'sp500_close'],
  },
  {
    id: 'participation',
    label: 'Participation',
    hint: 'The MA stack from fast to primary, with washout and overbought reference lines.',
    metrics: ['pct_above_10sma', 'pct_above_20ema', 'pct_above_50sma', 'pct_above_200sma'],
    extremes: ['MA Breadth'],
  },
  {
    id: 'thrust',
    label: 'Breadth Thrust',
    hint: 'Daily 4% movers against the 5- and 10-day ratios — ignition and follow-through.',
    metrics: ['up_4pct_today', 'down_4pct_today', 'ratio_5day', 'ratio_10day'],
  },
  {
    id: 'highs-lows',
    label: 'New Highs vs Lows',
    hint: '52-week highs against 52-week lows — the crossover marks regime turns.',
    metrics: ['new_52w_highs', 'new_52w_lows'],
  },
  {
    id: 'trend-regime',
    label: 'Trend Regime',
    hint: 'Stage 2 against Stage 4 counts — how much of the market is actually in an uptrend.',
    metrics: ['stage2_count', 'stage4_count'],
  },
  {
    id: 'froth',
    label: 'Froth & Extension',
    hint: 'Monthly 50% movers, volume climaxes, and ATR extension — the late-move heat tells.',
    // `up_25pct_month` (66–385) is deliberately left out. It shares the counts
    // axis with these and dominates it, pinning ATR extension (2–34) and HVC
    // (0–163) to the floor. It is one checkbox away for anyone who wants it.
    metrics: ['hvc_52w', 'up_50pct_month', 'atr_ext_7'],
  },
  {
    id: 'volatility',
    label: 'Volatility & Fear',
    hint: 'VIX on the left, CBOE put/call on the right.',
    metrics: ['vix', 'cboe_putcall'],
  },
  {
    id: 'sentiment',
    label: 'Sentiment Extremes',
    hint: 'CNN Fear/Greed and the AAII bull-bear spread — contrarian positioning.',
    metrics: ['cnn_fear_greed', 'aaii_spread'],
  },
]

const _sortedKey = keys => [...keys].sort().join('|')

/** id of the preset whose metric set equals `selected` (order-independent), else null. */
export function matchPreset(selected) {
  if (!selected?.length) return null
  const target = _sortedKey(selected)
  return CHART_PRESETS.find(p => _sortedKey(p.metrics) === target)?.id ?? null
}

// ── Axis assignment ───────────────────────────────────────────────────────────

/**
 * Decide which y-axis each selected metric plots against.
 *
 * Left axis  = the most-populated unit family.
 * Right axis = every other family.
 * Ties       = the family of the first selected metric keeps the left axis,
 *              which makes preset layout a property of preset metric order.
 *
 * @returns {{axisByKey: Record<string, 0|1>, hasRight: boolean,
 *            leftUnit: string|null, rightUnits: string[]}}
 */
export function resolveAxes(selected) {
  const axisByKey = {}
  if (!selected?.length) {
    return { axisByKey, hasRight: false, leftUnit: null, rightUnits: [] }
  }

  // Map preserves insertion order, so `counts` is ordered by first appearance.
  const counts = new Map()
  for (const key of selected) {
    const unit = unitOf(key)
    counts.set(unit, (counts.get(unit) ?? 0) + 1)
  }

  // Seed with the first metric's family and only displace it on a STRICTLY
  // larger count — that is what makes the tie-break "earliest wins".
  let leftUnit = unitOf(selected[0])
  let best = counts.get(leftUnit)
  for (const [unit, n] of counts) {
    if (n > best) {
      leftUnit = unit
      best = n
    }
  }

  for (const key of selected) {
    axisByKey[key] = unitOf(key) === leftUnit ? 0 : 1
  }

  const rightUnits = [...counts.keys()].filter(u => u !== leftUnit)
  return { axisByKey, hasRight: rightUnits.length > 0, leftUnit, rightUnits }
}

/** Axis index the given unit family resolved to, or 0 when it isn't selected. */
export function axisForUnit(selected, unit, axisByKey) {
  const key = selected?.find(k => unitOf(k) === unit)
  return key ? (axisByKey[key] ?? 0) : 0
}
