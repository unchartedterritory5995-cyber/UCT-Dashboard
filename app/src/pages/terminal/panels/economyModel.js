// ECON's pure half: the economy dashboard's one read -> what the panel draws. No React.
//
// GET /api/econ/latest?symbols=... (api/routers/econ.py over api/services/econ/serving.py) answers,
// for each series asked, its newest three points ([t first available, value, period start, period
// end, pit]), its registry meta (units with their format and scale, frequency, derivation, source),
// its currentness (state, and the next release from the release calendar) and `retrieved_at` (when
// the econ service last read it). Rows the registry does not serve say `not_found`, rows with
// nothing published `no_data`. The same flag and gate as the rest of /api/econ: 404 = the economic
// data is switched off for this server, 401 signed out, 403 a plan without chart data.
//
// ⛔ A MISSING VALUE IS NEVER 0: a null point (an agency's own "no figure", like a shutdown month) is
// words, and so is a series not held. A change needs two real prints.
// ⛔ THE MEASURE IS THE SERVER'S: each row shows the series' own value in its own units (`units.fmt`
// and `units.scale`). The year-over-year and month-over-month rows are the econ service's own
// derived series (computed on the server from the agency's index, `meta.derivation`), and they say
// they are a UCT calculation. The only arithmetic here is the change from the print before.
// ⛔ THE NEXT RELEASE IS THE CALENDAR'S DATE, never today: a date the server does not hold is words.
import { formatNumber, formatPercent } from '../../../lib/presentation/presentationPrimitives'
import { formatFundamentalValue, formatKeyOf } from '../../../components/chart/engine/fundamentalFormat'
import { etDateOf, frequencyOf, observationLabel } from '../../../components/chart/engine/economicSource'
import { economicCurrentnessState } from '../../../components/chart/engine/economicSeries'
import { clock12, nextReleaseText, shortDate } from '../../../components/chart/economic/econUi'
import { chartsLinkPath } from '../../../lib/chartDeepLink'
import { CURRENTNESS } from '../../../utils/marketSession'

export const ECON_CODE = 'ECON'
/** The thing read, as a failed read names it. */
export const ECON_WHAT = 'The economic data'
export const ECON_SOURCE = 'Official U.S. economic releases (BLS, BEA, Census Bureau, Department of Labor, Federal Reserve, New York Fed, FHFA)'
/** The econ service serves from a two-minute cache; asking more often finds nothing new. */
export const ECON_POLL_MS = 2 * 60 * 1000
/** The publisher named in a credit line that asks for one ({publisher}). */
export const ECON_PUBLISHER = 'UCT Intelligence'
export const STRIP_DAYS = 7

/**
 * The board, theme by theme, in reading order. `symbol` is the series the row shows; `alt` a second,
 * smaller figure for the same release (the month-over-month change beside an inflation row's
 * year-over-year). Only series the registry serves to members (api/services/econ/registry/series.json,
 * status enabled, verified, cleared); `missing` names what a trader looks for here that it does not.
 */
