// UCT Agent — `chart.describeSetup`: a GROUNDED description of the open chart's setup (W2-B3, builder-b).
//
// "Describe this setup", "and on the weekly?", "same for AMD": answered from SERVED data only — the chart's own
// snapshot (its symbol, timeframe and the indicators on it, NAMES only, via indicatorRowsOf) plus ONE MD-1
// `bars.daily` read of 252 completed sessions through the gateway. Nothing else is fetched and no model writes a word.
// Every figure is computed from the served bars and names the sessions it came from; a figure the bars cannot
// support is NOT given — the answer says what is missing. The answer ends "Descriptive, not a recommendation."
//
// ⭐ STRUCTURED: the answer carries `setup` so a later "analyze against UCT setup criteria" capability can test named
// conditions. Its `measurables` are the KN-1 v1 ids, with the KN-1 formulas EXACTLY
// (docs/agent/program/contracts/KN-1-knowledge.md "Measurables"; a copy of the v1 table is pinned by
// __fixtures__/kn1-measurables-v1.json). All are over DAILY SESSIONS, whatever timeframe is described:
//   close_vs_sma20 / close_vs_sma50  (close − SMAn) / SMAn × 100                         pct
//   pct_from_52w_high                (close − 52-week high) / 52-week high × 100 (≤ 0)    pct  (highest high of 252 sessions)
//   range_pct_10                     (max high − min low) of the last 10 sessions / min low × 100   pct
//   rel_volume_50d                   last session volume / mean volume of the 50 sessions before it  x
//   sma50_above_sma200               SMA50 > SMA200                                       bool
//   sma50_rising / sma200_rising     SMAn today > SMAn 20 sessions ago                    bool
// Numbers are rounded to 2 dp, and the text shows the SAME rounded numbers (value traceability). A measurable the
// bars cannot support is null and `setup.missing[id]` says why — never inferred.
//   setup = { symbol, asOf (last session YYYY-MM-DD), source: 'bars.daily', timeframe: 'D'|'W', sessions, stale,
//             measurables: {…}, missing: { id: why }, weekly?: { close_vs_sma20w, close_vs_sma50w, range_pct_10w } }
// `weekly` (timeframe W only) is the weekly VIEW the text describes — the same formulas over calendar weeks built from
// the same daily bars (a week dated by its last completed session). It is not a KN-1 measurable.
//
// Gated on the served kinds: unless the server serves data AND lists `bars.daily` and `instrument.resolve`
// (`data_kinds`, fail-closed), `match` returns null and nothing registers. Production lists both, so this is LIVE for
// admins on merge (intended, W2 sprint; pinned by agentProdKinds.test.js), unlike history.afterEvent.

import { registerCapability } from '../capabilities'
import * as agentClient from '../agentClient'
import { readData } from '../marketdata/client'
import { currentTurnId } from '../trace'
import { num, money, sessionDate } from './marketDataFormat'
import { RESOLVE_KIND, toCandidates, resolveInstruments, isFundLabel, FUND_NOTE } from './marketDataResolve'
import { indicatorRowsOf } from './indicatorEdits'

export const CAPABILITY = 'chart.describeSetup'
export const KIND = 'bars.daily'
export const BARS = 252
export const RANGE_SESSIONS = 10
export const VOLUME_AVG_SESSIONS = 50
export const SLOPE_SESSIONS = 20
/** The KN-1 v1 measurable ids, in the contract's table order. */
export const MEASURABLES = ['close_vs_sma20', 'close_vs_sma50', 'pct_from_52w_high', 'range_pct_10', 'rel_volume_50d', 'sma50_above_sma200', 'sma50_rising', 'sma200_rising']
export const DESCRIPTIVE = 'Descriptive, not a recommendation.'
export const SOURCE = "UCT's daily bars (completed sessions only; today's session is not included)"
const TIMEFRAMES = ['D', 'W']

