// UCT Agent — `watchlist.changes` (Track D workflow "watchlistChanges", DARK): what changed in ONE of the member's
// saved watchlists since the previous close — every symbol's move vs its previous session close from ONE `quotes`
// read, and how much STORED news the biggest movers had in the 24 hours before that snapshot (counts only, from
// `news.company`). Dated to the snapshot's own instant; nothing is extrapolated.
//
// "what changed in my Momentum watchlist since yesterday", "how is my Momentum list doing today", "movers in my
// Earnings watchlist": answered DETERMINISTICALLY. Reads (gateway budget 8 per turn): 1 `quotes` (the list's first
// MAX_SYMBOLS symbols — the kind's own cap) + at most NEWS_FOR `news.company` (the largest absolute movers). No model
// call, no fetch of its own; no headline text is shown — counts only (the News widget / news.latest show items).
//
// The card: the snapshot instant (ET, always dated) and session; counts up / down / unchanged; the TOP movers each way
// (% vs previous close — the quote row's own change_pct, never recomputed from a guessed base); the news counts with
// their window; and what could not be answered (no quote for X, list longer than the read, news ingest behind). The
// words "live" / "now" are never used: a quote is "as of" its stamp. Ends "Descriptive, not a recommendation."
//
// Isolation: the stock.quote contract (a served NON-local read; the server blanks the model's pre-read reply:
// turn.DATA_READ_ACTIONS). Dark: workflowGate (UCT_AGENT_WORKFLOWS) + `quotes` and `news.company` served.

import { registerCapability } from '../capabilities'
import { readData } from '../marketdata/client'
import { currentTurnId } from '../trace'
import { num } from './marketDataFormat'
import { stampET } from './marketDataQuote'
import { resolveListByName } from './watchlist'
import { workflowServed, armGroupWords, DESCRIPTIVE } from './workflowGate'

export const CAPABILITY = 'watchlist.changes'
export const WORKFLOW = 'watchlistChanges'
export const KINDS = ['quotes', 'news.company']
export const MAX_SYMBOLS = 50             // the quotes kind's own per-read cap
export const TOP = 3                      // movers shown each way
export const NEWS_FOR = 5                 // news counts for the largest absolute movers (reads: 1 + 5 ≤ the turn's 8)
export const NEWS_LIMIT = 25              // news.company's own MAX_LIMIT
export const NEWS_HOURS = 24
const SESSION_WORDS = { regular: 'regular session', extended: 'extended hours', premarket: 'premarket', 'after-hours': 'after hours', overnight: 'overnight', closed: 'market closed' }

export const watchlistChangesServed = () => workflowServed(WORKFLOW, KINDS)

const sp = (v) => `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(2)}%`
const r2 = (v) => Math.round(v * 100) / 100
const quoteName = (s) => `“${s}”`

/** Pure: a `quotes` envelope + the asked symbols → { ok, rows (with change), noQuote, noChange, up, down, flat, gainers, decliners, asOf, session, stale } */
export function changesOf(env, symbols) {
  const usable = env && (env.status === 'ok' || env.status === 'partial') && Array.isArray(env.data?.quotes)
  if (!usable) return { ok: false }
  const bySym = new Map(env.data.quotes.filter(r => r && typeof r.symbol === 'string').map(r => [r.symbol.toUpperCase(), r]))
  const rows = []
  const noQuote = []
  const noChange = []
  for (const s of symbols) {
    const r = bySym.get(s)
    if (!r || num(r.last) == null) { noQuote.push(s); continue }
    if (num(r.change_pct) == null) { noChange.push(s); continue }
    rows.push({ symbol: s, pct: r2(r.change_pct) })
  }
  if (!rows.length) return { ok: false, noQuote, noChange }
  const up = rows.filter(r => r.pct > 0).length
  const down = rows.filter(r => r.pct < 0).length
  const byPct = [...rows].sort((a, b) => (b.pct - a.pct) || a.symbol.localeCompare(b.symbol))
  const gainers = byPct.filter(r => r.pct > 0).slice(0, TOP)
  const decliners = [...byPct].reverse().filter(r => r.pct < 0).slice(0, TOP)
  const movers = [...rows].sort((a, b) => (Math.abs(b.pct) - Math.abs(a.pct)) || a.symbol.localeCompare(b.symbol)).slice(0, NEWS_FOR).filter(r => r.pct !== 0)
  return { ok: true, rows, noQuote, noChange, up, down, flat: rows.length - up - down, gainers, decliners, movers,
    asOf: env.as_of || null, fetchedAt: env.fetched_at || null, session: env.data?.session || null, stale: !!env.stale }
}

