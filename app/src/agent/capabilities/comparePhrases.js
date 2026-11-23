// ── COMPARE (Charts C1 Compare family): the GENERAL readers of a member's compare wording — no model call ───────────
//
// The instant path for the Compare family, written as phrase CLASSES rather than sentences. Each reader takes the
// member's words and returns ONE existing capability's args, or null (→ the model, exactly as before):
//
//   chart.compare               add / remove / clear single symbols     (Tools → Compare Symbols: the symbol box, a row's ×)
//   chartSetup.compareDisplay   a comparison's scale, eye, Group only   (the row's Same % / New price scale, its eye)
//   chartSetup.compareGroup     a whole theme / sector / industry       (the group picker, a group row's ×, its scale)
//   compare.openView            the panel on its Rotation / Overlay tab (the "Open the rotation map" link's door)
//   chart.setScale              "show it as percent"                    (the A / L / % toggle)
//
// Every reader is built from the same parts:
//
//   VERB      compare · overlay · add / put … as a comparison · remove / drop … comparison · stop comparing · clear · hide
//             / show · put … on the same / its own scale · group only · open the rotation map
//   SYMBOLS   a list ("MSFT", "MSFT and QQQ", "MSFT, QQQ & SPY") of words read as tickers ONLY when the member marked them
//             as tickers: typed in capitals inside lower-case text, written "$amd", a symbol already on the board or in a
//             watchlist, or a short word UCT knows no other meaning for (`plainSymbolWord`). Indicator words (RSI, VWAP …)
//             and pronouns are never tickers. Whether the ticker EXISTS is decided by chart.compare's own lookup (prepare):
//             an unknown one is refused with a suggestion (Gate B), never swapped for another.
//   BASE      the chart compared against: "it" / "this" / "the chart" (the chart the panel picks — the only chart, the
//             clicked one, or it asks), or a ticker a chart on the board shows ("compare AAPL with MSFT" → the AAPL chart).
//             ⛔ The BASE is never a symbol to add, and a symbol to add is never the target: a base no chart shows, or that
//             several charts show, is left to the model.
//   GROUP     a group's name as said, matched later by UCT's own lists (compareGroup.matchGroup); the reader only finds it.
//
// ⛔ READ ONLY. Nothing here plans or writes: the args go through the same capability check → the Compare panel's own list
// writers → persist → read-back → exact Undo as a model plan.
// ⛔ ONE READING. Fundamentals words ("valuation", "earnings"), questions, "side by side" (two charts — multiChart.js) and
// "next to" are never read as an overlay. A sentence that names a chart (a position, an ordinal, "all charts", "the NVDA
// chart") is not read whole here: the fast path lifts the chart words first and the panel's own target rules (positions,
// deixis, spatialCheck, "which chart?") pick the chart; the reader then sees only the clause.

import { plainSymbolWord, lexiconFor } from '../nl/lexicon'
import { isPronounToken, isReservedWord } from '../nl/tickers'
import { groupsIn } from '../../pages/charts/compareGroups'
import { matchGroup, nameWords } from './compareGroup'

const comps = (cs) => (Array.isArray(cs?.comparisonSymbols) ? cs.comparisonSymbols : [])
const esc = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
function chartsOf(host) { try { return host?.charts?.list?.() || [] } catch { return [] } }
function selectedOf(host) { try { return host?.charts?.selected?.() || null } catch { return null } }

// ── SYMBOLS ──
// Words that are never a ticker here, whatever their case (indicator and chart words; "VS" is the comparison itself).
const NOT_TICKERS = new Set(['i', 'a', 'uct', 'etf', 'adr', 'rs', 'rsi', 'macd', 'ema', 'sma', 'wma', 'hma', 'vwma', 'atr', 'adx', 'cci',
  'mfi', 'obv', 'vwap', 'avwap', 'bb', 'dmi', 'roc', 'stoch', 'ma', 'vol', 'volume', 'et', 'am', 'pm', 'ok', 'us', 'nyse', 'ohlc', 'hlc',
  'vs', 'versus', 'd', 'w', 'm', 'chart', 'charts', 'group', 'theme', 'sector', 'industry', 'comparison', 'comparisons', 'overlay', 'overlays'])
