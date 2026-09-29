// app/src/components/chart/engine/__tests__/mtfModel.test.js
//
// ─── CALCULATION TIMEFRAME + VISIBILITY: the model, the gate, the writers ─────
//
// Two independent concepts on one instance (2026-09-28):
//   calculationTimeframe — which bars COMPUTE it (absent = Chart)
//   visibility           — on which chart timeframes it DRAWS (absent = All)

import { describe, it, expect } from 'vitest'
import * as registry from '../nativeRegistry'
import {
  CALC_TIMEFRAMES, calcTimeframeOf, frameRelation, effectiveCalcFrame, normalizeVisibility,
  isVisibleOnTimeframe, visibilitySummary, visibilityChoices, calcTimeframeLabel,
} from '../instanceTimeframe'
import { calcTimeframeCapability, resolveInstanceFrames } from '../calcTimeframeCapability'
import { eligibleInstances } from '../eligibility'
import { legendChips } from '../readout'
import {
  addInstance, setInstanceCalculationTimeframe, setInstanceVisibility, setInstanceAppearance,
  duplicateInstance, findInstance, setInstanceInput,
} from '../instanceControls'
import { presentedPlot, lineLookPatch } from '../presentation'
import { seriesOptionsForPlot } from '../pool'
import { NATIVE_TFS, TF_MENU } from '../../timeframes'
import { mergeChartSettings } from '../../chartDefaults'
import { orderByDependency } from '../sourceRef'

const defOf = (id) => registry.getDefinition(id)
const blank = () => ({ indicators: {}, indicatorInstances: [] })
const added = (cs, defId) => {
  const next = addInstance(cs, defId, registry)
  const before = new Set(cs.indicatorInstances.map((i) => i.instanceId))
  return { cs: next, id: next.indicatorInstances.find((i) => !before.has(i.instanceId)).instanceId }
}

// ── calculation timeframe ────────────────────────────────────────────────────

describe('calculation timeframe — the registry\'s codes, and CHART as the absent key', () => {
  it('the choices ARE timeframes.js NATIVE_TFS, not a second list', () => {
    expect(CALC_TIMEFRAMES).toEqual(NATIVE_TFS)
    expect(CALC_TIMEFRAMES.map(calcTimeframeLabel)).toEqual(['1m', '5m', '15m', '30m', '1h', '1D', '1W', '1M'])
    expect(calcTimeframeLabel(null)).toBe('Chart')
  })
  it('absent / junk reads as CHART — the pre-existing behaviour', () => {
    expect(calcTimeframeOf({})).toBeNull()
    expect(calcTimeframeOf({ calculationTimeframe: '2D' })).toBeNull()   // not a fetchable code
    expect(calcTimeframeOf({ calculationTimeframe: 'D' })).toBe('D')
  })
  it('the relation: same → chart, above → higher, below → lower, multi-day chart → straddle', () => {
    expect(frameRelation(null, '5')).toBe('chart')
    expect(frameRelation('D', 'D')).toBe('chart')
    expect(frameRelation('D', '5')).toBe('higher')
    expect(frameRelation('W', 'D')).toBe('higher')
    expect(frameRelation('M', 'W')).toBe('higher')
    expect(frameRelation('60', '15')).toBe('higher')
    expect(frameRelation('D', '45')).toBe('higher')     // custom intraday charts are fine
    expect(frameRelation('5', 'D')).toBe('lower')
    expect(frameRelation('60', 'W')).toBe('lower')
    expect(frameRelation('W', '2D')).toBe('straddle')
    expect(effectiveCalcFrame({ calculationTimeframe: '5' }, 'D')).toEqual({ frame: null, relation: 'lower', gated: 'lower' })
  })
})

// ── the capability matrix ────────────────────────────────────────────────────

