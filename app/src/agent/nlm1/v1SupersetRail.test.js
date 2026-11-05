// THE V1 SUPERSET RAIL. Owner's bar: no capability below v1. Routing v2 is live for admins, so for the same message and the same
// budget, v2's request is never missing a group v1's request carries, unless carrying it would break the budget.
// The sweep runs every phrasing of every corpus and held-out set, in four follow-up contexts, on every surface. A missing group
// that fit the budget fails here, loudly. A missing group that did not fit is an OVER-BUDGET EXCEPTION: counted per set and pinned
// in EXCEPTIONS, so a rise fails too and a fall is recorded by lowering the pin.
// Sealed sets (testing/sets.js split 'sealed') are counted, never printed: see docs/agent/nl-intent/NL1-EVAL.md.
// This compares what reaches the model. It says nothing about what the model does with it.
import { describe, it, expect } from 'vitest'
import { registerCatalog } from '../qa/capabilityRegression/testing/registry'
import { corpus, golden } from '../qa/capabilityRegression/testing/corpus'
import { panelHost } from '../qa/capabilityRegression/testing/harness'
import collisions from '../qa/capabilityRegression/baseline/routingCollisions.json'
import { routeManifest, routingNames, groupOfAction } from '../routing'
import { MANIFEST_CONTRACT, manifestFor } from '../capabilities'
import { correctTypos, lexiconFor } from '../nl/lexicon'
import { SETS, turnsOf } from '../testing/sets'
import { routeManifestV2 } from './routingV2'
import paraphrases from './dev/paraphrases.json'
import heldOut from './dev/discovery.heldout.json'
import tuning from './dev/discovery.tuning.json'
import workflows from './baseline/workflows.json'
import workflows2 from './baseline/workflows2.json'
import workflows3 from './baseline/workflows3.json'
import workflows4 from './baseline/workflows4.json'
import stepplans from './baseline/stepplans.json'
import nlCorpus from '../__fixtures__/nlIntent/corpus.json'
import nlDev from '../__fixtures__/nlIntent/dev-nl1.json'
import nlHeldout1 from '../__fixtures__/nlIntent/heldout-v1.json'
import nlHeldout2 from '../__fixtures__/nlIntent/heldout-v2.json'
import nlSealed3 from '../__fixtures__/nlIntent/sealed-v3.json'

await registerCatalog()

const SURFACES = ['charts', 'screener', 'breadth', 'calendar', 'journal']
const CONTEXTS = [{}, { recentActions: ['indicator.add'] }, { recentActions: ['chart.setSymbol'], pendingActions: ['widget.remove'] }, { after: ['indicatorAlerts'] }]
// The pinned over-budget exceptions: (message, surface, context, group) rows per set, where adding the group v1 sends would break
// the action or byte budget. Lower a pin when a set falls. A rise means a change pushed out more of v1, which needs a reason.
const EXCEPTIONS = {
  'capreg corpus': 319, 'capreg collisions': 1, 'capreg golden': 60, 'nlm1 dev': 235, 'discovery held-out': 563, 'discovery tuning': 155,
  'nlm1 workflows': 185, 'nl corpus.json': 217, 'nl dev-nl1.json': 85, 'nl heldout-v1.json': 236, 'nl heldout-v2.json': 176, 'nl sealed-v3.json': 191,
}
const NL_FILES = { 'corpus.json': nlCorpus, 'dev-nl1.json': nlDev, 'heldout-v1.json': nlHeldout1, 'heldout-v2.json': nlHeldout2, 'sealed-v3.json': nlSealed3 }
const SEALED = new Set(SETS.filter(s => s.split === 'sealed').map(s => s.file))

const says = (flows) => flows.flatMap(w => (w.steps || []).flatMap(s => [s.say, s.request].filter(x => typeof x === 'string')))
const plain = (texts) => texts.map(text => ({ text }))
function allSets() {
  const capreg = corpus.intents.flatMap(i => i.phrasings.map(p => ({ text: typeof p === 'string' ? p : p.text, recentActions: i.recentActions, board: i.board })))
  return [
    { set: 'capreg corpus', cases: capreg },
    { set: 'capreg collisions', cases: plain(collisions.rows.map(r => r.text)) },
    { set: 'capreg golden', cases: plain(says(golden.workflows)) },
    { set: 'nlm1 dev', cases: paraphrases.cases },
    { set: 'discovery held-out', cases: heldOut.cases },
    { set: 'discovery tuning', cases: tuning.cases },
    { set: 'nlm1 workflows', cases: plain(says([...workflows.workflows, ...workflows2.workflows, ...workflows3.workflows, ...workflows4.workflows, ...stepplans.cases])) },
    ...Object.entries(NL_FILES).map(([file, data]) => ({ set: `nl ${file}`, sealed: SEALED.has(file), cases: data.cases.flatMap(c => turnsOf(c).map(t => ({ text: t.say, needs: (t.expect?.ops || []).map(o => o.a) }))) })),
  ]
}

