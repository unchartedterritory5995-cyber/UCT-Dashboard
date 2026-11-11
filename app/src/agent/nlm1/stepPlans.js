// ── NLM-1 · STRUCTURED STEP PLANS (DARK: the NLM-1 two keys; design: MILESTONE-NLM1.md §3b, approved 11-04) ──────
//
// A planner plan whose ops carry an `id` and whose later ops name an EARLIER op's RESULT as "$<id>.<field>":
//
//   (a) PRODUCES + VALIDATION   what each capability produces (`chart`, `indicator`), and whether a reference may be used
//                               where it is: an earlier step, a declared field, a compatible target kind. Any violation
//                               refuses the WHOLE plan before anything runs — never a partial run.
//   (b) RESULTS (per plan)      `chart` of a creating op = the runtime's own alias (resolved to the committed widget's id
//                               by commitPlan; deferred / sequential ops re-aimed by landDeferred); `chart` of a
//                               chart-scoped op = its own chart. `indicator` of an indicator.add = the ONE instance that
//                               step added: found by state — the instance on the board that was not there when the plan
//                               started and is what that step added (same indicator, same length). A consumer whose
//                               producer left no result (failed, refused, dismissed, ambiguous) does NOT run, and says so.
//   (c) READ-BACK               after the plan, each step's postcondition is read back (symbol, timeframe, indicator
//                               present, chart created) and, where the host can, the touched charts' SAVED copy is compared
//                               with this tab's (host.widgetInSync): one plain line says what is in place, what is not,
//                               and what is not saved — never a success claim the board does not show.
//
// Everything still goes through the ordinary executor, approval policy, protected-layout checks, receipts and grouped Undo.
// Pure but for host reads; never throws (a surprise → a refusal of the plan, or a read-back that says "not verified").

import { getCapability } from '../capabilities'
import { indicatorEditsRef, chartOfIndicatorEdits, indicatorRowsOf } from '../capabilities/indicatorEdits'

export const STEP_REF = /^\$([A-Za-z][\w-]*)\.([a-z]+)$/
export const STEP_PLAN_VERSION = 1

// ── (a) what a capability produces ────────────────────────────────────────────────────────────────────────────
/** The result fields an op produces: { chart?: 'created' | 'target', indicator?: true }. A capability may declare its own (`produces`). */
export function producesOf(op) {
  const cap = getCapability(op?.action)
  if (!cap) return {}
  if (cap.produces) return typeof cap.produces === 'function' ? cap.produces(op.args || {}) || {} : cap.produces
  if (op.action === 'widget.add' && op.args?.type === 'chart') return { chart: 'created' }
  if (cap.target === 'chart') return { chart: 'target' }
  if (cap.target === 'indicatorEdits') return { chart: 'target', ...(op.action === 'indicator.add' ? { indicator: true } : {}) }
  return {}
}

const isRef = (v) => typeof v === 'string' && STEP_REF.test(v)
/** Does this plan use step ids or step references at all? */
export function isStepPlan(ops) {
  const any = (v) => (isRef(v) ? true : Array.isArray(v) ? v.some(any) : v && typeof v === 'object' ? Object.values(v).some(any) : false)
  return (ops || []).some(o => o && (o.id != null || isRef(o.target) || any(o.args)))
}

/**
 * Validate and prepare a step plan whose context refs are already the REAL refs (after translateRefs).
 * → { ops, steps } | { error: [reason…] }   `steps[i]` = { id, action, args, target } as planned (for results / read-back)
 */
