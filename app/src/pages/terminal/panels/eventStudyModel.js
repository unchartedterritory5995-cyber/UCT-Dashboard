// EVST's pure half: "What happened next", a member's own historical event study. No React, so an
// agent capability can reuse the words (the agent itself is not wired to it).
//
// TWO reads (paid; api/routers/event_study.py, api/services/event_study_member.py):
//   GET /api/research/event-study/series   the series a member can pick, grouped by category, from the
//                                          study adapters' own metadata, the windows, the defaults and
//                                          the ready-made examples (value-free)
//   GET /api/research/event-study?...      one study: every time the condition held, what the symbol
//                                          did over each window, and the same windows from every session
// The server's engine (api/services/market_intel/event_study.py) works every number out; this file
// only builds the study's address, checks a form before it is sent and puts the answer into words.
//
// ⛔ A MISSING NUMBER IS NEVER 0: a window with no completed outcome says how many are still open
// ("too little history"), a study with no episode says so in words, a return not yet known is "open".
// ⛔ A RECORD, NOT A FORECAST. Green and red mark the sign of a return only.
// ⛔ MEMBER-ONLY: the values are the member's; nothing here sends them anywhere.
import { formatNumber, formatPercent } from '../../../lib/presentation/presentationPrimitives'
import { dayText } from './ratesModel'

export const EVST_CODE = 'EVST'
export const EVST_SERIES_URL = '/api/research/event-study/series'
export const EVST_STUDY_PATH = '/api/research/event-study'
/** The things read, as a failed read names them ("The study could not be read just now."). */
export const EVST_WHAT = 'The study'
export const EVST_MENU_WHAT = 'The list of series'
export const EVST_SOURCE = "UCT's stored daily closes and the condition series"
/** Where this browser keeps the member's last study (the SIZE panel's way: localStorage, in try/catch). */
export const EVST_STORE_KEY = 'uct.terminal.evst.v1'
/** While the server works a study out, ask again soon; while it is busy, a little later. */
export const COMPUTING_POLL_MS = 2500
export const BUSY_POLL_MS = 6000
export const MAX_HORIZONS = 4
export const DEFAULT_SYMBOL = 'SPY'

export const KINDS = Object.freeze(['breadth', 'technical', 'cot'])
export const OPS = Object.freeze(['below', 'above', 'cross_below', 'cross_above'])
export const OP_WORDS = Object.freeze({ below: 'below', above: 'above', cross_below: 'crosses below', cross_above: 'crosses above' })
export const EPISODE_WORDS = Object.freeze({ first: 'First session of each run', all: 'Every session that qualifies' })
export const ENTRY_WORDS = Object.freeze({ event_close: "The event session's close", next_close: "The next session's close" })
/** The windows the server offers, in its order: token -> the plain name and a short column head. */
export const WINDOWS = Object.freeze({
  '1d': Object.freeze({ name: '1 session', short: '1 day' }),
  '1w': Object.freeze({ name: '1 week', short: '1 wk' }),
  '2w': Object.freeze({ name: '2 weeks', short: '2 wk' }),
  '1mo': Object.freeze({ name: '1 month', short: '1 mo' }),
  '3mo': Object.freeze({ name: '3 months', short: '3 mo' }),
  '6mo': Object.freeze({ name: '6 months', short: '6 mo' }),
  '12mo': Object.freeze({ name: '12 months', short: '12 mo' }),
  '24mo': Object.freeze({ name: '24 months', short: '24 mo' }),
})
const WINDOW_ORDER = Object.keys(WINDOWS)
const SYMBOL = /^[A-Z][A-Z0-9.-]{0,9}$/

/** The builder's default study (the brief's: SPY over 1, 3 and 6 months, the engine's own episode
 *  and entry rules), on the first ready-made series. Not an owner ruling. */