const groupsOf = (manifest) => new Set(manifest.map(c => groupOfAction(c.name)).filter(Boolean))
const bytes = (list) => list.reduce((a, c) => a + JSON.stringify(c).length, 0)

/** One message on one surface in one context: the groups v1 sends that v2 does not, and whether each would have fit. */
function compare(manifest, k, ctx, byteBudget) {
  const host = k.board ? panelHost(k.board) : null
  const opts = { enabled: true, limit: MANIFEST_CONTRACT.limits.maxCapabilities, budget: MANIFEST_CONTRACT.routingThreshold, names: routingNames(host),
    correct: (t) => (correctTypos(t, lexiconFor(host)) || []).map(v => v.text), ...ctx, recentActions: ctx.recentActions || k.recentActions || [] }
  const a = routeManifest(manifest, k.text, opts)
  const b = routeManifestV2(manifest, k.text, opts)
  const has = (r) => (k.needs || []).every(n => r.manifest.some(c => c.name === n))
  const lostNeed = !!k.needs?.length && has(a) && !has(b)
  const inV2 = groupsOf(b.manifest)
  const missing = [...groupsOf(a.manifest)].filter(g => !inV2.has(g))
  const sized = missing.map(g => {
    const list = manifest.filter(c => groupOfAction(c.name) === g)
    const over = b.manifest.length + list.length > opts.budget || bytes(b.manifest) + bytes(list) > byteBudget
    return { group: g, size: list.length, over }
  })
  return { missing: sized, lostNeed, v1Caps: a.manifest.length, v2Caps: b.manifest.length, v1Bytes: bytes(a.manifest), v2Bytes: bytes(b.manifest) }
}

function sweep() {
  const out = { perSet: {}, fitting: [], rows: 0, largest: { v1: 0, v2: 0 } }
  for (const surface of SURFACES) {
    const manifest = manifestFor({ surface, createIndicator: true, manageIndicators: true })
    const fb = routeManifest(manifest, '', { enabled: true, limit: MANIFEST_CONTRACT.limits.maxCapabilities, budget: MANIFEST_CONTRACT.routingThreshold })
    const byteBudget = fb.routing ? bytes(fb.manifest) : Infinity
    for (const { set, cases, sealed } of allSets()) {
      const row = out.perSet[set] || (out.perSet[set] = { sealed: !!sealed, routed: 0, fitting: 0, over: 0, lostNeed: 0 })
      for (const k of cases) for (const ctx of (surface === 'charts' ? CONTEXTS : CONTEXTS.slice(0, 1))) {
        const r = compare(manifest, k, ctx, byteBudget)
        out.rows++; row.routed++
        if (surface === 'charts') { out.largest.v1 = Math.max(out.largest.v1, r.v1Bytes); out.largest.v2 = Math.max(out.largest.v2, r.v2Bytes) }
        const fit = r.missing.filter(m => !m.over)
        const over = r.missing.filter(m => m.over)
        row.fitting += fit.length; row.over += over.length; row.lostNeed += r.lostNeed
        if (surface !== 'charts' && over.length) row.offCharts = (row.offCharts || 0) + over.length
        if (!sealed) for (const m of fit) out.fitting.push(`${set} / ${surface}: "${k.text}" lacks ${m.group}`)
      }
    }
  }
  return out
}

describe('v2 never misses a group v1 sends, unless over budget', () => {
  const r = sweep()
  const rows = Object.entries(r.perSet)
  it('the sweep covered every set', () => {
    expect(rows.map(([set]) => set).sort()).toEqual(Object.keys(EXCEPTIONS).sort())
    expect(r.rows).toBeGreaterThan(15000)
  })
  it('no group that fit the budget is missing', () => {
    expect(r.fitting).toEqual([])
    expect(rows.filter(([, c]) => c.fitting).map(([set, c]) => `${set}: ${c.fitting}`)).toEqual([])
  })
  it('over-budget exceptions stay within their pins', () => {
    expect(rows.filter(([set, c]) => c.over > EXCEPTIONS[set]).map(([set, c]) => `${set}: ${c.over} > ${EXCEPTIONS[set]}`)).toEqual([])
  })
  it('only the charts surface can be over budget: every other manifest fits one request', () => {
    expect(rows.filter(([, c]) => c.offCharts).map(([set]) => set)).toEqual([])
  })
  it('no message loses a needed capability v1 sent', () => {
    expect(rows.filter(([, c]) => c.lostNeed).map(([set, c]) => `${set}: ${c.lostNeed}`)).toEqual([])
  })
  it('no request is larger than v1\'s largest', () => {
    expect(r.largest.v2).toBeLessThanOrEqual(r.largest.v1)
  })
})
