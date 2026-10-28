// ── UCT Agent MULTI-CHART phrases (Charts operator P1, 2026-10-27) ──────────────────────────────
//
// Whole sentences that name SEVERAL charts at once, read deterministically (no model call) on the
// legacy instant path — the same registry ops the model would plan, through the same planner, policy,
// runtime, receipts and Undo. Anything it cannot read with certainty returns null (→ the fast path, then
// the model, exactly as before). Pure: it reads the live board through `host`, never writes.
//
//   positional symbols   "NVDA on the left and AMD on the right", "put SPY top, QQQ bottom, both weekly",
//                        "TSLA on the second chart, AAPL on the third" → chart.setSymbol per named chart
//                        (each chart the member NAMED — applied as ONE change, one Undo)
//   side by side         "show NVDA and AMD side by side" — OWNER 2026-10-27: reuse suitable charts, create
//                        new ones only when needed or asked ("…in new charts"):
//                          0 charts            → propose two new charts (widget.addCharts)
//                          1 chart             → it shows the first (applied), then a new chart for the
//                                                second is proposed (two steps — a plan may not both
//                                                change a chart and create one)
//                          2 charts            → both reused (a chart already on one of them keeps it) — applied
//                          3+ charts           → already showing both: said; else the charts are PROPOSED
//                                                (named on the card), never picked silently
//   copy a look          "make the left chart look like the right one", "copy the look of the AMD chart to this
//                        chart", "match the bottom chart to the top one" → chartSetup.copyLook (proposed)
//
// Returns null | { kind: 'ops', ops, mode, note? } | { kind: 'steps', steps: [{ ops, mode, needs? }] }
//              | { kind: 'say', text }

import { matchPosition } from './fastPath'
import { ordinalChart, selectedChart } from './deixis'

// ── tickers as typed (capitals, or $-prefixed) — never a lowercase word ──
const NOT_TICKERS = new Set(['I', 'A', 'UCT', 'ETF', 'ADR', 'RS', 'RSI', 'MACD', 'EMA', 'SMA', 'ATR', 'VWAP', 'ET', 'AM', 'PM', 'OK', 'US', 'NYSE', 'HLC', 'OHLC', 'MA', 'D', 'W', 'M', 'AND', 'VS'])
const TICKER_RE = /(?:^|[\s,;(])(\$[A-Za-z][A-Za-z0-9.]{0,9}|[A-Z][A-Z0-9.]{0,9})(?=$|[\s,;.!?)])/g
export function tickersIn(raw) {
  const out = []
  for (const m of String(raw || '').matchAll(TICKER_RE)) {
    const t = m[1].replace(/^\$/, '').replace(/\.$/, '').toUpperCase()
    if (!m[1].startsWith('$') && NOT_TICKERS.has(t)) continue
    if (!out.includes(t)) out.push(t)
  }
  return out
}

// ── a timeframe said once for the whole request ("both weekly", "on the daily") ──
const TF = [[/\b(?:1|one)[\s-]?min(?:ute)?s?\b/, '1'], [/\b(?:5|five)[\s-]?min(?:ute)?s?\b/, '5'], [/\b(?:15|fifteen)[\s-]?min(?:ute)?s?\b/, '15'],
  [/\b(?:30|thirty)[\s-]?min(?:ute)?s?\b/, '30'], [/\b(?:hourly|1[\s-]?h(?:ou)?r|one hour|60[\s-]?min(?:ute)?s?)\b/, '60'], [/\bdaily\b/, 'D'], [/\bweekly\b/, 'W'], [/\bmonthly\b/, 'M']]
function timeframeIn(lower) {
  const hits = TF.filter(([re]) => re.test(lower)).map(([, code]) => code)
  return hits.length === 1 ? hits[0] : (hits.length ? false : null)        // false = two timeframes: not this module's
}

// ── position words ──
const POS_RE = /\b(top[- ]left|top[- ]right|bottom[- ]left|bottom[- ]right|upper[- ]left|upper[- ]right|lower[- ]left|lower[- ]right|left|right|top|bottom|upper|lower)\b/i
const normPos = (w) => w.toLowerCase().replace(' ', '-').replace('upper', 'top').replace('lower', 'bottom')

/** The ONE chart a short phrase names: a position, an ordinal, "this (chart|one)", or a symbol one chart shows. */
export function chartFromPhrase(phrase, charts, host, { other = null } = {}) {
  const p = String(phrase || '').trim()
  if (!p) return null
  if (/^(?:this|this chart|this one|it|the selected chart|my selected chart)$/i.test(p.replace(/^the\s+/i, '').trim()) || /^this (chart|one)$/i.test(p)) {
    const sel = selectedChart(host)
    return sel && charts.some(c => c.ref === sel) ? sel : null
  }
  if (/^(?:the\s+)?other(?:\s+(?:chart|one))?$/i.test(p) && other && charts.length === 2) return charts.find(c => c.ref !== other)?.ref || null
  const ord = ordinalChart(p, charts)
  if (ord?.ref) return ord.ref
  const pos = POS_RE.exec(p)
  if (pos) {
    const hit = matchPosition(charts, normPos(pos[1]))
    return hit.length === 1 ? hit[0].ref : null
  }
  const syms = tickersIn(p)
  if (syms.length === 1) {
    const hit = charts.filter(c => String(c.symbol || '').toUpperCase() === syms[0])
    return hit.length === 1 ? hit[0].ref : null
  }
  return null
}

