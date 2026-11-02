// UCT Agent market data — `stock.quote` (owner: agent-md). Contract: MD-1 v1.5 §4.5 + MD-1-phrasings.md.
//
// "What's NVDA trading at premarket?" answered DETERMINISTICALLY from the MD-1 `quote` / `quotes` kinds: no model
// call, no fetch of its own (every read goes through marketdata/client.js → POST /api/agent/data), and never
// /api/live-prices (that route can run the alert checker; a price read must never trigger an alert).
//
// What every answer carries (MD-1 §4.5): the price, the change ($ and %) against the previous close, the ACTUAL
// session (from the read's `session_detail`, never from the words the member used), the as-of time in ET (with the
// date when it is not the read's own day), and the freshness said in words:
//   • "live" only when the read is live and not stale. Nothing else ever uses the words live / now / right now.
//   • extended hours say "thin trading"; past the 15-minute window they read as the last extended print.
//   • overnight, weekends and holidays read "Market closed (…): last close $X (date)" — or "last trade" when the
//     price is an after-hours print rather than a close.
//   • stale and partial reads say so plainly, in the sentence that carries the price; unavailable states no number.
// Only { text, present, link, chart } leave this module: never the envelope, its notes array or provider fields.
//
// Dark by construction: unless the server serves data AND activates `quote`/`quotes` (`data_kinds`), `match`
// returns null, `registerMarketDataCapabilities` registers nothing (the model's manifest is unchanged) and
// `answerQuote` returns stock.profile's own answer, unchanged.

import { registerCapability } from '../capabilities'
import * as agentClient from '../agentClient'
import { readData } from '../marketdata/client'
import { currentTurnId } from '../trace'
import { answerProfile } from './stock'
import { parsePriceSentence, MAX_TICKERS } from './marketDataPhrases'

export const CAPABILITY = 'stock.quote'
const ET = 'America/New_York'
const LIVE_SOURCES = new Set(['trade', 'minute'])

// The gateway path is taken only while the server serves data AND activates `quote` (agent-lead #621:
// UCT_AGENT_DATA_KINDS → /api/agent/config `data_kinds`, fail closed). No accessor, no list, or `quote` absent ⇒ off.
export function quoteServed() {
  if (!agentClient.serverServesData()) return false
  const kinds = typeof agentClient.serverDataKinds === 'function' ? agentClient.serverDataKinds() : null
  return Array.isArray(kinds) && kinds.includes('quote') && kinds.includes('quotes')
}

const SESSION_WORDS = {
  regular: 'regular session', premarket: 'premarket', 'after-hours': 'after hours',
  overnight: 'overnight', closed: 'weekend or holiday',
}

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null)
export function money(v) {
  const n = num(v)
  if (n == null) return null
  const d = Math.abs(n) < 1 ? 4 : 2
  return `$${n.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d })}`
}
function signedMoney(v) {
  const n = num(v)
  if (n == null) return null
  return `${n >= 0 ? '+' : '−'}${money(Math.abs(n))}`
}
function signedPct(v) {
  const n = num(v)
  return n == null ? null : `${n >= 0 ? '+' : '−'}${Math.abs(n).toFixed(2)}%`
}
const etDay = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: ET, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d)
const etTime = (d) => new Intl.DateTimeFormat('en-US', { timeZone: ET, hour: 'numeric', minute: '2-digit' }).format(d)
const etDate = (d) => new Intl.DateTimeFormat('en-US', { timeZone: ET, weekday: 'short', month: 'short', day: 'numeric' }).format(d)

/** "10:31 AM ET", or "Fri, Oct 30, 7:59 PM ET" when the stamp is not on the read's own ET day. Pure: `ref` is the
 *  read's own fetched_at, never the browser clock. */
export function stampET(iso, refIso) {
  if (!iso) return null
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  const ref = refIso ? new Date(refIso) : null
  const sameDay = ref && !Number.isNaN(ref.getTime()) && etDay(ref) === etDay(d)
  return sameDay ? `${etTime(d)} ET` : `${etDate(d)}, ${etTime(d)} ET`
}
const dayET = (iso) => {
  const d = iso ? new Date(iso) : null
  return d && !Number.isNaN(d.getTime()) ? etDate(d) : null
}

function changeText(row) {
  const c = signedMoney(row.change)
  const p = signedPct(row.change_pct)
  if (!c && !p) return null
  return `${[c, p && (c ? `(${p})` : p)].filter(Boolean).join(' ')} vs the previous close`
}

/**
 * One row of a `quote`/`quotes` read → { line, figures }. `env` is the whole read (its freshness, stale flag,
 * session and fetched_at); `row` is one data row. Pure.
 */