export function prepareStepPlan(opsIn) {
  const ops = Array.isArray(opsIn) ? opsIn : []
  const errors = []
  const byId = new Map()                         // id → { index, op, produces, chart, alias }
  const aliases = new Set()                      // the aliases of the charts this plan creates
  const out = []
  const steps = []
  ops.forEach((op0, i) => {
    const { id, ...op } = op0 || {}
    const cap = getCapability(op.action)
    if (!cap) { errors.push(`step ${i + 1}: unknown action ${op.action}`); return }
    let target = op.target
    // a reference in the TARGET: only `.chart`, only on a chart-scoped op (a chart, or a chart's indicators)
    if (isRef(target)) {
      const [, rid, field] = STEP_REF.exec(target)
      const src = byId.get(rid)
      if (!src) errors.push(`step ${i + 1}: "${target}" names no earlier step`)
      else if (field !== 'chart' || !src.produces.chart) errors.push(`step ${i + 1}: step "${rid}" (${src.op.action}) has no ${field} result to aim at`)
      else if (cap.target !== 'chart' && cap.target !== 'indicatorEdits') errors.push(`step ${i + 1}: ${op.action} does not act on a chart, so it cannot take "${target}"`)
      else {
        const chart = src.chart
        target = cap.target === 'indicatorEdits' && !src.alias ? indicatorEditsRef(chart) : chart
      }
    }
    // a reference in the ARGS: only `.indicator`, only as the instance of an indicator op that runs on its own (sequential)
    const args = JSON.parse(JSON.stringify(op.args || {}))
    const walk = (v, path) => {
      if (isRef(v)) {
        const [, rid, field] = STEP_REF.exec(v)
        const src = byId.get(rid)
        if (!src) errors.push(`step ${i + 1}: "${v}" names no earlier step`)
        else if (field === 'indicator') {
          if (!src.produces.indicator) errors.push(`step ${i + 1}: step "${rid}" (${src.op.action}) adds no indicator`)
          else if (!(path === 'instance' && cap.target === 'indicatorEdits' && cap.sequential)) errors.push(`step ${i + 1}: "${v}" can only be the instance of an indicator change`)
        } else errors.push(`step ${i + 1}: "${v}" — a ${field} result can only be a target`)
        return v                                 // `.indicator` stays a placeholder until the producing step has run
      }
      if (Array.isArray(v)) return v.map((x, k) => walk(x, `${path}[${k}]`))
      if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x, path ? `${path}.${k}` : k)]))
      return v
    }
    const argsOut = walk(args, '')
    let produced = producesOf({ ...op, args: argsOut })
    let alias = null
    if (produced.chart === 'created') {
      if (!id) produced = {}
      else { alias = String(id); argsOut.as = alias }
    }
    const chart = produced.chart === 'created' ? alias
      : produced.chart === 'target' ? (cap.target === 'indicatorEdits' ? (chartOfIndicatorEdits(target) || target) : target) : null
    // the alias this step's chart is: its own (a create), or the alias its target already is (a change on a new chart)
    const chartAlias = produced.chart === 'created' ? alias : (chart && aliases.has(String(chart)) ? String(chart) : null)
    if (alias) aliases.add(alias)
    if (id != null) {
      if (byId.has(String(id))) errors.push(`step ${i + 1}: the step id "${id}" is used twice`)
      byId.set(String(id), { index: i, op: { ...op, args: argsOut }, produces: produced, chart, alias: chartAlias })
    }
    out.push({ ...op, target, args: argsOut })
    steps.push({ id: id != null ? String(id) : null, index: i, action: op.action, target, args: argsOut, chart, alias })
  })
  return errors.length ? { error: errors } : { ops: out, steps }
}

// ── (b) results: an indicator a step added, found by state ────────────────────────────────────────────────────────
const MA_KEYS = ['period', 'maType']
const inputsOf = (args) => Object.fromEntries((Array.isArray(args?.inputs) ? args.inputs : []).map(x => [x.key, x.value]))
function listCharts(host) { try { return host?.charts?.list?.() || [] } catch { return [] } }
function instancesOf(host, ref) { try { return indicatorRowsOf(host.charts.read(ref)?.cs) || [] } catch { return [] } }

/** Every chart's indicator instance ids when the plan starts. */
export function snapshotInstances(host) {
  return new Map(listCharts(host).map(c => [String(c.ref), new Set(instancesOf(host, c.ref).map(r => String(r.instanceId)))]))
}

