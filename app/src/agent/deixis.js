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
const REL_ANCHOR = `(?:(?:this|that)(?:\\s+${REL_ANCHOR_NOUN}\\b|(?![\\s-]+[a-z]+\\b(?<!\\b(?:to|on|in|and|then|please|for|with|as|into|onto|now|weekly|daily|monthly|hourly|intraday|instead|too|also|here)))\\b)`
  + `|it\\b|the\\s+(?:selected|clicked|current|highlighted|active|focused)(?:\\s+${REL_ANCHOR_NOUN})?\\b`
  + `|the\\s+one\\s+(?:that\\s+)?(?:i|you)(?:'ve|\\s+have|\\s+just)?\\s*(?:clicked|selected|picked|chose|chosen|highlighted|tapped)(?:\\s+on)?\\b)`
export const RELATIVE = new RegExp(`\\b(?:(?:right|just|directly|immediately|exactly)\\s+)?(?:(above|over|below|under|underneath|beneath)|(?:to\\s+the\\s+|on\\s+the\\s+)?(left|right)\\s+of|(next\\s+to|beside|alongside)|(adjacent\\s+to|near|nearest(?:\\s+to)?|closest\\s+to))\\s+(?:(?:right|just|directly|immediately)\\s+)?${REL_ANCHOR}`, 'i')
// …and it is about a CHART: the anchor itself names one ("this one", "the selected chart", "the one I clicked"), or the thing
// meant is named before the relation ("the chart / the one / the ticker / whatever … above it"). "alert above it" and "a line
// under it" relate a price or a drawing to "it", not a chart to the click: no relation here.
const REL_CHART_ANCHOR = new RegExp(`(?:this|that)\\s+${REL_ANCHOR_NOUN}\\b|\\bthe\\s+(?:selected|clicked|current|highlighted|active|focused)\\b|\\bthe\\s+one\\s`, 'i')
const REL_MEANT = new RegExp(`\\b(?:the|which|whichever|any)\\s+(?:[a-z]+\\s+)?${REL_ANCHOR_NOUN}s?\\b|\\b(?:whatever|whichever)\\b`, 'i')
/** The relation match, or null when the words relate nothing to the clicked CHART. */
export function relationMatch(text) {
  const s = String(text || '')
  const m = RELATIVE.exec(s)
  if (!m) return null
  return REL_CHART_ANCHOR.test(m[0]) || REL_MEANT.test(s.slice(0, m.index)) ? m : null
}
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
/** → { hits: [chart snapshots], match } when the words name a chart relative to the clicked one (hits may be 0 or several), else null. */
export function relativeChart(text, charts = [], sel = null) {
  const m = relationMatch(text)
  if (!m) return null
  const s = sel ? charts.find(c => c.ref === sel && c.cell) : null
  if (!s) return { hits: [], match: m }
  const v = m[1] && m[1].toLowerCase()
  const side = v ? (['above', 'over'].includes(v) ? 'above' : 'below') : m[2] ? m[2].toLowerCase() : null
  // "next to / beside": either side; "adjacent to / near": any side. More than one fits → asked (the caller), never a guess
  const hits = side ? sideOf(charts, s, side)
    : m[4] ? ['above', 'below', 'left', 'right'].flatMap(x => sideOf(charts, s, x))
      : [...sideOf(charts, s, 'left'), ...sideOf(charts, s, 'right')]
  return { hits, match: m }
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
  if (sel && (/\bthis\b/i.test(words) || (!answered && !chartsNamedBy(`${words.replace(POS_WORDS, ' ')} ${said.join(' ')}`, charts).size && clickFits(said, charts, sel)))) named.add(sel)
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

// the word "this" on a chart or stock, and no position, ordinal, name or description that could be saying something else
const TRUE_POINTER = /\bthis\s+(?:chart|stock|ticker|symbol|one)\b/i
const ELSE_NAMED = /\b(?:of|showing)\s+[a-z$]/i
function onlyPointer(text, charts) {
  const s = String(text || '')
  return TRUE_POINTER.test(s) && !relationMatch(s) && !s.match(POS_WORDS) && !ORD_RE.test(s) && !ELSE_NAMED.test(s) && describedCharts(s, charts) == null
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

export function screenDeicticOps({ host, ops, text, getTargetKind, getCapability }) {
  if (!pointsAtChart(text, { chartOp: true, charts: host?.charts?.list?.() || [] })) return null
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