export function describeRow(env, row) {
  const d = env.data || {}
  const detail = d.session_detail || (d.session === 'regular' ? 'regular' : d.session === 'extended' ? 'premarket' : 'closed')
  const rowLive = LIVE_SOURCES.has(row.last_source)
  const readLive = env.freshness === 'live'
  const live = readLive && !env.stale && rowLive
  const price = money(row.last)
  const when = stampET(row.as_of || env.as_of, env.fetched_at)
  const chg = changeText(row)
  const sym = row.symbol
  let line
  let fresh
  if (readLive && rowLive && detail === 'regular') {
    if (live) {
      fresh = 'live'
      line = `${sym} ${price}${chg ? `, ${chg}` : ''} — live, regular session${when ? `, as of ${when}` : ''}.`
    } else {
      fresh = 'stale'
      line = `${sym} ${price}${chg ? `, ${chg}` : ''} — stale, not a real-time price: the latest trade is ${when ? `from ${when}` : 'undated'}, more than a minute old (regular session).`
    }
  } else if (readLive && rowLive && (detail === 'premarket' || detail === 'after-hours')) {
    fresh = env.stale ? 'stale' : 'live'
    const where = detail === 'premarket' ? 'in premarket trading' : 'in after-hours trading'
    line = env.stale
      ? `${sym} ${price} ${where}${chg ? `, ${chg}` : ''} — stale, not a real-time price${when ? `: the latest print is from ${when}` : ''} (extended hours, thin trading).`
      : `${sym} ${price} ${where}${chg ? `, ${chg}` : ''} — live, extended hours (thin trading)${when ? `, as of ${when}` : ''}.`
  } else if (detail === 'overnight' || detail === 'closed') {
    fresh = 'closed'
    const isClose = row.last_source === 'day_close' || row.last_source === 'prev_close'
    const what = isClose ? 'last close' : 'last trade'
    const date = isClose ? dayET(row.as_of || env.as_of) : when
    line = `Market closed (${SESSION_WORDS[detail]}): ${sym} ${what} ${price}${date ? ` (${date})` : ''}${chg ? `, ${chg}` : ''}. Not a real-time price.`
  } else if (detail === 'premarket' || detail === 'after-hours') {
    fresh = 'delayed'
    const isClose = row.last_source === 'day_close' || row.last_source === 'prev_close'
    line = isClose
      ? `${sym}: no ${SESSION_WORDS[detail]} trade yet — the latest close is ${price}${when ? ` (as of ${when})` : ''}${chg ? `, ${chg}` : ''}. Not a real-time price.`
      : `${sym} last traded ${price}${when ? ` at ${when}` : ''} (${SESSION_WORDS[detail]}, no trade in the last 15 minutes)${chg ? `, ${chg}` : ''}. Not a real-time price.`
  } else {
    // regular session, but this row has no current trade (priced from a close)
    fresh = 'delayed'
    line = `${sym}: no current trade in the regular session — showing the ${row.last_source === 'prev_close' ? 'previous close' : "day's close"}, ${price}${when ? ` (as of ${when})` : ''}${chg ? `, ${chg}` : ''}. Not a real-time price.`
  }
  const figures = [
    { label: 'Price', value: price, note: fresh === 'live' ? (when ? `live, as of ${when}` : 'live') : (when ? `as of ${when}` : null), aka: ['price', 'quote', 'trading at', 'share price'] },
    { label: 'Change', value: [signedMoney(row.change), signedPct(row.change_pct)].filter(Boolean).join(' ') || null, note: 'vs the previous close', aka: ['change', 'up', 'down', 'move'] },
    { label: 'Session', value: SESSION_WORDS[detail] || detail, aka: ['session', 'premarket', 'after hours', 'overnight'] },
    { label: 'Freshness', value: { live: 'live', stale: 'stale', closed: 'market closed', delayed: 'not real-time' }[fresh], aka: ['freshness', 'live', 'delayed'] },
  ].filter(f => f.value)
  return { line, figures, fresh }
}

// The read-level lines a member needs and the per-row lines do not already say: what was missing. Built from the
// envelope's own coverage and rows (not by echoing its notes), so nothing provider-shaped can leak through.
function partialLines(env, asked) {
  const rows = rowsOf(env)
  const got = new Set(rows.map(r => r.symbol))
  const missing = asked.filter(s => !got.has(s))
  return missing.length ? [`Partial: no price for ${missing.join(', ')}.`] : []
}
const rowsOf = (env) => {
  const d = env?.data || {}
  const rows = d.quote ? [d.quote] : Array.isArray(d.quotes) ? d.quotes : []
  return rows.filter(r => r && typeof r.symbol === 'string' && num(r.last) != null)
}

