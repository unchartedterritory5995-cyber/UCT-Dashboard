/* What a symbol-search ROW means — shared by the desktop dropdown and the phone
 * sheet, so the two surfaces can never disagree about how a symbol is identified.
 *
 * ⛔ THE DEFECT THIS CLOSES. `/api/ticker-search` has long returned a rich row —
 * `{ticker, name, type, exchange, entity_id, breadth, group_label, delisted,
 * delisted_date}` — and the desktop dropdown renders all of it: an exchange, a
 * type badge, a BREADTH badge, and "Delisted 2016". The PHONE sheet consumed the
 * same endpoint and rendered a logo, a ticker and a name, THROWING THE REST AWAY
 * AT THE DOOR. So on a phone:
 *   · a delisted ticker looked exactly like a live one — you tap it and get a
 *     dead chart, with nothing on screen having warned you,
 *   · an ETF was indistinguishable from the operating company,
 *   · a UCT breadth pseudo-ticker (UCTA50) read as a company,
 *   · and the category filter the API already supports had no phone control.
 * Nothing was missing from the product. It was discarded in presentation, which
 * is the failure mode that survives longest because every layer looks correct.
 *
 * ⭐ SO THE DISAMBIGUATION IS COMPUTED ONCE, HERE, and both surfaces render the
 * same answer. A second copy would drift on the first new instrument type.
 */

// Exported: the phone symbol sheet (pages/charts/mobile) shows the same list,
// so the two surfaces can never drift on what "popular" means.
export const POPULAR_RESULTS = [
  { ticker: 'SPY',   name: 'SPDR S&P 500 ETF Trust', type: 'etf' },
  { ticker: 'QQQ',   name: 'Invesco QQQ Trust', type: 'etf' },
  { ticker: 'AAPL',  name: 'Apple Inc.', type: 'stock' },
  { ticker: 'MSFT',  name: 'Microsoft Corp.', type: 'stock' },
  { ticker: 'NVDA',  name: 'NVIDIA Corp.', type: 'stock' },
  { ticker: 'AMZN',  name: 'Amazon.com Inc.', type: 'stock' },
  { ticker: 'GOOGL', name: 'Alphabet Inc. Class A', type: 'stock' },
  { ticker: 'META',  name: 'Meta Platforms Inc.', type: 'stock' },
  { ticker: 'TSLA',  name: 'Tesla Inc.', type: 'stock' },
  { ticker: 'AMD',   name: 'Advanced Micro Devices', type: 'stock' },
  { ticker: 'AVGO',  name: 'Broadcom Inc.', type: 'stock' },
  { ticker: 'NFLX',  name: 'Netflix Inc.', type: 'stock' },
  { ticker: 'CRM',   name: 'Salesforce Inc.', type: 'stock' },
  { ticker: 'COST',  name: 'Costco Wholesale Corp.', type: 'stock' },
  { ticker: 'LLY',   name: 'Eli Lilly & Co.', type: 'stock' },
  { ticker: 'PLTR',  name: 'Palantir Technologies', type: 'stock' },
  { ticker: 'SMCI',  name: 'Super Micro Computer', type: 'stock' },
  { ticker: 'MSTR',  name: 'MicroStrategy Inc.', type: 'stock' },
  { ticker: 'COIN',  name: 'Coinbase Global', type: 'stock' },
  { ticker: 'SNOW',  name: 'Snowflake Inc.', type: 'stock' },
  { ticker: 'IWM',   name: 'iShares Russell 2000 ETF', type: 'etf' },
  { ticker: 'DIA',   name: 'SPDR Dow Jones Industrial', type: 'etf' },
  { ticker: 'XLF',   name: 'Financial Select Sector SPDR', type: 'etf' },
  { ticker: 'XLE',   name: 'Energy Select Sector SPDR', type: 'etf' },
  { ticker: 'XLK',   name: 'Technology Select Sector SPDR', type: 'etf' },
  { ticker: 'XLV',   name: 'Health Care Select Sector SPDR', type: 'etf' },
  { ticker: 'GLD',   name: 'SPDR Gold Trust', type: 'etf' },
  { ticker: 'TLT',   name: 'iShares 20+ Year Treasury', type: 'etf' },
  { ticker: 'ARKK',  name: 'ARK Innovation ETF', type: 'etf' },
  { ticker: 'SOXX',  name: 'iShares Semiconductor ETF', type: 'etf' },
]


// Category chips → the `type` query param the backend filters on. 'all' = no filter.
export const CHIPS = [
  { key: 'all', label: 'All', type: '' },
  { key: 'stock', label: 'Stocks', type: 'stock' },
  { key: 'etf', label: 'ETFs', type: 'etf' },
  { key: 'index', label: 'Indices', type: 'index' },
  { key: 'breadth', label: 'Breadth', type: 'breadth' },
]


