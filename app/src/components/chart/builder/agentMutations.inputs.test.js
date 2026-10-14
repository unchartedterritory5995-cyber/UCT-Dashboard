// app/src/components/chart/builder/agentMutations.inputs.test.js
//
// ⭐⭐ AGENT PHASE 2.5 SEAM — "ADD A 20 EMA": an `add` that carries the settings it was
// asked for (`agentMutations.addWithInputs`), through the canonical writers only
// (`addInstance`, then `checkInstanceInput` + `setInstanceInput` — the settings
// dialog's own validation and writer). Real registry, real settings, the store's JSON
// round trip as the persist, plan → apply → confirm → Undo as the Agent runs it.
import { describe, it, expect } from 'vitest'
import * as registry from '../engine/nativeRegistry'
import { mergeChartSettings } from '../chartDefaults'
import { addInstance, setInstanceInput, findInstance, checkInstanceInput } from '../engine/instanceControls'
import { adoptOverlayAverages } from '../maAdoption'
import { catalogRows } from '../indicatorCatalog'
import {
  REASONS, planIndicatorMutation, applyIndicatorMutation, confirmIndicatorMutation, undoIndicatorMutation,
} from './agentMutations'

const view = (cs) => adoptOverlayAverages(cs) || cs
const json = (v) => JSON.parse(JSON.stringify(v))
const ctx = (over = {}) => ({ canManage: true, ownedDefinitionIds: [], registry, chartId: 'c1', ...over })
const chart = () => view(mergeChartSettings(JSON.stringify(mergeChartSettings(null))))
function run(cs, request, c = ctx()) {
  const p = planIndicatorMutation(cs, request, c)
  expect(p.ok, JSON.stringify(p)).toBe(true)
  const a = applyIndicatorMutation(cs, p.plan, c)
  expect(a.ok, JSON.stringify(a)).toBe(true)
  const persisted = json(a.cs)
  const done = confirmIndicatorMutation(persisted, a.pending, c)
  expect(done.status).toBe('confirmed')
  return { plan: p.plan, cs: persisted, receipt: done.receipt, undo: done.undo, pending: a.pending }
}
const newInst = (before, after, defId) => {
  const ids = new Set((before.indicatorInstances || []).map((i) => i.instanceId))
  return (after.indicatorInstances || []).find((i) => i.defId === defId && !ids.has(i.instanceId))
}

describe('⭐⭐ the acceptance examples', () => {
  it('"Add a 20 EMA" → movingAverage {period: 20, maType: ema}, verified, receipt and preview name it', () => {
    const cs = chart()
    const r = run(cs, { op: 'add', defId: 'movingAverage', inputs: { period: 20, maType: 'ema' } })
    const inst = newInst(cs, r.cs, 'movingAverage')
    expect(inst.inputs).toMatchObject({ period: 20, maType: 'ema' })
    expect(r.receipt.inputs).toEqual({ period: 20, maType: 'ema' })
    expect(r.plan.preview.inputs).toEqual({ period: 20, maType: 'ema' })
    expect(r.plan.preview.name).toMatch(/20/)
    // the read-back record proves each value: the instance list it must find on read-back
    // holds the new instance WITH its settings, so a confirmation is a proof they landed
    const rec = r.pending.record.paths.find((p) => JSON.stringify(p.path) === '["indicatorInstances"]')
    const after = rec.after.find((i) => i.instanceId === r.receipt.instanceIds[0])
    expect(after.inputs).toMatchObject({ period: 20, maType: 'ema' })
    // …and a read-back WITHOUT them is not a confirmation
    const tampered = json(r.cs)
    tampered.indicatorInstances.find((i) => i.instanceId === r.receipt.instanceIds[0]).inputs.period = 5
    expect(confirmIndicatorMutation(tampered, r.pending, ctx()).status).toBe(REASONS.NOT_LANDED)
  })

  it('"Add RSI with a length of 7" → rsi {period: 7}', () => {
    const cs = chart()
    const r = run(cs, { op: 'add', defId: 'rsi', inputs: { period: 7 } })
    expect(newInst(cs, r.cs, 'rsi').inputs.period).toBe(7)
    expect(r.receipt.inputs).toEqual({ period: 7 })
  })

  it('"Add a 200-period simple moving average" → movingAverage {period: 200, maType: sma}', () => {
    const cs = chart()
    const r = run(cs, { op: 'add', defId: 'movingAverage', inputs: { period: 200, maType: 'sma' } })
    expect(newInst(cs, r.cs, 'movingAverage').inputs).toMatchObject({ period: 200, maType: 'sma' })
  })

  it('several settings at once (MACD 8/21/5) — all land, one receipt', () => {
    const cs = chart()
    const r = run(cs, { op: 'add', defId: 'macd', inputs: { fastPeriod: 8, slowPeriod: 21, signalPeriod: 5 } })
    expect(newInst(cs, r.cs, 'macd').inputs).toMatchObject({ fastPeriod: 8, slowPeriod: 21, signalPeriod: 5 })
    expect(r.receipt.inputs).toEqual({ fastPeriod: 8, slowPeriod: 21, signalPeriod: 5 })
  })

  it('"Add RSI" → the default behaviour, byte for byte (no inputs, no `inputs` on the receipt)', () => {
    const cs = chart()
    const r = run(cs, { op: 'add', defId: 'rsi' })
    expect(r.cs).toEqual(json(addInstance(cs, 'rsi', registry)))
    expect(r.receipt.inputs).toBeUndefined()
    expect(r.plan.args.inputs).toBeUndefined()
  })

  it('the stored settings EQUAL the settings dialog\'s own writes (addInstance → setInstanceInput)', () => {
    const cs = chart()
    const r = run(cs, { op: 'add', defId: 'movingAverage', inputs: { period: 20, maType: 'ema' } })
    let ui = addInstance(cs, 'movingAverage', registry)
    const id = newInst(cs, ui, 'movingAverage').instanceId
    ui = setInstanceInput(ui, id, 'period', 20, registry)
    ui = setInstanceInput(ui, id, 'maType', 'ema', registry)
    expect(r.cs).toEqual(json(ui))
  })
})