describe('⭐⭐ THE CAPABILITY MATRIX — derived from definitions, pinned by name', () => {
  const verdict = (id, inst) => calcTimeframeCapability(defOf(id), inst || { defId: id, inputs: {} })
  it('every native definition has an answer, and the answers are these', () => {
    const table = Object.fromEntries(registry.listDefinitions().map((d) => {
      const v = verdict(d.id)
      return [d.id, v.ok ? 'ok' : v.reason]
    }))
    expect(table).toEqual({
      rsi: 'ok', macd: 'ok', bb: 'ok', stoch: 'ok', atr: 'ok', mfi: 'ok', cci: 'ok',
      williamsR: 'ok', adx: 'ok', obv: 'ok', donchian: 'ok', atrBands: 'ok', movingAverage: 'ok',
      vwap: 'session', avwap: 'session',
      sar: 'markers',
      ichimoku: 'declared',
      dollarVolume: 'declared',
      dataSeries: 'passthrough',
      rsLine: 'server',
    })
  })
  it('the SOURCE decides for a source-aware definition', () => {
    expect(verdict('movingAverage', { inputs: { source: 'volume' } })).toEqual({ ok: false, reason: 'volume' })
    expect(verdict('movingAverage', { inputs: { source: 'sym:QQQ:close' } })).toEqual({ ok: true })
    expect(verdict('movingAverage', { inputs: { source: '@legacy:rsi::rsi' } })).toEqual({ ok: true, inherits: 'legacy:rsi' })
  })
})

describe('⭐⭐ A DEPENDENT INHERITS ITS SOURCE\'S FRAME — one rule, no mixed frames', () => {
  it('MA(RSI 1h) on a 5m chart computes in 1h; its own stored timeframe is not consulted', () => {
    const rsi = { instanceId: 'r', defId: 'rsi', inputs: {}, calculationTimeframe: '60' }
    const ma = { instanceId: 'm', defId: 'movingAverage', inputs: { source: '@r::rsi' }, calculationTimeframe: 'D' }
    const ma2 = { instanceId: 'm2', defId: 'movingAverage', inputs: { source: '@m::ma' } }
    const { ordered } = orderByDependency([ma2, ma, rsi], defOf)
    const f = resolveInstanceFrames(ordered, defOf, '5')
    expect(f.get('r').frame).toBe('60')
    expect(f.get('m').frame, 'the dependent took its OWN timeframe').toBe('60')
    expect(f.get('m2').frame, 'a dependent of a dependent').toBe('60')
  })
  it('…and a chart-frame source keeps its dependent on the chart', () => {
    const rsi = { instanceId: 'r', defId: 'rsi', inputs: {} }
    const ma = { instanceId: 'm', defId: 'movingAverage', inputs: { source: '@r::rsi' }, calculationTimeframe: 'D' }
    const f = resolveInstanceFrames(orderByDependency([rsi, ma], defOf).ordered, defOf, '5')
    expect(f.get('m').frame).toBeNull()
  })
})

// ── visibility ───────────────────────────────────────────────────────────────