export const ECON_THEMES = Object.freeze([
  Object.freeze({ key: 'inflation', title: 'Inflation', missing: Object.freeze([]), rows: Object.freeze([
    Object.freeze({ key: 'cpi', label: 'CPI', symbol: 'USCPIYOY', alt: 'USCPIMOM' }),
    Object.freeze({ key: 'core_cpi', label: 'Core CPI', symbol: 'USCORECPIYOY', alt: 'USCORECPIMOM' }),
    Object.freeze({ key: 'pce', label: 'PCE prices', symbol: 'USPCEPIYOY', alt: 'USPCEPIMOM' }),
    Object.freeze({ key: 'core_pce', label: 'Core PCE prices', symbol: 'USCOREPCEYOY', alt: 'USCOREPCEMOM' }),
    Object.freeze({ key: 'ppi', label: 'PPI', symbol: 'USPPIYOY', alt: 'USPPIMOM' }),
  ]) }),
  Object.freeze({ key: 'jobs', title: 'Jobs', missing: Object.freeze([]), rows: Object.freeze([
    Object.freeze({ key: 'payrolls', label: 'Nonfarm payrolls', symbol: 'USNFPCHG' }),
    Object.freeze({ key: 'unemployment', label: 'Unemployment rate', symbol: 'USUNRATE' }),
    Object.freeze({ key: 'claims', label: 'Initial jobless claims', symbol: 'USICSA' }),
    Object.freeze({ key: 'earnings', label: 'Average hourly earnings', symbol: 'USAHEYOY' }),
    Object.freeze({ key: 'openings', label: 'Job openings', symbol: 'USJOLTSO' }),
  ]) }),
  Object.freeze({ key: 'growth', title: 'Growth and spending', missing: Object.freeze(['Retail sales']), rows: Object.freeze([
    Object.freeze({ key: 'gdp', label: 'Real GDP', symbol: 'USRGDPQA' }),
    Object.freeze({ key: 'production', label: 'Industrial production', symbol: 'USINDPRO' }),
    Object.freeze({ key: 'income', label: 'Personal income', symbol: 'USPERSINC' }),
    Object.freeze({ key: 'spending', label: 'Personal spending', symbol: 'USPCE' }),
  ]) }),
  Object.freeze({ key: 'housing', title: 'Housing', missing: Object.freeze([]), rows: Object.freeze([
    Object.freeze({ key: 'starts', label: 'Housing starts', symbol: 'USHOUST' }),
    Object.freeze({ key: 'permits', label: 'Building permits', symbol: 'USPERMIT' }),
    Object.freeze({ key: 'new_homes', label: 'New home sales', symbol: 'USNEWHOME' }),
    Object.freeze({ key: 'house_prices', label: 'House prices (FHFA)', symbol: 'USFHFAHPIYOY' }),
  ]) }),
  Object.freeze({ key: 'rates', title: 'Rates and money', missing: Object.freeze([]), rows: Object.freeze([
    Object.freeze({ key: 'fed_funds', label: 'Effective fed funds rate', symbol: 'USEFFR' }),
    Object.freeze({ key: 'ten_year', label: '10-year Treasury yield', symbol: 'UST10Y' }),
    // the Fed Board's Nominal Broad U.S. Dollar Index (H.10, daily), not ICE's DXY: an index level and its change
    Object.freeze({ key: 'dollar', label: 'Broad dollar index (Fed)', symbol: 'USDOLLARIDX' }),
  ]) }),
])

/** Every series the board asks for, once, in board order. */
export const ECON_SYMBOLS = Object.freeze([...new Set(ECON_THEMES.flatMap((t) => t.rows.flatMap((r) => (r.alt ? [r.symbol, r.alt] : [r.symbol]))))])
export const ECON_LATEST_URL = `/api/econ/latest?symbols=${ECON_SYMBOLS.join(',')}`

const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v)
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const str = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null)
const isDay = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)
const dayMs = (iso) => Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10))
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

/** Whole days from `a` to `b` (both YYYY-MM-DD). */
export const daysBetween = (a, b) => Math.round((dayMs(b) - dayMs(a)) / 86400000)
/** 'Tue' for a YYYY-MM-DD. */
export const weekdayOf = (iso) => (isDay(iso) ? WEEKDAYS[new Date(dayMs(iso)).getUTCDay()] : '')

/** Today in New York (YYYY-MM-DD), for an epoch in milliseconds. */
export const etToday = (ms) => etDateOf(Math.floor(ms / 1000))

// ── one series ────────────────────────────────────────────────────────────────────────────

const COLS = ['t', 'v', 'ps', 'pe', 'pit']

/** A row's points, oldest first, read by column name. A null value is kept (it is the agency's own
 *  "no figure"); a point without a time or with a value that is neither a number nor null is dropped. */
export function pointsOf(raw, columns = COLS) {
  const cols = Array.isArray(columns) && columns.length ? columns : COLS
  const at = (k) => cols.indexOf(k)
  const [it, iv, ips, ipe] = [at('t'), at('v'), at('ps'), at('pe')]
  if (it < 0 || iv < 0) return []
  return (Array.isArray(raw) ? raw : [])
    .filter((p) => Array.isArray(p) && Number.isFinite(p[it]) && (Number.isFinite(p[iv]) || p[iv] === null))
    .map((p) => ({ t: p[it], v: p[iv], ps: ips >= 0 && isDay(p[ips]) ? p[ips] : null, pe: ipe >= 0 && isDay(p[ipe]) ? p[ipe] : null }))
    .sort((a, b) => (a.t - b.t) || String(a.pe || '').localeCompare(String(b.pe || '')))
}

