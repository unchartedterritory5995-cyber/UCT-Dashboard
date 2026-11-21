// LIQ test fixtures: GET /api/econ/latest and GET /api/econ/series/{symbol}?start= in their real shapes
// (api/services/econ/serving.py `latest` and `series`). EVERY VALUE, DATE, TIME AND CREDIT LINE HERE IS
// INVENTED, made by simple formulas so a reader can check each expected number by hand. The calendar is
// set in 2031 so nothing can be mistaken for a real print; "today" is Friday 2031-03-21 in New York, and
// the newest H.4.1 Wednesday is 2031-03-19.
//
// k = weeks before the newest Wednesday (0 = 2031-03-19). In the units each series is stored in:
//   Fed total assets (millions)   7,000,000 + 5,000 k                       (absent for k = 60)
//   TGA, H.4.1 (millions)         820,000 + 7,500 k up to k = 4, then 850,000 + 1,000 (k - 4)  (null for k = 30)
//   reverse repo (dollars)        150e9 + 5e9 k on a Wednesday, 1e9 more on any other weekday
//                                 (no print on the Wednesday of k = 20; none Mon to Wed of k = 40)
//   TGA, daily statement          the week's H.4.1 TGA minus 5,000 (millions), every weekday
//   SOFR (percent)                4.30 + 0.02 k, every weekday
// so net liquidity on the newest Wednesday is 7.000T - 0.820T - 0.150T = $6.03T.
import { historyUrls } from '../liquidityModel'

export const LIQ_TODAY = '2031-03-21'
export const LIQ_NOW_MS = Date.parse('2031-03-21T16:00:00Z')
export const NEWEST_WED = '2031-03-19'
const FIRST_DAY = '2028-12-01'

