// UCT Agent — `chartSetup.multiTimeframe` (Track D workflow "setupSnapshot", DARK): ONE stock's DAILY and WEEKLY setup
// SIDE BY SIDE, from ONE `bars.daily` read of 252 completed sessions — the weekly view is built from the same daily
// bars (calendar weeks, chartDescribe.weeklyBars), so both columns are dated to the same last session.
//
// "daily and weekly setup for NVDA", "multi-timeframe snapshot of this chart", "NVDA daily vs weekly": answered
// DETERMINISTICALLY by REUSING chart.describeSetup's pure computation (chartDescribe.setupOf — the KN-1 formulas, not a
// second implementation). Per column: the close vs the 20- and 50-bar SMA, the last 10 bars' width; shared: the
// distance off the 52-week high, the daily trend flags; and an ALIGNMENT line that only COUNTS which of the four
// averages the close sits above (a fact, never a call). A figure the bars cannot support is not given and its reason is
// said (e.g. "needs 50 weeks; 48 held"). Ends "Descriptive, not a recommendation."
//
// Isolation: the chart.describeSetup contract (a served NON-local chart read; turn.DATA_READ_ACTIONS blanks the model's
// pre-read reply). Changes no chart. Dark: workflowGate (UCT_AGENT_WORKFLOWS lists setupSnapshot) + bars.daily +
// instrument.resolve served.

import { registerCapability } from '../capabilities'
import { readData } from '../marketdata/client'
import { currentTurnId } from '../trace'
import { money, sessionDate } from './marketDataFormat'
import { toCandidates, resolveInstruments, isFundLabel, FUND_NOTE, RESOLVE_KIND } from './marketDataResolve'
import { setupOf, chartForSymbol, BARS, RANGE_SESSIONS, noSetupSentence } from './chartDescribe'
import { workflowServed, armGroupWords, DESCRIPTIVE } from './workflowGate'

export const CAPABILITY = 'chartSetup.multiTimeframe'
export const WORKFLOW = 'setupSnapshot'
export const KINDS = ['bars.daily', RESOLVE_KIND]
export const SOURCE = "UCT's daily bars (completed sessions only; today's session is not included); weekly = calendar weeks built from them"

export const multiTimeframeServed = () => workflowServed(WORKFLOW, KINDS)

const pctCell = (t) => (t ? `${t.pct >= 0 ? '+' : '−'}${Math.abs(t.pct).toFixed(2)}%` : '—')
const rel = (t, unit, d) => `${Math.abs(t.pct).toFixed(2)}% ${t.pct >= 0 ? 'above' : 'below'} its ${t.n}-${unit} SMA (${money(Math.round(t.value * 100) / 100)}, ${d(t.from)} to ${d(t.to)})`