const PERIOD_WORD = { M: 'month', W: 'week', Q: 'quarter', D: 'day', A: 'year' }

/** What the number IS, in words, from the series' own meta (derivation, units, adjustment). */
export function measureOf(meta) {
  const m = isObj(meta) ? meta : {}
  const op = isObj(m.derivation) ? m.derivation.op : null
  const freq = frequencyOf(m)
  const per = PERIOD_WORD[freq] || 'period'
  const display = isObj(m.units) ? m.units.display : null
  const saar = String(m.seasonal_adjustment || '').toUpperCase() === 'SAAR'
  if (op === 'yoy_pct') return 'Change from a year earlier'
  if (op === 'mom_pct') return 'Change from the month before'
  if (op === 'diff') return `Change from the ${per} before`
  if (op === 'sma') return 'Moving average'
  if (display === '%') return saar ? `Change from the ${per} before, at an annual rate` : 'Percent'
  if (display === 'index') return 'Index level'
  return saar ? 'Level, at an annual rate' : 'Level'
}

/** The series' value in its own units: `units.fmt` with `units.scale` (thousands of claims read as claims). */
export function valueText(v, meta) {
  if (!Number.isFinite(v)) return null
  const key = formatKeyOf(isObj(meta) ? meta.units : null)
  return key ? formatFundamentalValue(v, key) : formatNumber(v, { decimals: 2 })
}

const rounded = (x, d) => Math.round(x * 10 ** d) / 10 ** d
const signed = (r, text) => (r > 0 ? `+${text}` : text)

/**
 * The change from the print before, as a trader quotes it:
 *   a rate read to one decimal (CPI, unemployment)   points:        +0.1 pts
 *   a rate read to two decimals (fed funds, yields)  basis points:  -4 bp
 *   a count (claims, jobs)                           the count:     +12,000 / -135.0K
 *   a level (an index, dollars, housing units)       percent:       +0.3%
 * null without two real prints (or for a percent of nothing).
 */
export function changeOf(latest, prior, meta) {
  if (!Number.isFinite(latest) || !Number.isFinite(prior)) return null
  const units = isObj(meta) && isObj(meta.units) ? meta.units : {}
  const fmt = String(units.fmt || '')
  const dv = latest - prior
  if (fmt === 'pct2' || fmt === 'pp2' || fmt === 'bps0') {
    const r = rounded(fmt === 'bps0' ? dv : dv * 100, 0)
    return { kind: 'bp', text: `${signed(r, formatNumber(r, { decimals: 0 }))} bp`, dir: Math.sign(r) }
  }
  if (/^(pct|pp)/.test(fmt)) {
    const r = rounded(dv, 1)
    return { kind: 'pts', text: `${signed(r, formatNumber(r, { decimals: 1 }))} pts`, dir: Math.sign(r) }
  }
  if (units.display === 'count' || units.display === 'persons') {
    const r = rounded(dv, 3)
    return { kind: 'count', text: signed(r, valueText(r, meta)), dir: Math.sign(r) }
  }
  if (prior === 0) return null
  const r = rounded((dv / Math.abs(prior)) * 100, 1)
  return { kind: 'pct', text: formatPercent(r, { decimals: 1, signed: r !== 0 }), dir: Math.sign(r) }
}

/** The period a point covers ('Oct 2026', 'Q3 2026', 'wk 11/15'). */
export const periodText = (point, meta) => (point ? observationLabel(point, frequencyOf(meta)) : '')

/** The day a point was first released ('Nov 13'), from its first-availability time. */
export const releasedText = (point, today) => (point && Number.isFinite(point.t) ? shortDate(etDateOf(point.t), { nowIso: today }) : '')

