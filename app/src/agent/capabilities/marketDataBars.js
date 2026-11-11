// UCT Agent market data — `stock.dailyBars` (owner: agent-md). Contract: MD-1 §4.6 + MD-1-phrasings.md (P18–P26).
//
// "How did AAPL close yesterday", "NVDA's 5-day change", "NVDA 52-week high", answered DETERMINISTICALLY from the
// MD-1 `bars.daily` kind: one gateway read, no model call, no fetch of its own, zero provider calls (the kind reads
// UCT's canonical bars store), and COMPLETED SESSIONS ONLY — today's developing bar is never used.
//
//   lastClose  bars: 2        the last completed session's close, and its change vs the session before
//   change     bars: n + 1    close-to-close over the last n completed sessions (weeks = 5 sessions each)
//   range52w   bars: 252      the highest high and lowest low of the last 252 completed sessions, with their dates
//   session    bars: 1        ONE session's open / high / low / close / volume (W1-B: "AAPL high on 2026-10-15")
//   range      bars: n        the highest high and lowest low of n sessions ("TSLA range last week" = 5), or of a
//                             calendar month ("last month": the bars of that month), or — W2-B2 — a window
//                             "from X to Y" through the adapter's `from` (+ `to`)
//   offHigh    bars: 252        W2-B2: how far the last close sits below the 52-week high (the highest high), with dates
//   pullbacks  bars: 252        W2-B2: the pullback in progress (close-to-close from the highest close) beside the last
//                             three COMPLETED pullbacks of MIN_PULLBACK_PCT+ (peak → low → the close that recovered it)
//   ⭐ W1-B (2026-11-02) POINT IN TIME: every measure takes `date` — an ISO day or the member's date words
//   (agent/dateWords.js: "last friday", "yesterday", "oct 15", "last week", "last month") — and the read is ONE
//   bars.daily read ending at that day through the adapter's own `to` (api/services/uct_agent/marketdata/
//   bars_daily.py: the newest COMPLETED session on or before it; nothing after it is read). The adapter has no
//   `from`: a calendar month reads the bars up to its end and keeps the ones dated in it.
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
import { resolveDateWord, dayWord } from '../dateWords'
import { RESOLVE_KIND, toCandidates, resolveInstruments, isFundLabel, FUND_NOTE } from './marketDataResolve'

export const CAPABILITY = 'stock.dailyBars'
export const SESSIONS_52W = 252
export const MAX_CHANGE_SESSIONS = 250
export const MIN_PULLBACK_PCT = 3
export const PULLBACKS_SHOWN = 3
const MEASURES = ['lastClose', 'change', 'range52w', 'session', 'range', 'offHigh', 'pullbacks']
const MONTH_BARS = 23                       // a calendar month has at most 23 sessions
const INTENT_TO_MEASURE = { 'bars.lastClose': 'lastClose', 'bars.change': 'change', 'bars.range52w': 'range52w' }

export function barsServed() {
  if (!agentClient.serverServesData()) return false
  const kinds = typeof agentClient.serverDataKinds === 'function' ? agentClient.serverDataKinds() : null
  return Array.isArray(kinds) && kinds.includes('bars.daily') && kinds.includes(RESOLVE_KIND)
}

