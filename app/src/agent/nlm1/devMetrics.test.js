// NLM-1 DEV METRICS (D1.1) — routing accuracy (own-groups recall: the router's OWN selection holds every needed group,
// no fill), broad-fallback frequency, final availability (raw recall: every needed action is in the request actually
// sent, under the per-request budget) and PER-CAPABILITY deltas vs v1, on the capreg corpus and the nlm1 dev set
// (dev/paraphrases.json — this track's tuning set, NOT the sealed held-out set).
// Gates: own-groups ≥ 90%, availability ≥ v1, no capability's availability below v1 (dev + corpus).
// NLM1_METRICS=1 prints the tables.
import { describe, it, expect } from 'vitest'
import { registerCatalog } from '../qa/capabilityRegression/testing/registry'
import { routedNames } from '../qa/capabilityRegression/testing/route'
import { corpus } from '../qa/capabilityRegression/testing/corpus'
import { panelHost } from '../qa/capabilityRegression/testing/harness'
import { groupOfAction, routingNames } from '../routing'
import { ROUTERS } from './routers'
import { manifestFor } from '../capabilities'
import { correctTypos, lexiconFor } from '../nl/lexicon'
import dev from './dev/paraphrases.json'

await registerCatalog()
const SHOW = globalThis.process?.env?.NLM1_METRICS === '1'

// prompt size: the routed manifest's JSON bytes (what the per-turn cost cap, #785, reserves on) and its groups
let BYTES = null
const bytesOf = (names) => {
  if (!BYTES) BYTES = new Map(manifestFor({ surface: 'charts', createIndicator: true, manageIndicators: true }).map(c => [c.name, JSON.stringify(c).length]))
  return names.reduce((a, n) => a + (BYTES.get(n) || 0), 0)
}
export function metrics(cases) {
  const z = () => ({ own: 0, fallback: 0, avail: 0, caps: 0, bytes: 0, maxBytes: 0, groups: 0 })
  const out = { n: cases.length, v1: z(), nlm1: z(), perCap: {}, regress: [] }
  for (const k of cases) {
    const host = k.board ? panelHost(k.board) : null
    const correct = (t) => (correctTypos(t, lexiconFor(host)) || []).map(v => v.text)
    const groups = [...new Set(k.needs.map(groupOfAction))]
    const got = {}
    for (const name of ['v1', 'nlm1']) {
      const s = ROUTERS[name](k.text, { recentActions: k.recentActions || [], names: routingNames(host), correct })
      out[name].own += s.matched && groups.every(g => s.selected.includes(g))
      out[name].fallback += !s.matched
      const p = routedNames(k.text, { host, recentActions: k.recentActions || [], after: k.after || null, v2: name === 'nlm1' })
      out[name].caps += p.names.length
      const by = bytesOf(p.names)
      out[name].bytes += by
      out[name].maxBytes = Math.max(out[name].maxBytes, by)
      out[name].groups += new Set(p.names.map(groupOfAction)).size
      got[name] = new Set(p.names)
      out[name].avail += k.needs.every(a => p.names.includes(a))
    }
    for (const a of k.needs) {
      const c = out.perCap[a] || (out.perCap[a] = { n: 0, v1: 0, nlm1: 0 })
      c.n++; c.v1 += got.v1.has(a); c.nlm1 += got.nlm1.has(a)
    }
    if (k.needs.every(a => got.v1.has(a)) && !k.needs.every(a => got.nlm1.has(a))) out.regress.push(k.text)
  }
  return out
}
const pct = (x, n) => `${(100 * x / Math.max(1, n)).toFixed(1)}%`
function report(label, m) {
  if (!SHOW) return
  console.log(`METRICS ${label} n=${m.n}`)
  for (const r of ['v1', 'nlm1']) console.log(`METRICS ${label} ${r.padEnd(5)} own ${pct(m[r].own, m.n)}  fallback ${pct(m[r].fallback, m.n)}  availability ${pct(m[r].avail, m.n)}  avgCaps ${(m[r].caps / m.n).toFixed(1)}  avgGroups ${(m[r].groups / m.n).toFixed(1)}  avgManifestBytes ${Math.round(m[r].bytes / m.n)}  maxManifestBytes ${m[r].maxBytes}`)
  for (const [a, c] of Object.entries(m.perCap).sort()) if (c.v1 !== c.nlm1) console.log(`METRICS ${label} cap ${a.padEnd(28)} v1 ${pct(c.v1, c.n)} → nlm1 ${pct(c.nlm1, c.n)} (n=${c.n})`)
  for (const t of m.regress) console.log(`METRICS ${label} REGRESS ${JSON.stringify(t)}`)
}

const corpusCases = corpus.intents.flatMap(i => i.phrasings.map(p => ({ text: typeof p === 'string' ? p : p.text, needs: i.needs, recentActions: i.recentActions, board: i.board })))

describe('NLM-1 dev metrics (routing v2 vs v1)', () => {
  for (const [label, cases] of [['corpus', corpusCases], ['dev', dev.cases]]) {
    it(`${label}: own-groups ≥ 90%, availability ≥ v1, no capability below v1`, () => {
      if (globalThis.process?.env?.NLM1_TUNE) globalThis.__NLM1_TUNING__ = JSON.parse(globalThis.process.env.NLM1_TUNE)
      const m = metrics(cases)
      globalThis.__NLM1_TUNING__ = null
      report(label, m)
      expect(m.nlm1.own / m.n).toBeGreaterThanOrEqual(0.9)
      expect(m.nlm1.avail).toBeGreaterThanOrEqual(m.v1.avail)
      const worse = Object.entries(m.perCap).filter(([, c]) => c.nlm1 < c.v1).map(([a]) => a)
      expect(m.regress, 'messages v1 routed fully that nlm1 does not').toEqual([])
      expect(worse, `capabilities whose availability fell below v1 (${m.regress.join(' | ')})`).toEqual([])
    })
  }
})
