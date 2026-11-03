// UCT Agent — `chart.describeSetup`: a GROUNDED description of the open chart's setup (W2-B3, builder-b).
//
// "Describe this setup", "and on the weekly?", "same for AMD": answered from SERVED data only — the chart's own
// snapshot (its symbol, timeframe and the indicators on it, names only, via the host read-back / indicatorRowsOf)
// plus ONE MD-1 `bars.daily` read (252 completed sessions). Nothing is fetched elsewhere and no model writes a word:
//   · trend vs the 20- and 50-period SMA of the closes (and whether each SMA is rising vs 5 bars earlier),
//   · distance from the 52-week high (the highest high of the window),
//   · consolidation width: the last 10 bars' high–low span as a % of the last close (and of the 52-week range),
//   · volume vs the 50-bar average volume.
// Every figure is traceable: each line names the bars (dates) it was computed from, the structured `observations`
// object carries the same numbers (for a later "analyze against UCT setup criteria" capability to test named
// conditions against), and the answer ends "Descriptive, not a recommendation." Weekly = the daily bars grouped
// into weeks (the week's last completed session closes it). Never live / now; completed sessions only.
//
// Dark by construction: unless the server serves data AND lists `bars.daily` and `instrument.resolve`
// (`data_kinds`, fail-closed), `match` returns null and `registerChartDescribeCapability` registers nothing.

import { registerCapability } from '../capabilities'
import * as agentClient from '../agentClient'
import { readData } from '../marketdata/client'
import { currentTurnId } from '../trace'
import { num, money, signedPct, sessionDate } from './marketDataFormat'
import { RESOLVE_KIND, toCandidates, resolveInstruments, isFundLabel, FUND_NOTE } from './marketDataResolve'
import { indicatorRowsOf } from './indicatorEdits'

export const CAPABILITY = 'chart.describeSetup'
export const BARS = 252
export const SMA_FAST = 20
export const SMA_SLOW = 50
export const SLOPE_BARS = 5
export const CONSOLIDATION_BARS = 10
export const VOLUME_AVG_BARS = 50
export const DESCRIPTIVE = 'Descriptive, not a recommendation.'
export const SOURCE = "UCT's daily bars (completed sessions only; today's session is not included)"
const TIMEFRAMES = ['D', 'W']

export function describeServed() {
  if (!agentClient.serverServesData()) return false
  const kinds = typeof agentClient.serverDataKinds === 'function' ? agentClient.serverDataKinds() : null
  return Array.isArray(kinds) && kinds.includes('bars.daily') && kinds.includes(RESOLVE_KIND)
}

const NO_BARS = {
  refused: "that request wasn't allowed for this question, so its daily bars are not available",
  unavailable: "its completed daily bars are not available from UCT's market data",
}
export function noSetupSentence(env, sym) {
  return `I couldn't describe ${sym || 'that'}'s setup: ${NO_BARS[env?.status] || NO_BARS.unavailable}. No figure is stated.`
}

const usableBars = (env) => {
  const bars = env?.data?.bars
  return Array.isArray(bars) ? bars.filter(b => b && typeof b.date === 'string' && num(b.close) != null) : []
}
const round = (v, d = 2) => (num(v) == null ? null : Number(v.toFixed(d)))
const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null)

// ── weekly: the daily bars grouped into calendar weeks (Mon–Sun, UTC date math; a week closes on its last
// completed session) ───────────────────────────────────────────────────────────────────────────────────────────────
const weekKey = (ymd) => {
  const d = new Date(`${ymd}T12:00:00Z`)
  const dow = (d.getUTCDay() + 6) % 7                  // Monday = 0
  d.setUTCDate(d.getUTCDate() - dow)
  return d.toISOString().slice(0, 10)
}
/** Pure: ascending daily bars → ascending weekly bars { date (the week's last session), open, high, low, close, volume, sessions }. */
export function weeklyBars(bars) {
  const out = []
  for (const b of bars) {
    const k = weekKey(b.date)
    const w = out[out.length - 1]
    if (w && w.week === k) {
      w.date = b.date; w.close = b.close; w.sessions += 1
      if (num(b.high) != null) w.high = w.high == null ? b.high : Math.max(w.high, b.high)
      if (num(b.low) != null) w.low = w.low == null ? b.low : Math.min(w.low, b.low)
      if (num(b.volume) != null) w.volume = (w.volume || 0) + b.volume
    } else {
      out.push({ week: k, date: b.date, open: num(b.open), high: num(b.high), low: num(b.low), close: b.close, volume: num(b.volume), sessions: 1 })
    }
  }
  return out
}

