// ── UCT Agent FAST PATH: obvious commands, no model call ─────────────────────
//
// Two layers:
//   1. universal control words — undo / do it / just the first N / never mind
//   2. capability phrases — each registered capability MAY declare
//      `fast({ raw, lower, core }) -> args | null` for its own obvious wording
//      ("bars", "weekly", "hide volume"). The fast path knows no feature.
//
// Its output is the SAME registry ops the model path produces and goes through
// the same planner / policy / runtime — there is no second, less-checked path.
//
// ⛔ ALL-OR-NOTHING. Every clause must match some capability. One unrecognised
// clause sends the whole message to the model.
//
// Returns null (→ model), or:
//   { kind: 'ops', ops: [{ action, args }], target: null | {position} | {all:true} }
//                                              targets resolved by the caller
//   { kind: 'undo' } | { kind: 'confirm' } | { kind: 'dismiss' } | { kind: 'subset', count }

import { allCapabilityNames, getCapability } from './capabilities'
import { lexiconFor, correctTypos } from './nl/lexicon'

// Phase 1: "change MY chart to 15 minutes", "change the timeframe to daily", "switch to the 15 minute"
// are the same obvious commands as "15 minute chart" — no model call.
const LEAD = /^(please\s+)?(switch|change|go|set|make|turn|flip|put)\s+(it|this|the chart|this chart|chart|my chart|the timeframe|my timeframe|the time frame|timeframe|the chart type|my chart type|the chart style)?\s*(to|into|in|on)?\s*(?:the |a |an )?/
const TAIL = /\s+(chart|timeframe|time frame|view|one|please)$/
const clean = (s) => s.toLowerCase().replace(/[.!?]+$/g, '').replace(/\s+/g, ' ').trim()

// ── Phase 2: ONE shared normalizer for common trading phrasing ──
// Rewrites wording VARIANTS to the canonical words the capability phrases already match — it
// knows no capability and adds no new command. Anything it can't make obvious still reaches the
// model. Every rule is a meaning-preserving synonym; nothing here picks a target or a value.
const NUMWORD = { one: '1', two: '2', three: '3', four: '4', five: '5', ten: '10', fifteen: '15', twenty: '20', thirty: '30', fifty: '50', sixty: '60' }
const CANON = [
  // number words before a unit or a period ("five minutes", "twenty period")
  [new RegExp(`\\b(${Object.keys(NUMWORD).join('|')})(?=[\\s-]+(?:m|min|mins|minutes?|hours?|hr|day|days|period|bar|week)\\b)`, 'g'), (w) => NUMWORD[w]],
  // timeframe shorthand: 5m / 5-min / 5 mins / 15min → "5 minute"; 1h / 4 hr → "1 hour"
  // (never a money amount: "$10m" is ten million dollars, not a timeframe)
  // (no lookbehind — older Safari lacks it, src/noRegexLookbehind.test.js: the character before is captured)
  [/(^|[^$\w.,])(\d+)\s*-?\s*(?:m|mins?|minutes?)\b/g, '$1$2 minute'],
  [/(^|[^$\w.,])(\d+)\s*-?\s*(?:h|hrs?|hours?)\b/g, '$1$2 hour'],
  // indicator names and their period: "20-period exponential moving average" → "20 ema"
  [/\bexponential moving average\b/g, 'ema'], [/\bsimple moving average\b/g, 'sma'],
  [/\b(\d+)[\s-]*(?:period|bar|day)s?\s+(?=ema|sma|rsi|atr|vwap|ma\b|moving average)/g, '$1 '],
  // "the rsi indicator" → "rsi"; "rsi study" → "rsi"
  [/\b(\w+) (?:indicator|study)\b/g, '$1'],
  // conversational lead-ins and "that chart" (the chart just changed — on a one-chart board, the chart)
  [/^(?:(?:now|ok|okay|and|then|also|alright|great|cool),?\s+)+/, ''],
  [/\bthat chart\b/g, 'the chart'],
  // verbs: add-type / remove-type synonyms (only unambiguous ones)
  [/^(?:please )?(?:throw|stick|slap|pop|plop|plot|load up|put up)\b/, 'add'],
  // ("delete" is NOT folded in: deleting a list or layout is a different, permanent action)
  [/^(?:please )?(?:get rid of|take off|take away|ditch)\b/, 'remove'],
  [/^(?:please )?take (.+?) off(?: of)?\b/, 'remove $1 from'],
  // "this chart / my chart / the chart / the active chart" add nothing a single-chart board
  // doesn't already say; with several charts the orchestrator still asks which one
  [/\s+(?:on|to|onto|in|from|off|off of)\s+(?:this|my|the|our)\s+(?:active |current |open |main )?chart$/, ''],
  [/\s+(?:this|my|the)\s+(?:active |current |main )?chart\b/g, ' the chart'],
]
export function canon(text) {
  let s = clean(String(text || ''))
  for (const [re, to] of CANON) s = s.replace(re, to)
  return s.replace(/\s+/g, ' ').trim()
}
const WORDNUM = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6 }

