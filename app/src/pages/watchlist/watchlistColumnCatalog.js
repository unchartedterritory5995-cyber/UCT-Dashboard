// The Watchlist column library's catalog (owner 11-14) — every column the picker offers,
// grouped, with a plain-English line for the hint strip, and for the NEW columns the
// one place their values come from. Three sources:
//   • the existing columns (watchlistColumns.js) — unchanged, rendered as before;
//   • LIVE columns computed from the live quote (Gap %, Day Range, Days to Earnings);
//   • FACT columns from the nightly screener snapshot (/api/watchlists/column-facts),
//     formatted with the Screener's own formatters (pages/screener/columnDefs.js) so a
//     number reads the same on both pages. The price-relative facts (YTD / 1Y / 6M / 3M
//     change, % from an average, 52-week distances) are RE-BASED on the live price:
//     the snapshot carries its own close (`price`), so a snapshot % becomes a live one.
//   • SOON columns are listed (greyed, not clickable) until their data exists.
import { COLUMN_DEFS } from '../screener/columnDefs'

export const COLUMN_GROUPS = [
  { key: 'price', label: 'Price & change' },
  { key: 'volume', label: 'Volume' },
  { key: 'momentum', label: 'Momentum & RS' },
  { key: 'trend', label: 'Trend & averages' },
  { key: 'setup', label: 'Technical setups' },
  { key: 'earn', label: 'Earnings' },
  { key: 'fund', label: 'Fundamentals' },
  { key: 'own', label: 'Ownership & short' },
  { key: 'analyst', label: 'Analysts' },
  { key: 'class', label: 'Classification' },
  { key: 'uct', label: 'UCT Intelligence' },
  { key: 'events', label: 'Events & news' },
  { key: 'me', label: 'Personal' },
]

const fin = (v) => (v == null || v === '' ? null : Number.isFinite(Number(v)) ? Number(v) : null)
const signedPct = (d = 1) => (v) => (v == null ? '—' : `${v >= 0 ? '+' : ''}${v.toFixed(d)}%`)
const screenerFmt = (field) => (v) => (COLUMN_DEFS[field]?.fmt ? COLUMN_DEFS[field].fmt(v) : (v ?? '—'))

// ── LIVE columns: from the live quote (and the meta batch for earnings) ──
// value(q, meta) → number | string | null. `range` cells return 0..1 for a range bar.
export const LIVE_COLUMNS = {
  gap: {
    label: 'Gap %', short: 'Gap', group: 'price', width: 64, signed: true,
    desc: "Today's open vs yesterday's close.",
    value: (q) => { const o = fin(q?.day_open), pc = fin(q?.prev_close); return o > 0 && pc > 0 ? ((o - pc) / pc) * 100 : null },
    fmt: signedPct(2),
  },
  dayrange: {
    label: 'Day Range', short: 'Range', group: 'price', width: 80, bar: true,
    desc: "Today's low to high, with where the price sits.",
    value: (q) => {
      const h = fin(q?.day_high), l = fin(q?.day_low), p = fin(q?.price)
      return h != null && l != null && p != null && h > l ? Math.max(0, Math.min(1, (p - l) / (h - l))) : null
    },
    fmt: (v) => (v == null ? '—' : `${Math.round(v * 100)}%`),
  },
  dte: {
    label: 'Days to Earnings', short: 'To Earn', group: 'earn', width: 70, meta: true,
    desc: 'Calendar days until the next earnings report.',
    value: (q, meta) => {
      const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(meta?.next_earnings || '')
      if (!m) return null
      const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' })
      const [ty, tm, td] = today.split('-').map(Number)
      const days = Math.round((Date.UTC(+m[1], +m[2] - 1, +m[3]) - Date.UTC(ty, tm - 1, td)) / 86400000)
      return days >= 0 ? days : null
    },
    fmt: (v) => (v == null ? '—' : v === 0 ? 'Today' : `${v}d`),
  },
}

