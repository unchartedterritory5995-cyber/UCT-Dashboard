// FUND test fixtures: invented companies with invented figures, in the routes' real shapes
//   GET /api/fundamentals/pit/series/{SYM}?series=...   (api/services/fundamentals_pit/serving.py series_response)
//   GET /api/bars/{SYM}?tf=W&bars=600                    (weekly closes, Friday-keyed)
// No real company, no real ticker, no real number. The catalog is the server's own (fundCatalogFixture.js).
import { FUND_CATALOG } from './fundCatalogFixture.js'

export { FUND_CATALOG }

/** Saturday Nov 21, 2026, 10:00 in New York: the week of Nov 16 to 20 is closed. */
export const FUND_NOW_MS = Date.UTC(2026, 10, 21, 15, 0, 0)
export const FUND_NOW_SEC = FUND_NOW_MS / 1000
export const FUND_TODAY = '2026-11-21'

const DAY = 86400
const dayMs = (iso) => Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10))
export const plusDays = (iso, n) => new Date(dayMs(iso) + n * DAY * 1000).toISOString().slice(0, 10)
/** 13:00 UTC on a day: 8 or 9 AM in New York, before that day's close. */
export const morningOf = (iso) => dayMs(iso) / 1000 + 13 * 3600

/** Northwind Silicon (invented): fiscal year ends in late January, 14 quarters, filed 24 days after each. */
export const A_ENDS = ['2023-07-30', '2023-10-29', '2024-01-28', '2024-04-28', '2024-07-28', '2024-10-27', '2025-01-26',
  '2025-04-27', '2025-07-27', '2025-10-26', '2026-01-25', '2026-04-26', '2026-07-26', '2026-10-25']
/** Harbor Logic (invented): calendar fiscal year, 13 quarters, filed 35 days after each. */
export const B_ENDS = ['2023-09-30', '2023-12-31', '2024-03-31', '2024-06-30', '2024-09-30', '2024-12-31', '2025-03-31',
  '2025-06-30', '2025-09-30', '2025-12-31', '2026-03-31', '2026-06-30', '2026-09-30']
/** Bluefin Devices (invented): a 52/53-week year ending in early November, 7 quarters, filed 30 days after each. */
export const C_ENDS = ['2025-02-02', '2025-05-04', '2025-08-03', '2025-11-02', '2026-02-01', '2026-05-03', '2026-08-02']

const yearEnd = (pe, month) => +pe.slice(5, 7) === month
/** A filing is public on a business day: a Saturday or Sunday moves to the Monday. */
export const businessDay = (iso) => {
  const dow = new Date(dayMs(iso)).getUTCDay()
  return dow === 6 ? plusDays(iso, 2) : dow === 0 ? plusDays(iso, 1) : iso
}

/** The figures of one invented company, quarter by quarter. */
function buildCompany({ ends, lag, month, rev, margin, shares, extra = () => ({}) }) {
  return ends.map((pe, i) => {
    const r = rev(i)
    const m = margin(i)
    const ni = (r * m) / 100
    return {
      pe, i, t: morningOf(businessDay(plusDays(pe, lag))), method: yearEnd(pe, month) ? 'fiscal_year' : 'ytd_roll',
      revenue_ttm: r, net_income_ttm: ni, eps_diluted_ttm: ni / shares, net_margin_ttm: m,
      revenue_growth_ttm: i >= 4 ? (r / rev(i - 4) - 1) * 100 : null,
      fcf_margin_ttm: m - 2, assets: (100 + 5 * i) * 1e9, shares_outstanding: shares, equity: (40 + 2 * i) * 1e9,
      fcf_ttm: (r * (m - 2)) / 100, roe_ttm: 30 + i / 2,
      ...extra(i),
    }
  })
}

export const COMPANIES = {
  ZQXA: {
    name: 'NORTHWIND SILICON CORP', cik: 9100001, split_status: 'verified', withheld: false,
    rows: buildCompany({ ends: A_ENDS, lag: 24, month: 1, rev: (i) => (40 + 4 * i) * 1e9, margin: (i) => 20 + i, shares: 2.5e9 }),
    /** the newest quarter's filing does not give FCF margin: the server's gap point */
    gaps: { fcf_margin_ttm: ['2026-10-25'] },
    /** a later filing revised revenue TTM for the quarter ended Jul 26, 2026 */
    revisions: { revenue_ttm: { '2026-07-26': { days: 20, v: 88.5e9 } } },
    missing: [],
  },
  ZQXB: {
    name: 'HARBOR LOGIC INC', cik: 9100002, split_status: 'verified', withheld: false,
    rows: buildCompany({ ends: B_ENDS, lag: 35, month: 12, rev: (i) => (10 + 0.5 * i) * 1e9, margin: (i) => (i < 3 ? -5 : 8 + i / 5), shares: 1.2e9 }),
    gaps: {},
    revisions: {},
    /** its filings carry no capex line, so no FCF figures */
    missing: ['fcf_margin_ttm', 'fcf_ttm'],
  },
  ZQXC: {
    name: 'BLUEFIN DEVICES CORP', cik: 9100003, split_status: 'unverified', withheld: true,
    rows: buildCompany({ ends: C_ENDS, lag: 30, month: 11, rev: (i) => (3 + 0.25 * i) * 1e9, margin: () => 12, shares: 0.4e9 }),
    gaps: {},
    revisions: {},
    /** split history unverified: the server builds no split-sensitive series */
    missing: ['eps_diluted_ttm', 'shares_outstanding', 'eps_growth_ttm'],
  },
}