export function describeServed() {
  if (!agentClient.serverServesData()) return false
  const kinds = typeof agentClient.serverDataKinds === 'function' ? agentClient.serverDataKinds() : null
  return Array.isArray(kinds) && kinds.includes(KIND) && kinds.includes(RESOLVE_KIND)
}

const NO_BARS = {
  refused: "that request wasn't allowed for this question, so its daily bars are not available",
  unavailable: "its completed daily bars are not available from UCT's market data",
}
export function noSetupSentence(env, sym) {
  return `I couldn't describe ${sym || 'that'}'s setup: ${NO_BARS[env?.status] || NO_BARS.unavailable}. No figure is stated.`
}

const usableBars = (env) => {
  const ok = env && (env.status === 'ok' || env.status === 'partial')
  const bars = ok ? env?.data?.bars : null
  return Array.isArray(bars) ? bars.filter(b => b && typeof b.date === 'string' && num(b.close) != null) : []
}
const r2 = (v) => (num(v) == null ? null : Math.round(v * 100) / 100)
const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null)
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`
const tfWord = (tf) => (tf === 'W' ? 'weekly' : 'daily')
const pctWord = (p) => `${Math.abs(p).toFixed(2)}% ${p >= 0 ? 'above' : 'below'}`

// ── weekly: the daily bars grouped into calendar weeks (Mon–Sun, calendar-date math) ─────────────────────────────
const weekKey = (ymd) => {
  const d = new Date(`${ymd}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7))   // back to Monday
  return d.toISOString().slice(0, 10)
}
/**
 * Pure: ascending daily bars → ascending weekly bars { week, start, date (the week's last session), high, low, close,
 * volume, sessions }. `dropLeading`: the first week is dropped when the read's window may have cut it (a full read
 * whose first session is not the week's Monday) — a partial week is not a week.
 */
export function weeklyBars(bars, { dropLeading = false } = {}) {
  const out = []
  for (const b of bars) {
    const k = weekKey(b.date)
    const w = out[out.length - 1]
    if (w && w.week === k) {
      w.date = b.date; w.close = b.close; w.sessions += 1
      w.high = num(b.high) == null || w.high == null ? null : Math.max(w.high, b.high)
      w.low = num(b.low) == null || w.low == null ? null : Math.min(w.low, b.low)
      w.volume = num(b.volume) == null || w.volume == null ? null : w.volume + b.volume
    } else {
      out.push({ week: k, start: b.date, date: b.date, high: num(b.high), low: num(b.low), close: b.close, volume: num(b.volume), sessions: 1 })
    }
  }
  if (dropLeading && out.length && out[0].start !== out[0].week) out.shift()
  return out
}

// ── the figures (pure) ─────────────────────────────────────────────────────────────────────────────────────────────
/** SMA of the n closes ending `back` bars before the last; null when the bars are too few. */
const smaAt = (bars, n, back = 0) => (bars.length - back >= n ? mean(bars.slice(bars.length - back - n, bars.length - back).map(b => b.close)) : null)
const trendOf = (bars, n, unit, missing, id) => {
  const s = smaAt(bars, n)
  if (s == null) { if (id) missing[id] = `needs ${n} ${unit}s; ${bars.length} held`; return null }
  return { n, value: s, pct: r2(((bars[bars.length - 1].close - s) / s) * 100), from: bars[bars.length - n].date, to: bars[bars.length - 1].date }
}
const rangeOf = (bars, n, unit, missing, id) => {
  const win = bars.slice(-n)
  if (win.length < n) { missing[id] = `needs ${n} ${unit}s; ${win.length} held`; return null }
  if (!win.every(b => num(b.high) != null && num(b.low) != null)) { missing[id] = `a high or low is missing in the last ${n} ${unit}s`; return null }
  const high = Math.max(...win.map(b => b.high))
  const low = Math.min(...win.map(b => b.low))
  if (!(low > 0)) { missing[id] = `the lowest low of the last ${n} ${unit}s is not positive`; return null }
  return { high, low, pct: r2(((high - low) / low) * 100), from: win[0].date, to: win[win.length - 1].date }
}