/** The side-by-side card (pure; exported for tests). → { text, table, present, chart, snapshot } */
export function answerFromMultiTimeframe(env, { symbol, name = null }) {
  const bare = String(symbol || '').toUpperCase()
  const sym = name ? `${bare} (${name})` : bare
  const { setup, detail: o } = setupOf(env, { symbol: bare, timeframe: 'W' })
  if (!o) return { text: noSetupSentence(env, bare) }
  const w = o.weekly
  const m = setup.measurables
  const d = (ymd) => sessionDate(ymd, o.through)
  const lastWeek = w.weeks[w.weeks.length - 1]
  const lines = [`${sym} — daily and weekly setup side by side, from ${setup.sessions} completed sessions (${w.weeks.length} calendar weeks) ending ${d(o.through)}:`]
  lines.push(`Close: ${money(o.lastClose.value)} on ${d(o.lastClose.date)} — also the close of the week ending ${d(lastWeek.date)}${lastWeek.sessions < 5 ? ` (that week holds ${lastWeek.sessions} completed session${lastWeek.sessions === 1 ? '' : 's'})` : ''}.`)
  const cmp = (n) => {
    const dt = o[`sma${n}`]; const wt = w[`w${n}`]
    const dayPart = dt ? `daily ${rel(dt, 'session', d)}` : `daily not measured (${setup.missing[`close_vs_sma${n}`]})`
    const wkPart = wt ? `weekly ${rel(wt, 'week', d)}` : `weekly not measured (${w.missing[`close_vs_sma${n}w`]})`
    return `vs the ${n}-bar SMA: ${dayPart}; ${wkPart}.`
  }
  lines.push(cmp(20), cmp(50))
  const dr = o.range; const wr = w.range
  lines.push(`Last ${RANGE_SESSIONS} bars' width: ${dr ? `daily ${dr.pct.toFixed(2)}% (${d(dr.from)} to ${d(dr.to)})` : `daily not measured (${setup.missing.range_pct_10})`}; ${wr ? `weekly ${wr.pct.toFixed(2)}% (weeks ending ${d(wr.from)} to ${d(wr.to)})` : `weekly not measured (${w.missing.range_pct_10w})`}.`)
  // alignment: a COUNT of the averages the close is above — a fact about the four comparisons, never a call
  const four = [['daily 20', o.sma20], ['daily 50', o.sma50], ['weekly 20', w.w20], ['weekly 50', w.w50]].filter(([, t]) => t)
  if (four.length) {
    const above = four.filter(([, t]) => t.pct > 0).map(([k]) => k)
    const below = four.filter(([, t]) => t.pct <= 0).map(([k]) => k)
    lines.push(`Alignment: the close is above ${above.length} of the ${four.length} averages measured${above.length && below.length ? ` (above: ${above.join(', ')}; at or below: ${below.join(', ')})` : ''}.`)
  }
  if (m.pct_from_52w_high != null) lines.push(`Off the 52-week high: ${Math.abs(m.pct_from_52w_high).toFixed(2)}% below ${money(o.high.value)} on ${d(o.high.date)} (the same on both timeframes).`)
  else lines.push(`Off the 52-week high: not measured — ${setup.missing.pct_from_52w_high}.`)
  const flags = []
  if (m.sma50_above_sma200 != null) flags.push(`50-session SMA ${m.sma50_above_sma200 ? 'above' : 'not above'} the 200`)
  if (m.sma50_rising != null) flags.push(`50 ${m.sma50_rising ? 'rising' : 'not rising'}`)
  if (m.sma200_rising != null) flags.push(`200 ${m.sma200_rising ? 'rising' : 'not rising'}`)
  if (flags.length) lines.push(`Trend flags (daily sessions, vs 20 sessions earlier): ${flags.join('; ')}.`)
  if (setup.stale) lines.push(`Note: UCT's bars end ${d(o.through)}, but the most recent completed session was ${sessionDate(o.latest, o.latest)}, so this is not the latest state.`)
  if (!o.full) lines.push(`Only ${setup.sessions} completed sessions are held (from ${d(o.from)}), fewer than the ${BARS} asked for.`)
  if (isFundLabel(name)) lines.push(FUND_NOTE)
  lines.push(DESCRIPTIVE, `From ${SOURCE}.`)
  const table = {
    columns: ['Measure', 'Daily', 'Weekly'],
    rows: [
      ['Close vs 20-bar SMA', pctCell(o.sma20), pctCell(w.w20)],
      ['Close vs 50-bar SMA', pctCell(o.sma50), pctCell(w.w50)],
      [`${RANGE_SESSIONS}-bar width`, dr ? `${dr.pct.toFixed(2)}%` : '—', wr ? `${wr.pct.toFixed(2)}%` : '—'],
    ],
  }
  return {
    text: lines.join('\n'),
    table,
    present: { kind: 'table', title: `${bare} — daily vs weekly`, short: bare, table, text: `${lines[0]}\n${DESCRIPTIVE}` },
    chart: { symbol: bare, label: bare },
    snapshot: { symbol: bare, asOf: setup.asOf, source: 'bars.daily', stale: setup.stale, daily: { close_vs_sma20: m.close_vs_sma20, close_vs_sma50: m.close_vs_sma50, range_pct_10: m.range_pct_10 },
      weekly: { close_vs_sma20w: setup.weekly.close_vs_sma20w, close_vs_sma50w: setup.weekly.close_vs_sma50w, range_pct_10w: setup.weekly.range_pct_10w }, pct_from_52w_high: m.pct_from_52w_high },
  }
}

export async function answerMultiTimeframe(snap, args) {
  if (!multiTimeframeServed()) return "UCT's daily-and-weekly snapshot isn't available to the Agent here."
  if (!snap) return 'That chart is not available.'
  const chartSym = String(snap.symbol || '').toUpperCase()
  const asked = typeof args?.symbol === 'string' && args.symbol.trim() ? args.symbol.trim() : null
  let resolved = chartSym
  let name = null
  if (asked && asked.toUpperCase().replace(/^\$/, '') !== chartSym) {
    // a named symbol goes through UCT's symbol index first (MD-1 §4.7); the chart's own symbol does not
    const candidates = toCandidates([asked])
    if (candidates.length !== 1) return "Which ticker? I couldn't find a symbol in that."
    const r = await resolveInstruments(candidates)
    if (!r.ok) return r.text
    resolved = r.symbols[0]
    name = r.names?.[resolved] || null
  }
  if (!resolved) return 'That chart has no symbol yet.'
  const turnId = currentTurnId()
  if (!turnId) return "I couldn't read the daily bars: this needs the Agent's turn, which wasn't available."
  // ONE read of 252 completed sessions: both columns come from it (a string LITERAL kind: agent-qa's isolation rail)
  const env = await readData('bars.daily', { symbol: resolved, bars: BARS }, { purpose: 'answer', turnId })
  return answerFromMultiTimeframe(env, { symbol: resolved, name })
}