/**
 * The next release from the series' release calendar. ⛔ Never today unless the calendar says today:
 *   ok        { date, time, text: 'Dec 10, 8:30 AM ET' (or '(typical)', '(est.)'), days }
 *   passed    the date held is behind us (the server has not read a newer schedule yet)
 *   not_held  no date, or a date the agency has not set ("precision unknown")
 */
export function nextReleaseOf(currentness, today) {
  const nr = isObj(currentness) && isObj(currentness.next_release) ? currentness.next_release : null
  if (!nr || !isDay(nr.date) || nr.precision === 'unknown') return { state: 'not_held', text: 'Next release date not held' }
  if (isDay(today) && nr.date < today) {
    return { state: 'passed', date: nr.date, text: `Was due ${shortDate(nr.date, { nowIso: today })}; not confirmed yet` }
  }
  const text = nextReleaseText(nr, { nowIso: today })
  return {
    state: 'ok', date: nr.date, time: typeof nr.time === 'string' && /^\d{2}:\d{2}$/.test(nr.time) ? nr.time : null,
    precision: str(nr.precision) || 'date_only', text: text || shortDate(nr.date, { nowIso: today }), days: isDay(today) ? daysBetween(today, nr.date) : null,
  }
}

/** The release state worth saying (a release due and not in, a source that failed); null when current or unscheduled. */
export function releaseNote(currentness) {
  const s = economicCurrentnessState(isObj(currentness) ? currentness.state : null)
  if (s === CURRENTNESS.UPDATING) return 'Due now; the server is checking for it'
  if (s === CURRENTNESS.DELAYED) return 'Delayed: the newest release has not arrived'
  if (s === CURRENTNESS.UNAVAILABLE) return 'The source could not be read; last good value shown'
  return null
}

const NOT_HELD_WORDS = {
  not_found: 'Not among the economic series this server publishes.',
  no_data: 'No reading published here yet.',
}

/** The second figure's short name, from its own derivation. */
const ALT_LABEL = { mom_pct: 'm/m', yoy_pct: 'y/y' }

/** Missing value in words: the agency published no figure for that period. */
export const noFigureText = (period) => (period ? `No figure for ${period}` : 'No figure')

function readSeries(raw) {
  if (!isObj(raw)) return null
  return {
    symbol: str(raw.symbol) ? raw.symbol.trim().toUpperCase() : null,
    state: ['ok', 'no_data', 'not_found'].includes(raw.state) ? raw.state : 'not_found',
    meta: isObj(raw.meta) ? raw.meta : null,
    points: raw.points,
    currentness: isObj(raw.currentness) ? raw.currentness : null,
    retrievedAt: Number.isInteger(raw.retrieved_at) ? raw.retrieved_at : null,
  }
}

/** One board row from its spec and the answer's series. */
export function boardRow(spec, series, { today, columns = COLS, alt = null } = {}) {
  const base = {
    key: spec.key, label: spec.label, symbol: spec.symbol,
    chartHref: chartsLinkPath({ symbol: `ECON:${spec.symbol}` }),
  }
  if (!series || series.state === 'not_found') return { ...base, state: 'not_found', words: NOT_HELD_WORDS.not_found }
  const meta = series.meta || {}
  const pts = pointsOf(series.points, columns)
  const common = {
    ...base,
    meta,
    measure: measureOf(meta),
    derived: isObj(meta.derivation),
    sourceLine: isObj(meta.source) ? str(meta.source.line) : null,
    frequency: frequencyOf(meta),
    next: nextReleaseOf(series.currentness, today),
    note: releaseNote(series.currentness),
    retrievedAt: series.retrievedAt,
  }
  if (series.state === 'no_data' || !pts.length) return { ...common, state: 'no_data', words: NOT_HELD_WORDS.no_data }
  const last = pts[pts.length - 1]
  const prev = pts.length > 1 ? pts[pts.length - 2] : null
  const latest = {
    value: num(last.v), text: valueText(last.v, meta), period: periodText(last, meta), released: releasedText(last, today), t: last.t,
  }
  const prior = prev ? { value: num(prev.v), text: valueText(prev.v, meta), period: periodText(prev, meta) } : null
  let altView = null
  if (alt && alt.state === 'ok') {
    const ap = pointsOf(alt.points, columns).filter((p) => Number.isFinite(p.v))
    const a = ap[ap.length - 1]
    if (a) {
      const period = periodText(a, alt.meta)
      const op = isObj(alt.meta) && isObj(alt.meta.derivation) ? alt.meta.derivation.op : null
      altView = {
        symbol: alt.symbol, text: valueText(a.v, alt.meta), period, samePeriod: period === latest.period, meta: alt.meta,
        label: ALT_LABEL[op] || '',
      }
    }
  }
  return { ...common, state: 'ok', latest, prior, change: changeOf(latest.value, prior ? prior.value : null, meta), alt: altView }
}