/**
 * A `bars.daily` envelope → { setup, detail }: `setup` is the STRUCTURED object (see the header), `detail` the dated
 * inputs each figure came from (for the text). Every number comes from the envelope's bars. Pure; exported for tests
 * and for the setup-criteria analyzer.
 */
export function setupOf(env, { symbol = null, timeframe = 'D' } = {}) {
  const tf = timeframe === 'W' ? 'W' : 'D'
  const sym = String(symbol || env?.data?.symbol || '').toUpperCase() || null
  const daily = usableBars(env)
  const latest = env?.data?.latest_completed_session || null
  const through = daily.length ? daily[daily.length - 1].date : null
  const stale = !!(env?.stale && latest && through && latest !== through)
  const measurables = Object.fromEntries(MEASURABLES.map(id => [id, null]))
  const missing = {}
  const setup = { symbol: sym, asOf: through, source: KIND, timeframe: tf, sessions: daily.length, stale, measurables, missing }
  if (!daily.length) {
    const why = env?.status === 'refused' ? 'the bars read was refused' : 'no completed daily bars were served'
    for (const id of MEASURABLES) missing[id] = why
    return { setup, detail: null }
  }
  const full = daily.length >= BARS
  const last = daily[daily.length - 1]
  const detail = { full, latest, from: daily[0].date, through: last.date, lastClose: { value: last.close, date: last.date } }
  // trend: close vs SMA20 / SMA50 (sessions)
  detail.sma20 = trendOf(daily, 20, 'session', missing, 'close_vs_sma20')
  detail.sma50 = trendOf(daily, 50, 'session', missing, 'close_vs_sma50')
  if (detail.sma20) measurables.close_vs_sma20 = detail.sma20.pct
  if (detail.sma50) measurables.close_vs_sma50 = detail.sma50.pct
  // trend flags: SMA50 vs SMA200, and each one's slope vs 20 sessions earlier
  const s50 = smaAt(daily, 50)
  const s200 = smaAt(daily, 200)
  if (s50 != null && s200 != null) { measurables.sma50_above_sma200 = s50 > s200; detail.stack = { s50, s200 } } else missing.sma50_above_sma200 = `needs 200 sessions; ${daily.length} held`
  for (const [n, id] of [[50, 'sma50_rising'], [200, 'sma200_rising']]) {
    const now = smaAt(daily, n)
    const then = smaAt(daily, n, SLOPE_SESSIONS)
    if (now == null || then == null) { missing[id] = `needs ${n + SLOPE_SESSIONS} sessions; ${daily.length} held`; continue }
    measurables[id] = now > then
    detail[`slope${n}`] = { now, then, thenDate: daily[daily.length - 1 - SLOPE_SESSIONS].date }
  }
  // 52-week high: the highest high of the 252 sessions
  const withHi = daily.filter(b => num(b.high) != null)
  const hi = withHi.length ? withHi.reduce((a, b) => (b.high > a.high ? b : a)) : null
  if (!hi) missing.pct_from_52w_high = 'the served bars carry no highs'
  else {
    const pct = r2(Math.min(0, ((last.close - hi.high) / hi.high) * 100))
    detail.high = { value: hi.high, date: hi.date, pct }
    if (!full) missing.pct_from_52w_high = `needs ${BARS} completed sessions for a 52-week high; ${daily.length} held`
    else if (withHi.length < daily.length) missing.pct_from_52w_high = `${daily.length - withHi.length} of the ${daily.length} sessions carry no high`
    else measurables.pct_from_52w_high = pct
  }
  // consolidation width: the last 10 sessions
  detail.range = rangeOf(daily, RANGE_SESSIONS, 'session', missing, 'range_pct_10')
  if (detail.range) measurables.range_pct_10 = detail.range.pct
  // volume: the last session vs the 50 sessions before it
  const vwin = daily.slice(-(VOLUME_AVG_SESSIONS + 1))
  if (vwin.length < VOLUME_AVG_SESSIONS + 1) missing.rel_volume_50d = `needs ${VOLUME_AVG_SESSIONS + 1} sessions; ${vwin.length} held`
  else if (!vwin.every(b => num(b.volume) != null)) missing.rel_volume_50d = `a volume is missing in the last ${VOLUME_AVG_SESSIONS + 1} sessions`
  else {
    const avg = mean(vwin.slice(0, -1).map(b => b.volume))
    if (!(avg > 0)) missing.rel_volume_50d = `the ${VOLUME_AVG_SESSIONS}-session average volume is zero`
    else {
      measurables.rel_volume_50d = r2(last.volume / avg)
      detail.volume = { last: last.volume, date: last.date, avg: Math.round(avg), from: vwin[0].date, to: vwin[vwin.length - 2].date }
    }
  }
  // the weekly VIEW (timeframe W): the same formulas over calendar weeks
  if (tf === 'W') {
    const weeks = weeklyBars(daily, { dropLeading: full })
    const wmiss = {}
    const w20 = trendOf(weeks, 20, 'week', wmiss, 'close_vs_sma20w')
    const w50 = trendOf(weeks, 50, 'week', wmiss, 'close_vs_sma50w')
    const wr = rangeOf(weeks, RANGE_SESSIONS, 'week', wmiss, 'range_pct_10w')
    setup.weekly = { close_vs_sma20w: w20?.pct ?? null, close_vs_sma50w: w50?.pct ?? null, range_pct_10w: wr?.pct ?? null, weeks: weeks.length, missing: wmiss }
    detail.weekly = { weeks, w20, w50, range: wr, missing: wmiss }
  }
  return { setup, detail }
}