/** The instance an indicator.add STEP added: the one new instance that matches it → { ok, instanceId, chart } | { ok:false, why } */
const chartKey = (r) => String(r ?? '').split('~')[0]
/** `chart`: only that chart's instances (an instance id is unique per CHART only); `claimed`: Set of "chart|id" already
 *  given to an earlier step — the first unclaimed match is this step's (the same indicator added twice is two results) */
export function addedInstance(host, step, before, { chart = null, claimed = null } = {}) {
  const want = inputsOf(step.args)
  const hits = []
  for (const c of listCharts(host)) {
    if (chart != null && chartKey(c.ref) !== chartKey(chart)) continue
    const had = before?.get(String(c.ref)) || new Set()
    for (const r of instancesOf(host, c.ref)) {
      if (had.has(String(r.instanceId)) || r.defId !== step.args?.defId) continue
      if (MA_KEYS.some(k => want[k] != null && String(r.inputs?.[k]) !== String(want[k]))) continue
      if (claimed?.has(`${chartKey(c.ref)}|${r.instanceId}`)) continue
      hits.push({ instanceId: String(r.instanceId), chart: String(c.ref) })
    }
  }
  if (claimed && hits.length === 1) { claimed.add(`${chartKey(hits[0].chart)}|${hits[0].instanceId}`); return { ok: true, ...hits[0] } }
  if (hits.length === 1) return { ok: true, ...hits[0] }
  return { ok: false, why: hits.length ? 'more than one indicator like it was added' : 'it did not take effect' }
}

/** Is an indicator like the step's on that chart now (new or already there — "already on the chart, nothing to add")? */
export function hasInstanceLike(host, step, chart) {
  if (chart == null) return false
  const want = inputsOf(step.args)
  return instancesOf(host, chart).some(r => r.defId === step.args?.defId && !MA_KEYS.some(k => want[k] != null && String(r.inputs?.[k]) !== String(want[k])))
}

/**
 * Before a follow-up op runs: its "$<id>.indicator" placeholder → the instance that step added.
 * → { op } | { skip: text }   (an op with no placeholder comes back unchanged)
 */
export function resolveResultRefs(op, plan, host) {
  const args = op?.args || {}
  const ref = typeof args.instance === 'string' ? STEP_REF.exec(args.instance) : null
  if (!ref) return { op }
  const [, rid] = ref
  const src = plan.steps.find(s => s.id === rid)
  const meStep = plan.steps.find(s => s.action === op.action && s.args?.instance === args.instance && !s.reached)
  const me = meStep ? meStep.index + 1 : 0
  if (meStep) meStep.reached = true
  const got = src ? addedInstance(host, src, plan.before) : { ok: false, why: 'that step is not in the plan' }
  if (!got.ok) return { skip: `I didn't run step ${me || '?'} (${getCapability(op.action)?.title || op.action}): it changes the indicator step ${src ? src.index + 1 : '?'} adds, and ${got.why}.` }
  return { op: { ...op, args: { ...args, instance: got.instanceId } } }
}

// ── (c) read-back ───────────────────────────────────────────────────────────────────────────────────────────────
/**
 * Each step's postcondition, read back after the plan → { lines: [text], inPlace, total, notSaved }.
 * Checked: a chart created, a symbol, a timeframe, an indicator present. Other steps are reported by their receipts only.
 */