describe('visibility — semantic presets, exact customs, ALL as the absent key', () => {
  const allTfs = TF_MENU.flatMap((g) => g.codes)
  const on = (vis) => allTfs.filter((tf) => isVisibleOnTimeframe({ visibility: vis }, tf))

  it('All / Intraday only / Daily & above over EVERY chart timeframe', () => {
    expect(on(undefined)).toEqual(allTfs)
    expect(on({ preset: 'intraday' })).toEqual(['1', '2', '3', '5', '10', '15', '30', '45', '65', '195', '60', '120', '240'])
    expect(on({ preset: 'dailyUp' })).toEqual(['D', '2D', '3D', '5D', 'W', '2W', 'M', '3M', '6M', '12M'])
  })
  it('⭐ a PRESET is stored as its word, so a new intraday timeframe inherits it', () => {
    expect(normalizeVisibility({ preset: 'intraday', tfs: ['5'] })).toEqual({ preset: 'intraday' })
    expect(isVisibleOnTimeframe({ visibility: { preset: 'intraday' } }, '4')).toBe(true)   // a code that does not exist yet
  })
  it('custom is exact — Daily only; Daily + Weekly; 5m + 1h + Daily', () => {
    expect(on({ preset: 'custom', tfs: ['D'] })).toEqual(['D'])
    expect(on({ preset: 'custom', tfs: ['W', 'D'] })).toEqual(['D', 'W'])
    expect(on({ preset: 'custom', tfs: ['D', '60', '5'] })).toEqual(['5', '60', 'D'])
  })
  it('summaries are short — never a comma list', () => {
    expect(visibilitySummary(null)).toBe('All timeframes')
    expect(visibilitySummary({ preset: 'intraday' })).toBe('Intraday only')
    expect(visibilitySummary({ preset: 'dailyUp' })).toBe('Daily & above')
    expect(visibilitySummary({ preset: 'custom', tfs: ['D'] })).toBe('Daily only')
    expect(visibilitySummary({ preset: 'custom', tfs: ['W', 'D'] })).toBe('Daily + Weekly')
    expect(visibilitySummary({ preset: 'custom', tfs: ['5', '60', 'D'] })).toBe('3 timeframes')
  })
  it('⛔ malformed or empty reads as ALL (visibility only ever hides — fail open)', () => {
    for (const v of [null, 'daily', [], { preset: 'custom', tfs: [] }, { preset: 'nope' }]) {
      expect(normalizeVisibility(v), JSON.stringify(v)).toBeNull()
    }
    expect(isVisibleOnTimeframe({ visibility: { preset: 'custom', tfs: ['D'] } }, undefined)).toBe(true)
  })
  it('the Custom choices are the chart\'s own timeframe menu', () => {
    expect(visibilityChoices()).toEqual(TF_MENU.map((g) => ({ group: g.group, codes: g.codes })))
  })
})

// ── the gate: hidden here ≠ gone ─────────────────────────────────────────────

describe('⭐⭐ eligibleInstances — hidden by TIMEFRAME is hidden, never dropped', () => {
  const rsi = { instanceId: 'r', defId: 'rsi', inputs: {}, visibility: { preset: 'custom', tfs: ['D'] } }
  const ma = { instanceId: 'm', defId: 'movingAverage', inputs: { source: '@r::rsi' } }

  it('off-timeframe → an in-memory hidden copy tagged hiddenBy, so a dependent still computes', () => {
    const { kept, hidden } = eligibleInstances([rsi, ma], registry, { tf: '5' })
    const r = kept.find((i) => i.instanceId === 'r')
    expect(r.hidden).toBe(true)
    expect(r.hiddenBy).toBe('visibility')
    expect(hidden.map((h) => h.reason)).toEqual(['visibility'])
    expect(rsi.hidden, 'the stored instance was mutated').toBeUndefined()
    expect(kept.find((i) => i.instanceId === 'm').hidden).toBeFalsy()
  })
  it('on-timeframe → untouched', () => {
    const { kept } = eligibleInstances([rsi], registry, { tf: 'D' })
    expect(kept[0]).toBe(rsi)
  })
  it('a gated calculation frame (5m RSI on a Daily chart) hides the same way', () => {
    const r5 = { instanceId: 'x', defId: 'rsi', inputs: {}, calculationTimeframe: '5' }
    const { kept, hidden } = eligibleInstances([r5], registry, { tf: 'D' })
    expect(kept[0].hiddenBy).toBe('frame')
    expect(hidden[0].reason).toBe('frame:lower')
  })
  it('⛔ a member-hidden instance keeps its greyed chip; a timeframe-hidden one gets none', () => {
    const memberHidden = { instanceId: 'a', defId: 'rsi', inputs: {}, hidden: true }
    const tfHidden = { instanceId: 'b', defId: 'rsi', inputs: {}, hidden: true, hiddenBy: 'visibility' }
    const chips = legendChips([], null, registry, [memberHidden, tfHidden])
    expect(chips.map((c) => c.instanceId)).toEqual(['a'])
  })
  it('an average on price wears the SURFACE look (curve, autoscale, MA labels, EMA 9 colour)', () => {
    const avg = { instanceId: 'e', defId: 'movingAverage', inputs: { source: 'close', period: 9, maType: 'ema', color: '#4ade80' } }
    const { kept } = eligibleInstances([avg], registry, {
      tf: 'D', boldCandles: true, showMaLabels: true, lastBarOff: false, ema9Color: '#2faf68', targetOf: () => 'price',
    })
    expect(kept[0].renderLook).toEqual({ curved: true, autoscale: 'default', lastValue: true })
    expect(kept[0].inputs.color).toBe('#2faf68')
    expect(avg.inputs.color, 'the stored colour was rewritten').toBe('#4ade80')
    const inPane = eligibleInstances([avg], registry, { tf: 'D', targetOf: () => 'pane' }).kept[0]
    expect(inPane.renderLook, 'an average in RSI\'s pane took the price look').toBeUndefined()
  })
})