const SOURCE_LINE = 'Source: Massive market snapshot through the UCT data gateway.'

/** A whole `quote`/`quotes` envelope → the member's answer. Pure; exported for the acceptance harness. */
export function answerFromEnvelope(env, asked) {
  const syms = (asked || []).map(s => String(s).toUpperCase())
  const usable = env && (env.status === 'ok' || env.status === 'partial')
  const rows = usable ? rowsOf(env) : []
  if (!rows.length) {
    const why = String((env?.notes || [])[0] || 'the price is not available').replace(/\.$/, '')
    return { text: `I couldn't get a price for ${syms.join(', ') || 'that'}: ${why}. The price is not available right here, so I'm not stating one.` }
  }
  const described = rows.map(r => describeRow(env, r))
  const lines = described.map(x => x.line)
  if (env.status === 'partial') lines.push(...partialLines(env, syms))
  lines.push(SOURCE_LINE)
  const one = rows.length === 1
  return {
    text: lines.join('\n'),
    present: one
      ? { kind: 'metrics', title: `${rows[0].symbol} quote`, short: rows[0].symbol, items: described[0].figures }
      : { kind: 'metrics', title: 'Quotes', short: rows.map(r => r.symbol).join(' · '), items: described.map((x, i) => ({ label: rows[i].symbol, value: money(rows[i].last), note: x.fresh === 'live' ? 'live' : { stale: 'stale', closed: 'market closed', delayed: 'not real-time' }[x.fresh], aka: [rows[i].symbol.toLowerCase()] })) },
  }
}

function cleanSymbols(args) {
  const list = Array.isArray(args?.symbols) ? args.symbols : args?.symbol != null ? [args.symbol] : []
  const out = []
  for (const s of list) {
    const u = String(s || '').trim().toUpperCase().replace(/^\$/, '')
    if (u && !out.includes(u)) out.push(u)
  }
  return out
}

/** The capability's answer. Flags off → stock.profile's own answer, unchanged (byte-identical by construction). */
export async function answerQuote(args) {
  const syms = cleanSymbols(args)
  if (!quoteServed()) {
    if (syms.length <= 1) return answerProfile({ symbol: syms[0] ?? args?.symbol })
    const each = await Promise.all(syms.map(s => answerProfile({ symbol: s })))
    return each.map(a => (typeof a === 'string' ? a : a.text)).join('\n\n')
  }
  if (!syms.length) return "Which ticker? I couldn't find a symbol in that."
  if (syms.length > MAX_TICKERS) return `That's more than ${MAX_TICKERS} tickers at once; ask for a few at a time.`
  // the member's open turn (trace.js): the server's per-turn budget key; never minted, never injected
  const turnId = currentTurnId()
  if (!turnId) return "I couldn't read the price: this needs the Agent's turn, which wasn't available."
  const env = syms.length === 1
    ? await readData('quote', { symbol: syms[0] }, { purpose: 'answer', turnId })
    : await readData('quotes', { symbols: syms }, { purpose: 'answer', turnId })
  return answerFromEnvelope(env, syms)
}

/** Fast path (agent-lead wires it into fastPath.js behind the data flag): pure, fail-closed. */
export function match(text) {
  if (!quoteServed()) return null
  const p = parsePriceSentence(text)
  if (!p || p.intent !== 'quote') return null
  return { action: CAPABILITY, params: { symbols: p.symbols } }
}

let registered = false
let unregister = null
/** Idempotent; registers nothing while the server does not serve the data gateway, so the model's manifest and
 *  every flags-off answer stay exactly as they are. Call it after /api/agent/config has loaded. */
export function registerMarketDataCapabilities() {
  if (registered || !quoteServed()) return false
  registered = true
  unregister = registerCapability({
    name: CAPABILITY,
    surfaces: ['charts'],
    target: 'market', query: true,
    summary: 'Answer what ONE to FIVE stocks are trading at — price, change vs the previous close, the market session '
      + '(regular, premarket, after hours, overnight, closed) and how fresh the price is — from UCT\'s market data. '
      + 'Use this (disposition apply, research null) for "what\'s NVDA trading at?", "AMD premarket", "NVDA and AMD after hours".',
    hints: 'target = the ref of the stockData entry; symbols = the tickers, uppercase. Not for fundamentals (stock.profile), news or "why is it moving".',
    args: { type: 'object', properties: { symbols: { type: 'array', items: { type: 'string' } } }, required: ['symbols'], additionalProperties: false },
    answer: (_snap, args) => answerQuote(args),
  })
  return true
}
export const _resetForTest = () => { if (unregister) unregister(); unregister = null; registered = false }
