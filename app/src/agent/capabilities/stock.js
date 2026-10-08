// ── STOCK capabilities: facts about one or two stocks, from UCT's OWN data ────────
//
// Read-only QUERIES answered deterministically (no second model call, no web research)
// from the same endpoints the Stock Profile dock, the Earnings dock and the Research
// compare page use:
//   stock.profile   /api/fundamentals-full/{sym} (vendor snapshot, ~30 min cache)
//                   + /api/live-prices (live quote, vendor timestamp)
//   stock.earnings  /api/earnings-intel/{sym}    (reported quarters vs estimates, next report)
//   stock.compare   /api/research/compare/{a}/{b} (the Research compare page's payload)
// Every answer says where the numbers come from and how fresh they are; a field the
// source does not have is said to be unavailable, never filled in. Current events
// ("why is it moving?", news) are NOT here — that is the research path.

import { registerCapability, registerTargetKind, registerContextProvider } from '../capabilities'

const TICKER = /^[A-Z][A-Z0-9.-]{0,9}$/
const upper = (s) => String(s || '').trim().toUpperCase().replace(/^\$/, '')
const req = (u) => fetch(u, { credentials: 'include', cache: 'no-store' })
async function get(u) {
  const r = await req(u)
  if (!r.ok) {
    const b = await r.json().catch(() => ({}))
    const e = new Error(b.detail || `HTTP ${r.status}`)
    e.status = r.status
    throw e
  }
  return r.json()
}
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const money = (v, d = 2) => (num(v) == null ? null : `$${v.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d })}`)
const big = (v) => {
  if (num(v) == null) return typeof v === 'string' && v ? v : null
  const a = Math.abs(v)
  return a >= 1e12 ? `$${(v / 1e12).toFixed(2)}T` : a >= 1e9 ? `$${(v / 1e9).toFixed(2)}B` : a >= 1e6 ? `$${(v / 1e6).toFixed(1)}M` : money(v)
}
const pct = (v, d = 1) => (num(v) == null ? null : `${v > 0 ? '+' : ''}${v.toFixed(d)}%`)
const fix = (v, d = 2) => (num(v) == null ? null : v.toFixed(d))
const day = (iso) => {
  if (!iso) return null
  const d = new Date(`${String(iso).slice(0, 10)}T12:00:00Z`)
  return Number.isNaN(d.getTime()) ? String(iso) : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
}
const stamp = (sec) => {
  try { return new Date(sec * 1000).toLocaleString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) + ' ET' } catch { return null }
}
const NA = 'not available'
const researchLink = (sym) => ({ href: `/research/${encodeURIComponent(sym)}`, label: `Open ${sym} in Research` })
const badSymbol = (s) => `“${s}” doesn't look like a ticker.`
const notFound = (sym, e) => (e?.status === 404 ? `UCT has no data for “${sym}”.` : `I couldn't read UCT's data for ${sym} right now (${e?.message || 'error'}).`)

async function liveQuote(sym) {
  try {
    const body = await get(`/api/live-prices?tickers=${encodeURIComponent(sym)}`)
    const q = body?.[sym]
    return q && num(q.price) != null ? q : null
  } catch { return null }
}

export async function answerProfile({ symbol }) {
  const sym = upper(symbol)
  if (!TICKER.test(sym)) return badSymbol(symbol)
  let f
  const [fr, q] = await Promise.all([get(`/api/fundamentals-full/${encodeURIComponent(sym)}`).catch(e => ({ __err: e })), liveQuote(sym)])
  if (fr.__err) return notFound(sym, fr.__err)
  f = fr
  if (!f || (!f.name && f.market_cap == null && f.price == null)) return `UCT has no profile data for “${sym}”.`
  const lines = []
  lines.push(`${sym} — ${f.name || sym}${f.sector ? ` · ${f.sector}${f.industry ? ` / ${f.industry}` : ''}` : ''}`)
  if (q) {
    const when = num(q.observed_at) ? ` (quote as of ${stamp(q.observed_at)})` : ''
    lines.push(`Price ${money(q.price)}${num(q.change_pct) != null ? `, ${pct(q.change_pct, 2)} today` : ''}${when}`)
  } else if (num(f.price) != null) {
    lines.push(`Price ${money(f.price)} (from the fundamentals snapshot — a live quote wasn't available)`)
  } else lines.push(`Price: ${NA}`)
  lines.push(`Market cap ${big(f.market_cap) || NA} · P/E ${fix(f.pe_trailing) || NA} trailing, ${fix(f.pe_forward) || NA} forward`)
  lines.push(`52-week range ${money(f.fifty_two_week_low) || NA} – ${money(f.fifty_two_week_high) || NA}${num(f.beta) != null ? ` · beta ${fix(f.beta)}` : ''}`)
  lines.push(`Revenue (trailing 12 months) ${big(f.total_revenue) || NA}${num(f.revenue_growth_pct) != null ? ` · revenue growth ${pct(f.revenue_growth_pct)}` : ''}${num(f.profit_margin_pct) != null ? ` · profit margin ${f.profit_margin_pct.toFixed(1)}%` : ''}`)
  lines.push(`Next earnings: ${f.next_earnings ? `${day(f.next_earnings)} (scheduled date from the data vendor)` : NA}`)
  lines.push('Source: UCT fundamentals (data vendor snapshot, refreshed about every 30 minutes); price from UCT live quotes.')
  return { text: lines.join('\n'), link: researchLink(sym) }
}

