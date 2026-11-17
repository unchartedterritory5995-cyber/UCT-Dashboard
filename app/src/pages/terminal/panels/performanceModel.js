// PERF: the member's own trading stats from the Journal, the pure half (no React and no imports,
// so an agent capability can reuse it and args.js can take `parsePerformanceAccount`).
//
// ⭐ NO NEW ROUTE. Four reads the Journal already makes (api/routers/journal_two.py). Every one is
// `Depends(get_current_user)` and filters on that session's own user id: 401 signed out, and no
// way to name another member. They carry no paid gate of their own.
//
//   GET /api/j2/accounts            { accounts: [{ id, name, broker, balanceSource,
//                                     brokerTotalEquity, startingBalance, ... }] }, oldest first.
//                                   The first call creates the member's Default account, so an
//                                   empty list is not expected (the panel still words it).
//   GET /api/j2/metrics/registry    [{ key, title, description, category }, ..., { key: 'custom',
//                                     vocabulary: [...] }]: the metric cards and the names a
//                                   custom number may use.
//   GET /api/j2/metrics?keys=&kpi=name:expr&account_id=
//                                   { metrics: { key: card }, custom: [{ name, expr, value, error }],
//                                     unknownKeys, tradeCount, rSources }
//                                   (api/services/journal_two/metrics_registry.py)
//   GET /api/j2/analytics?account_id=
//                                   one large payload (api/services/journal_two/analytics.py). This
//                                   panel reads tradeCount, strategyCount, rSources, edgeScore,
//                                   risk, attribution.bySetup and equity.curve, nothing else.
//
// WHAT THE NUMBERS ARE (read from the services, not assumed)
//   * Only CLOSED stock trades the Journal counts in its stats (a trade it has flagged as left out
//     is skipped by every aggregate). Option strategies are counted apart (`strategyCount`).
//   * The `payoff_kelly` card: `winRate` = wins / (wins + losses), a FRACTION; `avgWin` and
//     `avgLoss` are DOLLARS after fees (avgLoss positive); `decisive` = wins + losses. The card
//     withholds only Kelly below its 20-trade minimum: win rate and the averages are served from
//     the first decisive trade. So this panel prints the sample beside each and marks one under
//     the Journal's own confidence line (10) as a small sample.
//   * NO ROUTE GIVES AVERAGE WIN OR LOSS IN R. They are shown in dollars, which is what is served.
//   * Custom numbers (`kpi=name:name`): `wins`, `losses`, `profit_factor` (winning dollars over
//     losing dollars, after fees; null with no losing dollars), `expectancy` (net P&L per closed
//     trade, dollars). A null variable is `value: null, error: null`; an unknown one has `error`.
//   * `risk.expectancyR`: the average R per trade over the trades with a known R. Withheld (null,
//     `coverageReady: false`, counts kept) under 10 winning or losing trades.
//   * `edgeScore.score` = win rate x profit factor (before fees, capped at 5) x R consistency.
//     Null under 10 trades or with fewer than 2 known R values; `components` is null with no
//     winning or losing trade at all.
//   * `rSources` { stop, trueR, none }: where each trade's R came from. A trade with a logged stop
//     uses it; a broker import has no stop, so it uses True R (the result against the trade's own
//     worst drawdown) when the Journal has worked one out; otherwise the trade has NO R and is
//     left out of every R number.
//   * `attribution.bySetup` rows: { setup, totalPnl (BEFORE fees), winRate (fraction, null with no
//     win or loss), avgR (null with no known R), tradeCount, lowConfidence (under 10 trades) }.
//     Trades with no setup tag are not in it. Expectancy per setup is totalPnl / tradeCount, the
//     same division the Journal's own first report makes.
//   * `equity.curve`: [{ date, equity, drawdown }], one point per Eastern trading day that closed
//     a trade, running from the account's starting balance, after fees. For ONE broker-linked
//     account with a synced balance the start is shifted so the last point equals the broker's
//     account value; for all accounts together it starts from the sum of the starting balances.
//
// THE ACCOUNT. The Journal keeps its pick in localStorage (`uct.j2.selectedAccountId`: an account
// id, or `_all_` for all accounts) and falls back to the first account. This panel starts from the
// same pick and never writes it: switching here does not move the Journal.
//
// ⛔ A FAILED READ IS NEVER "NO TRADES", and a number the server withholds is never drawn as 0.