export const DEFAULT_SPEC = Object.freeze({
  kind: 'breadth', universe: 'nasdaq', metric: 'pct_above_50sma', op: 'below', threshold: '10',
  symbol: DEFAULT_SYMBOL, horizons: Object.freeze(['1mo', '3mo', '6mo']), episodes: 'first', entry: 'event_close',
})
/** The fields each kind of series takes, beside the shared ones. */
const KIND_FIELDS = Object.freeze({ breadth: ['universe', 'metric'], technical: ['series', 'indicator', 'period'], cot: ['market', 'group'] })
/** A category's starting fields when the member switches to it (the builder's defaults). */
export const KIND_START = Object.freeze({
  breadth: Object.freeze({ universe: 'us', metric: 'pct_above_50sma' }),
  technical: Object.freeze({ indicator: 'rsi', period: '14' }),
  cot: Object.freeze({ market: 'ES', group: 'large_spec' }),
})

const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v)
const str = (v) => (typeof v === 'string' ? v.trim() : typeof v === 'number' && Number.isFinite(v) ? String(v) : '')
const finite = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const count = (v) => (Number.isInteger(v) && v >= 0 ? v : null)
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/
const isoDay = (v) => (typeof v === 'string' && ISO_DAY.test(v) ? v : null)
const plural = (n, one, many = `${one}s`) => `${formatNumber(n, { decimals: 0 })} ${n === 1 ? one : many}`

export const normSymbol = (v) => {
  const s = str(v).toUpperCase()
  return SYMBOL.test(s) ? s : null
}

/** Windows in the server's order, known tokens only, once each. */
export function normWindows(list) {
  const want = new Set((Array.isArray(list) ? list : String(list || '').split(',')).map((t) => str(t).toLowerCase()))
  return WINDOW_ORDER.filter((t) => want.has(t))
}

/** The member's last study kept in this browser, or null. The one read of the page's storage (the SIZE
 *  panel's way): never throws; a private window or a broken value is null. */
export function loadStoredSpec(storage = globalThis.localStorage) {
  try {
    const raw = storage ? storage.getItem(EVST_STORE_KEY) : null
    return raw ? normSpec(JSON.parse(raw)) : null
  } catch {
    return null
  }
}

/** Keeps the study in this browser; a private window keeps it in the panel's state only. */
export function saveStoredSpec(spec, storage = globalThis.localStorage) {
  try { if (storage) storage.setItem(EVST_STORE_KEY, JSON.stringify(spec)) } catch { /* not kept: the panel still shows it */ }
}

/** A spec from storage or an example, or null when it is not one this panel can send. Pure. */
export function normSpec(raw) {
  if (!isObj(raw) || !KINDS.includes(raw.kind)) return null
  const out = { kind: raw.kind }
  for (const f of KIND_FIELDS[raw.kind]) out[f] = str(raw[f])
  if (raw.kind === 'technical') out.series = normSymbol(raw.series) || ''
  if (raw.kind === 'cot') out.market = out.market.toUpperCase()
  out.op = OPS.includes(raw.op) ? raw.op : 'below'
  out.threshold = str(raw.threshold)
  out.symbol = normSymbol(raw.symbol) || DEFAULT_SYMBOL
  const hz = normWindows(raw.horizons)
  out.horizons = hz.length ? hz.slice(0, MAX_HORIZONS) : [...DEFAULT_SPEC.horizons]
  out.episodes = raw.episodes === 'all' ? 'all' : 'first'
  out.entry = raw.entry === 'next_close' ? 'next_close' : 'event_close'
  return out
}

/** The spec the panel opens on: the member's last study (or the default), measured on the shell's
 *  ticker when the panel has one. */
export function startSpec(stored, sym) {
  const base = normSpec(stored) || normSpec(DEFAULT_SPEC)
  const s = normSymbol(sym)
  return s ? { ...base, symbol: s } : base
}

/** A category switch keeps the condition, the symbol, the windows and the rules; the series fields
 *  start over (a technical series starts on the symbol measured afterwards). */