/** How many bars a measure reads (the kind's own cap is 500). */
export function barsFor(measure, sessions, { month = false } = {}) {
  if (measure === 'lastClose') return 2
  if (measure === 'range52w' || measure === 'offHigh' || measure === 'pullbacks') return SESSIONS_52W
  if (measure === 'session') return 1
  if (measure === 'range') return month ? MONTH_BARS : Math.min(Math.max(1, sessions | 0), MAX_CHANGE_SESSIONS)
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
function caveats(env, bars, want, asked = null) {
  const out = []
  const through = env.data?.through || bars[bars.length - 1]?.date
  const latest = env.data?.latest_completed_session
  if (env.stale && latest && through && latest !== through) {
    // with a point-in-time read the adapter's "latest" is the last completed session on or before the asked day
    out.push(asked
      ? `Note: UCT's bars for ${env.data?.symbol || 'it'} end ${sessionDate(through, latest)}, but the last completed session on or before ${dayWord(asked)} was ${sessionDate(latest, latest)}, so this is an earlier session than asked.`
      : `Note: UCT's bars for ${env.data?.symbol || 'it'} end ${sessionDate(through, latest)}, but the most recent completed session was ${sessionDate(latest, latest)}, so this is not the latest close.`)
  }
  if (want != null && bars.length < want) {
    out.push(`Only ${bars.length} completed session${bars.length === 1 ? '' : 's'} ${bars.length === 1 ? 'is' : 'are'} held (from ${sessionDate(bars[0].date, through)}), fewer than the ${want} asked for.`)
  }
  return out
}

// ⭐ W1-B: the day a point-in-time answer was asked for ({ to, word, sessions?, month? } from dateWords), as the
// answer names it: "on Thu, Oct 15" when the bar IS that day, else "the last completed session on or before …".
const askedWord = (d) => (d?.word && d.word !== d.to ? `${d.word} (${dayWord(d.to)})` : dayWord(d?.to))
const onOrBefore = (bar, d) => (!d ? ', its last completed session' : bar.date === d.to ? '' : `, the last completed session on or before ${askedWord(d)}`)
const monthWord = (ym) => new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', month: 'long', year: 'numeric' }).format(new Date(`${ym}-15T12:00:00Z`))
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`

/**
 * W2-B2: close-to-close pullbacks over ascending bars (pure). A pullback runs from the highest close so far (its
 * peak) to the lowest close before a HIGHER close appears (recovery); only those MIN_PULLBACK_PCT or deeper count as
 * completed. `current` is the drawdown in progress from the latest peak (null when the last close IS the peak).
 */
export function pullbacksOf(bars) {
  if (!bars.length) return { current: null, completed: [] }
  let peak = bars[0]; let peakIdx = 0; let trough = null; let troughIdx = -1
  const completed = []
  for (let i = 1; i < bars.length; i++) {
    const b = bars[i]
    if (b.close > peak.close) {
      const depthPct = trough ? (trough.close / peak.close - 1) * 100 : 0
      if (trough && depthPct <= -MIN_PULLBACK_PCT) completed.push({ peak, trough, recovered: b, depthPct, toLow: troughIdx - peakIdx, toRecover: i - troughIdx })
      peak = b; peakIdx = i; trough = null; troughIdx = -1
    } else if (!trough || b.close < trough.close) { trough = b; troughIdx = i }
  }
  const last = bars[bars.length - 1]
  const current = last.close >= peak.close ? null
    : { peak, trough, depthPct: (last.close / peak.close - 1) * 100, lowPct: trough ? (trough.close / peak.close - 1) * 100 : null, sessions: bars.length - 1 - peakIdx }
  return { current, completed }
}

/** A `bars.daily` envelope → the member's answer for `measure`. Pure; exported for the acceptance harness. */
export function answerFromBars(env, { symbol, measure, sessions = null, name = null, date = null }) {
  const bare = String(symbol || '').toUpperCase()
  // every executed answer names the security, from the symbol index (MD-1 §4.7.3)
  const sym = name ? `${bare} (${name})` : bare
  const usable = env && (env.status === 'ok' || env.status === 'partial')
  let bars = usable ? usableBars(env) : []
  // a calendar-month window: the read ended at the month's last day; keep the bars dated in that month
  if (measure === 'range' && date?.month) bars = bars.filter(b => b.date.startsWith(date.month))
  if (!bars.length) return { text: usable && date?.month ? `No completed sessions are held for ${bare} in ${monthWord(date.month)}. No price is stated.` : noBarsSentence(env, bare) }
  const last = bars[bars.length - 1]
  const ref = last.date
  const asked = date?.to || null
  const lines = []
  let items = []

  if (measure === 'lastClose') {
    const prev = bars.length >= 2 ? bars[bars.length - 2] : null
    const chg = prev ? last.close - prev.close : null
    const pct = prev && prev.close ? (chg / prev.close) * 100 : null
    lines.push(`${sym} closed at ${money(last.close)} on ${sessionDate(last.date, ref)}${onOrBefore(last, date)}`
      + (prev ? `: ${signedMoney(chg)} (${signedPct(pct)}) vs the previous close of ${money(prev.close)} on ${sessionDate(prev.date, ref)}.` : '. The session before it is not held, so no change is given.'))
    items = [
      { label: 'Close', value: money(last.close), note: sessionDate(last.date, ref), aka: ['close', 'closed', 'closing price'] },
      ...(prev ? [{ label: 'Change', value: `${signedMoney(chg)} (${signedPct(pct)})`, note: `vs ${sessionDate(prev.date, ref)}`, aka: ['change', 'up', 'down'] }] : []),
    ]
    lines.push(...caveats(env, bars, null, asked))
  } else if (measure === 'session') {
    const o = num(last.open), h = num(last.high), l = num(last.low)
    const v = Number.isFinite(last.volume) ? last.volume : null
    const parts = [o != null ? `open ${money(o)}` : null, h != null ? `high ${money(h)}` : null, l != null ? `low ${money(l)}` : null, `close ${money(last.close)}`].filter(Boolean)
    lines.push(`${sym} on ${sessionDate(last.date, ref)}${onOrBefore(last, date)}: ${parts.join(', ')}${h != null && l != null ? ` (a ${money(h - l)} range)` : ''}${v != null ? `; volume ${v.toLocaleString('en-US')}` : ''}.`)
    items = [
      ...(o != null ? [{ label: 'Open', value: money(o), note: sessionDate(last.date, ref), aka: ['open', 'opened', 'opening price'] }] : []),
      ...(h != null ? [{ label: 'High', value: money(h), note: sessionDate(last.date, ref), aka: ['high', 'session high', 'day high'] }] : []),
      ...(l != null ? [{ label: 'Low', value: money(l), note: sessionDate(last.date, ref), aka: ['low', 'session low', 'day low'] }] : []),
      { label: 'Close', value: money(last.close), note: sessionDate(last.date, ref), aka: ['close', 'closed', 'closing price'] },
      ...(v != null ? [{ label: 'Volume', value: v.toLocaleString('en-US'), note: sessionDate(last.date, ref), aka: ['volume', 'shares traded'] }] : []),
    ]
    lines.push(...caveats(env, bars, null, asked))
  } else if (measure === 'range') {
    const withHi = bars.filter(b => num(b.high) != null)
    const withLo = bars.filter(b => num(b.low) != null)
    const hi = withHi.reduce((a, b) => (b.high > a.high ? b : a), withHi[0] || last)
    const lo = withLo.reduce((a, b) => (b.low < a.low ? b : a), withLo[0] || last)
    const window = !!date?.from
    const n = date?.month || window ? bars.length : Math.min(Math.max(1, sessions | 0), MAX_CHANGE_SESSIONS)
    const held = bars.length
    const span = date?.month
      ? `in ${monthWord(date.month)} (${held} completed session${held === 1 ? '' : 's'}, ${sessionDate(bars[0].date, ref)} to ${sessionDate(last.date, ref)})`
      : window
        ? `from ${dayWord(date.from)} to ${dayWord(date.to)} (${plural(held, 'completed session')}, ${sessionDate(bars[0].date, ref)} to ${sessionDate(last.date, ref)})`
        : `over ${held === n ? `the ${n} completed session${n === 1 ? '' : 's'}` : `the ${held} completed session${held === 1 ? '' : 's'} held (you asked for ${n})`}${date?.word && !ISO_DAY.test(date.word) ? ` of ${date.word}` : ''} ending ${sessionDate(last.date, ref)}${asked && last.date !== asked ? ` (the last completed session on or before ${dayWord(asked)})` : ''}, from ${sessionDate(bars[0].date, ref)}`
    lines.push(`${sym} ${span}: high ${money(num(hi.high) ?? hi.close)} on ${sessionDate(hi.date, ref)}, low ${money(num(lo.low) ?? lo.close)} on ${sessionDate(lo.date, ref)}. Close ${money(last.close)} on ${sessionDate(last.date, ref)}.`)
    items = [
      { label: `${held}-session high`, value: money(num(hi.high) ?? hi.close), note: sessionDate(hi.date, ref), aka: ['high', 'range high'] },
      { label: `${held}-session low`, value: money(num(lo.low) ?? lo.close), note: sessionDate(lo.date, ref), aka: ['low', 'range low'] },
      { label: 'Close', value: money(last.close), note: sessionDate(last.date, ref), aka: ['close'] },
    ]
    // a window read says where the held bars start when the store does not reach `from` (its own flag: partial)
    if (window && env.status === 'partial' && bars[0].date > date.from) lines.push(`Note: UCT's bars for ${bare} start ${sessionDate(bars[0].date, ref)}, after ${dayWord(date.from)}, so the window is shorter than asked.`)
    lines.push(...caveats(env, bars, date?.month || window ? null : n, asked))
  } else if (measure === 'offHigh') {
    const withHi = bars.filter(b => num(b.high) != null)
    const hi = withHi.reduce((a, b) => (b.high > a.high ? b : a), withHi[0] || last)
    const top = num(hi.high) ?? hi.close
    const held = bars.length
    const full = held >= SESSIONS_52W
    const span = full ? `the highest high of the last ${SESSIONS_52W} completed sessions` : `the highest high of the ${held} completed sessions held, less than a full 52 weeks`
    const window = `${span}, ${sessionDate(bars[0].date, ref)} to ${sessionDate(last.date, ref)}`
    const label = full ? '52-week high' : `${held}-session high`
    if (last.close >= top) {
      lines.push(`${sym} closed at ${money(last.close)} on ${sessionDate(last.date, ref)}, at its ${label} (${window}).`)
      items = [{ label: `Off ${label}`, value: '0.00%', note: `at the high, ${sessionDate(last.date, ref)}`, aka: ['off its high', 'off the high', 'below the high', 'from the high', 'distance'] }]
    } else {
      const pct = (last.close / top - 1) * 100
      lines.push(`${sym} closed at ${money(last.close)} on ${sessionDate(last.date, ref)}, ${Math.abs(pct).toFixed(2)}% (${money(top - last.close)}) below its ${label} of ${money(top)} on ${sessionDate(hi.date, ref)} (${window}).`)
      items = [{ label: `Off ${label}`, value: signedPct(pct), note: `vs ${money(top)} on ${sessionDate(hi.date, ref)}`, aka: ['off its high', 'off the high', 'below the high', 'from the high', 'distance', 'drawdown'] }]
    }
    items.push({ label, value: money(top), note: sessionDate(hi.date, ref), aka: ['high', '52 week high', 'year high'] },
      { label: 'Last close', value: money(last.close), note: sessionDate(last.date, ref), aka: ['close'] })
    lines.push(...caveats(env, bars, null, asked))
  } else if (measure === 'pullbacks') {
    const { current, completed } = pullbacksOf(bars)
    const held = bars.length
    const window = `the ${plural(held, 'completed session')} from ${sessionDate(bars[0].date, ref)} to ${sessionDate(last.date, ref)}`
    if (current) {
      const low = current.trough && current.trough.date !== last.date ? `; the lowest close since was ${money(current.trough.close)} on ${sessionDate(current.trough.date, ref)} (${signedPct(current.lowPct)})` : ''
      lines.push(`${sym} is in a pullback: the close of ${money(last.close)} on ${sessionDate(last.date, ref)} is ${signedPct(current.depthPct)} from its highest close of the window, ${money(current.peak.close)} on ${sessionDate(current.peak.date, ref)}, ${plural(current.sessions, 'session')} ago${low}.`)
    } else {
      lines.push(`${sym} closed at its highest close of the window, ${money(last.close)} on ${sessionDate(last.date, ref)} — no pullback is in progress.`)
    }
    const shown = completed.slice(-PULLBACKS_SHOWN).reverse()
    const rows = shown.map(p => ({
      pullback: `peak ${sessionDate(p.peak.date, ref)} → low ${sessionDate(p.trough.date, ref)}`,
      depth: signedPct(p.depthPct), toLow: plural(p.toLow, 'session'), recovered: `${sessionDate(p.recovered.date, ref)} (${plural(p.toRecover, 'session')} after the low)`,
    }))
    if (current) rows.unshift({ pullback: `current: peak ${sessionDate(current.peak.date, ref)} → ${current.trough ? `low so far ${sessionDate(current.trough.date, ref)}` : 'no lower close yet'}`, depth: `${signedPct(current.depthPct)} now${current.lowPct != null && current.lowPct < current.depthPct ? ` (${signedPct(current.lowPct)} at the low)` : ''}`, toLow: plural(current.sessions, 'session'), recovered: 'not yet' })
    lines.push(shown.length
      ? `The last ${shown.length === 1 ? 'completed pullback' : `${shown.length} completed pullbacks`} of ${MIN_PULLBACK_PCT}%+ (close to close) over ${window}${completed.length > shown.length ? ` (of ${completed.length})` : ''}:`
      : `No completed pullback of ${MIN_PULLBACK_PCT}%+ (close to close) in ${window}.`)
    lines.push(...shown.map(p => `• ${signedPct(p.depthPct)} over ${plural(p.toLow, 'session')}: peak ${money(p.peak.close)} on ${sessionDate(p.peak.date, ref)} → low ${money(p.trough.close)} on ${sessionDate(p.trough.date, ref)}, recovered ${sessionDate(p.recovered.date, ref)} (${plural(p.toRecover, 'session')} after the low).`))
    lines.push(...caveats(env, bars, null, asked))
    if (isFundLabel(name)) lines.push(FUND_NOTE)
    lines.push('Pullbacks are measured close to close, so an intraday low can be deeper.', COMPLETED)
    return { text: lines.join('\n'), table: { columns: [{ key: 'pullback', label: 'Pullback' }, { key: 'depth', label: 'Depth' }, { key: 'toLow', label: 'To the low' }, { key: 'recovered', label: 'Recovered' }], rows },
      present: { kind: 'table', title: `${bare} pullbacks`, short: bare, text: lines[0], table: { columns: [{ key: 'pullback', label: 'Pullback' }, { key: 'depth', label: 'Depth' }, { key: 'toLow', label: 'To the low' }, { key: 'recovered', label: 'Recovered' }], rows } } }
  } else if (measure === 'change') {
    const n = Math.min(Math.max(1, sessions | 0), MAX_CHANGE_SESSIONS)
    const covered = bars.length - 1
    if (covered < 1) {
      lines.push(`Only one completed session is held for ${sym} (${sessionDate(last.date, ref)}, close ${money(last.close)}), so no change over ${n} sessions can be given.`)
    } else {
      const first = bars[0]
      const chg = last.close - first.close
      const pct = first.close ? (chg / first.close) * 100 : null
      const span = `${covered === n ? `the ${asked ? '' : 'last '}${n} completed session${n === 1 ? '' : 's'}` : `the ${asked ? '' : 'last '}${covered} completed session${covered === 1 ? '' : 's'} held (you asked for ${n})`}${asked ? ` ending ${sessionDate(last.date, ref)}${last.date !== asked ? ` (the last completed session on or before ${askedWord(date)})` : ''}` : ''}`
      lines.push(`${sym} over ${span}: ${signedPct(pct)} (${signedMoney(chg)}), from a close of ${money(first.close)} on ${sessionDate(first.date, ref)} to ${money(last.close)} on ${sessionDate(last.date, ref)}.`)
      items = [
        { label: `${covered}-session change`, value: `${signedPct(pct)} (${signedMoney(chg)})`, note: `${sessionDate(first.date, ref)} → ${sessionDate(last.date, ref)}`, aka: ['change', 'performance', 'move'] },
        { label: 'Last close', value: money(last.close), note: sessionDate(last.date, ref), aka: ['close'] },
      ]
    }
    lines.push(...caveats(env, bars, null, asked))
  } else if (measure === 'range52w') {
    const withHi = bars.filter(b => num(b.high) != null)
    const withLo = bars.filter(b => num(b.low) != null)
    const hi = withHi.reduce((a, b) => (b.high > a.high ? b : a), withHi[0] || last)
    const lo = withLo.reduce((a, b) => (b.low < a.low ? b : a), withLo[0] || last)
    const full = bars.length >= SESSIONS_52W
    const asOf = asked ? ` as of ${sessionDate(last.date, ref)}${last.date !== asked ? ` (the last completed session on or before ${askedWord(date)})` : ''}` : ''
    const span = full
      ? `52-week range${asOf} (the ${asked ? '' : 'last '}${SESSIONS_52W} completed sessions, ${sessionDate(bars[0].date, ref)} to ${sessionDate(last.date, ref)})`
      : `range${asOf} over the ${bars.length} completed sessions held (${sessionDate(bars[0].date, ref)} to ${sessionDate(last.date, ref)}), less than a full 52 weeks`
    lines.push(`${sym} ${span}: high ${money(num(hi.high) ?? hi.close)} on ${sessionDate(hi.date, ref)}, low ${money(num(lo.low) ?? lo.close)} on ${sessionDate(lo.date, ref)}. Last close ${money(last.close)} on ${sessionDate(last.date, ref)}.`)
    items = [
      { label: full ? '52-week high' : `${bars.length}-session high`, value: money(num(hi.high) ?? hi.close), note: sessionDate(hi.date, ref), aka: ['high', '52 week high', 'year high'] },
      { label: full ? '52-week low' : `${bars.length}-session low`, value: money(num(lo.low) ?? lo.close), note: sessionDate(lo.date, ref), aka: ['low', '52 week low', 'year low'] },
      { label: 'Last close', value: money(last.close), note: sessionDate(last.date, ref), aka: ['close'] },
    ]
    lines.push(...caveats(env, bars, null, asked))
  } else {
    return { text: noBarsSentence({ status: 'unavailable' }, sym) }
  }
  // owner ruling 3: an ETF's price is never presented as the underlying asset's price
  if (isFundLabel(name)) lines.push(FUND_NOTE)
  lines.push(COMPLETED)
  return { text: lines.join('\n'), present: { kind: 'metrics', title: `${bare} daily`, short: bare, items: items.filter(i => i.value) } }
}