// ── fast path (pure, fail-closed) ───────────────────────────────────────────────────────────────────────────────
const TICKER = '\\$?([a-z][a-z0-9]{0,5}(?:[.-][a-z]{1,2})?)'
const BOTH = '(?:daily (?:and|&|vs\\.?|versus) weekly|weekly (?:and|&|vs\\.?|versus) daily|multi[- ]?time ?frames?|mtf)'
const LEAD = "(?:show(?: me)? |describe |what(?:'s| is) |give me |compare |summari[sz]e )?(?:the |a |this |my )?"
const NOUN = '(?: (?:set-?ups?|snapshots?|views?|pictures?|reads?|charts?))?'
const ON = `(?: (?:on|for|of|in) (?:the |this )?(?:chart|${TICKER}(?:'s)?(?: (?:chart|stock|ticker))?))?`
const A = new RegExp(`^${LEAD}${BOTH}${NOUN}${ON}(?: side by side)?$`, 'i')
const B = new RegExp(`^${LEAD}${TICKER}(?:'s)? ${BOTH}${NOUN}(?: side by side)?$`, 'i')
const NOT_TICKER = new Set(['it', 'this', 'that', 'the', 'my', 'me', 'a', 'chart', 'charts', 'stock', 'ticker', 'one', 'here', 'daily', 'weekly', 'setup', 'show', 'describe', 'give', 'compare'])
/** → { symbol (as typed, or null for the chart's own) } | null */
export function matchMulti(text) {
  if (!multiTimeframeServed()) return null
  const s = String(text || '').replace(/[’`]/g, "'").trim().replace(/[?!.]+$/, '').replace(/\s+/g, ' ').trim()
  if (!s || s.length > 100) return null
  let m = A.exec(s)
  if (m) {
    const sym = m[1] || null
    if (sym && NOT_TICKER.has(sym.toLowerCase())) return null
    return { symbol: sym }
  }
  m = B.exec(s)
  if (m && !NOT_TICKER.has(m[1].toLowerCase())) return { symbol: m[1] }
  return null
}
function fastMulti({ raw, host }) {
  const hit = matchMulti(raw)
  if (!hit) return null
  let charts = []
  let selected = null
  try { charts = host?.charts?.list?.() || [] } catch { charts = [] }
  try { selected = host?.charts?.selected?.() || null } catch { selected = null }
  if (!hit.symbol) {
    // "this chart": exactly one chart, or the selected one; several and none selected → the model asks which
    const pick = charts.length === 1 ? charts[0].ref : (charts.find(c => c.selected || (selected != null && c.ref === selected))?.ref || null)
    return pick ? { symbol: null, __target: pick } : null
  }
  const ref = chartForSymbol(hit.symbol, charts, selected)
  if (!ref) return null
  const shown = charts.find(c => c.ref === ref)
  return { symbol: String(shown?.symbol || '').toUpperCase() === hit.symbol.toUpperCase().replace(/^\$/, '') ? null : hit.symbol, __target: ref }
}

// the chartSetup group's extra words while this is registered
export const MTF_WORDS = [/\b(?:daily (?:and|&|vs\.?|versus) weekly|weekly (?:and|&|vs\.?|versus) daily|multi[- ]?time ?frames?|mtf)\b/]

let registered = false
let unregister = null
/** Idempotent; registers nothing unless the workflow is switched on and `bars.daily` + `instrument.resolve` are served. */
export function registerMultiTimeframeCapability() {
  // a later config load that switches the workflow off takes the capability AND its routing words out (review #788 f)
  if (registered) { if (!multiTimeframeServed()) _resetMultiTimeframeForTest(); return false }
  if (!multiTimeframeServed()) return false
  registered = true
  unregister = registerCapability({
    name: 'chartSetup.multiTimeframe',   // a LITERAL: turn.DATA_READ_ACTIONS names it (the server blanks a pre-read reply)
    surfaces: ['charts'],
    target: 'chart', query: true,
    summary: 'ONE stock\'s DAILY and WEEKLY setup SIDE BY SIDE from UCT\'s completed daily bars (the weekly built from the same bars): the close vs the 20- and 50-bar SMA and the last 10 bars\' width on each timeframe, '
      + 'how many of those four averages the close is above, the distance off the 52-week high and the daily trend flags. UCT computes and words every figure; the chart is not changed. '
      + 'Use this (disposition apply, research null) for "daily and weekly setup for NVDA", "multi-timeframe snapshot of this chart", "NVDA daily vs weekly". Descriptive, never a recommendation.',
    hints: 'target = the chart the member means (the selected chart, or ask which). symbol: null = the chart\'s own symbol; a ticker, uppercase, for another stock (the chart is not changed). reply: one short line, no figures.',
    args: { type: 'object', properties: { symbol: { type: ['string', 'null'] } }, required: ['symbol'], additionalProperties: false },
    fastWhole: true,                  // "daily AND weekly": tried on the whole text, before the clause split on "and"
    fast: (ctx) => fastMulti(ctx || {}),
    answer: (snap, args) => answerMultiTimeframe(snap, args || {}),
  })
  armGroupWords('chartSetup', MTF_WORDS, true)
  return true
}
export const _resetMultiTimeframeForTest = () => { if (unregister) unregister(); unregister = null; registered = false; armGroupWords('chartSetup', MTF_WORDS, false) }