export function switchKind(spec, kind) {
  if (!KINDS.includes(kind) || kind === spec.kind) return spec
  const keep = { op: spec.op, threshold: spec.threshold, symbol: spec.symbol, horizons: spec.horizons, episodes: spec.episodes, entry: spec.entry }
  const start = kind === 'technical' ? { ...KIND_START.technical, series: spec.symbol || DEFAULT_SYMBOL } : { ...KIND_START[kind] }
  return { kind, ...start, ...keep }
}

/** The address of one study: the kind's own fields only, in a fixed order, so one spec is one key. */
export function studyUrl(spec) {
  const s = normSpec(spec)
  if (!s) return null
  const q = new URLSearchParams()
  q.set('kind', s.kind)
  for (const f of KIND_FIELDS[s.kind]) if (s[f] !== '') q.set(f, s[f])
  q.set('op', s.op)
  const t = Number(s.threshold)
  q.set('threshold', Number.isFinite(t) ? String(t) : s.threshold)
  q.set('symbol', s.symbol)
  q.set('horizons', s.horizons.join(','))
  q.set('episodes', s.episodes)
  q.set('entry', s.entry)
  return `${EVST_STUDY_PATH}?${q.toString()}`
}

// ── the menu ────────────────────────────────────────────────────────────────────────────────

/** The series menu, or `{ state: 'failed' }` when the answer is not its shape. */
export function readMenu(body) {
  if (!isObj(body) || body.status !== 'ok' || !Array.isArray(body.categories)) return { state: 'failed' }
  const cats = {}
  for (const c of body.categories) {
    if (!isObj(c) || !KINDS.includes(c.kind)) continue
    cats[c.kind] = c
  }
  if (!Object.keys(cats).length) return { state: 'failed' }
  const breadth = cats.breadth || {}
  const tech = cats.technical || {}
  const cot = cats.cot || {}
  const opt = (list, key) => (Array.isArray(list) ? list : []).filter((x) => isObj(x) && typeof x[key] === 'string')
  return {
    state: 'ok',
    kinds: KINDS.filter((k) => cats[k]).map((k) => ({ value: k, label: str(cats[k].name) || k })),
    universes: opt(breadth.universes, 'universe').map((u) => ({ value: u.universe, label: str(u.name) || u.universe })),
    metrics: opt(breadth.metrics, 'metric').map((m) => ({ value: m.metric, label: str(m.name) || m.metric, unit: m.unit, domain: m.domain })),
    indicators: opt(tech.indicators, 'indicator').map((i) => ({
      value: i.indicator, label: str(i.name) || i.indicator, unit: i.unit, domain: i.domain,
      period: isObj(i.period) && count(i.period.min) != null && count(i.period.max) != null
        ? { min: i.period.min, max: i.period.max, def: count(i.period.default) } : null,
    })),
    markets: opt(cot.markets, 'market').map((m) => ({ value: m.market, label: str(m.name) || m.market })),
    groups: opt(cot.groups, 'group').map((g) => ({ value: g.group, label: str(g.name) || g.group })),
    cotUnit: { unit: cot.unit || 'count', domain: cot.domain || 'signed' },
    windows: (Array.isArray(body.horizons) ? body.horizons : []).filter((h) => isObj(h) && WINDOWS[h.token]).map((h) => h.token),
    maxWindows: count(body.max_horizons) || MAX_HORIZONS,
    examples: (Array.isArray(body.examples) ? body.examples : [])
      .filter((e) => isObj(e) && typeof e.id === 'string' && typeof e.name === 'string' && normSpec(e.spec))
      .map((e) => ({ id: e.id, name: e.name, spec: normSpec(e.spec) })),
    notOffered: (Array.isArray(body.not_offered) ? body.not_offered : []).filter((x) => isObj(x) && typeof x.name === 'string')
      .map((x) => ({ kind: x.kind, name: x.name, why: str(x.why) })),
  }
}