// ── the observations (pure) ─────────────────────────────────────────────────────────────────────────────────────
const sma = (closes, n, endIdx) => (endIdx + 1 >= n ? mean(closes.slice(endIdx + 1 - n, endIdx + 1)) : null)
const slopeOf = (closes, n) => {
  const now = sma(closes, n, closes.length - 1)
  const then = sma(closes, n, closes.length - 1 - SLOPE_BARS)
  if (now == null || then == null) return null
  return now > then ? 'rising' : now < then ? 'falling' : 'flat'
}

/**
 * A `bars.daily` envelope (+ the chart's timeframe and indicator rows) → the STRUCTURED observations, every number
 * computed from the envelope's bars and nothing else. Pure; exported for tests and for a later criteria capability.
 * Null where the window is too short for a figure (said in the text, never guessed).
 */
export function observationsOf(env, { symbol, timeframe = 'D', indicators = [] } = {}) {
  const sym = String(symbol || env?.data?.symbol || '').toUpperCase()
  const usable = env && (env.status === 'ok' || env.status === 'partial')
  const daily = usable ? usableBars(env) : []
  if (!daily.length) return null
  const tf = timeframe === 'W' ? 'W' : 'D'
  const bars = tf === 'W' ? weeklyBars(daily) : daily
  const unit = tf === 'W' ? 'week' : 'session'
  const closes = bars.map(b => b.close)
  const last = bars[bars.length - 1]
  const i = bars.length - 1
  const sma20 = sma(closes, SMA_FAST, i)
  const sma50 = sma(closes, SMA_SLOW, i)
  // the 52-week high: the highest HIGH of the daily window (a weekly view keeps the same sessions)
  const withHi = daily.filter(b => num(b.high) != null)
  const hi = withHi.length ? withHi.reduce((a, b) => (b.high > a.high ? b : a)) : null
  const withLo = daily.filter(b => num(b.low) != null)
  const lo = withLo.length ? withLo.reduce((a, b) => (b.low < a.low ? b : a)) : null
  const offHigh52wPct = hi ? (last.close / hi.high - 1) * 100 : null
  // consolidation: the last CONSOLIDATION_BARS bars' span
  const win = bars.slice(-CONSOLIDATION_BARS)
  const winHi = win.every(b => num(b.high) != null) ? Math.max(...win.map(b => b.high)) : null
  const winLo = win.every(b => num(b.low) != null) ? Math.min(...win.map(b => b.low)) : null
  const consolidationWidthPct = winHi != null && winLo != null && last.close ? ((winHi - winLo) / last.close) * 100 : null
  const range52w = hi && lo ? hi.high - lo.low : null
  const consolidationPctOf52wRange = consolidationWidthPct != null && range52w ? ((winHi - winLo) / range52w) * 100 : null
  // volume: the last bar vs the average of the VOLUME_AVG_BARS bars before it
  const vols = bars.map(b => num(b.volume)).filter(v => v != null)
  const prior = bars.slice(0, -1).map(b => num(b.volume)).filter(v => v != null).slice(-VOLUME_AVG_BARS)
  const avgVol = prior.length >= Math.min(VOLUME_AVG_BARS, 10) ? mean(prior) : null
  const lastVol = num(last.volume)
  const volumeVsAvg = avgVol && lastVol != null ? lastVol / avgVol : null
  return {
    symbol: sym, timeframe: tf, unit, asOf: env.as_of || null, through: last.date, from: bars[0].date, bars: bars.length,
    dailySessions: daily.length, source: SOURCE, stale: !!env.stale, partial: env.status === 'partial',
    lastClose: { value: last.close, date: last.date },
    trend: {
      above20: sma20 == null ? null : last.close > sma20, above50: sma50 == null ? null : last.close > sma50,
      sma20: round(sma20), sma50: round(sma50), sma20Slope: slopeOf(closes, SMA_FAST), sma50Slope: slopeOf(closes, SMA_SLOW),
      slopeBars: SLOPE_BARS,
    },
    offHigh52wPct: round(offHigh52wPct), high52w: hi ? { value: hi.high, date: hi.date } : null, low52w: lo ? { value: lo.low, date: lo.date } : null,
    consolidationWidthPct: round(consolidationWidthPct), consolidationPctOf52wRange: round(consolidationPctOf52wRange),
    consolidation: { bars: win.length, high: winHi, low: winLo, from: win[0].date, to: last.date },
    volumeVsAvg: round(volumeVsAvg), volume: { last: lastVol, avg: round(avgVol, 0), avgBars: prior.length, lastDate: last.date, known: vols.length },
    indicatorsOnChart: indicators.map(r => r.name).filter(Boolean),
  }
}

