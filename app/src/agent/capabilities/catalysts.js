// UCT Agent — market-moving NEWS + CATALYSTS (Phase 2): UCT's catalyst board, one generalized capability.
//
//   news.movers   what UCT's catalyst engine flagged today (or on a recent day / the last N stored boards): each stock's
//                 catalyst type, grade, opening gap, new vs continuing, when its catalyst news first appeared, the
//                 headlines the engine stored beside it and the engine's own write-up — the whole board, only the
//                 member's tickers / one of their watchlists, or one of the board's stored sectors.
//                 "what's moving the market today", "why is NVDA up", "any catalysts for my watchlist this week".
//
// DATA: ONE `catalysts.board` gateway read (api/services/uct_agent/marketdata/catalysts_board.py: the catalyst engine's own
// store, read-only). For "why is X moving" when X is NOT on the board, ONE `news.company` read (when served) shows the
// stored headlines for X — labelled co-occurring, never a cause.
// HONESTY: a headline beside a move is said to CO-OCCUR with it; UCT never states it caused the move; the write-up is
// labelled the engine's AI summary (not verified); nothing is predicted. Headlines are quoted exactly as stored.
// GROUNDING: the text is templated from `facts` (returned beside it): every number, time and quoted string is a fact's.
// ⛔ LOCAL ONLY (turn.LOCAL_ONLY_ACTIONS; catalysts.board is model-isolated): the model plans the lookup and never sees
// what came back — a headline can never become a model's stated cause.
//
// Dark by construction: registered only while the server serves `catalysts.board` (UCT_AGENT_DATA_KINDS, fail-closed;
// isolated kinds also need UCT_AGENT_ISOLATED). Its routing group's words are armed only while it is registered
// (routing.js keeps them empty), so a dark server routes exactly as before.

import { registerCapability } from '../capabilities'
import * as agentClient from '../agentClient'
import { readData } from '../marketdata/client'
import { currentTurnId } from '../trace'
import { GROUPS } from '../routing'
import { stampET } from './marketDataFacts'
import { dayOf as dayWord } from './calendar'
import { resolveListByName } from './watchlist'

export const CAPABILITY = 'news.movers'
export const KIND = 'catalysts.board'
export const MAX_SYMBOLS = 50
export const MAX_DAYS = 5
const TEXT_ROWS = 10
const TEXT_HEADLINES = 2
const WRITEUP_TEXT = 220

const NO_TURN = "this needs the Agent's turn, which wasn't available"
const NO_READ = {
  refused: "that request wasn't allowed for this question, so the board wasn't read",
  unavailable: "UCT's catalyst database could not be read right now",
}
export const COOCCUR = 'These headlines are the ones UCT stored beside each move: they co-occurred with it, and UCT does not establish that they caused it. Nothing here is a prediction.'
export const SOURCE_LINE = "Source: UCT's catalyst engine (the Morning Wire catalyst board), from UCT's stored data — not a live web search."
const NONE_STATED = 'No catalyst is stated.'

export function catalystsServed() {
  if (!agentClient.serverServesData()) return false
  const kinds = typeof agentClient.serverDataKinds === 'function' ? agentClient.serverDataKinds() : null
  return Array.isArray(kinds) && kinds.includes(KIND)
}

// ── formatting (pure) ──────────────────────────────────────────────────────────────────────────────────────────────────
/** "2026-11-13" → "Fri, Nov 13, 2026" (a calendar date: noon UTC, so no zone moves it). */
export function dayText(ymd) {
  if (typeof ymd !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return null
  return new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(`${ymd}T12:00:00Z`))
}
const r1 = (v) => (typeof v === 'number' && Number.isFinite(v) ? Math.sign(v) * Math.round(Math.abs(v) * 10) / 10 : null)
const pct = (v) => (v == null ? null : `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toFixed(1)}%`)
const clip = (s, n) => { const t = String(s || '').replace(/\s+/g, ' ').trim(); return t.length > n ? `${t.slice(0, n - 1).trimEnd()}…` : t }
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`
const andList = (xs) => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`)

