// OIL test fixtures: GET /api/econ/latest and GET /api/econ/series/{symbol} in their real shapes
// (api/services/econ/serving.py `latest` and `series`). EVERY VALUE, DATE, TIME AND CREDIT LINE HERE IS
// INVENTED. By default the calendar is set in 2031 so nothing can be mistaken for a real report: "today" is
// Thursday 2031-03-20 in New York, the newest EIA week ended Friday 2031-03-14 (out Wednesday 2031-03-19)
// and the newest pump price survey is Monday 2031-03-17 (out Tuesday 2031-03-18). Self-contained (no
// imports), so a preview script can build the same answers around another week.

export const OIL_TODAY = '2031-03-20'
const COLUMNS = ['t', 'v', 'ps', 'pe', 'pit']

const pad2 = (n) => String(n).padStart(2, '0')
const dayMs = (iso) => Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10))
export const addDays = (iso, n) => {
  const d = new Date(dayMs(iso) + n * 86400000)
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`
}
/** Unix seconds for a New York wall time (the offset is fixed at -4h: every time used here is mid-morning or
 *  later, so the New York day is the same in winter). */
const et = (day, hm = '10:30') => Math.floor(Date.parse(`${day}T${hm}:00-04:00`) / 1000)

const EIA = 'U.S. Energy Information Administration'
const units = (display, fmt, scale = 1) => ({ display, fmt, scale })

function meta(symbol, { name, u, anchor = 'FRI', op = null }) {
  return {
    symbol, id: `ECON:${symbol}`, name, short_name: name, description: `${name} (invented).`, category: 'Energy', subcategory: 'Invented',
    frequency: 'W', week_anchor: anchor, units: u, seasonal_adjustment: 'NSA', presentation: { style: op ? 'histogram' : 'line' },
    source: {
      agency: op ? 'UCT (derived from EIA)' : EIA, dataset: op ? 'derived' : 'PET', provider_series_id: null, official_url: null,
      attribution_key: 'eia', line: op ? 'UCT calculation from EIA data' : `Source: ${EIA}`,
    },
    derivation: op ? { op, inputs: ['USCRUDEINV'] } : null,
    aliases: [], synonyms: [], history_start: '1990-01-05', max_age_days: 13,
  }
}

const SPECS = {
  USCRUDEINV: { name: 'Crude Oil Inventories ex SPR', u: units('bbl', 'mbbl', 1000) },
  USCRUDEINVCHG: { name: 'Crude Inventories ex SPR Weekly Change', u: units('bbl', 'mbbl', 1000), op: 'diff' },
  USGASINV: { name: 'Total Motor Gasoline Inventories', u: units('bbl', 'mbbl', 1000) },
  USDISTINV: { name: 'Distillate Fuel Oil Inventories', u: units('bbl', 'mbbl', 1000) },
  USSPR: { name: 'Strategic Petroleum Reserve Stocks', u: units('bbl', 'mbbl', 1000) },
  USCRUDEPROD: { name: 'U.S. Crude Oil Field Production (weekly)', u: units('bbl/d', 'num0', 1000) },
  USREFUTIL: { name: 'Refinery Utilization (% of operable capacity)', u: units('%', 'pct1') },
  USGASPRICE: { name: 'Retail Gasoline Price, Regular (U.S. average)', u: units('USD/gal', 'usd3'), anchor: 'MON' },
  USDIESELPRICE: { name: 'Retail Diesel Price (U.S. average)', u: units('USD/gal', 'usd3'), anchor: 'MON' },
}
export const FIXTURE_SYMBOLS = Object.keys(SPECS)

/** Crude stocks (thousand barrels), oldest first, for `weeks` + 1 weeks ending on the newest week: an invented
 *  wobble between 430,000 and 441,000 with fixed weeks set by hand (index 0 = 104 weeks before the newest). */
const CRUDE_SET = { 104: 431240, 103: 433562, 52: 436080, 70: 452100, 20: 412345 }
/** The week (index) missing from the crude history: a gap in the line. */
export const CRUDE_GAP = 40
function crudeValues(n = 112) {
  // index i here is (n - 1 - 104) + line index; the line's index 0 sits at offset n - 105
  const off = n - 105
  return Array.from({ length: n }, (_, k) => {
    const i = k - off
    if (CRUDE_SET[i] != null) return CRUDE_SET[i]
    return 430000 + ((((i * 37) % 23) + 23) % 23) * 500
  })
}

/** For each other series: [latest, the week before, the same week a year ago (null = not held)] and a filler. */
const LEVELS = {
  USGASINV: [238410, 236920, 241700, 235000],
  USDISTINV: [118960, 120340, 122500, 119000],
  USSPR: [402615, 402180, 395900, 399000],
  USCRUDEPROD: [13812, 13790, 13520, 13650],
  USREFUTIL: [88.4, 87.6, 86.1, 87],
  USGASPRICE: [3.284, 3.312, 3.517, 3.4],
  USDIESELPRICE: [3.957, 3.941, null, 3.9],
}
/** How many weeks of history each series holds (diesel's starts after the year-ago week). */
const HISTORY_WEEKS = { USDIESELPRICE: 40 }

/**
 * Every series' full history (oldest first) as route points, around `week` (the newest EIA week, a Friday)
 * and `pumpWeek` (the newest pump survey, a Monday). The weekly build or draw is the crude history's own
 * difference, as the econ service derives it; a week next to the crude gap has none.
 */
export function oilHistories({ week = '2031-03-14', pumpWeek = '2031-03-17' } = {}) {
  const out = {}
  const crude = crudeValues()
  const n = crude.length
  const crudePts = []
  const changePts = []
  for (let k = 0; k < n; k++) {
    const pe = addDays(week, -7 * (n - 1 - k))
    const i = k - (n - 105)
    if (i === CRUDE_GAP) continue
    const t = et(addDays(pe, 5))
    crudePts.push([t, crude[k], addDays(pe, -6), pe, 'V'])
    if (k > 0 && i - 1 !== CRUDE_GAP) changePts.push([t, crude[k] - crude[k - 1], addDays(pe, -6), pe, 'V'])
  }
  out.USCRUDEINV = crudePts
  out.USCRUDEINVCHG = changePts
  for (const [s, [latest, prior, yearAgo, filler]] of Object.entries(LEVELS)) {
    const pump = SPECS[s].anchor === 'MON'
    const end = pump ? pumpWeek : week
    const count = HISTORY_WEEKS[s] || 60
    const pts = []
    for (let j = count - 1; j >= 0; j--) {
      const pe = addDays(end, -7 * j)
      let v = filler + ((j * 7) % 5) * (pump ? 0.01 : 100)
      if (j === 0) v = latest
      else if (j === 1) v = prior
      else if (j === 52) {
        if (yearAgo == null) continue
        v = yearAgo
      }
      // a pump survey (Monday) is out the next day; the weekly report (week to Friday) the Wednesday after
      pts.push([pump ? et(addDays(pe, 1), '13:00') : et(addDays(pe, 5)), Math.round(v * 1000) / 1000, pump ? pe : addDays(pe, -6), pe, 'V'])
    }
    out[s] = pts
  }
  return out
}

const at = (date, time, precision = 'exact') => ({ date, time, tz: 'America/New_York', precision })

/** The latest read: each series' newest three points, its meta, its currentness and its retrieval time. */
export function oilLatest({ week = '2031-03-14', pumpWeek = '2031-03-17', bySymbol = {}, over = {} } = {}) {
  const hist = oilHistories({ week, pumpWeek })
  const wpsr = at(addDays(week, 12), '10:30')            // the Wednesday after next
  const pumpNext = at(addDays(pumpWeek, 8), '17:00', 'rule')
  const series = FIXTURE_SYMBOLS.map((s) => {
    if (Object.prototype.hasOwnProperty.call(bySymbol, s)) return bySymbol[s]
    const spec = SPECS[s]
    const pts = hist[s].slice(-3)
    return {
      symbol: s,
      state: pts.length ? 'ok' : 'no_data',
      meta: meta(s, spec),
      points: pts,
      currentness: { state: 'CURRENT', latest_period: pts.length ? pts[pts.length - 1][2] : null, expected_period: null, next_release: spec.anchor === 'MON' ? pumpNext : wpsr },
      retrieved_at: spec.op ? null : et(addDays(week, 5), '10:41'),
    }
  }).filter(Boolean)
  return {
    columns: COLUMNS, points_per_series: 3, series,
    attributions: { eia: { agency: EIA, text: 'Invented EIA credit ({publication_date}).', notice_required: true } },
    ...over,
  }
}

/** One series' history read, in the shape `GET /api/econ/series/{symbol}` answers. */
export function oilHistory(symbol, { week = '2031-03-14', pumpWeek = '2031-03-17' } = {}) {
  const spec = SPECS[symbol]
  return {
    id: `ECON:${symbol}`, symbol, columns: COLUMNS, view: 'latest',
    points: oilHistories({ week, pumpWeek })[symbol],
    meta: meta(symbol, spec),
    currentness: { state: 'CURRENT', latest_period: null, expected_period: null, next_release: null },
  }
}
