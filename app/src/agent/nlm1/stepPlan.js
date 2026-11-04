// ── NLM-1 · STRUCTURED STEP PLANS (design harness — NOT wired into production) ─────────────────────────────────────
//
// The proposed planner contract (docs/agent/program/MILESTONE-NLM1.md, "Structured multi-step plans"): ONE plan for a
// multi-step request, each op with an `id`, later ops naming an EARLIER op's result by reference — "$step1.chart" —
// instead of a pronoun the browser must guess ("it", "the new one"). This module DESUGARS such a plan onto the executor
// that exists today (the create op's alias, which the runtime resolves to the committed widget's id; deferred ops
// re-aimed by landDeferred), so the no-model harness can replay a scripted correct plan through the REAL panel and
// assert final state + grouped Undo. Anything the current runtime cannot carry is reported as `unsupported` (the runtime
// work the design names), never approximated.
//
//   desugarStepPlan(plan) → { ops } | { unsupported: [reason…] }
//
// Reference rules (the proposed validation; the server would enforce the same):
//   • `$<id>.<field>` may only name an op EARLIER in the same plan (no forward or self reference)
//   • fields: `chart` — a chart-creating op's new chart (widget.add type chart), or a chart-scoped op's own target chart
//             `indicator` — the instance an indicator.add committed (NOT carried by the runtime today → unsupported)
//   • an op whose target is explicit (a context ref, "$charts[1]", or a step reference) is never re-targeted (the
//     created-binding-v2 structural rule): this harness never applies any binding

const REF = /^\$([A-Za-z][\w-]*)\.([a-z]+)$/

export function desugarStepPlan(plan) {
  const ops = Array.isArray(plan?.ops) ? plan.ops : []
  const seen = new Map()                 // id → { index, op, chart: what `.chart` resolves to }
  const unsupported = []
  const out = []
  const resolveRef = (v, i, where) => {
    const m = REF.exec(String(v))
    if (!m) return v
    const [, id, field] = m
    const src = seen.get(id)
    if (!src) { unsupported.push(`op ${i + 1} (${where}): "${v}" names no EARLIER step`); return v }
    if (field === 'chart') {
      if (src.chart) return src.chart
      unsupported.push(`op ${i + 1} (${where}): step "${id}" (${src.op.action}) has no chart result`)
      return v
    }
    unsupported.push(`op ${i + 1} (${where}): "${v}" — the runtime does not report a step's ${field} result yet`)
    return v
  }
  const walk = (x, i, where) => (Array.isArray(x) ? x.map(y => walk(y, i, where))
    : x && typeof x === 'object' ? Object.fromEntries(Object.entries(x).map(([k, y]) => [k, walk(y, i, `${where}.${k}`)]))
      : typeof x === 'string' ? resolveRef(x, i, where) : x)
  ops.forEach((op, i) => {
    const { id, ...rest } = op || {}
    let target = resolveRef(rest.target, i, 'target')
    // an indicator op on an EXISTING chart is aimed at that chart's indicator entry (its target kind); on a NEW chart, at the
    // chart's alias (the deferred step is re-aimed at the real chart once it exists)
    if (/^indicator/.test(String(rest.action))) target = String(target).replace(/^\$charts\[(\d+)\]$/, '$indicatorEdits[$1]')
    const args = walk(rest.args || {}, i, 'args')
    let chart = null
    let o = { ...rest, target, args }
    if (rest.action === 'widget.add' && args?.type === 'chart' && id) {
      // the created chart's result = the alias the runtime already resolves to the committed widget's id
      o = { ...o, args: { ...args, as: id } }
      chart = id
    } else if (/^chart\.|^volume\.|^chartSetup\./.test(String(rest.action))) {
      chart = target                      // a chart-scoped op's own chart
    } else if (rest.action === 'indicator.add') {
      // the chart it was added to (its `.indicator` result is not carried by the runtime yet)
      chart = String(target).replace(/^\$indicatorEdits\[(\d+)\]$/, '$charts[$1]')
    }
    if (id) {
      if (seen.has(id)) unsupported.push(`op ${i + 1}: step id "${id}" is used twice`)
      seen.set(id, { index: i, op: rest, chart })
    }
    out.push(o)
  })
  return unsupported.length ? { unsupported } : { ops: out }
}