/** The unit and domain of the series a spec names, from the menu (null when the menu cannot say). */
export function seriesMeasure(menu, spec) {
  if (!menu || menu.state !== 'ok' || !spec) return null
  if (spec.kind === 'breadth') return menu.metrics.find((m) => m.value === spec.metric) || null
  if (spec.kind === 'technical') return menu.indicators.find((i) => i.value === spec.indicator) || null
  if (spec.kind === 'cot') return menu.cotUnit
  return null
}

/** What a threshold means for this series, in words, under the box. */
export function thresholdHint(measure) {
  if (!measure) return 'A number.'
  const { unit, domain } = measure
  if (unit === 'percent' && domain === 'pct_0_100') return 'A share of stocks, from 0 to 100.'
  if (unit === 'count' && domain === 'nonneg') return 'A number of stocks, 0 or more.'
  if (unit === 'count' && domain === 'signed') return 'A number above or below 0 (below 0 is more on the other side).'
  if (unit === 'ratio') return 'A ratio, 0 or more.'
  if (unit === 'index') return 'From 0 to 100.'
  if (unit === 'percent_change') return 'A percent change: -3 is a 3% fall, 2 a 2% rise.'
  if (unit === 'percent_b') return 'Where the close sits in the band: 0 is the lower band, 100 the upper.'
  if (unit === 'price_units') return 'In price units, above or below 0.'
  return 'A number.'
}

/** The checks the server makes that the form can make first, as sentences (empty when it can be sent). */
export function checkSpec(spec, menu) {
  const errs = {}
  if (!spec || !KINDS.includes(spec.kind)) return { kind: 'Pick the kind of series.' }
  const t = str(spec.threshold)
  const n = t === '' ? NaN : Number(t)
  const m = seriesMeasure(menu, spec)
  if (!Number.isFinite(n)) errs.threshold = 'Type the threshold as a number (for example 10 or -3).'
  else if (m && m.domain === 'pct_0_100' && (n < 0 || n > 100)) errs.threshold = 'This measure runs from 0 to 100.'
  else if (m && (m.domain === 'nonneg' || m.domain === 'ratio') && n < 0) errs.threshold = 'This measure is 0 or more.'
  if (!normSymbol(spec.symbol)) errs.symbol = 'Type a ticker, for example SPY.'
  if (spec.kind === 'technical') {
    if (!normSymbol(spec.series)) errs.series = 'Type the ticker whose indicator is measured.'
    const per = m && m.period
    if (per) {
      const p = Number(spec.period)
      if (!Number.isInteger(p) || p < per.min || p > per.max) errs.period = `A whole number from ${per.min} to ${per.max}.`
    }
  }
  const hz = normWindows(spec.horizons)
  if (!hz.length) errs.horizons = 'Pick at least one window.'
  else if (hz.length > ((menu && menu.maxWindows) || MAX_HORIZONS)) errs.horizons = `Pick at most ${(menu && menu.maxWindows) || MAX_HORIZONS} windows.`
  return errs
}

/** The spec as it is sent: a technical indicator without a period drops it; one with a period gets
 *  the menu's default when the box is empty. */
export function readySpec(spec, menu) {
  const s = normSpec(spec)
  if (!s) return null
  if (s.kind === 'technical') {
    const per = seriesMeasure(menu, s)?.period
    if (!per && menu && menu.state === 'ok') s.period = ''
    else if (per && s.period === '' && per.def != null) s.period = String(per.def)
  }
  return s
}

// ── the study ───────────────────────────────────────────────────────────────────────────────

function readReturn(raw) {
  if (!isObj(raw)) return null
  const outcome = ['ok', 'incomplete', 'missing'].includes(raw.outcome) ? raw.outcome : 'missing'
  return { token: WINDOWS[raw.token] ? raw.token : null, outcome, exit: isoDay(raw.exit_date), value: outcome === 'ok' ? finite(raw.return) : null }
}