// `reached` (planner v2): the steps checked are the ones that REACHED this board — a step the server refused never does —
// so the line never claims "all" of what the member asked for
export async function readBackStepPlan(plan, host, { reached = false } = {}) {
  const charts = () => listCharts(host)
  const newCharts = () => charts().filter(c => !plan.before?.has(String(c.ref))).map(c => String(c.ref))
  // a created step's real chart: the new chart its symbol step names (else the only new chart)
  for (const s of plan.steps) {
    if (!s.alias) continue
    const sym = plan.steps.find(x => x.action === 'chart.setSymbol' && x.target === s.alias)?.args?.symbol
    const fresh = newCharts()
    const hit = sym ? fresh.filter(r => String(host.charts.read(r)?.symbol || '').toUpperCase() === String(sym).toUpperCase()) : fresh
    s.aliasRef = hit.length === 1 ? hit[0] : null
  }
  for (const s of plan.steps) if (!s.alias && s.chart && plan.steps.some(x => x.alias === s.chart)) s.chartRef = plan.steps.find(x => x.alias === s.chart).aliasRef
  const realChart = (s) => (s.alias ? s.aliasRef : (s.chartRef || (plan.steps.some(x => x.alias === s.target) ? plan.steps.find(x => x.alias === s.target).aliasRef : (s.chart || chartOfIndicatorEdits(s.target) || s.target))))
  const missing = []
  let checked = 0
  let ok = 0
  const touched = new Set()
  const claimed = new Set()
  const already = []                               // steps whose indicator was already there (their own result said so)
  plan.steps.forEach((s, i) => {
    if (s.refused) return                          // never ran: its refusal was said where it happened
    const n = (s.index ?? i) + 1
    const ref = realChart(s)
    let verdict = null                             // true | false | null (no read-back for this kind of step)
    try {
      if (s.alias) verdict = !!s.aliasRef
      else if (s.action === 'chart.setSymbol') verdict = !!ref && String(host.charts.read(ref)?.symbol || '').toUpperCase() === String(s.args?.symbol || '').toUpperCase()
      else if (s.action === 'chart.setTimeframe') verdict = !!ref && String(host.charts.read(ref)?.tf || '') === String(s.args?.timeframe || '')
      // the postcondition is the instance THIS step added on its chart. Only a step whose OWN result was an explicit no-op
      // ("already on the chart, nothing to add": s.noop) is checked by presence — and reported as already there, not added
      else if (s.action === 'indicator.add') {
        if (addedInstance(host, s, plan.before, { chart: ref, claimed }).ok) verdict = true
        else if (s.noop && hasInstanceLike(host, s, ref)) { verdict = true; already.push(`step ${n} (${getCapability(s.action)?.title || s.action})`) }
        else verdict = false
      }
    } catch { verdict = false }
    if (verdict == null) return
    checked++
    if (verdict) { ok++; if (ref) touched.add(String(ref).split('~')[0]) } else missing.push(`step ${n} (${getCapability(s.action)?.title || s.action})`)
  })
  const notSaved = []
  if (typeof host?.widgetInSync === 'function') {
    for (const id of touched) {
      try { const r = await host.widgetInSync(id); if (!r?.ok) notSaved.push(host.charts.read(id)?.label || id) } catch { /* unreadable: not claimed either way */ }
    }
  }
  const lines = []
  if (checked) {
    lines.push(missing.length
      ? `Checked on your board: ${ok} of ${checked} checked steps${reached ? ' that ran here' : ''} are in place. Not in place: ${missing.join(', ')}.`
      : `Checked on your board: all ${checked} checked steps${reached ? ' that ran here' : ''} are in place.`)
    if (already.length) lines.push(`Already there before, so nothing was added: ${already.join(', ')}.`)
  }
  // a step that changes what an earlier step adds and was never reached (the batch stopped before it): say so
  const notRun = plan.steps.filter(s => typeof s.args?.instance === 'string' && STEP_REF.test(s.args.instance) && !s.reached)
    .map(s => `step ${s.index + 1} (${getCapability(s.action)?.title || s.action})`)
  if (notRun.length) lines.push(`I didn't run ${notRun.join(', ')}: ${notRun.length > 1 ? 'they change' : 'it changes'} what an earlier step adds, and that step did not take effect.`)
  if (notSaved.length) lines.push(`On your screen but not saved yet: ${notSaved.join(', ')}.`)
  return { lines, inPlace: ok, total: checked, notSaved, notRun }
}