// ── the writers ──────────────────────────────────────────────────────────────

describe('the writers — canonical, capability-bound, default-deleting', () => {
  it('setInstanceCalculationTimeframe writes a native code and DELETES for Chart', () => {
    const { cs, id } = added(blank(), 'rsi')
    const on = setInstanceCalculationTimeframe(cs, id, '60', registry)
    expect(findInstance(on, id).calculationTimeframe).toBe('60')
    const off = setInstanceCalculationTimeframe(on, id, null, registry)
    expect('calculationTimeframe' in findInstance(off, id)).toBe(false)
    expect(setInstanceCalculationTimeframe(cs, id, '2D', registry), 'a non-native code')
      .toBe(setInstanceCalculationTimeframe(cs, id, null, registry))
  })
  it('⛔ refused by identity where the capability says no, or where it inherits', () => {
    const v = added(blank(), 'vwap')
    expect(setInstanceCalculationTimeframe(v.cs, v.id, 'D', registry)).toBe(v.cs)
    let cs = blank()
    const r = added(cs, 'rsi'); cs = r.cs
    const m = added(cs, 'movingAverage'); cs = m.cs
    cs = setInstanceInput(cs, m.id, 'source', `@${r.id}::rsi`, registry)
    expect(setInstanceCalculationTimeframe(cs, m.id, 'D', registry)).toBe(cs)
  })
  it('setInstanceVisibility stores presets as words, ALL as absence, and nothing else', () => {
    const { cs, id } = added(blank(), 'macd')
    const a = setInstanceVisibility(cs, id, { preset: 'dailyUp' }, registry)
    expect(findInstance(a, id).visibility).toEqual({ preset: 'dailyUp' })
    const before = findInstance(a, id)
    const b = setInstanceVisibility(a, id, null, registry)
    const after = findInstance(b, id)
    expect('visibility' in after).toBe(false)
    const { visibility: _v, ...rest } = before
    expect(after).toEqual(rest)
  })
  it('setInstanceAppearance: only what `meta.appearance` declares; the default deletes', () => {
    const m = added(blank(), 'movingAverage')
    const w = setInstanceAppearance(m.cs, m.id, 'lineWidth', 3, registry)
    expect(findInstance(w, m.id).presentation).toEqual({ lineWidth: 3 })
    expect('presentation' in findInstance(setInstanceAppearance(w, m.id, 'lineWidth', 1, registry), m.id)).toBe(false)
    expect(findInstance(setInstanceAppearance(m.cs, m.id, 'overlap', true, registry), m.id).presentation)
      .toEqual({ overlap: true })
    const r = added(blank(), 'rsi')
    expect(setInstanceAppearance(r.cs, r.id, 'lineWidth', 3, registry), 'RSI declares no stroke controls').toBe(r.cs)
  })
  it('⭐⭐ duplicateInstance copies EVERYTHING the member set, under a NEW id', () => {
    let cs = blank()
    const m = added(cs, 'movingAverage'); cs = m.cs
    cs = setInstanceInput(cs, m.id, 'period', 10, registry)
    cs = setInstanceCalculationTimeframe(cs, m.id, 'W', registry)
    cs = setInstanceVisibility(cs, m.id, { preset: 'custom', tfs: ['D'] }, registry)
    cs = setInstanceAppearance(cs, m.id, 'lineStyle', 'dotted', registry)
    const dup = duplicateInstance(cs, m.id, registry)
    const src = findInstance(dup, m.id)
    const copy = dup.indicatorInstances.find((i) => i.instanceId !== m.id && i.defId === 'movingAverage')
    expect(copy.instanceId).not.toBe(src.instanceId)
    expect(copy.inputs).toEqual(src.inputs)
    expect(copy.calculationTimeframe).toBe('W')
    expect(copy.visibility).toEqual({ preset: 'custom', tfs: ['D'] })
    expect(copy.presentation).toEqual({ lineStyle: 'dotted' })
    expect(copy.hidden).toBe(false)
  })
})