/** The engine says a small sample, an overlap, revised values and a possible split twice: once as a
 *  caveat (kept in view) and once among its notes. Each is shown once, as the caveat. */
const CAVEAT_TOPICS = [/^small sample/i, /overlap/i, /backfilled/i, /split|corporate action/i]
export function notesBesideCaveats(notes, caveats) {
  const covered = CAVEAT_TOPICS.filter((re) => caveats.some((c) => re.test(c)))
  return notes.filter((n) => !covered.some((re) => re.test(n)))
}

function readPoint(raw) {
  return isObj(raw) && finite(raw.return) != null ? { event: isoDay(raw.event_date), exit: isoDay(raw.exit_date), value: raw.return } : null
}

/** The study answer -> `{ state, ... }`. state: ok | computing | busy | unavailable | failed. */
export function readStudy(body) {
  if (!isObj(body)) return { state: 'failed' }
  if (body.status === 'computing') return { state: 'computing' }
  if (body.status === 'busy') return { state: 'busy', detail: str(body.detail) || null }
  if (body.status === 'unavailable') return { state: 'unavailable', reason: str(body.reason) || null, detail: str(body.detail) || null }
  if (body.status !== 'ok' || !Array.isArray(body.horizons) || !isObj(body.counts)) return { state: 'failed' }
  const spec = normSpec(body.spec)
  const tokens = spec ? spec.horizons : []
  const hz = body.horizons.filter(isObj).map((h) => ({
    token: WINDOWS[h.token] ? h.token : null,
    n: count(h.n) ?? 0,
    incomplete: count(h.incomplete) ?? 0,
    missing: count(h.missing_price) ?? 0,
    positive: count(h.positive),
    rate: finite(h.positive_rate),
    mean: finite(h.mean),
    median: finite(h.median),
    best: readPoint(h.best),
    worst: readPoint(h.worst),
  }))
  const base = Array.isArray(body.baseline) ? body.baseline.filter(isObj).map((b) => ({
    token: WINDOWS[b.token] ? b.token : null, n: count(b.n) ?? 0, rate: finite(b.positive_rate), mean: finite(b.mean), median: finite(b.median),
  })) : null
  const c = body.counts
  const cov = isObj(body.coverage) ? body.coverage : {}
  const series = isObj(body.series) ? body.series : {}
  return {
    state: 'ok',
    spec,
    tokens,
    session: isoDay(body.session),
    series: { label: str(series.label) || 'The series', category: str(series.category), unit: str(series.unit), domain: str(series.domain), alignment: str(series.alignment), kind: str(series.kind) },
    coverage: {
      seriesFirst: isoDay(cov.series_first), seriesLast: isoDay(cov.series_last), priceFirst: isoDay(cov.price_first),
      priceLast: isoDay(cov.price_last), start: isoDay(cov.study_start), end: isoDay(cov.study_end),
    },
    counts: {
      used: count(c.events_used) ?? 0, detected: count(c.events_detected), qualifying: count(c.qualifying_sessions),
      runs: count(c.episodes_or_crossings), gaps: count(c.condition_gaps), overlapping: count(c.overlapping_events),
    },
    horizons: hz,
    baseline: base,
    events: (Array.isArray(body.events) ? body.events : []).filter((e) => isObj(e) && isoDay(e.event_date)).map((e) => ({
      date: e.event_date, entry: isoDay(e.entry_date), value: finite(e.condition_value),
      returns: (Array.isArray(e.returns) ? e.returns : []).map(readReturn).filter(Boolean),
    })),
    truncated: body.events_truncated === true,
    ...(() => {
      const caveats = (Array.isArray(body.caveats) ? body.caveats : []).filter((n) => typeof n === 'string' && n.trim())
      const notes = (Array.isArray(body.notes) ? body.notes : []).filter((n) => typeof n === 'string' && n.trim())
      return { caveats, notes: notesBesideCaveats(notes, caveats) }
    })(),
    method: (isObj(body.method) && Array.isArray(body.method.lines) ? body.method.lines : []).filter((n) => typeof n === 'string' && n.trim()),
    source: str(body.source) || EVST_SOURCE,
  }
}

