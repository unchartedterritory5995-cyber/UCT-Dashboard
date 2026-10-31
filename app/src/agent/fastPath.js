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
import { lexiconFor, correctTypos, setBaseSources } from './nl/lexicon'
import { chartQualifier, ordinalChart, ORD_RE } from './deixis'

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
  // ⭐ Gate B (0C): politeness and filler carry no meaning — "can you show me the weekly", "monthly view
  // please", "hide the rsi for now", "add macd pls". A request phrased as a QUESTION about state ("can
  // you see my rsi") is not touched: only a request verb or a timeframe follows the lead-in.
  [/\b(?:pls|plz)\b/g, 'please'],
  [/^(?:(?:hey|so|actually|um|uh),?\s+)+/, ''],
  [/^(?:can|could|would|will) (?:you|u) (?:please )?(?=(?:show|give|add|remove|hide|switch|change|go|set|make|turn|put|open|load|pull up|bring up)\b)/, ''],
  [/^(?:please )?(?:show me|give me|let me see|lemme see|can i (?:get|see)|i want|i'?d like)(?: it (?:on|in))? (?:the |a |an )?(?=(?:weekly|daily|monthly|hourly|\d+ (?:minute|hour))\b(?! (?:chart|data|bars?) of\b))/, ''],
  [/(?:,?\s+(?:please|for now|real quick|quickly|thanks|thank you|thx|ty))+$/, ''],
  // "… on it / on there / on here": the chart being talked about — the same as "on the chart" below
  [/\s+(?:on|onto) (?:it|there|here)$/, ' on the chart'],
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
      // `__explicit`: the capability read the member's OWN words as an explicit request (policy.js explicitOk)
      const { __target, __explicit, ...rest } = args
      hits.push({ action: name, args: rest, ...(__target ? { target: __target } : {}), ...(__explicit === true ? { explicit: true } : {}) })
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
      // `__explicit`: the capability read the member's OWN words as an explicit request (policy.js explicitOk)
      const { __target, __explicit, ...rest } = args
      hits.push({ action: name, args: rest, ...(__target ? { target: __target } : {}), ...(__explicit === true ? { explicit: true } : {}) })
    }
  }
  return hits.length === 1 ? hits[0] : null
}