const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`
const tfWord = (tf) => (tf === 'W' ? 'weekly' : 'daily')

/** The observations → the member's answer (pure). Every sentence names the bars its figure came from. */
export function answerFromSetup(env, { symbol, name = null, timeframe = 'D', indicators = [], label = null }) {
  const bare = String(symbol || '').toUpperCase()
  const sym = name ? `${bare} (${name})` : bare
  const o = observationsOf(env, { symbol: bare, timeframe, indicators })
  if (!o) return { text: noSetupSentence(env, bare) }
  const ref = o.through
  const d = (ymd) => sessionDate(ymd, ref)
  const u = o.unit
  const lines = [`${sym} — ${tfWord(o.timeframe)} setup${label ? ` (${label})` : ''}, from ${plural(o.bars, `completed ${u}`)} ending ${d(o.through)}:`]
  const items = []
  // trend
  const t = o.trend
  const side = (above) => (above ? 'above' : 'below')
  if (t.sma20 != null && t.sma50 != null) {
    lines.push(`Trend: the close of ${money(o.lastClose.value)} on ${d(o.lastClose.date)} is ${side(t.above20)} the ${SMA_FAST}-${u} SMA (${money(t.sma20)}, ${t.sma20Slope} vs ${SLOPE_BARS} ${u}s earlier) and ${side(t.above50)} the ${SMA_SLOW}-${u} SMA (${money(t.sma50)}, ${t.sma50Slope}).`)
    items.push({ label: `vs ${SMA_FAST}-${u} SMA`, value: `${side(t.above20)} (${money(t.sma20)})`, note: `${t.sma20Slope}; closes through ${d(o.through)}`, aka: ['trend', '20', 'sma 20'] },
      { label: `vs ${SMA_SLOW}-${u} SMA`, value: `${side(t.above50)} (${money(t.sma50)})`, note: `${t.sma50Slope}; closes through ${d(o.through)}`, aka: ['50', 'sma 50'] })
  } else if (t.sma20 != null) {
    lines.push(`Trend: the close of ${money(o.lastClose.value)} on ${d(o.lastClose.date)} is ${side(t.above20)} the ${SMA_FAST}-${u} SMA (${money(t.sma20)}, ${t.sma20Slope} vs ${SLOPE_BARS} ${u}s earlier); only ${plural(o.bars, u)} are held, fewer than the ${SMA_SLOW} a ${SMA_SLOW}-${u} SMA needs.`)
    items.push({ label: `vs ${SMA_FAST}-${u} SMA`, value: `${side(t.above20)} (${money(t.sma20)})`, note: `${t.sma20Slope}; closes through ${d(o.through)}`, aka: ['trend', '20', 'sma 20'] })
  } else {
    lines.push(`Trend: only ${plural(o.bars, u)} are held, fewer than the ${SMA_FAST} a ${SMA_FAST}-${u} SMA needs, so no moving-average comparison is given.`)
  }
  // off the high
  if (o.high52w) {
    const full = o.dailySessions >= BARS
    const span = `${full ? 'the highest high of the last 252 completed sessions' : `the highest high of the ${o.dailySessions} completed sessions held, less than a full 52 weeks`}, ${d(o.from)} to ${d(o.through)}`
    lines.push(o.offHigh52wPct >= 0
      ? `Off the high: the close of ${money(o.lastClose.value)} is at its ${full ? '52-week' : `${o.dailySessions}-session`} high of ${money(o.high52w.value)} on ${d(o.high52w.date)} (${span}).`
      : `Off the high: ${Math.abs(o.offHigh52wPct).toFixed(2)}% below its ${full ? '52-week' : `${o.dailySessions}-session`} high of ${money(o.high52w.value)} on ${d(o.high52w.date)} (${span}).`)
    items.push({ label: full ? 'Off 52-week high' : `Off ${o.dailySessions}-session high`, value: signedPct(Math.min(0, o.offHigh52wPct)), note: `vs ${money(o.high52w.value)} on ${d(o.high52w.date)}`, aka: ['high', 'off the high', '52 week'] })
  }
  // consolidation
  const c = o.consolidation
  if (o.consolidationWidthPct != null) {
    lines.push(`Consolidation: the last ${plural(c.bars, u)} (${d(c.from)} to ${d(c.to)}) span ${money(c.low)} to ${money(c.high)}, a width of ${o.consolidationWidthPct.toFixed(2)}% of the last close${o.consolidationPctOf52wRange != null ? ` (${o.consolidationPctOf52wRange.toFixed(1)}% of the ${money(o.low52w.value)}–${money(o.high52w.value)} 52-week range)` : ''}.`)
    items.push({ label: `${c.bars}-${u} width`, value: `${o.consolidationWidthPct.toFixed(2)}%`, note: `${money(c.low)}–${money(c.high)}, ${d(c.from)} to ${d(c.to)}`, aka: ['consolidation', 'width', 'range', 'tight'] })
  } else {
    lines.push(`Consolidation: the last ${plural(c.bars, u)} carry no high/low, so no width is given.`)
  }
  // volume
  const v = o.volume
  if (o.volumeVsAvg != null) {
    lines.push(`Volume: ${v.last.toLocaleString('en-US')} on ${d(v.lastDate)} vs an average of ${v.avg.toLocaleString('en-US')} over the ${plural(v.avgBars, u)} before it (${o.volumeVsAvg.toFixed(2)}× average).`)
    items.push({ label: `Volume vs ${v.avgBars}-${u} average`, value: `${o.volumeVsAvg.toFixed(2)}×`, note: `${v.last.toLocaleString('en-US')} on ${d(v.lastDate)}`, aka: ['volume', 'rvol'] })
  } else {
    lines.push('Volume: not enough bars carry volume for an average, so no comparison is given.')
  }
  lines.push(o.indicatorsOnChart.length ? `On the chart: ${o.indicatorsOnChart.join(', ')} (names only — their values are not read).` : 'On the chart: no indicators.')
  if (o.stale) lines.push(`Note: UCT's bars end ${d(o.through)}, before the most recent completed session, so this is not the latest state.`)
  if (o.partial && o.dailySessions < BARS) lines.push(`Only ${plural(o.dailySessions, 'completed session')} are held (from ${sessionDate(env.data.bars[0].date, ref)}), fewer than the ${BARS} asked for.`)
  if (isFundLabel(name)) lines.push(FUND_NOTE)
  lines.push(DESCRIPTIVE, `From ${SOURCE}.`)
  return {
    text: lines.join('\n'),
    present: { kind: 'metrics', title: `${bare} — ${tfWord(o.timeframe)} setup`, short: bare, items: items.filter(x => x.value), note: DESCRIPTIVE },
    chart: { symbol: bare, label: bare },
    observations: o,
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
  const chartTf = snap.tf === 'W' ? 'W' : 'D'
  const tf = timeframe || chartTf
  let resolved = String(snap.symbol || '').toUpperCase()
  let name = null
  if (symbol && symbol.toUpperCase().replace(/^\$/, '') !== resolved) {
    // a named symbol ("same for AMD") goes through UCT's symbol index first (MD-1 §4.7); the chart's own symbol does not
    const candidates = toCandidates([symbol])
    if (candidates.length !== 1) return "Which ticker? I couldn't find a symbol in that."
    const r = await resolveInstruments(candidates)
    if (!r.ok) return r.text
    resolved = r.symbols[0]
    name = r.names[resolved] || null
  }
  if (!resolved) return 'That chart has no symbol yet.'
  const turnId = currentTurnId()
  if (!turnId) return "I couldn't read the daily bars: this needs the Agent's turn, which wasn't available."
  // ONE read of 252 completed sessions (the kind is a string LITERAL: agent-qa's isolation rail checks it statically)
  const env = await readData('bars.daily', { symbol: resolved, bars: BARS }, { purpose: 'answer', turnId })
  let indicators = []
  try { indicators = resolved === String(snap.symbol || '').toUpperCase() ? indicatorRowsOf(snap.cs) : [] } catch { indicators = [] }
  return answerFromSetup(env, { symbol: resolved, name, timeframe: tf, indicators, label: snap.label || null })
}