export const isPolling = (view) => view && (view.state === 'computing' || view.state === 'busy')
export const pollFor = (view) => (view?.state === 'computing' ? COMPUTING_POLL_MS : view?.state === 'busy' ? BUSY_POLL_MS : 0)

// ── words ───────────────────────────────────────────────────────────────────────────────────

/** A forward return (a fraction) as a signed percent; null is "n/a", never 0. */
export const returnText = (r) => (finite(r) == null ? 'n/a' : formatPercent(r * 100, { decimals: 1, signed: true }))
export const signOf = (r) => (finite(r) == null || r === 0 ? null : r > 0 ? 'up' : 'down')
export const rateText = (rate) => (finite(rate) == null ? 'n/a' : formatPercent(rate * 100, { decimals: 0 }))
export const windowName = (token) => WINDOWS[token]?.name || token || 'Window'
export const windowShort = (token) => WINDOWS[token]?.short || token || ''

/** A condition value in the series' own unit. */
export function valueText(v, unit) {
  if (finite(v) == null) return 'n/a'
  if (unit === 'percent' || unit === 'percent_b') return formatPercent(v, { decimals: 1 })
  if (unit === 'percent_change') return formatPercent(v, { decimals: 1, signed: true })
  if (unit === 'count') return formatNumber(v, { decimals: 0 })
  if (unit === 'index') return formatNumber(v, { decimals: 1 })
  return formatNumber(v, { decimals: 2 })
}

/** The threshold as the member typed it, in the series' unit where it has one. */
export function thresholdText(spec, unit) {
  const n = Number(spec?.threshold)
  if (!Number.isFinite(n)) return String(spec?.threshold ?? '')
  return valueText(n, unit)
}

/** "NASDAQ · % of Stocks Above 50-Day MA below 10.0%". */
export function conditionText(view) {
  const s = view.spec || {}
  return `${view.series.label} ${OP_WORDS[s.op] || s.op} ${thresholdText(s, view.series.unit)}`
}

/** The line above the table in two parts around the symbol: how many episodes and where, then what
 *  was measured from when ("{head} SPY {tail}"). */
export function leadParts(view) {
  const s = view.spec || {}
  const span = view.coverage.start && view.coverage.end ? ` between ${dayText(view.coverage.start)} and ${dayText(view.coverage.end)}` : ''
  const from = s.entry === 'next_close' ? "the next session's close" : "the event session's close"
  return { head: `${conditionText(view)}: ${plural(view.counts.used, 'episode')}${span}.`, tail: `afterwards, from ${from}.` }
}

/** The same line as one sentence. */
export function leadText(view) {
  const { head, tail } = leadParts(view)
  return `${head} ${view.spec?.symbol || 'The symbol'} ${tail}`
}

/** How the episodes were counted, when it matters (a run counted once; some found but not usable). */
export function countText(view) {
  const s = view.spec || {}
  const c = view.counts
  const parts = []
  if (!String(s.op || '').startsWith('cross_') && s.episodes === 'first' && c.qualifying != null && c.runs != null && c.qualifying > c.runs) {
    parts.push(`The condition held on ${plural(c.qualifying, 'session')} in ${plural(c.runs, 'run')}; each run counts once, on its first session.`)
  }
  if (c.detected != null && c.detected > c.used) {
    parts.push(`${plural(c.detected - c.used, 'episode')} found had no stored ${s.symbol || ''} close to enter at and ${c.detected - c.used === 1 ? 'is' : 'are'} left out.`.replace('  ', ' '))
  }
  return parts.join(' ')
}

