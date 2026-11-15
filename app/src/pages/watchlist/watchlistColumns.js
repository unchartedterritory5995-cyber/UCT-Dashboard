// The Watchlist widget's column catalog, and the two pure edits a column config takes. Watchlists.jsx draws from this;
// the Agent reads the same catalog (agent/capabilities/listView.js) so it offers exactly the columns the menu offers.
import { ASC, DESC } from '../../lib/presentation/dataGrid/gridSort'

export const OPTIONAL_COLS = [  // hideable via right-click
  { key: 'price', label: 'Price', def: 62, min: 44 },
  { key: 'vol', label: 'Vol', def: 56, min: 40 },
  { key: 'chg', label: '% Chg', def: 68, min: 50 },
]
// Extra data columns the user can ADD via the + button (not shown by default).
export const EXTRA_COLS = [
  { key: 'name', label: 'Company Name' },
  { key: 'rvol', label: 'RVOL' },
  { key: 'ipoDate', label: 'IPO Date' },
  { key: 'mcap', label: 'Market Cap' },
  { key: 'earn', label: 'Next Earnings' },
  { key: 'rating', label: 'UCT Rating' },
  { key: 'dchg', label: '$ Change' },
  { key: 'fromopen', label: '% from Open' },
  { key: 'fromhigh', label: '% from High' },
  { key: 'fromlow', label: '% from Low' },
  { key: 'dcr', label: 'Daily Closing Range' },
  { key: 'dolvol', label: 'Dollar Volume' },
  { key: 'sector', label: 'Sector' },
  { key: 'industry', label: 'Industry' },
  { key: 'theme', label: 'Theme' },
  { key: 'perf5d', label: '5-Day Change' },
  { key: 'perf30d', label: '30-Day Change' },
  { key: 'perf60d', label: '60-Day Change' },
  { key: 'perf90d', label: '90-Day Change' },
  { key: 'attention', label: 'Attention' },
  { key: 'atr', label: 'ATR %' },
  { key: 'a50', label: 'ATR from 50SMA' },
  { key: 'rsexit', label: 'RS Exit Warning' },
]
export const DEFAULT_COL_ORDER = ['flag', 'sym', 'price', 'vol', 'chg']   // reorderable by dragging a header
// [full label, abbreviation].
export const COL_LABELS = {
  flag: ['', ''], sym: ['Symbol', 'Sym'], name: ['Company Name', 'Name'],
  price: ['Price', 'Price'], vol: ['Volume', 'Vol'], chg: ['% Change', '% Chg'],
  rvol: ['RVOL', 'RVOL'], ipoDate: ['IPO Date', 'IPO'],
  mcap: ['Market Cap', 'Mkt Cap'], earn: ['Next Earnings', 'Earnings'], rating: ['UCT Rating', 'UCT'],
  dchg: ['$ Change', '$ Chg'], fromopen: ['% from Open', '% Open'], fromhigh: ['% from High', '% High'],
  fromlow: ['% from Low', '% Low'], dcr: ['DCR', 'DCR'], dolvol: ['Dollar Volume', '$ Vol'],
  sector: ['Sector', 'Sector'], industry: ['Industry', 'Industry'], theme: ['Theme', 'Theme'],
  perf5d: ['5-Day', '5-day'], perf30d: ['30-Day', '30-day'], perf60d: ['60-Day', '60-day'], perf90d: ['90-Day', '90-day'],
  periodchg: ['% Change', '% Chg'],
  grpcount: ['Stocks', 'Stocks'],
  weight: ['Weight %', 'Wt %'],
  atr: ['ATR %', 'ATR%'], a50: ['ATR from 50SMA', '50SMA'],
  attention: ['Attention', 'Attn'],
  rsexit: ['RS Exit Warning', 'RS Exit'],
}
// Text columns — sorted alphabetically, not numerically.
export const TEXT_COLS = new Set(['name', 'sector', 'industry', 'theme'])