/** The terminal code this panel is registered under (the panel reads the live one from its frame). */
export const PERFORMANCE_CODE = 'PERF'

export const ACCOUNTS_URL = '/api/j2/accounts'
export const METRICS_REGISTRY_URL = '/api/j2/metrics/registry'
export const METRICS_URL = '/api/j2/metrics'
export const ANALYTICS_URL = '/api/j2/analytics'

/** Where the Journal keeps its account pick, and its word for "all accounts" (hooks/useJ2SelectedAccount.js). */
export const JOURNAL_ACCOUNT_KEY = 'uct.j2.selectedAccountId'
export const ALL_ACCOUNTS = '_all_'

/** The Journal's confidence line: a stat behind fewer trades is a small sample (ConfidenceStat,
 *  analytics.py `_ATTRIBUTION_MIN_SAMPLE` and `_RISK_MIN_DECISIVE`, the edge score's own floor). */
export const CONFIDENCE_MIN = 10

/** The one metric card and the custom numbers the headline row asks for. */
export const HEADLINE_CARD = 'payoff_kelly'
export const HEADLINE_NUMBERS = Object.freeze(['wins', 'losses', 'profit_factor', 'expectancy'])

const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v)
const num = (v) => (v === null || v === undefined || v === '' || typeof v === 'boolean' || !Number.isFinite(Number(v)) ? null : Number(v))
const text = (v) => (v === null || v === undefined ? '' : String(v).trim())
const whole = (v) => { const n = num(v); return n === null ? null : Math.round(n) }

/** Pure: a typed word as an account choice: `ALL` -> 'all', `2` -> 2 (the second account in the
 *  Journal's own order), anything else null. For an args.js kind. */
export function parsePerformanceAccount(token) {
  if (token === 'all') return 'all'
  const t = String(token ?? '').trim().toUpperCase()
  if (t === 'ALL') return 'all'
  return /^\d{1,2}$/.test(t) && Number(t) >= 1 ? Number(t) : null
}

/** Pure: the arguments an account choice writes into the panel's command (`PERF 2`, `PERF ALL`;
 *  the Journal's own pick is the bare command). An account is named by its place in the list,
 *  never by its id, so a command, a link and the history carry nothing personal. */
export function performanceCommandArgs({ account = null } = {}) {
  const a = parsePerformanceAccount(account)
  return a === 'all' ? ['ALL'] : a ? [String(a)] : []
}

/**
 * Pure: the accounts answer.
 *   state     'ok' | 'failed' (not an accounts answer)
 *   accounts  { id, name, broker, brokerLinked, anchored }: `anchored` is true when the equity
 *             curve of that one account is set to end at the broker's account value.
 */
export function accountsRead(body) {
  if (!isObj(body) || !Array.isArray(body.accounts)) return { state: 'failed', accounts: [] }
  const accounts = []
  for (const a of body.accounts) {
    const id = text(a?.id)
    if (!id) continue
    const brokerLinked = a.balanceSource === 'broker'
    accounts.push({
      id,
      name: text(a.name) || `Account ${accounts.length + 1}`,
      broker: text(a.broker) || null,
      brokerLinked,
      anchored: brokerLinked && num(a.brokerTotalEquity) !== null,
    })
  }
  return { state: 'ok', accounts }
}

/**
 * Pure: which account to show.
 *   choice  what the member typed or picked here ('all', a place in the list, or null)
 *   stored  the Journal's own pick (an account id, `_all_`, or null)
 * Returns `{ mode: 'all' | 'one' | null, account, ordinal, missing }`: `missing` is a typed place
 * the list does not have (the panel says so and shows the Journal's pick instead); `mode` is null
 * only when there is no account at all.
 */
