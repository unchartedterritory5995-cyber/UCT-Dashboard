// app/src/components/chart/builder/agentMutations.calcTimeframe.test.js — `setCalculationTimeframe`, Indicators half
//
// The Agent's "weekly RSI on this daily chart": the Inspector's "Timeframe" select (which bars COMPUTE the instance),
// through its own writer `setInstanceCalculationTimeframe`. Proved byte-for-byte against that writer, ONE leaf written
// (never `visibility`, never anything chart-level), every capability refusal said with the product's own reason (the
// writer itself refuses SILENTLY — `cs` back unchanged), lower / straddling frames refused with the select's own note,
// confirmed from a read-back, undone exactly (absent key included) and refused when stale. Real registry, no mocks.
import { describe, it, expect } from 'vitest'
import * as registry from '../engine/nativeRegistry'
import { mergeChartSettings } from '../chartDefaults'
import { withInstances, setInstanceCalculationTimeframe, findInstance } from '../engine/instanceControls'
import { CAPABILITY_WORDS } from '../engine/calcTimeframeCapability'
import { adoptOverlayAverages } from '../maAdoption'
import {
  REASONS, STYLE_OPS, planIndicatorMutation, applyIndicatorMutation, confirmIndicatorMutation, undoIndicatorMutation,
} from './agentMutations'

const view = (cs) => adoptOverlayAverages(cs) || cs
const json = (v) => JSON.parse(JSON.stringify(v))
const load = (cs) => view(mergeChartSettings(JSON.stringify(cs)))
const VOL = { volumeSeparatePane: true, blankVolume: false }
const ctx = (over = {}) => ({ canManage: true, ownedDefinitionIds: [], registry, chartId: 'c1', volumeOpts: VOL, ...over })

/** RSI, a second RSI, an EMA OF RSI (inherits), an SMA 50 on price, plus whatever a case adds. */
function chart(extra = []) {
  const base = mergeChartSettings(null)
  const raw = load({
    ...base,
    indicatorInstances: [
      ...(base.indicatorInstances || []),
      { instanceId: 'inst:rsi:1', defId: 'rsi', inputs: { period: 14 }, hidden: false },
      { instanceId: 'inst:rsi:2', defId: 'rsi', inputs: { period: 7 }, hidden: false },
      { instanceId: 'inst:movingAverage:9', defId: 'movingAverage', inputs: { source: '@inst:rsi:1::rsi', period: 9, maType: 'ema' }, hidden: false },
      ...extra,
    ],
    indicators: { ...(base.indicators || {}), rsi: { enabled: true } },
  })
  return load(withInstances(raw, raw.indicatorInstances, registry))
}
const req = (instanceId, timeframe, chartTf = 'D') => ({ op: 'setCalculationTimeframe', instanceId, timeframe, chartTf })
function run(cs, request, c = ctx()) {
  const p = planIndicatorMutation(cs, request, c)
  expect(p.ok, JSON.stringify(p)).toBe(true)
  const a = applyIndicatorMutation(cs, p.plan, c)
  expect(a.ok, JSON.stringify(a)).toBe(true)
  const persisted = json(a.cs)
  const done = confirmIndicatorMutation(persisted, a.pending, c)
  expect(done.status).toBe('confirmed')
  return { plan: p.plan, written: a.cs, cs: persisted, receipt: done.receipt, undo: done.undo, pending: a.pending }
}
const instOf = (cs, id) => json(load(cs)).indicatorInstances.find((i) => i.instanceId === id)
const others = (cs, id) => json(load(cs)).indicatorInstances.filter((i) => i.instanceId !== id)
const withoutInstances = (cs) => { const { indicatorInstances: _x, indicators: _y, ...rest } = json(load(cs)); return rest }

