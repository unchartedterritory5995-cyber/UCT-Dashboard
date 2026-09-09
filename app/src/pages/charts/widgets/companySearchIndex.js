/**
 * Company Intelligence search — the central, extensible index of everything the
 * Company panel can show, plus lightweight ranking + match-highlighting. Adding a
 * searchable metric later = append one entry here (no other change).
 *
 * Each entry:
 *   id        stable id
 *   name      display name
 *   aliases   short forms / synonyms users might type (PE, FCF, ROIC…)
 *   category  result-group label
 *   tab       destination company tab (overview | financials | earnings | valuation)
 *   stmt      (financials only) which statement to open (income|balance|cashflow)
 *   row       (optional) metric key to scroll-to + briefly highlight at the target
 *   hint      breadcrumb shown beside the result (e.g. "Financials → Cash Flow")
 */

export const SEARCH_INDEX = [
  // ── Tabs / sections ────────────────────────────────────────────────────────
  { id: 'overview', name: 'Overview', aliases: ['summary', 'snapshot'], category: 'Sections', tab: 'overview', hint: 'Overview' },
  { id: 'financials', name: 'Financial Statements', aliases: ['financials', 'statements'], category: 'Sections', tab: 'financials', hint: 'Financials' },
  { id: 'income-stmt', name: 'Income Statement', aliases: ['income', 'p&l', 'profit and loss'], category: 'Sections', tab: 'financials', stmt: 'income', hint: 'Financials → Income' },
  { id: 'balance-sheet', name: 'Balance Sheet', aliases: ['balance', 'assets', 'liabilities'], category: 'Sections', tab: 'financials', stmt: 'balance', hint: 'Financials → Balance' },
  { id: 'cash-flow-stmt', name: 'Cash Flow Statement', aliases: ['cash flow', 'cashflow'], category: 'Sections', tab: 'financials', stmt: 'cashflow', hint: 'Financials → Cash Flow' },
  { id: 'inst-own', name: 'Institutional Ownership', aliases: ['institutions', '13f', 'funds', 'institutional'], category: 'Ownership', tab: 'ownership', hint: 'Ownership' },
  { id: 'top-holders', name: 'Top Holders', aliases: ['holders', 'shareholders', 'biggest holders', 'vanguard', 'blackrock'], category: 'Ownership', tab: 'ownership', hint: 'Ownership' },
  { id: 'insider-activity', name: 'Insider Activity', aliases: ['insiders', 'insider buying', 'insider selling', 'form 4'], category: 'Ownership', tab: 'ownership', hint: 'Ownership' },
  { id: 'short-interest', name: 'Short Interest', aliases: ['short', 'short float', 'days to cover', 'shorted'], category: 'Ownership', tab: 'ownership', hint: 'Ownership' },
  { id: 'float-shares', name: 'Float', aliases: ['float', 'shares outstanding', 'supply'], category: 'Ownership', tab: 'ownership', hint: 'Ownership' },
  { id: 'earnings-hist', name: 'Earnings History', aliases: ['earnings', 'eps history', 'quarters'], category: 'Sections', tab: 'earnings', hint: 'Earnings' },
  { id: 'valuation', name: 'Valuation', aliases: ['valuation', 'multiples'], category: 'Sections', tab: 'overview', hint: 'Overview → Valuation' },

  // ── Income statement ────────────────────────────────────────────────────────
  { id: 'revenue', name: 'Revenue', aliases: ['sales', 'top line', 'turnover'], category: 'Income Statement', tab: 'financials', stmt: 'income', row: 'revenue', hint: 'Financials → Income' },
  { id: 'gross-profit', name: 'Gross Profit', aliases: [], category: 'Income Statement', tab: 'financials', stmt: 'income', row: 'gross_profit', hint: 'Financials → Income' },
  { id: 'gross-margin', name: 'Gross Margin', aliases: ['margin'], category: 'Income Statement', tab: 'financials', stmt: 'income', row: 'gross_margin', hint: 'Financials → Income' },
  { id: 'operating-income', name: 'Operating Income', aliases: ['operating profit', 'ebit'], category: 'Income Statement', tab: 'financials', stmt: 'income', row: 'operating_income', hint: 'Financials → Income' },
  { id: 'operating-margin', name: 'Operating Margin', aliases: ['op margin'], category: 'Income Statement', tab: 'financials', stmt: 'income', row: 'operating_margin', hint: 'Financials → Income' },
  { id: 'ebitda', name: 'EBITDA', aliases: ['ebitda'], category: 'Income Statement', tab: 'financials', stmt: 'income', row: 'ebitda', hint: 'Financials → Income' },
  { id: 'net-income', name: 'Net Income', aliases: ['earnings', 'profit', 'bottom line'], category: 'Income Statement', tab: 'financials', stmt: 'income', row: 'net_income', hint: 'Financials → Income' },
  { id: 'net-margin', name: 'Net Margin', aliases: ['profit margin', 'net profit margin'], category: 'Income Statement', tab: 'financials', stmt: 'income', row: 'net_margin', hint: 'Financials → Income' },
  { id: 'eps-diluted', name: 'Diluted EPS', aliases: ['eps', 'earnings per share'], category: 'Income Statement', tab: 'financials', stmt: 'income', row: 'eps_diluted', hint: 'Financials → Income' },
  { id: 'rnd', name: 'R&D', aliases: ['research and development', 'research'], category: 'Income Statement', tab: 'financials', stmt: 'income', row: 'rnd', hint: 'Financials → Income' },

  // ── Balance sheet ───────────────────────────────────────────────────────────
  { id: 'cash', name: 'Cash & Equivalents', aliases: ['cash'], category: 'Balance Sheet', tab: 'financials', stmt: 'balance', row: 'cash', hint: 'Financials → Balance' },
  { id: 'total-assets', name: 'Total Assets', aliases: ['assets'], category: 'Balance Sheet', tab: 'financials', stmt: 'balance', row: 'total_assets', hint: 'Financials → Balance' },
  { id: 'total-debt', name: 'Total Debt', aliases: ['debt', 'borrowings'], category: 'Balance Sheet', tab: 'financials', stmt: 'balance', row: 'total_debt', hint: 'Financials → Balance' },
  { id: 'net-debt', name: 'Net Debt', aliases: ['net debt'], category: 'Balance Sheet', tab: 'financials', stmt: 'balance', row: 'net_debt', hint: 'Financials → Balance' },
  { id: 'equity', name: "Shareholders' Equity", aliases: ['equity', 'book value'], category: 'Balance Sheet', tab: 'financials', stmt: 'balance', row: 'equity', hint: 'Financials → Balance' },
  { id: 'working-capital', name: 'Working Capital', aliases: [], category: 'Balance Sheet', tab: 'financials', stmt: 'balance', row: 'working_capital', hint: 'Financials → Balance' },
  { id: 'shares-out', name: 'Shares Outstanding', aliases: ['dilution', 'share count'], category: 'Balance Sheet', tab: 'financials', stmt: 'balance', row: 'shares_outstanding', hint: 'Financials → Balance' },

  // ── Cash flow ───────────────────────────────────────────────────────────────
  { id: 'operating-cf', name: 'Operating Cash Flow', aliases: ['ocf', 'cash from operations'], category: 'Cash Flow', tab: 'financials', stmt: 'cashflow', row: 'operating_cf', hint: 'Financials → Cash Flow' },
  { id: 'fcf', name: 'Free Cash Flow', aliases: ['fcf', 'free cashflow'], category: 'Cash Flow', tab: 'financials', stmt: 'cashflow', row: 'free_cash_flow', hint: 'Financials → Cash Flow' },
  { id: 'capex', name: 'Capital Expenditures', aliases: ['capex'], category: 'Cash Flow', tab: 'financials', stmt: 'cashflow', row: 'capex', hint: 'Financials → Cash Flow' },
  { id: 'buybacks', name: 'Share Buybacks', aliases: ['repurchases', 'buyback'], category: 'Cash Flow', tab: 'financials', stmt: 'cashflow', row: 'buybacks', hint: 'Financials → Cash Flow' },
  { id: 'dividends-paid', name: 'Dividends Paid', aliases: ['dividend'], category: 'Cash Flow', tab: 'financials', stmt: 'cashflow', row: 'dividends_paid', hint: 'Financials → Cash Flow' },

  // ── Profitability / growth / health (Overview) ──────────────────────────────
  { id: 'roe', name: 'Return on Equity', aliases: ['roe'], category: 'Profitability', tab: 'overview', row: 'roe', hint: 'Overview → Profitability' },
  { id: 'roa', name: 'Return on Assets', aliases: ['roa'], category: 'Profitability', tab: 'overview', row: 'roa', hint: 'Overview → Profitability' },
  { id: 'ov-fcf', name: 'Free Cash Flow (TTM)', aliases: ['fcf'], category: 'Profitability', tab: 'overview', row: 'FCF', hint: 'Overview → Profitability' },
  { id: 'rev-growth', name: 'Revenue Growth', aliases: ['revenue growth', 'sales growth'], category: 'Growth', tab: 'overview', row: 'Rev Gr. YoY', hint: 'Overview → Growth' },
  { id: 'eps-growth', name: 'EPS Growth', aliases: ['earnings growth', 'eps growth'], category: 'Growth', tab: 'overview', row: 'EPS YoY', hint: 'Overview → Growth' },
  { id: 'debt-equity', name: 'Debt / Equity', aliases: ['leverage', 'd/e'], category: 'Financial Health', tab: 'overview', row: 'Debt/Equity', hint: 'Overview → Financial Health' },
  { id: 'current-ratio', name: 'Current Ratio', aliases: ['liquidity'], category: 'Financial Health', tab: 'overview', row: 'Current Ratio', hint: 'Overview → Financial Health' },
  { id: 'short-float', name: 'Short Float', aliases: ['short interest'], category: 'Financial Health', tab: 'overview', row: 'Short Float', hint: 'Overview → Financial Health' },
  { id: 'inst-own', name: 'Institutional Ownership', aliases: ['ownership'], category: 'Financial Health', tab: 'overview', row: 'Inst. Own', hint: 'Overview → Financial Health' },

  // ── Valuation ───────────────────────────────────────────────────────────────
  { id: 'pe', name: 'P/E Ratio', aliases: ['pe', 'price earnings', 'price to earnings'], category: 'Valuation', tab: 'overview', row: 'pe_trailing', hint: 'Overview → Valuation' },
  { id: 'pe-fwd', name: 'Forward P/E', aliases: ['forward pe'], category: 'Valuation', tab: 'overview', row: 'pe_forward', hint: 'Overview → Valuation' },
  { id: 'peg', name: 'PEG Ratio', aliases: ['peg'], category: 'Valuation', tab: 'overview', row: 'peg', hint: 'Overview → Valuation' },
  { id: 'ps', name: 'P/S Ratio', aliases: ['ps', 'price to sales'], category: 'Valuation', tab: 'overview', row: 'ps', hint: 'Overview → Valuation' },
  { id: 'pb', name: 'P/B Ratio', aliases: ['pb', 'price to book'], category: 'Valuation', tab: 'overview', row: 'pb', hint: 'Overview → Valuation' },
  { id: 'ev-ebitda', name: 'EV / EBITDA', aliases: ['ev ebitda', 'enterprise value'], category: 'Valuation', tab: 'overview', row: 'ev_to_ebitda', hint: 'Overview → Valuation' },
  { id: 'ev-rev', name: 'EV / Revenue', aliases: ['ev revenue', 'ev sales'], category: 'Valuation', tab: 'overview', row: 'ev_to_revenue', hint: 'Overview → Valuation' },
  { id: 'div-yield', name: 'Dividend Yield', aliases: ['dividend', 'yield'], category: 'Valuation', tab: 'overview', row: 'div_yield', hint: 'Overview → Valuation' },
  { id: 'market-cap', name: 'Market Cap', aliases: ['size', 'capitalization'], category: 'Valuation', tab: 'overview', hint: 'Overview → Valuation' },
]