export function pickAccount(accounts, { choice = null, stored = null } = {}) {
  const list = Array.isArray(accounts) ? accounts : []
  if (!list.length) return { mode: null, account: null, ordinal: null, missing: null }
  const all = (missing = null) => ({ mode: 'all', account: null, ordinal: null, missing })
  const one = (i, missing = null) => ({ mode: 'one', account: list[i], ordinal: i + 1, missing })
  const want = parsePerformanceAccount(choice)
  if (want === 'all') return all()
  if (want && list[want - 1]) return one(want - 1)
  const missing = want || null
  if (stored === ALL_ACCOUNTS) return all(missing)
  const found = list.findIndex((a) => a.id === stored)
  return one(found >= 0 ? found : 0, missing)
}

/** Pure: the registry answer as `{ state, cards: [{ key, title, description, category }], vocabulary }`. */
export function registryRead(body) {
  if (!Array.isArray(body)) return { state: 'failed', cards: [], vocabulary: [] }
  const entries = body.filter(isObj).map((c) => ({ ...c, key: text(c.key) })).filter((c) => c.key)
  const custom = entries.find((c) => c.key === 'custom')
  return {
    state: 'ok',
    cards: entries.filter((c) => c.key !== 'custom')
      .map((c) => ({ key: c.key, title: text(c.title) || c.key, description: text(c.description) || null, category: text(c.category) || null })),
    vocabulary: (Array.isArray(custom?.vocabulary) ? custom.vocabulary : []).map(text).filter(Boolean),
  }
}

/** Pure: what the headline row asks the metrics route for. With a registry answer, only the card
 *  and the numbers that registry offers; without one (still unread, or failed), the full set,
 *  which the route answers per key (an unknown one is reported, never dropped). */
export function metricsRequest(registry = null) {
  if (registry?.state !== 'ok') return { keys: [HEADLINE_CARD], numbers: [...HEADLINE_NUMBERS] }
  return {
    keys: registry.cards.some((c) => c.key === HEADLINE_CARD) ? [HEADLINE_CARD] : [],
    numbers: HEADLINE_NUMBERS.filter((n) => registry.vocabulary.includes(n)),
  }
}

/** Pure: the metrics URL for one account (`accountId` null is all accounts together). */
export function metricsUrl({ accountId = null, registry = null } = {}) {
  const { keys, numbers } = metricsRequest(registry)
  const p = new URLSearchParams()
  p.set('keys', keys.join(','))
  for (const n of numbers) p.append('kpi', `${n}:${n}`)
  if (accountId) p.set('account_id', String(accountId))
  return `${METRICS_URL}?${p.toString()}`
}

/** Pure: the analytics URL for one account (`accountId` null is all accounts together). */
export function analyticsUrl({ accountId = null } = {}) {
  return accountId ? `${ANALYTICS_URL}?account_id=${encodeURIComponent(String(accountId))}` : ANALYTICS_URL
}

const rSourcesOf = (raw) => (isObj(raw) ? { stop: whole(raw.stop) || 0, trueR: whole(raw.trueR) || 0, none: whole(raw.none) || 0 } : null)

/**
 * Pure: the metrics answer.
 *   state    'ok' | 'failed'
 *   trades   closed trades in the stats
 *   card     the `payoff_kelly` card as { decisive, winRate (fraction), avgWin, avgLoss } or null
 *            when the route did not serve it
 *   numbers  { name: { value, error } } for each custom number sent back
 */
export function metricsRead(body) {
  const none = { state: 'failed', trades: null, card: null, numbers: {}, unknownKeys: [], rSources: null }
  if (!isObj(body) || !isObj(body.metrics) || num(body.tradeCount) === null) return none
  const c = body.metrics[HEADLINE_CARD]
  const numbers = {}
  for (const k of (Array.isArray(body.custom) ? body.custom : [])) {
    const name = text(k?.name)
    if (name) numbers[name] = { value: num(k.value), error: text(k.error) || null }
  }
  return {
    state: 'ok',
    trades: whole(body.tradeCount),
    card: isObj(c) ? { decisive: whole(c.decisive) || 0, winRate: num(c.winRate), avgWin: num(c.avgWin), avgLoss: num(c.avgLoss) } : null,
    numbers,
    unknownKeys: (Array.isArray(body.unknownKeys) ? body.unknownKeys : []).map(text).filter(Boolean),
    rSources: rSourcesOf(body.rSources),
  }
}