// ── the facts (pure; exported for tests) ──────────────────────────────────────────────────────────────────────────────
/** One board row → its facts. `ref` = the read's fetched_at (a time on another ET day is written with its date). */
export function rowFacts(r, ref) {
  const heads = (Array.isArray(r?.headlines) ? r.headlines : []).filter(h => h && typeof h.title === 'string' && h.title)
  return {
    symbol: String(r.symbol || ''), date: r.market_date, day: dayText(r.market_date), rank: r.rank ?? null,
    type: r.catalyst_type || null, tag: r.tag && r.tag !== r.catalyst_type ? r.tag : null, grade: r.grade || null,
    gap_pct: r1(r.gap_pct), gap: pct(r1(r.gap_pct)), sector: r.sector || null, is_new: !!r.is_new, pre_move: !!r.pre_move,
    first_news: r.catalyst_at ? stampET(r.catalyst_at, ref) : null,
    writeup: r.writeup ? clip(r.writeup, WRITEUP_TEXT) : null, writeup_at: r.writeup_at ? stampET(r.writeup_at, ref) : null,
    headlines: heads.map(h => ({ title: h.title, source: h.source || null, when: h.published_at ? stampET(h.published_at, ref) : null })),
    headline_count: Number.isInteger(r.headline_count) ? r.headline_count : heads.length,
    headlines_redacted: !!r.headlines_redacted,
  }
}

function headlineLine(h) {
  const meta = [h.source, h.when].filter(Boolean).join(', ')
  return `   Headline: “${h.title}”${meta ? ` — ${meta}` : ''}`
}

function rowLines(f, { detail, multiDay }) {
  const what = [f.type, f.tag].filter(Boolean).join(' · ') || 'catalyst (type not stated)'
  const bits = [what]
  if (f.grade) bits.push(`grade ${f.grade}`)
  if (f.gap) bits.push(`gap ${f.gap}`)
  bits.push(f.is_new ? 'new on the board' : 'continuing from an earlier board')
  if (f.pre_move) bits.push('flagged before the stock reacted')
  const lines = [`• ${f.symbol}${multiDay ? ` (${f.day})` : ''} — ${bits.join(' · ')}${f.first_news ? `; catalyst news first seen ${f.first_news}` : ''}.`]
  for (const h of f.headlines.slice(0, detail ? TEXT_HEADLINES : 1)) lines.push(headlineLine(h))
  if (!f.headlines.length) {
    lines.push(f.headlines_redacted ? '   Headline text for this older board is no longer stored.'
      : '   No stored headline for this entry.')
  }
  if (detail && f.writeup) lines.push(`   Engine write-up (AI-generated${f.writeup_at ? ` ${f.writeup_at}` : ''}, not verified): “${f.writeup}”`)
  return lines
}

/** The stored headlines for ONE symbol that is not on the board (a `news.company` envelope) → lines + facts. */
export function newsFacts(newsEnv, symbol, ref) {
  const ok = !!newsEnv && (newsEnv.status === 'ok' || newsEnv.status === 'partial') && newsEnv.data && Array.isArray(newsEnv.data.items)
  if (!ok) return null
  const items = newsEnv.data.items.filter(i => i && typeof i.headline === 'string' && i.headline).slice(0, 3)
    .map(i => ({ title: i.headline, source: i.source || null, when: i.as_of ? stampET(i.as_of, ref) : null }))
  return { symbol, items, ingest_stale: !!newsEnv.stale }
}

/**
 * The `catalysts.board` envelope (+ an optional `news.company` envelope for one symbol not on the board) → the member's
 * answer + its facts (pure; exported for tests).
 */
