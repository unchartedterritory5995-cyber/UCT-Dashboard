// UCT Agent market data — `stock.dailyBars` (owner: agent-md). Contract: MD-1 §4.6 + MD-1-phrasings.md (P18–P26).
//
// "How did AAPL close yesterday", "NVDA's 5-day change", "NVDA 52-week high", answered DETERMINISTICALLY from the
// MD-1 `bars.daily` kind: one gateway read, no model call, no fetch of its own, zero provider calls (the kind reads
// UCT's canonical bars store), and COMPLETED SESSIONS ONLY — today's developing bar is never used.
//
//   lastClose  bars: 2        the last completed session's close, and its change vs the session before
//   change     bars: n + 1    close-to-close over the last n completed sessions (weeks = 5 sessions each)
//   range52w   bars: 252      the highest high and lowest low of the last 252 completed sessions, with their dates
//
// Every answer names the session dates it used and says it is completed-session data; it never uses the words
// live / now. A store that is behind (`stale`) or holds fewer sessions than asked (`partial`) is said plainly, and
// the window actually covered is stated — nothing is extrapolated. A read with no usable bars answers in fixed words
// (never the envelope's notes). Only { text, present } leave this module.
//
// Dark by construction: unless the server serves data AND activates `bars.daily` (`data_kinds`), `match` returns
// null and `registerBarsCapability` registers nothing.

import { registerCapability } from '../capabilities'
import * as agentClient from '../agentClient'
import { readData } from '../marketdata/client'
import { currentTurnId } from '../trace'
import { parsePriceSentence } from './marketDataPhrases'
import { num, money, signedMoney, signedPct, sessionDate } from './marketDataFormat'
import { RESOLVE_KIND, toCandidates, resolveInstruments } from './marketDataResolve'

export const CAPABILITY = 'stock.dailyBars'
export const SESSIONS_52W = 252
export const MAX_CHANGE_SESSIONS = 250
const MEASURES = ['lastClose', 'change', 'range52w']
const INTENT_TO_MEASURE = { 'bars.lastClose': 'lastClose', 'bars.change': 'change', 'bars.range52w': 'range52w' }

export function barsServed() {
  if (!agentClient.serverServesData()) return false
  const kinds = typeof agentClient.serverDataKinds === 'function' ? agentClient.serverDataKinds() : null
  return Array.isArray(kinds) && kinds.includes('bars.daily') && kinds.includes(RESOLVE_KIND)
}

/** How many bars a measure reads (the kind's own cap is 500). */
export function barsFor(measure, sessions) {
  if (measure === 'lastClose') return 2
  if (measure === 'range52w') return SESSIONS_52W
  return Math.min(Math.max(1, sessions | 0), MAX_CHANGE_SESSIONS) + 1
}

const COMPLETED = "From UCT's daily bars: completed sessions only, today's session is not included."
const NO_BARS = {
  refused: "that request wasn't allowed for this question, so its daily bars are not available",
  unavailable: "its completed daily bars are not available from UCT's market data",
}
export function noBarsSentence(env, sym) {
  const why = NO_BARS[env?.status] || NO_BARS.unavailable
  return `I couldn't answer that for ${sym || 'that'}: ${why}. No price is stated.`
}

const usableBars = (env) => {
  const bars = env?.data?.bars
  return Array.isArray(bars) ? bars.filter(b => b && typeof b.date === 'string' && num(b.close) != null) : []
}

// what the read could not give, from its own flags and counts — never from its notes
function caveats(env, bars, want) {
  const out = []
  const through = env.data?.through || bars[bars.length - 1]?.date
  const latest = env.data?.latest_completed_session
  if (env.stale && latest && through && latest !== through) {
    out.push(`Note: UCT's bars for ${env.data?.symbol || 'it'} end ${sessionDate(through, latest)}, but the most recent completed session was ${sessionDate(latest, latest)}, so this is not the latest close.`)
  }
  if (want != null && bars.length < want) {
    out.push(`Only ${bars.length} completed session${bars.length === 1 ? '' : 's'} ${bars.length === 1 ? 'is' : 'are'} held (from ${sessionDate(bars[0].date, through)}), fewer than the ${want} asked for.`)
  }
  return out
}