// ── FACT columns: nightly snapshot fields ──
// kind: 'static' (shown as stored), 'perf' (a % change ending at the snapshot close →
// re-based on the live price), 'dist' (a % distance from a level → the level is
// recovered from the snapshot close and the distance re-measured live), 'hi52' / 'lo52'
// (as dist, clamped at a new high / low).
const F = (field, label, short, group, desc, kind = 'static', extra = {}) => ({ field, label, short, group, desc, kind, ...extra })
export const FACT_COLUMNS = {
  ytd: F('chg_pct_ytd', 'YTD %', 'YTD', 'price', 'Change since the first trading day of the year.', 'perf', { signed: true }),
  y1: F('chg_pct_1y', '1-Year %', '1Y', 'price', 'Change over the last 12 months.', 'perf', { signed: true }),
  m6: F('chg_pct_6m', '6-Month %', '6M', 'price', 'Change over the last 6 months.', 'perf', { signed: true }),
  m3: F('chg_pct_3m', '3-Month %', '3M', 'price', 'Change over the last 3 months.', 'perf', { signed: true }),
  h52: F('dist_52w_high_pct', '% from 52-Wk High', '52W Hi', 'setup', 'How far below the 52-week high (0% = at a new high).', 'hi52', { signed: true }),
  l52: F('dist_52w_low_pct', '% from 52-Wk Low', '52W Lo', 'setup', 'How far above the 52-week low.', 'lo52', { signed: true }),
  avgvol: F('avg_volume_30d', 'Avg Volume (30d)', 'Avg Vol', 'volume', 'Average daily shares traded over 30 sessions.'),
  avgdv: F('dollar_vol_30d', 'Avg $ Volume (30d)', 'Avg $Vol', 'volume', 'Average daily dollars traded over 30 sessions.'),
  udvol: F('vol_updown_ratio', 'Up/Down Volume', 'U/D Vol', 'volume', 'Volume on up days vs down days over 50 sessions. Above 1 = buying.'),
  rsrank: F('rs_rank', 'RS Rank', 'RS', 'momentum', 'Relative strength vs every stock, 1 to 99 (as of the last close).'),
  rsline: F('rs_line_trend', 'RS Line Trend', 'RS Line', 'momentum', 'Is the line of the stock vs SPY rising, flat or falling.', 'static', { text: true }),
  ema20d: F('pct_vs_ema20', '% from 20 EMA', '20 EMA', 'trend', 'How far above or below the 20-day exponential average.', 'dist', { signed: true }),
  sma50d: F('pct_vs_sma50', '% from 50 SMA', '50 SMA', 'trend', 'How far above or below the 50-day average.', 'dist', { signed: true }),
  sma200d: F('pct_vs_sma200', '% from 200 SMA', '200 SMA', 'trend', 'How far above or below the 200-day average.', 'dist', { signed: true }),
  mastack: F('ma_stack', 'MA Stack', 'MA Stack', 'trend', 'How the 20 / 50 / 200 averages are stacked: full-bull, partial or bear.', 'static', { text: true }),
  adr: F('adr_pct', 'ADR %', 'ADR%', 'setup', 'Average daily range over 20 days, as % of price.'),
  rsi: F('rsi14', 'RSI (14)', 'RSI', 'setup', 'Relative Strength Index over 14 days (above 70 = stretched, below 30 = washed out).'),
  epsg: F('eps_growth', 'EPS Growth', 'EPS Gr', 'earn', 'Earnings per share growth vs a year ago.', 'static', { signed: true }),
  revg: F('rev_growth', 'Revenue Growth', 'Rev Gr', 'earn', 'Sales growth vs a year ago.', 'static', { signed: true }),
  epsny: F('eps_next_y_growth', 'EPS Growth Next Year', 'EPS NY', 'earn', "Analysts' expected EPS growth next fiscal year (an estimate).", 'static', { signed: true }),
  pe: F('pe_ttm', 'P/E', 'P/E', 'fund', 'Price vs the last 12 months of earnings.'),
  pefwd: F('pe_fwd', 'Forward P/E', 'Fwd P/E', 'fund', "Price vs next year's expected earnings."),
  ps: F('ps', 'Price / Sales', 'P/S', 'fund', 'Company value vs its yearly sales.'),
  beta: F('beta', 'Beta', 'Beta', 'fund', 'How much it swings vs the market (1 = the same).'),
  divy: F('dividend_yield', 'Dividend Yield', 'Div', 'fund', 'Yearly dividend as % of the price.'),
  netm: F('net_margin', 'Net Margin', 'Net Mgn', 'fund', 'Profit as % of sales.', 'static', { signed: true }),
  roe: F('roe', 'ROE', 'ROE', 'fund', 'Return on equity: profit vs shareholder equity.', 'static', { signed: true }),
  float: F('float_shares', 'Float', 'Float', 'fund', 'Shares available to trade.'),
  shares: F('shares_outstanding', 'Shares Outstanding', 'Shares', 'fund', 'All shares issued.'),
  shortf: F('short_float_pct', 'Short % of Float', 'Short%', 'own', 'Shares sold short as % of the float.'),
  shortr: F('short_ratio', 'Days to Cover', 'Days Cvr', 'own', 'Days of normal volume it would take to close every short.'),
  inst: F('inst_pct', 'Institutional %', 'Inst%', 'own', 'Owned by funds and institutions.'),
  insider: F('insider_own_pct', 'Insider %', 'Insider%', 'own', 'Owned by executives and directors.'),
  consensus: F('analyst_consensus', 'Analyst Consensus', 'Analysts', 'analyst', 'The average analyst rating.', 'static', { text: true }),
  ptup: F('pt_upside_pct', 'Price Target Upside', 'PT Up', 'analyst', 'How far the average analyst price target is from the price.', 'dist', { signed: true }),
  country: F('country', 'Country', 'Country', 'class', 'Where the company is based.', 'static', { text: true }),
  exch: F('exchange', 'Exchange', 'Exch', 'class', 'Where it is listed.', 'static', { text: true }),
  accdis: F('accdis', 'Acc/Dis Grade', 'A/D', 'uct', 'Accumulation / distribution grade, A (buying) to E (selling).', 'static', { text: true }),
}

