// ── D31 RESOLVER · CORE checks: the type table's completeness rail, the enforce enum, I7 composition, the shadow hook's
// swallow + no-leak record, and the perf budget (pure function, a few ms per plan across the generated suites) ───────────────
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { registerBuiltins } from '../builtins'
import { allCapabilityNames, getCapability } from '../capabilities'
import { RAIL_KINDS } from '../chartRail'
import { STATE_KINDS } from '../stateRail'
import { REF_TYPES, REFERENT_TYPES, untypedCapabilities, typeOfNoun, typeOfId } from './referentTypes'
import { MODES, ENFORCE, modeOf } from './enforce'
import { resolve, compose, decideTarget } from './resolve'
import { shadowRemoval, setShadowSink } from './shadow'
import { boardWorld, matrixCases, metamorphicCases, sequenceRuns } from './testing/generate'
import { boardHost } from './testing/oracleWorld'
import { planOf, opOf } from './testing/rails'
import { worldFromHost } from './world'

registerBuiltins()

describe('REFERENT TYPE TABLE · completeness rail (design §2)', () => {
  it('every destructive or rail-read capability’s target kind has a row', () => {
    const caps = allCapabilityNames().map(n => ({ name: n, ...getCapability(n) }))
    expect(untypedCapabilities(caps, [...RAIL_KINDS, ...STATE_KINDS])).toEqual([])
  })
  it('the rail fails a destructive capability that lacks a type', () => {
    const fake = [{ name: 'fake.destroy', target: 'noSuchKind', risk: 'confirm', reversible: false }, { name: 'fake.read', target: 'other', risk: 'local', reversible: true }]
    expect(untypedCapabilities(fake, [])).toEqual([{ capability: 'fake.destroy', kind: 'noSuchKind' }])
  })
  it('every rail kind (chart rail ∪ state rail) has a row, and every row names known types', () => {
    for (const k of [...RAIL_KINDS, ...STATE_KINDS]) expect(REFERENT_TYPES[k], k).toBeTruthy()
    for (const row of Object.values(REFERENT_TYPES)) for (const t of row.types) expect(REF_TYPES).toContain(t)
  })
  it('nouns type by the imported vocabularies', () => {
    expect(['RSI', 'the moving average', 'trendline', 'the horizontal line', 'my alerts', 'my Tech list', 'the drawing board', 'the SPY chart'].map(typeOfNoun))
      .toEqual(['indicator', 'indicator', 'drawing', 'drawing', 'alert', 'list', 'drawingBoard', 'chart'])
    expect(['chart:c1', 'ind:c1:x', 'draw:SPY:d', 'list:wl1', 'item:wl1:SPY'].map(typeOfId)).toEqual(['chart', 'indicator', 'drawing', 'list', 'list'])
  })
})

describe('ENFORCE · a code constant; no value licenses (I7)', () => {
  it('modes are shadow | add only; P1 is all shadow', () => {
    expect([...MODES]).toEqual(['shadow', 'add'])
    expect(Object.isFrozen(ENFORCE) && Object.isFrozen(MODES)).toBe(true)
    for (const f of Object.keys(ENFORCE)) expect(ENFORCE[f]).toBe('shadow')
    expect(modeOf('removal')).toBe('shadow')
    expect(modeOf('unknown')).toBe('shadow')
  })
})

describe('COMPOSITION (I7) · most restrictive, never a licence', () => {
  const rz = (verdict) => ({ family: 'removal', verdict, reason: verdict === 'resolved' ? 'named' : 'plan-outside-words' })
  it('shadow: the rails decide, whatever the resolver says', () => {
    for (const rail of [null, 'refused', 'asked']) for (const v of ['resolved', 'ask', 'refuse', 'abstain']) expect(compose(rail, rz(v)).text).toBe(rail)
  })
  it('add: the resolver only ADDS a block where both rails allowed; a rail block is never turned into an apply', () => {
    for (const v of ['resolved', 'ask', 'refuse', 'abstain']) expect(compose('rail refused', rz(v), 'add').text).toBe('rail refused')
    expect(compose(null, rz('refuse'), 'add').by).toBe('resolver')
    expect(compose(null, rz('ask'), 'add').by).toBe('resolver')
    expect(compose(null, rz('resolved'), 'add').text).toBe(null)
    expect(compose(null, rz('abstain'), 'add').text).toBe(null)
  })
  it('an unknown mode (e.g. a would-be "license") is the rails’ decision', () => {
    expect(compose(null, rz('refuse'), 'license').text).toBe(null)
    expect(compose('rail refused', rz('resolved'), 'license').text).toBe('rail refused')
  })
})