function cleanArgs(args) {
  const symbol = String(args?.symbol || '').trim()
  const measure = MEASURES.includes(args?.measure) ? args.measure : null
  const sessions = Number.isInteger(args?.sessions) ? args.sessions : null
  const date = typeof args?.date === 'string' && args.date.trim() ? args.date.trim() : null
  const from = typeof args?.from === 'string' && args.from.trim() ? args.from.trim() : null
  return { symbol, measure, sessions, date, from }
}

/** The member's date words → the read's window, or a sentence when they cannot be read (never guessed). */
export function windowFor(measure, sessions, dateText, fromText = null) {
  // W2-B2: "from X to Y" — a window read; `to` defaults to the latest completed session (the adapter's own cutoff)
  let from = null
  if (fromText) {
    const f = resolveDateWord(fromText)
    if (!f) return { why: `I couldn't read “${fromText}” as a date — say it like 2026-10-15, “last Friday” or “Oct 1”.` }
    if (f.future) return { why: `${dayWord(f.to)} hasn't happened yet — UCT's daily bars cover completed sessions only.` }
    from = f.to
  }
  if (!dateText) return { date: from ? { to: null, word: null, from } : null, sessions }
  const r = resolveDateWord(dateText)
  if (!r) return { why: `I couldn't read “${dateText}” as a date — say it like 2026-10-15, “last Friday” or “last week”.` }
  if (r.future) return { why: `${dayWord(r.to)} hasn't happened yet — UCT's daily bars cover completed sessions only.` }
  if (from && from > r.to) return { why: `${dayWord(from)} is after ${dayWord(r.to)} — the window's start must come first.` }
  const date = { to: r.to, word: r.word, ...(r.month ? { month: r.month } : {}), ...(r.sessions ? { sessions: r.sessions } : {}), ...(from ? { from } : {}) }
  // "range last week" / "this week": the window's own session count unless the member gave one
  const n = measure === 'range' && sessions == null && r.sessions ? r.sessions : sessions
  return { date, sessions: n }
}