/** The snapshot fields the visible FACT columns need (plus the snapshot close for re-basing). */
export function factFieldsFor(keys) {
  const out = new Set()
  for (const k of keys) {
    const c = FACT_COLUMNS[k]
    if (!c) continue
    out.add(c.field)
    if (c.kind !== 'static') out.add('price')
  }
  return [...out].sort()
}

/** A FACT column's value for one ticker: the stored field, re-based on the live price
 *  where the field is price-relative. null when the ticker has no snapshot row. */
export function factValue(key, facts, q) {
  const c = FACT_COLUMNS[key]
  if (!c || !facts) return null
  const raw = facts[c.field]
  if (c.text) return raw == null || raw === '' ? null : String(raw)
  const v = fin(raw)
  if (v == null) return null
  if (c.kind === 'static') return v
  const snap = fin(facts.price), live = fin(q?.price)
  if (!(snap > 0) || !(live > 0)) return v
  if (c.kind === 'perf') return ((1 + v / 100) * (live / snap) - 1) * 100
  // Price target: stored as (target / price - 1) × 100 (snapshot_builder), so the target is
  // snap × (1 + v/100) and the live upside is target vs the live price.
  if (c.field === 'pt_upside_pct') { const target = snap * (1 + v / 100); return target > 0 ? (target / live - 1) * 100 : v }
  // Averages, 52-week high / low: stored as (price - level) / level × 100 (technicals._pct),
  // so the level is snap / (1 + v/100) and the distance is re-measured from the live price.
  const level = snap / (1 + v / 100)
  if (!(level > 0)) return v
  const d = ((live - level) / level) * 100
  if (c.kind === 'hi52') return Math.min(0, d)       // above the old high = a new high (0%)
  if (c.kind === 'lo52') return Math.max(0, d)
  return d
}

/** Display text for a FACT value — the Screener's own formatter for the field, except the
 *  re-based ones, which are signed % like the rest of the Watchlist. */
export function factText(key, v) {
  const c = FACT_COLUMNS[key]
  if (!c) return '—'
  if (v == null) return '—'
  if (c.kind !== 'static') return signedPct(1)(v)
  if (c.text) {
    const s = String(v)
    return c.field === 'ma_stack' || c.field === 'rs_line_trend' ? s.charAt(0).toUpperCase() + s.slice(1) : s
  }
  return screenerFmt(c.field)(v)
}

