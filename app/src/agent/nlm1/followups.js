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
import { inplanOn } from './inplan'

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
  const states = new Map()                // member turn id → the board's charts (symbol, timeframe) when it STARTED
  return {
    noteState(turnId, snap) {
      if (turnId == null || !snap) return
      states.set(turnId, snap)
      while (states.size > MAX_TURNS) states.delete(states.keys().next().value)
    },
    stateBefore(turnId) { return states.has(turnId) ? states.get(turnId) : null },
    note(turnId, text) {
      if (turnId == null) return
      turns.set(turnId, String(text || ''))
      while (turns.size > MAX_TURNS) turns.delete(turns.keys().next().value)
    },
    textOf(turnId) { return turns.has(turnId) ? turns.get(turnId) : null },
    // a request that was taken back is no referent: "same for QQQ" after it must not repeat what is no longer there
    forget(turnId) { turns.delete(turnId); states.delete(turnId) },
    clear() { turns.clear(); states.clear() },
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
export function rewriteSameRequest(text, depth = 0) {
  const raw = clean(text).s
  // D3.3 clause STRUCTURE first (topicalised / plain "give", possessives, a count of charts with tickers) — so every later
  // rule sees the canonical structure, whatever the surface order or verb
  // (the `structure` rewrite is dark behind the in-plan key: no sealed pass took it — nlm1/inplan.js)
  // (the `structure` rewrite is dark behind the in-plan key at the TOP level; a used rule's internal normalisation of its
  // parts — clauses, in-message-repeat: depth > 0 — keeps it, the same exception as same-for-ticker)
  const s = (inplanOn() || depth > 0) ? preNormalise(raw) : raw
  const preChanged = s !== raw
  // D2.2 / D3.3 IN-MESSAGE "SAME": "<request> and the same to AMD", "<request>, same for QQQ", "<request> and do the same with
  // TSLA", "<request> and AMD the same", "<request>, then open a chart for AMD and do the same there", "<request> and give a
  // new AMD chart the same" → explicit STEPS (each run on its own, so "it" in each binds to the chart THAT step creates)
  const same = depth ? null : inMessageSame(s, depth)
  if (same) return same
  // D2.1 MULTI-TICKER CREATION, canonical: "<verb> AMD and QQQ charts[, both with RSI | with the 21 ema on each | and …]"
  // → "open charts for AMD and QQQ[, each with … | , then …]" — the grid reader's and the each-with reader's own form
  // (D2.2: also "… SPY, QQQ, IWM and DIA in four equal charts …")
  // (dark behind the in-plan key: no sealed pass took multi-ticker-create)
  const mt = !inplanOn() ? null : /^(?:(?:please|can you|could you|would you)\s+)?(?:add|open|give me|show me|show|display|pull up|bring up|throw up|put up|load|create|make|get me|set up|i want|i'd like|lemme see|put)\s+(?:(?:two|three|four|five|six|\d)\s+)?(?:new\s+|separate\s+)?(\$?[A-Z]{1,5}(?:\s*(?:,|and|&)\s*\$?[A-Z]{1,5})+)\s+(?:(?:in|as|into)\s+(?:separate\s+|individual\s+|their own\s+)?)?charts?\b\s*(.*)$/.exec(s)
  // (D3.3: a COUNT of charts — "in four equal charts", "on four charts" — is a grid, never new charts on top: preNormalise)
  if (mt) {
    const list = mt[1].replace(/\$/g, '').split(/\s*(?:,|and|&)\s*/).filter(Boolean)
    const tickers = list.length > 2 ? `${list.slice(0, -1).join(', ')} and ${list.at(-1)}` : list.join(' and ')
    const tail = mt[2].trim()
    let rest = null
    let m
    if (!tail) rest = ''
    else if ((m = /^,?\s*(?:both|each|all(?: of them)?)\s+(?:with|having|getting)\s+(.+)$/i.exec(tail))) rest = `, each with ${m[1]}`
    else if ((m = /^,?\s*with\s+(.+?)\s+(?:on|for|in)\s+(?:each|both|all|every one)(?: of them| one| chart)?$/i.exec(tail))) rest = `, each with ${m[1]}`
    else if ((m = /^,?\s*with\s+(.+)$/i.exec(tail))) rest = `, each with ${m[1]}`
    else if ((m = /^,?\s*(?:and|then|and then)\s+(.+)$/i.exec(tail))) rest = `, then ${m[1]}`
    if (rest != null) return { text: `open charts for ${tickers}${rest}`, rule: 'multi-ticker-create' }
  }
  // D2.2 STRUCTURAL NORMALISATIONS, applied in order (each feeds the next); every one turns a structure the readers do not
  // take into one they do — never a new meaning:
  let t = s
  const rules = []
  const stage = (name, fn) => { const n = fn(t); if (n && n !== t) { t = n; rules.push(name) } }
  // (in-plan key, AUDIT's tally: verbless-assign, with-indicator, quantifier and distribute-indicators never fired in any sealed
  // case, alone or combined — dark at the TOP level; a USED rule that normalises its parts internally (clauses,
  // in-message-repeat: depth > 0) keeps them. tf-modifier and add-to-it were used: always on.)
  const gated = depth === 0 && !inplanOn()
  if (!gated) stage('verbless-assign', verblessAssign)       // "…, AMD on the right" → "…, put AMD on the right chart"
  stage('tf-modifier', tfModifier)               // "switch the right chart to TSLA on the weekly …" → "… and make it weekly …"
  if (!gated) stage('with-indicator', withIndicator)         // "<chart request> with RSI [on both]" → "… and put RSI on it" / "… and add RSI to both charts"
  if (!gated) stage('quantifier', quantifierCharts)          // "add rsi to both" → "add rsi to both charts"
  stage('add-to-it', ontoClauses)                // "add X to it / the new one" → "put X on …" (a clause never crosses into another)
  if (!gated) stage('distribute-indicators', distributeIndicators) // "put RSI and MACD on it" → "put RSI on it and put MACD on it"
  if (preChanged) rules.unshift('structure')
  return rules.length ? { text: t, rule: rules.join('+') } : null
}

// ── D3.3 clause structure ──────────────────────────────────────────────────────────────────────────────────────────
const VERBS = 'add|open|create|make|put|switch|change|show|load|pull up|bring up|give|throw|slap|set|draw|turn|swap|flip|exchange|color|colour|paint|remove|take|apply|copy|move|stick'
const STARTS_REQUEST = new RegExp(`^(?:${VERBS})\\b`, 'i')
const TF_PHRASE = /^(?:a |an |the )?(daily|weekly|monthly|hourly)(?: (?:timeframe|time frame|chart|view|interval))?$/i
const TARGET_PHRASE = /^(?:it|them|both(?: of them| charts)?|all(?: of them| charts)?|that(?: one| chart)?|this(?: one| chart)?|the (?:\w+ ){0,2}(?:chart|charts|one)|(?:the )?\$?[A-Z]{1,5}(?: chart)?)$/

/** Structure normalisation of ONE clause or message (each stage text → text). */
function preNormalise(s0) {
  let s = s0
  // a count of charts with tickers ("four charts: SPY, QQQ, NVDA and TSLA, all with rsi") → the grid reader's form (a
  // GRID reuses the charts there: never one chart too many)
  const LIST = '(\\$?[A-Z]{1,5}(?:\\s*(?:,|and|&)\\s*\\$?[A-Z]{1,5})+)'
  const NUMW = '(two|three|four|five|six|\\d)'
  const VERB0 = '(?:(?:please\\s+)?(?:put|show|make|give me|set up|open|create|i want|load|get me|display|throw up|pull up)\\s+(?:me\\s+)?)?'
  // "four charts: SPY, QQQ, …" / "SPY, QQQ, … in four equal charts" / "… on four charts"
  const cg = new RegExp(`^${VERB0}${NUMW}\\s+(?:new\\s+|separate\\s+|equal\\s+)?charts?\\s*(?::|,|-|with|of|for)?\\s*${LIST}\\s*(.*)$`).exec(s)
  const cg2 = cg ? null : new RegExp(`^${VERB0}${LIST}\\s+(?:in|on|as|into)\\s+(?:a\\s+)?${NUMW}\\s+(?:new\\s+|separate\\s+|equal\\s+|equally sized\\s+)?charts?\\b\\s*(.*)$`).exec(s)
  const grid = cg ? { n: cg[1], list: cg[2], tail: cg[3] } : cg2 ? { n: cg2[2], list: cg2[1], tail: cg2[3] } : null
  if (grid) {
    const list = grid.list.replace(/\$/g, '').split(/\s*(?:,|and|&)\s*/).filter(Boolean)
    const tickers = list.length > 2 ? `${list.slice(0, -1).join(', ')} and ${list.at(-1)}` : list.join(' and ')
    const tail = grid.tail.trim().replace(/^,\s*/, '')
    const allWith = /^(?:all|each|both|every one)(?: of them)?\s+(?:with|having|getting)\s+(.+)$/i.exec(tail)
    const withOn = /^with\s+(.+?)(?:\s+(?:on|for|in)\s+(?:each|all|both|every one)(?: of them)?)?$/i.exec(tail)
    let rest = ''
    if (allWith) rest = `, each with ${allWith[1]}`
    else if (withOn) rest = `, each with ${withOn[1]}`
    else if (tail) rest = `, then ${tail.replace(/^(?:and|then|and then)\s+/i, '')}`
    s = `put ${tickers} on ${grid.n} charts${rest}`
  }
  // a creation said without a verb: "new chart for META …" → "add a chart for META …"
  s = s.replace(/^(?:a\s+)?new\s+chart\s+(for|of|with)\b/i, 'add a chart $1')
  // a topic, then "give it …": "the QQQ chart, give it macd" → "give the QQQ chart macd"
  s = s.replace(/^(.+?),\s*give\s+(?:it|them|that one|this one)\s+(.+)$/i, (m, topic, thing) => (TARGET_PHRASE.test(topic.trim()) ? `give ${topic.trim()} ${thing}` : m))
  // possessives: "set its timeframe to weekly", "make their interval monthly", "with its timeframe on weekly"
  s = s.replace(/\b(?:and\s+)?(?:with|set|change|make|switch|put|turn|have)\s+(its|their)\s+(?:time ?frame|interval|tf|resolution|period)\s+(?:to|on|into|as|at|be)?\s*(?:the\s+)?(daily|weekly|monthly|hourly)\b/gi,
    (m, who, tf) => `${/^and\b/i.test(m) || /^with\b/i.test(m) ? 'and ' : ''}make ${who.toLowerCase() === 'its' ? 'it' : 'all of them'} ${tf.toLowerCase()}`).replace(/\s+and\s+and\s+/g, ' and ')
  // "give <target> <thing>" — clause by clause: an indicator → "add <thing> to <target>" ("put … on it"); a timeframe →
  // "make <target> <tf>"
  s = s.split(/(\s*(?:,\s*(?:and\s+)?(?:then\s+)?|;\s*|\s+then\s+|\s+and\s+(?=give\b)))/i).map(part => giveClause(part)).join('')
  return s
}
function giveClause(c) {
  const m = /^give\s+(.+)$/i.exec(c.trim())
  if (!m) return c
  const words = m[1].split(/\s+/)
  for (let i = 1; i < words.length; i++) {
    const target = words.slice(0, i).join(' ')
    const thing = words.slice(i).join(' ')
    if (!TARGET_PHRASE.test(target)) continue
    if (INDICATOR.test(thing)) {
      if (/^(?:it|that(?: one)?|this(?: one)?)$/i.test(target)) return `put ${thing} on it`
      if (/^(?:them|both|both of them|both charts)$/i.test(target)) return `add ${thing} to both charts`
      if (/^all/i.test(target)) return `add ${thing} to all charts`
      return `add ${thing} to ${target}`
    }
    const tf = TF_PHRASE.exec(thing)
    if (tf) {
      if (/^(?:them|both|both of them|both charts)$/i.test(target)) return `make both charts ${tf[1].toLowerCase()}`
      return `make ${target.replace(/^that(?: one)?$|^this(?: one)?$/i, 'it')} ${tf[1].toLowerCase()}`
    }
  }
  return c
}
/** The request with its chart reference replaced by "it" ("add rsi to NVDA" → "put rsi on it"; "make the chart weekly" → "make it weekly"). */
function retargetToIt(p) {
  let out = p
  out = out.replace(/\b(?:to|on|onto|for)\s+(?:the\s+)?(?:\$?[A-Z]{1,5}|(?:\w+\s+){0,2}chart|(?:\w+\s+)?one)(?:\s+chart)?\s*$/, 'on it')
  out = out.replace(/^(make|set|switch|change|turn|flip)\s+(?:the\s+)?(?:\$?[A-Z]{1,5}|(?:\w+\s+){0,2}chart)(?:\s+chart)?\b/i, '$1 it')
  out = out.replace(/^(?:add|throw|slap|stick|load)\s+(.+?)\s+on it$/i, 'put $1 on it')
  return out === p ? null : out
}
function inMessageSame(s, depth) {
  const request = (p) => STARTS_REQUEST.test(p.trim()) && p.trim().split(/\s+/).length >= 3
  const norm = (p) => rewriteSameRequest(p, depth + 1)?.text || p
  let m
  // the same on a NEW chart: "<P>, then open a chart for AMD and do the same there" / "<P> and give a new AMD chart the same"
  m = /^(.+?)(?:,|\s+and)?\s+(?:then\s+)?(?:open|add|create|make|pull up|bring up|start)\s+(?:a\s+|another\s+)?(?:new\s+)?chart\s+(?:for|of|with)\s+\$?([A-Z]{1,5})\s+and\s+(?:do\s+)?(?:the\s+)?same(?:\s+thing)?(?:\s+(?:there|on it|to it|for it|on that one|to that one|on that chart))?$/.exec(s)
    || /^(.+?)\s+and\s+give\s+(?:a\s+)?new\s+\$?([A-Z]{1,5})\s+chart\s+the\s+same$/.exec(s)
  // (same-on-new-chart is dark behind the in-plan key: no sealed pass took it)
  if (m && inplanOn() && request(m[1])) {
    const first = norm(m[1])
    const onIt = retargetToIt(first)
    if (onIt) return { text: `${first}, then add a chart for ${m[2]} and ${onIt}`, rule: 'same-on-new-chart', steps: [first, `add a chart for ${m[2]} and ${onIt}`] }
  }
  // the same for a ticker / chart: "<P> and the same to AMD", "<P>, same for QQQ", "<P> and do the same with TSLA",
  // "<P>, then do the same for QQQ", "<P> and AMD the same"
  m = /^(.+?)(?:,|\s+and)\s+(?:then\s+)?(?:do\s+)?(?:the\s+)?same(?:\s+thing)?\s+(?:for|to|with|on)\s+(.+)$/i.exec(s)
    || (() => { const x = /^(.+?)\s+and\s+(\$?[A-Z]{1,5}|the (?:\w+ ){1,2}(?:chart|one))\s+the\s+same$/.exec(s); return x })()
  if (m && request(m[1])) {
    const first = norm(m[1])
    // in-message-repeat (sealed passes used it) reads its "same for <ticker>" internally — not the gated follow-up rule
    const again = rewriteFollowUp(`same for ${m[2]}`, first, { internal: true })
    if (again) return { text: `${first}, then ${again.text}`, rule: 'in-message-repeat', steps: [first, again.text] }
  }
  return null
}
/**
 * D3.3 CLAUSES: a message of several requests, each clause starting with a command verb ("swap the two charts and add rsi
 * to both", "add the 50 sma to both charts and swap them") → one STEP per clause, each normalised on its own. Lists of
 * tickers or indicators are never split (a clause boundary needs a verb right after it). → { steps, text, rule } | null
 */
export function rewriteClauses(text) {
  const s = clean(text).s
  const parts = s.split(new RegExp(`\\s*(?:;|,\\s*(?:and\\s+)?then\\s+|\\s+and\\s+then\\s+|\\s+then\\s+|,\\s*(?:and\\s+)?(?=(?:${VERBS})\\b)|\\s+and\\s+(?=(?:${VERBS})\\b))\\s*`, 'i')).map(x => x.trim()).filter(Boolean)
  if (parts.length < 2 || !parts.every(p => STARTS_REQUEST.test(p))) return null
  // a later clause's "both of them / them / those" is the SET the clause before named ("swap the top two charts and add rsi
  // to both of them" → "… add rsi to the top two charts")
  const SET_IN = /\b(the (?:(?:top|bottom|left|right|upper|lower)\s+)?(?:two|three|four)(?:\s+(?:top|bottom|left|right))?\s+charts|the (?:(?:top|bottom)\s+)?(?:left|right)\s+and\s+(?:(?:top|bottom)\s+)?(?:left|right)\s+charts|\$?[A-Z]{1,5}(?:\s*(?:,|and)\s*\$?[A-Z]{1,5})+)\b/
  const resolved = parts.map((p, i) => {
    if (!i) return p
    const prev = SET_IN.exec(parts[i - 1])
    return prev ? p.replace(/\b(to|on|onto|for)\s+(?:both of them|both|them|those|these)\b/i, `$1 ${prev[1]}`) : p
  })
  const steps = resolved.map(p => rewriteSameRequest(p, 1)?.text || p)
  return { text: steps.join(', then '), rule: 'clauses', steps }
}

// ── D2.2 normalisation stages (pure text → text) ─────────────────────────────────────────────────────────────────
const POS_WORDS = '(?:(?:top|bottom|upper|lower)\\s+)?(?:left|right|top|bottom|first|second|third|fourth|middle)'
/** "TSLA on the left chart, META on the right one" (no verb) → "put TSLA on the left chart, put META on the right chart" */
function verblessAssign(t) {
  let out = t.replace(new RegExp(`(^|,\\s*|\\band\\s+|\\bthen\\s+)\\$?([A-Z]{1,5}) (?:on|to|in|for) (the ${POS_WORDS})(?: (?:chart|one))?\\b`, 'g'),
    (m, pre, tick, pos) => (NOT_TICKER.has(tick) ? m : `${pre}put ${tick} on ${pos} chart`))
  // "put TSLA on the left" → "… on the left chart" (the reader's own form for a position)
  out = out.replace(new RegExp(`\\b(put \\$?[A-Z]{1,5} on the ${POS_WORDS})(?! (?:chart|one))\\b`, 'g'), '$1 chart')
  return out
}
/** "… to TSLA on the weekly [timeframe] …" → "… to TSLA and make it weekly …" */
function tfModifier(t) {
  if (!/\$?[A-Z]{1,5}\b/.test(t) || !/\b(?:switch|change|put|show|load|open|flip|swap)\b/i.test(t)) return t
  return t.replace(/\s+(?:on|in)\s+(?:the\s+)?(daily|weekly|monthly|hourly)(?:\s+(?:timeframe|chart|view))?(?=\s+with\b|\s*,|\s+and\b|\s*$)/i, ' and make it $1')
}
/** "<chart request> with <indicator>[ on both | on each]" → "… and put <indicator> on it" / "… and add <indicator> to both charts" */
function withIndicator(t) {
  const both = /^(.*\S),?\s+with\s+(.+?)\s+(?:on|for|to)\s+(both|each|all|every one|all of them)(?: of them| charts?)?\s*$/i.exec(t)
  if (both && INDICATOR.test(both[2].trim())) return `${both[1]} and add ${both[2].trim()} to ${/both/i.test(both[3]) ? 'both' : 'all'} charts`
  const w = /^(.+?)\s+with\s+(.+?)(\s+(?:and|,)\s*.+)?$/i.exec(t)
  const chartHead = (h) => /\bcharts?\b|\bswitch (?:it )?to\b|\bon the (?:\w+ )?(?:chart|one)\b|\bmake it (?:daily|weekly|monthly|hourly)\b/i.test(h)
  if (w && chartHead(w[1]) && !/\b(?:each|all|both|every)\s*$/i.test(w[1]) && INDICATOR.test(w[2].trim())) return `${w[1]} and put ${w[2].trim()} on it${w[3] || ''}`
  return t
}
/** "to both" / "on all of them" → "to both charts" / "on all charts" (the fast path's own quantified forms) */
function quantifierCharts(t) {
  return t.replace(/\b(to|on|onto)\s+(both|each of them|all of them|each|all)\b(?!\s+(?:charts?|of\b))/gi, (m, prep, q) => `${prep} ${/both/i.test(q) ? 'both' : 'all'} charts`)
}
// (the "what" never crosses a clause: no comma / "then" / another add verb inside it)
const WHAT = '((?:(?!\\b(?:then|add|throw|slap|stick|load|and then)\\b)[^,;])+?)'
function ontoClauses(t) {
  return t.replace(new RegExp(`\\b(?:add|throw|slap|stick|load) ${WHAT} (?:to|onto) (it|that one|that chart|the new one|the new chart|the one you just added)\\b`, 'gi'), 'put $1 on $2')
}
function distributeIndicators(t) {
  return t.replace(/\bput ((?:(?!\bput\b)[^,;])+?) on (it|the new one|the new chart)\b/gi, (m, list, where) => {
    const items = list.split(/\s*(?:,\s*(?:and\s+)?|\band\b)\s*/).map(x => x.trim()).filter(Boolean)
    return items.length >= 2 && items.every(x => INDICATOR.test(x)) ? items.map(x => `put ${x} on ${where}`).join(' and ') : m
  })
}

/**
 * D3 (across turns): the elliptical follow-up, made explicit from the last committing message `prev` (its text).
 * → { text, rule } | null
 */
export function rewriteFollowUp(text, prev, { internal = false } = {}) {
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
  // (borrow-verb is dark behind the in-plan key: no sealed pass took it)
  else if (inplanOn() && (m = /^(\$?[A-Z]{1,5}) (?:on|to|in) (the (?:\w+ ){1,2}(?:one|chart))$/.exec(s)) && /^(?:put|switch|change|show|load)\b/i.test(P.text)) {
    const verb = /^(\w+)/.exec(P.text)[1].toLowerCase()
    return { text: `${verb === 'switch' || verb === 'change' ? 'put' : verb} ${m[1].replace('$', '')} on ${m[2].replace(/ one$/, ' chart')}`, rule: 'borrow-verb' }
  }
  // "make it weekly and add rsi" right after a request that named a chart by position — "it" is that chart
  // (it-is-named-chart is dark behind the in-plan key: no sealed pass took it)
  else if (inplanOn() && /\bit\b/i.test(s) && P.pos && !P.creates && !COLOUR.test(s) && (TF_RE.test(s) || /\b(?:add|put)\b/i.test(s))) {
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
    // (same-for-ticker as a follow-up of its own is dark behind the in-plan key; in-message-repeat reads it internally)
    if (!internal && !inplanOn()) return null
    return { text: withTf(replaceWord(P.text, P.tickers[0], tick[1].toUpperCase()), P.tf, tf), rule: 'same-for-ticker' }
  }
  // chart positions: the last request again on each chart named
  const positions = positionsOf(phrase, P.pos)
  if (!positions || P.creates) return null
  const one = (p) => withTf(P.posPhrase ? P.text.replace(P.posPhrase, `the ${p} chart`) : `${P.text} on the ${p} chart`, P.tf, tf)
  // (same-on-charts — the plural — never fired in a sealed case: dark behind the in-plan key; same-on-chart was used)
  if (positions.length > 1 && !internal && !inplanOn()) return null
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
    // each reading in turn (same-request first, then the follow-up), the first one a reader takes; a reading no reader
    // takes never hides the next one
    // (D3.3: then the message as CLAUSES, each its own step) — a reading made of STEPS counts only when EVERY step is taken
    for (const make of [() => rewriteSameRequest(text), () => rewriteFollowUp(text, prev), () => rewriteClauses(text)]) {
      const r = make()
      if (!r || r.text === text) continue
      if (originalClaimed && !r.override) continue
      if (r.steps) { if (r.steps.length > 1 && r.steps.every(st => claims(st))) return r; continue }
      // a follow-up's explicit form may itself carry a same-request reference ("… with RSI")
      // (a '<follow-up>+<same-request>' composite never fired in a sealed case: dark behind the in-plan key)
      const again = inplanOn() ? rewriteSameRequest(r.text) : null
      const out = again ? { ...again, rule: `${r.rule}+${again.rule}` } : r
      if (out.steps ? out.steps.every(st => claims(st)) : claims(out.text)) return out
    }
    return null
  } catch { return null }
}