/**
 * Pure: the by-setup rows, best expectancy first (a setup with no trades sinks last; ties go to
 * the larger sample, then the name).
 *   { key, setup, trades, lowConfidence, winRatePct (percent, or null with no win or loss),
 *     avgR (or null with no known R), totalPnl, expectancy (dollars per trade, before fees) }
 */
export function setupRows(body) {
  const list = isObj(body) && isObj(body.attribution) && Array.isArray(body.attribution.bySetup) ? body.attribution.bySetup : []
  const rows = []
  const seen = new Set()
  for (const s of list) {
    const setup = text(s?.setup)
    if (!setup || seen.has(setup)) continue
    seen.add(setup)
    const trades = whole(s.tradeCount) || 0
    const totalPnl = num(s.totalPnl)
    const winRate = num(s.winRate)
    rows.push({
      key: `setup-${rows.length}-${setup}`,
      setup,
      trades,
      lowConfidence: typeof s.lowConfidence === 'boolean' ? s.lowConfidence : trades < CONFIDENCE_MIN,
      winRatePct: winRate === null ? null : winRate * 100,
      avgR: num(s.avgR),
      totalPnl,
      expectancy: trades > 0 && totalPnl !== null ? totalPnl / trades : null,
    })
  }
  rows.sort((a, b) => {
    if (a.expectancy === null || b.expectancy === null) return (a.expectancy === null) - (b.expectancy === null) || a.setup.localeCompare(b.setup)
    return b.expectancy - a.expectancy || b.trades - a.trades || a.setup.localeCompare(b.setup)
  })
  return rows
}

/** Pure: the closed-trade equity curve as `[{ date, equity }]`, in the order sent (oldest first). */
export function equityCurve(body) {
  const list = isObj(body) && isObj(body.equity) && Array.isArray(body.equity.curve) ? body.equity.curve : []
  const out = []
  for (const p of list) {
    const date = /^\d{4}-\d{2}-\d{2}/.exec(text(p?.date))?.[0] || null
    const equity = num(p?.equity)
    if (date && equity !== null) out.push({ date, equity })
  }
  return out
}

/**
 * Pure: the curve as an SVG polyline in a `width` x `height` box, one step per point (a point is a
 * day that closed a trade, so the steps are trading days, not calendar days). Null with fewer
 * than two points: one point is a number, not a line.
 *   { points: 'x,y x,y ...', width, height, first, last, low, high, change }
 */
export function curveGeometry(points, { width = 300, height = 80, pad = 4 } = {}) {
  const pts = Array.isArray(points) ? points : []
  if (pts.length < 2) return null
  const values = pts.map((p) => p.equity)
  const low = Math.min(...values)
  const high = Math.max(...values)
  const r1 = (v) => Math.round(v * 10) / 10
  const stepX = (width - 2 * pad) / (pts.length - 1)
  const y = (v) => (high === low ? height / 2 : pad + (1 - (v - low) / (high - low)) * (height - 2 * pad))
  return {
    points: pts.map((p, i) => `${r1(pad + i * stepX)},${r1(y(p.equity))}`).join(' '),
    width,
    height,
    first: pts[0],
    last: pts[pts.length - 1],
    low,
    high,
    change: pts[pts.length - 1].equity - pts[0].equity,
  }
}

/**
 * Pure: the analytics answer, cut to what this panel states.
 *   state       'ok' | 'failed'
 *   trades, strategies   closed stock trades in the stats; option strategies (counted apart)
 *   edge        { score, tradeCount, hasParts } or null when the payload has no edge score
 *   risk        { ready, decisive, noR, expectancyR } or null
 *   setups, untagged   the by-setup rows, and the trades that carry no setup tag
 *   curve       the equity points
 */