// The exact indices our charts render (api/index_bars.py INDEX_MAP). This IS the
// full "Indices" universe, so the chip is served client-side from this list — both
// the empty-state preload and searches filter it (no backend round-trip needed).
export const INDICES_PRESET = [
  { ticker: 'SPX', name: 'S&P 500 Index', type: 'index' },
  { ticker: 'NDX', name: 'Nasdaq 100 Index', type: 'index' },
  { ticker: 'DJX', name: 'Dow Jones Industrial Average', type: 'index' },
  { ticker: 'RUT', name: 'Russell 2000 Index', type: 'index' },
  { ticker: 'VIX', name: 'CBOE Volatility Index', type: 'index' },
  { ticker: 'XSP', name: 'Mini S&P 500 Index', type: 'index' },
  { ticker: 'XND', name: 'Micro Nasdaq 100 Index', type: 'index' },
]


// q matches a preset/breadth row by ticker, the ticker it SHOWS (`UCT:A50`), an
// explicit alias (`$NYMO`, `NYSE:MCO`) or its name (case-insensitive substring).
export const matchQ = (r, q) => {
  if (!q) return true
  const qu = q.toUpperCase()
  if (String(r.ticker || '').includes(qu) || String(r.name || '').toUpperCase().includes(qu)) return true
  if (r.display_ticker && String(r.display_ticker).toUpperCase().includes(qu)) return true
  return Array.isArray(r.aliases) && r.aliases.some((a) => String(a || '').toUpperCase() === qu)
}

/** The ticker a row SHOWS. ⭐ `ticker` stays the canonical identity the row submits
 *  (`UCTA50` — what every saved chart, watchlist and layout holds); `display_ticker`
 *  is the member-facing spelling (`UCT:A50`) when the server sent one. */
export const shownTicker = (r) => (r && (r.display_ticker || r.ticker)) || ''


// ─── THE BREADTH CATEGORY ────────────────────────────────────────────────────
//
// ⭐⭐ ONE LIST, TWO CATALOGUES, BUILT HERE ONCE for the desktop dropdown and the phone
// sheet. `/api/breadth-symbols` carries the UCT pseudo-tickers and the published
// US / NYSE / Nasdaq library (`% Above 50-Day MA`…); `/api/market-indicators` carries the
// breadth-DERIVED series (McClellan Oscillator / Summation, A/D Line, Zweig, A/D ratios,
// High-Low Index — NYMO, NASI, NYAD…). Both are breadth, and before 2026-10-07 the second
// half was missing from this chip entirely and rendered as a generic "indicator" row with a
// company-logo lookup in "All".
//
// ⛔ PRESENTATION ONLY. No identity is minted or rewritten here: every row submits the
// symbol its own registry gave it.

/** Universe prose (mirrors `market_indicators.naming.UNIVERSE_DISPLAY`). */
const BREADTH_UNIVERSE_LABEL = { uct: 'UCT', us: 'US', nyse: 'NYSE', nasdaq: 'Nasdaq' }
const BREADTH_UNIVERSE_ORDER = ['uct', 'us', 'nyse', 'nasdaq']

/** Is a market-indicator catalogue / search row a BREADTH series? Breadth-derived (computed
 *  from UCT's own advancing/declining/highs/lows), a single series, not a product.
 *  ⛔ Surveys (NAAIM, AAII), Cboe volatility and COT are not breadth. */
export function isBreadthIndicatorRow(r) {
  if (!r || r.kind === 'product') return false
  if (r.source_type) return r.source_type === 'breadth_derived' && r.catalogue !== 'breadth_library'
  // A `/api/ticker-search` indicator row carries the family, not the source type.
  return r.indicator === true && (r.family === 'mcclellan' || r.family === 'breadth')
}

/** Does this search row get the UCT mark + BREADTH badge? */
export const isBreadthRow = (r) => !!r && (r.breadth === true || isBreadthIndicatorRow(r))

/**
 * The Breadth chip's full list, in catalogue order: UCT (its pseudo-tickers, by group),
 * then for each published universe its breadth-derived series (McClellan, A/D…) followed
 * by its library metrics.
 *
 * @param {object[]} symbols    `/api/breadth-symbols` → `symbols`
 * @param {object}   displayMap `/api/breadth-symbols` → `display_symbols`
 * @param {object[]} indicators `/api/market-indicators` → `rows` (any rows; filtered here)
 */
