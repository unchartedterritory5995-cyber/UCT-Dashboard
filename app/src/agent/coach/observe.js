// ── UCT Agent COACH: ONE grounded observation from the open chart (W3-1) ──────────────────────────────────────────
//
// With a chart open and the MD-1 `bars.daily` kind served, the coach adds exactly one observation line to a
// concept explanation, built ONLY from the envelope's values (completed sessions; the newest session's date is the
// envelope's own `through`). It names a RELATION, never a value:
//   ma      "the last close is above its 20-day average, and the 20-day average is above the 50-day average"
//   volume  "the last completed session's volume was above its 20-session average"
// No chart, no served data, too few bars, a refused read → null (no observation; nothing is guessed). No price,
// volume or percentage ever leaves this module, so every coach answer's figures stay traceable (coach/guard.js).

import * as agentClient from '../agentClient'
import { readData } from '../marketdata/client'
import { currentTurnId } from '../trace'

const TICKER = /^[A-Z][A-Z0-9.-]{0,9}$/
export const BARS = 50
const MA_SHORT = 20
const MA_LONG = 50

export function barsServed() {
  if (!agentClient.serverServesData()) return false
  const kinds = typeof agentClient.serverDataKinds === 'function' ? agentClient.serverDataKinds() : null
  return Array.isArray(kinds) && kinds.includes('bars.daily')
}

/** The chart an observation is about: the selected chart, else the only / first one → { symbol, label } | null. */
export function observedChart(host) {
  let charts = []
  try { charts = host?.charts?.list?.() || [] } catch { charts = [] }
  if (!charts.length) return null
  const c = charts.find(x => x.selected) || charts[0]
  const symbol = String(c?.symbol || '').toUpperCase().replace(/^\$/, '')
  return TICKER.test(symbol) ? { symbol, label: c.label || symbol, ref: c.ref } : null
}

const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length
const nums = (bars, k) => bars.map(b => Number(b?.[k])).filter(v => Number.isFinite(v))

/** PURE: the observation sentence from an envelope (or null). Exported so the rails can feed it fixtures. */
export function observationFromEnvelope(env, kind, { symbol }) {
  if (!env || !['ok', 'partial'].includes(env.status) || !Array.isArray(env.data?.bars)) return null
  const bars = env.data.bars
  const through = String(env.data.through || '').slice(0, 10)
  if (!through) return null
  const lead = `On this chart (${symbol}, daily bars through ${through})`
  if (kind === 'volume') {
    const vols = nums(bars, 'volume')
    if (vols.length < MA_SHORT + 1) return null
    const last = vols[vols.length - 1]
    const avg = mean(vols.slice(-MA_SHORT - 1, -1))
    if (!(avg > 0)) return null
    return `${lead}: the last completed session's volume was ${last > avg ? 'above' : last < avg ? 'below' : 'at'} its ${MA_SHORT}-session average.`
  }
  const closes = nums(bars, 'close')
  if (closes.length < MA_SHORT) return null
  const last = closes[closes.length - 1]
  const s = mean(closes.slice(-MA_SHORT))
  const rel = (a, b) => (a > b ? 'above' : a < b ? 'below' : 'at')
  let text = `${lead}: the last close is ${rel(last, s)} its ${MA_SHORT}-day average`
  if (closes.length >= MA_LONG) text += `, and the ${MA_SHORT}-day average is ${rel(s, mean(closes.slice(-MA_LONG)))} the ${MA_LONG}-day average`
  return `${text}.`
}

let lastObservation = null
/** The latest observation (symbol + text), for the coach context entry (sync). */
export const lastObserved = () => lastObservation
export const _resetObserveForTest = () => { lastObservation = null }

/** ONE gateway read → the observation line for this chart, or null. Never throws. */
export async function observe(host, kind) {
  if (!kind || kind === 'none' || !barsServed()) return null
  const chart = observedChart(host)
  if (!chart) return null
  let env
  try { env = await readData('bars.daily', { symbol: chart.symbol, bars: BARS }, { purpose: 'answer', turnId: currentTurnId() }) } catch { return null }
  const text = observationFromEnvelope(env, kind, chart)
  lastObservation = text ? { symbol: chart.symbol, kind, text } : null
  return text
}
