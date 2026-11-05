// ── CREATED-OBJECT BINDING v2 (live train 4, NLM-1 P02 / P15; capreg CG-37; review t4 H1–H2, M3–M4) ─────────────
//
// "open TSLA on a new chart and switch it to the weekly", "add a chart for META and make it a line chart": inside ONE
// request, a change with NO target of its own that follows a create step goes on the object that step creates. The
// binding is the plan's own operation-result reference — the create op's alias (`as`), which the runtime resolves to
// the new widget's AUTHORITATIVE id once committed (runtime.commitPlan `created`) and only then runs the ops aimed at it.
//
// Contract (NLM-1's planCreatedReference sits on it unchanged): bindCreated(ops, text, host)
//   → { ops }   the plan with its untargeted chart-scoped ops aimed at the created chart
//   → { ask }   the reference can't be made certain — asked, never guessed
//   → null      nothing to bind
//
// Decided by PLAN STRUCTURE and the plan's own target fields, never by a phrase list per command:
//   H1  an op the plan aimed EXPLICITLY at an existing chart is NEVER re-targeted. Only an op with no target, or with a
//       target that resolves to nothing on the board (an unresolvable reference), is a candidate.
//   •   exactly ONE chart is created, and the candidate comes AFTER its create in plan order (a one-ticker
//       widget.addCharts is first rewritten to its canonical widget.add + chart.setSymbol form, so it has an alias).
//   The member's words are read for ONE thing only — whether they explicitly name an EXISTING chart:
//   M3  its ticker (the new chart's own ticker included: a ticker on both → ask), position or label, or an explicit
//       existing reference ("this chart", "my other chart", "my main chart", "the one already there") → no rebind
//       (a different existing chart named) or ask (the new chart's ticker is also an existing chart's).
//   H2  "this" / "that" never bind ("make this chart weekly" is the selected chart).
//   M4  several creates, or a candidate the words set apart from the create ("…and ALSO make it weekly") → ask.

import { getCapability, getTargetKind } from './capabilities'

const NEW_ALIAS = 'new_created'
// an explicit reference to an EXISTING chart (never the new one)
const EXISTING_REF = /\b(?:this|that|my) chart\b|\b(?:my|the) (?:other|main|existing|original|old|current|first|selected) (?:chart|one)s?\b|\b(?:already there|that was (?:already )?there|i already have|i had)\b/i
// M4: the change is set apart from the create — it may be meant for a chart already there
const SET_APART = /\b(?:also|too|as well|additionally|on top of that)\b/i

function chartOfTarget(op) {
  const cap = getCapability(op?.action)
  const kind = cap ? getTargetKind(cap.target) : null
  if (!kind) return { scoped: false }
  if (cap.target === 'chart') return { scoped: true, kind, ref: op.target ?? null }
  if (typeof kind.groupOf === 'function') {
    let g = null
    try { g = op.target == null ? null : kind.groupOf(op.target) } catch { g = null }
    return { scoped: true, kind, ref: g ?? null }
  }
  return { scoped: false }
}
// does `ref` resolve to an entry of the op's target kind on this board?
function resolves(op, host) {
  const cap = getCapability(op?.action)
  const kind = cap ? getTargetKind(cap.target) : null
  if (!kind || op?.target == null) return false
  try { return (kind.list(host) || []).some(s => String(s.ref) === String(op.target)) } catch { return false }
}
const esc = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
function namesChart(text, c) {
  const t = String(text || '')
  if (c?.symbol && new RegExp(`(^|[^A-Za-z])\\$?${esc(c.symbol)}(?![A-Za-z])`, String(c.symbol).length >= 3 ? 'i' : '').test(t)) return 'symbol'
  if (c?.position && new RegExp(`\\b${esc(String(c.position)).replace('-', '[ -]')}\\b`, 'i').test(t)) return 'position'
  if (c?.label && t.toLowerCase().includes(String(c.label).toLowerCase())) return 'label'
  return null
}

export function bindCreated(opsIn, text, host) {
  const ops = Array.isArray(opsIn) ? opsIn : []
  if (ops.length < 2) return null
  // canonical form: a one-ticker widget.addCharts → widget.add (alias) + chart.setSymbol — the alias IS the result reference
  let plan = ops
  const lists = plan.filter(o => o?.action === 'widget.addCharts')
  if (lists.length === 1 && Array.isArray(lists[0].args?.symbols) && lists[0].args.symbols.length === 1 && !lists[0].args.chart_type) {
    const l = lists[0]
    const sym = String(l.args.symbols[0] || '').trim().toUpperCase()
    if (!sym) return null
    const keep = l.explicit === true ? { explicit: true } : {}
    plan = plan.flatMap(o => (o !== l ? [o] : [
      { action: 'widget.add', ...(l.target != null ? { target: l.target } : {}), args: { type: 'chart', as: NEW_ALIAS }, ...keep },
      { action: 'chart.setSymbol', target: NEW_ALIAS, args: { symbol: sym }, ...keep },
      ...(l.args.timeframe ? [{ action: 'chart.setTimeframe', target: NEW_ALIAS, args: { timeframe: l.args.timeframe } }] : []),
    ]))
  }
  const createIdx = plan.map((o, i) => (o?.action === 'widget.add' && o.args?.type === 'chart' && o.args?.as ? i : -1)).filter(i => i >= 0)
  if (!createIdx.length) return null
  const aliases = new Set(createIdx.map(i => String(plan[i].args.as)))
  // H1: candidates — chart-scoped ops AFTER a create with NO target, or one that resolves to nothing; never an explicit one
  const firstCreate = createIdx[0]
  const candidates = plan.filter((o, i) => {
    if (i <= firstCreate || o?.action === 'widget.add' || aliases.has(String(o?.target))) return false
    const c = chartOfTarget(o)
    if (!c.scoped || (c.ref != null && aliases.has(String(c.ref)))) return false
    return o.target == null || !resolves(o, host)
  })
  if (!candidates.length) return null
  // the words, read ONLY for an explicit naming of an EXISTING chart (M3: the new chart's ticker is not stripped)
  let charts = []
  try { charts = host?.charts?.list?.() || [] } catch { charts = [] }
  const newSyms = new Set(plan.filter(o => o.action === 'chart.setSymbol' && aliases.has(String(o.target))).map(o => String(o.args?.symbol || '').toUpperCase()))
  const named = charts.map(c => ({ c, how: namesChart(text, c) })).filter(x => x.how)
  if (named.some(x => x.how === 'symbol' && newSyms.has(String(x.c.symbol || '').toUpperCase()))) {
    return { ask: 'Do you mean the chart you’re adding, or the one already on your board with that ticker? Say which — nothing has changed yet.' }
  }
  if (named.length || EXISTING_REF.test(String(text || ''))) return null       // an existing chart named: the normal flow decides
  if (createIdx.length > 1) return { ask: 'Which of the new charts should that change go on? Ask for each chart’s change on its own — nothing has changed yet.' }
  // M4: a change the words set apart from the create may be meant for a chart already there
  if (charts.length && SET_APART.test(String(text || ''))) {
    return { ask: 'Should that change go on the new chart, or on a chart you already have? Say which — nothing has changed yet.' }
  }
  const alias = String(plan[firstCreate].args.as)
  return { ops: plan.map(o => (candidates.includes(o) ? { ...o, target: alias } : o)) }
}