function matchClause(raw, host) {
  const lower = canon(raw)
  if (!lower) return null
  const core = lower.replace(LEAD, '').replace(TAIL, '').trim()
  const hits = []
  for (const name of allCapabilityNames()) {
    const cap = getCapability(name)
    if (typeof cap.fast !== 'function') continue
    // `host` lets a phrase resolve against REAL state (a layout name in the member's
    // catalog); a capability that can't resolve it with certainty returns null.
    const args = cap.fast({ raw: raw.trim(), lower, core, host })
    if (args) {
      // A capability that resolved its own target against real state names it as
      // `__target`; it becomes the op's target (still re-validated by the planner).
      const { __target, ...rest } = args
      hits.push(__target ? { action: name, args: rest, target: __target } : { action: name, args: rest })
    }
  }
  return hits.length === 1 ? hits[0] : null      // ambiguous phrase -> let the model decide
}

// Capabilities whose phrases are WHOLE SENTENCES with lists inside them ("add RKLB,
// PLTR and ASTS to Momentum") declare `fastWhole`; they are tried on the whole text
// BEFORE it is split into clauses on "," / "and".
function matchWhole(text, host) {
  const lower = canon(text)
  const hits = []
  for (const name of allCapabilityNames()) {
    const cap = getCapability(name)
    if (!cap.fastWhole || typeof cap.fast !== 'function') continue
    const args = cap.fast({ raw: String(text).trim(), lower, core: lower, host })
    if (args) {
      const { __target, ...rest } = args
      hits.push(__target ? { action: name, args: rest, target: __target } : { action: name, args: rest })
    }
  }
  return hits.length === 1 ? hits[0] : null
}

// ── target qualifiers ("the left chart", "on the right", "both charts") ──
// Stripped from the text before the clauses are parsed, and returned as a HINT
// the orchestrator resolves against the positions each target kind publishes
// (exactly one match → that target; several → it asks; "both/all" → one op per
// target, which the multi-target policy turns into a proposal). The fast path
// never resolves a target itself.
const POS = '(top-left|top-right|bottom-left|bottom-right|left|right|top|bottom|upper|lower)'
const NOUN = '(?:\\s+(?:chart|one|widget))'
const POS_RE = new RegExp(`\\b(?:(?:on|for|in|to)\\s+)?the\\s+${POS}${NOUN}?\\b|\\b${POS}${NOUN}\\b`, 'i')
const ALL_RE = /\b(?:(?:on|for|in|to)\s+)?(?:both|all|every)(?:\s+(?:the|of the))?(?:\s+(?:charts?|of them|ones))?\b/i
const NORM_POS = { upper: 'top', lower: 'bottom' }

const cut = (s, m) => (s.slice(0, m.index) + ' ' + s.slice(m.index + m[0].length)).replace(/\s+/g, ' ').trim()

export function extractTarget(text) {
  const s = String(text || '')
  const all = ALL_RE.exec(s)
  if (all) return { text: cut(s, all), target: { all: true } }
  const m = POS_RE.exec(s)
  if (!m) return { text: s, target: null }
  const word = (m[1] || m[2] || '').toLowerCase()
  return { text: cut(s, m), target: { position: NORM_POS[word] || word } }
}

/** Snapshots matching a position hint ("left" matches left, top-left, bottom-left). */
export function matchPosition(snaps, position) {
  if (!position) return snaps
  const parts = position.split('-')
  return snaps.filter(s => s.position && parts.every(p => s.position.split('-').includes(p)))
}

const VERB_LEAD = /^(add|remove|show|hide)\b/

