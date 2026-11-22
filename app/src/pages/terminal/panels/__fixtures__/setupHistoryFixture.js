// SETH sample answers in the routes' real shape (api/services/setup_history.py). Every number, date and
// symbol here is INVENTED (dates in 2031; symbols QZ*); none is a real result, price or stock.

const SURVIVORSHIP = "This tests today's names against yesterday's prices. The universe is CURRENT membership — we hold no historical constituent lists, so names that were in this universe back then and have since delisted, been acquired or fallen out are absent, and every name here survived to today. That is survivorship bias and it flatters the result by an amount this backtest cannot measure."
export const HINDSIGHT = 'The market phase is assigned with hindsight: a decline is known to be a correction, and its low the low, only after the fact. Each signal uses only the bars up to its own day; the phase label does not. Read a phase row as how the setup did in what turned out to be a correction, never as something a trader could have known on the day.'
const PER_RUN = 'One signal per run: a setup true on several sessions in a row counts once, on the first session of the run. A run whose start the history cannot see (the session before is warm-up or a gap) is not counted.'

const WORDS = {
  correction: 'In a correction (peak to low)', after_low: 'First 3 months after a low', uptrend: 'Later in an uptrend', all: 'All days',
}

/** One horizon of one group: invented numbers scaled by a seed; `n` under 30 is withheld the server's way. */
function horizon(n, seed, { reason = null } = {}) {
  const below = n < 30
  const s = (k) => Math.round((Math.sin(seed * 7.3 + k) * 4 + k * 0.4) * 100) / 100
  return {
    n,
    below_floor: below,
    strategy: below
      ? { n, win_rate: null, avg_pct: null, median_pct: null, best: null, worst: null, avg_pct_winsorised: null }
      : { n, win_rate: 50 + s(1) * 2, avg_pct: s(2), median_pct: s(3) / 2, best: 80 + s(4) * 10, worst: -30 - Math.abs(s(5)) * 3, avg_pct_winsorised: s(2) * 0.9 },
    baseline: below ? { n: n * 40, win_rate: null, avg_pct: null, avg_pct_winsorised: null } : { n: n * 40, win_rate: 52.1, avg_pct: 0.9, avg_pct_winsorised: 0.85 },
    same_day: below
      ? { n_matched: 0, n_unmatched: n, n_unmatched_unmeasurable: 0, n_cells: 0, excess_pct_winsorised: null, excess_null_reason: 'below_floor' }
      : reason
        ? { n_matched: 0, n_unmatched: n, n_unmatched_unmeasurable: 0, n_cells: 0, excess_pct_winsorised: null, excess_null_reason: reason }
        : { n_matched: Math.round(n * 0.9), n_unmatched: n - Math.round(n * 0.9), n_unmatched_unmeasurable: 1, n_cells: Math.round(n * 0.7), excess_pct_winsorised: s(6) / 3, excess_null_reason: null },
  }
}

function group(phase, signals, seed, opts) {
  return {
    phase, words: WORDS[phase], signals,
    horizons: { 5: horizon(signals, seed, opts), 20: horizon(Math.max(signals - 3, 0), seed + 1, opts), 60: horizon(Math.max(signals - 9, 0), seed + 2, opts) },
  }
}

const SETUPS = [
  ['breakout', 'Breakout to a new 52-week high', 'Closes above every close of the 252 sessions before it, on volume at least 1.5 times its 50-day average volume (the 50 sessions before).', [612, 1840, 4105]],
  ['pullback_21ema', 'Pullback to the 21-day EMA in an uptrend', 'Closes above its 50-day average with the 50-day above the 200-day, and the day\'s low within 1% of the 21-day exponential average.', [388, 2210, 9030]],
  ['gap_up', 'Gap up of 4% or more on volume', 'Opens at least 4% above the previous close, on volume at least 2 times its 50-day average volume (the 50 sessions before).', [920, 1405, 3311]],
  ['reclaim_50', 'Reclaim of the 50-day average', 'Closes above its 50-day average after 20 or more closes in a row below it.', [21, 960, 1720]],
]