// ── SOON: listed so members see what is coming; not clickable until the data exists ──
export const SOON_COLUMNS = [
  { key: 's_spark', label: 'Mini Chart', group: 'price', desc: 'A tiny price line for today or 5 days.' },
  { key: 's_added', label: '% Since Added', group: 'me', desc: 'How it has moved since you added it to this list.' },
  { key: 's_pp', label: 'Pocket Pivot', group: 'volume', desc: 'An up day on volume above any down day in the last 10.' },
  { key: 's_streak', label: 'Up/Down Streak', group: 'momentum', desc: 'Days up (or down) in a row.' },
  { key: 's_pivot', label: '% to Pivot', group: 'setup', desc: 'How far from your breakout point.' },
  { key: 's_base', label: 'Base Length / Depth', group: 'setup', desc: 'Weeks in the current base and how deep it is.' },
  { key: 's_im', label: 'Expected Move', group: 'earn', desc: 'The options-implied earnings move.' },
  { key: 's_react', label: 'Last Earnings Reaction', group: 'earn', desc: 'How the stock moved the day after its last report.' },
  { key: 's_ibuy', label: 'Insider Buying', group: 'own', desc: 'Insiders bought shares in the last 90 days.' },
  { key: 's_idx', label: 'Index Membership', group: 'class', desc: 'S&P 500, Nasdaq 100, Russell 2000.' },
  { key: 's_score', label: 'UCT Setup Score', group: 'uct', desc: 'How clean the current setup is, 1 to 10.' },
  { key: 's_why', label: "Why It's Moving", group: 'uct', desc: 'A one-line reason from the UCT Agent.' },
  { key: 's_news', label: 'Latest Headline', group: 'events', desc: 'The newest UCT News headline, with its time.' },
  { key: 's_flow', label: 'Unusual Options', group: 'events', desc: 'Big or unusual options activity today.' },
  { key: 's_note', label: 'My Note', group: 'me', desc: 'The first line of your note on this ticker.' },
  { key: 's_alert', label: 'Alert Distance', group: 'me', desc: 'How far the price is from your nearest alert.' },
  { key: 's_pnl', label: 'My P&L', group: 'me', desc: 'Gain or loss on your shares, from a cost you enter.' },
]

// ── The existing columns, placed in the library's groups with a description each ──
export const EXISTING_PLACEMENT = {
  price: ['price', 'Last price.'],
  chg: ['price', "Today's change from yesterday's close."],
  dchg: ['price', "Today's change in dollars."],
  fromopen: ['price', 'How far from today’s open.'],
  fromhigh: ['price', 'How far below today’s high.'],
  fromlow: ['price', 'How far above today’s low.'],
  dcr: ['price', 'Where the price sits in today’s range, 0 to 100%.'],
  perf5d: ['price', 'Change over the last 5 trading days.'],
  perf30d: ['price', 'Change over the last 30 trading days.'],
  perf60d: ['price', 'Change over the last 60 trading days.'],
  perf90d: ['price', 'Change over the last 90 trading days.'],
  vol: ['volume', "Today's shares traded."],
  rvol: ['volume', 'Volume vs normal for this time of day.'],
  dolvol: ['volume', "Today's dollars traded (price × volume)."],
  atr: ['setup', 'Average true range as % of price.'],
  a50: ['trend', 'Distance from the 50-day average, in ATRs.'],
  earn: ['earn', 'Date of the next earnings report.'],
  mcap: ['fund', 'Company value.'],
  ipoDate: ['fund', 'First day of trading.'],
  name: ['class', 'Company name.'],
  sector: ['class', 'Sector.'],
  industry: ['class', 'Industry.'],
  theme: ['class', 'The UCT theme it belongs to.'],
  rating: ['uct', 'UCT’s 1 to 99 score.'],
  attention: ['uct', 'A badge when something notable happened (earnings soon, filing, analyst action).'],
}

// Starter sets for the Presets tab (only real, working columns).
export const COLUMN_PRESETS = [
  { name: 'Swing', cols: ['price', 'chg', 'rvol', 'adr', 'ema20d', 'sma50d', 'rsrank'] },
  { name: 'Momentum', cols: ['price', 'chg', 'rsrank', 'rsline', 'm3', 'gap', 'udvol'] },
  { name: 'Earnings week', cols: ['price', 'chg', 'earn', 'dte', 'epsg', 'revg', 'rvol'] },
  { name: 'Day trade', cols: ['price', 'chg', 'vol', 'rvol', 'gap', 'dayrange', 'atr'] },
  { name: 'Trend check', cols: ['price', 'chg', 'ema20d', 'sma50d', 'sma200d', 'mastack', 'h52'] },
  { name: 'Fundamentals', cols: ['price', 'chg', 'mcap', 'pe', 'epsg', 'revg', 'netm'] },
  { name: 'Short squeeze', cols: ['price', 'chg', 'rvol', 'shortf', 'shortr', 'float', 'inst'] },
]