/** The direction a first click on a header takes: Symbol A→Z, everything else high→low. */
export const firstSortDir = (key) => (key === 'sym' ? ASC : DESC)

const orderOf = (cfg) => (Array.isArray(cfg?.order) && cfg.order.length ? cfg.order : DEFAULT_COL_ORDER)

/** Show a column: it joins the right of the order and stops being hidden. */
export function withColumn(cfg, key) {
  const order = orderOf(cfg)
  const hidden = { ...(cfg?.hidden || {}) }
  delete hidden[key]
  return { ...cfg, order: order.includes(key) ? order : [...order, key], hidden }
}

/** Stop showing a column: a default one is marked hidden (the menu's check), an added one leaves the order. */
export function withoutColumn(cfg, key) {
  if (OPTIONAL_COLS.some(c => c.key === key)) return { ...cfg, hidden: { ...(cfg?.hidden || {}), [key]: true } }
  return { ...cfg, order: orderOf(cfg).filter(k => k !== key) }
}

const CATALOG = [...OPTIONAL_COLS, ...EXTRA_COLS]
const fold = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9%$]+/g, '')
// How members say a column that its own labels do not spell. Only names of REAL columns, never a near neighbour.
const SAID_AS = {
  relativevolume: 'rvol', percentchange: 'chg', pctchange: 'chg', change: 'chg', daychange: 'chg', changepercent: 'chg',
  ticker: 'sym', tickers: 'sym', company: 'name', marketcapitalization: 'mcap', earningsdate: 'earn', rating: 'rating',
  ipo: 'ipoDate', dollarchange: 'dchg', closingrange: 'dcr', atrpercent: 'atr', dollarvol: 'dolvol',
  '5daychange': 'perf5d', '30daychange': 'perf30d', '60daychange': 'perf60d', '90daychange': 'perf90d',
}

/** A column named the way a member or a label names it → its key, or null. `extra` = keys this one view also has (a scan's own). */
export function resolveColumn(word, extra = []) {
  const f = fold(word)
  if (!f) return null
  for (const k of [...CATALOG.map(c => c.key), 'sym', ...extra.filter(x => x !== 'flag')]) {
    const label = CATALOG.find(c => c.key === k)?.label
    if (fold(k) === f || fold(label) === f || (COL_LABELS[k] || []).some(l => fold(l) === f)) return k
  }
  return SAID_AS[f] || null
}

/** The column's name in a sentence. */
export const columnLabel = (key) => COL_LABELS[key]?.[0] || CATALOG.find(c => c.key === key)?.label || key

// ── The header drag and the gridline drag, as pure edits of a column config (AUDIT #1027: moved verbatim out of Watchlists.jsx
// so the member's drag and UCT Agent's watchlist.arrangeColumns are one rule; `meta` = Watchlists' COL_META, {key: {def, min}}).
// Watchlists.columnDrag.parity.test.js pins them to the inline code they replace. ──
/** A header dropped on another: the dragged column takes the drop target's place. null = no move (as the drop did nothing). */
export function movedColumnCfg(cfg, fromKey, toKey, meta) {
  if (!fromKey || fromKey === toKey) return null
  const order = (Array.isArray(cfg.order) && cfg.order.length ? cfg.order : DEFAULT_COL_ORDER).filter(k => meta[k])
  DEFAULT_COL_ORDER.forEach(k => { if (!order.includes(k)) order.push(k) })
  const from = order.indexOf(fromKey)
  const to = order.indexOf(toKey)
  if (from < 0 || to < 0) return null
  order.splice(from, 1)
  order.splice(to, 0, fromKey)
  return { ...cfg, order }
}
/** A column's minimum width (the gridline never goes under it). */
export const columnMinWidth = (key, meta) => meta[key]?.min || 40
/** A gridline let go at `w` px: the column's width, rounded, never under its minimum. */
export const resizedColumnCfg = (cfg, key, w, meta) => ({ ...cfg, widths: { ...(cfg.widths || {}), [key]: Math.max(columnMinWidth(key, meta), Math.round(w)) } })