export async function answerDailyBars(args) {
  const { symbol, measure, sessions: given, date: dateText, from: fromText } = cleanArgs(args)
  if (!barsServed()) return "UCT's daily bars aren't available to the Agent here."
  const candidates = toCandidates([symbol])
  if (candidates.length !== 1) return "Which ticker? I couldn't find a symbol in that."
  if (!measure) return "I can give the close on a day, one session's open / high / low / close, the change over a number of sessions, the high and low of a window, how far it sits off its 52-week high, its recent pullbacks, or the 52-week high and low."
  const w = windowFor(measure, given, dateText, measure === 'range' ? fromText : null)
  if (w.why) return w.why
  const { date, sessions } = w
  if (measure === 'change' && !(sessions >= 1)) return 'Over how many sessions? For example "NVDA 5-day change".'
  if (measure === 'range' && !date?.month && !date?.from && !(sessions >= 1)) return 'Over which window? For example "TSLA range last week" or "TSLA range over the last 10 sessions".'
  // MD-1 §4.7: the word is resolved against UCT's symbol index BEFORE any bars are read
  const r = await resolveInstruments(candidates)
  if (!r.ok) return r.text
  const resolved = r.symbols[0]
  // the member's open turn (trace.js): the server's per-turn budget key; never minted, never injected
  const turnId = currentTurnId()
  if (!turnId) return "I couldn't read the daily bars: this needs the Agent's turn, which wasn't available."
  // ONE read, ending at the asked day through the adapter's own `to` (point in time) — never a second read;
  // a window ("from X to Y") through the adapter's `from`, with no `bars` count (the window decides)
  const params = date?.from
    ? { symbol: resolved, from: date.from, ...(date.to ? { to: date.to } : {}) }
    : { symbol: resolved, bars: barsFor(measure, sessions, { month: !!date?.month }), ...(date ? { to: date.to } : {}) }
  const env = await readData('bars.daily', params, { purpose: 'answer', turnId })
  const latest = env?.data?.through || null
  return answerFromBars(env, { symbol: resolved, measure, sessions, name: r.names[resolved], date: date?.from && !date.to ? { ...date, to: latest } : date })
}

