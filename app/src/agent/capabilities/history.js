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
export const INDICATORS = ['gap_pct', 'pct_from_sma', 'rsi', 'bb_pct_b', 'macd_hist']
export const NO_PERIOD = ['gap_pct', 'macd_hist']
export const OPS = ['above', 'below', 'cross_above', 'cross_below']
export const DEFAULT_HORIZONS = [1, 5, 21]
export const MAX_HORIZONS = 4
export const MAX_SESSIONS = 252
export const DESCRIPTIVE = "Descriptive, not predictive: this is what happened after past events in UCT's stored daily history; past results do not predict future returns."
const GAPS_NOTE = "Opening gaps on any session are counted — UCT's data carries no past earnings dates, so earnings days are not separated."
const INDICATOR_WORDS = { gap_pct: 'opening gap vs the previous close (%)', pct_from_sma: '% from its N-day SMA', rsi: 'RSI(N)', bb_pct_b: 'Bollinger %B (N, 2σ)', macd_hist: 'MACD histogram (12, 26, 9)' }

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
  return { symbol, indicator, period, op, threshold, horizons, since }
}

export async function answerAfterEvent(args) {
  const a = cleanArgs(args)
  if (!historyServed()) return "UCT's event studies aren't available to the Agent here."
  const candidates = toCandidates([a.symbol])
  if (candidates.length !== 1) return "Which ticker? I couldn't find a symbol in that."
  if (!a.indicator || !a.op || a.threshold == null) return `Which condition? I can study what followed an opening gap of N%+, RSI, % from a moving average, Bollinger %B or the MACD histogram above / below / crossing a level — for example "how has NVDA behaved after 5%+ gaps".`
  if (!NO_PERIOD.includes(a.indicator) && !a.period) return `Which period? For example "${INDICATOR_WORDS[a.indicator].replace('N', '14')}".`
  // MD-1 §4.7: the word is resolved against UCT's symbol index BEFORE anything is read
  const r = await resolveInstruments(candidates)
  if (!r.ok) return r.text
  const resolved = r.symbols[0]
  const turnId = currentTurnId()
  if (!turnId) return "I couldn't run the study: this needs the Agent's turn, which wasn't available."
  const params = { symbol: resolved, indicator: a.indicator, period: NO_PERIOD.includes(a.indicator) ? null : a.period, op: a.op, threshold: a.threshold, horizons: a.horizons, ...(a.since ? { since: a.since } : {}) }
  // ONE read; the kind is a string LITERAL at the call (agent-qa's isolation rail checks every readData kind statically)
  const env = await readData('history.eventStudy', params, { purpose: 'answer', turnId })
  return answerFromEventStudy(env, { symbol: resolved, name: r.names[resolved], indicator: a.indicator })
}

// ── fast path: "how has NVDA behaved after 5%+ (earnings) gaps (down)?" — pure, fail-closed ─────────────────────
const SYM = '(\\$?[A-Za-z][A-Za-z0-9.]{0,5})'
const GAPS = new RegExp(`^(?:how (?:has|did|does) ${SYM} (?:behaved?|do|done|perform(?:ed)?|react(?:ed)?|trade[d]?|act(?:ed)?)|what (?:happens|happened) (?:to|with) ${SYM}) after (?:a |an )?(\\d{1,2}(?:\\.\\d+)?)\\s?%\\s?\\+? (?:(?:earnings|opening|open) )?gaps?(?: (up|down|higher|lower))?(?: since (\\d{4}))?$`, 'i')
const normalise = (t) => String(t || '').replace(/[’`]/g, "'").trim().replace(/[?!.]+$/, '').replace(/\s+/g, ' ').trim()

/** The gap question → { action, params } with the candidate word exactly as typed; null otherwise. */
export function match(text) {
  if (!historyServed()) return null
  const s = normalise(text)
  if (!s || s.length > 120) return null
  const m = GAPS.exec(s)
  if (!m) return null
  const symbol = m[1] || m[2]
  const pct = Number(m[3])
  if (!(pct >= 1 && pct <= 50)) return null
  const down = m[4] === 'down' || m[4] === 'lower'
  const since = m[5] ? `${m[5]}-01-01` : null
  return { action: CAPABILITY, params: { symbol, indicator: 'gap_pct', period: null, op: down ? 'below' : 'above', threshold: down ? -pct : pct, horizons: [...DEFAULT_HORIZONS], since } }
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
    summary: 'EVENT STUDY from UCT\'s stored daily history: every time ONE stock met a technical condition (an opening gap of N%+, RSI, % from an N-day SMA, Bollinger %B or the MACD histogram above / below / crossing a level), '
      + 'what its price did over the next 1, 5 and 21 sessions — events, hit rate, average, median, best, worst, against all sessions. UCT computes and shows it; you never see the returns. '
      + 'Use this (disposition apply, research null) for "how has NVDA behaved after 5%+ gaps", "what happens after AMD crosses above its 50-day". Descriptive, never a prediction.',
    hints: 'target = the ref of the stockData entry; symbol uppercase. indicator gap_pct (period null; threshold = the gap % — negative with op below for gaps down) | pct_from_sma (period = the SMA days; threshold in %) | rsi (period) | bb_pct_b (period) | macd_hist (period null). '
      + 'op above | below | cross_above | cross_below. horizons = session counts (1–252, at most 4; null = [1, 5, 21]). since = YYYY-MM-DD or null (all history). reply: one short line, no figures.',
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
      },
      required: ['symbol', 'indicator', 'period', 'op', 'threshold', 'horizons', 'since'],
      additionalProperties: false,
    },
    fastWhole: true,
    fastCorrect: false,
    fast: ({ raw }) => { const m = match(raw); return m ? m.params : null },
    answer: (_snap, args) => answerAfterEvent(args),
  })
  return true
}
export const _resetHistoryForTest = () => { if (unregister) unregister(); unregister = null; registered = false }
