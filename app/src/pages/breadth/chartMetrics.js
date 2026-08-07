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
      { key: 'hvc_52w',       label: 'HVC (52W Vol Hi)' },
      { key: 'atr_ext_7',     label: '>7× ATR Ext (50SMA)' },
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

export const ALL_METRICS = CHART_GROUPS.flatMap(g => g.metrics)
export const LABEL_MAP = Object.fromEntries(ALL_METRICS.map(m => [m.key, m.label]))

// ── Unit families ─────────────────────────────────────────────────────────────
// Series only share a y-axis with series of the same family. Without this,
// mixing a 0–5 ratio with a 0–1000 count renders the ratio flat on the floor.

export const UNIT = {
  PCT:   'pct',    // 0–150 bounded percentages and composite scores
  COUNT: 'count',  // number of stocks
  RATIO: 'ratio',  // unitless ~0–5
  INDEX: 'index',  // index / ETF price level
  VIX:   'vix',    // volatility points
  OSC:   'osc',    // oscillator, roughly -100..+100
}

export const UNIT_LABEL = {
  [UNIT.PCT]:   '%',
  [UNIT.COUNT]: 'stocks',
  [UNIT.RATIO]: 'ratio',
  [UNIT.INDEX]: 'index',
  [UNIT.VIX]:   'VIX',
  [UNIT.OSC]:   'osc',
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

  // Highs / Lows
  new_52w_highs: UNIT.COUNT,
  new_52w_lows:  UNIT.COUNT,
  new_20d_highs: UNIT.COUNT,
  new_20d_lows:  UNIT.COUNT,
  new_ath:       UNIT.COUNT,
  hvc_52w:       UNIT.COUNT,
  atr_ext_7:     UNIT.COUNT,

  // Sentiment
  cnn_fear_greed: UNIT.PCT,
  aaii_bulls:     UNIT.PCT,
  aaii_neutral:   UNIT.PCT,
  aaii_bears:     UNIT.PCT,
  aaii_spread:    UNIT.PCT,
  naaim:          UNIT.PCT,
  cboe_putcall:   UNIT.RATIO,
}

/** Unit family for a metric key. Unmapped keys fall back to COUNT — the
 *  `every metric has a unit` test is the gate that keeps that from happening. */