/** The structured setup → the member's answer (pure). Every sentence names the sessions its figure came from. */
export function answerFromSetup(env, { symbol, name = null, timeframe = 'D', indicators = [], label = null, chartTf = null }) {
  const bare = String(symbol || '').toUpperCase()
  const sym = name ? `${bare} (${name})` : bare
  const { setup, detail: o } = setupOf(env, { symbol: bare, timeframe })
  if (!o) return { text: noSetupSentence(env, bare), setup }
  const m = setup.measurables
  const miss = setup.missing
  const ref = o.through
  const d = (ymd) => sessionDate(ymd, ref)
  const W = setup.timeframe === 'W'
  const items = []
  const lines = []
  const head = W
    ? `from ${plural(o.weekly.weeks.length, 'completed week')} (${plural(setup.sessions, 'session')}) ending ${d(o.through)}`
    : `from ${plural(setup.sessions, 'completed session')} ending ${d(o.through)}`
  lines.push(`${sym} — ${tfWord(setup.timeframe)} setup${label ? ` (${label})` : ''}, ${head}:`)
  if (chartTf && !TIMEFRAMES.includes(chartTf) && !W) lines.push('The chart is not on a daily or weekly timeframe, so this describes the daily bars.')
  const close = `the close of ${money(o.lastClose.value)} on ${d(o.lastClose.date)}`
  const smaPart = (t, u) => `${pctWord(t.pct)} the ${t.n}-${u} SMA (${money(r2(t.value))}, ${d(t.from)} to ${d(t.to)})`
  // trend
  if (W) {
    const w = o.weekly
    const parts = [w.w20, w.w50].filter(Boolean).map(t => smaPart(t, 'week'))
    lines.push(parts.length ? `Trend: the week's close of ${money(o.lastClose.value)} (week ending ${d(o.through)}) is ${parts.join(' and ')}.${w.w50 ? '' : ` No 50-week SMA: ${w.missing.close_vs_sma50w}.`}`
      : `Trend: no weekly moving-average comparison — ${w.missing.close_vs_sma20w}.`)
    for (const t of [w.w20, w.w50].filter(Boolean)) items.push({ label: `vs ${t.n}-week SMA`, value: `${t.pct.toFixed(2)}%`, note: `${money(r2(t.value))}; weeks ${d(t.from)} to ${d(t.to)}`, aka: ['trend', String(t.n), `sma ${t.n}`] })
  } else {
    const parts = [o.sma20, o.sma50].filter(Boolean).map(t => smaPart(t, 'session'))
    lines.push(parts.length ? `Trend: ${close} is ${parts.join(' and ')}.${o.sma50 ? '' : ` No 50-session SMA: ${miss.close_vs_sma50}.`}`
      : `Trend: no moving-average comparison — ${miss.close_vs_sma20}.`)
    for (const t of [o.sma20, o.sma50].filter(Boolean)) items.push({ label: `vs ${t.n}-session SMA`, value: `${t.pct.toFixed(2)}%`, note: `${money(r2(t.value))}; closes ${d(t.from)} to ${d(t.to)}`, aka: ['trend', String(t.n), `sma ${t.n}`] })
  }
  // trend flags (daily sessions on either timeframe — the KN-1 flags)
  const flags = []
  if (m.sma50_above_sma200 != null) flags.push(`the 50-session SMA (${money(r2(o.stack.s50))}) is ${m.sma50_above_sma200 ? 'above' : 'not above'} the 200-session SMA (${money(r2(o.stack.s200))})`)
  for (const n of [50, 200]) {
    const id = `sma${n}_rising`
    const s = o[`slope${n}`]
    if (m[id] != null) flags.push(`the ${n}-session SMA is ${m[id] ? 'rising' : 'not rising'} (${money(r2(s.now))} vs ${money(r2(s.then))} on ${d(s.thenDate)}, ${SLOPE_SESSIONS} sessions earlier)`)
  }
  const flagMiss = ['sma50_above_sma200', 'sma50_rising', 'sma200_rising'].filter(id => m[id] == null)
  lines.push(flags.length ? `Trend flags (daily sessions): ${flags.join('; ')}.${flagMiss.length ? ` Not measured: ${flagMiss.map(id => `${id.replace(/_/g, ' ')} (${miss[id]})`).join('; ')}.` : ''}`
    : `Trend flags: not measured — ${miss.sma50_above_sma200}.`)
  // off the high
  if (m.pct_from_52w_high != null) {
    const h = o.high
    lines.push(m.pct_from_52w_high === 0
      ? `Off the high: ${close} is at its 52-week high of ${money(h.value)} on ${d(h.date)} (the highest high of the last ${BARS} completed sessions, ${d(o.from)} to ${d(o.through)}).`
      : `Off the high: ${close} is ${Math.abs(m.pct_from_52w_high).toFixed(2)}% below its 52-week high of ${money(h.value)} on ${d(h.date)} (the highest high of the last ${BARS} completed sessions, ${d(o.from)} to ${d(o.through)}).`)
    items.push({ label: 'Off 52-week high', value: `${m.pct_from_52w_high.toFixed(2)}%`, note: `vs ${money(h.value)} on ${d(h.date)}`, aka: ['high', 'off the high', '52 week'] })
  } else if (o.high && !o.full) {
    lines.push(`Off the high: no 52-week figure — ${miss.pct_from_52w_high}. The highest high of those (${d(o.from)} to ${d(o.through)}) is ${money(o.high.value)} on ${d(o.high.date)}.`)
  } else {
    lines.push(`Off the high: not measured — ${miss.pct_from_52w_high}.`)
  }
  // consolidation
  const rg = W ? o.weekly.range : o.range
  const ru = W ? 'week' : 'session'
  if (rg) {
    lines.push(`Consolidation: the last ${RANGE_SESSIONS} ${ru}s (${d(rg.from)} to ${d(rg.to)}) span ${money(rg.low)} to ${money(rg.high)}, a width of ${rg.pct.toFixed(2)}% of the low.`)
    items.push({ label: `${RANGE_SESSIONS}-${ru} width`, value: `${rg.pct.toFixed(2)}%`, note: `${money(rg.low)}–${money(rg.high)}, ${d(rg.from)} to ${d(rg.to)}`, aka: ['consolidation', 'width', 'range', 'tight'] })
  } else {
    lines.push(`Consolidation: no width — ${W ? o.weekly.missing.range_pct_10w : miss.range_pct_10}.`)
  }
  // volume (sessions on either timeframe)
  if (m.rel_volume_50d != null) {
    const v = o.volume
    lines.push(`Volume: ${v.last.toLocaleString('en-US')} shares on ${d(v.date)}, ${m.rel_volume_50d.toFixed(2)}× the average of ${v.avg.toLocaleString('en-US')} over the ${VOLUME_AVG_SESSIONS} sessions before it (${d(v.from)} to ${d(v.to)}).`)
    items.push({ label: `Volume vs ${VOLUME_AVG_SESSIONS}-session average`, value: `${m.rel_volume_50d.toFixed(2)}×`, note: `${d(v.date)} vs ${d(v.from)} to ${d(v.to)}`, aka: ['volume', 'rvol', 'relative volume'] })
  } else {
    lines.push(`Volume: no comparison — ${miss.rel_volume_50d}.`)
  }
  if (Array.isArray(indicators)) {
    const names = indicators.map(r => (r?.name ? `${r.name}${r.hidden ? ' (hidden)' : ''}` : null)).filter(Boolean)
    lines.push(names.length ? `On the chart: ${names.join(', ')} (names only; their values are not read).` : 'On the chart: no indicators.')
  }
  if (setup.stale) lines.push(`Note: UCT's bars end ${d(o.through)}, but the most recent completed session was ${sessionDate(o.latest, o.latest)}, so this is not the latest state.`)
  if (!o.full) lines.push(`Only ${plural(setup.sessions, 'completed session')} are held (from ${d(o.from)}), fewer than the ${BARS} asked for.`)
  if (isFundLabel(name)) lines.push(FUND_NOTE)
  lines.push(DESCRIPTIVE, `From ${SOURCE}.`)
  return {
    text: lines.join('\n'),
    present: { kind: 'metrics', title: `${bare} — ${tfWord(setup.timeframe)} setup`, short: bare, items, note: DESCRIPTIVE },
    chart: { symbol: bare, label: bare },
    setup,
  }
}