export function setupHistoryAnswer({ setups = SETUPS, capped = false, refreshing = false } = {}) {
  return {
    status: 'ok',
    built_for: '2031-06-07',
    built_at: '2031-06-07T14:05:12+00:00',
    session: '2031-06-06',
    data_through: '2031-06-06',
    library: 'a1b2c3d4e5f60718',
    window: { from: '2028-06-06', to: '2031-06-06', first_day: '2028-06-07', years: 3 },
    source: "UCT's stored daily prices (split-adjusted, price only)",
    universe: {
      membership: 'current', symbols_requested: 3412, survivorship_bias: true, caveat: SURVIVORSHIP,
      name: "UCT's stock universe ($300M market value and up), less the funds it lists",
      symbols_read: 3390, symbols_not_held: 22, symbols_failed: 0, symbols_scanned: 3388,
    },
    method: {
      fill: 'next_bar_open', min_signals: 30, horizons: [5, 20, 60], winsorised: true, winsor_pct: 50,
      observations: 'One observation per run. Runs close together still overlap their forward windows, so nearby observations are correlated and the count overstates independent evidence.',
      one_signal_per_run: PER_RUN, phase: HINDSIGHT,
      window: 'The newest 8 years of each stock\'s stored daily bars (signals from 2028-06-06); older bars are read only as warm-up. Cut from the whole history to keep the weekly build to about 40 minutes of one processor.',
    },
    phases: {
      index: 'S&P 500', first: '2001-01-02', last: '2031-06-06', episodes: 9, built_at: '2031-06-06T00:20:00+00:00',
      definition: 'A decline counts from a closing high to the lowest close before that high is regained.', hindsight: HINDSIGHT,
      words: WORDS, after_low_months: 3,
    },
    horizons: [5, 20, 60],
    min_signals: 30,
    setups: setups.map(([id, name, words, [a, b, c]], i) => (capped && i === 0
      ? { id, name, words, state: 'capped', groups: [], detail: 'This setup fired more than 600,000 times, more than the build holds, so its numbers are withheld rather than cut.' }
      : {
        id, name, words, state: 'ok', signals: a + b + c + 40,
        groups: [group('correction', a, i * 4 + 1), group('after_low', b, i * 4 + 2, i === 2 ? { reason: 'no_unoccupied_cell' } : undefined),
          group('uptrend', c, i * 4 + 3), group('all', a + b + c + 40, i * 4 + 4)],
      })),
    dropped: [
      { name: 'Inside week and three weeks tight on calendar weeks', why: 'The evaluator\'s weekly read answers them without looking ahead, but it cost too long per stock for a build over the whole universe.' },
      { name: 'Base patterns (cup with handle, flat base, VCP)', why: 'The pattern engine keeps today\'s detections only, with no history.' },
    ],
    build: { seconds: 812.4, cpu_seconds: 790.1, signals_stored: 140221 },
    refreshing,
    check: null,
  }
}

const LIB = SETUPS.map(([id, name, words]) => ({ id, name, words }))

function line(n, seed) {
  const h = horizon(n, seed)
  const hz = (x) => ({ n: x.n, below_floor: x.below_floor, win_rate: x.strategy.win_rate, avg_pct: x.strategy.avg_pct,
    median_pct: x.strategy.median_pct, excess_pct: x.same_day.excess_pct_winsorised })
  return { signals: n, horizons: { 5: hz(h), 20: hz(horizon(n, seed + 1)), 60: hz(horizon(n, seed + 2)) } }
}

export function setupStockAnswer({ sym = 'QZSA', universe = 'ok', cut = false } = {}) {
  const signals = [
    { date: '2031-06-02', setup: 'breakout', phase: 'uptrend', returns: { 5: 2.31, 20: null, 60: null } },
    { date: '2031-04-14', setup: 'pullback_21ema', phase: 'after_low', returns: { 5: -1.2, 20: 6.48, 60: null } },
    { date: '2030-11-03', setup: 'gap_up', phase: 'correction', returns: { 5: -4.05, 20: -9.9, 60: 12.07 } },
    { date: '2029-08-21', setup: 'reclaim_50', phase: null, returns: { 5: 0.0, 20: 3.3, 60: 14.2 } },
  ]
  return {
    status: 'ok', symbol: sym, session: '2031-06-06', first: '2014-03-03', data_through: '2031-06-06', sessions: 4342,
    built_at: '2031-06-06T21:30:00+00:00', source: "UCT's stored daily prices (split-adjusted, price only)", horizons: [5, 20, 60],
    phases: { state: 'ok', index: 'S&P 500', first: '2001-01-02', last: '2031-06-06', episodes: 9, hindsight: HINDSIGHT },
    total: cut ? 412 : signals.length, shown: signals.length, cut: cut ? 'oldest' : null,
    signals,
    setups: LIB.map((s) => ({ id: s.id, state: 'ok', signals: 1 })),
    library: LIB,
    one_signal_per_run: PER_RUN,
    fill: 'Each return is from the next session\'s open to the open 5, 20 or 60 sessions after that.',
    universe: universe === 'ok'
      ? {
        state: 'ok', window: { from: '2028-06-06', to: '2031-06-06', first_day: '2028-06-07', years: 3 }, built_at: '2031-06-07T14:05:12+00:00',
        min_signals: 30, note: SURVIVORSHIP,
        lines: { 'breakout|uptrend': line(4105, 3), 'pullback_21ema|after_low': line(2210, 6), 'gap_up|correction': line(920, 9), 'reclaim_50|all': line(12, 12) },
      }
      : { state: universe, detail: null },
  }
}
