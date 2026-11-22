// EVST: INVENTED answers in the real shapes of GET /api/research/event-study/series and
// GET /api/research/event-study (api/services/event_study_member.py). No number here is a real
// series value, price or return; ZZQA is not a real ticker.

const METHOD = {
  entry: 'event_close', episodes: 'first', non_overlapping: false,
  return: 'price return (split-adjusted, not dividend-adjusted)',
  sessions: 'NYSE trading sessions after entry (shared calendar)',
  months: 'first trading session on or after entry date + N calendar months',
  excluded: 'incomplete windows and exits without a stored close are excluded and counted',
  lines: [
    'Episodes: the first session of each run of sessions on which the condition held; a session with no known value ends a run.',
    'Entry: the close of the event session (the condition is known at that close).',
    'Return: price return (split-adjusted, not dividend-adjusted).',
    'Windows in months: first trading session on or after entry date + N calendar months.',
    'Left out: incomplete windows and exits without a stored close are excluded and counted.',
    'All sessions: the same windows from every trading session in the same span, for comparison.',
  ],
}

export function menuAnswer() {
  return {
    status: 'ok',
    categories: [
      {
        kind: 'breadth', name: 'Market breadth', alignment: 'session',
        universes: [{ universe: 'us', name: 'US' }, { universe: 'nyse', name: 'NYSE' }, { universe: 'nasdaq', name: 'NASDAQ' }],
        metrics: [
          { metric: 'pct_above_50sma', name: '% of Stocks Above 50-Day MA', unit: 'percent', domain: 'pct_0_100' },
          { metric: 'pct_above_200sma', name: '% of Stocks Above 200-Day MA', unit: 'percent', domain: 'pct_0_100' },
          { metric: 'new_52w_highs', name: 'New 52-Week Highs', unit: 'count', domain: 'nonneg' },
          { metric: 'net_new_high_low', name: 'Net New 52-Week Highs-Lows', unit: 'count', domain: 'signed' },
        ],
      },
      {
        kind: 'technical', name: 'Technical indicators', alignment: 'session',
        indicators: [
          { indicator: 'rsi', name: 'RSI', unit: 'index', domain: 'pct_0_100', period: { min: 2, max: 200, default: 14 } },
          { indicator: 'pct_from_sma', name: '% from its N-day SMA', unit: 'percent_change', domain: 'signed', period: { min: 2, max: 400, default: 50 } },
          { indicator: 'macd_hist', name: 'MACD histogram (12, 26, 9)', unit: 'price_units', domain: 'any', period: null },
          { indicator: 'day_pct', name: 'One-day change, close vs the previous close (%)', unit: 'percent_change', domain: 'signed', period: null },
        ],
      },
      {
        kind: 'cot', name: 'Futures positioning (COT)', alignment: 'as_of', unit: 'count', domain: 'signed',
        markets: [{ market: 'GC', name: 'Gold' }, { market: 'ES', name: 'S&P 500 E-Mini' }],
        groups: [{ group: 'commercial', name: 'Commercials' }, { group: 'large_spec', name: 'Large Speculators' }, { group: 'small_spec', name: 'Small Speculators' }],
      },
    ],
    not_offered: [
      { kind: 'econ', name: 'Economic releases', why: 'This server keeps its economic history in cloud storage, and the study engine reads only history stored on the server itself.' },
      { kind: 'fundamental', name: 'Company fundamentals', why: 'None of the fundamentals metrics is cleared for use as a study condition yet.' },
      { kind: 'market_cap', name: 'Market cap', why: 'Market cap history is not published on this server yet.' },
    ],
    ops: [{ op: 'below', name: 'below' }, { op: 'above', name: 'above' }, { op: 'cross_below', name: 'crosses below' }, { op: 'cross_above', name: 'crosses above' }],
    horizons: ['1d', '1w', '2w', '1mo', '3mo', '6mo', '12mo', '24mo'].map((token) => ({ token, name: token })),
    max_horizons: 4,
    defaults: { symbol: 'SPY', horizons: ['1mo', '3mo', '6mo'], episodes: 'first', entry: 'event_close' },
    examples: [
      { id: 'nasdaq-washout', name: 'Fewer than 10% of Nasdaq stocks above their 50-day average: QQQ over 1, 3 and 6 months',
        spec: { kind: 'breadth', universe: 'nasdaq', metric: 'pct_above_50sma', op: 'below', threshold: '10', symbol: 'QQQ', horizons: '1mo,3mo,6mo', episodes: 'first', entry: 'event_close' } },
      { id: 'spy-3pct-drop', name: 'SPY falls 3% or more in a day: SPY over 1 week, 1 month and 3 months',
        spec: { kind: 'technical', series: 'SPY', indicator: 'day_pct', op: 'below', threshold: '-3', symbol: 'SPY', horizons: '1w,1mo,3mo', episodes: 'first', entry: 'event_close' } },
      { id: 'gold-specs-short', name: 'Large speculators turn net short gold futures: GLD over 1, 3 and 6 months',
        spec: { kind: 'cot', market: 'GC', group: 'large_spec', op: 'cross_below', threshold: '0', symbol: 'GLD', horizons: '1mo,3mo,6mo', episodes: 'first', entry: 'event_close' } },
    ],
  }
}

const SPEC = { kind: 'breadth', universe: 'nasdaq', metric: 'pct_above_50sma', op: 'below', threshold: 10, symbol: 'ZZQA',
  horizons: ['1mo', '3mo'], episodes: 'first', entry: 'event_close' }
const SERIES = { label: 'NASDAQ · % of Stocks Above 50-Day MA', category: 'market breadth', unit: 'percent', domain: 'pct_0_100',
  alignment: 'session', description: null, kind: 'breadth' }
