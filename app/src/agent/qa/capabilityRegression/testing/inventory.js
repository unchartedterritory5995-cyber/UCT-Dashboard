// CAPABILITY REGRESSION (Mission 2) — the CAPABILITY INVENTORY and its COVERAGE, generated from the canonical
// registry (testing/registry.js: the real register functions, every server-gated kind on) and from the corpus / golden
// data. Coverage counts only what a test in this suite ENFORCES and that is not a recorded known gap.
//
// Protections per capability (docs/agent/REGRESSION-SYSTEM.md §2):
//   nl          a phrasing that reaches it with no known gap at level (b) or (c)
//   routing     a phrasing (or golden `routes` step) whose routed request carries it, no gap at (a)
//   args        a canonical op for it in the data passes the registry's own shapeError (inventory.test.js)
//   execution   it runs through the REAL panel (corpus level c, or a golden workflow) with its canonical API asserted
//   receipt     that execution asserts its receipt (a change) or its canonical read (a query)
//   refusal     a refusal case (or a golden step that must change nothing) exercises it
//   permission  its approval contract (risk, reversible, undo, query) is pinned (contract snapshot) — and, for a
//               confirm-risk capability, a case proves it waits for Apply
//   undo        (undo: exact only) a case undoes it and asserts the state is back
//   multiStep   it runs inside a multi-op plan or a multi-step workflow
//   phrasings   ≥ 3 distinct owner-style phrasings with no known gap
import { manifestFor, getCapability } from '../../../capabilities'
import { groupOfAction } from '../../../routing'
import { corpus, golden, phrasingsOf } from './corpus'

export const PROTECTIONS = ['nl', 'routing', 'args', 'execution', 'receipt', 'refusal', 'permission', 'undo', 'multiStep', 'phrasings']

/** The catalog's contract, per capability (what the snapshot pins). */
export function contractOf(names) {
  const all = new Map(manifestFor({ createIndicator: true, manageIndicators: true }).map(c => [c.name, c]))
  return Object.fromEntries(names.map(n => {
    const m = all.get(n); const c = getCapability(n) || {}
    return [n, { domain: n.split('.')[0], group: groupOfAction(n), target: c.target ?? m?.target ?? null, risk: c.risk || 'local',
      reversible: c.reversible !== false, undo: c.undo ?? m?.undo ?? null, query: !!c.query, surfaces: c.surfaces || ['charts'], fast: typeof c.fast === 'function' }]
  }))
}

const opsOf = (m) => (m?.ops || []).map(o => o.action)
/** Every canonical op in the data (corpus models, golden / refusal steps), with where it came from. */
export function canonicalOps() {
  const out = []
  for (const i of corpus.intents) for (const o of i.model?.ops || []) out.push({ where: `corpus ${i.id}`, op: o })
  for (const w of [...golden.workflows, ...corpus.refusals]) for (const s of w.steps) for (const o of s.model?.ops || []) out.push({ where: `${w.id}`, op: o })
  return out
}

