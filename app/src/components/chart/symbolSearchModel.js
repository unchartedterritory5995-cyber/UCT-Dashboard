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


// q matches a preset/breadth row by ticker OR name (case-insensitive substring).
export const matchQ = (r, q) => {
  if (!q) return true
  const qu = q.toUpperCase()
  return String(r.ticker || '').includes(qu) || String(r.name || '').toUpperCase().includes(qu)
}


export const TYPE_LABEL = { stock: 'stock', etf: 'ETF', index: 'index', breadth: 'breadth', delisted: 'delisted' }


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
  if (r.breadth) return { exchange: null, badge: { text: 'BREADTH', kind: 'breadth' } }
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
