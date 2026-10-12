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

/** Does the member's text point at one chart without naming it? */
export function pointsAtChart(text, { chartOp = false } = {}) {
  const s = String(text || '')
  return POINTS.test(s) || NAMED.test(s) || (chartOp && IT.test(s))
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
  // "this NVDA chart": a named symbol that exactly one chart shows
  const named = NAMED.exec(String(text || ''))
  if (named) {
    const sym = named[1].toUpperCase()
    const charts = host?.charts?.list?.() || []
    const hits = backed.filter(b => charts.find(x => x.ref === b.chart)?.symbol === sym)
    if (hits.length === 1) return { ref: hits[0].c.ref }
  }
  const sel = selectedChart(host)
  const hit = sel ? backed.filter(b => b.chart === sel) : []
  if (hit.length === 1) return { ref: hit[0].c.ref }
  return { ask: { text: sel ? 'Which chart do you mean?' : 'Which chart do you mean? Click a chart to select it, or pick one:', choices: candidates.map(c => ({ ref: c.ref, label: c.label })) } }
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
