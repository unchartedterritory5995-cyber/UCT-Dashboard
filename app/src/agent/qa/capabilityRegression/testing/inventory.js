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
import { corpus, golden, phrasingsOf, deterministicReading } from './corpus'
import { panelHost } from './harness'
import collisions from '../baseline/routingCollisions.json'

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

/** The actions the DETERMINISTIC layers would run for a message on a board (a compound read step by step). */
export function readingActions(text, boardName) {
  const r = deterministicReading(text, panelHost(boardName))
  if (!r) return []
  if (r.plan) return r.plan.map(o => o.action)
  if (r.stepTexts) return r.stepTexts.flatMap((t, k) => (r.steps[k] === 'undo' ? ['agent.undo'] : readingActions(t, boardName)))
  return []
}
const EXERCISED = new Map()
/**
 * The capabilities an entry ACTUALLY exercises — in a plan its assertions run (the faithful model's canonical ops, the
 * intent's deterministic plan, what the deterministic layers read for a scripted step) or in a routing assertion. A name
 * merely LISTED in `capabilities` counts for nothing (inventory.test.js rail 1b fails a listed-but-unexercised name).
 */
export function exercisedBy(entry) {
  if (EXERCISED.has(entry)) return EXERCISED.get(entry)
  const out = new Set()
  const board = entry.board || 'ONE'
  if (entry.phrasings) {                                         // a corpus intent
    for (const a of opsOf(entry.model)) out.add(a)
    for (const o of entry.deterministic?.plan || []) out.add(o.action)
    for (const a of entry.needs || []) out.add(a)                // asserted at level (a) for every phrasing
    if (entry.deterministic?.steps) for (const ph of phrasingsOf(entry)) for (const a of readingActions(ph.text, board)) out.add(a)
    for (const s of entry.before || []) for (const a of [...opsOf(s.model), ...readingActions(s.say, board)]) out.add(a)
    if (entry.undo) for (const a of readingActions(entry.undo.say, board)) out.add(a)
  } else {                                                      // a golden workflow / refusal case
    // `refuses` is credited only when a step ASSERTS that refusal by name (expect.refusedAction — the outcome row's actions)
    const refusedAsserted = new Set(entry.steps.flatMap(s => [].concat(s.expect?.refusedAction || [])))
    for (const a of entry.refuses || []) if (refusedAsserted.has(a)) out.add(a)
    for (const s of entry.steps) for (const a of [...opsOf(s.model), ...(s.routes || []), ...(s.model ? [] : readingActions(s.say, board))]) out.add(a)
  }
  EXERCISED.set(entry, out)
  return out
}
const asserted = (entry) => entry.capabilities.filter(n => exercisedBy(entry).has(n))
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
      for (const n of asserted(i)) {
        if (!g.b || !g.c) add(n, 'nl', `${i.id}: "${ph.text}"`)
        if (!g.b && !g.c) phr[n]?.add(ph.text)
        if (!g.c) { add(n, 'execution', `${i.id} (c)`); if (i.expect?.receipt || i.expect?.reads || i.afterApprove?.receipt) add(n, 'receipt', `${i.id} (c)`) }
        if (!g.c && (i.model?.ops || []).length > 1) add(n, 'multiStep', `${i.id}: ${i.model.ops.length}-op plan`)
        if (!g.c && i.approve && contract[n]?.risk === 'confirm') add(n, 'permission', `${i.id}: waits for Apply`)
      }
      if (!g.a) for (const n of i.needs) add(n, 'routing', `${i.id}: "${ph.text}"`)
    }
    if (i.undo || asserted(i).includes('agent.undo')) for (const n of asserted(i)) add(n, 'undo', `${i.id}: undo restores`)
    if ((i.before || []).length) for (const n of asserted(i)) add(n, 'multiStep', `${i.id}: after an earlier turn`)
  }
  for (const r of corpus.refusals) for (const n of asserted(r)) add(n, 'refusal', r.id)
  for (const w of golden.workflows) {
    if (w.gap) continue
    // PER STEP: a capability gets a protection only from a step whose own plan runs it (review #769 nit 2)
    const board = w.board || 'ONE'
    const listed = new Set(w.capabilities)
    const ranIn = w.steps.map(s => new Set([...opsOf(s.model), ...(s.model ? [] : readingActions(s.say, board))].filter(n => listed.has(n))))
    const refusedAsserted = new Set(w.steps.flatMap(s => [].concat(s.expect?.refusedAction || [])))
    for (const n of w.refuses || []) if (refusedAsserted.has(n)) add(n, 'refusal', `${w.id}: refused by name`)
    w.steps.forEach((s, k) => {
      for (const n of ranIn[k]) {
        if (s.model || s.expect) { add(n, 'execution', w.id); add(n, 'nl', w.id) }
        if (s.expect?.receipt || s.expect?.reads || s.afterApprove) add(n, 'receipt', w.id)
        if (s.expect?.refusal || (s.expect?.unchanged && s.expect?.receipt === false)) add(n, 'refusal', w.id)
        if (w.steps.length > 1 || opsOf(s.model).length > 1) add(n, 'multiStep', w.id)
        if (s.approve && contract[n]?.risk === 'confirm') add(n, 'permission', `${w.id}: waits for Apply`)
        // undone LATER in this workflow, with the state asserted back
        if (w.steps.slice(k + 1).some(u => /\bundo\b|take .*back|revert/i.test(u.say) && (u.expect?.restored || u.expect?.setting || u.expect?.indicators || u.expect?.charts))) add(n, 'undo', w.id)
      }
      for (const n of s.routes || []) add(n, 'routing', `${w.id}: "${s.say}"`)
    })
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
  for (const r of collisions.rows) if (r.gap) out.push({ ...r.gap, level: 'collision', intent: `routing ${r.owner}`, phrasing: r.text })
  return out
}
