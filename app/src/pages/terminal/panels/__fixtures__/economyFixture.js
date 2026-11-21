// ECON test fixtures: GET /api/econ/latest in its real shape (api/services/econ/serving.py `latest`).
// EVERY VALUE, DATE, TIME AND CREDIT LINE HERE IS INVENTED. The calendar is set in 2031 so nothing
// can be mistaken for a real print; "today" for these fixtures is Thursday 2031-03-20 in New York.

export const ECON_TODAY = '2031-03-20'
export const RETRIEVED = { bls: 1931776500, bea: 1929966000, census: 1931000400, dol: 1931776320, fed_board: 1931690000, nyfed: 1931700000, fhfa: 1930000000 }

const AGENCY = {
  bls: 'U.S. Bureau of Labor Statistics', bea: 'U.S. Bureau of Economic Analysis', census: 'U.S. Census Bureau',
  dol: 'U.S. Department of Labor, ETA', fed_board: 'Board of Governors of the Federal Reserve System',
  nyfed: 'Federal Reserve Bank of New York', fhfa: 'Federal Housing Finance Agency',
}
const SHORT = { bls: 'BLS', bea: 'BEA', census: 'Census', dol: 'DOL', fed_board: 'Fed Board', nyfed: 'NY Fed', fhfa: 'FHFA' }

const units = (display, fmt, scale = 1) => ({ display, fmt, scale })
const PCT1 = units('%', 'pct1')
const PCT2 = units('%', 'pct2')

/** One series row: the meta the server whitelists, three points at most, currentness, retrieval time. */
export function econSeries(symbol, { name, frequency = 'M', u = PCT1, sa = 'SA', src = 'bls', op = null, points = [], next = null, state = 'CURRENT', retrieved } = {}) {
  return {
    symbol,
    state: points.length ? 'ok' : 'no_data',
    meta: {
      symbol, id: `ECON:${symbol}`, name, short_name: name, description: `${name} (invented).`, category: 'Invented', subcategory: 'Invented',
      frequency, week_anchor: frequency === 'W' ? 'Sat' : '', units: u, seasonal_adjustment: sa, presentation: { style: 'line' },
      source: {
        agency: op ? `UCT (derived from ${SHORT[src]})` : AGENCY[src], dataset: 'Invented', provider_series_id: null, official_url: null,
        attribution_key: src, line: op ? `UCT calculation from ${SHORT[src]} data` : `Source: ${AGENCY[src]}`,
      },
      derivation: op ? { op, inputs: [`${symbol}BASE`] } : null,
      aliases: [], synonyms: [], history_start: '2000-01', max_age_days: 45,
    },
    points,
    currentness: { state, latest_period: points.length ? points[points.length - 1][2] : null, expected_period: null, next_release: next },
    retrieved_at: retrieved === undefined ? (op ? null : RETRIEVED[src]) : retrieved,
  }
}

const at = (date, time = '08:30', precision = 'exact') => ({ date, time, tz: 'America/New_York', precision })
// first-availability times (unix seconds), all invented releases in New York time
const T = {
  jan20: 1926674000, feb12: 1928669400, mar12: 1931085000, jan29: 1927459800, feb27: 1929965400,
  feb07: 1928237400, mar07: 1930656600, mar13: 1931171400, mar20: 1931776200, nov27: 1922012000,
  feb26: 1929879000, feb18: 1929198900, mar17: 1931517000, feb19: 1929282000, mar18: 1931606100,
  feb24: 1929705600, mar11: 1931004000,
}
const p = (t, v, ps, pe) => [t, v, ps, pe, 'V']
const M = (y, m) => [`${y}-${String(m).padStart(2, '0')}-01`, `${y}-${String(m).padStart(2, '0')}-28`]