const DAY = 86400000
const ms = (iso) => Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10))
const pad2 = (n) => String(n).padStart(2, '0')
const iso = (t) => {
  const d = new Date(t)
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`
}
export const plusDays = (d, n) => iso(ms(d) + n * DAY)
const dow = (d) => new Date(ms(d)).getUTCDay()                      // 0 Sunday ... 6 Saturday
/** Unix seconds at `hour`:`min` UTC, `lag` days after `d`. */
const tOf = (d, lag, hour, min = 0) => Math.floor((ms(d) + lag * DAY + (hour * 60 + min) * 60000) / 1000)
const P = (t, v, ps, pe) => [t, v, ps, pe, 'U']
/** Weeks before the newest Wednesday for any day (a Thursday or Friday after it is week 0). */
export const weekOf = (d) => Math.max(0, Math.round((ms(NEWEST_WED) - ms(d)) / (7 * DAY)))

export const assetsAt = (k) => 7000000 + 5000 * k
export const tgaAt = (k) => (k <= 4 ? 820000 + 7500 * k : 850000 + 1000 * (k - 4))
export const rrpAt = (k, wednesday = true) => 150e9 + 5e9 * k + (wednesday ? 0 : 1e9)
const sofrAt = (k) => Math.round((4.30 + 0.02 * k) * 100) / 100

const weekdays = (from, to) => {
  const out = []
  for (let d = from; d <= to; d = plusDays(d, 1)) if (dow(d) >= 1 && dow(d) <= 5) out.push(d)
  return out
}

/** Every point each series holds, oldest first, before any `start` filter. */
export function liqPoints() {
  const weds = []
  for (let k = 115; k >= 0; k--) weds.push([k, plusDays(NEWEST_WED, -7 * k)])
  const weekly = (fn, skip = []) => weds.filter(([k]) => !skip.includes(k))
    .map(([k, pe]) => P(tOf(pe, 1, 21, 30), fn(k), plusDays(pe, -6), pe))
  const rrpHoles = new Set([plusDays(NEWEST_WED, -140)])            // the Wednesday of k = 20
  const k40 = plusDays(NEWEST_WED, -280)
  for (const n of [0, 1, 2]) rrpHoles.add(plusDays(k40, -n))           // Mon to Wed of k = 40
  return {
    USFEDBAL: weekly(assetsAt, [60]),
    USTGAFED: weekly((k) => (k === 30 ? null : tgaAt(k))),
    USRESBAL: [[2, 3100000], [1, 3120000], [0, 3150000]].map(([k, v]) => {
      const pe = plusDays(NEWEST_WED, -7 * k)
      return P(tOf(pe, 1, 21, 30), v, plusDays(pe, -6), pe)
    }),
    USRRP: weekdays(FIRST_DAY, '2031-03-20').filter((d) => !rrpHoles.has(d))
      .map((d) => P(tOf(d, 0, 18, 15), rrpAt(weekOf(d), dow(d) === 3), d, d)),
    USTGA: weekdays(FIRST_DAY, NEWEST_WED).map((d) => P(tOf(d, 1, 21), tgaAt(weekOf(d)) - 5000, d, d)),
    USSOFR: weekdays(FIRST_DAY, '2031-03-20').map((d) => P(tOf(d, 1, 13), sofrAt(weekOf(d)), d, d)),
    USM2: [['2030-11-01', '2030-11-30', 22300.0, '2030-12-24'], ['2030-12-01', '2030-12-31', 22350.5, '2031-01-28'],
      ['2031-01-01', '2031-01-31', 22410.0, '2031-02-25']].map(([ps, pe, v, out]) => P(tOf(out, 0, 18), v, ps, pe)),
    USM2YOY: [['2030-11-01', '2030-11-30', 3.8, '2030-12-24'], ['2030-12-01', '2030-12-31', 3.9, '2031-01-28'],
      ['2031-01-01', '2031-01-31', 4.1, '2031-02-25']].map(([ps, pe, v, out]) => P(tOf(out, 0, 18), v, ps, pe)),
  }
}

const AGENCY = {
  fed_board: 'Board of Governors of the Federal Reserve System',
  nyfed: 'Federal Reserve Bank of New York',
  fiscaldata: 'U.S. Treasury, Bureau of the Fiscal Service',
}
const units = (display, fmt, scale = 1) => ({ display, fmt, scale })
const SPEC = {
  USFEDBAL: { name: 'Fed Total Assets (Balance Sheet)', frequency: 'W', u: units('USD', 'usd_compact', 1000000), src: 'fed_board',
    next: { date: '2031-03-27', time: '16:30', tz: 'America/New_York', precision: 'exact' } },
  USTGAFED: { name: 'Treasury General Account (H.4.1, Wed level)', frequency: 'W', u: units('USD', 'usd_compact', 1000000), src: 'fed_board',
    next: { date: '2031-03-27', time: '16:30', tz: 'America/New_York', precision: 'exact' } },
  USTGA: { name: 'Treasury General Account Closing Balance (DTS)', frequency: 'D', u: units('USD', 'usd_compact', 1000000), src: 'fiscaldata',
    next: { date: '2031-03-21', time: '17:00', tz: 'America/New_York', precision: 'rule' } },
  USRRP: { name: 'ON RRP Facility Take-up', frequency: 'D', u: units('USD', 'usd_compact', 1), src: 'nyfed',
    next: { date: '2031-03-21', time: '14:00', tz: 'America/New_York', precision: 'rule' } },
  USRESBAL: { name: 'Reserve Balances with Federal Reserve Banks', frequency: 'W', u: units('USD', 'usd_compact', 1000000), src: 'fed_board',
    next: { date: '2031-03-27', time: '16:30', tz: 'America/New_York', precision: 'exact' } },
  USM2: { name: 'M2 Money Stock (SA)', frequency: 'M', u: units('USD', 'usd_compact', 1000000000), src: 'fed_board', sa: 'SA',
    next: { date: '2031-03-25', time: '13:00', tz: 'America/New_York', precision: 'exact' } },
  USM2YOY: { name: 'M2 YoY %', frequency: 'M', u: units('%', 'pct1'), src: 'fed_board', op: 'yoy_pct', sa: 'SA-based',
    next: { date: '2031-03-25', time: '13:00', tz: 'America/New_York', precision: 'exact' } },
  USSOFR: { name: 'Secured Overnight Financing Rate', frequency: 'D', u: units('%', 'pct2'), src: 'nyfed',
    next: { date: '2031-03-24', time: '10:00', tz: 'America/New_York', precision: 'rule' } },
}
export const RETRIEVED = { fed_board: 1931640000, nyfed: 1931868000, fiscaldata: 1931800000 }

/** The registry meta the server whitelists (publish.meta_for), with invented descriptions. */
export function liqMeta(symbol) {
  const s = SPEC[symbol]
  return {
    symbol, id: `ECON:${symbol}`, name: s.name, short_name: s.name, description: `${s.name} (invented).`,
    category: 'Money & Liquidity', subcategory: 'Invented', frequency: s.frequency, week_anchor: s.frequency === 'W' ? 'WED' : '',
    units: s.u, seasonal_adjustment: s.sa || 'NSA', presentation: { style: 'line' },
    source: {
      agency: s.op ? 'UCT (derived from Fed H.6)' : AGENCY[s.src], dataset: 'Invented', provider_series_id: null, official_url: null,
      attribution_key: s.src, line: s.op ? 'UCT calculation from Federal Reserve H.6' : `Source: ${AGENCY[s.src]}`,
    },
    derivation: s.op ? { op: s.op, inputs: ['USM2'] } : null,
    aliases: [], synonyms: [], history_start: '2000-01', max_age_days: 45,
  }
}

const currentness = (symbol, points) => ({
  state: 'CURRENT', latest_period: points.length ? points[points.length - 1][2] : null, expected_period: null,
  next_release: SPEC[symbol].next,
})

/** The invented credit lines, with the blanks the real ones carry. */
export const LIQ_ATTRIBUTIONS = {
  fed_board: { agency: AGENCY.fed_board, text: 'Invented Board line.', notice_required: false },
  nyfed: { agency: AGENCY.nyfed, text: 'The {data_name} is invented for {publisher}.', notice_required: true },
  fiscaldata: { agency: AGENCY.fiscaldata, text: 'Invented Fiscal Data line.', notice_required: false },
}

/** `edit` = { symbol: (points) => points } applied to everything a series holds (both routes see it). */
const held = (edit = {}) => {
  const all = liqPoints()
  for (const [s, fn] of Object.entries(edit)) all[s] = fn(all[s])
  return all
}

/** GET /api/econ/latest: the newest three points of each part. `bySymbol` replaces whole rows. */
export function liqLatest({ edit = {}, bySymbol = {}, over = {} } = {}) {
  const all = held(edit)
  const series = Object.keys(SPEC).map((symbol) => {
    if (Object.prototype.hasOwnProperty.call(bySymbol, symbol)) return bySymbol[symbol]
    const pts = all[symbol].slice(-3)
    return {
      symbol, state: pts.length ? 'ok' : 'no_data', meta: liqMeta(symbol), points: pts, currentness: currentness(symbol, all[symbol]),
      retrieved_at: SPEC[symbol].op ? null : RETRIEVED[SPEC[symbol].src],
    }
  }).filter(Boolean)
  return { columns: ['t', 'v', 'ps', 'pe', 'pit'], points_per_series: 3, series, attributions: LIQ_ATTRIBUTIONS, ...over }
}

/** GET /api/econ/series/{symbol}?start=: every point whose period starts on or after `start`. */
export function liqSeries(symbol, start, { edit = {} } = {}) {
  const all = held(edit)
  const points = all[symbol].filter((p) => p[2] >= start)
  return {
    id: `ECON:${symbol}`, symbol, view: 'latest', asof: null, meta: liqMeta(symbol), currentness: currentness(symbol, all[symbol]),
    columns: ['t', 'v', 'ps', 'pe', 'pit'], points,
  }
}

/** Every URL the panel asks on LIQ_TODAY, answered. `edit` reaches both routes; `routes` overrides single URLs. */
export function liqRoutes({ edit = {}, latest = null, routes = {} } = {}) {
  const urls = historyUrls(LIQ_TODAY)
  const out = { '/api/econ/latest?symbols=USFEDBAL,USTGAFED,USTGA,USRRP,USRESBAL,USM2,USM2YOY,USSOFR': latest || liqLatest({ edit }) }
  for (const [symbol, url] of Object.entries(urls)) out[url] = liqSeries(symbol, url.split('start=')[1], { edit })
  return { ...out, ...routes }
}