const COVERAGE = { series_first: '2011-01-03', series_last: '2024-09-30', series_known_through: '2024-09-30', price_first: '2011-01-03',
  price_last: '2024-09-30', study_start: '2011-01-03', study_end: '2024-09-30', price_basis: 'daily close, split-adjusted, not dividend-adjusted (price return)' }

/** Three invented episodes; the newest one's 3-month window has not ended, one exit has no stored close. */
export function studyAnswer(over = {}) {
  return {
    status: 'ok', spec: { ...SPEC }, session: '2024-09-30', built_at: '2024-09-30T21:00:00+00:00',
    series: { ...SERIES }, coverage: { ...COVERAGE },
    counts: { events_used: 3, events_detected: 3, qualifying_sessions: 9, episodes_or_crossings: 3, condition_gaps: 0,
      no_entry_price: 0, entry_after_price_history: 0, overlapping_events: 0, windows_spanning_suspect_jumps: 0 },
    horizons: [
      { token: '1mo', label: '1 calendar month', n: 3, incomplete: 0, missing_price: 0, positive: 2, positive_rate: 2 / 3,
        mean: 0.015, median: 0.02,
        best: { event_date: '2024-08-05', exit_date: '2024-09-05', return: 0.065 },
        worst: { event_date: '2018-02-08', exit_date: '2018-03-08', return: -0.04 } },
      { token: '3mo', label: '3 calendar months', n: 1, incomplete: 1, missing_price: 1, positive: 1, positive_rate: 1,
        mean: 0.08, median: 0.08,
        best: { event_date: '2018-02-08', exit_date: '2018-05-08', return: 0.08 },
        worst: { event_date: '2018-02-08', exit_date: '2018-05-08', return: 0.08 } },
    ],
    baseline: [
      { token: '1mo', label: '1 calendar month', n: 5000, positive_rate: 0.58, mean: 0.008, median: 0.01 },
      { token: '3mo', label: '3 calendar months', n: 4950, positive_rate: 0.62, mean: 0.021, median: 0.025 },
    ],
    events: [
      { event_date: '2024-08-05', entry_date: '2024-08-05', condition_value: 8.4,
        returns: [{ token: '1mo', outcome: 'ok', exit_date: '2024-09-05', return: 0.065 }, { token: '3mo', outcome: 'incomplete', exit_date: '2024-11-05', return: null }] },
      { event_date: '2020-03-16', entry_date: '2020-03-16', condition_value: 3.1,
        returns: [{ token: '1mo', outcome: 'ok', exit_date: '2020-04-16', return: 0.02 }, { token: '3mo', outcome: 'missing', exit_date: '2020-06-16', return: null }] },
      { event_date: '2018-02-08', entry_date: '2018-02-08', condition_value: 9.7,
        returns: [{ token: '1mo', outcome: 'ok', exit_date: '2018-03-08', return: -0.04 }, { token: '3mo', outcome: 'ok', exit_date: '2018-05-08', return: 0.08 }] },
    ],
    events_truncated: false,
    notes: ['Small sample: fewer than 10 completed outcomes for at least one window.'],
    caveats: ['Small sample: fewer than 10 completed outcomes in at least one window.'],
    method: { ...METHOD },
    source: "UCT's stored daily closes (split-adjusted, price only) and the condition series named",
    ...over,
  }
}

/** Two episodes too recent for a 24-month window. */
export function tooShortAnswer() {
  const base = studyAnswer()
  return {
    ...base,
    spec: { ...SPEC, horizons: ['1w', '24mo'] },
    counts: { ...base.counts, events_used: 2, events_detected: 2, qualifying_sessions: 2, episodes_or_crossings: 2 },
    horizons: [
      { token: '1w', label: '5 trading sessions', n: 2, incomplete: 0, missing_price: 0, positive: 1, positive_rate: 0.5, mean: 0.004, median: 0.004,
        best: { event_date: '2024-08-05', exit_date: '2024-08-12', return: 0.03 }, worst: { event_date: '2024-04-15', exit_date: '2024-04-22', return: -0.022 } },
      { token: '24mo', label: '24 calendar months', n: 0, incomplete: 2, missing_price: 0 },
    ],
    baseline: [{ token: '1w', label: '5 trading sessions', n: 5100, positive_rate: 0.56, mean: 0.002, median: 0.003 },
      { token: '24mo', label: '24 calendar months', n: 4600, positive_rate: 0.7, mean: 0.15, median: 0.16 }],
    events: [
      { event_date: '2024-08-05', entry_date: '2024-08-05', condition_value: 8.4,
        returns: [{ token: '1w', outcome: 'ok', exit_date: '2024-08-12', return: 0.03 }, { token: '24mo', outcome: 'incomplete', exit_date: '2026-08-05', return: null }] },
      { event_date: '2024-04-15', entry_date: '2024-04-15', condition_value: 9.9,
        returns: [{ token: '1w', outcome: 'ok', exit_date: '2024-04-22', return: -0.022 }, { token: '24mo', outcome: 'incomplete', exit_date: '2026-04-15', return: null }] },
    ],
  }
}

/** The condition never held. */
export function noEpisodesAnswer({ op = 'below' } = {}) {
  const base = studyAnswer()
  return {
    ...base,
    spec: { ...SPEC, op, threshold: 1, horizons: ['1mo'] },
    counts: { ...base.counts, events_used: 0, events_detected: 0, qualifying_sessions: 0, episodes_or_crossings: 0 },
    horizons: [{ token: '1mo', label: '1 calendar month', n: 0, incomplete: 0, missing_price: 0 }],
    baseline: [{ token: '1mo', label: '1 calendar month', n: 5000, positive_rate: 0.58, mean: 0.008, median: 0.01 }],
    events: [], notes: [], caveats: [],
  }
}
