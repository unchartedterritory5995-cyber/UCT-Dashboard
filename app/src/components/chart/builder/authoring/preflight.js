// app/src/components/chart/builder/authoring/preflight.js
//
// ─── SLICE 2 — THE BROWSER'S COPY OF THE CONVERSATION PRE-FLIGHT ─────────────
//
// An explicit request for ANOTHER SYMBOL or ANOTHER TIMEFRAME is unsupported in
// conversational authoring however it is phrased. Caught here, the member gets
// the answer at once and no request leaves the browser (no model call, no cost).
//
// ⛔ A LATENCY / COST SHORTCUT, NOT A BOUNDARY. The server runs the SAME rules
// (`api/services/conversation_preflight.py`, authoritative) on every turn, and
// its post-call gates stay behind that. Both read one rules file
// (`preflightRules.json`) and assert one case table (`preflightCases.json`).
//
// ⛔ CONSERVATIVE: see the server module's docstring. Ambiguous → the model.

import RULES from './preflightRules.json'
import TABLE from '../../engine/ast/closedTable.json'

export const GATE_SYMBOL = 'unsupported:other-symbol'
export const GATE_TIMEFRAME = 'unsupported:other-timeframe'

const NOT_TICKERS = new Set([
  ...RULES.notTickers.map((w) => w.toUpperCase()),
  ...Object.keys(TABLE.functions || {}).map((n) => n.toUpperCase()),
  ...Object.keys(TABLE.series || {}).map((n) => n.toUpperCase()),
])

const RE = {
  compare: new RegExp(RULES.compareCue, 'i'),
  directCue: () => new RegExp(RULES.useCue, 'g'),            // case-SENSITIVE: the ticker as typed
  ticker: () => new RegExp(RULES.tickerToken, 'g'),
  tfNum: () => new RegExp(RULES.tfNumeric, 'gi'),
  tfWord: () => new RegExp(RULES.tfWord, 'gi'),
  after: new RegExp(RULES.tfContextAfter, 'i'),
  before: new RegExp(RULES.tfContextBefore, 'i'),
  question: new RegExp(RULES.questionLead, 'i'),
}

const normSym = (s) => (typeof s === 'string' && s.trim() ? s.trim().replace(/^\$/, '').toUpperCase() : null)

/** A chart timeframe code → 'D' | 'W' | 'M' | '<minutes>m'; null when unknown. */
export function normTf(tf) {
  if (typeof tf !== 'string') return null
  const t = tf.trim()
  let m = /^(\d+)\s*m$/.exec(t)
  if (m) return `${Number(m[1])}m`
  m = /^(\d+)\s*[hH]$/.exec(t)
  if (m) return `${Number(m[1]) * 60}m`
  if (/^1?[dD]$/.test(t)) return 'D'
  if (/^1?[wW]$/.test(t)) return 'W'
  if (/^1?M$/.test(t)) return 'M'
  return null
}

export function tfWords(code) {
  if (code === 'D') return 'daily'
  if (code === 'W') return 'weekly'
  if (code === 'M') return 'monthly'
  const n = Number(code.slice(0, -1))
  return n % 60 === 0 ? `${n / 60}-hour` : `${n}-minute`
}

function tickers(message) {
  const out = []
  for (const m of message.matchAll(RE.ticker())) {
    const t = m[1].toUpperCase()
    if (!NOT_TICKERS.has(t) && !out.includes(t)) out.push(t)
  }
  return out
}

function otherSymbol(message, chartSym) {
  const ts = tickers(message)
  if (RE.compare.test(message) && ts.length) {
    if (chartSym) {
      const others = ts.filter((t) => t !== chartSym)
      if (others.length) return others[0]
    } else if (ts.length >= 2) {
      return ts[1]
    }
  }
  if (chartSym) {
    for (const m of message.matchAll(RE.directCue())) {
      const t = m[1].toUpperCase()
      if (!NOT_TICKERS.has(t) && t !== chartSym) return t
    }
  }
  return null
}

function wantedTimeframe(message) {
  if (RE.question.test(message)) return null
  const hits = []
  for (const m of message.matchAll(RE.tfNum())) {
    const n = Number(m[1])
    if (!(n > 0)) continue
    const unit = m[2].toLowerCase()
    hits.push([m.index, m.index + m[0].length, unit.startsWith('m') ? `${n}m` : `${n * 60}m`])
  }
  for (const m of message.matchAll(RE.tfWord())) {
    const code = { daily: 'D', weekly: 'W', monthly: 'M', hourly: '60m' }[m[1].toLowerCase()]
    hits.push([m.index, m.index + m[0].length, code])
  }
  hits.sort((a, b) => a[0] - b[0] || a[1] - b[1])
  for (const [start, end, code] of hits) {
    if (RE.after.test(message.slice(end)) || RE.before.test(message.slice(0, start))) return code
  }
  return null
}

/**
 * @param {string} message
 * @param {{sym?: string, tf?: string}|null} chart
 * @returns {null | {gate: string, reason: string, detail: string}}
 */
export function preflight(message, chart = null) {
  if (typeof message !== 'string' || !message.trim()) return null
  const c = chart && typeof chart === 'object' ? chart : {}
  const chartSym = normSym(c.sym)
  const chartTf = normTf(c.tf)

  const other = otherSymbol(message, chartSym)
  if (other) {
    return { gate: GATE_SYMBOL, detail: other, reason: RULES.copy[GATE_SYMBOL].replaceAll('{symbol}', other) }
  }
  if (chartTf) {
    const wanted = wantedTimeframe(message)
    if (wanted && wanted !== chartTf) {
      return {
        gate: GATE_TIMEFRAME, detail: wanted,
        reason: RULES.copy[GATE_TIMEFRAME].replaceAll('{wanted}', tfWords(wanted)).replaceAll('{chart}', tfWords(chartTf)),
      }
    }
  }
  return null
}
