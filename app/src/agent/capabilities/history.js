// UCT Agent historical analysis — `history.afterEvent` over the MD-1 `history.eventStudy` kind (W2-B2, builder-b).
//
// "How has NVDA behaved after 5%+ gaps?", "what happens after AMD crosses above its 50-day?": ONE gateway read of
// the server's event study (api/services/uct_agent/marketdata/history_event_study.py, a thin adapter over Market
// Intelligence's existing event_study.py) and the member sees the study's own table and text. No model call, no
// fetch of its own, no computation here.
//
// ⛔ LOCAL ONLY (`localOnly: true`, turn.LOCAL_ONLY_ACTIONS): the result carries licensed price returns and is shown
// to the member; the model receives the request note and counts, never a return. Every answer says "descriptive,
// not predictive" and dates the stored closes it rests on. A refused / unavailable study answers in fixed words.
//
// Dark by construction: unless the server serves data AND lists `history.eventStudy` and `instrument.resolve`
// (`data_kinds`, fail-closed), `match` returns null and `registerHistoryCapability` registers nothing.

import { registerCapability } from '../capabilities'
import * as agentClient from '../agentClient'
import { readData } from '../marketdata/client'
import { currentTurnId } from '../trace'
import { sessionDate } from './marketDataFormat'
import { RESOLVE_KIND, toCandidates, resolveInstruments, isFundLabel, FUND_NOTE } from './marketDataResolve'

export const CAPABILITY = 'history.afterEvent'
export const KIND = 'history.eventStudy'
export const INDICATORS = ['gap_pct', 'pct_from_sma', 'rsi', 'bb_pct_b', 'macd_hist', 'pct_from_high', 'day_pct']
export const NO_PERIOD = ['gap_pct', 'macd_hist', 'day_pct']
/** Phase 2 history: "the last N times" — the study keeps only the most recent N events (event_study.MAX_LAST) */
export const MAX_LAST = 60
export const OPS = ['above', 'below', 'cross_above', 'cross_below']
export const DEFAULT_HORIZONS = [1, 5, 21]
export const MAX_HORIZONS = 4
export const MAX_SESSIONS = 252
export const DESCRIPTIVE = "Descriptive, not predictive: this is what happened after past events in UCT's stored daily history; past results do not predict future returns."
const GAPS_NOTE = "Opening gaps on any session are counted — UCT's data carries no past earnings dates, so earnings days are not separated."
const INDICATOR_WORDS = { day_pct: 'one-day close-to-close change (%)', gap_pct: 'opening gap vs the previous close (%)', pct_from_sma: '% from its N-day SMA', rsi: 'RSI(N)', bb_pct_b: 'Bollinger %B (N, 2σ)', macd_hist: 'MACD histogram (12, 26, 9)', pct_from_high: 'a new N-day closing high' }
/** PKG2: a BREADTH-conditioned study ("SPY after breadth thrusts") is refused in fixed words, before any read or model call:
 *  UCT's breadth readings are model-isolated and never composed into a study (ADR-005; the server refuses the series kind too). */
export const BREADTH_DECLINE = "Studies conditioned on market breadth (a breadth thrust, % of stocks above a moving average, new highs / lows) aren't available to UCT Agent: UCT's breadth readings are shown to you directly and are never combined into a study. "
  + 'I can study what one stock or ETF did after its OWN technical events instead — a new N-day closing high (a breakout), an opening gap, RSI, or crossing a moving average — for example "how has SPY done after new 50-day highs". No figure is stated.'

/** Phase 2 history: a study anchored on EARNINGS DATES ("the week after earnings") cannot be run — UCT's stored history carries
 *  no past report dates — so it is declined in fixed words, before any read or model call, with the study that CAN be run. */
export const EARNINGS_DECLINE = "UCT's stored daily history carries no past earnings report dates, so I can't isolate the days or weeks after earnings. "
  + 'I can study what a stock did after large opening gaps (earnings gaps are among them, not separated) or after big one-day moves — for example "how has NVDA behaved after 5%+ gaps" or "what happened to NVDA after the last 5 times it fell 5% in a day". No figure is stated.'