export function analyticsRead(body) {
  const none = { state: 'failed', trades: null, strategies: null, edge: null, risk: null, rSources: null, setups: [], untagged: null, curve: [] }
  if (!isObj(body) || num(body.tradeCount) === null) return none
  const trades = whole(body.tradeCount)
  const e = body.edgeScore
  const r = body.risk
  const setups = setupRows(body)
  const tagged = setups.reduce((n, s) => n + s.trades, 0)
  return {
    state: 'ok',
    trades,
    strategies: whole(body.strategyCount) || 0,
    edge: isObj(e) ? { score: num(e.score), tradeCount: isObj(e.components) ? whole(e.components.tradeCount) : null, hasParts: isObj(e.components) } : null,
    risk: isObj(r) ? { ready: r.coverageReady === true, decisive: whole(r.decisiveCount) || 0, noR: whole(r.noRCount) || 0, expectancyR: num(r.expectancyR) } : null,
    rSources: rSourcesOf(body.rSources),
    setups,
    untagged: isObj(body.attribution) && Array.isArray(body.attribution.bySetup) ? Math.max(0, trades - tagged) : null,
    curve: equityCurve(body),
  }
}

const NOT_SERVED = 'This server does not serve this number.'
const FROM = Object.freeze({ trades: 'either', expectancyR: 'analytics', edge: 'analytics' })
const stat = (key, label, kind, rest) => ({
  key, label, kind, from: FROM[key] || 'metrics', state: 'unread', value: null, n: null, min: null, of: null, why: null, ...rest,
})
/** A value the server sent, with its sample: a small one (under `min`) is marked, never hidden. */
const sampled = (value, n, of, min = CONFIDENCE_MIN) => ({ state: n !== null && n < min ? 'thin' : 'ok', value, n, min, of })

/**
 * Pure: the headline row. `metrics` and `analytics` are `metricsRead` / `analyticsRead` results, or
 * null for a read that has not answered (its stats are then 'unread', never zero).
 * Each stat: `{ key, label, kind, from, state, value, n, min, of, why }`
 *   kind   'count' | 'pct' | 'usd' | 'signedUsd' | 'r' | 'ratio' | 'score'  (how the panel prints `value`)
 *   from   which read it comes from: 'metrics' | 'analytics' | 'either'
 *   state  'ok'      a value with its sample `n` (`of` says what the sample counts)
 *          'thin'    a value the server sent from fewer than `min`: shown, marked a small sample
 *          'short'   the server withholds it under `min`: "not enough trades yet (n of min)"
 *          'none'    there is nothing to work it out from yet; `why` says what is missing
 *          'unread'  its read failed or has not answered
 */