const TICK = '\\$?[a-z][a-z0-9.\\-]{0,9}'
const SEP = '\\s*(?:,\\s*(?:and\\s+|&\\s*)?|&\\s*|\\+\\s*|\\band\\s+|\\bplus\\s+)'
const LIST = `(${TICK}(?:${SEP}${TICK})*)`
// a BASE word is never the comparison's own preposition or an article ("compare against the …", "compare the …")
const BASE_TOK = `(?!(?:with|to|against|vs|versus|relative|the|my|a|an|w)\\b)${TICK}`

/** How the member typed `word` in `raw`: { dollar, text } or null. */
function typedForm(word, raw) {
  const m = new RegExp(`(^|[^A-Za-z0-9$.])(\\$?)(${esc(word)})(?![A-Za-z0-9])`, 'i').exec(String(raw || ''))
  return m ? { dollar: !!m[2], text: m[3] } : null
}
const onBoard = (w, host) => {
  const u = w.toUpperCase()
  if (chartsOf(host).some(c => String(c.symbol || '').toUpperCase() === u)) return true
  try { return lexiconFor(host).symbols.has(w.toLowerCase()) } catch { return false }
}
/**
 * The ticker a word stands for (upper case), or null when the member did not mark it as one.
 * `strict`: a lower-case word must be a symbol already on the board / in a watchlist (a group or tab name is often a
 * plain word: "tech", "semis").
 */
export function tickerWord(word, raw, host, { strict = false } = {}) {
  const w0 = String(word || '').trim()
  const dollar = w0.startsWith('$')
  const w = w0.replace(/^\$/, '')
  if (!/^[a-z][a-z0-9.-]{0,9}$/i.test(w) || /[.-]$/.test(w)) return null
  const t = typedForm(w, raw)
  if (!t) return null
  const up = w.toUpperCase()
  if (dollar || t.dollar) return up                                        // "$amd", "$IT": explicitly a ticker
  if (NOT_TICKERS.has(w.toLowerCase()) || isReservedWord(t.text)) return null
  const caps = /^[A-Z][A-Z0-9.-]*$/.test(t.text) && /[a-z]/.test(String(raw || ''))
  if (caps) return up                                                      // capitals inside lower-case text mark a ticker
  if (isPronounToken(t.text, raw)) return null
  if (onBoard(w, host)) return up
  if (strict) return null
  // a short word UCT gives no other meaning (NL N4, as chart.setSymbol); longer words (indicator or company names) → the model
  return w.length <= 5 && plainSymbolWord(w.toLowerCase(), host, raw) ? up : null
}
/** "msft, qqq and spy" → ['MSFT', 'QQQ', 'SPY'] (each a marked ticker), or null. */
export function tickerList(words, raw, host, opts) {
  const parts = String(words || '').split(new RegExp(SEP, 'i')).map(s => s.trim()).filter(Boolean)
  if (!parts.length || parts.length > 10) return null
  const out = []
  for (const p of parts) {
    const t = tickerWord(p, raw, host, opts)
    if (!t) return null
    if (!out.includes(t)) out.push(t)
  }
  return out
}