// ── target qualifiers ("the left chart", "on the right", "both charts") ──
// Stripped from the text before the clauses are parsed, and returned as a HINT
// the orchestrator resolves against the positions each target kind publishes
// (exactly one match → that target; several → it asks; "both/all" → one op per
// target, applied as ONE change with one Undo — policy.js, owner 2026-10-12). The
// fast path never resolves a target itself.
const POS = '(top[- ]left|top[- ]right|bottom[- ]left|bottom[- ]right|upper[- ]left|upper[- ]right|lower[- ]left|lower[- ]right|left|right|top|bottom|upper|lower)'
const NOUN = '(?:\\s+(?:chart|one|widget))'
const POS_RE = new RegExp(`\\b(?:(?:on|for|in|to)\\s+)?the\\s+${POS}${NOUN}?\\b|\\b${POS}${NOUN}\\b`, 'i')
// P2-B: "all four charts", "all 3 of them" — the COUNT the member said is kept, and checked against the
// board by the orchestrator (a mismatch asks; it never changes a different set of charts than they counted)
// ⭐ acceptance 2026-10-29: "each", "each of them", "every one of them", "each one" too ("…, with a 50 sma on each")
const ALL_RE = /\b(?:(?:on|for|in|to)\s+)?(both|all|every|each)(?:\s+one)?(?:\s+(?:the|of the))?(?:\s+(two|three|four|five|six|seven|eight|nine|ten|\d{1,2}))?(?:\s+(?:charts?|of them|ones))?\b/i
const PLURAL_RE = /(?:\b(?:on|for|in|to)\s+)?(?:\b(?:them|those|these)\b|(?:^|\s)'?em\b)/i
const COUNT_WORD = { two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 }
const NORM_POS = { upper: 'top', lower: 'bottom' }

const cut = (s, m) => (s.slice(0, m.index) + ' ' + s.slice(m.index + m[0].length)).replace(/\s+/g, ' ').trim()

export function extractTarget(text, host = null) {
  // ⭐ PHASE 2: "make them all daily", "switch them both to weekly" — the pronoun belongs to the "all" / "both"
  const s = String(text || '').replace(/\b(?:them|those|these) (all|both)\b/i, '$1')
  const all = ALL_RE.exec(s)
  if (all) {
    const count = all[1].toLowerCase() === 'both' ? 2 : all[2] ? (COUNT_WORD[all[2].toLowerCase()] || Number(all[2])) : null
    return { text: cut(s, all), target: count ? { all: true, count } : { all: true } }
  }
  // ⭐ Charts operator P1: "the second chart", "chart 3", "the last one", "the middle chart" — the board's
  // reading order (deixis.ordinalChart). Resolved against the LIVE charts: one chart → `{chart}`; a word
  // that names none (the 5th of 3) or an unclear "middle" → `{ask}` (the orchestrator asks, nothing runs).
  // ⭐ PHASE 3: "switch em to weekly", "make them hourly" — a plural pronoun as the TARGET (after "them all" / "them both"
  // above). Only a hint: the panel resolves it against the conversation (references.pluralTarget), never the board alone.
  const pl = PLURAL_RE.exec(s)
  if (pl) return { text: cut(s, pl), target: { plural: true } }
  const ord = host ? ordinalChart(s, host.charts?.list?.() || []) : null
  // ⭐ PHASE 3: "add rsi to the first chart" — the preposition before the ordinal goes with it (as a position's does), so
  // the clause left is "add rsi", not "add rsi to"
  if (ord) return { text: cut(s, ord.match).replace(/\s+(?:on|to|onto|for|in|into)$/i, ''), target: ord.ref ? { chart: ord.ref, word: ord.word } : { ask: ord.ask } }
  const m = POS_RE.exec(s)
  if (m) {
    // ⭐ PHASE 2: "top left" / "upper right" (no hyphen) are the same position as "top-left"
    const word = (m[1] || m[2] || '').toLowerCase().replace(' ', '-').replace(/^upper(?=-)/, 'top').replace(/^lower(?=-)/, 'bottom')
    return { text: cut(s, m), target: { position: NORM_POS[word] || word } }
  }
  // NL (2026-10-12): "… to the AMD chart" / "… on the 5 minute chart" — a chart named by the symbol or
  // timeframe a LIVE chart shows is lifted off the clause (so "add rsi" parses); the panel's target
  // rule then resolves it from the member's own words (deixis.chartQualifier) — one chart → it,
  // several (two NVDA charts) → the clicked one or "Which chart?". A word no chart shows is left in.
  const q = host ? chartQualifier(s, host.charts?.list?.() || []) : null
  if (q) return { text: cut(s, q.match), target: { qualifier: q.word } }
  return { text: s, target: null }
}

/** Snapshots matching a position hint ("left" matches left, top-left, bottom-left). */
export function matchPosition(snaps, position) {
  if (!position) return snaps
  const parts = position.split('-')
  return snaps.filter(s => s.position && parts.every(p => s.position.split('-').includes(p)))
}

// ⭐ PHASE 2: "put the 9 and 20 ema on …" — "put" carries to a bare follow-on clause as "add" does
const VERB_LEAD = /^(add|remove|show|hide|put)\b/

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
    // a capability may refuse guessed readings outright (`fastCorrect: false`): only its exact wording is local
    return c && c.fastCorrect !== false && (c.risk || 'local') === 'local' && c.reversible !== false && !SYMBOL_ACTIONS.has(o.action)
  })
}
export function fastParse(text, opts = {}) {
  const exact = fastParseExact(text, opts)
  if (exact) return exact
  const variants = correctTypos(text, lexiconFor(opts.host || null))
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
// the fast path's own phrase words, registered with the lexicon (it cannot import this module)
// (every function holding phrase words is listed — the control words must stay known words, or a typo
// of "cancel" could be read as the only other word near it)
const LEXICON_SOURCES = () => [LEAD.source, TAIL.source, ...CANON.map(([re]) => re.source), POS_RE.source, ALL_RE.source, PLURAL_RE.source, ORD_RE.source,
  fastParseExact.toString(), controlWord.toString(), capabilityPhrases.toString()]
setBaseSources(LEXICON_SOURCES)

function fastParseExact(text, { host = null, controlWords = true } = {}) {
  const t = clean(String(text || ''))
  if (!t || t.length > 160) return null
  // `controlWords: false` (OWNER 2026-10-12): "apply it" with NO proposal waiting is not an approval —
  // the panel then asks the capability phrases instead (e.g. apply the indicator draft)
  if (controlWords) {
    const ctl = controlWord(t)
    if (ctl) return ctl
  }
  return capabilityPhrases(text, host)
}

/** undo / confirm / dismiss / "just the first N" — the universal control words, or null */
function controlWord(t) {
  // M3: "Actually, undo that last change." — a leading filler word never changes what Undo means
  const u = t.replace(/^(?:(?:actually|ok|okay|oops|wait|sorry|hmm|hm|ah|no),?\s+)+(?=(?:undo|revert|reverse|go back|put it back|take (?:that|it) back)\b)/, '')
  // ⭐ PHASE 3: "undo all of that", "undo everything you just did", "take it all back" — EVERY change of the last request
  // (useAgent undoTurn: newest first, each through the same Undo; it stops at the first one that can't be undone)
  if (/^(?:undo|revert|reverse) (?:all (?:of )?(?:that|it|this|those|them|those changes|of those changes)|everything(?: (?:you|i) just (?:did|made|changed|asked for))?|that whole (?:thing|request|change|lot)|the whole (?:thing|request|lot)|all (?:the|those|your|my) (?:last )?changes)$|^take (?:it|that|them|everything) all back$|^take (?:everything|all of (?:that|it|them)) back$/.test(u)) return { kind: 'undo', all: true }
  if (/^(undo|undo (that|it|this|the last (one|change|action|thing))|(revert|reverse)( that| it| this)?|(undo|revert|reverse) (the |my )?last (one|change|action|thing)|go back|put it back|take (that|it) back)$/.test(u)) return { kind: 'undo' }
  // "undo that indicator removal", "undo the last hide", "undo removing that" — the same Undo (the
  // newest change); the noun only describes it, it never picks a different entry. ⛔ F14: a NAMED
  // kind ("indicator", "chart"…) is passed on — when the newest change isn't one, nothing is undone
  // and the member is told what the newest change was (useAgent doUndo `about`).
  const named = /^(?:undo|revert|reverse) (?:that|the|my)(?: last)?(?: (indicator|chart|widget|drawing|layout))? (?:removal|remove|deletion|delete|change|edit|addition|add|hide|show)$/.exec(u)
    || /^(?:undo|revert|reverse) (?:removing|deleting|hiding|showing|adding) (?:that|it|(?:the|that) (indicator))$/.exec(u)
  if (named) return named[1] ? { kind: 'undo', about: named[1] } : { kind: 'undo' }
  // ⭐ PHASE 3: "undo just the color change", "undo the timeframe change", "revert only the symbol switch" — the newest
  // change, when it IS that change (useAgent doUndo `about`); never an older one picked out of the stack
  const what = /^(?:undo|revert|reverse) (?:just |only )?(?:that|the|my)(?: last)? (colou?r|style|timeframe|time frame|symbol|ticker|pane|layout|theme|resize|size|move|rename|link) (?:change|edit|switch|swap)$/.exec(u)
  if (what) return { kind: 'undo', about: what[1].replace(/^colou?r$/, 'colour').replace('time frame', 'timeframe').replace('ticker', 'symbol') }
  if (/^(do it|yes|yes please|yep|go ahead|apply( it| that| them)?|ok(ay)?(,)? do it|confirm|sounds good,? do it)$/.test(t)) return { kind: 'confirm' }
  if (/^(no|nope|cancel|never ?mind|don'?t|skip it|forget it)$/.test(t)) return { kind: 'dismiss' }
  const sub = /^(just |only )?(apply|do) (just |only )?the first (\d|one|two|three|four|five|six)( ones?| changes?| items?)?$/.exec(t)
  if (sub) {
    const n = Number(sub[4]) || WORDNUM[sub[4]]
    if (n > 0) return { kind: 'subset', count: n }
  }
  return null
}

// ⭐ PHASE 3: "slap the 9/20 on all four", "add the 9/20 ema" — two lengths written with a slash, only in a sentence that
// starts with an add verb (so a date — "go to 10/29" — is never read as two lengths)
const ADD_LEAD = /^\s*(?:please\s+)?(?:add|put|throw|stick|slap|pop|plop|plot|load up|put up)\b/i
export const slashPairs = (s) => (ADD_LEAD.test(s) ? s.replace(/\b(\d{1,3})\/(\d{1,3})\b(?!\/)/g, '$1 and $2') : s)

/** Capability phrases: whole-sentence ones first, then clause by clause (all or nothing). */
function capabilityPhrases(text, host) {
  const whole = matchWhole(text, host)
  if (whole) return { kind: 'ops', ops: [whole], target: null }
  const { text: rest0, target } = extractTarget(text, host)
  const rest = slashPairs(rest0)
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