describe('⛔ a bad setting is refused BY NAME, and nothing is created', () => {
  const cases = [
    ['an out-of-range period (EMA 0)', 'movingAverage', { period: 0 }, /period/],
    ['a period past the maximum (EMA 501)', 'movingAverage', { period: 501 }, /period/],
    ['a fractional length (RSI 7.5)', 'rsi', { period: 7.5 }, /whole number/],
    ['an unknown setting', 'rsi', { length: 7 }, /no setting "length"/],
    ['an option the indicator does not offer', 'movingAverage', { period: 20, maType: 'zlema-ish' }, /maType/],
    ['text where a number is declared', 'rsi', { period: 'seven' }, /whole number/],
  ]
  for (const [name, defId, inputs, why] of cases) {
    it(name, () => {
      const cs = chart()
      const p = planIndicatorMutation(cs, { op: 'add', defId, inputs }, ctx())
      expect(p.ok).toBe(false)
      expect(p.reason).toBe(REASONS.BAD_INPUT)
      expect(p.detail.why).toMatch(why)
      expect(typeof p.detail.key).toBe('string')
    })
  }
  it('the refusal carries the declared input (type, range) so the answer can say what IS allowed', () => {
    const p = planIndicatorMutation(chart(), { op: 'add', defId: 'movingAverage', inputs: { period: 0 } }, ctx())
    expect(p.detail.input).toMatchObject({ key: 'period', type: 'int', min: 1, max: 500, default: 5 })
  })
  it('a plan whose inputs were tampered with between plan and apply is refused at apply, nothing written', () => {
    const cs = chart()
    const p = planIndicatorMutation(cs, { op: 'add', defId: 'rsi', inputs: { period: 7 } }, ctx())
    const bad = json(p.plan); bad.args.inputs.period = 1000
    const a = applyIndicatorMutation(cs, bad, ctx())
    expect(a).toMatchObject({ ok: false, reason: REASONS.BAD_INPUT })
  })
})

describe('⭐ save, reload, Undo', () => {
  it('reloaded (the store\'s JSON + merge), the instance still carries the values', () => {
    const r = run(chart(), { op: 'add', defId: 'rsi', inputs: { period: 7 } })
    const reloaded = view(mergeChartSettings(JSON.stringify(r.cs)))
    const inst = reloaded.indicatorInstances.find((i) => i.instanceId === r.receipt.instanceIds[0])
    expect(inst.inputs.period).toBe(7)
  })
  it('Undo of a configured add removes the instance exactly — one Undo for the whole request', () => {
    const cs = chart()
    const r = run(cs, { op: 'add', defId: 'movingAverage', inputs: { period: 20, maType: 'ema' } })
    const u = undoIndicatorMutation(r.cs, r.undo, ctx())
    expect(u.ok).toBe(true)
    const done = confirmIndicatorMutation(json(u.cs), u.pending, ctx())
    expect(done.status).toBe('confirmed')
    expect(findInstance(json(u.cs), r.receipt.instanceIds[0])).toBeFalsy()
  })
})

describe('⭐ discovery: the catalog exposes each definition\'s declared inputs', () => {
  it('Moving Average lists period (1..500), maType (its options) and their defaults', () => {
    const row = catalogRows(registry).find((r) => r.id === 'movingAverage')
    const period = row.inputs.find((i) => i.key === 'period')
    expect(period).toMatchObject({ type: 'int', default: 5, min: 1, max: 500 })
    const ma = row.inputs.find((i) => i.key === 'maType')
    expect(ma.type).toBe('enum')
    expect(ma.options.map((o) => o.value)).toContain('ema')
    expect(ma.options.every((o) => typeof o.label === 'string')).toBe(true)
  })
  it('checkInstanceInput is the dialog\'s rule: setInstanceInput writes exactly what it admits', () => {
    const def = registry.getDefinition('rsi')
    for (const v of [7, '7', 7.5, 1, 1000, 'x']) {
      const checked = checkInstanceInput(def, 'period', v)
      let cs = addInstance(chart(), 'rsi', registry)
      const id = cs.indicatorInstances.find((i) => i.defId === 'rsi').instanceId
      const before = findInstance(cs, id).inputs.period
      cs = setInstanceInput(cs, id, 'period', v, registry)
      expect(findInstance(cs, id).inputs.period, String(v)).toBe(checked.ok ? checked.value : before)
    }
  })
})