describe('INVARIANTS · decideTarget on hand-built readings', () => {
  const R = (groups, extra = {}) => ({ groups, negated: new Set(extra.negated || []), anchors: new Set(extra.anchors || []) })
  const t = { type: 'chart', id: 'chart:c1' }
  it('I1 the plan never licenses itself; I3 type; I5 negated; I6 anchor; I2 ambiguous asks', () => {
    expect(decideTarget(t, R([])).reason).toBe('plan-outside-words')
    expect(decideTarget(t, R([{ type: 'indicator', refs: ['ind:c1:x'], source: 'named' }])).reason).toBe('type-mismatch')
    expect(decideTarget(t, R([{ type: 'chart', refs: ['chart:c1'], source: 'named' }], { negated: ['chart:c1'] })).reason).toBe('negated-target')
    expect(decideTarget(t, R([{ type: 'chart', refs: ['chart:c1'], source: 'relation' }], { anchors: ['chart:c1'] })).reason).toBe('anchor-as-target')
    expect(decideTarget(t, R([{ type: 'chart', refs: ['chart:c1', 'chart:c2'], source: 'pointer', ask: 'ambiguous-n' }])).verdict).toBe('ask')
    expect(decideTarget(t, R([{ type: 'chart', refs: ['chart:c2'], source: 'named' }])).reason).toBe('plan-outside-words')
    expect(decideTarget(t, R([{ type: 'chart', refs: ['chart:c1'], source: 'named' }])).verdict).toBe('resolved')
  })
  it('a plan with no destroying target abstains', () => {
    expect(resolve({ words: { typed: 'close it' }, planTargets: [], world: boardWorld(['SPY']) }).verdict).toBe('abstain')
  })
})

describe('SHADOW HOOK · swallow (R4), no-leak record (I10), no production sink (R2)', () => {
  const host = boardHost(['SPY', 'QQQ', 'IWM'])
  const h = { ...host, charts: { ...host.charts, selected: () => null } }
  it('a resolver that throws: the hook returns null and never throws', async () => {
    const plan = await planOf(h, [opOf('chart:c2', worldFromHost(h))])
    expect(plan.ok).toBe(true)
    expect(() => shadowRemoval({ plan, words: 'close it', host: h, rails: { text: null } }, { resolveFn: () => { throw new Error('boom') } })).not.toThrow()
    expect(shadowRemoval({ plan, words: 'close it', host: h, rails: { text: null } }, { resolveFn: () => { throw new Error('boom') } })).toBe(null)
    // a broken host / plan never throws either
    expect(shadowRemoval({ plan: null, words: null, host: null })).toBe(null)
    expect(() => shadowRemoval({ plan, words: 'close it', host: { charts: { list: () => { throw new Error('x') } } } })).not.toThrow()
  })
  it('a sink that throws never breaks the hook; the record carries no words, tickers or ids', async () => {
    const plan = await planOf(h, [opOf('chart:c2', worldFromHost(h))])
    const was = setShadowSink(() => { throw new Error('sink') })
    let rec
    try { rec = shadowRemoval({ plan, words: 'close the IWM chart', host: h, rails: { text: null } }) } finally { setShadowSink(was) }
    expect(rec).toMatchObject({ family: 'removal', mode: 'shadow', verdict: 'refuse', reason: 'plan-outside-words', rail: 'allow', cls: 'A', targets: 1, types: ['chart'] })
    const s = JSON.stringify(rec)
    for (const leak of ['IWM', 'QQQ', 'SPY', 'c2', 'close', 'chart:']) expect(s.includes(leak), leak).toBe(false)
  })
  it('the product installs no sink and the module has no network / storage / telemetry path', () => {
    const src = ['shadow.js', 'resolve.js', 'world.js', 'enforce.js', 'referentTypes.js', 'families/removal.js'].map(f => readFileSync(`src/agent/resolver/${f}`, 'utf8')).join('\n')
    expect(src).not.toMatch(/\bfetch\(|XMLHttpRequest|sendBeacon|localStorage|sessionStorage|\brecord\(|telemetry\s*:|\/api\//)
    const ua = readFileSync('src/agent/useAgent.js', 'utf8')
    expect(ua).not.toMatch(/setShadowSink/)
    expect(ua).toMatch(/try \{ shadowRemoval\(\{[^\n]*\} catch \{/)
  })
})

describe('PERF BUDGET · pure function, a few ms per plan', () => {
  it('the generated suites resolve at ≤ 3 ms per plan on average, ≤ 50 ms worst', () => {
    const cases = [...matrixCases(31), ...metamorphicCases(32), ...sequenceRuns(33).flatMap(r => r.steps.filter(s => s.plan))]
    for (const c of cases.slice(0, 50)) resolve({ words: { typed: c.words, carried: c.carried || null }, planTargets: c.plan, world: c.world })   // warm
    let worst = 0
    const t0 = performance.now()
    for (const c of cases) {
      const a = performance.now()
      resolve({ words: { typed: c.words, carried: c.carried || null }, planTargets: c.plan, world: c.world })
      worst = Math.max(worst, performance.now() - a)
    }
    const per = (performance.now() - t0) / cases.length
    if (globalThis.process?.env?.RESOLVER_REPORT) console.log(`PERF: ${cases.length} plans · ${per.toFixed(3)} ms/plan · worst ${worst.toFixed(2)} ms`)
    expect(per).toBeLessThanOrEqual(3)
    expect(worst).toBeLessThanOrEqual(50)
  })
})