export async function answerEarnings({ symbol }) {
  const sym = upper(symbol)
  if (!TICKER.test(sym)) return badSymbol(symbol)
  let e
  try { e = await get(`/api/earnings-intel/${encodeURIComponent(sym)}`) } catch (err) { return notFound(sym, err) }
  const qs = (e?.quarters || []).filter(q => q && q.reported !== false)
  const lines = [`${sym} earnings (reported figures${e?.currency && e.currency !== 'USD' ? `, ${e.currency}` : ''})`]
  const q = qs[0]
  if (!q) lines.push(`No reported quarter is available for ${sym}.`)
  else {
    const ended = q.period_end ? ` (quarter ended ${day(q.period_end)})` : ''
    lines.push(`Latest reported quarter: ${q.label || 'most recent'}${ended}`)
    const rev = big(q.revenue_actual)
    const revEst = big(q.revenue_estimate)
    lines.push(`• Revenue ${rev || NA}${revEst ? ` vs ${revEst} estimated${num(q.rev_surprise_pct) != null ? ` (${pct(q.rev_surprise_pct)} surprise)` : ''}` : ' (no comparable estimate)'}${num(q.rev_yoy_pct) != null ? ` · ${pct(q.rev_yoy_pct)} year over year` : ''}`)
    const eps = num(q.eps_actual) != null ? `$${q.eps_actual.toFixed(2)}` : null
    const epsEst = num(q.eps_estimate) != null ? `$${q.eps_estimate.toFixed(2)}` : null
    lines.push(`• EPS ${eps || NA}${epsEst ? ` vs ${epsEst} estimated${num(q.eps_surprise_pct) != null ? ` (${pct(q.eps_surprise_pct)} surprise)` : ''}` : ' (no comparable estimate)'}${q.eps_basis ? ` · basis: ${String(q.eps_basis).replace(/_/g, ' ')}` : ''}`)
  }
  const s = e?.summary || {}
  const next = s.next_report_date || e?.next_report_date
  if (next) {
    const est = [num(s.next_eps_estimate) != null ? `EPS est. $${s.next_eps_estimate.toFixed(2)}` : null, big(s.next_revenue_estimate) ? `revenue est. ${big(s.next_revenue_estimate)}` : null].filter(Boolean)
    lines.push(`Next report: ${day(next)}${s.next_report_label ? ` (${s.next_report_label})` : ''}${est.length ? ` · ${est.join(', ')}` : ''}`)
  } else lines.push(`Next report date: ${NA} in UCT's earnings data.`)
  const at = num(e?.meta?.retrieved_at) ? stamp(e.meta.retrieved_at) : null
  lines.push(`Source: UCT earnings data${at ? `, retrieved ${at}` : ''}. Estimates are consensus figures; actuals are as reported.`)
  return { text: lines.join('\n'), link: researchLink(sym) }
}

const CMP_ROWS = [
  ['Market cap', f => big(f.market_cap)], ['P/E (trailing)', f => fix(f.pe_trailing)], ['P/E (forward)', f => fix(f.pe_forward)],
  ['Price / sales', f => fix(f.ps)], ['Revenue (TTM)', f => big(f.total_revenue)], ['Revenue growth', f => pct(f.revenue_growth_pct)],
  ['Gross margin', f => (num(f.gross_margin_pct) == null ? null : `${f.gross_margin_pct.toFixed(1)}%`)],
  ['Operating margin', f => (num(f.operating_margin_pct) == null ? null : `${f.operating_margin_pct.toFixed(1)}%`)],
  ['Profit margin', f => (num(f.profit_margin_pct) == null ? null : `${f.profit_margin_pct.toFixed(1)}%`)],
  ['Beta', f => fix(f.beta)], ['Next earnings', f => day(f.next_earnings)],
]