// ⛔ Two charts in ONE link colour group always show the same symbol (a symbol change goes through the group,
// exactly as a search pick does): different symbols on them can never both land. Said, never attempted.
const LINKED = 'Those charts are linked to the same colour group, so they always show the same symbol. Unlink one of them first (set its link colour to not linked), then ask again — nothing has changed.'
function linkedTogether(refs, charts) {
  const groups = refs.map(r => charts.find(c => c.ref === r)?.group).filter(g => typeof g === 'string' && g && !g.startsWith('N'))
  return groups.length !== new Set(groups).size
}
const setSymbol = (ref, symbol) => ({ action: 'chart.setSymbol', target: ref, args: { symbol } })
const setTf = (ref, timeframe) => ({ action: 'chart.setTimeframe', target: ref, args: { timeframe } })
const addCharts = (symbols, timeframe) => ({ action: 'widget.addCharts', target: 'workspace', args: { symbols, timeframe: timeframe || null, chart_type: null, exact: null } })

// ── side by side ──
const SIDE = /\b(side[\s-]by[\s-]side|next to each other|beside each other|alongside each other)\b/i
const NEW_CHARTS = /\b(?:in|on|as|with)\s+(?:two\s+|2\s+)?new\s+charts?\b|\bnew charts?\b/i
function sideBySide(raw, lower, charts) {
  if (!SIDE.test(raw)) return null
  const syms = tickersIn(raw.replace(SIDE, ' '))
  if (syms.length !== 2) return null
  const tf = timeframeIn(lower)
  if (tf === false) return null
  const [a, b] = syms
  if (NEW_CHARTS.test(lower) || charts.length === 0) {
    return { kind: 'ops', ops: [addCharts([a, b], tf)], mode: 'propose' }
  }
  const showing = (s) => charts.filter(c => String(c.symbol || '').toUpperCase() === s)
  if (charts.length === 1) {
    const only = charts[0]
    const has = String(only.symbol || '').toUpperCase()
    const missing = has === a ? b : has === b ? a : null
    if (missing) return { kind: 'ops', ops: [addCharts([missing], tf || null)], mode: 'propose', note: `${has} stays on ${only.label}; a new chart for ${missing} goes beside it.` }
    // reuse the one chart for the first, then propose a chart for the second (two steps)
    return {
      kind: 'steps',
      steps: [
        { ops: [setSymbol(only.ref, a), ...(tf ? [setTf(only.ref, tf)] : [])], mode: 'apply' },
        { ops: [addCharts([b], tf || null)], mode: 'propose', needs: { ref: only.ref, symbol: a } },
      ],
    }
  }
  if (charts.length === 2) {
    // a chart already on one of them keeps it; the other chart takes the other symbol
    let [c1, c2] = charts
    if (showing(b).some(c => c.ref === c1.ref) || showing(a).some(c => c.ref === c2.ref)) [c1, c2] = [c2, c1]
    if (linkedTogether([c1.ref, c2.ref], charts)) return { kind: 'say', text: LINKED }
    const ops = [setSymbol(c1.ref, a), setSymbol(c2.ref, b), ...(tf ? [setTf(c1.ref, tf), setTf(c2.ref, tf)] : [])]
    return { kind: 'ops', ops, mode: 'apply' }
  }
  const sa = showing(a), sb = showing(b)
  if (sa.length && sb.length && !tf) return { kind: 'say', text: `${a} is already on ${sa[0].label} and ${b} on ${sb[0].label} — nothing to change.` }
  // several charts: keep one already on a symbol; fill the other from the first remaining chart in reading
  // order — PROPOSED, so the member sees exactly which charts (never a silent pick)
  const keepA = sa[0] || null, keepB = sb.find(c => c.ref !== keepA?.ref) || null
  const free = charts.filter(c => c.ref !== keepA?.ref && c.ref !== keepB?.ref)
  const ca = keepA || free.shift()
  const cb = keepB || free.shift()
  if (!ca || !cb) return null
  if (linkedTogether([ca.ref, cb.ref], charts)) return { kind: 'say', text: LINKED }
  const ops = [...(keepA ? [] : [setSymbol(ca.ref, a)]), ...(keepB ? [] : [setSymbol(cb.ref, b)]), ...(tf ? [setTf(ca.ref, tf), setTf(cb.ref, tf)] : [])]
  return ops.length ? { kind: 'ops', ops, mode: 'propose', note: `With ${charts.length} charts here I picked ${ca.label} for ${a} and ${cb.label} for ${b} — check it first; nothing has changed yet.` } : null
}

