// ── CREATED-OBJECT BINDING (live train 4, NLM-1 baseline P02 / P15; capreg CG-37) ─────────────────────────────────
//
// "open TSLA on a new chart and switch it to the weekly", "add a chart for META and make it a line chart", "add a chart
// for AMD and put the 50 SMA on it": inside ONE request, "it / that / the new one / the chart I just made" after a
// create step is the object THAT step creates. Production applied the second change to the EXISTING chart.
//
// The binding is the plan's own operation-result reference: the create op's alias (`as`) — the runtime resolves it to
// the new widget's AUTHORITATIVE id once that widget is committed (runtime.commitPlan `created`), and only then runs the
// ops aimed at it (a virtual target, or a deferred step re-aimed by landDeferred). Nothing here guesses a position.
//
//   bindCreated(ops, text, host) → { ops }            the plan with the pronoun's ops aimed at the created chart
//                                  { ask: text }      the reference can't be made certain (several new charts) — ask
//                                  null               nothing to bind (no create, no pronoun, or the words name a chart)
//
// Rules (deterministic, structural — no phrase list per command):
//   • exactly ONE chart is created by the plan (widget.add type chart with an alias, or widget.addCharts with one literal
//     ticker — rewritten to its canonical widget.add + chart.setSymbol form so it has an alias);
//   • the member's words refer back with a pronoun / "the new one" / "the chart I just made" — and do NOT name an existing
//     chart (its ticker, its position, its label);
//   • every OTHER chart-scoped op (a chart setting, an indicator) aimed at an EXISTING chart, or at no chart, is re-aimed
//     at the alias. An op already aimed at the alias is left alone.
//   • several charts created + a pronoun → ask (never a guess). Unrelated existing charts are never touched.

import { getCapability, getTargetKind } from './capabilities'

const BACK_REF = /\b(?:it|that|this|them|the new (?:one|chart)|the chart (?:i|you) just (?:made|added|created|opened)|the (?:one|chart) (?:i|you) just (?:made|added|created|opened))\b/i
const NEW_ALIAS = 'new_created'

/** the chart ref a chart-scoped target names (a chart ref itself, or an indicator kind's `groupOf`) */
function chartOfTarget(op) {
  const cap = getCapability(op?.action)
  const kind = cap ? getTargetKind(cap.target) : null
  if (!kind) return { scoped: false }
  if (cap.target === 'chart') return { scoped: true, ref: op.target }
  if (typeof kind.groupOf === 'function') {
    let g = null
    try { g = kind.groupOf(op.target) } catch { g = null }
    return { scoped: true, ref: g ?? null }
  }
  return { scoped: false }
}

/** does the member's text name this existing chart (its ticker, position or label)? */
function names(text, c) {
  const t = String(text || '')
  const esc = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  if (c?.symbol && new RegExp(`(^|[^A-Za-z])\\$?${esc(c.symbol)}(?![A-Za-z])`, String(c.symbol).length >= 3 ? 'i' : '').test(t)) return true
  if (c?.position && new RegExp(`\\b${esc(String(c.position).replace('-', '[ -]'))}\\b`, 'i').test(t)) return true
  if (c?.label && t.toLowerCase().includes(String(c.label).toLowerCase())) return true
  return false
}

export function bindCreated(opsIn, text, host) {
  const ops = Array.isArray(opsIn) ? opsIn : []
  if (ops.length < 2 || !BACK_REF.test(String(text || ''))) return null
  // canonical form: a one-ticker widget.addCharts becomes widget.add (alias) + chart.setSymbol — the alias IS the binding
  let plan = ops
  const lists = plan.filter(o => o?.action === 'widget.addCharts')
  if (lists.length === 1 && Array.isArray(lists[0].args?.symbols) && lists[0].args.symbols.length === 1 && !lists[0].args.chart_type) {
    const l = lists[0]
    const sym = String(l.args.symbols[0] || '').trim().toUpperCase()
    if (!sym) return null
    const expanded = [
      { action: 'widget.add', target: l.target || 'workspace', args: { type: 'chart', as: NEW_ALIAS }, ...(l.explicit === true ? { explicit: true } : {}) },
      { action: 'chart.setSymbol', target: NEW_ALIAS, args: { symbol: sym }, ...(l.explicit === true ? { explicit: true } : {}) },
      ...(l.args.timeframe ? [{ action: 'chart.setTimeframe', target: NEW_ALIAS, args: { timeframe: l.args.timeframe } }] : []),
    ]
    plan = plan.flatMap(o => (o === l ? expanded : [o]))
  }
  const creates = plan.filter(o => o?.action === 'widget.add' && o.args?.type === 'chart' && o.args?.as)
  if (!creates.length) return null
  // the ops that change a chart, aimed at an existing chart (or none) — the candidates "it" may wrongly point at
  const aliases = new Set(creates.map(o => String(o.args.as)))
  const strays = plan.filter(o => {
    if (o?.action === 'widget.add' || aliases.has(String(o?.target))) return false
    const c = chartOfTarget(o)
    return c.scoped && !aliases.has(String(c.ref))
  })
  if (!strays.length) return plan === ops ? null : null
  // the words name one of the board's existing charts → they meant it; leave the plan as it is
  let charts = []
  try { charts = host?.charts?.list?.() || [] } catch { charts = [] }
  const textNoNew = String(text || '').replace(new RegExp(`\\b(?:${[...plan.filter(o => o.action === 'chart.setSymbol' && aliases.has(String(o.target))).map(o => String(o.args?.symbol || ''))].filter(Boolean).join('|') || '(?!)'})\\b`, 'gi'), ' ')
  if (charts.some(c => names(textNoNew, c))) return null
  if (creates.length > 1) return { ask: 'Which of the new charts should that change go on? Ask for each chart’s change on its own — nothing has changed yet.' }
  const alias = String(creates[0].args.as)
  return {
    ops: plan.map(o => {
      if (!strays.includes(o)) return o
      // an indicator op is aimed at the chart's alias (the deferred step is re-aimed at the real chart once it exists)
      return { ...o, target: alias }
    }),
  }
}