export async function answerCompare({ symbols }) {
  const syms = [...new Set((Array.isArray(symbols) ? symbols : []).map(upper))]
  if (syms.length !== 2) return 'Name exactly two tickers to compare.'
  const bad = syms.find(s => !TICKER.test(s))
  if (bad) return badSymbol(bad)
  const [a, b] = syms
  let c
  try { c = await get(`/api/research/compare/${encodeURIComponent(a)}/${encodeURIComponent(b)}`) } catch (err) { return notFound(`${a} / ${b}`, err) }
  const fa = c?.a?.fundamentals || {}
  const fb = c?.b?.fundamentals || {}
  const rows = CMP_ROWS.map(([label, fn]) => ({ metric: label, a: fn(fa) || '—', b: fn(fb) || '—' }))
  const ca = c?.a?.ratings?.composite
  const cb = c?.b?.ratings?.composite
  if (num(ca) != null || num(cb) != null) rows.push({ metric: 'UCT composite rating', a: num(ca) != null ? String(ca) : '—', b: num(cb) != null ? String(cb) : '—' })
  const note = c?.fundamentals_period_note ? ` ${c.fundamentals_period_note}` : ''
  return {
    text: `${a} vs ${b} — fundamentals from UCT's Research compare data (vendor snapshot).${note}`,
    table: { columns: [{ key: 'metric', label: '' }, { key: 'a', label: a }, { key: 'b', label: b }], rows },
    link: { href: `/research/${encodeURIComponent(a)}/compare/${encodeURIComponent(b)}`, label: 'Open the comparison in Research' },
  }
}

const marketSnap = () => ({ ref: 'market', label: 'Stock data' })
export const marketKind = {
  name: 'market',
  boardScoped: false,
  list: () => [marketSnap()],
  read: (host, ref) => (ref === 'market' ? marketSnap() : null),
  stateOf: () => ({}),
  patch: () => null,
  commit: async () => true,
  landed: () => true,
  undoPatch: () => null,
  fingerprint: () => 'market',
}

let registered = false
export function registerStockCapabilities() {
  if (registered) return
  registered = true
  registerTargetKind(marketKind)
  registerContextProvider({ key: 'stockData', build: (host, refFor) => [{ ref: refFor('market', 'market'), label: 'UCT stock data (profile, fundamentals, earnings, comparisons)' }] })

  const one = { type: 'object', properties: { symbol: { type: 'string' } }, required: ['symbol'], additionalProperties: false }
  registerCapability({
    name: 'stock.profile',
    surfaces: ['charts'],
    target: 'market', query: true,
    summary: 'Answer a question about ONE stock\'s profile, price or fundamentals from UCT\'s own data: company name, sector/industry, price and today\'s change, market cap, P/E, 52-week range, revenue, margins, beta, next earnings date. '
      + 'Use this (disposition apply, research null) for "what\'s NVDA\'s market cap?", "what sector is AMD in?", "what\'s TSLA\'s P/E?" instead of answering from memory.',
    hints: 'target = the ref of the stockData entry; symbol = the ticker, uppercase. Not for news or "why is it moving" (that needs research).',
    args: one,
    answer: (_snap, args) => answerProfile(args),
  })
  registerCapability({
    name: 'stock.earnings',
    surfaces: ['charts'],
    target: 'market', query: true,
    summary: 'Answer earnings questions about ONE stock from UCT\'s earnings data: the latest REPORTED quarter\'s revenue and EPS versus consensus estimates, year-over-year change, and the next report date with its estimates. '
      + 'Use this (disposition apply, research null) for "what was AMD\'s latest quarterly revenue?", "when does TSLA report earnings?", "did NVDA beat last quarter?".',
    hints: 'target = the ref of the stockData entry; symbol = the ticker, uppercase.',
    args: one,
    answer: (_snap, args) => answerEarnings(args),
  })
  registerCapability({
    name: 'stock.compare',
    surfaces: ['charts'],
    target: 'market', query: true,
    summary: 'Compare the fundamentals of TWO stocks side by side from UCT\'s Research data (market cap, P/E, revenue, growth, margins, beta, next earnings, UCT composite rating). Use this (disposition apply, research null) for "compare NVDA and AMD".',
    hints: 'target = the ref of the stockData entry; symbols = exactly two tickers, uppercase. For three or more, clarify which two.',
    args: { type: 'object', properties: { symbols: { type: 'array', items: { type: 'string' } } }, required: ['symbols'], additionalProperties: false },
    answer: (_snap, args) => answerCompare(args),
  })
}