// ── the board ─────────────────────────────────────────────────────────────────────────────

/**
 * The releases from today through the same weekday next week (today + STRIP_DAYS), soonest first,
 * grouped by release time: `[{ date, time, when: 'Tue Mar 24, 8:30 AM ET', labels: ['CPI', 'Core CPI'] }]`.
 * A daily series (it prints every business day) is left out, and so is a row with no date held.
 */
export function releasesAhead(rows, today, days = STRIP_DAYS) {
  if (!isDay(today)) return []
  const groups = new Map()
  for (const r of rows) {
    if (!r.next || r.next.state !== 'ok' || r.frequency === 'D') continue
    const d = daysBetween(today, r.next.date)
    if (d < 0 || d > days) continue
    const k = `${r.next.date}|${r.next.time || ''}`
    if (!groups.has(k)) {
      const day = d === 0 ? 'Today' : `${weekdayOf(r.next.date)} ${shortDate(r.next.date, { nowIso: today })}`
      const time = r.next.time && r.next.precision !== 'date_only' ? clock12(r.next.time) : null
      const tail = !time ? '' : r.next.precision === 'time_configured' ? ' (typical)' : r.next.precision === 'rule' ? ' (est.)' : ''
      groups.set(k, { date: r.next.date, time: r.next.time, days: d, when: time ? `${day}, ${time} ET${tail}` : day, labels: [] })
    }
    groups.get(k).labels.push(r.label)
  }
  return [...groups.values()].sort((a, b) => a.date.localeCompare(b.date) || (a.time ? 0 : 1) - (b.time ? 0 : 1) || String(a.time).localeCompare(String(b.time)))
}

const keysOf = (meta) => {
  const src = isObj(meta) && isObj(meta.source) ? meta.source : {}
  const keys = Array.isArray(src.attribution_keys) && src.attribution_keys.length ? src.attribution_keys : [src.attribution_key]
  return keys.filter((k) => typeof k === 'string' && k)
}

/**
 * Every source's credit line, once per source shown, in the order the board first shows it. The
 * line is the agency's own required wording (`attributions` in the answer, from the registry's
 * attributions.json) with its blanks filled: {access_date} = the newest day the econ service read
 * that agency's series, {publication_date} = the newest day a figure shown from that agency was
 * released (the EIA asks for it), {data_name} = the series' names, {publisher}, {year}. A source
 * whose line did not come with the answer still gets its name.
 */