export function answerFromBoard(envl, { symbols = [], sector = null, newsEnv = null, watchlist = null, truncated = null } = {}) {
  const usable = !!envl && (envl.status === 'ok' || envl.status === 'partial') && envl.data && typeof envl.data === 'object'
  if (!usable) return { text: `I couldn't read UCT's catalyst board: ${NO_READ[envl?.status] || NO_READ.unavailable}. ${NONE_STATED}` }
  const d = envl.data
  const ref = envl.fetched_at
  if (d.state === 'absent') return { text: `UCT's catalyst board isn't stored on this server, so I can't say what UCT's catalyst engine flagged. ${NONE_STATED}`, facts: { state: 'absent' } }
  const dates = Array.isArray(d.dates) ? d.dates : []
  const boards = Array.isArray(d.boards) ? d.boards : []
  const rows = (Array.isArray(d.rows) ? d.rows : []).map(r => rowFacts(r, ref))
  const notOn = Array.isArray(d.not_on_board) ? d.not_on_board : []
  const multiDay = dates.length > 1
  const scope = watchlist ? `your ${watchlist} watchlist` : symbols.length ? andList(symbols) : sector ? `the ${sector} sector` : null
  const facts = {
    requested: d.requested_date, requested_day: dayText(d.requested_date), dates, days: dates.map(dayText), board_count: dates.length, stale: !!envl.stale,
    boards: boards.map(b => ({ date: b.market_date, flagged: b.flagged, updated: b.refreshed_at ? stampET(b.refreshed_at, ref) : null })),
    rows, not_on_board: notOn, sector, sectors: d.sectors || [], scope, watchlist, truncated,
    // every count the text states (grounding)
    flagged_total: boards.reduce((a, b) => a + (b.flagged || 0), 0), flagged_stocks: new Set(rows.map(r => r.symbol)).size,
    shown: rows.length, more_in_table: Math.max(rows.length - TEXT_ROWS, 0),
  }
  const lines = []
  if (!dates.length) {
    lines.push(`UCT has no stored catalyst board for ${facts.requested_day}${(envl.params_echo?.days || 1) > 1 ? ' or the days before it' : ''}. ${NONE_STATED}`)
    return { text: lines.join('\n'), facts }
  }
  const b0 = facts.boards[0]
  if (d.requested_missing) lines.push(`There is no stored catalyst board for ${facts.requested_day}; the newest stored board is ${facts.days[0]}.`)
  const span = multiDay ? `the last ${plural(facts.board_count, 'stored board')} (${facts.days.at(-1)} to ${facts.days[0]})` : `${facts.days[0]}`
  const updated = b0.updated ? ` (board updated ${b0.updated})` : ''
  if (truncated) lines.push(`Your ${watchlist} watchlist has ${truncated.of} symbols; I checked the first ${truncated.checked}.`)
  if (scope) {
    const n = facts.flagged_stocks
    lines.push(rows.length
      ? `UCT's catalyst board, ${span}${updated}: ${plural(n, 'stock')} from ${scope} ${n === 1 ? 'was' : 'were'} flagged by UCT's catalyst engine.`
      : `UCT's catalyst board, ${span}${updated}: nothing from ${scope} was flagged by UCT's catalyst engine.`)
  } else {
    const flagged = facts.flagged_total
    lines.push(`UCT's catalyst board, ${span}${updated}: ${plural(flagged, 'stock')} flagged by UCT's catalyst engine${rows.length < flagged ? `; the top ${facts.shown} by the board's rank below` : ''}.`)
  }
  const detail = rows.length <= 3
  for (const f of rows.slice(0, TEXT_ROWS)) lines.push(...rowLines(f, { detail, multiDay }))
  if (rows.length > TEXT_ROWS) lines.push(`(${facts.more_in_table} more in the table.)`)
  if (sector && !rows.length && facts.sectors.length) lines.push(`No stock on the board is in a stored sector named “${sector}”. Sectors on the board: ${facts.sectors.join(', ')}.`)
  if (notOn.length) {
    lines.push(`Not on the board${multiDay ? ' on those days' : ''}: ${andList(notOn)}. The engine flags a short list of stocks each day, so this is not a sign ${notOn.length === 1 ? 'it' : 'they'} had no news.`)
  }
  const nf = notOn.length === 1 ? newsFacts(newsEnv, notOn[0], ref) : null
  if (nf) {
    facts.news = nf
    if (nf.items.length) {
      lines.push(`The newest headlines UCT's news feed stored for ${nf.symbol} (co-occurring only, not an established cause):`)
      for (const h of nf.items) lines.push(headlineLine(h))
    } else lines.push(`UCT's news feed has no stored headline for ${nf.symbol}.`)
    if (nf.ingest_stale) lines.push('Note: UCT\'s news ingest is behind, so recent stories may be missing.')
  }
  if (envl.stale) {
    lines.push(d.requested_missing ? "Stale: today's board should already be stored and isn't, so today's catalysts are missing."
      : `Stale: the board was last updated ${b0.updated || 'at an unstated time'}, over 2 hours ago, so newer catalysts may be missing.`)
  }
  if (rows.length || nf?.items?.length) lines.push(COOCCUR)
  lines.push(SOURCE_LINE)
  const table = rows.length ? {
    columns: [...(multiDay ? [{ key: 'day', label: 'Board' }] : []), { key: 'symbol', label: 'Symbol' }, { key: 'what', label: 'Catalyst' },
      { key: 'grade', label: 'Grade' }, { key: 'gap', label: 'Gap' }, { key: 'first', label: 'First news' }, { key: 'headline', label: 'Headline (stored)' }],
    rows: rows.map(f => ({ ...(multiDay ? { day: f.day } : {}), symbol: f.symbol, what: [f.type, f.tag].filter(Boolean).join(' · ') || '—',
      grade: f.grade || '—', gap: f.gap || '—', first: f.first_news || '—', headline: f.headlines[0] ? clip(f.headlines[0].title, 140) : '—' })),
  } : null
  return {
    text: lines.join('\n'),
    ...(table ? { table } : {}),
    facts,
    link: rows.length === 1 || symbols.length === 1
      ? { href: `/research/${encodeURIComponent(rows[0]?.symbol || symbols[0])}`, label: `Open ${rows[0]?.symbol || symbols[0]} in Research` }
      : { href: '/catalysts/history', label: 'Open Catalysts History' },
  }
}

// ── the read ───────────────────────────────────────────────────────────────────────────────────────────────────────────
const TICKER = /^[A-Z][A-Z0-9.-]{0,9}$/
const upper = (s) => String(s || '').trim().toUpperCase().replace(/^\$/, '')

export async function answerMovers(args = {}, host = null) {
  let symbols = [...new Set((Array.isArray(args.symbols) ? args.symbols : []).map(upper).filter(s => TICKER.test(s)))]
  let watchlist = null
  let truncated = null
  if (typeof args.watchlist === 'string' && args.watchlist.trim()) {
    if (!host?.watchlists) return { text: `Your watchlists aren't available on this page, so I couldn't read “${args.watchlist}”. ${NONE_STATED}` }
    const list = resolveListByName(host, args.watchlist)
    if (!list) return { text: `I couldn't tell which watchlist “${args.watchlist}” is. ${NONE_STATED}` }
    const syms = (list.items || []).map(i => upper(i.sym)).filter(s => TICKER.test(s))
    if (!syms.length) return { text: `Your ${list.name} watchlist has no stocks in it. ${NONE_STATED}` }
    watchlist = list.name
    symbols = [...new Set([...symbols, ...syms])]
  }
  if (symbols.length > MAX_SYMBOLS) { truncated = { of: symbols.length, checked: MAX_SYMBOLS }; symbols = symbols.slice(0, MAX_SYMBOLS) }
  const params = {}
  if (args.date != null && String(args.date).trim()) {
    const ymd = dayWord(args.date)
    if (!ymd) return { text: `I couldn't read “${args.date}” as a day. ${NONE_STATED}` }
    params.date = ymd
  }
  const days = Number.isInteger(args.days) ? Math.min(Math.max(args.days, 1), MAX_DAYS) : 1
  if (days > 1) params.days = days
  if (symbols.length) params.symbols = symbols
  const sector = typeof args.sector === 'string' && args.sector.trim() ? args.sector.trim().slice(0, 60) : null
  if (sector) params.sector = sector
  const turnId = currentTurnId()
  if (!turnId) return { text: `I couldn't read UCT's catalyst board: ${NO_TURN}.` }
  const envl = await readData('catalysts.board', params, { purpose: 'answer', turnId })   // a LITERAL: qa/modelIsolation reads it
  let newsEnv = null
  const notOn = envl?.data?.not_on_board
  if (symbols.length === 1 && Array.isArray(notOn) && notOn.length === 1 && envl?.data?.state === 'ok' && catalystsNewsServed()) {
    newsEnv = await readData('news.company', { symbol: notOn[0], limit: 3 }, { purpose: 'answer', turnId })
  }
  return answerFromBoard(envl, { symbols: watchlist ? [] : symbols, sector, newsEnv, watchlist, truncated })
}
function catalystsNewsServed() {
  const kinds = typeof agentClient.serverDataKinds === 'function' ? agentClient.serverDataKinds() : null
  return agentClient.serverServesData() && Array.isArray(kinds) && kinds.includes('news.company')
}

// ── routing words (armed only while registered; routing.js keeps the group's words empty) ──────────────────────────────
const MOVE = '(?:up|down|moving|higher|lower|gapping|gapped|jumping|jumped|falling|fell|dropping|dropped|rallying|rallied|ripping|tanking|soaring|sinking|surging|plunging|spiking|selling off|running)'
export const CATALYST_ROUTE_WORDS = [
  /\bwhat(?:'s|s| is| are)? (?:moving|driving|pushing|lifting|hitting|dragging|moved|drove) (?:the )?(?:market|stocks|tape|names)\b|\bwhat(?:'s|s| is) moving (?:today|this morning|premarket|pre-market)\b/,
  /\bcatalyst (?:board|list|table|tile|movers?)\b|\b(?:any |today'?s |the )catalysts? (?:today|this morning|this week|right now)\b|\bcatalysts? (?:today|this morning|this week)\b|\btoday'?s catalysts?\b/,
  /\bcatalysts?\b.*\b(?:my|the|this) (?:watch ?list|charts?|portfolio|holdings|names|list)\b|\bcatalysts?\b.*\bon my\b/,
  new RegExp(`\\bwhy (?:is|are|did|was) \\$?[a-z][a-z.]{0,5} ${MOVE}\\b`),
  /\bwhat news (?:hit|moved|is moving|drove|is driving|is hitting)\b|\bnews (?:hit|that moved|moving)\b.*\b(?:semis|sector|stocks|market|names|today)\b/,
  /\b(?:today'?s|premarket|pre-market|morning) (?:movers|gappers)\b|\bmovers? (?:today|this morning) (?:and|with) (?:why|news|catalysts?)\b|\bwhy (?:are|is) (?:the )?(?:movers|gappers)\b/,
]
const catalystsGroup = () => GROUPS.find(g => g.id === 'catalysts')
function armRoutes(on) {
  const g = catalystsGroup()
  if (g) g.words.splice(0, g.words.length, ...(on ? CATALYST_ROUTE_WORDS : []))
}

let registered = false
let unregister = null
/** Idempotent; registers news.movers ONLY while the server serves `catalysts.board` (builtins.registerServerGatedBuiltins). */
export function registerCatalystsCapability() {
  if (registered || !catalystsServed()) return false
  registered = true
  armRoutes(true)
  const un = registerCapability({
    name: 'news.movers',              // a LITERAL: the server's local-only mirror rail reads it (tests/test_uct_agent_breadth.py)
    surfaces: ['*'],
    target: 'market', query: true,
    localOnly: true,                  // ⛔ shown to the member; the model never sees a headline or a write-up (turn.LOCAL_ONLY_ACTIONS)
    summary: 'UCT\'s CATALYST BOARD: the stocks UCT\'s catalyst engine flagged today or on recent days, each with its catalyst type, grade, gap, when the news first hit, '
      + 'the stored headlines and the engine\'s write-up; the whole board, some tickers, a watchlist or one sector. For "what\'s moving the market", "why is NVDA up today", '
      + '"catalysts for my watchlist this week".',
    hints: 'target = the ref of the stockData entry. symbols = the tickers named (or the open charts\' symbols), null = the whole board; '
      + 'watchlist = the name of the member\'s watchlist for "my watchlist" / "my Momentum list", else null; sector = a sector the member named, else null; '
      + 'date = today|yesterday|a weekday|YYYY-MM-DD (null = today); days = how many recent boards, 1-5 ("this week" = 5, null = 1). '
      + 'One stock\'s whole catalyst history: news.catalysts; its news feed: news.latest. reply: one short line, no figures, no causes.',
    args: {
      type: 'object',
      properties: {
        symbols: { type: ['array', 'null'], items: { type: 'string' } },
        watchlist: { type: ['string', 'null'] },
        sector: { type: ['string', 'null'] },
        date: { type: ['string', 'null'] },
        days: { type: ['integer', 'null'] },
      },
      required: ['symbols', 'watchlist', 'sector', 'date', 'days'], additionalProperties: false,
    },
    answer: (_snap, args, host) => answerMovers(args || {}, host),
  })
  unregister = () => { un?.(); armRoutes(false) }
  return true
}
export const _resetCatalystsForTest = () => { if (unregister) unregister(); else armRoutes(false); unregister = null; registered = false }
