// ── UCT Agent DEIXIS: "this chart" / "this stock" → the chart the member last CLICKED ─────────
//
// Context & Awareness, Slice 1B. Pure: no state of its own, no feature knowledge beyond "a target
// kind is chart-backed". The workspace records the last chart the member explicitly clicked
// (ChartsWorkspace → host.charts.selected(); hover never counts); this module decides when the
// member's words point at it, and asks otherwise. It never guesses: with several charts, a
// deictic word and no live selection → a question with the charts as choices.
//
// Precedence: an explicit position ("the left one") or a named symbol ("this NVDA chart") beats
// the selection; a single-chart board needs no selection at all.

import { addableRows } from './capabilities/indicatorEdits'
import { resolvedTicker } from './nl/tickers'
import { sanitizeChartTabs } from '../pages/charts/chartTabs'

// Words that point at "the chart in front of me". "it" counts only for a CHART-kind op ("make it
// weekly"), never on its own ("put it in Momentum", "what is it" are not about a chart).
const POINTS = /\b(?:(?:this|that|the|my|current|active|selected|focused)\s+(?:current\s+|active\s+|selected\s+)?(?:chart|stock|ticker|symbol|name)|this\s+one|(?:on|in)\s+here|right\s+here)\b/i
const IT = /\bit\b/i
// "this NVDA chart" — a ticker between the pointer word and "chart" (never a position or ordinal word)
const NAMED = /\b(?:this|that|the)\s+(?!(?:left|right|top|bottom|upper|lower|middle|center|centre|other|first|second|third|last|main|new|old|big|small|current|active|selected|focused|same|whole|entire)\s)([a-z]{1,6}(?:[.-][a-z]{1,2})?)\s+(?:chart|tab)\b/i

// NL (2026-10-12): "the 5 minute chart", "the daily chart" — a chart named by its TIMEFRAME
const TF_NAMED = /\b(?:this|that|the)\s+(\d{1,3}\s*(?:m|min|mins|minute|minutes|h|hr|hour|hours)|1h|hourly|daily|weekly|monthly)\s+chart\b/i
// a chart named by its STATE (a Multi Chart cell with no ticker yet) or by an INDICATOR it carries
const STATE_NAMED = /\b(?:this|that|the|my)\s+(empty|blank|unused|vacant)\s+(?:chart|cell|slot|spot|pane|panel|one)\b/i
const TAB_NAMED = /\b(?:this|that|the)\s+([a-z]{1,6}(?:[.-][a-z]{1,2})?)\s+tab\b/i
const WITH_NAMED = /\b(?:this|that|the)\s+(?:chart|one)\s+(?:with|that has|showing)\s+(?:the\s+|an?\s+)?([a-z]{2,8})\b/i
// ⭐ A chart named RELATIVE to the clicked one: "the one above this", "the chart to the left of this one", "the cell under it",
// "the one next to this". The click is the ANCHOR here, never the target: the chart meant is the clicked chart's neighbour on that
// side, read from where the charts sit (`cell`). No click, no neighbour on that side, or two that fit → no single chart: asked.
// ⛔ AUDIT R1/R2 (2026-11-07): the rule is the RELATION, not the noun before it. A spatial relation word followed by an ANCHOR makes
// the click the anchor, whatever names the chart meant ("the chart that is above this one", "the ticker below this one", "the stock
// sitting above it", "the chart above the one I clicked"). An anchor is "this/that" (alone, or on a chart word), "it", "the
// selected/clicked/current … one/chart", or "the one I clicked/selected". Only an adverb (right, just, directly…) may stand between
// the relation and the anchor, so "under 30 on this chart" is no relation ("this chart" there is the click itself). "this/that" on
// another noun ("under this candle") is no anchor. A bare "this" with no relation word still binds to the click.
const REL_ANCHOR_NOUN = '(?:chart|one|cell|pane|panel|ticker|stock|symbol|graph|name)'
// ⛔ no lookbehind (iOS 16 floor — this string is compiled into RELATIVE; agentNoLookbehindStrings.test.js): "this/that, then a
// word that is NOT one of these" is a lookahead on the word itself (that word is the whole letter run, so the two agree)
const REL_ANCHOR = `(?:(?:this|that)(?:\\s+${REL_ANCHOR_NOUN}\\b|(?![\\s-]+(?!(?:to|on|in|and|then|please|for|with|as|into|onto|now|weekly|daily|monthly|hourly|intraday|instead|too|also|here)\\b)[a-z]+\\b)\\b)`
  + `|it\\b|the\\s+(?:selected|clicked|current|highlighted|active|focused)(?:\\s+${REL_ANCHOR_NOUN})?\\b`
  + `|the\\s+one\\s+(?:that\\s+)?(?:i|you)(?:'ve|\\s+have|\\s+just)?\\s*(?:clicked|selected|picked|chose|chosen|highlighted|tapped)(?:\\s+on)?\\b)`
