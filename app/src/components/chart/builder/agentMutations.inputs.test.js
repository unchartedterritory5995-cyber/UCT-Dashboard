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


// ═══ ⭐ GATE C — `setInputs`: edit ONE live instance's inputs in place ("make it a 9", "change that to an
// SMA"), through the settings rows' own two doors, exact Undo. Drafted by Agent for Indicators' review. ═══
describe('⭐ setInputs — in-place edit through the canonical writers', () => {
  const ema20 = () => { const cs = chart(); return { cs, id: 'ovl:1' } }             // the default chart's EMA 20
  const instOf = (cs, id) => findInstance(cs, id)

  it('"make it a 9" → period 9 in place: same instance, maType kept, receipt and preview name it', () => {
    const { cs, id } = ema20()
    const r = run(cs, { op: 'setInputs', instanceId: id, inputs: { period: 9 } })
    expect(instOf(r.cs, id).inputs).toMatchObject({ period: 9, maType: 'ema' })
    expect((r.cs.indicatorInstances || []).length).toBe((cs.indicatorInstances || []).length)   // no new instance
    expect(r.receipt.inputs).toEqual({ before: { period: 20 }, after: { period: 9 } })
    expect(r.plan.preview.inputs).toEqual({ before: { period: 20 }, after: { period: 9 } })
    expect(r.plan.preview.nameAfter).toMatch(/9/)
    expect(r.plan.target.ids).toEqual([id])                                         // per instance
  })

  it('"change that to an SMA" → maType sma; the name is the legend own, read after the change', () => {
    const { cs, id } = ema20()
    const r = run(cs, { op: 'setInputs', instanceId: id, inputs: { maType: 'sma' } })
    expect(instOf(r.cs, id).inputs).toMatchObject({ period: 20, maType: 'sma' })
    expect(r.plan.preview.name).not.toBe(r.plan.preview.nameAfter)
    expect(r.receipt.name).toBe(r.plan.preview.nameAfter)
  })

  it('partial edit: MACD fast only — slow and signal untouched', () => {
    const cs0 = chart()
    const added = run(cs0, { op: 'add', defId: 'macd' })
    const id = added.receipt.instanceIds[0]
    const before = instOf(added.cs, id).inputs || {}
    const r = run(added.cs, { op: 'setInputs', instanceId: id, inputs: { fastPeriod: 8 } })
    const after = instOf(r.cs, id).inputs
    expect(after.fastPeriod).toBe(8)
    expect(after.slowPeriod).toBe(before.slowPeriod)
    expect(after.signalPeriod).toBe(before.signalPeriod)
  })

  it('every enum input refuses a value outside its options (bad-input names the key); never partial', () => {
    const rows = catalogRows(registry).filter((row) => (row.inputs || []).some((i) => Array.isArray(i.options)))
    expect(rows.length).toBeGreaterThan(0)
    let checked = 0
    for (const row of rows) {
      const cs0 = chart()
      const cs = addInstance(cs0, row.id, registry)
      const inst = (cs.indicatorInstances || []).find((i) => i.defId === row.id && !(cs0.indicatorInstances || []).some((x) => x.instanceId === i.instanceId))
      if (!inst) continue                                                            // a definition addInstance does not add
      for (const spec of row.inputs.filter((i) => Array.isArray(i.options))) {
        const p = planIndicatorMutation(cs, { op: 'setInputs', instanceId: inst.instanceId, inputs: { [spec.key]: '__not_an_option__' } }, ctx())
        expect(p.ok, `${row.id}.${spec.key}`).toBe(false)
        expect(p.reason).toBe(REASONS.BAD_INPUT)
        expect(p.detail.key).toBe(spec.key)
        checked += 1
      }
    }
    expect(checked).toBeGreaterThan(3)
    // one good key + one bad key → refused whole, nothing written
    const { cs, id } = ema20()
    const p = planIndicatorMutation(cs, { op: 'setInputs', instanceId: id, inputs: { period: 9, maType: 'nope' } }, ctx())
    expect(p).toMatchObject({ ok: false, reason: REASONS.BAD_INPUT })
    expect(p.detail.key).toBe('maType')
  })

  it('out of range, wrong type and unknown keys refuse with the input spec', () => {
    const { cs, id } = ema20()
    for (const bad of [{ period: 0 }, { period: 100000 }, { period: 7.5 }, { period: 'nine' }, { length: 9 }]) {
      const p = planIndicatorMutation(cs, { op: 'setInputs', instanceId: id, inputs: bad }, ctx())
      expect(p.ok, JSON.stringify(bad)).toBe(false)
      expect(p.reason).toBe(REASONS.BAD_INPUT)
    }
    expect(planIndicatorMutation(cs, { op: 'setInputs', instanceId: id, inputs: {} }, ctx()).reason).toBe(REASONS.BAD_REQUEST)
  })

  it('already that value → no-change ("Already 9"); an unknown instance → not-found', () => {
    const { cs, id } = ema20()
    expect(planIndicatorMutation(cs, { op: 'setInputs', instanceId: id, inputs: { period: 20 } }, ctx()).reason).toBe(REASONS.NO_CHANGE)
    expect(planIndicatorMutation(cs, { op: 'setInputs', instanceId: 'inst:nope:9', inputs: { period: 9 } }, ctx()).reason).toBe(REASONS.NOT_FOUND)
  })

  it('a hidden instance stays hidden after an edit (visibility untouched)', () => {
    const { cs: cs0, id } = ema20()
    const hid = run(cs0, { op: 'setVisible', instanceId: id, visible: false })
    const before = instOf(hid.cs, id)
    const r = run(hid.cs, { op: 'setInputs', instanceId: id, inputs: { period: 9 } })
    const after = instOf(r.cs, id)
    expect(after.hidden).toBe(true)
    expect(after.hiddenVia).toEqual(before.hiddenVia)
  })

  it('legacy vs user-added routing: legacy:<defId> keeps the cs.indicators mirror in step; inst: does not touch it', () => {
    const legacy = view(mergeChartSettings(JSON.stringify({ indicators: { rsi: { enabled: true, period: 14, color: '#7b68ee' } },
      indicatorInstances: [{ instanceId: 'legacy:rsi', defId: 'rsi', defVersion: 1, inputs: { period: 14, color: '#7b68ee' }, placement: { target: 'pane' }, hidden: false }] })))
    const lid = (legacy.indicatorInstances || []).find((i) => i.defId === 'rsi')?.instanceId
    expect(lid).toMatch(/^legacy:/)
    const r = run(legacy, { op: 'setInputs', instanceId: lid, inputs: { period: 7 } })
    expect(instOf(r.cs, lid).inputs.period).toBe(7)
    expect(r.cs.indicators.rsi.period).toBe(7)                                    // the mirror moved with it
    const added = run(chart(), { op: 'add', defId: 'rsi' })
    const iid = added.receipt.instanceIds[0]
    expect(iid).toMatch(/^inst:/)
    const mirrorBefore = json(added.cs.indicators || {})
    const r2 = run(added.cs, { op: 'setInputs', instanceId: iid, inputs: { period: 3 } })
    expect(instOf(r2.cs, iid).inputs.period).toBe(3)
    expect(r2.cs.indicators || {}).toEqual(mirrorBefore)                           // per-instance door: mirror untouched
  })

  it('Undo is byte-exact after the persisted read; a later edit makes it refuse (stale fingerprint)', () => {
    const { cs, id } = ema20()
    const persisted0 = json(cs)
    const r = run(cs, { op: 'setInputs', instanceId: id, inputs: { period: 9, maType: 'sma' } })
    const u = undoIndicatorMutation(r.cs, r.undo, ctx())
    expect(u.ok).toBe(true)
    const back = json(u.cs)
    expect(confirmIndicatorMutation(back, u.pending, ctx()).status).toBe('confirmed')
    expect(mergeChartSettings(JSON.stringify(back))).toEqual(mergeChartSettings(JSON.stringify(persisted0)))
    // stale: the member changed it again by hand → Undo refuses, nothing written
    const r2 = run(cs, { op: 'setInputs', instanceId: id, inputs: { period: 9 } })
    const moved = json(setInstanceInput(r2.cs, id, 'period', 12, registry))
    expect(undoIndicatorMutation(moved, r2.undo, ctx())).toMatchObject({ ok: false, reason: REASONS.RESTORE_CONFLICT })
    expect(r2.undo.record.granularity).toBeUndefined()                              // Agent records never carry it
  })

  it('apply refuses if the instance changed between plan and apply (pinned fingerprint)', () => {
    const { cs, id } = ema20()
    const p = planIndicatorMutation(cs, { op: 'setInputs', instanceId: id, inputs: { period: 9 } }, ctx())
    const moved = setInstanceInput(cs, id, 'period', 30, registry)
    expect(applyIndicatorMutation(moved, p.plan, ctx())).toMatchObject({ ok: false, reason: REASONS.CHANGED_WHILE_WORKING })
  })

  it('permission: a read-only chart refuses; access lost between plan and apply refuses', () => {
    const { cs, id } = ema20()
    expect(planIndicatorMutation(cs, { op: 'setInputs', instanceId: id, inputs: { period: 9 } }, ctx({ canManage: false })).reason).toBe(REASONS.READONLY)
    const p = planIndicatorMutation(cs, { op: 'setInputs', instanceId: id, inputs: { period: 9 } }, ctx())
    expect(applyIndicatorMutation(cs, p.plan, ctx({ canManage: false }))).toMatchObject({ ok: false, reason: REASONS.PERMISSION_CHANGED })
  })
})