// ── presentation: STROKE is not GEOMETRY ─────────────────────────────────────

describe('⭐ Line style / Line width (stroke) vs Plot style Line / Step (geometry)', () => {
  const LS = { Solid: 0, Dotted: 1, Dashed: 2 }
  const LT = { Simple: 0, WithSteps: 1, Curved: 2 }
  const maPlot = defOf('movingAverage').plots[0]
  const opts = (inst) => seriesOptionsForPlot(presentedPlot(maPlot, inst, {}), { LineStyle: LS, LineType: LT, lastValue: false, autoscale: 'exclude' })

  it('a dashed 3px STEP line is all three, independently', () => {
    const o = opts({ defId: 'movingAverage', inputs: {}, presentation: { plotStyle: 'step', lineWidth: 3, lineStyle: 'dashed' } })
    expect(o.lineType).toBe(LT.WithSteps)
    expect(o.lineWidth).toBe(3)
    expect(o.lineStyle).toBe(LS.Dashed)
  })
  it('the surface curve applies to a LINE and never to a STEP', () => {
    const look = { curved: true, autoscale: 'default', lastValue: true }
    expect(opts({ defId: 'movingAverage', inputs: {}, renderLook: look }).lineType).toBe(LT.Curved)
    expect(opts({ defId: 'movingAverage', inputs: {}, renderLook: look, presentation: { plotStyle: 'step' } }).lineType)
      .toBe(LT.WithSteps)
  })
  it('the look\'s last-value tag and autoscale outrank placement\'s', () => {
    const o = opts({ defId: 'movingAverage', inputs: {}, renderLook: { autoscale: 'default', lastValue: true } })
    expect(o.lastValueVisible).toBe(true)
    // LWC calls the provider with its own base implementation; 'default' returns it.
    const base = () => ({ priceRange: { minValue: 1, maxValue: 2 } })
    expect(o.autoscaleInfoProvider(base), 'an average stopped stretching the candles\' range')
      .toEqual(base())
  })
  it('untouched instance → no patch, the plot object is returned as-is', () => {
    expect(lineLookPatch({ defId: 'movingAverage', inputs: {} }, 'line')).toBeNull()
    expect(presentedPlot(maPlot, { defId: 'movingAverage', inputs: {} }, {})).toBe(maPlot)
  })
})

// ── a default chart, end to end through the merge ───────────────────────────

describe('a DEFAULT chart\'s averages accept the new controls like any other', () => {
  it('Weekly SMA 10 · Step · Daily only on the adopted SMA 50', () => {
    let cs = mergeChartSettings(null)
    cs = setInstanceInput(cs, 'ovl:2', 'period', 10, registry)
    cs = setInstanceCalculationTimeframe(cs, 'ovl:2', 'W', registry)
    cs = setInstanceVisibility(cs, 'ovl:2', { preset: 'custom', tfs: ['D'] }, registry)
    const re = mergeChartSettings(JSON.stringify(cs))
    const avg = findInstance(re, 'ovl:2')
    expect(avg.inputs.period).toBe(10)
    expect(avg.calculationTimeframe).toBe('W')
    expect(avg.visibility).toEqual({ preset: 'custom', tfs: ['D'] })
  })
})