export const RELATIVE = new RegExp(`\\b(?:(?:right|just|directly|immediately|exactly)\\s+)?(?:(above|over|below|under|underneath|beneath)|(?:to\\s+the\\s+|on\\s+the\\s+)?(left|right)\\s+of|(next\\s+to|beside|alongside)|(adjacent\\s+to|near|nearest(?:\\s+to)?|closest\\s+to))\\s+(?:(?:right|just|directly|immediately)\\s+)?${REL_ANCHOR}`, 'i')
// …and it is about a CHART: the anchor itself names one ("this one", "the selected chart", "the one I clicked"), or the thing
// meant is named before the relation ("the chart / the one / the ticker / whatever … above it"). "alert above it" and "a line
// under it" relate a price or a drawing to "it", not a chart to the click: no relation here.
const REL_CHART_ANCHOR = new RegExp(`(?:this|that)\\s+${REL_ANCHOR_NOUN}\\b|\\bthe\\s+(?:selected|clicked|current|highlighted|active|focused)\\b|\\bthe\\s+one\\s`, 'i')
const REL_MEANT = new RegExp(`\\b(?:the|which|whichever|any)\\s+(?:[a-z]+\\s+)?${REL_ANCHOR_NOUN}s?\\b|\\b(?:whatever|whichever)\\b`, 'i')
// ⭐ 2026-11-07 (pl-auto u5-relation-controls-02, revisited after the owner's conversational-targeting decision): an ANCHORLESS
// relation — "the chart above", "the one to the right", "the one to its left" — reads from the click (or the conversation's
// target, which stands in for it): with a click and no other context that is the natural reading. Only on a CHART noun, and never
// followed by "of …", a number or a price ("the one above 50" is a value). No click → no neighbour → asked, as before.
// Groups as RELATIVE's: 1 above/below, 2 left/right (3, 4 never match here).
const RELATIVE_BARE = /\b(?:the|that)\s+(?:chart|one|cell|pane|panel|graph)\s+(?:(?:right|just|directly|immediately)\s+)?(?:(above|over|below|under|underneath|beneath)|(?:to|on)\s+(?:the|its)\s+(left|right)(?:[-\s]+hand(?:\s+side)?)?)(?:(x(?!x)x)|(x(?!x)x))?\b(?!\s*(?:of\b|it\b|this\b|that\b|the\b|my\b|[$\d]))/i
/** The relation match, or null when the words relate nothing to the clicked CHART. */
export function relationMatch(text) {
  const s = String(text || '')
  const m = RELATIVE.exec(s)
  // ⛔ AUDIT S2-B: the same rule for an anchored relation — "the alert and the one above it": a bare "one" coordinated with a
  // non-chart noun stands for that thing, so no chart relation (the click is read as it would be without one)
  if (m) { const pre = /\b(?:the|that)\s+one\s*$/i.exec(s.slice(0, m.index)); if (pre && oneStandsForAThing(s.slice(0, pre.index))) return null }
  if (m && !placesNonChart(s.slice(0, m.index)) && (REL_CHART_ANCHOR.test(m[0]) || REL_MEANT.test(s.slice(0, m.index)))) return m
  if (m) return null
  const b = RELATIVE_BARE.exec(s)
  if (!b) return null
  // its noun IS the chart related ("a macd on the chart above" puts the MACD on that chart), so nothing placed before it counts —
  // ⛔ AUDIT S2-A: except a bare "one", which stands for the nearest noun before it: "delete the line and the one below", "move the
  // alert to the one below", "the level I drew and the one above" relate a line, an alert, a level — not a chart. "chart / cell /
  // pane / panel / graph" stays unconditional.
  if (/\bone\b/i.test(b[0]) && oneStandsForAThing(s.slice(0, b.index))) return null
  return b
}
// ⛔ AUDIT S2-B (round 2): a bare "one" stands for a THING only when it is COORDINATED with that thing in the same noun phrase
// ("the line and the one below", "the level I drew and the one above"). After a preposition (to / on / onto / in / into / for /
// at / from / over) "the one <relation>" is the PLACE: a chart ("add RSI to the one below"). A word separated from "one" by a
// verb or a preposition is never its antecedent ("the rsi looks good here, now make the one below weekly": a chart).
const ONE_THING = /^(?:orders?|positions?|trades?|tickets?|emas?|smas?|mas|setups?|zones?|supports?|resistances?|signals?|bars?|candles?)$/
const ONE_PREP = /\b(?:to|on|onto|in|into|for|at|from|over)\s*$/i
const ONE_COORD = /(?:,|\b(?:and|or))\s*$/i
// the few words a noun phrase may carry between its noun and the "and": a short relative clause ("the level I drew"), adjectives
const NP_FILLER = /^(?:i|we|you|just|already|drew|drawn|made|added|put|placed|set|have|had|the|a|an|my|that|this|new|old|first|second|last|top|bottom|upper|lower|red|green|blue|yellow|orange|purple|white|black)$/
function oneStandsForAThing(before) {
  const s = String(before || '')
  if (ONE_PREP.test(s) || !ONE_COORD.test(s)) return false
  const words = s.replace(ONE_COORD, ' ').toLowerCase().split(/[^a-z0-9%]+/).filter(Boolean)
  for (let i = words.length - 1, n = 0; i >= 0 && n < 5; i--, n++) {
    const w = words[i]
    if (CHARTISH.test(w)) return false
    if (PLACED.test(w) || ONE_THING.test(w) || isIndicatorWord(w)) return true
    if (!NP_FILLER.test(w)) return false                     // a verb, a preposition or anything else ends the noun phrase
  }
  return false
}
// pl-auto indicator-add-02: "MACD under this chart", "volume beneath this one", "a line above this chart" place an indicator, a pane,
// a line, a level — not a chart ("the pane left of it" IS a chart: a pane alone is a chart's cell, an indicator's pane is named by
// the indicator). The thing placed is what the words right before the relation name (the last three, in its own
// clause): an indicator (by its id or a word of its name, from the live catalog) or a chart-surface noun, with no chart word
// after it. Then the relation is no chart relation and the click is read as a bare pointer would be.
const PLACED = /^(?:lines?|levels?|indicators?|studies|study|volume|alerts?|labels?|markers?|notes?|drawings?|bands?|overlays?|oscillators?|averages?|histograms?|trendlines?|rays?|arrows?|boxes?|rectangles?|texts?|fibs?|fibonacci|channels?)$/
const CHARTISH = /^(?:charts?|ones?|cells?|panels?|tickers?|stocks?|symbols?|graphs?|names?)$/
let indicatorWords = null
function isIndicatorWord(w) {
  if (!indicatorWords) {
    indicatorWords = new Set()
    try {
      for (const r of addableRows()) {
        indicatorWords.add(String(r.defId).toLowerCase())
        for (const x of String(r.name || '').toLowerCase().split(/[^a-z0-9%]+/)) if (x.length >= 3) indicatorWords.add(x)
      }
    } catch { indicatorWords = null; return false }
  }
  return indicatorWords.has(w)
}
function placesNonChart(before) {
  const clause = String(before || '').split(CLAUSE_SPLIT_LOCAL).pop()
  const words = clause.toLowerCase().split(/[^a-z0-9%]+/).filter(Boolean).slice(-3)
  for (let i = words.length - 1; i >= 0; i--) {
    if (CHARTISH.test(words[i])) return false
    if (PLACED.test(words[i]) || isIndicatorWord(words[i])) return true
  }
  return false
}
const CLAUSE_SPLIT_LOCAL = /[,;.!?]|\b(?:and|then|but|while|also|plus)\b/i
const overlaps = (a0, a1, b0, b1) => a0 < b1 && b0 < a1
function sideOf(charts, s, side) {
  const o = charts.filter(c => c.ref !== s.ref && c.cell)
  const pick = (list, edge, best) => { if (!list.length) return []; const e = best(...list.map(edge)); return list.filter(c => edge(c) === e) }
  const xo = (c) => overlaps(c.cell.x, c.cell.x + c.cell.w, s.cell.x, s.cell.x + s.cell.w)
  const yo = (c) => overlaps(c.cell.y, c.cell.y + c.cell.h, s.cell.y, s.cell.y + s.cell.h)
  if (side === 'above') return pick(o.filter(c => xo(c) && c.cell.y + c.cell.h <= s.cell.y), c => c.cell.y + c.cell.h, Math.max)
  if (side === 'below') return pick(o.filter(c => xo(c) && c.cell.y >= s.cell.y + s.cell.h), c => c.cell.y, Math.min)
  if (side === 'left') return pick(o.filter(c => yo(c) && c.cell.x + c.cell.w <= s.cell.x), c => c.cell.x + c.cell.w, Math.max)
  return pick(o.filter(c => yo(c) && c.cell.x >= s.cell.x + s.cell.w), c => c.cell.x, Math.min)
}
// ⛔ AUDIT R5 (2026-11-07): a relation is one chart reference among the sentence's others. Read per CLAUSE (split at , ; . and
// and / then / but / while / also):
//   NEGATED  — the relation's own clause carries a negation (not, never, n't, except, besides, without, other than, apart from,
//              leave …) → the chart it names is NEVER a target (`excluded`); it is not the chart meant either.
//   ALSO THE CLICK — another clause points at the click itself (this chart / this one / this / it / the selected one) → two
//              chart references. With an affirmative relation the request is asked about (a plan never runs on a guess between
//              them); with a negated one the affirmative clause's chart, the click, is the one meant.
const CLAUSE_SPLIT = /[,;.!?]|\b(?:and|then|but|while|also|plus)\b/gi
const NEGATION = /\b(?:not|never|except|besides|without|other\s+than|apart\s+from|leave|leaving|ignore|skip|exclude|excluding|don'?t|do\s+not|doesn'?t|won'?t)\b|n't\b/i
const CLICK_POINTER = /\b(?:this|it|the\s+(?:selected|clicked|current|highlighted|active|focused)\s+(?:chart|one))\b(?!\s+(?:candle|candles|bar|bars|line|lines|level|levels|price|drawing|alert|trendline|zone|support|resistance)\b)/i
function clauseAt(s, at) {
  let start = 0, end = s.length
  for (const c of s.matchAll(CLAUSE_SPLIT)) { if (c.index <= at) start = c.index + c[0].length; else { end = c.index; break } }
  return [start, end]
}
/** How the relation sits in the sentence: { negated, alsoClick }. */
export function relationRole(text, m) {
  const s = String(text || '')
  const [a, b] = clauseAt(s, m.index)
  const negated = NEGATION.test(s.slice(a, b))
  const outside = `${s.slice(0, m.index)} ${s.slice(m.index + m[0].length)}`
  return { negated, alsoClick: CLICK_POINTER.test(outside) }
}
/** → { hits: [chart snapshots], match, negated, alsoClick, excluded } when the words name a chart relative to the clicked one
 *  (hits may be 0 or several), else null. `hits` is what the relation makes the TARGET: none when it is negated or when another
 *  clause points at the click too; `excluded` is what a negated relation names, which nothing may touch. */
export function relativeChart(text, charts = [], sel = null) {
  const m = relationMatch(text)
  if (!m) return null
  const role = relationRole(text, m)
  const s = sel ? charts.find(c => c.ref === sel && c.cell) : null
  if (!s) return { hits: [], match: m, ...role, excluded: [] }
  const v = m[1] && m[1].toLowerCase()
  const side = v ? (['above', 'over'].includes(v) ? 'above' : 'below') : m[2] ? m[2].toLowerCase() : null
  // "next to / beside": either side; "adjacent to / near": any side. More than one fits → asked (the caller), never a guess
  const hits = side ? sideOf(charts, s, side)
    : m[4] ? ['above', 'below', 'left', 'right'].flatMap(x => sideOf(charts, s, x))
      : [...sideOf(charts, s, 'left'), ...sideOf(charts, s, 'right')]
  if (role.negated) return { hits: [], match: m, ...role, excluded: hits }
  if (role.alsoClick) return { hits: [], match: m, ...role, excluded: [] }
  return { hits, match: m, ...role, excluded: [] }
}
const knownIndicator = (word) => { try { return addableRows().some(r => String(r.defId).toLowerCase() === String(word).toLowerCase()) } catch { return false } }
const carries = (c, word) => (c?.cs?.indicatorInstances || []).some(i => i && !i.deleted && String(i.defId || '').toLowerCase() === String(word).toLowerCase())
function tfOfWord(w) {
  const s = String(w || '').toLowerCase().trim()
  if (s === 'daily') return 'D'
  if (s === 'weekly') return 'W'
  if (s === 'monthly') return 'M'
  if (s === 'hourly' || s === '1h') return '60'
  const m = /^(\d{1,3})\s*(m|min|mins|minute|minutes|h|hr|hour|hours)$/.exec(s)
  if (!m) return null
  return /^h/.test(m[2]) ? String(Number(m[1]) * 60) : String(Number(m[1]))
}

/**
 * "the AMD chart" / "the 5 minute chart" / "the empty chart" / "the chart with RSI" — a chart named by what it IS right
 * now: the SYMBOL or TIMEFRAME it shows, its STATE, an INDICATOR on it (autotest multi-chart-04: every word the board can
 * answer for names a chart; "which chart?" is for words it can't).
 * → { match, word, hits: [chart snapshots] } | null. Only live charts count: a word that names no
 * chart on this board is not a qualifier (the fast path then leaves the sentence as it was).
 */
export function chartQualifier(text, charts = []) {
  const s = String(text || '')
  const st = STATE_NAMED.exec(s)
  if (st) {
    const hits = charts.filter(c => !String(c.symbol || '').trim())
    if (hits.length) return { match: withPrep(s, st), word: st[1], hits }
  }
  const tf = TF_NAMED.exec(s)
  if (tf) {
    const code = tfOfWord(tf[1])
    const hits = charts.filter(c => String(c.tf) === code)
    if (hits.length) return { match: withPrep(s, tf), word: tf[1], hits }
  }
  const nm = NAMED.exec(s)
  if (nm) {
    // (a company's name, once the ticker search has answered for it: chartNameWord)
    const sym = resolvedTicker(nm[1])
    const hits = charts.filter(c => String(c.symbol || '').toUpperCase() === sym)
    if (hits.length) return { match: withPrep(s, nm), word: nm[1], hits }
    const shown = charts.filter(c => carries(c, nm[1]))
    if (shown.length) return { match: withPrep(s, nm), word: nm[1], hits: shown }
  }
  const wi = WITH_NAMED.exec(s)
  if (wi) {
    const sym = wi[1].toUpperCase()
    const onIt = charts.filter(c => String(c.symbol || '').toUpperCase() === sym)
    const hits = onIt.length ? onIt : charts.filter(c => carries(c, wi[1]))
    if (hits.length) return { match: withPrep(s, wi), word: wi[1], hits }
  }
  return null
}
// widen a qualifier match to the preposition before it ("… to the AMD chart")
function withPrep(s, m) {
  const before = s.slice(0, m.index)
  const p = /\s+(?:on|to|onto|in|from|off|for|of)\s*$/i.exec(before)
  return p ? { index: p.index, 0: s.slice(p.index, m.index + m[0].length) } : { index: m.index, 0: m[0] }
}

/** "the nvidia chart": the word in a chart's place that no chart answers to yet. Worth one ticker search before a gate reads it. */
export function chartNameWord(text, charts = []) {
  const s = String(text || '')
  const nm = NAMED.exec(s)
  return nm && !chartQualifier(s, charts) && !STATE_NAMED.test(s) ? nm[1] : null
}

/**
 * The charts the member's words DESCRIBE, read from the board as it is: [chart snapshots], possibly none ("the empty chart" with
 * no empty chart), or null when the words describe nothing. ⛔ A description decides the target: no other chart stands in for it.
 */
export function describedCharts(text, charts = []) {
  const s = String(text || '')
  const q = chartQualifier(s, charts)
  if (q) return q.hits
  if (STATE_NAMED.test(s)) return []
  const wi = WITH_NAMED.exec(s)
  return wi && knownIndicator(wi[1]) ? [] : null
}

/** Does the member's text point at one chart without naming it? (With the board's `charts`: also a chart it describes.) */
export function pointsAtChart(text, { chartOp = false, charts = null } = {}) {
  const s = String(text || '')
  return !!relationMatch(s) || POINTS.test(s) || NAMED.test(s) || TF_NAMED.test(s) || (chartOp && IT.test(s)) || (!!charts && describedCharts(s, charts) != null)
}

/** The chart ref behind a target of any chart-backed kind (chart itself, a chart's indicators…). */
export function chartRefOf(kind, snap) {
  if (!kind || !snap) return null
  if (kind.name === 'chart') return snap.ref
  if (snap.chartRef) return snap.chartRef
  const g = typeof kind.groupOf === 'function' ? kind.groupOf(snap.ref) : null
  return g && g !== snap.ref ? g : null
}

/**
 * Narrow `candidates` (snapshots of one chart-backed kind) using the member's words and the
 * selection. → { ref } (exactly one meant) | { ask } (several and nothing reliable) | null (the
 * words don't point at a chart: the caller's own rule decides, unchanged).
 */
export function resolveDeictic({ host, kind, candidates, text, chartOp = false }) {
  if (!Array.isArray(candidates) || !candidates.length) return null
  const backed = candidates.map(c => ({ c, chart: chartRefOf(kind, c) }))
  if (backed.some(b => !b.chart)) return null                         // not a chart-backed kind
  const live = host?.charts?.list?.() || []
  if (!pointsAtChart(text, { chartOp, charts: live })) {
    // OWNER DECISION (2026-10-12): a BARE chart command ("switch to weekly", "add rsi") on a board of
    // several charts goes to the chart the member explicitly CLICKED — only while that selection is
    // valid (still on this board, same layout: host.charts.selected()). No selection, a stale one or a
    // closed chart → null, and the caller asks "Which chart?" exactly as before. Never a guess.
    if (!chartOp || candidates.length < 2) return null
    const sel = selectedChart(host)
    const hit = sel ? backed.filter(b => b.chart === sel) : []
    return hit.length === 1 ? { ref: hit[0].c.ref, implicit: true } : null
  }
  if (candidates.length === 1) return { ref: candidates[0].ref }
  // "the one above this": the clicked chart's neighbour on that side, and only it. ⛔ The click is the anchor, never the target.
  const rel = relativeChart(text, live, selectedChart(host))
  // a NEGATED relation beside a clause that points at the click ("this one weekly, leave the one below it alone"): the click is
  // the chart meant, and the chart the negated clause names is never it
  if (rel?.negated && rel.alsoClick) {
    const sel = selectedChart(host)
    const hit = sel && !rel.excluded.some(c => c.ref === sel) ? backed.filter(b => b.chart === sel) : []
    if (hit.length === 1) return { ref: hit[0].c.ref }
  }
  if (rel) {
    const refs = new Set(rel.hits.map(c => c.ref))
    const fits = backed.filter(b => refs.has(b.chart))
    if (fits.length === 1) return { ref: fits[0].c.ref }
    return { ask: { text: rel.hits.length || selectedChart(host) ? 'Which chart do you mean?' : 'Which chart do you mean? Click a chart to select it, or pick one:',
      choices: (fits.length ? fits.map(b => b.c) : candidates).map(c => ({ ref: c.ref, label: c.label })) } }
  }
  // "this NVDA chart" / "the 5 minute chart" / "the empty one": the charts the words describe. One → it. Several → the clicked
  // one only if it is among them. ⛔ Otherwise the member picks from those: the clicked chart never stands in for a description.
  const said = describedCharts(text, live)
  const sel = selectedChart(host)
  if (said) {
    const refs = new Set(said.map(c => c.ref))
    const fits = backed.filter(b => refs.has(b.chart))
    if (fits.length === 1) return { ref: fits[0].c.ref }
    const clicked = fits.filter(b => b.chart === sel)
    if (clicked.length === 1) return { ref: clicked[0].c.ref }
    const choices = fits.length ? fits.map(b => b.c) : candidates
    return { ask: { text: 'Which chart do you mean?', choices: choices.map(c => ({ ref: c.ref, label: c.label })) } }
  }
  const hit = sel ? backed.filter(b => b.chart === sel) : []
  if (hit.length === 1) return { ref: hit[0].c.ref }
  return { ask: { text: sel ? 'Which chart do you mean?' : 'Which chart do you mean? Click a chart to select it, or pick one:', choices: candidates.map(c => ({ ref: c.ref, label: c.label })) } }
}

// ── P2-B (owner decision 7, 2026-10-25): every chart a MODEL plan changes must be one the member's
// own words, click or answer identified — on a board of several charts, never the model's guess ──
const POS_WORDS = /\b(top-left|top-right|bottom-left|bottom-right|top left|top right|bottom left|bottom right|left|right|top|bottom|upper|lower)\b/gi
// "both", "all (four) charts", "every chart", "all of them" — a SET of charts (never "remove all comparisons")
const MANY_COUNT = /\b(?:(both)\b|(?:all|every|each)(?:\s+(?:the|of the))?(?:\s+(two|three|four|five|six|seven|eight|nine|ten|\d{1,2}))?\s+(?:charts?|of them|ones)\b)/i
const OTHER_CHARTS = /\b(?:(?:my|the|all(?: my| the)?|every) )?other charts\b/i
const OTHER_CHART = /\b(?:my|the|that|this) other (?:chart|one)\b/i
// …and "a different chart", "another chart", "some other chart": a chart that is NOT the clicked one, not yet which
const DIFFERENT_CHART = /\b(?:a|another|some|any)\s+(?:different|other)\s+(?:chart|one)\b|\banother\s+(?:chart|one)\b|\bone\s+other\b/i
/** "the other chart" / "a different chart": the words mean a chart that is NOT the clicked one (pl-teach round 6 / AUDIT T1b:
 *  the guide reads it here, never a copy). One other chart on the board → that one; several → which one is asked.
 *  ⛔ AUDIT T1c/T1d/T1e (2026-11-07), matching execution's OTHER_CHART:
 *   • DEFINITE "the / my / that other one" is the other chart, as execution reads it — unless the sentence names another thing
 *     the "one" can stand for (a drawing, an indicator, an alert…: "two lines … delete the other one").
 *   • INDEFINITE "another one" / "one other" / "a different one" names a chart only beside a chart word in its own clause that is
 *     NOT the click itself: "another one of my charts" counts; "draw another one on this chart" is another drawing on the click. */
const ONE_STANDS_FOR = /\b(?:drawings?|lines?|trend ?lines?|rays?|rectangles?|boxe?s?|circles?|arrows?|fibs?|fibonacci|channels?|notes?|labels?|indicators?|studies|study|alerts?|levels?|tabs?|layouts?|lists?|watchlists?|widgets?|templates?|panes?|colou?rs?)\b/i
const CLICK_CHART = /\b(?:this|that|the|my|current|selected|clicked|active|same)\s+(?:chart|one)\b(?!s)/gi
export function saysOtherChart(text) {
  const s = String(text || '')
  const definite = OTHER_CHART.exec(s)
  if (definite) {
    if (/chart/i.test(definite[0])) return true
    // ⛔ AUDIT T1f: after a preposition "the other one" is the LOCATION — the other chart, whatever the sentence adds there
    // ("add an indicator to the other one", "draw a trendline on the other one"). Only as the verb's OBJECT, with a thing of
    // that kind named BEFORE it ("I drew two lines, how do I delete the other one"), does "one" stand for that thing
    const before = s.slice(0, definite.index)
    if (/\b(?:on|to|onto|from|in|into|for|of|at|over)\s*$/i.test(before)) return true
    if (!ONE_STANDS_FOR.test(before)) return true
  }
  const m = DIFFERENT_CHART.exec(s)
  if (!m) return false
  if (/chart/i.test(m[0])) return true
  const [a, b] = clauseAt(s, m.index)
  const rest = (s.slice(a, m.index) + ' ' + s.slice(m.index + m[0].length, b)).replace(CLICK_CHART, ' ')
  return /\bcharts?\b/i.test(rest)
}
const COUNT_WORDS = { two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 }
const ORDINAL = { first: 1, second: 2, third: 3, fourth: 4, '1st': 1, '2nd': 2, '3rd': 3, '4th': 4 }
const escapeRe = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** The answer to a question UCT asked, read against its choices: an exact label, "2", "the second (one)". */
export function pickedChoice(text, choices = []) {
  const t = String(text || '').trim().toLowerCase().replace(/[.!]+$/, '')
  if (!t || !choices.length) return null
  const byLabel = choices.filter(c => c?.ref && String(c.label || '').trim().toLowerCase() === t)
  if (byLabel.length === 1) return byLabel[0].ref
  const m = /^(?:the\s+)?(\d|first|second|third|fourth|1st|2nd|3rd|4th)(?:\s+(?:one|chart))?$/.exec(t)
  const n = m ? (Number(m[1]) || ORDINAL[m[1]]) : 0
  return n >= 1 && n <= choices.length ? choices[n - 1]?.ref || null : null
}

// ── Charts operator P1: a chart named by its ORDER on the board ──
// "the second chart", "chart 3", "the 2nd one", "the last chart", "the middle chart". Reading order is the
// board's (top to bottom, then left to right — host.charts.list()). "middle" only when it is unambiguous:
// an odd number (3 or 5) of charts in ONE row or ONE column. → { ref, word } | { ask } | null (no such words).
const ORD_WORDS = { first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, '1st': 1, '2nd': 2, '3rd': 3, '4th': 4, '5th': 5, '6th': 6 }
// ("chart 5" is an ordinal only when no unit follows: "the chart 5 min" is a timeframe, never the fifth chart)
export const ORD_RE = /\b(?:the\s+)?(first|second|third|fourth|fifth|sixth|1st|2nd|3rd|4th|5th|6th|last|middle|center|centre)\s+(?:chart|one)\b|\bchart\s+(?:#\s*)?([1-9])\b(?!\s*(?:(?:m|min|mins|minutes?|h|hr|hrs|hours?|d|days?|w|wk|wks|weeks?|mo|months?|x)\b|[%.:/-]))/i
export function ordinalChart(text, charts = []) {
  const m = ORD_RE.exec(String(text || ''))
  if (!m) return null
  const n = charts.length
  const word = (m[1] || `chart ${m[2]}`).toLowerCase()
  if (!n) return { ask: { text: 'There are no charts on this board.', choices: [] }, match: m }
  let idx = null
  if (m[2]) idx = Number(m[2]) - 1
  else if (word === 'last') idx = n - 1
  else if (['middle', 'center', 'centre'].includes(word)) {
    const cells = charts.map(c => c.cell).filter(Boolean)
    const oneRow = cells.length === n && new Set(cells.map(c => c.y)).size === 1
    const oneCol = cells.length === n && new Set(cells.map(c => c.x)).size === 1
    idx = (n === 3 || n === 5) && (oneRow || oneCol) ? (n - 1) / 2 : null
    if (idx == null) return { ask: { text: 'Which chart is the middle one here? Pick one:', choices: charts.map(c => ({ ref: c.ref, label: c.label })) }, match: m }
  } else idx = ORD_WORDS[word] - 1
  if (idx < 0 || idx >= n) return { ask: { text: `There ${n === 1 ? 'is only one chart' : `are only ${n} charts`} here — which one do you mean?`, choices: charts.map(c => ({ ref: c.ref, label: c.label })) }, match: m }
  return { ref: charts[idx].ref, word, match: m }
}

/** The charts on this board the member's words NAME: a position word that fits exactly one chart, or a
 *  symbol exactly one chart shows ("put RSI on NVDA"). Short tickers count only as typed in capitals. */
export function chartsNamedBy(text, charts = [], sel = null) {
  const s = String(text || '')
  const named = new Set()
  const rel = relativeChart(s, charts, sel)
  if (rel?.hits.length === 1) named.add(rel.hits[0].ref)
  // P1: "the second chart", "chart 3", "the middle chart" — only with the word CHART ("the first one" is as often a
  // list item or a result as a chart, so it never identifies a chart for a model plan)
  const ord = ordinalChart(s, charts)
  if (ord?.ref && /chart/i.test(ord.match[0])) named.add(ord.ref)
  // what the chart IS right now (chartQualifier), when that fits exactly one chart ("the empty one", "the one with RSI")
  const q = chartQualifier(s, charts)
  if (q?.hits.length === 1) named.add(q.hits[0].ref)
  for (const m of s.matchAll(POS_WORDS)) {
    const w = m[1].toLowerCase().replace(' ', '-').replace('upper', 'top').replace('lower', 'bottom')
    const parts = w.split('-')
    const hits = charts.filter(c => c.position && parts.every(p => c.position.split('-').includes(p)))
    if (hits.length === 1) named.add(hits[0].ref)
  }
  const bySym = new Map()
  for (const c of charts) { const k = String(c.symbol || '').toUpperCase(); if (k) bySym.set(k, [...(bySym.get(k) || []), c]) }
  for (const [sym, list] of bySym) {
    if (list.length !== 1) continue
    const re = new RegExp(`(?:^|[^A-Za-z0-9.])${escapeRe(sym)}(?![A-Za-z0-9])`, sym.length <= 2 ? '' : 'i')
    if (re.test(s)) named.add(list[0].ref)
  }
  return named
}

/**
 * A model plan on a board of several charts, for a request that does NOT point at a chart (pointing words
 * are screenDeicticOps'): each chart-backed change must land on a chart the member identified — named by
 * position or symbol, picked as an answer (`pickedRefs`), "all / every / both", or the chart they CLICKED
 * (the owner's bare-command rule, 2026-10-12). Otherwise:
 *   one chart changed      → { ask } "Which chart do you mean?" (nothing runs; their pick resumes the plan)
 *   several charts changed → { propose } the change is shown for approval, never applied at once
 * → null when every changed chart is identified (or the board has one chart).
 */
// a position word only where it stands for a chart: "the top one", "the chart in the bottom right". "the top was 150", "on top",
// "right now" and "the left shoulder" say nothing about a chart, so they never take the click's place
const CHART_POSITION = new RegExp(`${POS_WORDS.source}[\\s-]+(?:chart|one|cell|corner|pane)\\b|\\b(?:chart|one)\\s+(?:in|at|on)\\s+the\\s+${POS_WORDS.source}`, 'gi')
const chartPositions = (words) => [...String(words || '').matchAll(CHART_POSITION)].map(m => (m[1] || m[2]).toLowerCase().replace(' ', '-').replace('upper', 'top').replace('lower', 'bottom'))
function clickFits(said, charts, sel) {
  if (!said.length) return true
  return said.some(w => { const parts = w.split('-'); return charts.some(c => c.ref === sel && c.position && parts.every(p => c.position.split('-').includes(p))) })
}

export function screenUnnamedTargets({ host, ops, text, context = null, pickedRefs = [], getTargetKind, getCapability }) {
  if (pointsAtChart(text, { chartOp: true, charts: host?.charts?.list?.() || [] })) return null
  // an ANSWER to the model's question is read with the words that question was about (`context`)
  const words = context ? `${text} ${context}` : String(text || '')
  const charts = host?.charts?.list?.() || []
  if (charts.length < 2) return null
  const aliases = new Set((ops || []).map(o => o?.args?.as).filter(a => typeof a === 'string' && a))
  const targets = new Map()                                  // chart ref → the op kind's snapshots
  for (const o of ops || []) {
    const cap = getCapability(o?.action)
    const kind = cap ? getTargetKind(cap.target) : null
    if (!kind || cap.query || aliases.has(o.target)) continue
    const list = kind.list(host) || []
    const snap = list.find(s => s.ref === o.target)
    const chart = snap ? chartRefOf(kind, snap) : null
    if (chart) targets.set(chart, { list, action: o.action })
  }
  if (!targets.size) return null
  // "all / every / both (four) charts": the member named the set — but a COUNT they said must match
  // the charts this plan changes ("both" = two), else it is only proposed
  // ⭐ P2: "copy these to my other charts" — with the chart the request is about, the member named every chart
  if (OTHER_CHARTS.test(words)) return null
  // ⭐ PACKAGE 3: "apply it to my other chart" on a board of TWO — the other chart is the one the plan does NOT read from
  // (a copy's `from`) and does not already carry what it adds; then the member named it
  if (targets.size === 1 && otherChartMeant(words, charts, [...targets.keys()][0], ops)) return null
  const many = MANY_COUNT.exec(words)
  if (many) {
    const count = many[1] ? 2 : many[2] ? (COUNT_WORDS[many[2].toLowerCase()] || Number(many[2])) : null
    return count && count !== targets.size
      ? { propose: true, note: `You said ${count} charts, and this changes ${targets.size} — check it first; nothing has changed yet.` }
      : null
  }
  const named = chartsNamedBy(words, charts)
  // a picked choice may be the chart itself or a chart-backed entry of it (`ixe:<chart>`)
  for (const r of pickedRefs || []) if (r) { named.add(r); named.add(String(r).replace(/^[a-z]+:/i, '')) }
  // ⛔ The click answers for a request that names no chart. Words that name one are not overruled by it: a plan on the clicked
  // chart there is unidentified like any other. A bare "this" still means the clicked chart, and a position word fitting several
  // charts counts the click only if it is one of them.
  const sel = selectedChart(host)
  const said = chartPositions(words)
  const answered = (pickedRefs || []).some(Boolean)
  // ⛔ AUDIT (single clause): a plain "the other one / the other chart" on a board of TWO names the chart that is NOT the click,
  // and the click is EXCLUDED: a plan on the other chart runs, a plan on the click is asked (unless "this" names it too)
  const otherOne = !answered && sel && charts.length === 2 && otherOneIsChart(words) ? charts.find(c => c.ref !== sel)?.ref || null : null
  if (otherOne) named.add(otherOne)
  if (sel && (/\bthis\b/i.test(otherOne ? words.replace(OTHER_CHART, ' ') : words) || (!otherOne && !answered && !chartsNamedBy(`${words.replace(POS_WORDS, ' ')} ${said.join(' ')}`, charts).size && clickFits(said, charts, sel)))) named.add(sel)
  const unnamed = [...targets.keys()].filter(c => !named.has(c))
  if (!unnamed.length) return null
  if (targets.size === 1) {
    const { list, action } = targets.get(unnamed[0])
    return { ask: { text: 'Which chart do you mean? Click a chart to select it, or pick one:', choices: list.map(c => ({ ref: c.ref, label: c.label })), action } }
  }
  const label = (ref) => charts.find(c => c.ref === ref)?.label || 'a chart'
  return { propose: true, note: `I wasn't sure you meant ${unnamed.map(label).join(' and ')}, so check this first — nothing has changed yet.` }
}

/** The member's selected chart ref (live, still on this board) or null. */
export function selectedChart(host) {
  try { return host?.charts?.selected?.() || null } catch { return null }
}

/**
 * The model planned ops on charts for a deictic request: every chart-kind op must target the
 * selected chart (or the chart a named symbol picks). Plan aliases (`as` refs made in this plan)
 * and single-chart boards pass. → { ask } | null.
 */
/** PACKAGE 3: "apply it to my other chart" on a board of TWO — `dest` is "the other chart" when the plan reads FROM the
 *  remaining chart (a copy's `from`) or adds what that chart already carries. ("it" there is the indicator, not a chart.) */
function otherChartMeant(text, charts, dest, ops) {
  if (!OTHER_CHART.test(String(text || '')) || charts.length !== 2 || !charts.some(c => c.ref === dest)) return false
  const other = charts.find(c => c.ref !== dest)
  const strip = (r) => String(r || '').replace(/^[a-z]+:/i, '')
  const fromOther = (ops || []).some(o => strip(o?.args?.from) === other?.ref)
  const hasDef = (ops || []).some(o => typeof o?.args?.defId === 'string' && (other?.cs?.indicatorInstances || []).some(i => i && !i.deleted && i.defId === o.args.defId))
  return fromOther || hasDef
}

/** "the / my / that other one" (OTHER_CHART) means the other CHART — as the guide reads it (pl-teach T1e/T1f): with a chart word,
 *  or after a preposition (the LOCATION: "add RSI to the other one"), or when nothing named before it is a thing the "one" can
 *  stand for. As the verb's object after such a thing ("I drew two lines, delete the other one") it is that thing, not a chart. */
const ONE_IS_A_THING = /\b(?:drawings?|lines?|trend ?lines?|rays?|rectangles?|boxe?s?|circles?|arrows?|fibs?|fibonacci|channels?|notes?|labels?|indicators?|studies|study|alerts?|levels?|tabs?|layouts?|lists?|watchlists?|widgets?|templates?|panes?|colou?rs?)\b/i
function otherOneIsChart(text) {
  const s = String(text || '')
  const m = OTHER_CHART.exec(s)
  if (!m) return false
  if (/chart/i.test(m[0])) return true
  const before = s.slice(0, m.index)
  return /\b(?:on|to|onto|from|in|into|for|of|at|over)\s*$/i.test(before) || !ONE_IS_A_THING.test(before)
}

// the word "this" on a chart or stock, and no position, ordinal, name or description that could be saying something else
const TRUE_POINTER = /\bthis\s+(?:chart|stock|ticker|symbol|one)\b/i
const ELSE_NAMED = /\b(?:of|showing)\s+[a-z$]/i
function onlyPointer(text, charts) {
  const s = String(text || '')
  return TRUE_POINTER.test(s) && !relationMatch(s) && !OTHER_IN_CLAUSE.test(s) && !s.match(POS_WORDS) && !ORD_RE.test(s) && !ELSE_NAMED.test(s) && describedCharts(s, charts) == null
    && !chartNameWord(s, charts) && !chartsNamedBy(s, charts).size
}

/** "the TSLA tab" when TSLA shows only on a tab that isn't open. → the ticker, or null. The Agent reaches a chart's open tab only. */
export function closedTabNamed(text, host) {
  const m = TAB_NAMED.exec(String(text || ''))
  if (!m) return null
  const sym = resolvedTicker(m[1])
  try {
    if ((host?.charts?.list?.() || []).some(c => String(c.symbol || '').toUpperCase() === sym)) return null
    const s = host?.widgets?.snapshot?.()
    const syms = s?.groupSyms || {}
    for (const w of s?.raw || []) {
      if (w.type !== 'chart') continue
      for (const t of sanitizeChartTabs(w.opts).tabs) if (String(syms[t.color] || '').toUpperCase() === sym) return sym
    }
  } catch { /* the board can't be read: the gates below decide */ }
  return null
}

// pl-auto u-target-05/08 (BROWSER-MOCK-MODEL): a NEGATED pointer — "everything except this one", "not this chart", "all but
// this one", "other than this" — EXCLUDES the clicked chart. It is never aimed at nor stood in for: a plan on the other charts
// runs where it is planned, and an op on the click itself is asked about.
const NEG_POINTER = /(?:\b(?:except(?:\s+for)?|not|other\s+than|besides|apart\s+from|aside\s+from|excluding|minus|save\s+for)|\b(?:all|every\w*|them|others?|charts?|ones)\s+but(?:\s+not)?)\s+(?:this|that|it|the\s+(?:selected|clicked|current|highlighted|active|focused)\s+(?:chart|one))\b/i
export const negatedPointer = (text) => NEG_POINTER.exec(String(text || ''))
// ⭐ round 3 (pl-exec): PER-CLAUSE TARGETS — "make the NVDA chart weekly and this one log". A sentence of several clauses, each
// naming ONE chart (a description, a ticker, a position) or pointing at the click (this one / this chart / here / it), and each
// saying ONE change the capability's own instant reader recognises once the chart words are lifted off. Each op of the plan is
// matched to the one clause that says it (action and arguments); it runs only on that clause's chart. Affirmative clauses only:
// a negated clause's chart is never a target. Anything not certain — a clause naming two charts or none, an op no clause says,
// an op two clauses say — is not read here, and the gates below decide as before (they ask).
const OTHER_IN_CLAUSE = /\bthe other(?:\s+(?:one|chart|cell|pane|ticker|stock))?\b/i
const CLAUSE_POINTER = /\b(?:this|that)(?:\s+(?:one|chart|ticker|stock|symbol|graph|cell|pane))?\b|\bhere\b|\bit\b/i
const CHART_WORDS = new RegExp([
  String.raw`\b(?:on|to|for|in)\s+(?:the|this|that|my)\s+[a-z0-9.\-]+(?:\s+[a-z0-9.\-]+)?\s+(?:chart|one|cell|pane)\b`,
  String.raw`\b(?:the|this|that|my)\s+[a-z0-9.\-]+(?:\s+[a-z0-9.\-]+)?\s+(?:chart|one|cell|pane)\b`,
  String.raw`\b(?:on|to|for|in)\s+(?:this|that)(?:\s+(?:one|chart|ticker|stock|symbol|graph|cell|pane))?\b`,
  String.raw`\b(?:this|that)(?:\s+(?:one|chart|ticker|stock|symbol|graph|cell|pane))?\b`, String.raw`\bhere\b`, String.raw`\bit\b`,
].join('|'), 'gi')
const FILLER = /\b(?:make|set|put|switch|change|turn|flip|please|and|then|also|too|just|now|to|on|onto|with)\b/gi
function clauseReads(text, host, parse) {
  const s = String(text || '')
  // a negated pointer stays with the audited rules; a RELATION is read in its own clause (below)
  if (negatedPointer(s)) return null
  const parts = s.split(CLAUSE_SPLIT).map(x => x.trim()).filter(Boolean)
  if (parts.length < 2 || typeof parse !== 'function') return null
  const charts = host?.charts?.list?.() || []
  const sel = selectedChart(host)
  const out = []
  for (const part of parts) {
    const negated = NEGATION.test(part)
    // the clause's own chart, never two and never none:
    //   a relation in it ("the chart below it") → the single neighbour on that side of the click
    //   "the other one / chart" on a board of two with a click → the chart that is not the click
    //   a name (one) → that chart; a pointer alone (this one / here / it) → the click
    const rel = relationMatch(part) ? relativeChart(part, charts, sel) : null
    const other = OTHER_IN_CLAUSE.test(part) ? (charts.length === 2 && sel ? charts.find(c => c.ref !== sel)?.ref || null : null) : undefined
    const named = [...chartsNamedBy(part, charts, sel)]
    const pointer = CLAUSE_POINTER.test(part)
    const chart = rel ? (rel.hits.length === 1 && !rel.negated ? rel.hits[0].ref : null)
      : other !== undefined ? other
        : named.length === 1 && !pointer ? named[0] : !named.length && pointer && sel ? sel : null
    // the change once the chart words are lifted off (a relation's own words, and the chart it names, too)
    const bare = rel ? part.replace(rel.match[0], ' ').replace(/\b(?:the|a)\s+(?:chart|one|cell|pane|panel|ticker|stock|symbol|graph)\b/gi, ' ') : part
    const core = bare.replace(OTHER_IN_CLAUSE, ' ').replace(CHART_WORDS, ' ').replace(FILLER, ' ').replace(/[:]/g, ' ').replace(/\s+/g, ' ').trim()
    let ops = null
    const read = (t) => { try { const r = t ? parse(t, { host }) : null; return r?.kind === 'ops' && !r.target ? r.ops : null } catch { return null } }
    // "to the hourly", "on the weekly": the article a chart word left behind is no part of the change
    ops = read(core) || read(core.replace(/^(?:the|a|an)\s+/i, '')) || read(bare.replace(OTHER_IN_CLAUSE, ' ').replace(CHART_WORDS, ' ').replace(/[:]/g, ' ').replace(/\s+/g, ' ').trim())
    out.push({ part, negated, chart, ops, core })
  }
  // ⭐ 2026-11-07 (pl-auto u4-clauses-04/06/08/10): ONE change said once for two charts — "the TSLA chart to the hourly and this one
  // too", "draw a line at 120 on this one and on the TSLA chart", "this one and the one to its left on the weekly". A clause that
  // names its chart and says NOTHING else (its words are only chart words and fillers) shares the change of the one other
  // affirmative clause that says one. Two clauses saying changes, or none, leave it unread (the gates decide, as before).
  const sayers = out.filter(r => !r.negated && r.ops?.length)
  if (sayers.length === 1) {
    for (const r of out) if (!r.negated && r.chart && !r.ops && !SHARED_LEFTOVER(r.core)) { r.ops = sayers[0].ops; r.shared = true }
  }
  return out
}
const SHARED_LEFTOVER = (core) => !!String(core || '').replace(/\b(?:as\s+well|both|same|the|a|one|ones|chart|charts|do|that|please)\b/gi, ' ').trim()
const sameOp = (a, b) => a.action === b.action && JSON.stringify(a.args || {}) === JSON.stringify(b.args || {})
/** → { ok: true } when every op is the change of exactly one affirmative clause, on that clause's chart; { ask } when an op
 *  lands on a chart its clause does not name (or a negated clause's chart); null when the sentence is not read this way. */
function clauseTargets({ host, ops, text, getTargetKind, getCapability, parse }) {
  const reads = clauseReads(text, host, parse)
  if (!reads) return null
  const excluded = new Set(reads.filter(r => r.negated && r.chart).map(r => r.chart))
  const affirm = reads.filter(r => !r.negated)
  // the family itself: one affirmative clause points at the click, another names a different chart
  const sel = selectedChart(host)
  if (!affirm.some(r => r.chart && r.chart === sel) || !affirm.some(r => r.chart && r.chart !== sel)) return null
  let any = false
  const used = new Set()
  for (const o of ops || []) {
    const cap = getCapability(o?.action)
    const kind = cap ? getTargetKind(cap.target) : null
    const list = kind ? (kind.list(host) || []) : []
    const snap = list.find(x => x.ref === o.target)
    const chart = snap ? chartRefOf(kind, snap) : null
    if (!chart) continue
    if (excluded.has(chart)) return { ask: { text: 'You asked me to leave that chart alone. Which chart do you mean?', choices: list.filter(x => !excluded.has(chartRefOf(kind, x))).map(c => ({ ref: c.ref, label: c.label })), action: o.action } }
    const says = affirm.filter(r => (r.ops || []).some(x => sameOp(x, o)))
    // a shared change ("… and this one too") is said by each of its clauses: the op is the one whose chart it is on, each once
    const mine = says.length > 1 ? says.filter(r => r.chart === chart && !used.has(r)) : says
    if (says.length > 1 && mine.length !== 1) {
      if (says.some(r => !r.chart)) return null
      const meant = list.find(x => chartRefOf(kind, x) === says.find(r => !used.has(r))?.chart)
      return { ask: { text: `Did you mean ${meant?.label || 'that chart'} for that change?`, choices: list.map(c => ({ ref: c.ref, label: c.label })), action: o.action } }
    }
    if (mine.length !== 1 || !mine[0].chart) return null                      // not certain: the gates below decide
    if (mine[0].chart !== chart) {
      const meant = list.find(x => chartRefOf(kind, x) === mine[0].chart)
      return { ask: { text: `Did you mean ${meant?.label || 'that chart'} for that change?`, choices: list.map(c => ({ ref: c.ref, label: c.label })), action: o.action } }
    }
    any = true
    used.add(mine[0])
    o.__clause = mine[0]
  }
  // every affirmative clause that says a change has an op for it: a plan that does only part of the sentence is not read here
  // (the gates ask), so a one-op plan never runs beside a clause it left out
  const done = new Set((ops || []).map(o => o.__clause).filter(Boolean))
  for (const o of ops || []) delete o.__clause
  if (any && affirm.some(r => (r.ops || []).length && !done.has(r))) return null
  // a clause that names a chart but says no change of its own ("…and the one right of it as well") repeats another's: not certain
  if (any && affirm.some(r => r.chart && !(r.ops || []).length)) return null
  return any ? { ok: true } : null
}

export function screenDeicticOps({ host, ops, text, getTargetKind, getCapability, parse = null }) {
  if (!pointsAtChart(text, { chartOp: true, charts: host?.charts?.list?.() || [] })) return null
  {
    const per = clauseTargets({ host, ops, text, getTargetKind, getCapability, parse })
    if (per?.ask) return per
    if (per?.ok) return null
  }
  if (negatedPointer(text)) {
    const sel = selectedChart(host)
    for (const o of ops || []) {
      const cap = getCapability(o?.action)
      const kind = cap ? getTargetKind(cap.target) : null
      const list = kind ? (kind.list(host) || []) : []
      const snap = list.find(x => x.ref === o.target)
      if (snap && sel && chartRefOf(kind, snap) === sel) {
        const others = list.filter(x => chartRefOf(kind, x) && chartRefOf(kind, x) !== sel)
        return { ask: { text: 'You said not the chart you clicked. Which chart do you mean?', choices: others.map(c => ({ ref: c.ref, label: c.label })), action: o.action } }
      }
    }
    return null
  }
  {
    // a chart-backed change aimed at a tab that isn't open would land on the open one: said, and nothing runs
    const shut = closedTabNamed(text, host)
    if (shut && (ops || []).some(o => { const cap = getCapability(o?.action); const kind = cap ? getTargetKind(cap.target) : null; return !!kind && !cap.query && !!chartRefOf(kind, (kind.list(host) || []).find(x => x.ref === o.target)) })) {
      return { refuse: `The ${shut} tab isn't the open tab on that chart, so I can't change it from here. Open that tab, then ask again.` }
    }
  }
  {
    // PACKAGE 3: "put it on the other chart" — every chart-backed op aims at the other chart of two
    const charts = host?.charts?.list?.() || []
    const dests = new Set()
    for (const o of ops || []) {
      const cap = getCapability(o?.action)
      const kind = cap ? getTargetKind(cap.target) : null
      const snap = kind ? (kind.list(host) || []).find(x => x.ref === o.target) : null
      const c = snap ? chartRefOf(kind, snap) : null
      if (c) dests.add(c)
    }
    if (dests.size === 1 && otherChartMeant(text, charts, [...dests][0], ops)) return null
  }
  const aliases = new Set((ops || []).map(o => o?.args?.as).filter(a => typeof a === 'string' && a))
  const aimed = new Map()
  for (const o of ops || []) {
    const cap = getCapability(o?.action)
    const kind = cap ? getTargetKind(cap.target) : null
    if (!kind || aliases.has(o.target)) continue
    const list = kind.list(host) || []
    const snap = list.find(s => s.ref === o.target)
    if (!snap || !chartRefOf(kind, snap) || list.length < 2) continue
    const r = resolveDeictic({ host, kind, candidates: list, text, chartOp: true })
    if (r?.ask) return { ask: { ...r.ask, action: o.action } }
    // "this chart" with a chart clicked is settled: the plan goes there, no question (production 11-05: "Did you mean" the right chart).
    // ⛔ Only then: anything else in the words may be naming another chart, so a plan that disagrees is still asked about.
    const onClicked = !!r?.ref && r.ref !== o.target && chartRefOf(kind, list.find(s => s.ref === r.ref)) === selectedChart(host)
    if (onClicked && onlyPointer(text, host?.charts?.list?.() || [])) { aimed.set(o, r.ref); continue }
    if (r?.ref && r.ref !== o.target) {
      const meant = list.find(s => s.ref === r.ref)
      return { ask: { text: `Did you mean ${meant?.label || 'the selected chart'}?`, choices: list.map(c => ({ ref: c.ref, label: c.label })), action: o.action } }
    }
  }
  return aimed.size ? { aim: ops.map(o => (aimed.has(o) ? { ...o, target: aimed.get(o) } : o)) } : null
}

/** round 3: do the sentence's clauses name DIFFERENT charts ("the TSLA chart … and this one …")? An instant reader that applies
 *  one target to the whole sentence must then not claim it: the model plans it and the per-clause gate checks each op. */
export function clausesNameDifferentCharts(text, host) {
  const reads = clauseReads(text, host, () => null)
  if (!reads) return false
  const named = new Set(reads.map(r => r.chart).filter(Boolean))
  return named.size > 1 || (named.size >= 1 && reads.some(r => !r.chart && (CLAUSE_POINTER.test(r.part) || chartsNamedBy(r.part, host?.charts?.list?.() || [], selectedChart(host)).size)))
}
