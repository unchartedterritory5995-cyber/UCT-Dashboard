// Test fixtures shaped exactly like `/api/econ/catalog` and `/api/econ/series/<SYM>`
// (api/services/econ/publish.py `meta_for` / `build_series_payload`). Synthetic
// values; the SHAPES are the contract.
const src = (agency, key) => ({ agency, dataset: '', provider_series_id: 'X', official_url: '', attribution_key: key, line: `Source: ${agency}` })

export const CATALOG = Object.freeze({
  series: [
    { symbol: 'USCPI', id: 'ECON:USCPI', name: 'CPI-U All Items (SA)', short_name: 'CPI-U All Items (SA)',
      description: 'Consumer price index', category: 'Inflation & Prices', subcategory: 'CPI', frequency: 'M',
      week_anchor: '', units: { display: 'index', fmt: 'num3', scale: 1 }, seasonal_adjustment: 'SA',
      presentation: { style: 'line' }, source: src('U.S. Bureau of Labor Statistics', 'bls'),
      aliases: ['uscpi', 'cusr0000sa0'], synonyms: ['cpi', 'inflation', 'consumer price index'], history_start: '1947-01', max_age_days: 45 },
    { symbol: 'USFEDFUNDSU', id: 'ECON:USFEDFUNDSU', name: 'Fed Funds Target Range - Upper Limit',
      short_name: 'Fed Funds Target Range - Upper Limit', description: '', category: 'Interest Rates', subcategory: 'Policy',
      frequency: 'D', week_anchor: '', units: { display: '%', fmt: 'pct2', scale: 1 }, seasonal_adjustment: 'NSA',
      presentation: { style: 'step' }, source: src('Federal Reserve Bank of New York', 'nyfed'),
      aliases: ['usfedfundsu'], synonyms: ['fed funds target', 'fed rate'], history_start: '2008-12', max_age_days: null },
    { symbol: 'UST10Y', id: 'ECON:UST10Y', name: '10Y Treasury Constant Maturity Yield',
      short_name: '10Y Treasury Constant Maturity Yield', description: '', category: 'Interest Rates', subcategory: 'Treasury',
      frequency: 'D', week_anchor: '', units: { display: '%', fmt: 'pct2', scale: 1 }, seasonal_adjustment: 'NSA',
      presentation: { style: 'line' }, source: src('Board of Governors of the Federal Reserve System', 'fed_board'),
      aliases: ['ust10y', 'riflgfcy10_n.b'], synonyms: ['10 year treasury', '10y yield'], history_start: '1962-01', max_age_days: 10 },
    { symbol: 'USICSA', id: 'ECON:USICSA', name: 'Initial Jobless Claims (SA)', short_name: 'Initial Jobless Claims',
      description: '', category: 'Employment', subcategory: 'Claims', frequency: 'W', week_anchor: 'SAT',
      units: { display: 'count', fmt: 'num0', scale: 1 }, seasonal_adjustment: 'SA', presentation: { style: 'line' },
      source: src('U.S. Department of Labor, ETA', 'dol'), aliases: ['usicsa'], synonyms: ['initial claims', 'jobless claims'],
      history_start: '1967-01', max_age_days: 13 },
    { symbol: 'USRGDPQA', id: 'ECON:USRGDPQA', name: 'Real GDP % chg q/q SAAR (BEA-published)', short_name: 'Real GDP % chg q/q SAAR',
      description: '', category: 'Growth', subcategory: 'GDP', frequency: 'Q', week_anchor: '',
      units: { display: '%', fmt: 'pct1', scale: 1 }, seasonal_adjustment: 'SA', presentation: { style: 'histogram' },
      source: src('U.S. Bureau of Economic Analysis', 'bea'), aliases: ['usrgdpqa', 'a191rl'], synonyms: ['gdp growth', 'real gdp growth'],
      history_start: '1947-04', max_age_days: 120 },
  ],
  attributions: {},
})

export const metaOf = (sym) => CATALOG.series.find((r) => r.symbol === sym)

// 08:30 ET on a date, unix seconds (EDT/EST aware enough for fixtures: Sep = EDT)
export const et0830 = (iso) => Math.floor(Date.parse(`${iso}T12:30:00Z`) / 1000)

/** A monthly CPI-like payload: releases on the 11th of the following month. */
export function cpiPayload({ state = 'CURRENT', nextRelease = { date: '2026-10-14', time: '08:30', tz: 'America/New_York', precision: 'exact' }, asof = null } = {}) {
  const pts = []
  let v = 320
  for (let m = 1; m <= 8; m++) {
    const ps = `2026-${String(m).padStart(2, '0')}-01`
    const last = new Date(Date.UTC(2026, m, 0)).getUTCDate()
    const pe = `2026-${String(m).padStart(2, '0')}-${last}`
    const rel = `2026-${String(m + 1).padStart(2, '0')}-11`
    v += 0.5
    pts.push([et0830(rel), +v.toFixed(3), ps, pe, 'V'])
  }
  return {
    id: 'ECON:USCPI', symbol: 'USCPI', view: asof != null ? 'asof' : 'latest', asof,
    meta: metaOf('USCPI'),
    currentness: asof != null ? { state: null, historical: true }
      : { state, latest_period: '2026-08-01', expected_period: '2026-08-01', next_release: nextRelease },
    columns: ['t', 'v', 'ps', 'pe', 'pit'],
    points: pts,
  }
}