export function econSeriesList() {
  return [
    econSeries('USCPIYOY', { name: 'CPI YoY %', op: 'yoy_pct', sa: 'NSA-based',
      points: [p(T.jan20, 2.6, ...M(2030, 12)), p(T.feb12, 2.7, ...M(2031, 1)), p(T.mar12, 2.9, ...M(2031, 2))], next: at('2031-04-10') }),
    econSeries('USCPIMOM', { name: 'CPI MoM %', op: 'mom_pct', sa: 'SA-based',
      points: [p(T.feb12, 0.2, ...M(2031, 1)), p(T.mar12, 0.4, ...M(2031, 2))], next: at('2031-04-10') }),
    econSeries('USCORECPIYOY', { name: 'Core CPI YoY %', op: 'yoy_pct', sa: 'NSA-based',
      points: [p(T.feb12, 3.2, ...M(2031, 1)), p(T.mar12, 3.0, ...M(2031, 2))], next: at('2031-04-10') }),
    econSeries('USCORECPIMOM', { name: 'Core CPI MoM %', op: 'mom_pct', sa: 'SA-based',
      points: [p(T.mar12, 0.2, ...M(2031, 2))], next: at('2031-04-10') }),
    econSeries('USPCEPIYOY', { name: 'PCE Price Index YoY %', op: 'yoy_pct', src: 'bea', sa: 'SA-based',
      points: [p(T.jan29, 2.3, ...M(2030, 12)), p(T.feb27, 2.4, ...M(2031, 1))], next: at('2031-03-26') }),
    econSeries('USPCEPIMOM', { name: 'PCE Price Index MoM %', op: 'mom_pct', src: 'bea', sa: 'SA-based',
      points: [p(T.feb27, 0.3, ...M(2031, 1))], next: at('2031-03-26') }),
    econSeries('USCOREPCEYOY', { name: 'Core PCE YoY %', op: 'yoy_pct', src: 'bea', sa: 'SA-based',
      points: [p(T.jan29, 2.6, ...M(2030, 12)), p(T.feb27, 2.5, ...M(2031, 1))], next: at('2031-03-26') }),
    econSeries('USCOREPCEMOM', { name: 'Core PCE MoM %', op: 'mom_pct', src: 'bea', sa: 'SA-based',
      points: [p(T.feb27, 0.2, ...M(2031, 1))], next: at('2031-03-26') }),
    econSeries('USPPIYOY', { name: 'PPI Final Demand YoY %', op: 'yoy_pct', sa: 'NSA-based',
      points: [p(T.feb12, 2.1, ...M(2031, 1)), p(T.mar13, 1.8, ...M(2031, 2))], next: at('2031-03-28') }),
    econSeries('USPPIMOM', { name: 'PPI Final Demand MoM %', op: 'mom_pct', sa: 'SA-based', points: [], next: at('2031-03-28') }),
    econSeries('USNFPCHG', { name: 'Nonfarm Payrolls Monthly Change', op: 'diff', u: units('persons', 'k_persons', 1000),
      points: [p(T.feb07, 143, ...M(2031, 1)), p(T.mar07, 151, ...M(2031, 2))], next: at('2031-04-04') }),
    econSeries('USUNRATE', { name: 'Unemployment Rate',
      points: [p(T.feb07, 4.3, ...M(2031, 1)), p(T.mar07, 4.4, ...M(2031, 2))], next: at('2031-04-04') }),
    econSeries('USICSA', { name: 'Initial Jobless Claims', frequency: 'W (week ending Saturday)', u: units('count', 'num0'), src: 'dol',
      points: [p(T.mar13, 221000, '2031-03-02', '2031-03-08'), p(T.mar20, 214000, '2031-03-09', '2031-03-15')], next: at('2031-03-27') }),
    econSeries('USAHEYOY', { name: 'Avg Hourly Earnings YoY %', op: 'yoy_pct', sa: 'SA-based',
      points: [p(T.feb07, 3.9, ...M(2031, 1)), p(T.mar07, 3.8, ...M(2031, 2))], next: at('2031-04-04') }),
    econSeries('USJOLTSO', { name: 'JOLTS Job Openings', u: units('persons', 'k_persons', 1000),
      points: [p(T.feb18, 7412, ...M(2030, 12)), p(T.mar11, 7256, ...M(2031, 1))], next: at('2031-04-01', '10:00') }),
    econSeries('USRGDPQA', { name: 'Real GDP % chg q/q SAAR', frequency: 'Q', sa: 'SAAR', src: 'bea',
      points: [p(T.nov27, 3.1, '2030-07-01', '2030-09-30'), p(T.feb26, 2.4, '2030-10-01', '2030-12-31')], next: at('2031-03-27') }),
    econSeries('USINDPRO', { name: 'Industrial Production Index, Total', u: units('index', 'num1'), src: 'fed_board',
      points: [p(T.feb19, 103.4, ...M(2031, 1)), p(T.mar17, 103.9, ...M(2031, 2))], next: at('2031-04-16', '09:15') }),
    econSeries('USPERSINC', { name: 'Personal Income', u: units('USD', 'usd_compact', 1000000), sa: 'SAAR', src: 'bea',
      points: [p(T.jan29, 25412300, ...M(2030, 12)), p(T.feb27, 25498100, ...M(2031, 1))], next: at('2031-03-26') }),
    econSeries('USPCE', { name: 'Personal Consumption Expenditures', u: units('USD', 'usd_compact', 1000000), sa: 'SAAR', src: 'bea',
      points: [p(T.jan29, 20113400, ...M(2030, 12)), p(T.feb27, 20197600, ...M(2031, 1))], next: at('2031-03-26') }),
    econSeries('USHOUST', { name: 'Housing Starts, Total', u: units('units', 'num0', 1000), sa: 'SAAR', src: 'census',
      points: [p(T.feb19, 1402, ...M(2031, 1)), p(T.mar18, 1355, ...M(2031, 2))], next: at('2031-04-17') }),
    econSeries('USPERMIT', { name: 'Building Permits, Total', u: units('units', 'num0', 1000), sa: 'SAAR', src: 'census',
      points: [p(T.feb19, 1451, ...M(2031, 1)), p(T.mar18, 1468, ...M(2031, 2))], next: at('2031-04-17') }),
    econSeries('USNEWHOME', { name: 'New Home Sales', u: units('units', 'num0', 1000), sa: 'SAAR', src: 'census',
      points: [], next: at('2031-03-25', '10:00') }),
    econSeries('USFHFAHPIYOY', { name: 'FHFA HPI YoY %', op: 'yoy_pct', src: 'fhfa', sa: 'SA-based',
      points: [p(T.jan29, 4.1, ...M(2030, 11)), p(T.feb24, 3.8, ...M(2030, 12))], next: at('2031-03-25', '09:00', 'rule') }),
    econSeries('USEFFR', { name: 'Effective Federal Funds Rate', frequency: 'D', u: PCT2, sa: 'NSA', src: 'nyfed',
      points: [p(T.mar17, 3.58, '2031-03-17', '2031-03-17'), p(T.mar18, 3.58, '2031-03-18', '2031-03-18')], next: at('2031-03-21', '09:00') }),
    econSeries('UST10Y', { name: '10Y Treasury Constant Maturity Yield', frequency: 'D', u: PCT2, sa: 'NSA', src: 'fed_board',
      points: [p(T.mar17, 4.21, '2031-03-17', '2031-03-17'), p(T.mar18, 4.17, '2031-03-18', '2031-03-18')], next: at('2031-03-21', '16:15') }),
    // daily figures, published once a week (Monday) for the week before
    econSeries('USDOLLARIDX', { name: 'Nominal Broad U.S. Dollar Index', frequency: 'D', u: units('index', 'num1'), sa: 'NSA', src: 'fed_board',
      points: [p(T.mar17, 121.4, '2031-03-13', '2031-03-13'), p(T.mar17, 121.2, '2031-03-14', '2031-03-14')], next: at('2031-03-24', '16:15') }),
  ]
}

