// ── NLM-1 D2 + D3 · REFERENCES ACROSS STEPS AND TURNS (DARK: the NLM-1 two-key flag) ──────────────────────────
//
// Traders talk in ellipsis: "same for QQQ", "now the right one too", "same on the left but weekly", "and one for
// QQQ", "and the other one monthly", "do that for the top right and bottom left charts", "add a chart for AMD with
// RSI", "add rsi to the new one". The panel's readers (fastPath, multiChart, compound, conversation) already
// understand the EXPLICIT form of each of these. This module only REWRITES the elliptical message into that explicit
// form — from the conversation's referents — and hands it to the same readers, planner, policy (approvals,
// protected layouts), runtime, receipts and grouped Undo. There is no second action engine: a rewrite no reader
// claims is dropped and the message goes on exactly as typed.
//
// THE REFERENT TRACKER (D3): what each member message that COMMITTED a change said (memory.lastTurn().id → its
// text), read into slots — its ticker, the chart it named by position, its timeframe word, whether it created a chart.
// The last committing message is the referent for "same / that / it / the other one". Session-only, bounded, never
// sent anywhere; validated by the readers against the LIVE board at use (a chart that is gone is refused there).
//
// SAME-REQUEST REFERENCES (D2): "<chart request> with <indicator>" → "<chart request> and put <indicator> on it",
// "add X to it / the new one" → "put X on it / the new one" — the explicit forms whose "it" Track A's CG-37
// (createdBinding.js) binds to the chart the earlier step of the SAME request created.
//
// Pure: no state but the tracker object the caller owns; never throws (any surprise → null).

import { NOT_TICKER } from './capabilityIndex'

const POS = ['top left', 'top right', 'bottom left', 'bottom right', 'upper left', 'upper right', 'lower left', 'lower right',
  'left', 'right', 'top', 'bottom', 'first', 'second', 'third', 'fourth', 'last', 'middle']
const POS_RE = new RegExp(`\\bthe (${POS.join('|')}) (chart|one)\\b`, 'i')
const TF_WORDS = ['daily', 'weekly', 'monthly', 'hourly']
const TF_RE = new RegExp(`\\b(${TF_WORDS.join('|')})\\b`, 'i')
const OTHER = { left: 'right', right: 'left', top: 'bottom', bottom: 'top', first: 'second', second: 'first' }
const TWO = { 'bottom two': ['bottom left', 'bottom right'], 'top two': ['top left', 'top right'], 'left two': ['top left', 'bottom left'], 'right two': ['top right', 'bottom right'] }
const CREATES = /\b(?:add|open|create|make|give me|pull up|bring up|start)\b(?: me)? (?:a |an |one |another |a new |new |\w+ new )?(?:\w+ )?charts? (?:for|of|with)\b|\bnew charts? for\b/i
const COLOUR = /\b(red|green|blue|white|black|orange|yellow|purple|pink|teal|gr[ae]y|cyan|magenta|thick|thicker|thin|thinner|dashed|dotted|solid)\b/i
const INDICATOR = /^(?:an? |the )?(?:\d{1,3}(?: and (?:the )?\d{1,3})?(?:[- ]?day)? ?(?:ema|sma|ma|wma|hma|moving averages?)s?|rsi|macd|bollinger(?: bands)?|vwap|atr|adx|obv|stochastic|stoch rsi|keltner(?: channels?)?|ichimoku|supertrend|volume profile)(?: \(\d+\))?$/i