export function breadthChipRows(symbols, displayMap, indicators) {
  const dm = displayMap && typeof displayMap === 'object' ? displayMap : {}
  const byUni = new Map(BREADTH_UNIVERSE_ORDER.map((u) => [u, { ind: [], lib: [] }]))
  const bucket = (u) => {
    const k = String(u || 'uct').toLowerCase()
    if (!byUni.has(k)) byUni.set(k, { ind: [], lib: [] })
    return byUni.get(k)
  }
  const seen = new Set()
  for (const s of Array.isArray(symbols) ? symbols : []) {
    const ticker = String(s.symbol || '').toUpperCase()
    if (!ticker || seen.has(ticker)) continue
    seen.add(ticker)
    const uni = s.universe ? String(s.universe).toLowerCase() : 'uct'
    const name = s.name || s.label || ''
    // A namespaced library row says WHICH population — `US · % of Stocks Above 50-Day MA` —
    // the same `Universe · Metric` sentence the McClellan rows beside it carry. UCT rows keep
    // their shipped names (their ticker already says UCT).
    const ul = uni !== 'uct' ? (BREADTH_UNIVERSE_LABEL[uni] || s.universe_label || '') : ''
    bucket(uni).lib.push({
      ticker,
      display_ticker: dm[ticker] || null,
      name: ul && name ? `${ul} · ${name}` : name,
      type: 'breadth', breadth: true, group_label: s.group_label || s.group,
    })
  }
  for (const r of Array.isArray(indicators) ? indicators : []) {
    if (!isBreadthIndicatorRow(r) || r.status === 'dormant') continue
    const ticker = String(r.symbol || r.id || '').toUpperCase()
    if (!ticker || seen.has(ticker)) continue
    seen.add(ticker)
    bucket(r.universe).ind.push({
      ticker,
      name: r.display || r.short || ticker,
      type: 'breadth', breadth: true, indicator: true,
      group_label: r.family_label || 'Breadth',
      aliases: [r.id, ...(Array.isArray(r.aliases) ? r.aliases : [])].filter(Boolean),
    })
  }
  const out = []
  for (const { ind, lib } of byUni.values()) out.push(...ind, ...lib)
  return out
}

/**
 * The canonical ticker for what the member TYPED. `UCT:A50` (the member-facing spelling)
 * submits `UCTA50`, so the chart opens on the identity its registries key on rather than
 * on a spelling the client's breadth family map does not hold. Anything else is returned
 * unchanged — this never invents an identity.
 */
export function canonicalTicker(typed, breadthRows) {
  const t = String(typed || '').trim().toUpperCase()
  if (!t) return t
  for (const r of Array.isArray(breadthRows) ? breadthRows : []) {
    if (r && r.display_ticker && String(r.display_ticker).toUpperCase() === t) return r.ticker
  }
  return t
}


// ⚠️ NO `economic` CHIP HERE, ON PURPOSE: it is appended by the lazily-loaded
// `economic/econSearch` module, and only for a member `/api/econ/catalog` answers
// 200 — so a dark deploy renders exactly these five. `economic` below is only the
// LABEL for a row the server already decided this member may see.
export const TYPE_LABEL = { stock: 'stock', etf: 'ETF', index: 'index', breadth: 'breadth', delisted: 'delisted', economic: 'Economic' }


/**
 * How a row identifies itself, beyond its ticker and name.
 *
 * Returns `{ exchange, badge }` where `badge` is `{ text, kind }` or null.
 * ⛔ THE ORDER OF THE BRANCHES IS THE MEANING. "Delisted" outranks everything —
 * it is the one label that changes whether you should tap the row at all, and it
 * must never be hidden behind a type badge. Breadth comes next because a UCT
 * pseudo-ticker is not an instrument. A plain STOCK is deliberately left
 * unbadged: it is the default, and badging every row makes the exceptional ones
 * stop standing out — but its EXCHANGE is shown, because that is what actually
 * disambiguates one stock from another.
 */
export function rowIdentity(r, { badgeStock = false } = {}) {
  if (!r) return { exchange: null, badge: null }
  if (r.delisted) {
    const yr = r.delisted_date ? ` ${String(r.delisted_date).slice(0, 4)}` : ''
    return { exchange: null, badge: { text: `Delisted${yr}`, kind: 'delisted' } }
  }
  if (isBreadthRow(r)) return { exchange: null, badge: { text: 'BREADTH', kind: 'breadth' } }
  // An economic series is not an instrument: no exchange, one label.
  if (r.economic) return { exchange: null, badge: { text: 'Economic', kind: 'economic' } }
  const exchange = r.exchange || null
  if (r.type && r.type !== 'stock') {
    return { exchange, badge: { text: TYPE_LABEL[r.type] || r.type, kind: r.type } }
  }
  // `badgeStock` is the ONE deliberate difference between the two surfaces, and
  // it is a parameter rather than a second implementation: the desktop dropdown
  // has the width to label every row and always has, the phone row does not.
  if (badgeStock && r.type) return { exchange, badge: { text: TYPE_LABEL[r.type] || r.type, kind: r.type } }
  return { exchange, badge: null }
}