/** The credit lines, invented, with the blanks the real ones carry. */
export const ECON_ATTRIBUTIONS = {
  bls: { agency: AGENCY.bls, text: 'Invented BLS line, read on {access_date}.', notice_required: true, access_date_required: true },
  bea: { agency: AGENCY.bea, text: 'Invented BEA line.', notice_required: true },
  census: { agency: AGENCY.census, text: 'Invented Census line.', notice_required: true },
  dol: { agency: 'U.S. Department of Labor', text: 'Invented Labor line.', notice_required: false },
  fed_board: { agency: AGENCY.fed_board, text: 'Invented Board line.', notice_required: false },
  nyfed: { agency: AGENCY.nyfed, text: 'The {data_name} is invented for {publisher}.', notice_required: true },
  fhfa: { agency: AGENCY.fhfa, text: 'Invented FHFA line.', notice_required: true },
}

/** The whole answer, with `over` replacing top-level keys and `bySymbol` replacing single rows. */
export function econAnswer({ over = {}, bySymbol = {} } = {}) {
  const series = econSeriesList().map((s) => (Object.prototype.hasOwnProperty.call(bySymbol, s.symbol) ? bySymbol[s.symbol] : s)).filter(Boolean)
  return { columns: ['t', 'v', 'ps', 'pe', 'pit'], points_per_series: 3, series, attributions: ECON_ATTRIBUTIONS, ...over }
}