// ── NL N3: obvious typos in an instant command ("weeky", "hide volumn", "swtich to daily") ──
// The exact parse always runs first and is never changed. Only when it finds nothing is the sentence
// corrected word by word against the lexicon GENERATED from the registry, the catalog and the member's
// names (nl/lexicon.js), and parsed again. The corrected parse is used only when it is SAFE: plain
// local, reversible actions — never an approval, never a confirm/irreversible action, never an action
// that takes tickers from the text (a ticker is never "corrected"). Anything else → the model, as before.
// The receipt states what actually changed ("Switched timeframe to Weekly"); `corrected` is telemetry.
const SYMBOL_ACTIONS = new Set(['chart.setSymbol', 'chart.compare', 'watchlist.add', 'watchlist.remove', 'widget.addCharts'])
function safeCorrected(r) {
  if (!r) return false
  if (r.kind === 'undo') return true
  if (r.kind !== 'ops') return false                                   // confirm / subset / dismiss: never on a guess
  return r.ops.every(o => {
    const c = getCapability(o.action)
    return c && (c.risk || 'local') === 'local' && c.reversible !== false && !SYMBOL_ACTIONS.has(o.action)
  })
}
export function fastParse(text, opts = {}) {
  const exact = fastParseExact(text, opts)
  if (exact) return exact
  const variants = correctTypos(text, lexiconFor(opts.host || null, LEXICON_SOURCES()))
  if (!variants) return null
  // Every equally close reading is parsed; it is used only when exactly ONE distinct action results
  // ("swithc to 5 minuts": minute | minutes → the same 5-minute switch). Two different actions → model.
  // EVERY reading that parses counts — safe or not ("cancle" = cancel | candle: a dismissal and a chart
  // type are two different meanings, so nothing is corrected).
  const results = new Map()
  for (const v of variants) {
    const r = fastParseExact(v.text, opts)
    if (r) { const key = JSON.stringify(r); if (!results.has(key)) results.set(key, { r, changes: v.changes }) }
  }
  if (results.size !== 1) return null
  const [{ r, changes }] = results.values()
  return safeCorrected(r) ? { ...r, corrected: changes } : null
}
// the fast path's own phrase words, for the lexicon
const LEXICON_SOURCES = () => [LEAD.source, TAIL.source, ...CANON.map(([re]) => re.source), POS_RE.source, ALL_RE.source, fastParseExact.toString()]

function fastParseExact(text, { host = null } = {}) {
  const t = clean(String(text || ''))
  if (!t || t.length > 160) return null
  // M3: "Actually, undo that last change." — a leading filler word never changes what Undo means
  const u = t.replace(/^(?:(?:actually|ok|okay|oops|wait|sorry|hmm|hm|ah|no),?\s+)+(?=(?:undo|revert|reverse|go back|put it back|take (?:that|it) back)\b)/, '')
  if (/^(undo|undo (that|it|this|the last (one|change|action|thing))|(revert|reverse)( that| it| this)?|(undo|revert|reverse) (the |my )?last (one|change|action|thing)|go back|put it back|take (that|it) back)$/.test(u)) return { kind: 'undo' }
  // "undo that indicator removal", "undo the last hide", "undo removing that" — the same Undo (the
  // newest change); the noun only describes it, it never picks a different entry
  if (/^(undo|revert|reverse) (that|the|my)( last)?( indicator| chart| widget| drawing| layout)? (removal|remove|deletion|delete|change|edit|addition|add|hide|show)$/.test(u)
    || /^(undo|revert|reverse) (removing|deleting|hiding|showing|adding) (that|it|the indicator|that indicator)$/.test(u)) return { kind: 'undo' }
  if (/^(do it|yes|yes please|yep|go ahead|apply( it| that| them)?|ok(ay)?(,)? do it|confirm|sounds good,? do it)$/.test(t)) return { kind: 'confirm' }
  if (/^(no|nope|cancel|never ?mind|don'?t|skip it|forget it)$/.test(t)) return { kind: 'dismiss' }
  const sub = /^(just |only )?(apply|do) (just |only )?the first (\d|one|two|three|four|five|six)( ones?| changes?| items?)?$/.exec(t)
  if (sub) {
    const n = Number(sub[4]) || WORDNUM[sub[4]]
    if (n > 0) return { kind: 'subset', count: n }
  }
  const whole = matchWhole(text, host)
  if (whole) return { kind: 'ops', ops: [whole], target: null }
  const { text: rest, target } = extractTarget(text)
  const clauses = rest.split(/,|;|\band\b|\bthen\b|&/i).map(s => s.trim()).filter(Boolean)
  if (!clauses.length || clauses.length > 6) return null
  const ops = []
  let verb = null
  for (const c of clauses) {
    // "add VWAP and RSI": a bare follow-on clause takes the previous clause's verb
    const op = matchClause(c, host) || (verb && !VERB_LEAD.test(canon(c)) ? matchClause(`${verb} ${c}`, host) : null)
    if (!op) return null
    const v = VERB_LEAD.exec(canon(c))
    if (v) verb = v[1]
    ops.push(op)
  }
  return { kind: 'ops', ops, target }
}