/** A `bars.daily` envelope → the member's answer for `measure`. Pure; exported for the acceptance harness. */
export function answerFromBars(env, { symbol, measure, sessions = null, name = null }) {
  const bare = String(symbol || '').toUpperCase()
  // every executed answer names the security, from the symbol index (MD-1 §4.7.3)
  const sym = name ? `${bare} (${name})` : bare
  const usable = env && (env.status === 'ok' || env.status === 'partial')
  const bars = usable ? usableBars(env) : []
  if (!bars.length) return { text: noBarsSentence(env, bare) }
  const last = bars[bars.length - 1]
  const ref = last.date
  const lines = []
  let items = []

  if (measure === 'lastClose') {
    const prev = bars.length >= 2 ? bars[bars.length - 2] : null
    const chg = prev ? last.close - prev.close : null
    const pct = prev && prev.close ? (chg / prev.close) * 100 : null
    lines.push(`${sym} closed at ${money(last.close)} on ${sessionDate(last.date, ref)}, its last completed session`
      + (prev ? `: ${signedMoney(chg)} (${signedPct(pct)}) vs the previous close of ${money(prev.close)} on ${sessionDate(prev.date, ref)}.` : '. The session before it is not held, so no change is given.'))
    items = [
      { label: 'Close', value: money(last.close), note: sessionDate(last.date, ref), aka: ['close', 'closed', 'closing price'] },
      ...(prev ? [{ label: 'Change', value: `${signedMoney(chg)} (${signedPct(pct)})`, note: `vs ${sessionDate(prev.date, ref)}`, aka: ['change', 'up', 'down'] }] : []),
    ]
    lines.push(...caveats(env, bars, null))
  } else if (measure === 'change') {
    const n = Math.min(Math.max(1, sessions | 0), MAX_CHANGE_SESSIONS)
    const covered = bars.length - 1
    if (covered < 1) {
      lines.push(`Only one completed session is held for ${sym} (${sessionDate(last.date, ref)}, close ${money(last.close)}), so no change over ${n} sessions can be given.`)
    } else {
      const first = bars[0]
      const chg = last.close - first.close
      const pct = first.close ? (chg / first.close) * 100 : null
      const span = covered === n ? `the last ${n} completed session${n === 1 ? '' : 's'}` : `the last ${covered} completed session${covered === 1 ? '' : 's'} held (you asked for ${n})`
      lines.push(`${sym} over ${span}: ${signedPct(pct)} (${signedMoney(chg)}), from a close of ${money(first.close)} on ${sessionDate(first.date, ref)} to ${money(last.close)} on ${sessionDate(last.date, ref)}.`)
      items = [
        { label: `${covered}-session change`, value: `${signedPct(pct)} (${signedMoney(chg)})`, note: `${sessionDate(first.date, ref)} → ${sessionDate(last.date, ref)}`, aka: ['change', 'performance', 'move'] },
        { label: 'Last close', value: money(last.close), note: sessionDate(last.date, ref), aka: ['close'] },
      ]
    }
    lines.push(...caveats(env, bars, null))
  } else if (measure === 'range52w') {
    const withHi = bars.filter(b => num(b.high) != null)
    const withLo = bars.filter(b => num(b.low) != null)
    const hi = withHi.reduce((a, b) => (b.high > a.high ? b : a), withHi[0] || last)
    const lo = withLo.reduce((a, b) => (b.low < a.low ? b : a), withLo[0] || last)
    const full = bars.length >= SESSIONS_52W
    const span = full
      ? `52-week range (the last ${SESSIONS_52W} completed sessions, ${sessionDate(bars[0].date, ref)} to ${sessionDate(last.date, ref)})`
      : `range over the ${bars.length} completed sessions held (${sessionDate(bars[0].date, ref)} to ${sessionDate(last.date, ref)}), less than a full 52 weeks`
    lines.push(`${sym} ${span}: high ${money(num(hi.high) ?? hi.close)} on ${sessionDate(hi.date, ref)}, low ${money(num(lo.low) ?? lo.close)} on ${sessionDate(lo.date, ref)}. Last close ${money(last.close)} on ${sessionDate(last.date, ref)}.`)
    items = [
      { label: full ? '52-week high' : `${bars.length}-session high`, value: money(num(hi.high) ?? hi.close), note: sessionDate(hi.date, ref), aka: ['high', '52 week high', 'year high'] },
      { label: full ? '52-week low' : `${bars.length}-session low`, value: money(num(lo.low) ?? lo.close), note: sessionDate(lo.date, ref), aka: ['low', '52 week low', 'year low'] },
      { label: 'Last close', value: money(last.close), note: sessionDate(last.date, ref), aka: ['close'] },
    ]
    lines.push(...caveats(env, bars, null))
  } else {
    return { text: noBarsSentence({ status: 'unavailable' }, sym) }
  }
  lines.push(COMPLETED)
  return { text: lines.join('\n'), present: { kind: 'metrics', title: `${bare} daily`, short: bare, items: items.filter(i => i.value) } }
}