/** One company's points for one stored series, as the server publishes them. */
export function pointsFor(sym, id) {
  const c = COMPANIES[sym]
  if (!c || c.missing.includes(id)) return null
  const out = []
  for (const r of c.rows) {
    const v = r[id]
    if (v === undefined || v === null) continue
    if (id === 'shares_outstanding') { out.push([r.t, v, plusDays(r.pe, 20), 'instant']); continue }
    if ((c.gaps[id] || []).includes(r.pe)) { out.push([r.t, null, r.pe, 'gap']); continue }
    const method = /_ttm$/.test(id) && !/margin|growth|roe/.test(id) ? r.method : 'ratio'
    out.push([r.t, v, r.pe, method])
    const rev = c.revisions[id]?.[r.pe]
    if (rev) out.push([r.t + rev.days * DAY, rev.v, r.pe, method])
  }
  return out.sort((a, b) => a[0] - b[0])
}

/** The series route's answer for a URL: every asked series held, the rest in `missing`. */
export function seriesAnswer(sym, url) {
  const c = COMPANIES[sym]
  const q = new URL(url, 'http://x').searchParams.get('series') || ''
  const ids = q.split(',').filter(Boolean)
  const metrics = {}
  const missing = []
  for (const id of ids) {
    const p = pointsFor(sym, id)
    if (p && p.length) metrics[id] = p
    else missing.push(id)
  }
  return {
    symbol: sym, derivation_version: 4, metrics, missing, cik: c.cik, name: c.name,
    split_status: c.split_status, withheld_split_sensitive: c.withheld, built_at: FUND_NOW_SEC - 3600,
  }
}

/** Every Friday from Jan 6, 2023 to Nov 20, 2026. */
export const FRIDAYS = (() => {
  const out = []
  for (let d = '2023-01-06'; d <= '2026-11-20'; d = plusDays(d, 7)) out.push(d)
  return out
})()
const BAR_BASE = { ZQXA: 100, ZQXB: 30, ZQXC: 12 }
/** The invented weekly close of a company on a Friday. */
export const closeOn = (sym, friday) => BAR_BASE[sym] + 0.25 * FRIDAYS.indexOf(friday)
/** The bars route's weekly answer. */
export function barsAnswer(sym) {
  return { ticker: sym, tf: 'W', bars: FRIDAYS.map((d) => ({ t: d, o: closeOn(sym, d), h: closeOn(sym, d) + 1, l: closeOn(sym, d) - 1, c: closeOn(sym, d), v: 1000000 })) }
}

/**
 * A router for `jsonFetcher`: the catalog, each company's series, its weekly bars. `over` replaces any
 * answer by kind: `{ catalog, series: { SYM: answer | Error }, bars: { SYM: answer | Error } }`; an Error
 * rejects, the symbol PENDING never answers, an unknown symbol answers 404.
 */
export const PENDING = Symbol('pending')
export function fundRouter(over = {}) {
  const fail = (status, extra = {}) => Object.assign(new Error(`http ${status}`), { status }, extra)
  const settle = (v) => (v === PENDING ? new Promise(() => {}) : v instanceof Error ? Promise.reject(v) : Promise.resolve(v))
  return (u) => {
    if (u === '/api/fundamentals/pit/catalog') return settle(over.catalog !== undefined ? over.catalog : FUND_CATALOG)
    let m = /^\/api\/fundamentals\/pit\/series\/([^?]+)\?/.exec(u)
    if (m) {
      const sym = decodeURIComponent(m[1])
      if (over.series && sym in over.series) return settle(over.series[sym])
      return COMPANIES[sym] ? settle(seriesAnswer(sym, u)) : Promise.reject(fail(404))
    }
    m = /^\/api\/bars\/([^?]+)\?tf=W&bars=600$/.exec(u)
    if (m) {
      const sym = decodeURIComponent(m[1])
      if (over.bars && sym in over.bars) return settle(over.bars[sym])
      return BAR_BASE[sym] ? settle(barsAnswer(sym)) : Promise.reject(fail(404))
    }
    return Promise.reject(fail(500))
  }
}