describe('setCalculationTimeframe — the Inspector Timeframe select, through its writer', () => {
  it('is an appended STYLE op', () => {
    expect(STYLE_OPS[STYLE_OPS.length - 1]).toBe('setCalculationTimeframe')
  })
  it('C1: writes exactly what the select writes — one leaf on one instance; visibility, the chart and every other instance untouched', () => {
    const cs = chart()
    const r = run(cs, req('inst:rsi:1', 'W'))
    expect(r.written).toEqual(setInstanceCalculationTimeframe(load(cs), 'inst:rsi:1', 'W', registry))
    expect(instOf(r.cs, 'inst:rsi:1').calculationTimeframe).toBe('W')
    expect('visibility' in instOf(r.cs, 'inst:rsi:1')).toBe(false)
    expect(others(r.cs, 'inst:rsi:1')).toEqual(others(cs, 'inst:rsi:1'))
    expect(withoutInstances(r.cs)).toEqual(withoutInstances(cs))
    expect(r.pending.record.paths.map((p) => p.path)).toEqual([['indicatorInstances', { instanceId: 'inst:rsi:1' }, 'calculationTimeframe']])
    expect(r.receipt.change).toEqual({ what: 'calcTimeframe', before: null, after: 'W', chartTf: 'D' })
  })
  it('C1: the adopted classic SMA 50 takes a weekly calculation too', () => {
    const cs = chart()
    const sma = json(cs).indicatorInstances.find((i) => i.defId === 'movingAverage' && i.inputs?.period === 50)
    expect(sma).toBeTruthy()
    const r = run(cs, req(sma.instanceId, 'W'))
    expect(instOf(r.cs, sma.instanceId).calculationTimeframe).toBe('W')
  })
  it('C3: back to CHART deletes the key (the select\'s "Chart"); already CHART is no-change, not a write', () => {
    const cs = chart()
    const w = run(cs, req('inst:rsi:1', 'W'))
    const back = run(w.cs, req('inst:rsi:1', null))
    expect('calculationTimeframe' in instOf(back.cs, 'inst:rsi:1')).toBe(false)
    expect(back.receipt.change).toMatchObject({ before: 'W', after: null })
    expect(planIndicatorMutation(cs, req('inst:rsi:1', null), ctx())).toMatchObject({ ok: false, reason: REASONS.NO_CHANGE })
    expect(planIndicatorMutation(cs, req('inst:rsi:1', 'chart'), ctx())).toMatchObject({ ok: false, reason: REASONS.NO_CHANGE })
    expect(planIndicatorMutation(w.cs, req('inst:rsi:1', 'W'), ctx())).toMatchObject({ ok: false, reason: REASONS.NO_CHANGE })
  })
  it('C4: only CALC_TIMEFRAMES — a custom or made-up frame is bad-input with the real options, never coerced', () => {
    const cs = chart()
    for (const tf of ['13', '240', '3M', 'Q', 'weekly', '', 5]) {
      const r = planIndicatorMutation(cs, req('inst:rsi:1', tf), ctx())
      expect(r, String(tf)).toMatchObject({ ok: false, reason: REASONS.BAD_INPUT })
      expect(r.detail.options.map((o) => o.value)).toEqual([null, '1', '5', '15', '30', '60', 'D', 'W', 'M'])
    }
  })
  it('C4: a LOWER or straddling frame is refused with the select\'s own note (it would compute on the chart\'s bars)', () => {
    const cs = chart()
    const lower = planIndicatorMutation(cs, req('inst:rsi:1', '5', 'D'), ctx())
    expect(lower, JSON.stringify(lower)).toMatchObject({ ok: false, reason: REASONS.BAD_INPUT, detail: { relation: 'lower', why: "A 5m calculation can't be shown on a 1D chart" } })
    expect(planIndicatorMutation(cs, req('inst:rsi:1', 'M', '2W'), ctx())).toMatchObject({ ok: false, detail: { relation: 'straddle' } })
    // the same frame as the chart is legal and stored (the select stores it; it computes on the chart's bars)
    expect(run(cs, req('inst:rsi:1', 'D', 'D')).receipt.change.after).toBe('D')
    expect(run(cs, req('inst:rsi:1', '60', '5')).receipt.change.after).toBe('60')
  })
  it('C2: every capability refusal says WHY with CAPABILITY_WORDS — never success, never "already"', () => {
    const extra = [
      { instanceId: 'inst:vwap:1', defId: 'vwap', inputs: {}, hidden: false },
      { instanceId: 'inst:sar:1', defId: 'sar', inputs: {}, hidden: false },
      { instanceId: 'inst:ichimoku:1', defId: 'ichimoku', inputs: {}, hidden: false },
      { instanceId: 'inst:dataSeries:1', defId: 'dataSeries', inputs: { source: 'sym:QQQ:close' }, hidden: false },
      { instanceId: 'inst:movingAverage:v', defId: 'movingAverage', inputs: { source: 'volume', period: 20, maType: 'sma' }, hidden: false },
    ]
    const cs = chart(extra)
    const cases = [['inst:vwap:1', 'session'], ['inst:sar:1', 'markers'], ['inst:ichimoku:1', 'declared'], ['inst:dataSeries:1', 'passthrough'], ['inst:movingAverage:v', 'volume']]
    for (const [id, reason] of cases) {
      if (!findInstance(cs, id)) continue
      const r = planIndicatorMutation(cs, req(id, 'W'), ctx())
      expect(r, id).toMatchObject({ ok: false, reason: REASONS.BAD_INPUT, detail: { capability: reason } })
      expect(`${r.detail.why}.`).toBe(CAPABILITY_WORDS[reason])
    }
    expect(cases.filter(([id]) => findInstance(cs, id)).length).toBeGreaterThanOrEqual(4)
  })
  it('C2: an instance that INHERITS its source\'s frame is refused naming the source', () => {
    const r = planIndicatorMutation(chart(), req('inst:movingAverage:9', 'W'), ctx())
    expect(r).toMatchObject({ ok: false, reason: REASONS.BAD_INPUT, detail: { capability: 'inherits' } })
    expect(r.detail.why).toMatch(/same timeframe as its source/)
  })
  it('C2: a server lane and a bar-by-bar script are refused by name (a registry that answers those definitions)', () => {
    const rsi = registry.getDefinition('rsi')
    for (const [kind, reason] of [['server', 'server'], ['runtime', 'runtime']]) {
      const reg = { ...registry, getDefinition: (id) => (id === 'rsi' ? { ...rsi, compute: { ...(rsi.compute || {}), kind } } : registry.getDefinition(id)) }
      const r = planIndicatorMutation(chart(), req('inst:rsi:1', 'W'), ctx({ registry: reg }))
      expect(r, kind).toMatchObject({ ok: false, reason: REASONS.BAD_INPUT, detail: { capability: reason } })
      expect(`${r.detail.why}.`).toBe(CAPABILITY_WORDS[reason])
    }
  })
  it('C5: one RSI of two — only the named instance changes', () => {
    const r = run(chart(), req('inst:rsi:2', 'W'))
    expect(instOf(r.cs, 'inst:rsi:2').calculationTimeframe).toBe('W')
    expect('calculationTimeframe' in instOf(r.cs, 'inst:rsi:1')).toBe(false)
  })
  it('C7: Undo is exact — the prior frame comes back, CHART as the ABSENT key', () => {
    const cs = chart()
    const w = run(cs, req('inst:rsi:1', 'W'))
    const u = undoIndicatorMutation(w.cs, w.undo, ctx())
    expect(u.ok).toBe(true)
    const done = confirmIndicatorMutation(json(u.cs), u.pending, ctx())
    expect(done.status).toBe('confirmed')
    expect('calculationTimeframe' in instOf(u.cs, 'inst:rsi:1')).toBe(false)
    expect(json(load(u.cs))).toEqual(json(load(cs)))
    // from M → W, Undo puts M back
    const m = run(cs, req('inst:rsi:1', 'M'))
    const w2 = run(m.cs, req('inst:rsi:1', 'W'))
    const u2 = undoIndicatorMutation(w2.cs, w2.undo, ctx())
    expect(instOf(u2.cs, 'inst:rsi:1').calculationTimeframe).toBe('M')
  })
  it('C7: Undo after an UNRELATED change since (no verbatim restore point) still puts exactly this frame back, keeping the other change', () => {
    const w = run(chart(), req('inst:rsi:1', 'W'))
    const other = json(setInstanceCalculationTimeframe(load(w.cs), 'inst:rsi:2', 'M', registry))
    const u = undoIndicatorMutation(other, w.undo, ctx())
    expect(u.ok, JSON.stringify(u)).toBe(true)
    expect(confirmIndicatorMutation(json(u.cs), u.pending, ctx()).status).toBe('confirmed')
    expect('calculationTimeframe' in instOf(u.cs, 'inst:rsi:1')).toBe(false)
    expect(instOf(u.cs, 'inst:rsi:2').calculationTimeframe).toBe('M')
  })
  it('C7: Undo is stale-aware — a frame changed by hand since is never clobbered', () => {
    const w = run(chart(), req('inst:rsi:1', 'W'))
    const byHand = json(setInstanceCalculationTimeframe(load(w.cs), 'inst:rsi:1', 'M', registry))
    const u = undoIndicatorMutation(byHand, w.undo, ctx())
    expect(u).toMatchObject({ ok: false, reason: REASONS.RESTORE_CONFLICT })
  })
  it('a read-back that lost the write is did-not-land, never confirmed', () => {
    const cs = chart()
    const p = planIndicatorMutation(cs, req('inst:rsi:1', 'W'), ctx())
    const a = applyIndicatorMutation(cs, p.plan, ctx())
    expect(confirmIndicatorMutation(json(cs), a.pending, ctx())).toMatchObject({ status: REASONS.NOT_LANDED })
  })
})