/** Coverage per capability → { protections: {name: bool|null(n/a)}, evidence: {...} } */
export function coverage(names, contract) {
  const ev = Object.fromEntries(names.map(n => [n, Object.fromEntries(PROTECTIONS.map(p => [p, []]))]))
  const add = (n, p, why) => { if (ev[n]) ev[n][p].push(why) }
  const phr = Object.fromEntries(names.map(n => [n, new Set()]))
  for (const i of corpus.intents) {
    for (const ph of phrasingsOf(i)) {
      const g = ph.gaps || {}
      for (const n of i.capabilities) {
        if (!g.b || !g.c) add(n, 'nl', `${i.id}: "${ph.text}"`)
        if (!g.b && !g.c) phr[n]?.add(ph.text)
        if (!g.c) { add(n, 'execution', `${i.id} (c)`); if (i.expect?.receipt || i.expect?.reads || i.afterApprove?.receipt) add(n, 'receipt', `${i.id} (c)`) }
        if (!g.c && (i.model?.ops || []).length > 1) add(n, 'multiStep', `${i.id}: ${i.model.ops.length}-op plan`)
        if (!g.c && i.approve && contract[n]?.risk === 'confirm') add(n, 'permission', `${i.id}: waits for Apply`)
      }
      if (!g.a) for (const n of i.needs) add(n, 'routing', `${i.id}: "${ph.text}"`)
    }
    if (i.undo || i.capabilities.includes('agent.undo')) for (const n of i.capabilities) add(n, 'undo', `${i.id}: undo restores`)
    if ((i.before || []).length) for (const n of i.capabilities) add(n, 'multiStep', `${i.id}: after an earlier turn`)
  }
  for (const r of corpus.refusals) for (const n of r.capabilities) add(n, 'refusal', r.id)
  for (const w of golden.workflows) {
    if (w.gap) continue
    const undoes = w.steps.some(s => /\bundo\b|take .*back|revert/i.test(s.say) && (s.expect?.restored || s.expect?.setting || s.expect?.indicators || s.expect?.charts))
    for (const n of w.capabilities) {
      if (w.steps.some(s => s.model || s.expect)) { add(n, 'execution', w.id); add(n, 'nl', w.id) }
      if (w.steps.some(s => s.expect?.receipt || s.expect?.reads || s.afterApprove)) add(n, 'receipt', w.id)
      if (w.steps.some(s => s.expect?.refusal || (s.expect?.unchanged && s.expect?.receipt === false))) add(n, 'refusal', w.id)
      if (w.steps.length > 1 || w.steps.some(s => opsOf(s.model).length > 1)) add(n, 'multiStep', w.id)
      if (undoes) add(n, 'undo', w.id)
      if (w.steps.some(s => s.approve) && contract[n]?.risk === 'confirm') add(n, 'permission', `${w.id}: waits for Apply`)
    }
    for (const s of w.steps) for (const n of s.routes || []) add(n, 'routing', `${w.id}: "${s.say}"`)
  }
  for (const { where, op } of canonicalOps()) add(op.action, 'args', where)
  const out = {}
  for (const n of names) {
    const c = contract[n]
    const e = ev[n]
    const prot = {}
    for (const p of PROTECTIONS) prot[p] = e[p].length > 0
    prot.phrasings = phr[n].size >= 3
    // the approval contract is pinned for every capability (contract.json); a confirm one needs a behavioural case too
    prot.permission = c.risk === 'confirm' ? e.permission.length > 0 : true
    if (c.undo !== 'exact') prot.undo = null                       // n/a: nothing to undo
    out[n] = { protections: prot, phrasings: phr[n].size, evidence: Object.fromEntries(Object.entries(e).map(([k, v]) => [k, [...new Set(v)].slice(0, 6)])) }
  }
  return out
}

/** Totals per protection: covered / applicable. */
export function totals(cov) {
  const t = {}
  for (const p of PROTECTIONS) {
    const vals = Object.values(cov).map(c => c.protections[p]).filter(v => v !== null)
    t[p] = { covered: vals.filter(Boolean).length, applicable: vals.length }
  }
  const any = Object.values(cov).filter(c => PROTECTIONS.some(p => p !== 'permission' && c.protections[p])).length
  return { capabilities: Object.keys(cov).length, withAnyRegressionCase: any, perProtection: t }
}

/** Every known gap recorded in the data, flat. */
export function knownGaps() {
  const out = []
  for (const i of corpus.intents) for (const ph of phrasingsOf(i)) for (const [lvl, g] of Object.entries(ph.gaps || {})) out.push({ ...g, level: lvl, intent: i.id, phrasing: ph.text })
  for (const w of [...golden.workflows, ...corpus.refusals]) if (w.gap) out.push({ ...w.gap, level: 'workflow', intent: w.id, phrasing: null })
  return out
}