/** Pure: a `news.company` envelope → { count, plus, stale } of items published in the NEWS_HOURS before `asOf`, or null. */
export function newsCountOf(env, asOf) {
  if (!env || env.status !== 'ok' || !Array.isArray(env.data?.items)) return null
  const end = Date.parse(asOf)
  if (!Number.isFinite(end)) return null
  const start = end - NEWS_HOURS * 3600 * 1000
  const items = env.data.items.filter(i => i && Number.isFinite(Date.parse(i.as_of)))
  const inWindow = items.filter(i => { const t = Date.parse(i.as_of); return t > start && t <= end })
  // the read is the newest NEWS_LIMIT items: when every one is in the window and more exist, the count is a floor
  const plus = inWindow.length === items.length && items.length >= NEWS_LIMIT && !!env.data.has_more
  return { count: inWindow.length, plus, stale: !!env.stale }
}

const NO_QUOTES = {
  refused: "that request wasn't allowed for this question",
  unavailable: 'its quotes are not available from UCT\'s market data',
}

/** The member's card (pure; exported for tests). `news` = { SYM: newsEnvelope }. → { text, table, present, changes } */
export function answerFromChanges(env, { name, symbols, total = null, news = {} }) {
  const list = quoteName(name || 'that watchlist')
  const c = changesOf(env, symbols)
  if (!c.ok) {
    const why = env && (env.status === 'ok' || env.status === 'partial') ? 'no symbol in it came back with a price change' : (NO_QUOTES[env?.status] || NO_QUOTES.unavailable)
    return { text: `I couldn't say what changed in ${list}: ${why}. No figure is stated.` }
  }
  const when = stampET(c.asOf || c.fetchedAt, null)
  const session = SESSION_WORDS[c.session] || null
  const lines = [`${list} — change vs each stock's previous session close, from UCT's quote snapshot as of ${when || 'an unstated time'}${session ? ` (${session})` : ''}:`]
  lines.push(`${c.rows.length} with a price change figure: ${c.up} up, ${c.down} down, ${c.flat} unchanged.`)
  if (c.gainers.length) lines.push(`Biggest gainers: ${c.gainers.map(r => `${r.symbol} ${sp(r.pct)}`).join(', ')}.`)
  if (c.decliners.length) lines.push(`Biggest decliners: ${c.decliners.map(r => `${r.symbol} ${sp(r.pct)}`).join(', ')}.`)
  // news counts for the largest movers, in the 24 hours to the snapshot
  const counts = []
  const noNews = []
  let newsStale = false
  for (const m of c.movers) {
    const n = newsCountOf(news[m.symbol], c.asOf || c.fetchedAt)
    if (!n) { noNews.push(m.symbol); continue }
    newsStale = newsStale || n.stale
    counts.push(`${m.symbol} ${n.count}${n.plus ? '+' : ''}`)
  }
  if (counts.length) lines.push(`Stored news items in the ${NEWS_HOURS} hours to ${when || 'the snapshot'} (largest movers): ${counts.join(', ')}.`)
  if (noNews.length) lines.push(`News count not available for: ${noNews.join(', ')}.`)
  if (newsStale) lines.push("Note: UCT's news ingest is behind, so recent items may be missing from these counts.")
  if (c.stale) lines.push('Note: some quotes are older than UCT\'s freshness window, so this may not reflect the latest trades.')
  if (c.noQuote.length) lines.push(`No quote for: ${c.noQuote.join(', ')}.`)
  if (c.noChange.length) lines.push(`No change figure for: ${c.noChange.join(', ')}.`)
  if (total != null && total > symbols.length) lines.push(`Only the first ${symbols.length} of the list's ${total} symbols were read (one quote read holds ${MAX_SYMBOLS}).`)
  lines.push(DESCRIPTIVE)
  const shown = [...c.gainers, ...c.decliners]
  const table = { columns: ['Symbol', '% vs previous close'], rows: [...c.rows].sort((a, b) => b.pct - a.pct).map(r => [r.symbol, r.pct.toFixed(2)]) }
  return {
    text: lines.join('\n'),
    table,
    present: { kind: 'table', title: `${name || 'Watchlist'} — what changed`, short: name || 'Watchlist', table, text: `${lines[0]}\n${DESCRIPTIVE}` },
    changes: { list: name || null, asOf: c.asOf, session: c.session, up: c.up, down: c.down, flat: c.flat, shown: shown.map(r => r.symbol), stale: c.stale },
  }
}

