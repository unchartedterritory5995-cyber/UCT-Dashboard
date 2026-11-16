// ── D31 RESOLVER · OFFLINE SHADOW REPLAY over the generated suites + the oracle rows (AUDIT R2: test artefacts only) ────────
// Each case runs through the REAL rails (testing/rails.js: chart rail → state rail, as useAgent.railOf composes them) and through
// the shadow hook (shadow.js shadowRemoval on the rails' own plan — targetsOfPlan + worldFromHost, the product path). Classes:
//   A  the resolver asks / refuses where the rails allow (a candidate ADDED block — what P2 may enforce after AUDIT review)
//   B  the resolver resolves where a rail blocks (the resolver is looser — NEVER effective: compose keeps the rails' block, I7)
//   C  both block, a different kind (ask vs refuse)
// Asserted: B is never effective (the composed decision equals the rails' on every case), and every A case is one the policy
// blocks (no A case lands where the policy resolves). RESOLVER_REPORT=1 prints the counts; RESOLVER_REPLAY_OUT=<file> writes them.
import { describe, it, expect, afterAll } from 'vitest'
import { registerBuiltins } from '../builtins'
import { pickedChoice } from '../deixis'
import { POLICY } from './policy'
import { compose } from './resolve'
import { shadowRemoval, setShadowSink } from './shadow'
import { worldFromHost } from './world'
import { boardHost, hostOf, worldOfRow, mapRef } from './testing/oracleWorld'
import { matrixCases, metamorphicCases, sequenceRuns } from './testing/generate'
import { railOutcome } from './testing/rails'

registerBuiltins()

const HOSTS = new Map()
function hostFor(world) {
  const syms = world.charts.map(c => c.symbol)
  const rsiOn = [...new Set((world.indicators || []).map(i => i.chart))]
  const key = JSON.stringify([syms, rsiOn])
  if (!HOSTS.has(key)) HOSTS.set(key, boardHost(syms, { rsiOn }))
  const h = HOSTS.get(key)
  return { ...h, charts: { ...h.charts, selected: () => world.selection ?? null, canManageIndicators: () => true, canCreateIndicator: () => true, previewHost: () => null } }
}
// a generated typed id → the host's (an indicator by its chart: the RSI there)
const hostId = (hw, id) => (String(id).startsWith('ind:') ? hw.indicators.find(i => i.chart === String(id).split(':')[1] && i.defId === 'rsi')?.id || id : id)

const tally = { cases: 0, agree: 0, A: [], B: [], C: [], skipped: 0 }
const records = []
async function replay(c, { host, hw, plan, previous, carried, expect: want }) {
  const picked = (() => {
    if (!hw.offers || hw.offers.stale) return null
    const choices = hw.offers.refs.map(ref => ({ ref, label: `the ${hw.charts.find(x => x.ref === ref)?.symbol} chart` }))
    const p = pickedChoice(c.words, choices)
    return p ? new Set([`chart:${p}`]) : null
  })()
  const rails = await railOutcome(host, hw, plan, { words: c.words, carried, subject: hw.subject, previous, picked })
  if (!rails.plan?.ok) { tally.skipped++; return }
  let rec = null
  const was = setShadowSink((r) => { rec = r })
  try {
    shadowRemoval({ plan: rails.plan, words: carried ? `${carried} . ${c.words}` : c.words, host, subject: hw.subject, previous, picked,
      rails: { text: rails.text, ask: rails.verdict === 'ask' } })
  } finally { setShadowSink(was) }
  tally.cases++
  if (!rec) { tally.skipped++; return }
  records.push(rec)
  // I7: in shadow the composed decision is the rails' own, always
  expect(compose(rails.text, { family: rec.family, verdict: rec.verdict, reason: rec.reason }).text).toBe(rails.text)
  const row = { id: c.id || c.cmd, words: c.words, plan: plan.join('+'), rails: rails.verdict, resolver: rec.verdict, reason: rec.reason, policy: want, railText: rails.text ? String(rails.text).slice(0, 90) : null }
  if (!rec.cls) tally.agree++
  else tally[rec.cls].push(row)
}

describe('OFFLINE SHADOW REPLAY · oracle rows + generated suites through the rails and the shadow hook', () => {
  it('oracle rows', async () => {
    for (const r of POLICY) {
      if (r.context.world === 'ST') continue                     // (the state fixture's drawings live in a module store: the oracle runner covers ST)
      const host0 = hostOf(r.context.world)
      const host = { ...host0, charts: { ...host0.charts, selected: () => r.context.selection, canManageIndicators: () => true, canCreateIndicator: () => true, previewHost: () => null } }
      const hw = worldOfRow(r.context, mapRef)
      const live = r.context.offers && !r.context.offers.stale
      await replay({ id: r.id, words: r.words }, { host, hw, plan: r.plan.split('+').map(p => mapRef(hw, p)), previous: hw.previous, carried: live ? r.context.offers.carried : null, expect: r.overAsk ? r.policy : r.expect })
    }
  }, 120000)
  for (const [name, cases] of [['matrix', () => matrixCases(31)], ['metamorphic', () => metamorphicCases(32)],
    ['sequences', () => sequenceRuns(33).flatMap(run => run.steps.filter(s => s.plan).map((s, i) => ({ ...s, id: `seq-${run.seed}-${i}` })))]]) {
    it(name, async () => {
      for (const c of cases()) {
        const host = hostFor(c.world)
        const hw = worldFromHost(host, { selection: c.world.selection, subject: c.world.subject })
        hw.offers = c.world.offers
        const previous = c.world.previous ? hostId(hw, c.world.previous) : null
        await replay(c, { host, hw, plan: c.plan.map(id => hostId(hw, id)), previous, carried: c.carried || (c.world.offers && !c.world.offers.stale ? c.world.offers.carried : null), expect: c.expect })
      }
    }, 300000)
  }
  it('B (resolver looser than a rail) is never effective; every A case is one the policy blocks', () => {
    expect(tally.cases).toBeGreaterThan(1500)
    expect(tally.A.filter(a => /^resolved/.test(String(a.policy)))).toEqual([])
  })
})

afterAll(async () => {
  const group = (xs) => Object.entries(xs.reduce((m, x) => { const k = `${x.rails}→${x.resolver} (${x.reason})`; (m[k] ||= []).push(x); return m }, {})).map(([k, v]) => `  ${k}: ${v.length} · e.g. ${v.slice(0, 3).map(x => `${x.id} "${x.words}" plan ${x.plan}${x.railText ? ` · rail: ${x.railText}` : ''}`).join(' | ')}`)
  const report = [`SHADOW REPLAY: cases ${tally.cases} · agree ${tally.agree} · A ${tally.A.length} · B ${tally.B.length} · C ${tally.C.length} · skipped ${tally.skipped}`,
    'A (resolver blocks, rails allow):', ...group(tally.A), 'B (resolver resolves, a rail blocks — never effective):', ...group(tally.B), 'C (both block, kind differs):', ...group(tally.C)].join('\n')
  if (globalThis.process?.env?.RESOLVER_REPORT) console.log(report)
  if (globalThis.process?.env?.RESOLVER_REPLAY_OUT) { const fs = await import('node:fs'); fs.writeFileSync(globalThis.process?.env?.RESOLVER_REPLAY_OUT, JSON.stringify({ tally: { cases: tally.cases, agree: tally.agree, A: tally.A, B: tally.B, C: tally.C, skipped: tally.skipped } }, null, 1)) }
})
