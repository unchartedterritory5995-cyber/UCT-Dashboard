// ── NEWS capabilities: what UCT itself holds about one stock's news and catalysts ─────
//
// Read-only QUERIES, answered deterministically from UCT's own stores (no model call, no
// web search, no background generation triggered):
//   news.latest     /api/company-news/{sym}       the Company Panel's News tab: UCT's ingested
//                   feed (scheduled FMP / SEC ingest), newest first, UTC timestamps, source,
//                   link, rule-based sentiment. Paid-gated by the route itself.
//   news.catalysts  /api/catalysts/history/{sym}  the Catalysts History page: the days UCT's
//                   catalyst engine flagged this stock (tag, type, grade, gap, thesis).
// ⛔ Not used: /api/news-catalysts/{sym} — a read there can START background web-search and
// model generation (cost on every new symbol). Not supported: an upcoming-events calendar
// (UCT's events timeline is off) — the next earnings date is stock.earnings.
// Every answer gives each item's time and source and says how old the newest item is: an
// old stored headline is never presented as breaking news.

import { registerCapability } from '../capabilities'

const TICKER = /^[A-Z][A-Z0-9.-]{0,9}$/
const upper = (s) => String(s || '').trim().toUpperCase().replace(/^\$/, '')
const SHOW_DEFAULT = 8
const SHOW_MAX = 15
const STALE_DAYS = 3

async function get(u) {
  const r = await fetch(u, { credentials: 'include', cache: 'no-store' })
  if (!r.ok) {
    const b = await r.json().catch(() => ({}))
    const e = new Error(b.detail || `HTTP ${r.status}`)
    e.status = r.status
    throw e
  }
  return r.json()
}
const fail = (sym, e) => (e?.status === 402 ? 'News and catalysts need a paid UCT plan.'
  : `I couldn't read UCT's news for ${sym} right now (${e?.message || 'error'}).`)
const etStamp = (iso) => {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return String(iso || '—')
  return d.toLocaleString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) + ' ET'
}
const ageDays = (iso) => (Date.now() - new Date(iso).getTime()) / 86400000
const day = (ymd) => {
  const d = new Date(`${String(ymd).slice(0, 10)}T12:00:00Z`)
  return Number.isNaN(d.getTime()) ? String(ymd) : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
}
const clip = (s, n) => { const t = String(s || '').replace(/\s+/g, ' ').trim(); return t.length > n ? `${t.slice(0, n - 1)}…` : t }

export async function answerLatest({ symbol, limit }) {
  const sym = upper(symbol)
  if (!TICKER.test(sym)) return `“${symbol}” doesn't look like a ticker.`
  const n = Math.min(Math.max(Number(limit) || SHOW_DEFAULT, 1), SHOW_MAX)
  let body
  try { body = await get(`/api/company-news/${encodeURIComponent(sym)}?limit=${n}`) } catch (e) { return fail(sym, e) }
  const items = (body?.items || []).filter(i => i && i.headline)
  if (!items.length) return { text: `UCT has no stored news for ${sym}.`, link: { href: `/research/${sym}`, label: `Open ${sym} in Research` } }
  const newest = items[0].published_at
  const stale = newest && ageDays(newest) > STALE_DAYS
  const rows = items.map(i => ({
    when: etStamp(i.published_at),
    headline: clip(i.headline, 140),
    source: i.source || '—',
    tone: i.sentiment || '—',
  }))
  const head = `Latest ${items.length} headline${items.length === 1 ? '' : 's'} UCT has for ${sym} (newest ${etStamp(newest)})`
    + (stale ? ` — note: the newest is ${Math.floor(ageDays(newest))} days old, so this is not breaking news.` : '.')
  return {
    text: `${head}\nSource: UCT's news feed (the Company Panel's News tab); tone is UCT's rule-based tag.`,
    table: { columns: [{ key: 'when', label: 'Published' }, { key: 'headline', label: 'Headline' }, { key: 'source', label: 'Source' }, { key: 'tone', label: 'Tone' }], rows },
    link: { href: `/research/${sym}`, label: `Open ${sym} in Research` },
  }
}

export async function answerCatalysts({ symbol }) {
  const sym = upper(symbol)
  if (!TICKER.test(sym)) return `“${symbol}” doesn't look like a ticker.`
  let body
  try { body = await get(`/api/catalysts/history/${encodeURIComponent(sym)}`) } catch (e) { return fail(sym, e) }
  const entries = (body?.entries || []).filter(e => e && e.market_date)
  if (!entries.length) return `UCT's catalyst engine has never flagged ${sym} (most stocks never surface a catalyst). For the next earnings date, ask when ${sym} reports.`
  const rows = entries.slice(0, 10).map(e => ({
    date: day(e.market_date),
    what: [e.catalyst_type, e.tag].filter(Boolean).join(' · ') || '—',
    grade: e.grade || '—',
    gap: typeof e.gap_pct === 'number' ? `${e.gap_pct > 0 ? '+' : ''}${e.gap_pct.toFixed(1)}%` : '—',
    thesis: clip(e.thesis_text, 160) || '—',
  }))
  return {
    text: `UCT's catalyst engine flagged ${sym} on ${entries.length} day${entries.length === 1 ? '' : 's'}; the latest ${rows.length} below (newest ${day(entries[0].market_date)}). Theses were written by UCT's engine at the time.`,
    table: { columns: [{ key: 'date', label: 'Date' }, { key: 'what', label: 'Catalyst' }, { key: 'grade', label: 'Grade' }, { key: 'gap', label: 'Gap' }, { key: 'thesis', label: 'Thesis' }], rows },
    link: { href: '/catalysts/history', label: 'Open Catalysts History' },
  }
}

let registered = false
export function registerNewsCapabilities() {
  if (registered) return
  registered = true
  registerCapability({
    name: 'news.latest',
    surfaces: ['charts'],
    target: 'market', query: true,
    summary: 'Show the latest news headlines UCT has stored for ONE stock (the Company Panel\'s News tab), each with time, source and tone. '
      + 'Use this (disposition apply, research null) for "show me the latest NVDA news", "what news is UCT showing for PLTR".',
    hints: 'target = the ref of the stockData entry; symbol = the ticker, uppercase; limit = how many headlines (null = 8, at most 15). '
      + 'For WHY a stock is moving right now, or a summary of today\'s news across the web, use research instead. To compare two stocks\' news, one op per stock.',
    args: { type: 'object', properties: { symbol: { type: 'string' }, limit: { type: ['integer', 'null'] } }, required: ['symbol', 'limit'], additionalProperties: false },
    answer: (_snap, args) => answerLatest(args),
  })
  registerCapability({
    name: 'news.catalysts',
    surfaces: ['charts'],
    target: 'market', query: true,
    summary: 'Show the catalysts UCT\'s catalyst engine has recorded for ONE stock (the Catalysts History page): the days it was flagged, catalyst type, grade, gap and the thesis written at the time. '
      + 'Use this (disposition apply, research null) for "what are the recent catalysts for AMD?". UCT has no calendar of future events besides earnings (use stock.earnings for the next report).',
    hints: 'target = the ref of the stockData entry; symbol = the ticker, uppercase.',
    args: { type: 'object', properties: { symbol: { type: 'string' } }, required: ['symbol'], additionalProperties: false },
    answer: (_snap, args) => answerCatalysts(args),
  })
}