export function historyServed() {
  if (!agentClient.serverServesData()) return false
  const kinds = typeof agentClient.serverDataKinds === 'function' ? agentClient.serverDataKinds() : null
  return Array.isArray(kinds) && kinds.includes(KIND) && kinds.includes(RESOLVE_KIND)
}

const NO_STUDY = {
  refused: "that request wasn't allowed for this question, so no study was run",
  unavailable: "UCT's stored daily history could not answer it",
}
export function noStudySentence(env, sym) {
  const why = NO_STUDY[env?.status] || NO_STUDY.unavailable
  return `I couldn't run that study for ${sym || 'that'}: ${why}. No figure is stated.`
}
const usable = (env) => !!env && env.status === 'ok' && env.data && typeof env.data === 'object' && env.data.study && typeof env.data.study === 'object'
const table = (t) => (t && Array.isArray(t.columns) && Array.isArray(t.rows) && t.columns.length ? t : null)

/** The freshness line, from the envelope's own flags and dates — never from its notes (agent-qa F-20). */
export function freshnessLine(env, sym) {
  const last = env.data?.coverage?.price_last || env.data?.summary?.price_last
  const first = env.data?.coverage?.price_first || env.data?.summary?.price_first
  // (years always shown: a study spans years, and its dates are what the member checks against the chart)
  const span = last ? `UCT's stored daily closes for ${sym} run ${first ? `from ${sessionDate(first)} ` : ''}through ${sessionDate(last)} (completed sessions); the study is as of that close` : 'the study carries no price date'
  return `${span}${env.stale ? ' — note: a newer completed session exists, so the newest sessions are not included' : ''}.`
}

/** The sample the study rests on — its event count, study window and (with `last`) how many earlier events were left
 *  out — from the envelope's value-free summary only. Past results are a small sample, said every time. */
export function sampleLine(env) {
  const s = env?.data?.summary
  if (!s || !Number.isInteger(s.events_used)) return null
  const span = s.study_start && s.study_end ? ` between ${sessionDate(s.study_start)} and ${sessionDate(s.study_end)}` : ''
  const last = Number.isInteger(s.last) ? ` (the most recent ${s.last} asked for${s.events_before_last ? `; ${s.events_before_last} earlier ones left out` : ''})` : ''
  return `Sample: ${s.events_used} past event${s.events_used === 1 ? '' : 's'}${span}${last}. Past results are a small sample of history, not a forecast.`
}

/**
 * A `history.eventStudy` envelope → the member's answer: the study's own lead, table, caveats and method, the
 * descriptive line and the dated freshness line. Pure; exported for tests. → { text, table, present, chart }
 */
export function answerFromEventStudy(env, { symbol, name = null, indicator = null }) {
  const bare = String(symbol || '').toUpperCase()
  const sym = name ? `${bare} (${name})` : bare
  if (!usable(env)) return { text: noStudySentence(env, bare) }
  const s = env.data.study
  const tbl = table(s.table)
  const lines = [`${sym} — ${String(s.lead || '').trim() || 'event study'}`]
  const body = String(s.text || '').split('\n').slice(1).map(l => l.trim()).filter(Boolean)
  lines.push(...body)
  const caveats = (Array.isArray(s.caveats) ? s.caveats : []).filter(c => typeof c === 'string' && c.trim())
  if (caveats.length) lines.push(...caveats.map(c => `Caveat: ${c}`))
  if (indicator === 'gap_pct' || env.data?.request?.condition?.series?.indicator === 'gap_pct') lines.push(GAPS_NOTE)
  if (isFundLabel(name)) lines.push(FUND_NOTE)
  const sample = sampleLine(env)
  if (sample) lines.push(sample)
  lines.push(DESCRIPTIVE, freshnessLine(env, bare))
  const text = lines.join('\n')
  return {
    text,
    ...(tbl ? { table: tbl } : {}),
    present: { kind: 'table', title: `${bare} — after ${env.data?.summary?.series_label ? String(env.data.summary.series_label).replace(`${bare} `, '') : 'the event'}`, short: bare, ...(tbl ? { table: tbl } : {}), text: `${lines[0]}\n${DESCRIPTIVE}` },
    chart: { symbol: bare, label: bare },
  }
}

