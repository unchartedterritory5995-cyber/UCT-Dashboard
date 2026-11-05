// DESCRIPTION-DRIVEN DISCOVERY: recall@manifest on the held-out Charts phrasings (dev/discovery.heldout.json, committed before
// any index change) and on the inspectable tuning set. Recall@manifest = every needed action is in the FIRST request, no
// need_groups reroute. It proves the capability reaches the model, not that the model uses it.
// NLM1_METRICS=1 prints the tables.
import { describe, it, expect } from 'vitest'
import { registerCatalog } from '../qa/capabilityRegression/testing/registry'
import { routedNames } from '../qa/capabilityRegression/testing/route'
import { groupOfAction } from '../routing'
import { ROUTERS } from './routers'
import { manifestFor, MANIFEST_CONTRACT } from '../capabilities'
import { correctTypos, lexiconFor } from '../nl/lexicon'
import held from './dev/discovery.heldout.json'
import tuning from './dev/discovery.tuning.json'

await registerCatalog()
const SHOW = globalThis.process?.env?.NLM1_METRICS === '1'
const correct = (t) => (correctTypos(t, lexiconFor(null)) || []).map(v => v.text)
const BYTES = new Map(manifestFor({ surface: 'charts', createIndicator: true, manageIndicators: true }).map(c => [c.name, JSON.stringify(c).length]))
const bytesOf = (names) => names.reduce((a, n) => a + (BYTES.get(n) || 0), 0)

function measure(cases) {
  const out = { n: cases.length, routers: {}, family: {}, regress: [], missed: [] }
  for (const name of ['v1', 'nlm1']) out.routers[name] = { recall: 0, own: 0, fallback: 0, bytes: 0, maxBytes: 0, caps: 0, maxCaps: 0 }
  for (const k of cases) {
    const got = {}
    for (const name of ['v1', 'nlm1']) {
      const r = out.routers[name]
      const s = ROUTERS[name](k.text, { correct })
      r.own += !!(s.matched && k.needs.map(groupOfAction).every(g => s.selected.includes(g)))
      r.fallback += !s.matched
      const { names } = routedNames(k.text, { v2: name === 'nlm1' })
      got[name] = k.needs.every(a => names.includes(a))
      r.recall += got[name]; r.caps += names.length; r.maxCaps = Math.max(r.maxCaps, names.length)
      const b = bytesOf(names); r.bytes += b; r.maxBytes = Math.max(r.maxBytes, b)
    }
    if (got.v1 && !got.nlm1) out.regress.push(k.text)
    if (!got.nlm1) out.missed.push(`${k.text} (${k.needs.join(', ')})`)
    for (const f of [k.family, k.unusual ? 'unusual' : null].filter(Boolean)) {
      const c = out.family[f] || (out.family[f] = { n: 0, v1: 0, nlm1: 0 })
      c.n++; c.v1 += got.v1; c.nlm1 += got.nlm1
    }
  }
  return out
}
const pct = (x, n) => `${(100 * x / Math.max(1, n)).toFixed(1)}%`
function report(label, m) {
  if (!SHOW) return
  for (const [name, r] of Object.entries(m.routers)) console.log(`DISCOVERY ${label} ${name.padEnd(5)} n=${m.n} recall@manifest ${pct(r.recall, m.n)}  own ${pct(r.own, m.n)}  fallback ${pct(r.fallback, m.n)}  avgCaps ${(r.caps / m.n).toFixed(1)}  maxCaps ${r.maxCaps}  avgBytes ${Math.round(r.bytes / m.n)}  maxBytes ${r.maxBytes}`)
  for (const [f, c] of Object.entries(m.family)) console.log(`DISCOVERY ${label} ${f.padEnd(10)} n=${c.n} v1 ${pct(c.v1, c.n)} nlm1 ${pct(c.nlm1, c.n)}`)
  for (const t of m.regress) console.log(`DISCOVERY ${label} REGRESS ${t}`)
  for (const t of m.missed) console.log(`DISCOVERY ${label} MISSED ${t}`)
}

describe('recall@manifest', () => {
  it('held-out: recall holds at this level, and no request is larger than the largest v1 request', () => {
    const m = measure(held.cases)
    report('held-out', m)
    expect(m.n).toBeGreaterThanOrEqual(200)
    expect(m.routers.nlm1.recall / m.n).toBeGreaterThanOrEqual(0.92)
    expect(m.routers.nlm1.own / m.n).toBeGreaterThanOrEqual(0.92)
    expect(m.routers.nlm1.fallback).toBeLessThanOrEqual(m.routers.v1.fallback)
    expect(m.routers.nlm1.maxBytes).toBeLessThanOrEqual(m.routers.v1.maxBytes)
    expect(m.routers.nlm1.maxCaps).toBeLessThanOrEqual(MANIFEST_CONTRACT.routingThreshold)
  })
  it('tuning set: bare requests that name one capability', () => {
    const m = measure(tuning.cases)
    report('tuning', m)
    expect(m.routers.nlm1.recall / m.n).toBeGreaterThanOrEqual(0.97)
    expect(m.regress).toEqual([])
  })
})