function cleanArgs(args) {
  const symbol = String(args?.symbol || '').trim()
  const measure = MEASURES.includes(args?.measure) ? args.measure : null
  const sessions = Number.isInteger(args?.sessions) ? args.sessions : null
  return { symbol, measure, sessions }
}

export async function answerDailyBars(args) {
  const { symbol, measure, sessions } = cleanArgs(args)
  if (!barsServed()) return "UCT's daily bars aren't available to the Agent here."
  const candidates = toCandidates([symbol])
  if (candidates.length !== 1) return "Which ticker? I couldn't find a symbol in that."
  if (!measure) return 'I can give the last close, the change over a number of sessions, or the 52-week high and low.'
  if (measure === 'change' && !(sessions >= 1)) return 'Over how many sessions? For example "NVDA 5-day change".'
  // MD-1 §4.7: the word is resolved against UCT's symbol index BEFORE any bars are read
  const r = await resolveInstruments(candidates)
  if (!r.ok) return r.text
  const resolved = r.symbols[0]
  // the member's open turn (trace.js): the server's per-turn budget key; never minted, never injected
  const turnId = currentTurnId()
  if (!turnId) return "I couldn't read the daily bars: this needs the Agent's turn, which wasn't available."
  const env = await readData('bars.daily', { symbol: resolved, bars: barsFor(measure, sessions) }, { purpose: 'answer', turnId })
  return answerFromBars(env, { symbol: resolved, measure, sessions, name: r.names[resolved] })
}

/** Fast path: pure, fail-closed; the bars rows of MD-1-phrasings.md. */
export function match(text) {
  if (!barsServed()) return null
  const p = parsePriceSentence(text)
  const measure = p ? INTENT_TO_MEASURE[p.intent] : null
  if (!measure) return null
  const sessions = measure === 'change' ? Math.min(p.n, MAX_CHANGE_SESSIONS) : null
  // the word AS TYPED: case is the evidence `instrument.resolve` classifies on (MD-1 §4.7.2)
  return { action: CAPABILITY, params: { symbol: p.candidates[0].text, measure, sessions } }
}

let registered = false
let unregister = null
/** Idempotent; registers nothing unless `bars.daily` is served and activated. Called by registerMarketDataCapabilities. */
export function registerBarsCapability() {
  if (registered || !barsServed()) return false
  registered = true
  unregister = registerCapability({
    name: CAPABILITY,
    surfaces: ['charts'],
    target: 'market', query: true,
    summary: 'Answer questions about ONE stock\'s COMPLETED daily sessions from UCT\'s daily bars: the last close and its change, '
      + 'the change over the last N sessions, or the 52-week high and low with their dates. Use this (disposition apply, research null) '
      + 'for "how did AAPL close yesterday", "NVDA 5-day change", "NVDA 52-week high". Never for today\'s price (stock.quote).',
    hints: 'target = the ref of the stockData entry; symbol uppercase; measure = lastClose | change | range52w; sessions = the N of an N-session change (weeks × 5), else null.',
    args: {
      type: 'object',
      properties: {
        symbol: { type: 'string' },
        measure: { type: 'string', enum: MEASURES },
        sessions: { type: ['integer', 'null'] },
      },
      required: ['symbol', 'measure', 'sessions'],
      additionalProperties: false,
    },
    fastWhole: true,
    fastCorrect: false,
    fast: ({ raw }) => { const m = match(raw); return m ? m.params : null },
    answer: (_snap, args) => answerDailyBars(args),
  })
  return true
}
export const _resetBarsForTest = () => { if (unregister) unregister(); unregister = null; registered = false }