function cleanArgs(args) {
  const symbol = typeof args?.symbol === 'string' && args.symbol.trim() ? args.symbol.trim() : null
  const timeframe = TIMEFRAMES.includes(args?.timeframe) ? args.timeframe : null
  return { symbol, timeframe }
}

export async function answerDescribeSetup(snap, args) {
  const { symbol, timeframe } = cleanArgs(args)
  if (!describeServed()) return "UCT's daily bars aren't available to the Agent here, so I can't describe the setup."
  if (!snap) return 'That chart is not available.'
  const chartSym = String(snap.symbol || '').toUpperCase()
  const chartTf = snap.tf == null ? null : String(snap.tf)
  const other = !!(symbol && symbol.toUpperCase().replace(/^\$/, '') !== chartSym)
  // LT-15: a symbol this chart does NOT show is described from its own daily bars — the chart's timeframe, label and
  // indicators are this chart's, not that symbol's, so none of them is borrowed (daily unless a timeframe is asked)
  const tf = timeframe || (!other && chartTf === 'W' ? 'W' : 'D')
  let resolved = chartSym
  let name = null
  if (other) {
    // a named symbol ("same for AMD") goes through UCT's symbol index first (MD-1 §4.7); the chart's own symbol does not
    const candidates = toCandidates([symbol])
    if (candidates.length !== 1) return "Which ticker? I couldn't find a symbol in that."
    const r = await resolveInstruments(candidates)
    if (!r.ok) return r.text
    resolved = r.symbols[0]
    name = r.names?.[resolved] || null
  }
  if (!resolved) return 'That chart has no symbol yet.'
  const turnId = currentTurnId()
  if (!turnId) return "I couldn't read the daily bars: this needs the Agent's turn, which wasn't available."
  // ONE read of 252 completed sessions (the kind is a string LITERAL: agent-qa's isolation rail checks it statically)
  const env = await readData('bars.daily', { symbol: resolved, bars: BARS }, { purpose: 'answer', turnId })
  // the chart's indicators belong to the chart's own symbol only ("same for AMD" describes AMD's bars, not this chart)
  const indicators = resolved === chartSym ? indicatorRowsOf(snap.cs) : null
  const own = resolved === chartSym
  return answerFromSetup(env, { symbol: resolved, name, timeframe: tf, indicators, label: own ? snap.label || null : null, chartTf: timeframe || !own ? null : chartTf })
}