export const POPULAR = ['Revenue', 'EPS', 'EBITDA', 'Free Cash Flow', 'P/E', 'Debt', 'Dividends', 'ROE']

// ── ranking ───────────────────────────────────────────────────────────────────
// exact(100) > prefix(80) > alias-exact(70) > word-start(55) > alias-prefix(45)
// > substring(30) > alias-substring(15). Below 15 = not shown (avoid noise).
function scoreOne(item, q) {
  const n = item.name.toLowerCase()
  const al = (item.aliases || []).map(a => a.toLowerCase())
  const kw = n + ' ' + al.join(' ')
  if (n === q) return 100
  if (al.includes(q)) return 72
  if (n.startsWith(q)) return 80
  if (al.some(a => a.startsWith(q))) return 46
  if (new RegExp(`\\b${q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`).test(n)) return 55
  if (n.includes(q)) return 30
  if (kw.includes(q)) return 16
  return 0
}

export function searchCompany(query) {
  const q = (query || '').trim().toLowerCase()
  if (!q) return []
  const scored = []
  for (const item of SEARCH_INDEX) {
    const s = scoreOne(item, q)
    if (s > 0) scored.push({ item, score: s })
  }
  scored.sort((a, b) => b.score - a.score || a.item.name.length - b.item.name.length)
  return scored.slice(0, 24).map(s => s.item)
}

// group results by category, preserving rank order within/between groups
export function groupResults(items) {
  const order = []
  const map = new Map()
  for (const it of items) {
    if (!map.has(it.category)) { map.set(it.category, []); order.push(it.category) }
    map.get(it.category).push(it)
  }
  return order.map(cat => ({ category: cat, items: map.get(cat) }))
}

// split a display name into [{text, hit}] chunks for highlighting the match
export function highlightParts(name, query) {
  const q = (query || '').trim()
  if (!q) return [{ text: name, hit: false }]
  const idx = name.toLowerCase().indexOf(q.toLowerCase())
  if (idx === -1) return [{ text: name, hit: false }]
  return [
    { text: name.slice(0, idx), hit: false },
    { text: name.slice(idx, idx + q.length), hit: true },
    { text: name.slice(idx + q.length), hit: false },
  ].filter(p => p.text)
}