export function headlineStats({ metrics = null, analytics = null } = {}) {
  const m = metrics?.state === 'ok' ? metrics : null
  const a = analytics?.state === 'ok' ? analytics : null
  const out = []
  const trades = a?.trades ?? m?.trades ?? null
  out.push(stat('trades', 'Closed trades', 'count', trades === null ? {} : { state: 'ok', value: trades }))

  const card = m?.card || null
  const numberOf = (name) => m?.numbers?.[name] || null
  const wins = numberOf('wins')?.value ?? null
  const losses = numberOf('losses')?.value ?? null
  const fromCard = (key, label, kind, build) => {
    if (!m) return stat(key, label, kind)
    if (!card) return stat(key, label, kind, { state: 'none', why: NOT_SERVED })
    return stat(key, label, kind, build())
  }
  out.push(fromCard('winRate', 'Win rate', 'pct', () => (card.decisive === 0 || card.winRate === null
    ? { state: 'none', why: 'No winning or losing trades yet.' }
    : sampled(card.winRate * 100, card.decisive, 'wins and losses'))))
  out.push(fromCard('avgWin', 'Average win', 'usd', () => (card.avgWin === null
    ? { state: 'none', why: 'No winning trades yet.' }
    : sampled(card.avgWin, wins, 'wins'))))
  out.push(fromCard('avgLoss', 'Average loss', 'usd', () => (card.avgLoss === null
    ? { state: 'none', why: 'No losing trades yet.' }
    : sampled(-Math.abs(card.avgLoss), losses, 'losses'))))

  const fromNumber = (key, label, kind, name, build) => {
    if (!m) return stat(key, label, kind)
    const k = numberOf(name)
    if (!k || k.error) return stat(key, label, kind, { state: 'none', why: NOT_SERVED })
    return stat(key, label, kind, build(k.value))
  }
  out.push(fromNumber('expectancy', 'Expectancy per trade', 'signedUsd', 'expectancy', (v) => (v === null
    ? { state: 'none', why: 'No closed trades yet.' }
    : sampled(v, m.trades, 'trades'))))

  const risk = a?.risk || null
  out.push(stat('expectancyR', 'Expectancy in R', 'r', !a ? {} : !risk
    ? { state: 'none', why: NOT_SERVED }
    : !risk.ready
      ? { state: 'short', n: risk.decisive, min: CONFIDENCE_MIN, of: 'wins and losses' }
      : risk.expectancyR === null
        ? { state: 'none', why: 'No trade has a known R yet.' }
        : { state: 'ok', value: risk.expectancyR, n: Math.max(0, a.trades - risk.noR), of: 'trades with a known R' }))

  out.push(fromNumber('profitFactor', 'Profit factor', 'ratio', 'profit_factor', (v) => (v === null
    ? { state: 'none', why: losses === 0 ? 'No losing trades yet, so there is no profit factor.' : 'Not enough to work it out yet.' }
    : sampled(v, card ? card.decisive : null, 'wins and losses'))))

  const edge = a?.edge || null
  out.push(stat('edge', 'Edge score', 'score', !a ? {} : !edge
    ? { state: 'none', why: NOT_SERVED }
    : edge.score !== null
      ? { state: 'ok', value: edge.score, n: edge.tradeCount, of: 'trades' }
      : !edge.hasParts
        ? { state: 'none', why: 'No winning or losing trades yet.' }
        : edge.tradeCount !== null && edge.tradeCount < CONFIDENCE_MIN
          ? { state: 'short', n: edge.tradeCount, min: CONFIDENCE_MIN, of: 'trades' }
          : { state: 'none', why: 'It needs at least 2 trades with a known R.' }))
  return out
}

const ONE_OF = Object.freeze({
  'wins and losses': 'win or loss', wins: 'win', losses: 'loss', trades: 'trade', 'trades with a known R': 'trade with a known R',
})

/** Pure: the line under a stat's value. `count` formats a whole number (the panel passes the
 *  shared formatter). 'short' is the server's own withholding, worded the same everywhere. */
export function sampleText(s, count = String) {
  if (!s) return ''
  if (s.state === 'unread') return 'Could not be read.'
  if (s.state === 'none') return s.why || ''
  if (s.state === 'short') return `Not enough trades yet (${count(s.n)} of ${count(s.min)}).`
  if (s.n === null || s.n === undefined || !s.of) return ''
  const sample = `${count(s.n)} ${s.n === 1 ? ONE_OF[s.of] || s.of : s.of}`
  return s.state === 'thin' ? `Small sample: ${sample}, ${count(s.min)} needed.` : `From ${sample}.`
}

/** Pure: where the R numbers came from, in sentences ('' with no trades). `count` as above. */
export function rSourcesSentence(src, count = String) {
  if (!src) return ''
  const total = src.stop + src.trueR + src.none
  if (!total) return ''
  const t = (n) => `${count(n)} ${n === 1 ? 'trade' : 'trades'}`
  const parts = [`R is known for ${count(src.stop + src.trueR)} of ${t(total)}.`]
  if (src.stop) parts.push(`${t(src.stop)} ${src.stop === 1 ? 'uses' : 'use'} the stop you logged.`)
  if (src.trueR) {
    parts.push(`${t(src.trueR)} had no stop logged (a broker import carries none), so ${src.trueR === 1 ? 'its' : 'their'} R is True R: the result against the trade's own worst drawdown.`)
  }
  if (src.none) {
    parts.push(`${t(src.none)} ${src.none === 1 ? 'has' : 'have'} no R at all (no stop logged and no True R worked out yet), so ${src.none === 1 ? 'it is' : 'they are'} left out of every R number, never counted as zero.`)
  }
  return parts.join(' ')
}
