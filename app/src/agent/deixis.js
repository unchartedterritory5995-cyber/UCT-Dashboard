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

// Words that point at "the chart in front of me". "it" counts only for a CHART-kind op ("make it
// weekly"), never on its own ("put it in Momentum", "what is it" are not about a chart).
const POINTS = /\b(?:(?:this|that|the|my|current|active|selected|focused)\s+(?:current\s+|active\s+|selected\s+)?(?:chart|stock|ticker|symbol|name)|this\s+one|(?:on|in)\s+here|right\s+here)\b/i
const IT = /\bit\b/i
// "this NVDA chart" — a ticker between the pointer word and "chart" (never a position or ordinal word)
const NAMED = /\b(?:this|that|the)\s+(?!(?:left|right|top|bottom|upper|lower|middle|center|centre|other|first|second|third|last|main|new|old|big|small|current|active|selected|focused|same|whole|entire)\s)([a-z]{1,6}(?:[.-][a-z]{1,2})?)\s+chart\b/i

// NL (2026-10-12): "the 5 minute chart", "the daily chart" — a chart named by its TIMEFRAME
const TF_NAMED = /\b(?:this|that|the)\s+(\d{1,3}\s*(?:m|min|mins|minute|minutes|h|hr|hour|hours)|1h|hourly|daily|weekly|monthly)\s+chart\b/i
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
 * "the AMD chart" / "the 5 minute chart" — a chart named by the SYMBOL or TIMEFRAME it shows right now.
 * → { match, word, hits: [chart snapshots] } | null. Only live charts count: a word that names no
 * chart on this board is not a qualifier (the fast path then leaves the sentence as it was).
 */
export function chartQualifier(text, charts = []) {
  const s = String(text || '')
  const tf = TF_NAMED.exec(s)
  if (tf) {
    const code = tfOfWord(tf[1])
    const hits = charts.filter(c => String(c.tf) === code)
    if (hits.length) return { match: withPrep(s, tf), word: tf[1], hits }
  }
  const nm = NAMED.exec(s)
  if (nm) {
    const sym = nm[1].toUpperCase()
    const hits = charts.filter(c => String(c.symbol || '').toUpperCase() === sym)
    if (hits.length) return { match: withPrep(s, nm), word: nm[1], hits }
  }
  return null
}
// widen a qualifier match to the preposition before it ("… to the AMD chart")
function withPrep(s, m) {
  const before = s.slice(0, m.index)
  const p = /\s+(?:on|to|onto|in|from|off|for|of)\s*$/i.exec(before)
  return p ? { index: p.index, 0: s.slice(p.index, m.index + m[0].length) } : { index: m.index, 0: m[0] }
}

/** Does the member's text point at one chart without naming it? */
export function pointsAtChart(text, { chartOp = false } = {}) {
  const s = String(text || '')
  return POINTS.test(s) || NAMED.test(s) || TF_NAMED.test(s) || (chartOp && IT.test(s))
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
  if (!pointsAtChart(text, { chartOp })) {
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
  // "this NVDA chart" / "the 5 minute chart": the symbol or timeframe that exactly one chart shows
  const q = chartQualifier(text, host?.charts?.list?.() || [])
  if (q && q.hits.length === 1) {
    const hits = backed.filter(b => b.chart === q.hits[0].ref)
    if (hits.length === 1) return { ref: hits[0].c.ref }
  }
  const sel = selectedChart(host)
  const hit = sel ? backed.filter(b => b.chart === sel) : []
  if (hit.length === 1) return { ref: hit[0].c.ref }
  return { ask: { text: sel ? 'Which chart do you mean?' : 'Which chart do you mean? Click a chart to select it, or pick one:', choices: candidates.map(c => ({ ref: c.ref, label: c.label })) } }
}

// ── P2-B (owner decision 7, 2026-10-25): every chart a MODEL plan changes must be one the member's
// own words, click or answer identified — on a board of several charts, never the model's guess ──
const POS_WORDS = /\b(top-left|top-right|bottom-left|bottom-right|top left|top right|bottom left|bottom right|left|right|top|bottom|upper|lower)\b/gi
// "both", "all (four) charts", "every chart", "all of them" — a SET of charts (never "remove all comparisons")
const MANY_COUNT = /\b(?:(both)\b|(?:all|every|each)(?:\s+(?:the|of the))?(?:\s+(two|three|four|five|six|seven|eight|nine|ten|\d{1,2}))?\s+(?:charts?|of them|ones)\b)/i
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

/** The charts on this board the member's words NAME: a position word that fits exactly one chart, or a
 *  symbol exactly one chart shows ("put RSI on NVDA"). Short tickers count only as typed in capitals. */
export function chartsNamedBy(text, charts = []) {
  const s = String(text || '')
  const named = new Set()
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
export function screenUnnamedTargets({ host, ops, text, context = null, pickedRefs = [], getTargetKind, getCapability }) {
  if (pointsAtChart(text, { chartOp: true })) return null
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
  const sel = selectedChart(host)
  if (sel) named.add(sel)
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
export function screenDeicticOps({ host, ops, text, getTargetKind, getCapability }) {
  if (!pointsAtChart(text, { chartOp: true })) return null
  const aliases = new Set((ops || []).map(o => o?.args?.as).filter(a => typeof a === 'string' && a))
  for (const o of ops || []) {
    const cap = getCapability(o?.action)
    const kind = cap ? getTargetKind(cap.target) : null
    if (!kind || aliases.has(o.target)) continue
    const list = kind.list(host) || []
    const snap = list.find(s => s.ref === o.target)
    if (!snap || !chartRefOf(kind, snap) || list.length < 2) continue
    const r = resolveDeictic({ host, kind, candidates: list, text, chartOp: true })
    if (r?.ask) return { ask: { ...r.ask, action: o.action } }
    if (r?.ref && r.ref !== o.target) {
      const meant = list.find(s => s.ref === r.ref)
      return { ask: { text: `Did you mean ${meant?.label || 'the selected chart'}?`, choices: list.map(c => ({ ref: c.ref, label: c.label })), action: o.action } }
    }
  }
  return null
}