// ── BASE / chart words ──
const SELF = '(?:it|this|this one|the chart|this stock|the stock|that|that one|here|the current chart|the current symbol)'
const SELF_RE = new RegExp(`^${SELF}$`)
// A sentence that names a chart: lifted by the fast path's target reader before the clause is read (see header).
const NAMES_A_CHART = /\b(?:left|right|top|bottom|upper|lower|middle|centre|center|first|second|third|fourth|fifth|last|other|both|all|every|each|them|those|these|em)\b|\bcharts\b|\bchart\s*#?\d|\b(?:the|this|that)\s+(?!(?:chart|one|main|active|current|selected|open|same)\b)\S+\s+(?:chart|one)\b|\b(?:daily|weekly|monthly|hourly|\d+\s*(?:minute|hour))\s+charts?\b/
// "all the comparisons" / "every comparison": the comparisons' own quantifier, never a set of charts
const OWN_ALL = /\b(?:all|every|each)(?: one)?(?: of)?(?: (?:the|my|these|those|this chart'?s?))? (?=(?:comparisons?|compares?|compared|comparison|overlaid|overlay(?:s|ed)? symbols?)\b)/g
const stripOwnAll = (s) => s.replace(OWN_ALL, '')
const NOT_OVERLAY = /\b(?:fundamentals?|valuations?|p\/?e|eps|earnings|revenues?|sales|margins?|financials?|stats|metrics|growth|market caps?|stack up|stacks up|side[\s-]by[\s-]side|next to|beside|alongside|breadth|news|returns?|performance|ytd)\b/
const QUESTION = /^(?:how|what|which|why|when|who|is|are|does|do|did|can|could|should|would|will)\b(?! you\b)/

const canonish = (t) => String(t || '').toLowerCase().replace(/\s+/g, ' ')
/** The member's words, made ready for the grammar (canon's words, the comparisons' own "all", trailing extras off). */
function wordsOf({ lower, typed }) {
  let s = stripOwnAll(String(lower || '')).replace(/\s+/g, ' ').trim()
  s = s.replace(/(?:,?\s+(?:too|as well|also|for me|now|again please))+$/, '')
    .replace(/^(?:(?:please|also|now|just|ok|okay)\s+|(?:can|could|would|will) (?:you|u) (?:please )?|(?:i want to|i'?d like to|let'?s|lets|go ahead and)\s+)+/, '')
    // a preposition the target words were lifted from ("remove the QQQ comparison from [the left chart]")
    // (never on / off: "group only off" says something)
    .replace(/\s+(?:from|onto|off of|out of|for|of)$/, '').trim()
  // `here`: THESE words still name a chart — the whole sentence, before the fast path lifts the chart words (→ null, so the
  // clause is read after the panel's own target rules have it). `named`: the member's TYPED sentence named one — the
  // clause is read, but the reader never sets the chart itself (the lifted words decide it)
  const here = NAMES_A_CHART.test(s)
  const named = here || NAMES_A_CHART.test(stripOwnAll(canonish(typed || lower)))
  return { s, here, named }
}

/** The chart a BASE word names → { self: true } | { ref } | null (no chart, or several: not read here). */
function baseOf(word, raw, host) {
  if (!word || SELF_RE.test(word)) return { self: true }
  const t = tickerWord(word, raw, host)
  if (!t) return null
  const charts = chartsOf(host).filter(c => String(c.symbol || '').toUpperCase() === t)
  if (charts.length === 1) return { ref: charts[0].ref, sym: t }
  const sel = selectedOf(host)
  if (charts.length > 1 && sel && charts.some(c => c.ref === sel)) return { ref: sel, sym: t }
  return null
}

/** The one chart whose comparisons `pred` holds → its ref, else null (none, or several). */
function onlyChartWith(host, pred) {
  const hits = chartsOf(host).filter(c => pred(comps(c.cs)))
  if (hits.length !== 1) return null
  const sel = selectedOf(host)
  // a clicked chart is the member's "this": another chart is never picked over it (the check then answers honestly)
  return sel && sel !== hits[0].ref && chartsOf(host).some(c => c.ref === sel) ? null : hits[0].ref
}
const has = (list, sym) => list.some(x => String(x.sym).toUpperCase() === sym)
const anyChartWith = (host, pred) => chartsOf(host).some(c => pred(comps(c.cs)))

// ── chart.compare ──
const WITH = '(?:with|w/|to|against|vs\\.?|versus|relative to)'
const COMP_NOUN = '(?:comparison symbols?|comparison lines?|comparisons?|compare symbols?|compares?|overlays?)'
const ADD_RES = [
  // "compare (it | AAPL) with MSFT and QQQ", "compare w/ qqq"
  [new RegExp(`^compare(?: (${SELF}|${BASE_TOK}))? ${WITH} (?:the )?${LIST}$`), 1, 2],
  // "overlay SPY", "overlay SPY on NVDA", "overlay SPY and QQQ as comparisons"
  [new RegExp(`^(?:overlay|superimpose) (?:the )?${LIST}(?: (?:on|onto|over) (${SELF}|${BASE_TOK}))?(?: as (?:a |an )?${COMP_NOUN})?$`), 2, 1],
  // "add QQQ as a comparison", "add QQQ to the comparisons", "put SPY in compare"
  [new RegExp(`^(?:add|put|show|chart) (?:the )?${LIST}(?: (?:on|onto) (?:the chart|it|here)| on)? (?:as (?:a |an )?${COMP_NOUN}|(?:to|into|in) (?:the )?(?:${COMP_NOUN}|compare(?: list| panel)?|comparison list))$`), null, 1],
  // "add a QQQ comparison", "add QQQ and SPY overlays"
  [new RegExp(`^(?:add|put|show) (?:a |an )?${LIST} ${COMP_NOUN}$`), null, 1],
  // "add a comparison with QQQ", "set up a comparison against SPY"
  [new RegExp(`^(?:add|put|make|set up|start|do|show) (?:a |an )?comparison (?:${WITH}|of|for) (?:the )?${LIST}$`), null, 1],
  // "plot SPY against NVDA" (canon: plot → add) — the BASE named after the symbols. ⛔ PL decision 11-23 (AUDIT T2 F2): only
  // when the member TYPED a plotting verb (plot / chart / graph — checked on the typed words in compareOfWords). "put / stack /
  // set X against Y" is as often a placement or a layout as an overlay, so no target is read from "against" there: the model's.
  // ("compare X against Y" keeps the X chart as the target: the first entry above.)
  [new RegExp(`^(?:add|chart|graph) ${LIST} (?:against|vs\\.?|versus|relative to) (${SELF}|${BASE_TOK})$`), 2, 1, /^\s*(?:(?:please|now|ok|okay|can you|could you)\s+)*(?:plot|chart|graph)\b/i],
]
const REMOVE_RES = [
  // "remove the QQQ comparison", "drop the SPY and QQQ overlays"
  [new RegExp(`^(?:remove|delete|drop|kill|lose|cut|ditch|clear) (?:the )?${LIST} ${COMP_NOUN}$`), 1, false],
  // "remove QQQ from the comparisons" (also canon's "take QQQ off the comparison")
  [new RegExp(`^(?:remove|delete|drop|kill|ditch) (?:the )?${LIST} (?:from|out of) (?:the )?(?:${COMP_NOUN}|compare(?: list| panel)?|comparison list)$`), 1, false],
  // "stop comparing (it) with QQQ", "don't compare with SPY anymore", "uncompare QQQ"
  [new RegExp(`^(?:stop comparing|quit comparing|don'?t compare|do not compare|uncompare)(?: (?:${SELF}))?(?: ${WITH})? (?:the )?${LIST}(?: anymore| any more)?$`), 1, false],
  // "remove the comparison with QQQ"
  [new RegExp(`^(?:remove|delete|drop|kill|clear) (?:the )?comparisons? (?:${WITH}|of|for) (?:the )?${LIST}$`), 1, false],
  // "remove the QQQ line" — only for a symbol a chart compares (a "line" is also a drawing or an indicator)
  [new RegExp(`^(?:remove|delete|drop) (?:the )?${LIST} (?:lines?)$`), 1, true],
]
const CLEAR_RE = new RegExp(`^(?:(?:clear|remove|delete|drop|reset|kill|wipe|ditch)(?: out)?(?: (?:the|my))? (?:${COMP_NOUN}|compared symbols|compared tickers)|(?:clear|reset) (?:the )?compare(?: list| symbols)?|stop comparing(?: (?:${SELF}))?(?: (?:with|to|against) anything)?|no more comparisons|uncompare(?: everything)?|remove everything from (?:the )?compare(?: panel)?)$`)

/** chart.compare's args (with `__target` when the words name the chart), or null. */
export function compareOfWords({ raw, lower, host, typed }) {
  const { s, here, named } = wordsOf({ lower, typed })
  if (!s || here || QUESTION.test(s) || NOT_OVERLAY.test(s)) return null
  if (CLEAR_RE.test(s)) {
    const ref = onlyChartWith(host, list => list.length > 0)
    return { add: [], remove: [], clear: true, ...(ref ? { __target: ref } : {}) }
  }
  for (const [re, gList, comparedOnly] of REMOVE_RES) {
    const m = re.exec(s)
    if (!m) continue
    const syms = tickerList(m[gList], raw, host)
    if (!syms) return null
    if (comparedOnly && !anyChartWith(host, list => syms.every(x => has(list, x)))) return null
    const ref = named ? null : onlyChartWith(host, list => syms.every(x => has(list, x)))
    return { add: [], remove: syms, clear: false, ...(ref ? { __target: ref } : {}) }
  }
  for (const [re, gBase, gList, typedVerb] of ADD_RES) {
    const m = re.exec(s)
    if (!m) continue
    if (typedVerb && !typedVerb.test(String(typed || raw || ''))) return null
    const syms = tickerList(m[gList], raw, host)
    if (!syms) return null
    const base = baseOf(gBase ? m[gBase] : null, raw, host)
    if (!base) return null
    if (base.sym && syms.includes(base.sym)) return null                 // "compare NVDA with NVDA": not a reading
    // ⛔ a base ticker AND a chart named elsewhere in the sentence: two targets — the model reads it
    if (base.ref && named) return null
    return { add: syms, remove: [], clear: false, ...(base.ref ? { __target: base.ref } : {}) }
  }
  return null
}

// ── chart.setScale: "show it as percent" ──
const PERCENT_RE = /^(?:show|display|put|switch|set|change|view|see|chart|plot)(?: (?:it|this|the chart|this stock|the stock|prices?|the prices?|everything))? (?:as|in|to|on|into|using) (?:a |the )?(?:percent|percentage|%)(?: change| terms| mode| scale| basis| view)?$|^(?:percent|percentage|%)(?: mode| view| terms)$/
export function percentOfWords({ lower }) {
  const s = String(lower || '').trim()
  return PERCENT_RE.test(s) ? { scale: 'percent' } : null
}

// ── chartSetup.compareDisplay ──
const SAME_SCALE = '(?:the )?(?:same|shared|main|primary|chart\'?s|price)(?: % | percent | price | )scale(?: as (?:the chart|it|the stock))?'
const OWN_SCALE = '(?:(?:its|their|a|an) )?(?:own|new|separate|independent|second|different)(?: % | percent | price | )scale'
const AS_PCT = '(?:as|in) (?:a )?(?:percent|percentage|%)(?: change| terms| scale)?'
const ALL_COMPS = `(?:the )?(?:${COMP_NOUN}|compared symbols|compared tickers)`
function displayTargets(words, raw, host) {
  const w = String(words || '').replace(/^the /, '')
  if (new RegExp(`^${ALL_COMPS}$`).test(words) || new RegExp(`^${ALL_COMPS}$`).test(w)) return []
  const m = new RegExp(`^${LIST}(?: ${COMP_NOUN})?$`).exec(w)
  return m ? tickerList(m[1], raw, host) : null
}
/** chartSetup.compareDisplay's args (with `__target` when exactly one chart compares those), or null. */
export function compareDisplayOfWords({ raw, lower, host, typed }) {
  const { s, here, named } = wordsOf({ lower, typed })
  if (!s || here || QUESTION.test(s)) return null
  const out = (symbols, change) => {
    const ok = (list) => list.length > 0 && symbols.every(x => has(list, x))
    if (!anyChartWith(host, ok)) return null                              // nothing compared: "show QQQ…" may mean add — not here
    const ref = named ? null : onlyChartWith(host, ok)
    return { symbols, scale: null, visible: null, groupOnly: null, ...change, ...(ref ? { __target: ref } : {}) }
  }
  // scale: "put QQQ on the same scale", "move the comparisons to their own scale", "show SPY as percent"
  let m = new RegExp(`^(?:put|move|show|set|switch|make|change|plot|display|keep) (.+?) (?:on|to|onto|in|into|using|with) (${SAME_SCALE}|${OWN_SCALE})$`).exec(s)
    || new RegExp(`^(?:let|make|have) (.+?) (share|use) (?:the )?(?:main |same |chart'?s )?(?:price )?scale$`).exec(s)
  if (m) {
    const symbols = displayTargets(m[1], raw, host)
    if (!symbols) return null
    const same = /^(?:share|use)$/.test(m[2]) || new RegExp(`^${SAME_SCALE}$`).test(m[2])
    return out(symbols, { scale: same ? 'same' : 'new' })
  }
  m = new RegExp(`^(?:show|put|display|plot) (.+?) ${AS_PCT}$`).exec(s)
  if (m) {
    const symbols = displayTargets(m[1], raw, host)
    return symbols ? out(symbols, { scale: 'new' }) : null
  }
  // the eye: "hide the QQQ comparison", "show the comparisons again"
  m = new RegExp(`^(hide|show|unhide|bring back|restore|turn off|turn on) (.+?)(?: again| back)?$`).exec(s)
  if (m) {
    const words = m[2].replace(/^the /, '')
    // a bare ticker ("hide QQQ") is not read: only a comparison's own noun says it is the overlay
    const list = new RegExp(`^${LIST} (?:${COMP_NOUN}|comparison lines?|lines?)$`).exec(words)
    const symbols = list ? tickerList(list[1], raw, host) : (new RegExp(`^${ALL_COMPS}$`).test(m[2]) || new RegExp(`^${ALL_COMPS}$`).test(words) ? [] : null)
    if (!symbols) return null
    return out(symbols, { visible: !/^(?:hide|turn off)$/.test(m[1]) })
  }
  return null
}
// Group only (compareHideBase): "group only", "hide the base symbol", "show only the comparisons"
const BASE_NOUN = '(?:base|main|chart\'?s own|own|primary|underlying)(?: chart)? (?:symbol|ticker|stock|price|line|series|candles|bars)'
const GROUP_ONLY_ON = new RegExp(`^(?:(?:turn on|enable|switch on|use|go to|switch to) )?group only(?: mode| view)?(?: on)?$|^(?:hide|turn off) (?:the )?${BASE_NOUN}$|^show (?:only|just) (?:the )?(?:${COMP_NOUN}|compared symbols|group)$`)
const GROUP_ONLY_OFF = new RegExp(`^(?:turn off|disable|switch off|exit|leave) group only(?: mode| view)?$|^group only off$|^(?:show|unhide|bring back|restore|turn on) (?:the )?${BASE_NOUN}(?: again| back)?$`)
export function groupOnlyOfWords({ lower, host, typed }) {
  const { s, here, named } = wordsOf({ lower, typed })
  if (here) return null
  const on = GROUP_ONLY_ON.test(s), off = !on && GROUP_ONLY_OFF.test(s)
  if (!on && !off) return null
  if (!anyChartWith(host, list => list.length > 0)) return null
  const ref = named ? null : onlyChartWith(host, list => list.length > 0)
  return { symbols: [], scale: null, visible: null, groupOnly: on, ...(ref ? { __target: ref } : {}) }
}

// ── chartSetup.compareGroup ──
const GKIND = '(group|theme|sector|industry|basket)'
const GNAME = '([a-z0-9&][a-z0-9&\' .\\-]{0,40}?)'
const typeOf = (w) => (w === 'theme' || w === 'sector' || w === 'industry' ? w : 'any')
// a name that is only a pronoun / possessive ("its sector", "nvda's industry") names no group here
const badName = (n) => !nameWords(n).length || /^(?:its|his|her|their|our|this|that|the|it'?s|\S+'s)$/.test(n.trim()) || /'s\b/.test(n)
const SCALE_WORDS = `(${SAME_SCALE}|${OWN_SCALE})`
/** chartSetup.compareGroup's args, or null. */
export function compareGroupOfWords({ raw, lower, host, typed }) {
  const { s, here, named } = wordsOf({ lower, typed })
  if (!s || here || QUESTION.test(s) || NOT_OVERLAY.test(s)) return null
  // add: "compare (it | NVDA) against the semis group", "overlay the AI Chips theme", "add the tech sector as a comparison"
  let base = null, name = null, kind = null
  let m = new RegExp(`^(?:compare|overlay)(?: (${SELF}|${BASE_TOK}))?(?: ${WITH})? (?:the |my )?${GNAME} ${GKIND}(?: as (?:a |an )?${COMP_NOUN})?$`).exec(s)
  if (m) { base = m[1] || null; name = m[2]; kind = m[3] } else {
    m = new RegExp(`^(?:add|put|show) (?:the |my )?${GNAME} ${GKIND} (?:as (?:a |an )?${COMP_NOUN}|(?:to|into|in) (?:the )?(?:${COMP_NOUN}|compare(?: list| panel)?))$`).exec(s)
    if (m) { name = m[1]; kind = m[2] }
  }
  if (name) {
    if (badName(name)) return null
    const b = baseOf(base, raw, host)
    if (!b) return null
    if (b.ref && named) return null
    return { action: 'add', group: name, groupType: typeOf(kind), scale: null, ...(b.ref ? { __target: b.ref } : {}) }
  }
  const onCharts = (name) => chartsOf(host).filter(c => matchGroup(name, groupsIn(comps(c.cs))).hit)
  const ofCharts = (name, change) => {
    const hits = onCharts(name)
    if (!hits.length) return null                                         // no chart compares that group: not this reading
    const sel = selectedOf(host)
    const ref = named || hits.length !== 1 || (sel && sel !== hits[0].ref) ? null : hits[0].ref
    return { group: name, groupType: 'any', ...change, ...(ref ? { __target: ref } : {}) }
  }
  // remove: "remove the semis group", "drop the AI Chips theme from the comparisons"
  m = new RegExp(`^(?:remove|delete|drop|clear|kill|ditch|stop comparing(?: with| against| to)?) (?:the |my )?${GNAME} ${GKIND}(?: ${COMP_NOUN})?(?: (?:from|out of) (?:the )?(?:${COMP_NOUN}|compare(?: list| panel)?))?$`).exec(s)
  if (m) return badName(m[1]) ? null : ofCharts(m[1], { action: 'remove', scale: null })
  // scale: "put the semis group on the same scale", "move the AI Chips theme to its own scale"
  m = new RegExp(`^(?:put|move|show|set|switch|make|change|plot|keep) (?:the |my )?${GNAME} ${GKIND}(?: ${COMP_NOUN})? (?:on|to|onto|in|into|using) ${SCALE_WORDS}$`).exec(s)
  if (m) return badName(m[1]) ? null : ofCharts(m[1], { action: 'scale', scale: new RegExp(`^${SAME_SCALE}$`).test(m[3]) ? 'same' : 'new' })
  return null
}

// ── compare.openView ──
const MAP = '(?:rotation map|rotation graph|rotation chart|rotation view|rrg(?: chart| map| view| graph)?|relative rotation(?: graph| map| chart| view)?)'
const OPEN = '(?:open|show|bring up|pull up|launch|go to|switch to|view|display|see|take me to)(?: me)?'
const PANEL = '(?:compare symbols|compare|comparison|comparisons)(?: panel| tool| window| dialog| view)?'
/** compare.openView's args, or null (also null off the desktop Charts board: no Compare panel there). */
export function compareViewOfWords({ raw, lower, host }) {
  if (!host?.compare) return null
  const s = String(lower || '').replace(/^please /, '').trim()
  if (/\brs\b|\brelative strength\b|\bindicator\b/.test(s)) return null    // the RS indicator's own Rotation view
  const view = (tab, extra = {}) => ({ tab, symbol: null, groupType: null, group: null, ...extra })
  // the Overlay / Rotation tab by name: "go to the overlay tab", "switch the compare panel to rotation"
  let m = new RegExp(`^(?:${OPEN}|open up) (?:the )?(overlay|rotation) tab(?: (?:of|in|on) (?:the )?${PANEL})?$`).exec(s)
    || new RegExp(`^(?:switch|change|flip|set|turn) (?:the )?${PANEL} (?:to|on to|onto) (?:the |its )?(overlay|rotation)(?: tab)?$`).exec(s)
  if (m) return view(m[1])
  // the panel itself: "open compare symbols", "bring up the compare panel"
  if (new RegExp(`^(?:${OPEN}|open up) (?:the )?${PANEL}$`).test(s) && /\b(?:panel|tool|window|dialog|symbols)\b/.test(s)) return view('overlay')
  // the map, optionally one stock's group or a named group
  m = new RegExp(`^${OPEN} (?:the )?${MAP}(?: (?:for|of|with|on) (.+))?$`).exec(s)
  const shown = m ? null : new RegExp(`^(?:show|put|plot|display) (.+?) (?:on|in) (?:the )?${MAP}$`).exec(s)
  if (!m && !shown) return null
  const tail = (m ? m[1] : shown[1]) || ''
  if (!tail) return m ? view('rotation') : null
  const t = tail.replace(/^(?:the|my) /, '')
  // "NVDA", "NVDA's sector", "nvda's industry"
  const k = new RegExp(`^(${TICK})('s)?(?: ${GKIND})?$`).exec(t)
  if (k && k[3] !== 'group' && k[3] !== 'basket') {
    // "NVDA" / "NVDA's sector": a stock. "the semis industry" (no possessive) is a NAMED group unless the word is a ticker
    // the member marked or the board shows ("the nvda industry")
    const sym = tickerWord(k[1], raw, host, { strict: !k[2] && !!k[3] })
    if (sym) return view('rotation', { symbol: sym, groupType: k[3] ? typeOf(k[3]) : null })
  }
  // a named group: "the semiconductors industry", "the AI Chips theme"
  const g = new RegExp(`^${GNAME} ${GKIND}$`).exec(t)
  if (g && !badName(g[1])) return view('rotation', { group: g[1], groupType: typeOf(g[2]) === 'any' ? null : typeOf(g[2]) })
  return null
}

// ── a PRONOUN subject across turns (AUDIT T2 F1, 11-23) ──
// "compare it with QQQ" / "show it as percent" with a chart CLICKED: the click stands for "it" ONLY when the conversation
// has no other subject. When an earlier turn's subject is another chart (the chart the last change touched, or a stock or
// chart the previous message named), "it" may mean that one, so the instant reading is withdrawn: the request goes on to the
// conversation rules / the model, which see both. Words that point at the click themselves ("this chart") are not pronouns here.
const PRONOUN = /\b(?:it|that|here|there|this(?!\s+chart\b)|this one|that one|this stock|that stock)\b/i
const FAMILY = new Set(['chart.compare', 'chartSetup.compareDisplay', 'chartSetup.compareGroup'])
/** true → do not run this instant compare reading (the subject may be another chart). */
export function compareSubjectElsewhere(ops, text, { host, memory = null, epoch = null, prevText = '' } = {}) {
  const t = String(text || '')
  if (!Array.isArray(ops) || !ops.length || !PRONOUN.test(t)) return false
  const ours = ops.some(o => FAMILY.has(o?.action) || (o?.action === 'chart.setScale' && percentOfWords({ lower: canonish(t).replace(/[.!?]+$/, '').trim() })))
  if (!ours) return false
  const sel = selectedOf(host)
  if (!sel) return false                                       // no click: the subject rules (references.subjectTarget) decide
  const charts = chartsOf(host)
  const clicked = charts.find(c => c.ref === sel)
  if (!clicked) return false
  let s = null
  try { s = memory?.subject?.('chart', epoch) || null } catch { s = null }
  if (s && s.ref !== sel && s.ref !== clicked.chart && s.ref !== clicked.chartRef) return true
  const prev = String(prevText || '')
  if (!prev) return false
  const mine = String(clicked.symbol || '').toUpperCase()
  for (const m of prev.matchAll(/\$?[A-Za-z][A-Za-z0-9.]{0,9}/g)) {
    const sym = tickerWord(m[0], prev, host, { strict: true })
    if (sym && sym !== mine) return true
  }
  // a chart named by position / ordinal / set (the clicked chart named by its own ticker is the click)
  const own = mine ? new RegExp(`\\b(?:the|this|that)\\s+\\$?${esc(mine.toLowerCase())}\\s+(?:chart|one)\\b`, 'g') : null
  return NAMES_A_CHART.test(own ? prev.toLowerCase().replace(own, ' ') : prev.toLowerCase())
}