function cleanArgs(args) {
  const symbol = String(args?.symbol || '').trim()
  const indicator = INDICATORS.includes(args?.indicator) ? args.indicator : null
  const period = Number.isInteger(args?.period) && args.period > 0 ? args.period : null
  const op = OPS.includes(args?.op) ? args.op : null
  const threshold = typeof args?.threshold === 'number' && Number.isFinite(args.threshold) ? args.threshold : null
  const horizons = Array.isArray(args?.horizons) && args.horizons.length ? [...new Set(args.horizons.filter(n => Number.isInteger(n) && n >= 1 && n <= MAX_SESSIONS))].slice(0, MAX_HORIZONS) : [...DEFAULT_HORIZONS]
  const since = typeof args?.since === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(args.since) ? args.since : null
  const last = Number.isInteger(args?.last) && args.last >= 1 && args.last <= MAX_LAST ? args.last : null
  return { symbol, indicator, period, op, threshold, horizons, since, last }
}

export async function answerAfterEvent(args) {
  const a = cleanArgs(args)
  if (!historyServed()) return "UCT's event studies aren't available to the Agent here."
  const candidates = toCandidates([a.symbol])
  if (candidates.length !== 1) return "Which ticker? I couldn't find a symbol in that."
  if (!a.indicator || !a.op || a.threshold == null) return `Which condition? I can study what followed an opening gap of N%+, a new N-day closing high (a breakout), RSI, % from a moving average, Bollinger %B or the MACD histogram above / below / crossing a level — for example "how has NVDA behaved after 5%+ gaps".`
  if (!NO_PERIOD.includes(a.indicator) && !a.period) return `Which period? For example "${INDICATOR_WORDS[a.indicator].replace('N', '14')}".`
  // MD-1 §4.7: the word is resolved against UCT's symbol index BEFORE anything is read
  const r = await resolveInstruments(candidates)
  if (!r.ok) return r.text
  const resolved = r.symbols[0]
  const turnId = currentTurnId()
  if (!turnId) return "I couldn't run the study: this needs the Agent's turn, which wasn't available."
  const params = { symbol: resolved, indicator: a.indicator, period: NO_PERIOD.includes(a.indicator) ? null : a.period, op: a.op, threshold: a.threshold, horizons: a.horizons, ...(a.since ? { since: a.since } : {}), ...(a.last ? { last: a.last } : {}) }
  // ONE read; the kind is a string LITERAL at the call (agent-qa's isolation rail checks every readData kind statically)
  const env = await readData('history.eventStudy', params, { purpose: 'answer', turnId })
  return answerFromEventStudy(env, { symbol: resolved, name: r.names[resolved], indicator: a.indicator })
}