/** Ticker-shaped words of the raw text (upper-case, 1–5 letters, not an indicator acronym). */
export function tickersOf(raw) {
  return [...String(raw || '').matchAll(/(?:^|[\s$(,])\$?([A-Z]{1,5})(?=['’]s\b|[\s,.!?)]|$)/g)].map(m => m[1]).filter(w => !NOT_TICKER.has(w))
}

/** The slots of an explicit request: { text, tickers, pos, tf, creates }. */
export function slotsOf(text) {
  const t = String(text || '')
  const pos = POS_RE.exec(t)
  const tf = TF_RE.exec(t)
  return { text: t, tickers: tickersOf(t), pos: pos ? pos[1].toLowerCase() : null, posPhrase: pos ? pos[0] : null, tf: tf ? tf[1].toLowerCase() : null, creates: CREATES.test(t) }
}

// ── the tracker ─────────────────────────────────────────────────────────────────────────────────────────────────
const MAX_TURNS = 24
export function createReferents() {
  const turns = new Map()                 // member turn id → the text it was read as
  return {
    note(turnId, text) {
      if (turnId == null) return
      turns.set(turnId, String(text || ''))
      while (turns.size > MAX_TURNS) turns.delete(turns.keys().next().value)
    },
    textOf(turnId) { return turns.has(turnId) ? turns.get(turnId) : null },
    clear() { turns.clear() },
  }
}

// ── message shape ───────────────────────────────────────────────────────────────────────────────────────────────
const LEAD = /^(?:(?:and|now|ok|okay|also|then|cool|great|perfect|nice)[,]?\s+)+/i
const TAIL = /(?:,?\s+(?:too|as well|also|please|pls|thanks))+$/i
function clean(text) {
  let s = String(text || '').trim().replace(/[.!?]+$/, '').trim()
  const tail = TAIL.test(s)
  s = s.replace(LEAD, '').replace(TAIL, '').trim()
  return { s, tail }
}
const replaceWord = (text, from, to) => text.replace(new RegExp(`(^|[^A-Za-z])\\$?${from}(?=[^A-Za-z]|$)`, 'g'), (m, pre) => `${pre}${to}`)

/** Positions a target phrase names: ["right"], ["top right", "bottom left"], or null. */
export function positionsOf(phrase, prevPos = null) {
  let p = String(phrase || '').toLowerCase().trim().replace(/^(?:on |for |to |with |in )/, '').replace(/^the /, '').replace(/ (?:charts?|ones?)$/, '').trim()
  if (TWO[p]) return TWO[p]
  if (/^other(?: one)?$/.test(p)) return prevPos && OTHER[prevPos] ? [OTHER[prevPos]] : null
  const parts = p.split(/\s*(?:,|\band\b)\s*(?:the\s+)?/).map(x => x.replace(/ (?:charts?|ones?)$/, '').trim()).filter(Boolean)
  return parts.length && parts.every(x => POS.includes(x)) ? parts : null
}

const withTf = (text, prevTf, tf) => (!tf ? text : prevTf ? text.replace(new RegExp(`\\b${prevTf}\\b`, 'gi'), tf) : `${text} and make it ${tf}`)

/**
 * D2 (same request): explicit forms of a request whose later part points at what an earlier part made.
 * → { text, rule } | null
 */
export function rewriteSameRequest(text) {
  const { s } = clean(text)
  // "add rsi to it / to the new one / onto that chart" → "put rsi on …" (the reader's own phrasing)
  const onto = /^(?:add|throw|slap|stick|load) (.+?) (?:to|onto) (it|that one|that chart|the new one|the new chart|the one you just added)$/i.exec(s)
  if (onto) return { text: `put ${onto[1]} on ${onto[2]}`, rule: 'add-to-it' }
  // "<a chart request> with <indicator>[ and …]" → "<chart request> and put <indicator> on it[ and …]"
  const w = /^(.+?)\s+with\s+(.+?)(\s+and\s+.+)?$/i.exec(s)
  const chartHead = (h) => /\bcharts?\b|\bswitch (?:it )?to\b|\bon the (?:\w+ )?(?:chart|one)\b/i.test(h)
  if (w && chartHead(w[1]) && !/\b(?:each|all|both|every)\s*$/i.test(w[1]) && INDICATOR.test(w[2].trim())) {
    return { text: `${w[1]} and put ${w[2].trim()} on it${w[3] || ''}`, rule: 'with-indicator' }
  }
  return null
}

/**
 * D3 (across turns): the elliptical follow-up, made explicit from the last committing message `prev` (its text).
 * → { text, rule } | null
 */
export function rewriteFollowUp(text, prev) {
  if (!prev) return null
  const P = slotsOf(prev)
  const raw = String(text || '')
  const { s: s0, tail } = clean(raw)
  // a timeframe modifier: "… but weekly", "the other one monthly"
  let s = s0
  let tf = null
  const but = new RegExp(`^(.*?)(?:,)?\\s+but\\s+(?:make it |on the |on |in |as )?(${TF_WORDS.join('|')})(?: chart| timeframe| view)?$`, 'i').exec(s)
  if (but) { s = but[1].trim(); tf = but[2].toLowerCase() }
  const trailTf = new RegExp(`^(.*\\b(?:one|chart|charts))\\s+(${TF_WORDS.join('|')})$`, 'i').exec(s)
  if (!tf && trailTf) { s = trailTf[1].trim(); tf = trailTf[2].toLowerCase() }

  let target = null
  let m
  if (/^(?:do |did )?(?:the )?same(?: thing)?$/i.test(s)) target = { none: true }
  else if ((m = /^(?:do |did )?(?:the )?same(?: thing)? (?:for|on|to|with|in) (.+)$/i.exec(s))) target = { phrase: m[1] }
  else if ((m = /^do (?:that|this|it)(?: again)? (?:for|on|to|with|in) (.+)$/i.exec(s))) target = { phrase: m[1] }
  else if ((m = /^one (?:for|of|with) (\$?[A-Za-z]{1,5})$/i.exec(s))) target = { phrase: m[1], create: true }
  else if ((tail || tf) && (m = /^(?:the |on the |for the )?((?:\w+ ){0,3}(?:one|chart|charts))$/i.exec(s))) target = { phrase: m[1] }
  // "and QQQ on the right one" — a ticker on a chart, no verb: borrow the last request's verb
  else if ((m = /^(\$?[A-Z]{1,5}) (?:on|to|in) (the (?:\w+ ){1,2}(?:one|chart))$/.exec(s)) && /^(?:put|switch|change|show|load)\b/i.test(P.text)) {
    const verb = /^(\w+)/.exec(P.text)[1].toLowerCase()
    return { text: `${verb === 'switch' || verb === 'change' ? 'put' : verb} ${m[1].replace('$', '')} on ${m[2].replace(/ one$/, ' chart')}`, rule: 'borrow-verb' }
  }
  // "make it weekly and add rsi" right after a request that named a chart by position — "it" is that chart
  else if (/\bit\b/i.test(s) && P.pos && !P.creates && !COLOUR.test(s) && (TF_RE.test(s) || /\b(?:add|put)\b/i.test(s))) {
    return { text: s.replace(/\b(?:on |to )?it\b/i, (w) => (/^(?:on|to) /i.test(w) ? `${w.split(' ')[0]} the ${P.pos} chart` : `the ${P.pos} chart`)), rule: 'it-is-named-chart', override: true }
  }
  if (!target) return null

  if (target.none) {
    if (!tf) return null                                         // a bare "same" is not a request
    return { text: withTf(P.text, P.tf, tf), rule: 'same-but-tf' }
  }
  const phrase = String(target.phrase).trim()
  // a ticker: the last request again for that ticker
  const tick = /^\$?([A-Za-z]{1,5})$/.exec(phrase)
  if (tick && (/^[A-Z$]/.test(phrase) || target.create) && !POS.includes(phrase.toLowerCase()) && !/^(?:it|that|this|them|those|both|all|one)$/i.test(phrase)) {
    if (P.tickers.length !== 1) return null
    return { text: withTf(replaceWord(P.text, P.tickers[0], tick[1].toUpperCase()), P.tf, tf), rule: 'same-for-ticker' }
  }
  // chart positions: the last request again on each chart named
  const positions = positionsOf(phrase, P.pos)
  if (!positions || P.creates) return null
  const one = (p) => withTf(P.posPhrase ? P.text.replace(P.posPhrase, `the ${p} chart`) : `${P.text} on the ${p} chart`, P.tf, tf)
  return { text: positions.map(one).join(' and '), rule: positions.length > 1 ? 'same-on-charts' : 'same-on-chart' }
}

/**
 * The one entry point. `claims(text)`: does a deterministic reader read this text (fastParse / multiChart / compound)?
 * `originalClaimed`: did a reader already read the message as typed? Then nothing is rewritten (NLM-1 fills gaps; it
 * does not re-read what the panel understands) — except a rule marked `override`: "make it weekly and add rsi" right
 * after "put TSLA on the right chart", whose typed reading has no chart for "add rsi" on a two-chart board.
 * → { text, rule } | null
 */
export function nlm1Rewrite(text, { prev = null, claims = () => false, originalClaimed = false } = {}) {
  try {
    const r = rewriteSameRequest(text) || rewriteFollowUp(text, prev)
    if (!r || r.text === text) return null
    if (originalClaimed && !r.override) return null
    // a follow-up's explicit form may itself carry a same-request reference ("… with RSI")
    const again = rewriteSameRequest(r.text)
    const out = again ? { text: again.text, rule: `${r.rule}+${again.rule}` } : r
    return claims(out.text) ? out : null
  } catch { return null }
}