// ── fast path (pure, fail-closed): "describe this setup", "what's the setup on this chart", "describe the weekly setup"
const DESCRIBE = /^(?:describe|what(?:'s| is)|summari[sz]e|read|walk me through) (?:the |this |my )?(?:(daily|weekly) )?(?:setup|set-up|chart(?:'s)? setup|setup (?:on|of) (?:this|the|my) chart|chart)(?: (?:here|for me|on (?:this|the|my) chart))?$/i
export function match(text) {
  if (!describeServed()) return null
  const s = String(text || '').replace(/[’`]/g, "'").trim().replace(/[?!.]+$/, '').replace(/\s+/g, ' ').trim()
  if (!s || s.length > 80) return null
  const m = DESCRIBE.exec(s)
  if (!m) return null
  const tf = m[1] ? (m[1].toLowerCase() === 'weekly' ? 'W' : 'D') : null
  return { action: CAPABILITY, params: { symbol: null, timeframe: tf } }
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
    summary: 'Describe ONE chart\'s setup from UCT\'s own daily bars (completed sessions): the close vs the 20- and 50-period SMA and their slope, distance from the 52-week high, the last 10 bars\' consolidation width, '
      + 'volume vs the 50-bar average, and the indicators on the chart (names only). Daily, or weekly from the same bars. Use this (disposition apply, research null) for "describe this setup", '
      + '"what\'s the setup here", "and on the weekly?", "same for AMD". Descriptive, never a recommendation.',
    hints: 'target = the chart the member means (the selected chart, or ask which). symbol: null = the chart\'s own symbol; a ticker, uppercase, for "same for AMD" (the chart is not changed). '
      + 'timeframe: null = the chart\'s timeframe; "W" for "on the weekly", "D" for daily. reply: one short line, no figures.',
    args: {
      type: 'object',
      properties: { symbol: { type: ['string', 'null'] }, timeframe: { type: ['string', 'null'], enum: [...TIMEFRAMES, null] } },
      required: ['symbol', 'timeframe'],
      additionalProperties: false,
    },
    fast: ({ raw }) => { const m = match(raw); return m ? m.params : null },
    answer: (snap, args) => answerDescribeSetup(snap, args || {}),
  })
  return true
}
export const _resetDescribeForTest = () => { if (unregister) unregister(); unregister = null; registered = false }