// W2-B2 shapes the shared intent parser does not claim: "how far is X off its high", "X pullbacks", "X range over the
// last N sessions" (the parser reads the last as an N-session CHANGE; a range word decides here first)
const SYM = '(\\$?[A-Za-z][A-Za-z0-9.]{0,5})'
const OFF_HIGH = new RegExp(`^(?:how far (?:is|was) )?${SYM} (?:off|below|down from|from) (?:its|the) (?:52[\\s-]?(?:week|wk|w) )?highs?$`, 'i')
const PULLBACKS = new RegExp(`^(?:compare (?:this|the|the current) pullback (?:in|on|for) ${SYM} (?:to|with|vs|against) (?:the )?(?:last|previous|prior) (?:three|3)(?: pullbacks)?|${SYM} pullbacks|(?:show|compare) ${SYM}(?:'s)? (?:last|recent) pullbacks)$`, 'i')
const RANGE_N = new RegExp(`^${SYM} range (?:over|for|in|of) (?:the )?(?:last|past) (\\d{1,3}) (?:sessions|days|trading days)$`, 'i')
function matchW2(text) {
  const s = String(text || '').replace(/[’`]/g, "'").trim().replace(/[?!.]+$/, '').replace(/\s+/g, ' ')
  let m
  if ((m = OFF_HIGH.exec(s))) return { symbol: m[1], measure: 'offHigh', sessions: null, date: null, from: null }
  if ((m = PULLBACKS.exec(s))) return { symbol: m[1] || m[2] || m[3], measure: 'pullbacks', sessions: null, date: null, from: null }
  if ((m = RANGE_N.exec(s))) { const n = Number(m[2]); return n >= 1 && n <= MAX_CHANGE_SESSIONS ? { symbol: m[1], measure: 'range', sessions: n, date: null, from: null } : null }
  return null
}

/** Fast path: pure, fail-closed; the bars rows of MD-1-phrasings.md. */
export function match(text) {
  if (!barsServed()) return null
  const w2 = matchW2(text)
  if (w2) return { action: CAPABILITY, params: w2 }
  const p = parsePriceSentence(text)
  const measure = p ? INTENT_TO_MEASURE[p.intent] : null
  if (!measure) return null
  const sessions = measure === 'change' ? Math.min(p.n, MAX_CHANGE_SESSIONS) : null
  // the word AS TYPED: case is the evidence `instrument.resolve` classifies on (MD-1 §4.7.2)
  return { action: CAPABILITY, params: { symbol: p.candidates[0].text, measure, sessions, date: null, from: null } }
}

let registered = false
let unregister = null
/** Idempotent; registers nothing unless `bars.daily` is served and activated. Called by registerMarketDataCapabilities. */
export function registerBarsCapability() {
  if (registered || !barsServed()) return false
  registered = true
  unregister = registerCapability({
    name: CAPABILITY,
    surfaces: ['*'],
    target: 'market', query: true,
    summary: 'Answer questions about ONE stock\'s COMPLETED daily sessions from UCT\'s daily bars: the close (latest, or on a date), one session\'s open/high/low/close, '
      + 'the change over N sessions, the high and low of a window (a week, a month, N sessions, or dated), the 52-week range, the distance off its 52-week high, or its pullbacks — each as of a date when one is given. Use this (disposition apply, research null) '
      + 'for "how did AAPL close yesterday", "NVDA close last Friday", "AAPL high on 2026-10-15", "TSLA range last week", "NVDA 5-day change". Never for today\'s price (stock.quote).',
    hints: 'target = the ref of the stockData entry; symbol uppercase; measure = lastClose (the close, latest or on `date`) | session (open/high/low/close/volume of ONE day: "high on", "low on", "open on") '
      + '| change (N sessions) | range (high and low over a window) | range52w | offHigh (below the 52-week high) | pullbacks; sessions = the N of an N-session change or range (weeks × 5), else null; '
      + 'date = the member\'s date words exactly ("last friday", "yesterday", "oct 15", "2026-10-15", "last week", "last month") or null for the latest; from = a range\'s start words ("from X to Y": date = Y), else null. '
      + '"close last Friday" → lastClose + date; "high on Oct 15" → session + date; "range last week" → range + date (sessions null: the week decides); "range over the last 10 sessions" → range + sessions 10.',
    args: {
      type: 'object',
      properties: {
        symbol: { type: 'string' },
        measure: { type: 'string', enum: MEASURES },
        sessions: { type: ['integer', 'null'] },
        date: { type: ['string', 'null'] },
        from: { type: ['string', 'null'] },
      },
      required: ['symbol', 'measure', 'sessions', 'date', 'from'],
      additionalProperties: false,
    },
    // W2-B2 added `from`: every arg shape from before it (no `from` key) still validates, as `from: null`
    absentAsNull: ['from'],
    fastWhole: true,
    fastCorrect: false,
    fast: ({ raw }) => { const m = match(raw); return m ? m.params : null },
    answer: (_snap, args) => answerDailyBars(args),
  })
  return true
}
export const _resetBarsForTest = () => { if (unregister) unregister(); unregister = null; registered = false }