// ── fast path — pure, fail-closed. The candidate word is kept exactly as typed (MD-1 §4.7 resolves it in answer()):
//   "how has NVDA behaved after 5%+ (earnings) gaps (down)?"         gap_pct above N (5 when no size is named)
//   "how does SPY do after new 50-day highs / 20-day breakouts?"      pct_from_high N cross_above 0 (52-week = 252)
//   "what happens to AMD after it crosses above its 50-day?"          pct_from_sma N cross_above | cross_below 0
//   "how has NVDA done after RSI drops below 30?"                     rsi 14 cross_below 30 (cross_above for above)
//   "how does SPY do after breadth thrusts?"                          the fixed BREADTH_DECLINE, no read (ADR-005)
const SYM = '(\\$?[A-Za-z][A-Za-z0-9.]{0,5})'
const LEAD = `(?:how (?:has|did|does|do) ${SYM} (?:usually |typically |historically )?(?:behaved?|do|done|perform(?:ed)?|react(?:ed)?|trade[d]?|act(?:ed)?|move[d]?)|what (?:usually |typically )?(?:happens|happened) (?:to|with) ${SYM})`
const TAIL = '(?: (?:historically|in the past|over time))?(?: since (\\d{4}))?$'
const GAPS = new RegExp(`^${LEAD} after (?:a |an )?(?:(\\d{1,2}(?:\\.\\d+)?)\\s?%\\s?\\+? (?:or (?:more|bigger|larger) )?)?(?:(?:earnings|opening|open|big) )?gaps?(?: (up|down|higher|lower))?${TAIL}`, 'i')
const HIGHS = new RegExp(`^${LEAD} after (?:it )?(?:(?:makes?|made|making|hits?|hitting|sets?|setting|breaks? out to|broke out to|breaking out to) )?(?:a |an )?(?:new )?(?:(52)[- ]?week|(\\d{1,3})[- ]?(day|session|week))s? (?:closing )?(?:highs?|breakouts?|break[- ]outs?)${TAIL}`, 'i')
const SMA_X = new RegExp(`^${LEAD} after (?:it )?(?:cross(?:es|ed|ing)?|breaks?|broke|breaking|closes|closed|closing|moves?|moved|moving) (above|over|below|under) (?:its |the )?(\\d{1,3})[- ]?day(?: (?:simple )?(?:moving average|sma|ma|line|average))?${TAIL}`, 'i')
const RSI_X = new RegExp(`^${LEAD} after (?:its |the )?rsi(?: ?\\(?(\\d{1,3})\\)?)? (?:(?:drops?|dropped|falls?|fell|goes|went|gets?|got|crosses|crossed|dips?|dipped|moves?|moved|rises?|rose|climbs?|climbed) )?(below|under|above|over) (\\d{1,2})${TAIL}`, 'i')
// Phase 2 history: a one-day close-to-close move, optionally "the last N times" —
//   "what happened to SPY after the last 5 times it fell 3% in a day"   day_pct below -3, last 5
//   "how does SPY do after 3%+ down days" / "after a 5% up day"         day_pct below -3 / above 5
//   "how has NVDA done after it drops 4% in a day"                      day_pct below -4
const MOVE_DOWN = /^(?:fell|falls|fall|dropped|drops|drop|declined|declines|lost|loses|sank|sinks|tumbled|tumbles|plunged|plunges|was down|closed down|is down)$/i
const DAY_MOVE = new RegExp(`^${LEAD} after (?:(?:the )?(?:last|past) (\\d{1,2}) times? )?(?:it |\\$?[A-Za-z][A-Za-z0-9.]{0,5} )?(fell|falls|fall|dropped|drops|drop|declined|declines|lost|loses|sank|sinks|tumbled|tumbles|plunged|plunges|rose|rises|rise|gained|gains|jumped|jumps|rallied|rallies|climbed|climbs|surged|surges|was (?:up|down)|closed (?:up|down)|is (?:up|down)) (?:by )?(?:more than |over |at least )?(\\d{1,2}(?:\\.\\d+)?)\\s?%\\s?\\+?(?: or more)? (?:in a (?:single )?(?:day|session)|in one (?:day|session)|on the day|in a single day)${TAIL}`, 'i')
const DAY_BAR = new RegExp(`^${LEAD} after (?:the (?:last|past) (\\d{1,2}) )?(?:a |an )?(\\d{1,2}(?:\\.\\d+)?)\\s?%\\s?\\+?(?: or (?:more|bigger|larger))? (down|up|red|green) (?:days?|sessions?)${TAIL}`, 'i')
// "how does NVDA typically do the week after earnings" → the fixed EARNINGS_DECLINE (no read): the window words are what make
// it an earnings-date study ("after earnings" alone stays the model's, which may ask or offer a gap study)
const EARNINGS_WINDOW = new RegExp(`^${LEAD} (?:in )?(?:the )?(?:day|days|week|weeks|month|session|sessions|\\d{1,2} (?:days|sessions|weeks)) (?:after|following) (?:its |their |the )?(?:earnings|earnings reports?|earnings announcements?|reports?)${TAIL}`, 'i')
const BREADTH_STUDY = /^(?:how|what)\b[^,;]{0,80}\b(?:after|following)\b[^,;]{0,40}\b(?:breadth thrusts?|zweig(?: breadth)?(?: thrusts?)?|breadth (?:surges?|spikes?|signals?))(?: (?:historically|in the past|over time))?(?: since \d{4})?$/i   // anchored: a trailing second request is never swallowed
const NOT_A_SYMBOL = new Set(['it', 'its', 'this', 'that', 'they', 'them', 'stocks', 'stock', 'market', 'the'])
const normalise = (t) => String(t || '').replace(/[’`]/g, "'").trim().replace(/[?!.]+$/, '').replace(/\s+/g, ' ').trim()
const sinceOf = (y) => (y ? `${y}-01-01` : null)
const withLast = (st, last) => (last ? { ...st, params: { ...st.params, last } } : st)
const study = (symbol, indicator, period, op, threshold, year) => ({ action: CAPABILITY, params: { symbol, indicator, period, op, threshold, horizons: [...DEFAULT_HORIZONS], since: sinceOf(year) } })

/** The event question → { action, params } with the candidate word exactly as typed, { say } for a breadth-conditioned
 *  study (declined in fixed words), or null. */
export function match(text) {
  if (!historyServed()) return null
  const s = normalise(text)
  if (!s || s.length > 140) return null
  if (BREADTH_STUDY.test(s)) return { say: BREADTH_DECLINE }
  const sym = (m) => { const w = m[1] || m[2]; return w && !NOT_A_SYMBOL.has(w.toLowerCase()) ? w : null }
  if (EARNINGS_WINDOW.test(s)) { const e = EARNINGS_WINDOW.exec(s); return sym(e) ? { say: EARNINGS_DECLINE } : null }
  let m = GAPS.exec(s)
  if (m) {
    const symbol = sym(m)
    const pct = m[3] == null ? 5 : Number(m[3])
    if (!symbol || !(pct >= 1 && pct <= 50)) return null
    const down = m[4] === 'down' || m[4] === 'lower'
    return study(symbol, 'gap_pct', null, down ? 'below' : 'above', down ? -pct : pct, m[5])
  }
  m = HIGHS.exec(s)
  if (m) {
    const symbol = sym(m)
    const n = m[3] ? 252 : m[5] === 'week' ? Number(m[4]) * 5 : Number(m[4])
    if (!symbol || !(n >= 5 && n <= 252)) return null
    return study(symbol, 'pct_from_high', n, 'cross_above', 0, m[6])
  }
  m = SMA_X.exec(s)
  if (m) {
    const symbol = sym(m)
    const n = Number(m[4])
    if (!symbol || !(n >= 2 && n <= 400)) return null
    return study(symbol, 'pct_from_sma', n, /above|over/i.test(m[3]) ? 'cross_above' : 'cross_below', 0, m[5])
  }
  m = DAY_MOVE.exec(s)
  if (m) {
    const symbol = sym(m)
    const last = m[3] ? Number(m[3]) : null
    const pct = Number(m[5])
    if (!symbol || !(pct >= 0.5 && pct <= 50) || (last != null && !(last >= 1 && last <= MAX_LAST))) return null
    const down = MOVE_DOWN.test(m[4]) || /down$/i.test(m[4])
    return withLast(study(symbol, 'day_pct', null, down ? 'below' : 'above', down ? -pct : pct, m[6]), last)
  }
  m = DAY_BAR.exec(s)
  if (m) {
    const symbol = sym(m)
    const last = m[3] ? Number(m[3]) : null
    const pct = Number(m[4])
    if (!symbol || !(pct >= 0.5 && pct <= 50) || (last != null && !(last >= 1 && last <= MAX_LAST))) return null
    const down = /down|red/i.test(m[5])
    return withLast(study(symbol, 'day_pct', null, down ? 'below' : 'above', down ? -pct : pct, m[6]), last)
  }
  m = RSI_X.exec(s)
  if (m) {
    const symbol = sym(m)
    const n = m[3] ? Number(m[3]) : 14
    const level = Number(m[5])
    if (!symbol || !(n >= 2 && n <= 200) || !(level >= 1 && level <= 99)) return null
    return study(symbol, 'rsi', n, /above|over/i.test(m[4]) ? 'cross_above' : 'cross_below', level, m[6])
  }
  return null
}

let registered = false
let unregister = null
/** Idempotent; registers nothing unless `history.eventStudy` (and `instrument.resolve`) are served. */
export function registerHistoryCapability() {
  if (registered || !historyServed()) return false
  registered = true
  unregister = registerCapability({
    name: 'history.afterEvent',       // a LITERAL: the server's local-only mirror rail reads it (tests/test_uct_agent_breadth.py)
    surfaces: ['charts'],
    target: 'market', query: true,
    localOnly: true,                    // ⛔ shown to the member; the model never sees a return (turn.LOCAL_ONLY_ACTIONS)
    // turn.py MAX_SUMMARY / MAX_HINTS: the server CUTS a longer text on every request (capabilityTextLimits.test.js), so the
    // breadth / earnings refusal rule lives in the hints in full and is named in the summary
    summary: 'EVENT STUDY from UCT\'s stored daily history: each time ONE stock met a technical condition (one-day move, opening gap, N-day breakout, RSI, % from an SMA, Bollinger %B, MACD histogram), '
      + 'its forward returns vs all sessions. UCT shows it; you never see returns. Descriptive, never a prediction. '
      + 'Use this (disposition apply, research null). Breadth / earnings-date studies: NOT available (hints).',
    hints: 'target = the stockData ref; symbol uppercase. indicator day_pct (a one-day close-to-close move; period null; "fell 3% in a day" → op below, threshold -3) | gap_pct (period null; threshold = the gap %, negative with op below for gaps down; 5 when no size is named) '
      + '| pct_from_high (an N-day BREAKOUT / new N-day high: period = N, 252 for 52 weeks; op cross_above, threshold 0) | pct_from_sma (crossing an SMA: period = its days; op cross_above / cross_below, threshold 0) '
      + '| rsi (period, 14 when none is named) | bb_pct_b (period) | macd_hist (period null). op above | below | cross_above | cross_below. horizons = sessions (1–252, at most 4; null = [1, 5, 21]). '
      + 'since = YYYY-MM-DD or null. last = N for "the last N times", else null. reply: one short line, no figures. '
      + 'A study conditioned on MARKET BREADTH (thrusts, % above a moving average, NH/NL) or on EARNINGS DATES is NOT available: plan nothing and say so in one line, with no figure.',
    args: {
      type: 'object',
      properties: {
        symbol: { type: 'string' },
        indicator: { type: 'string', enum: INDICATORS },
        period: { type: ['integer', 'null'] },
        op: { type: 'string', enum: OPS },
        threshold: { type: 'number' },
        horizons: { type: ['array', 'null'], items: { type: 'integer' } },
        since: { type: ['string', 'null'] },
        last: { type: ['integer', 'null'] },
      },
      required: ['symbol', 'indicator', 'period', 'op', 'threshold', 'horizons', 'since', 'last'],
      additionalProperties: false,
    },
    // Phase 2 history added `last`: every arg shape from before it still validates, as `last: null`
    absentAsNull: ['last'],
    fastWhole: true,
    fastCorrect: false,
    // (a breadth-conditioned study is answered in fixed words — fastPath's `__say` — with no read and no model call)
    fast: ({ raw }) => { const m = match(raw); return m ? (m.say ? { __say: m.say } : m.params) : null },
    answer: (_snap, args) => answerAfterEvent(args),
  })
  return true
}
export const _resetHistoryForTest = () => { if (unregister) unregister(); unregister = null; registered = false }