export function unitOf(key) {
  return METRIC_UNITS[key] ?? UNIT.COUNT
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

  // ── Added 2026-08-07 ────────────────────────────────────────────────────────
  // 21 of the 44 pickable metrics appeared in no preset at all, so the ones a
  // user never thought to check were effectively invisible. Every combination
  // below was scale-checked against a YEAR of stored rows before being added,
  // not just against its unit family — the family rule alone is what let QQQ
  // render as a dead line, and a count that spans 5x its partner does the same
  // thing quietly. Rejected on that evidence: an atr_ext_7 + hvc_52w pairing
  // (4.8x, and already covered by `froth`).

  {
    id: 'washout',
    label: 'Short-Term Washout',
    hint: 'The three fastest MAs together — how oversold the market is right now, with the 5/10/15/20 washout lines.',
    // `participation` starts at the 10SMA, so nothing surfaced the fast washout
    // that marks a tradeable bounce. All three run 16-84 on one axis.
    metrics: ['pct_above_5sma', 'pct_above_10sma', 'pct_above_20ema'],
    extremes: ['MA Breadth'],
  },
  {
    id: 'ma-term-structure',
    label: 'Full MA Term Structure',
    hint: 'All seven moving-average bands at once — fast on top in a rally, inverted in a decline.',
    metrics: ['pct_above_5sma', 'pct_above_10sma', 'pct_above_20ema', 'pct_above_40sma',
              'pct_above_50sma', 'pct_above_100sma', 'pct_above_200sma'],
    extremes: ['MA Breadth'],
  },
  {
    id: 'long-trend',
    label: 'Long-Term Trend',
    hint: 'The 100- and 200-day bands — the slow read that ignores day-to-day noise.',
    metrics: ['pct_above_100sma', 'pct_above_200sma'],
    extremes: ['MA Breadth'],
  },
  {
    id: 'highs-quality',
    label: '52-Week vs All-Time Highs',
    hint: 'How many 52-week highs are ALSO all-time highs — a widening gap means the highs are recoveries, not leadership.',
    metrics: ['new_52w_highs', 'new_ath'],
  },
  {
    id: 'highs-lows-20d',
    label: '20-Day Highs vs Lows',
    hint: 'The one-month crossover — the fast counterpart to the 52-week version, and it turns first.',
    metrics: ['new_20d_highs', 'new_20d_lows'],
  },
  {
    id: 'leadership',
    label: 'Leadership Quality',
    hint: 'All-time highs against quarterly 25% movers — whether the leaders are breaking out or just bouncing.',
    metrics: ['new_ath', 'up_25pct_quarter'],
  },
  {
    id: 'stage-vs-highs',
    label: 'Uptrends vs New Highs',
    hint: 'Stage 2 names against 52-week highs — a large Stage 2 base with few highs is a market going sideways in an uptrend.',
    metrics: ['stage2_count', 'new_52w_highs'],
  },
  {
    id: 'mcclellan',
    label: 'McClellan Oscillator',
    hint: 'The classic advance/decline oscillator against the composite score — zero is the dividing line.',
    metrics: ['mcclellan_osc', 'breadth_score'],
  },
  {
    id: 'ratios',
    label: 'Advance/Decline Ratios',
    hint: 'The 5- and 10-day up/down ratios on their own scale — thrust readings without the counts drowning them.',
    metrics: ['ratio_5day', 'ratio_10day'],
  },
  {
    id: 'weekly-thrust',
    label: '5-Day Thrust',
    hint: 'Names up or down 20% in a week — the fastest genuine momentum signal in the set.',
    metrics: ['up_20pct_5d', 'down_20pct_5d'],
  },
  {
    id: 'monthly-movers',
    label: 'Monthly Movers',
    hint: 'Names up or down 25% in a month — the swing-timeframe momentum balance.',
    metrics: ['up_25pct_month', 'down_25pct_month'],
  },
  {
    id: 'quarterly-movers',
    label: 'Quarterly Movers',
    hint: 'Names up or down 25% over a quarter — who is actually leading and lagging over a real holding period.',
    metrics: ['up_25pct_quarter', 'down_25pct_quarter'],
  },
  {
    id: 'magna',
    label: 'Momentum Breadth (13% / 34d)',
    hint: 'The Stockbee-style 13%-in-34-days pair — a sustained-momentum read rather than a single-day pop.',
    metrics: ['magna_up', 'magna_down'],
  },
  {
    id: 'capitulation',
    label: 'Capitulation',
    hint: 'Single-day 4% decliners against fresh 20-day lows — the two together mark washout days.',
    metrics: ['down_4pct_today', 'new_20d_lows'],
  },
  {
    id: 'aaii-composition',
    label: 'AAII Composition',
    hint: 'Bulls, bears and neutral separately — the spread alone hides whether bulls left or bears arrived.',
    // The three sum to 100, so they share one axis by construction.
    metrics: ['aaii_bulls', 'aaii_neutral', 'aaii_bears'],
  },
  {
    id: 'fear',
    label: 'Fear Gauges',
    hint: 'CNN Fear/Greed against VIX — sentiment and priced volatility, which do not always agree.',
    metrics: ['cnn_fear_greed', 'vix'],
  },
  {
    id: 'score-vs-vix',
    label: 'Score vs Volatility',
    hint: 'The composite score against VIX — breadth holding up through a volatility spike is the divergence worth seeing.',
    metrics: ['breadth_score', 'vix'],
  },
  {
    id: 'exposure-vs-score',
    label: 'Exposure vs Score',
    hint: 'UCT exposure against the composite score — how the recommendation tracks the underlying breadth.',
    metrics: ['breadth_score', 'uct_exposure'],
  },
  {
    id: 'breadth-vs-nasdaq',
    label: 'Breadth vs Nasdaq',
    hint: 'Participation against QQQ on the right axis — the Nasdaq counterpart to Breadth vs Price.',
    // ONE index series, for the reason documented on `breadth-vs-price`.
    metrics: ['pct_above_50sma', 'pct_above_200sma', 'qqq_close'],
  },
  {
    id: 'coverage',
    label: 'Universe Coverage',
    hint: 'How many names the collector measured each day — a step here explains a step in every count above.',
    // Not an analytical view: it is the denominator behind every COUNT metric,
    // and a coverage change reads as a breadth change if you cannot see it.
    metrics: ['universe_count'],
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