export function creditLines(rows, attributions, { today = null, publisher = ECON_PUBLISHER } = {}) {
  const atts = isObj(attributions) ? attributions : {}
  const by = new Map()
  const add = (meta, retrievedAt, releasedAt = null) => {
    const ag = isObj(meta.source) ? str(meta.source.agency) : null
    for (const k of keysOf(meta)) {
      if (!by.has(k)) by.set(k, { key: k, names: [], retrieved: null, published: null, derived: false, agency: null, derivedFrom: null })
      const c = by.get(k)
      const name = str(meta.name)
      if (name && !c.names.includes(name)) c.names.push(name)
      if (Number.isInteger(retrievedAt) && (c.retrieved == null || retrievedAt > c.retrieved)) c.retrieved = retrievedAt
      if (Number.isFinite(releasedAt) && (c.published == null || releasedAt > c.published)) c.published = releasedAt
      if (isObj(meta.derivation)) {
        c.derived = true
        // a UCT calculation names its agency as "UCT (derived from FHFA)": the agency is the part inside
        if (ag && !c.derivedFrom) c.derivedFrom = (/derived from ([^)]+)\)/.exec(ag) || [])[1] || null
      } else if (ag && !c.agency) c.agency = ag
    }
  }
  for (const r of rows) {
    if (r.state !== 'ok') continue
    add(r.meta, r.retrievedAt, isObj(r.latest) ? r.latest.t : null)
    if (r.alt) add(r.alt.meta || {}, null)
  }
  const year = isDay(today) ? today.slice(0, 4) : ''
  return [...by.values()].map((c) => {
    const n = isObj(atts[c.key]) ? atts[c.key] : {}
    const agency = str(n.agency) || c.agency || c.derivedFrom || c.key
    const access = c.retrieved != null ? etDateOf(c.retrieved) : 'a date not held here'
    // 'Nov 18, 2026': the year always, as the EIA's own example carries it ("(Oct 2008)")
    const published = c.published != null ? shortDate(etDateOf(c.published), { nowIso: '0000' }) : 'a date not held here'
    const text = str(n.text)
      ? n.text.replaceAll('{access_date}', access).replaceAll('{publication_date}', published).replaceAll('{data_name}', c.names.join(' and ') || agency)
        .replaceAll('{publisher}', publisher).replaceAll('{year}', year)
      : `Source: ${agency}.`
    return { key: c.key, agency, text, derived: c.derived }
  })
}

/**
 * The route's answer -> the board: `{ state, themes, ahead, credits, newestT, held }`.
 * `state` is 'ok', or 'bad_shape' for an answer that is not the route's shape (drawn as a failed read).
 */
export function economyRead(body, { today = null } = {}) {
  if (!isObj(body) || !Array.isArray(body.series)) return { state: 'bad_shape', themes: [], ahead: [], credits: [], newestT: null, held: 0 }
  const columns = Array.isArray(body.columns) && body.columns.length ? body.columns : COLS
  const bySym = new Map()
  for (const raw of body.series) {
    const s = readSeries(raw)
    if (s && s.symbol && !bySym.has(s.symbol)) bySym.set(s.symbol, s)
  }
  const themes = ECON_THEMES.map((t) => ({
    key: t.key,
    title: t.title,
    missing: t.missing,
    rows: t.rows.map((spec) => boardRow(spec, bySym.get(spec.symbol), { today, columns, alt: spec.alt ? bySym.get(spec.alt) : null })),
  }))
  const rows = themes.flatMap((t) => t.rows)
  const shown = rows.filter((r) => r.state === 'ok')
  const ts = shown.map((r) => r.latest.t).filter(Number.isFinite)
  return {
    state: 'ok',
    themes,
    ahead: releasesAhead(rows, today),
    credits: creditLines(rows, body.attributions, { today }),
    newestT: ts.length ? Math.max(...ts) : null,
    held: shown.length,
    rows: rows.length,
  }
}

/**
 * A failed read in words, for the economy board. The econ routes answer 403 (not 402) to a plan
 * without chart data, and 404 when the economic data is switched off for this server: neither is
 * something Retry can change, and neither is an empty board.
 *   { kind: 'error' | 'locked', state: 'signed_out' | 'plan' | 'off' | 'timeout' | 'error', title, hint, retry }
 */
export function econFailure(err) {
  const status = err?.status
  if (status === 401) return { kind: 'error', state: 'signed_out', title: 'You are signed out, so the economic data cannot be read. Sign in again.', hint: null, retry: true }
  if (status === 402 || status === 403) return { kind: 'locked', state: 'plan', title: 'The economic data needs a paid plan.', hint: null, retry: false }
  if (status === 404) {
    return {
      kind: 'locked', state: 'off', title: 'The economic data is switched off for this server.',
      hint: 'The official releases this board shows (CPI, jobs, GDP, housing, rates) are not served here right now. Nothing is wrong with your account.',
      retry: false,
    }
  }
  if (err?.timedOut) return { kind: 'error', state: 'timeout', title: 'The economic data did not answer within 30 seconds.', hint: null, retry: true }
  return { kind: 'error', state: 'error', title: 'The economic data could not be read just now.', hint: null, retry: true }
}