// ── positional symbols ──
const LEAD_VERB = /^(?:please\s+)?(?:put|show|load|open|set|switch|change|make|chart|pull up|bring up)\s+/i
const CLAUSE_SPLIT = /\s*(?:,|;|\band\b|\bthen\b|&)\s*/i
// what may sit in a clause beside the ticker and the chart word — anything else ("add RSI to NVDA on the
// left") means the clause is not a plain "this symbol on that chart", and the whole sentence is not ours
const FILLER = /\b(?:on|onto|to|in|at|for|the|chart|charts|one|side|screen|please)\b/gi
const escapeRe = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
function positional(raw, charts) {
  if (charts.length < 2) return null
  const clauses = raw.trim().replace(/[.!]+$/, '').split(CLAUSE_SPLIT).map(s => s.trim()).filter(Boolean)
  if (clauses.length < 2 || clauses.length > 6) return null
  const picks = []
  let tf = null
  for (const c0 of clauses) {
    const c = c0.replace(LEAD_VERB, '')
    const syms = tickersIn(c)
    if (!syms.length) {
      // "both weekly" / "make them daily" — one timeframe for every named chart
      const t = timeframeIn(c.toLowerCase())
      if (t && /\b(both|all|them|each)\b/i.test(c) && tf == null) { tf = t; continue }
      return null
    }
    if (syms.length !== 1) return null
    // the chart this clause names: a position or an ordinal, said beside the ticker — and nothing else
    const rest = c.replace(new RegExp(`\\$?${escapeRe(syms[0])}`, 'i'), ' ')
    // ("AAPL on the second" — an ordinal at the end of a clause means the chart too)
    const said = /\b(?:first|second|third|fourth|fifth|sixth|last|middle|[1-6](?:st|nd|rd|th))\s*$/i.test(rest) && !ordinalChart(rest, charts) ? `${rest} chart` : rest
    const ord = ordinalChart(said, charts)
    const pos = ord ? null : POS_RE.exec(said)
    if (!ord && !pos) return null
    const residue = said.replace(ord ? ord.match[0] : pos[0], ' ').replace(FILLER, ' ').trim()
    if (residue) return null
    let ref = null
    if (ord) ref = ord.ref || null
    else { const hit = matchPosition(charts, normPos(pos[1])); ref = hit.length === 1 ? hit[0].ref : null }
    if (!ref) {
      const word = (ord ? ord.match[0] : pos[0]).trim()
      return { kind: 'say', text: `I can't tell which chart “${word}” is here — name the charts by position (left, top-right…) or order (first, second…). Nothing has changed.` }
    }
    picks.push({ ref, symbol: syms[0] })
  }
  if (picks.length < 2) return null
  if (new Set(picks.map(p => p.ref)).size !== picks.length) return { kind: 'say', text: 'Two of those name the same chart — say which chart each symbol goes on. Nothing has changed.' }
  if (linkedTogether(picks.map(p => p.ref), charts)) return { kind: 'say', text: LINKED }
  const ops = picks.map(p => setSymbol(p.ref, p.symbol))
  if (tf) for (const p of picks) ops.push(setTf(p.ref, tf))
  return { kind: 'ops', ops, mode: 'apply' }
}

// ── copy a chart's look ──
const LOOK_RES = [
  [/^(?:please\s+)?(?:make|set|style|change)\s+(.+?)\s+(?:look|appear)\s+(?:just\s+|exactly\s+)?like\s+(.+?)$/i, 1, 2],
  [/^(?:please\s+)?(?:copy|apply|give)\s+(?:the\s+)?(?:look|style|appearance|colou?rs and settings|settings)\s+(?:of|from)\s+(.+?)\s+(?:to|onto|on)\s+(.+?)$/i, 2, 1],
  [/^(?:please\s+)?match\s+(.+?)\s+to\s+(.+?)$/i, 1, 2],
]
function copyLook(raw, charts, host) {
  if (charts.length < 2) return null
  const t = raw.trim().replace(/[.!?]+$/, '')
  for (const [re, toI, fromI] of LOOK_RES) {
    const m = re.exec(t)
    if (!m) continue
    const to = chartFromPhrase(m[toI], charts, host)
    const from = chartFromPhrase(m[fromI], charts, host, { other: to })
    if (!to || !from) return null                       // unclear → the model (which may ask)
    if (to === from) return { kind: 'say', text: 'That names the same chart twice — which chart should change, and which should it look like?' }
    return { kind: 'ops', ops: [{ action: 'chartSetup.copyLook', target: to, args: { from } }], mode: 'propose' }
  }
  return null
}

export function multiChartPlan(text, { host } = {}) {
  const raw = String(text || '').trim()
  if (!raw || raw.length > 200) return null
  let charts = []
  try { charts = host?.charts?.list?.() || [] } catch { charts = [] }
  const lower = raw.toLowerCase()
  return copyLook(raw, charts, host) || sideBySide(raw, lower, charts) || positional(raw, charts)
}