export async function answerWatchlistChanges(snap) {
  if (!watchlistChangesServed()) return "UCT's watchlist change summary isn't available to the Agent here."
  if (!snap) return "I couldn't find that watchlist."
  const all = [...new Set((snap.symbols || []).map(s => String(s || '').toUpperCase()).filter(Boolean))]
  if (!all.length) return `${quoteName(snap.name || 'That watchlist')} is empty, so nothing changed in it.`
  const symbols = all.slice(0, MAX_SYMBOLS)
  const turnId = currentTurnId()
  if (!turnId) return "I couldn't read the quotes: this needs the Agent's turn, which wasn't available."
  // ONE quotes read; then news counts for the largest movers only (literal kinds: agent-qa's isolation rail)
  const env = await readData('quotes', { symbols }, { purpose: 'answer', turnId })
  const c = changesOf(env, symbols)
  const news = {}
  if (c.ok) {
    for (const m of c.movers) news[m.symbol] = await readData('news.company', { symbol: m.symbol, limit: NEWS_LIMIT }, { purpose: 'answer', turnId })
  }
  return answerFromChanges(env, { name: snap.name, symbols, total: all.length, news })
}

// ── fast path (pure, fail-closed): the list must resolve to ONE of the member's lists ─────────────────────────────
const LEAD = "(?:what(?:'s| has| have| is)? (?:changed|moved|moving)(?: (?:in|on|with))?|how(?:'s| is| are| did)(?: the (?:stocks|names) (?:in|on))?|(?:show(?: me)? )?(?:the )?(?:biggest )?(?:movers|gainers and losers|winners and losers)(?: (?:in|on))?|summari[sz]e (?:the (?:moves|changes) (?:in|on) )?)"
const TAIL = "(?: (?:since|from) (?:yesterday|the (?:last|previous|prior) close|yesterday's close))?(?: (?:doing|do|going))?(?: today)?(?: since yesterday)?"
const PHRASE = new RegExp(`^${LEAD} (?:my |the )?(.+?(?:watch ?list|list))${TAIL}$`, 'i')
/** "what changed in my Momentum watchlist since yesterday" → the list's id, or null (the model decides). */
export function matchList(text, host) {
  if (!watchlistChangesServed() || !host?.watchlists) return null
  const s = String(text || '').replace(/[’`]/g, "'").trim().replace(/[?!.]+$/, '').replace(/\s+/g, ' ').trim()
  if (!s || s.length > 120) return null
  const m = PHRASE.exec(s)
  if (!m) return null
  const l = resolveListByName(host, m[1].replace(/^(?:my|the) /i, ''))
  return l ? l.id : null
}

// the watchlist group's extra words while this is registered ("movers in my list" / "what changed in my watchlist")
export const CHANGE_WORDS = [/\b(?:what(?:'s| has| have| is)? (?:changed|moved|moving)|movers|gainers|decliners|losers|how(?:'s| is| are) my)\b.*\b(?:watch ?lists?|lists?)\b/]

let registered = false
let unregister = null
/** Idempotent; registers nothing unless the workflow is switched on and `quotes` + `news.company` are served. */
export function registerWatchlistChangesCapability() {
  // a later config load that switches the workflow off takes the capability AND its routing words out (review #788 f)
  if (registered) { if (!watchlistChangesServed()) _resetWatchlistChangesForTest(); return false }
  if (!watchlistChangesServed()) return false
  registered = true
  unregister = registerCapability({
    name: 'watchlist.changes',        // a LITERAL: turn.DATA_READ_ACTIONS names it (the server blanks a pre-read reply)
    surfaces: ['charts'],
    target: 'watchlist', query: true,
    summary: 'WHAT CHANGED in ONE of the member\'s saved watchlists since the previous close: each stock\'s % move vs its previous session close from UCT\'s quote snapshot (dated), how many are up / down, '
      + 'the biggest gainers and decliners, and how many stored news items the biggest movers had in the 24 hours to the snapshot (counts only). UCT computes and words every figure. '
      + 'Use this (disposition apply, research null) for "what changed in my Momentum watchlist since yesterday", "how is my Earnings list doing today", "movers in my watchlist". Descriptive, never a recommendation.',
    hints: 'target = the ref of that watchlist (ask which when the member has several and names none). reply: one short line, no figures.',
    args: { type: 'object', properties: {}, required: [], additionalProperties: false },
    fastWhole: true,
    fast: ({ raw, host }) => { const id = matchList(raw, host); return id ? { __target: id } : null },
    answer: (snap) => answerWatchlistChanges(snap),
  })
  armGroupWords('lists', CHANGE_WORDS, true)
  return true
}
export const _resetWatchlistChangesForTest = () => { if (unregister) unregister(); unregister = null; registered = false; armGroupWords('lists', CHANGE_WORDS, false) }