// ── fast path (pure, fail-closed): "describe this setup", "what's the setup on this chart", "describe the weekly setup"
const DESCRIBE = /^(?:describe|what(?:'s| is)|summari[sz]e|walk me through) (?:the |this |my )?(?:(daily|weekly) )?(?:set-?up|chart(?:'s)? set-?up|chart)(?: (?:here|for me|on (?:this|the|my) chart))?$/i
export function match(text) {
  if (!describeServed()) return null
  const s = String(text || '').replace(/[’`]/g, "'").trim().replace(/[?!.]+$/, '').replace(/\s+/g, ' ').trim()
  if (!s || s.length > 80) return null
  const m = DESCRIBE.exec(s)
  if (!m) return null
  if (/^what/i.test(s) && !/set-?up/i.test(s)) return null       // "what's the chart" alone is not a setup question
  const tf = m[1] ? (m[1].toLowerCase() === 'weekly' ? 'W' : 'D') : null
  return { action: CAPABILITY, params: { symbol: null, timeframe: tf } }
}

// ── LT-15 fast path: "describe the setup on nvda", "what's the setup on $NVDA", "describe NVDA's weekly setup" ───────
// bars.daily is per SYMBOL, so a named ticker is described whether or not a chart shows it. The op still needs a chart
// target (the capability's kind): the chart showing that ticker (the selected one when several do, else the first in
// reading order), or — when none shows it — the selected chart, else the first; the answer then borrows nothing from
// that chart (answerDescribeSetup). The word goes through UCT's symbol index unless a live chart shows it, so a word
// that only MIGHT be a ticker ("meta", "gold") gets the neutral §4.7.3 question — never a guess.
const TICKER = '\\$?([a-z][a-z0-9]{0,5}(?:[.-][a-z]{1,2})?)'
const VERB = "(?:describe|what(?:'s| is)|summari[sz]e|walk me through)"
const ON_SYMBOL = new RegExp(`^${VERB} (?:the |a )?(?:(daily|weekly) )?set-?up (?:on|of|for|in) (?:the )?${TICKER}(?:'s)?(?: (?:chart|stock|ticker))?(?: (?:on the )?(daily|weekly))?$`, 'i')
const SYMBOL_S = new RegExp(`^${VERB} (?:the )?${TICKER}(?:'s)? (?:(daily|weekly) )?(?:chart )?set-?up(?: (?:on the )?(daily|weekly))?$`, 'i')
// words that are not tickers here ("on it", "on this", "on the weekly"): left to the chart phrase or to the model
const NOT_TICKER = new Set(['it', 'this', 'that', 'these', 'those', 'them', 'here', 'there', 'me', 'my', 'the', 'a', 'chart', 'charts',
  'stock', 'ticker', 'symbol', 'one', 'daily', 'weekly', 'monthly', 'intraday', 'hourly', 'left', 'right', 'top', 'bottom', 'first',
  'second', 'third', 'fourth', 'last', 'middle', 'selected', 'current', 'active', 'same', 'other'])
/** Pure: "describe the setup on nvda" → { symbol (as typed, `$` dropped), timeframe } | null. */
export function matchSymbol(text) {
  if (!describeServed()) return null
  const s = String(text || '').replace(/[’`]/g, "'").trim().replace(/[?!.]+$/, '').replace(/\s+/g, ' ').trim()
  if (!s || s.length > 80) return null
  let sym = null
  let tfw = null
  let m = ON_SYMBOL.exec(s)
  if (m) { sym = m[2]; tfw = m[1] || m[3] || null } else if ((m = SYMBOL_S.exec(s))) { sym = m[1]; tfw = m[2] || m[3] || null }
  if (!sym || NOT_TICKER.has(sym.toLowerCase())) return null
  if (/^what/i.test(s) && !/set-?up/i.test(s)) return null
  return { symbol: sym, timeframe: tfw ? (tfw.toLowerCase() === 'weekly' ? 'W' : 'D') : null }
}
/** The chart an op for `symbol` targets (see above), from the live charts; null when the board has none. */
export function chartForSymbol(symbol, charts = [], selected = null) {
  const list = Array.isArray(charts) ? charts.filter(c => c && c.ref) : []
  if (!list.length) return null
  const want = String(symbol || '').toUpperCase().replace(/^\$/, '')
  const showing = list.filter(c => String(c.symbol || '').toUpperCase() === want)
  const pool = showing.length ? showing : list
  return (pool.find(c => c.selected || (selected != null && c.ref === selected)) || pool[0]).ref
}
function fastDescribe({ raw, host }) {
  const plain = match(raw)
  if (plain) return plain.params
  const named = matchSymbol(raw)
  if (!named) return null
  let charts = []
  let selected = null
  try { charts = host?.charts?.list?.() || [] } catch { charts = [] }
  try { selected = host?.charts?.selected?.() || null } catch { selected = null }
  const ref = chartForSymbol(named.symbol, charts, selected)
  if (!ref) return null                                      // no chart at all: the model (and its refusal) decide
  const shown = charts.find(c => c.ref === ref)
  // the ticker a live chart shows is that chart's own (no index read); any other word is checked as typed
  const symbol = String(shown?.symbol || '').toUpperCase() === named.symbol.toUpperCase() ? null : named.symbol
  return { symbol, timeframe: named.timeframe, __target: ref }
}

let registered = false
let unregister = null
/** Idempotent; registers nothing unless `bars.daily` (and `instrument.resolve`) are served. */
export function registerChartDescribeCapability() {
  if (registered || !describeServed()) return false
  registered = true
  unregister = registerCapability({
    name: 'chart.describeSetup',      // a LITERAL (the routing chartSetup group lists it by name)
    surfaces: ['charts'],
    target: 'chart', query: true,
    summary: 'Describe ONE chart\'s setup from UCT\'s own daily bars (completed sessions): the close vs the 20- and 50-bar SMA, the 50/200 SMA trend flags, distance from the 52-week high, the last 10 bars\' consolidation width, '
      + 'the last session\'s volume vs its 50-session average, and the indicators on the chart (names only). Daily, or weekly from the same bars. UCT computes and words every figure. Use this (disposition apply, research null) for "describe this setup", '
      + '"what\'s the setup here", "and on the weekly?", "same for AMD". Descriptive, never a recommendation.',
    hints: 'target = the chart the member means (the selected chart, or ask which). symbol: null = the chart\'s own symbol; a ticker, uppercase, for "same for AMD" (the chart is not changed). '
      + 'timeframe: null = the chart\'s timeframe; "W" for "on the weekly", "D" for daily. A follow-up ("and on the weekly?", "same for AMD") is this action again with the earlier args carried. reply: one short line, no figures.',
    args: {
      type: 'object',
      properties: { symbol: { type: ['string', 'null'] }, timeframe: { type: ['string', 'null'], enum: [...TIMEFRAMES, null] } },
      required: ['symbol', 'timeframe'],
      additionalProperties: false,
    },
    fast: (ctx) => fastDescribe(ctx || {}),
    answer: (snap, args) => answerDescribeSetup(snap, args || {}),
  })
  return true
}
export const _resetDescribeForTest = () => { if (unregister) unregister(); unregister = null; registered = false }