/** No episode at all, in words. */
export function noEpisodesText(view) {
  const span = view.coverage.start && view.coverage.end ? ` between ${dayText(view.coverage.start)} and ${dayText(view.coverage.end)}` : ' in the history held'
  const s = view.spec || {}
  const verb = String(s.op || '').startsWith('cross_') ? `never ${OP_WORDS[s.op].replace('crosses', 'crossed')}` : `was never ${OP_WORDS[s.op] || s.op}`
  return `No episodes: ${view.series.label} ${verb} ${thresholdText(s, view.series.unit)}${span}.`
}

/** One window's row: `kind` value | open (too little history after the episodes) | none (no episode). */
export function windowRow(view, row) {
  if (row.n > 0) {
    return {
      kind: 'value', token: row.token, name: windowName(row.token), episodes: plural(row.n, 'episode'),
      rate: rateText(row.rate), upOf: row.positive != null ? `${formatNumber(row.positive, { decimals: 0 })} of ${formatNumber(row.n, { decimals: 0 })}` : '',
      mean: returnText(row.mean), meanSign: signOf(row.mean), median: returnText(row.median), medianSign: signOf(row.median),
      worst: returnText(row.worst?.value), worstSign: signOf(row.worst?.value), worstDate: row.worst?.event || null,
      best: returnText(row.best?.value), bestSign: signOf(row.best?.value), bestDate: row.best?.event || null,
      open: row.incomplete, missing: row.missing,
    }
  }
  if (row.incomplete > 0) {
    return { kind: 'open', token: row.token, name: windowName(row.token),
      text: `Too little history after the episodes for ${windowName(row.token)}: ${plural(row.incomplete, 'episode')} ${row.incomplete === 1 ? 'is' : 'are'} still open.` }
  }
  if (row.missing > 0) {
    return { kind: 'open', token: row.token, name: windowName(row.token),
      text: `No completed outcome for ${windowName(row.token)}: ${plural(row.missing, 'exit')} without a stored close.` }
  }
  return { kind: 'none', token: row.token, name: windowName(row.token), text: 'No episodes.' }
}

/** The same window from every session in the span (the comparison), or null. */
export function baselineRow(view, token) {
  const b = (view.baseline || []).find((x) => x.token === token)
  if (!b || !b.n) return null
  return { sessions: plural(b.n, 'session'), rate: rateText(b.rate), mean: returnText(b.mean), meanSign: signOf(b.mean), median: returnText(b.median), medianSign: signOf(b.median) }
}

/** One episode's return in one window: the value, "open" (the window has not ended) or "no close". */
export function episodeCell(ep, token) {
  const r = ep.returns.find((x) => x.token === token)
  if (!r) return { kind: 'missing', text: 'n/a' }
  if (r.outcome === 'ok') return { kind: 'value', text: returnText(r.value), sign: signOf(r.value), exit: r.exit }
  if (r.outcome === 'incomplete') return { kind: 'open', text: 'open', title: 'The window has not ended yet' }
  return { kind: 'missing', text: 'no close', title: 'No stored close on the exit day' }
}

/** The line over the episode list: all of them, or the newest 60 of how many. */
export function episodesHeading(view) {
  return view.truncated
    ? `The newest ${formatNumber(view.events.length, { decimals: 0 })} of ${plural(view.counts.used, 'episode')}, newest first`
    : `Every episode, newest first (${plural(view.counts.used, 'episode')})`
}

/** Where the numbers come from and how far back each history goes. */
export function coverageText(view) {
  const c = view.coverage
  const s = view.spec || {}
  const parts = []
  if (c.seriesFirst && c.seriesLast) parts.push(`The condition series runs from ${dayText(c.seriesFirst)} to ${dayText(c.seriesLast)}`)
  if (c.priceFirst && c.priceLast) parts.push(`${s.symbol || 'the symbol'} closes from ${dayText(c.priceFirst)} to ${dayText(c.priceLast)}`)
  return parts.length ? `${parts.join('; ')}.` : ''
}
