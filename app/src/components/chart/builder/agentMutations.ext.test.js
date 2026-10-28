// app/src/components/chart/builder/agentMutations.ext.test.js — I-1…I-12, Indicators half
//
// The eight added `mutation/1` ops (style, colour, placement, panes, duplicate, copy), the
// structured target (I-10), the post-change fingerprint on every receipt (I-12) and the
// multi-chart planner. Each op is proved against the UI writer it wraps (byte for byte
// after a store round trip), confirmed from a read-back, refused when stale, and undone
// exactly or refused. Real registry, real settings, no mocks.
import { describe, it, expect, beforeAll } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import * as registry from '../engine/nativeRegistry'
import { mergeChartSettings } from '../chartDefaults'
import {
  findInstance, withInstances, setInstanceAppearance, setInstancePlotStyle, setInstanceCandleColor,
  setInstanceDisplayTarget, duplicateInstance, setInstanceInput,
} from '../engine/instanceControls'
import { movePane, movePaneTo } from '../engine/paneOrder'
import { setPaneSize } from '../engine/paneSizes'
import { adoptOverlayAverages } from '../maAdoption'
import { instancesOf, instanceFingerprint } from './agentSeams'
import { paneKeysOf, paneArrangeArgs } from './agentPanes'
import { captureIndicatorTemplate, applyIndicatorTemplate } from './indicatorTemplates'
import {
  REASONS, MUTATION_OPS, STYLE_OPS, PANE_OPS, CREATE_OPS, MUTATION_CONTRACT,
  planIndicatorMutation, applyIndicatorMutation, confirmIndicatorMutation, undoIndicatorMutation,
  resolveIndicatorTarget, styleOptionsOf, planAcrossCharts, paneFingerprint,
} from './agentMutations'

const SAVED = 'u_aaaaaaaaaab3'
const FOREIGN = 'u_aaaaaaaaaab4'
beforeAll(() => {
  const FIX = JSON.parse(fs.readFileSync(path.resolve(globalThis.process.cwd(), '..', 'tests/fixtures/authoring/batch2_definitions.json'), 'utf8'))
  const res = registry.installUserDefinitions([{ ...FIX.styled_markers, id: SAVED, version: 4 }, { ...FIX.styled_markers, id: FOREIGN, version: 1 }])
  expect(res.errors, JSON.stringify(res.errors)).toEqual([])
})

const view = (cs) => adoptOverlayAverages(cs) || cs
const json = (v) => JSON.parse(JSON.stringify(v))
const load = (cs) => view(mergeChartSettings(JSON.stringify(cs)))
const VOL = { volumeSeparatePane: true, blankVolume: false }
const ctx = (over = {}) => ({ canManage: true, ownedDefinitionIds: [SAVED], registry, chartId: 'c1', volumeOpts: VOL, ...over })

/** RSI (own pane), an EMA of RSI (in RSI's pane), MACD (own pane, signed histogram), an MA on price, a saved formula. */
function chart(extra = []) {
  const base = mergeChartSettings(null)
  const raw = load({
    ...base,
    indicatorInstances: [
      ...(base.indicatorInstances || []),
      { instanceId: 'inst:rsi:1', defId: 'rsi', inputs: { period: 14 }, hidden: false },
      { instanceId: 'inst:movingAverage:9', defId: 'movingAverage', inputs: { source: '@inst:rsi:1::rsi', period: 9, maType: 'ema', color: '#ff9800' }, hidden: false },
      { instanceId: 'inst:macd:1', defId: 'macd', inputs: {}, hidden: false, presentation: { plots: { histogram: { signColors: true } } } },
      { instanceId: 'inst:movingAverage:20', defId: 'movingAverage', inputs: { period: 20, maType: 'ema', color: '#2196f3' }, hidden: false },
      { instanceId: `inst:${SAVED}:1`, defId: SAVED, defVersion: 4, inputs: {}, hidden: false },
      ...extra,
    ],
    indicators: { ...(base.indicators || {}), rsi: { enabled: true }, macd: { enabled: true } },
  })
  return load(withInstances(raw, raw.indicatorInstances, registry))
}

/** plan → apply → "persist" (a JSON round trip, as a store would) → confirm. */
function run(cs, request, c = ctx()) {
  const p = planIndicatorMutation(cs, request, c)
  expect(p.ok, JSON.stringify(p)).toBe(true)
  const a = applyIndicatorMutation(cs, p.plan, c)
  expect(a.ok, JSON.stringify(a)).toBe(true)
  const persisted = json(a.cs)
  const done = confirmIndicatorMutation(persisted, a.pending, c)
  expect(done.status).toBe('confirmed')
  return { plan: p.plan, cs: persisted, receipt: done.receipt, undo: done.undo }
}
function runUndo(cs, undo, c = ctx()) {
  const u = undoIndicatorMutation(cs, undo, c)
  expect(u.ok, JSON.stringify(u)).toBe(true)
  const persisted = json(u.cs)
  const done = confirmIndicatorMutation(persisted, u.pending, c)
  expect(done.status).toBe('confirmed')
  return { cs: persisted, receipt: done.receipt }
}
/** The settings as a chart reads them back — the space Undo exactness is judged in. */
const readBack = (cs) => json(load(cs))
const refusal = (cs, request, c = ctx()) => planIndicatorMutation(cs, request, c)

describe('the contract is additive', () => {
  it('the first four ops keep their order; the new ones are appended and partitioned', () => {
    expect(MUTATION_CONTRACT).toBe('uct.indicators.mutation/1')
    expect(MUTATION_OPS.slice(0, 4)).toEqual(['add', 'remove', 'setVisible', 'setInputs'])
    expect(MUTATION_OPS.slice(4)).toEqual([...STYLE_OPS, ...PANE_OPS, ...CREATE_OPS])
    expect([...STYLE_OPS, ...PANE_OPS, ...CREATE_OPS]).toEqual(['setAppearance', 'setPlotStyle', 'setColor', 'setDisplayTarget', 'movePane', 'setPaneSize', 'duplicate', 'copyFrom'])
  })
  it('REASONS is exactly the frozen set — no new refusal codes', () => {
    expect(Object.values(REASONS).sort()).toEqual(['ambiguous', 'bad-input', 'bad-request', 'changed-while-working', 'dependent-exists', 'did-not-land',
      'no-change', 'not-found', 'permission-changed', 'readonly', 'restore-conflict', 'unconfirmed', 'unknown-definition', 'unsupported-definition', 'writer-refused'])
  })
})

describe('I-1 setAppearance — the Inspector stroke controls', () => {
  it('equals setInstanceAppearance byte for byte, confirms, pins the post-change fingerprint, and undoes exactly', () => {
    const cs = chart()
    const r = run(cs, { op: 'setAppearance', instanceId: 'inst:movingAverage:20', key: 'lineWidth', value: 3 })
    expect(r.cs).toEqual(json(setInstanceAppearance(cs, 'inst:movingAverage:20', 'lineWidth', 3, registry)))
    expect(r.receipt).toMatchObject({ op: 'setAppearance', status: 'confirmed', instanceIds: ['inst:movingAverage:20'], change: { what: 'appearance', key: 'lineWidth', before: 1, after: 3 } })
    expect(r.receipt.instanceFingerprintAfter).toBe(instanceFingerprint(r.cs))
    const u = runUndo(r.cs, r.undo)
    expect(readBack(u.cs).indicatorInstances).toEqual(readBack(cs).indicatorInstances)
    expect(u.receipt).toMatchObject({ op: 'undo', undoOf: 'setAppearance' })
  })
  it('lineStyle and overlap go through the same writer; the default deletes the key', () => {
    const cs = chart()
    const dashed = run(cs, { op: 'setAppearance', instanceId: 'inst:movingAverage:20', key: 'lineStyle', value: 'dashed' })
    expect(findInstance(dashed.cs, 'inst:movingAverage:20').presentation).toMatchObject({ lineStyle: 'dashed' })
    const back = run(dashed.cs, { op: 'setAppearance', instanceId: 'inst:movingAverage:20', key: 'lineStyle', value: 'solid' })
    expect((findInstance(back.cs, 'inst:movingAverage:20').presentation || {}).lineStyle).toBeUndefined()
    expect(run(cs, { op: 'setAppearance', instanceId: 'inst:movingAverage:20', key: 'overlap', value: true }).receipt.change).toMatchObject({ before: false, after: true })
  })
  it('refuses by name: an undeclared control, a value outside the choices, a no-op', () => {
    const cs = chart()
    expect(refusal(cs, { op: 'setAppearance', instanceId: 'inst:rsi:1', key: 'lineWidth', value: 2 })).toMatchObject({ ok: false, reason: 'bad-input' })
    const bad = refusal(cs, { op: 'setAppearance', instanceId: 'inst:movingAverage:20', key: 'lineWidth', value: 7 })
    expect(bad).toMatchObject({ ok: false, reason: 'bad-input', detail: { key: 'lineWidth', options: [1, 2, 3, 4] } })
    expect(refusal(cs, { op: 'setAppearance', instanceId: 'inst:movingAverage:20', key: 'lineWidth', value: 1 })).toMatchObject({ ok: false, reason: 'no-change' })
    expect(refusal(cs, { op: 'setAppearance', instanceId: 'inst:nope:1', key: 'lineWidth', value: 2 })).toMatchObject({ ok: false, reason: 'not-found' })
  })
})

describe('I-2 setPlotStyle — the Inspector Plot style menu', () => {
  it('a single-output indicator writes the INSTANCE level, as the menu does', () => {
    const cs = chart()
    const r = run(cs, { op: 'setPlotStyle', instanceId: 'inst:movingAverage:20', style: 'area' })
    expect(r.cs).toEqual(json(setInstancePlotStyle(cs, 'inst:movingAverage:20', 'area', registry, undefined)))
    expect(r.receipt.change).toMatchObject({ what: 'plotStyle', before: 'line', after: 'area' })
    const u = runUndo(r.cs, r.undo)
    expect(readBack(u.cs).indicatorInstances).toEqual(readBack(cs).indicatorInstances)
  })
  it('a multi-output indicator must name the output; only offered styles are accepted', () => {
    const cs = chart()
    const opts = styleOptionsOf(cs, registry, 'inst:macd:1')
    expect(opts.ok).toBe(true)
    expect(opts.plotStyles.length).toBeGreaterThan(1)
    expect(refusal(cs, { op: 'setPlotStyle', instanceId: 'inst:macd:1', style: 'line' })).toMatchObject({ ok: false, reason: 'bad-request', detail: { plots: expect.any(Array) } })
    const hist = opts.plotStyles.find((p) => p.plotKey === 'histogram')
    const to = hist.options.find((s) => s !== hist.current)
    const r = run(cs, { op: 'setPlotStyle', instanceId: 'inst:macd:1', plotKey: 'histogram', style: to })
    expect(r.cs).toEqual(json(setInstancePlotStyle(cs, 'inst:macd:1', to, registry, 'histogram')))
    expect(refusal(cs, { op: 'setPlotStyle', instanceId: 'inst:macd:1', plotKey: 'histogram', style: 'candles' })).toMatchObject({ ok: false, reason: 'bad-input' })
  })
})

describe('I-3 + I-13 setColor — the colour swatches', () => {
  it('an input colour goes through the settings rows\' colour lane (setInstanceInput) and undoes exactly', () => {
    const cs = chart()
    const r = run(cs, { op: 'setColor', instanceId: 'inst:movingAverage:20', target: 'input:color', color: '#22c55e' })
    expect(r.cs).toEqual(json(setInstanceInput(cs, 'inst:movingAverage:20', 'color', '#22c55e', registry)))
    expect(r.receipt.change).toEqual({ what: 'color', target: 'input:color', before: '#2196f3', after: '#22c55e' })
    const u = runUndo(r.cs, r.undo)
    expect(findInstance(u.cs, 'inst:movingAverage:20').inputs.color).toBe('#2196f3')
  })
  it('`hex` is accepted as the colour key (the Agent proposal\'s spelling); a theme token is a colour', () => {
    const cs = chart()
    expect(run(cs, { op: 'setColor', instanceId: 'inst:rsi:1', target: 'input:color', hex: '#ef4444' }).receipt.change.after).toBe('#ef4444')
    expect(run(cs, { op: 'setColor', instanceId: 'inst:rsi:1', target: 'input:color', color: 'token:bull' }).receipt.change.after).toBe('token:bull')
  })
  it('refuses a non-colour, an unknown token, a non-colour input and a no-op', () => {
    const cs = chart()
    for (const color of ['green-ish', 'token:nope', '#12345', '', null]) {
      expect(refusal(cs, { op: 'setColor', instanceId: 'inst:rsi:1', target: 'input:color', color })).toMatchObject({ ok: false, reason: 'bad-input' })
    }
    expect(refusal(cs, { op: 'setColor', instanceId: 'inst:rsi:1', target: 'input:period', color: '#ffffff' })).toMatchObject({ ok: false, reason: 'bad-input', detail: { options: [expect.objectContaining({ target: 'input:color' })] } })
    expect(refusal(cs, { op: 'setColor', instanceId: 'inst:movingAverage:20', target: 'input:color', color: '#2196f3' })).toMatchObject({ ok: false, reason: 'no-change' })
  })
  it('signed-histogram Up/Down colours go through setInstanceCandleColor with the chart\'s own colour as the default', () => {
    const cs = chart()
    const r = run(cs, { op: 'setColor', instanceId: 'inst:macd:1', target: 'sign:up', color: '#00ff00' })
    expect(r.cs).toEqual(json(setInstanceCandleColor(cs, 'inst:macd:1', 'upColor', '#00ff00', registry, undefined, (cs.candles || {}).upColor || null)))
    const u = runUndo(r.cs, r.undo)
    expect(readBack(u.cs).indicatorInstances).toEqual(readBack(cs).indicatorInstances)
    expect(refusal(cs, { op: 'setColor', instanceId: 'inst:rsi:1', target: 'sign:up', color: '#00ff00' })).toMatchObject({ ok: false, reason: 'bad-input' })
  })
})

describe('I-4 setDisplayTarget — the Inspector Display-in menu', () => {
  it('moves RSI onto price through setInstanceDisplayTarget, lists the guests that travel, and undoes exactly', () => {
    const cs = chart()
    const r = run(cs, { op: 'setDisplayTarget', instanceId: 'inst:rsi:1', target: 'price' })
    expect(r.cs).toEqual(json(setInstanceDisplayTarget(cs, 'inst:rsi:1', 'price', registry)))
    expect(r.receipt.change).toMatchObject({ what: 'displayTarget', before: 'pane', after: 'price' })
    expect(r.plan.preview.change.guests.map((g) => g.instanceId)).toEqual(['inst:movingAverage:9'])
    const u = runUndo(r.cs, r.undo)
    expect(readBack(u.cs).indicatorInstances).toEqual(readBack(cs).indicatorInstances)
  })
  it('only an offered destination is accepted; "auto" returns to the automatic placement', () => {
    const cs = chart()
    expect(refusal(cs, { op: 'setDisplayTarget', instanceId: 'inst:rsi:1', target: '@inst:rsi:1' })).toMatchObject({ ok: false, reason: 'bad-input' })
    const moved = run(cs, { op: 'setDisplayTarget', instanceId: 'inst:movingAverage:9', target: 'price' })
    const back = run(moved.cs, { op: 'setDisplayTarget', instanceId: 'inst:movingAverage:9', target: 'auto' })
    expect(back.receipt.change).toMatchObject({ after: '@inst:rsi:1', automatic: true })
    expect(refusal(cs, { op: 'setDisplayTarget', instanceId: 'inst:rsi:1', target: 'pane' })).toMatchObject({ ok: false, reason: 'no-change' })
  })
})

describe('I-9 paneKeysOf + I-5 movePane + I-6 setPaneSize', () => {
  it('the panes are Chart Data\'s Arrange list: price first, keys the pane writers take', () => {
    const panes = paneKeysOf(chart(), registry, VOL)
    expect(panes[0]).toMatchObject({ paneKey: 'price', kind: 'price', index: 0 })
    const rsi = panes.find((p) => p.paneKey === 'inst:rsi:1')
    expect(rsi).toMatchObject({ kind: 'pane', hostInstanceId: 'inst:rsi:1' })
    expect(rsi.ownerInstanceIds).toEqual(['inst:rsi:1', 'inst:movingAverage:9'])
    expect(panes.some((p) => p.kind === 'volume')).toBe(true)
  })
  it('"move RSI above price" = movePaneTo(…, \'price\') byte for byte; Undo restores the order', () => {
    const cs = chart()
    const { paneKeys, opts } = paneArrangeArgs(cs, registry, VOL)
    const r = run(cs, { op: 'movePane', paneKey: 'inst:rsi:1', beforeKey: 'price' })
    expect(r.cs).toEqual(json(movePaneTo(cs, paneKeys, 'inst:rsi:1', 'price', opts)))
    expect(r.receipt).toMatchObject({ op: 'movePane', paneKey: 'inst:rsi:1', change: { what: 'paneOrder' } })
    expect(paneKeysOf(r.cs, registry, VOL)[0].paneKey).toBe('inst:rsi:1')
    const u = runUndo(r.cs, r.undo)
    expect(paneKeysOf(u.cs, registry, VOL).map((p) => p.paneKey)).toEqual(paneKeysOf(cs, registry, VOL).map((p) => p.paneKey))
  })
  it('delta ±1 = the Move up / Move down arrows; the top is a no-change, not a wrap', () => {
    const cs = chart()
    const { paneKeys, opts } = paneArrangeArgs(cs, registry, VOL)
    expect(run(cs, { op: 'movePane', paneKey: 'inst:macd:1', delta: -1 }).cs).toEqual(json(movePane(cs, paneKeys, 'inst:macd:1', -1, opts)))
    expect(refusal(cs, { op: 'movePane', paneKey: 'price', delta: -1 })).toMatchObject({ ok: false, reason: 'no-change' })
    expect(refusal(cs, { op: 'movePane', paneKey: 'nope', delta: 1 })).toMatchObject({ ok: false, reason: 'not-found', detail: { panes: expect.any(Array) } })
    expect(refusal(cs, { op: 'movePane', paneKey: 'inst:rsi:1' })).toMatchObject({ ok: false, reason: 'bad-request' })
  })
  it('setPaneSize = setPaneSize; null returns it to automatic; out-of-band shares are refused; Undo is exact', () => {
    const cs = chart()
    const r = run(cs, { op: 'setPaneSize', paneKey: 'inst:rsi:1', share: 0.3 })
    expect(r.cs).toEqual(json(setPaneSize(cs, 'inst:rsi:1', 0.3)))
    expect(r.receipt.change).toMatchObject({ what: 'paneSize', before: null, after: 0.3 })
    const auto = run(r.cs, { op: 'setPaneSize', paneKey: 'inst:rsi:1', share: null })
    expect(auto.receipt.change).toMatchObject({ before: 0.3, after: null })
    expect(refusal(cs, { op: 'setPaneSize', paneKey: 'inst:rsi:1', share: 0.95 })).toMatchObject({ ok: false, reason: 'bad-input', detail: { min: 0.04, max: 0.9 } })
    const u = runUndo(r.cs, r.undo)
    expect(u.cs.paneSizes || {}).toEqual(cs.paneSizes || {})
  })
  it('a pane plan is refused once the stack moves; its Undo is refused once the stack moves again', () => {
    const cs = chart()
    const p = planIndicatorMutation(cs, { op: 'movePane', paneKey: 'inst:rsi:1', beforeKey: 'price' }, ctx())
    const { paneKeys, opts } = paneArrangeArgs(cs, registry, VOL)
    const moved = movePane(cs, paneKeys, 'inst:macd:1', -1, opts)
    expect(applyIndicatorMutation(moved, p.plan, ctx())).toMatchObject({ ok: false, reason: 'changed-while-working', detail: { what: 'panes' } })
    const r = run(cs, { op: 'setPaneSize', paneKey: 'inst:rsi:1', share: 0.3 })
    const again = json(setPaneSize(r.cs, 'inst:macd:1', 0.2))
    expect(undoIndicatorMutation(again, r.undo, ctx())).toMatchObject({ ok: false, reason: 'restore-conflict' })
    expect(paneFingerprint(cs, registry, VOL)).toMatch(/^pf:\d+:[0-9a-f]{8}$/)
  })
})

describe('I-7 duplicate — "add another one like that"', () => {
  it('equals duplicateInstance (a NEW identity, everything configured travels), and Undo removes only the copy', () => {
    const cs = chart()
    const styled = run(cs, { op: 'setAppearance', instanceId: 'inst:movingAverage:20', key: 'lineWidth', value: 2 }).cs
    const r = run(styled, { op: 'duplicate', instanceId: 'inst:movingAverage:20' })
    expect(r.cs).toEqual(json(duplicateInstance(styled, 'inst:movingAverage:20', registry)))
    const [copyId] = r.receipt.instanceIds
    expect(copyId).not.toBe('inst:movingAverage:20')
    expect(findInstance(r.cs, copyId)).toMatchObject({ defId: 'movingAverage', inputs: { period: 20, maType: 'ema' }, presentation: { lineWidth: 2 } })
    const u = runUndo(r.cs, r.undo)
    expect(instancesOf(u.cs, registry).some((x) => x.instanceId === copyId)).toBe(false)
    expect(instancesOf(u.cs, registry).some((x) => x.instanceId === 'inst:movingAverage:20')).toBe(true)
  })
  it('a saved formula the member does not own is never duplicated; read-only charts refuse', () => {
    const cs = chart([{ instanceId: `inst:${FOREIGN}:1`, defId: FOREIGN, defVersion: 1, inputs: {}, hidden: false }])
    expect(refusal(cs, { op: 'duplicate', instanceId: `inst:${FOREIGN}:1` })).toMatchObject({ ok: false, reason: 'unknown-definition' })
    expect(refusal(cs, { op: 'duplicate', instanceId: 'inst:rsi:1' }, ctx({ canManage: false }))).toMatchObject({ ok: false, reason: 'readonly' })
    expect(run(cs, { op: 'duplicate', instanceId: `inst:${SAVED}:1` }).receipt.defId).toBe(SAVED)
  })
  it('Undo is refused while something reads the copy', () => {
    const cs = chart()
    const r = run(cs, { op: 'duplicate', instanceId: 'inst:rsi:1' })
    const [copyId] = r.receipt.instanceIds
    const reading = json(setInstanceInput(r.cs, 'inst:movingAverage:20', 'source', `@${copyId}::rsi`, registry))
    expect(undoIndicatorMutation(reading, r.undo, ctx())).toMatchObject({ ok: false })
  })
})

describe('I-8 copyFrom — "copy these indicators to the chart on the right"', () => {
  it('equals the template layer\'s capture + apply; a source link is re-pointed at the copy', () => {
    const left = chart()
    const right = load(mergeChartSettings(null))
    const ids = ['inst:rsi:1', 'inst:movingAverage:9']
    const r = run(right, { op: 'copyFrom', sourceCs: left, instanceIds: ids }, ctx({ chartId: 'c2' }))
    const cap = captureIndicatorTemplate(left, registry, { name: 'Agent copy', id: 'agent-copy', now: 0, onlyIds: ids })
    expect(r.cs).toEqual(json(applyIndicatorTemplate(right, cap.template, registry).cs))
    expect(r.receipt.copied.map((c) => c.name).length).toBe(2)
    const rsiCopy = r.receipt.copied.map((c) => findInstance(r.cs, c.instanceId)).find((i) => i.defId === 'rsi')
    const maCopy = r.receipt.copied.map((c) => findInstance(r.cs, c.instanceId)).find((i) => i.defId === 'movingAverage')
    expect(maCopy.inputs.source).toBe(`@${rsiCopy.instanceId}::rsi`)
    expect(r.receipt.chartId).toBe('c2')
    const u = runUndo(r.cs, r.undo, ctx({ chartId: 'c2' }))
    expect(instancesOf(u.cs, registry).filter((x) => !x.setting).map((x) => x.instanceId)).toEqual(instancesOf(right, registry).filter((x) => !x.setting).map((x) => x.instanceId))
  })
  it('an identical indicator already on the target is reported as already there; all-present is a no-change', () => {
    const left = chart()
    const right = load(mergeChartSettings(null))
    const once = run(right, { op: 'copyFrom', sourceCs: left, instanceIds: ['inst:rsi:1'] })
    const again = planIndicatorMutation(once.cs, { op: 'copyFrom', sourceCs: left, instanceIds: ['inst:rsi:1'] }, ctx())
    expect(again).toMatchObject({ ok: false, reason: 'no-change', detail: { already: [{ instanceId: once.receipt.instanceIds[0] }] } })
    const mixed = run(once.cs, { op: 'copyFrom', sourceCs: left, instanceIds: ['inst:rsi:1', 'inst:macd:1'] })
    expect(mixed.receipt.already.map((a) => a.instanceId)).toEqual(once.receipt.instanceIds)
    expect(mixed.receipt.copied).toHaveLength(1)
  })
  it('refuses an unknown source instance and a foreign saved formula', () => {
    const left = chart([{ instanceId: `inst:${FOREIGN}:1`, defId: FOREIGN, defVersion: 1, inputs: {}, hidden: false }])
    const right = load(mergeChartSettings(null))
    expect(refusal(right, { op: 'copyFrom', sourceCs: left, instanceIds: ['inst:nope:1'] })).toMatchObject({ ok: false, reason: 'not-found' })
    expect(refusal(right, { op: 'copyFrom', sourceCs: left, instanceIds: [`inst:${FOREIGN}:1`] })).toMatchObject({ ok: false, reason: 'unknown-definition' })
    expect(refusal(right, { op: 'copyFrom', instanceIds: ['inst:rsi:1'] })).toMatchObject({ ok: false, reason: 'bad-request' })
  })
})

describe('apply to several charts — planAcrossCharts', () => {
  it('one plan per chart, each with its own chartId; a refusing chart does not stop the others', () => {
    const left = chart()
    const charts = [
      { chartId: 'a', cs: load(mergeChartSettings(null)), ctx: ctx() },
      { chartId: 'b', cs: load(mergeChartSettings(null)), ctx: ctx({ canManage: false }) },
      { chartId: 'c', cs: load(mergeChartSettings(null)), ctx: ctx() },
    ]
    const plans = planAcrossCharts(charts, { op: 'copyFrom', sourceCs: left, instanceIds: ['inst:rsi:1'] })
    expect(plans.map((p) => [p.chartId, p.ok, p.reason || null])).toEqual([['a', true, null], ['b', false, 'readonly'], ['c', true, null]])
    const a = applyIndicatorMutation(charts[0].cs, plans[0].plan, ctx({ chartId: 'a' }))
    expect(confirmIndicatorMutation(json(a.cs), a.pending, ctx({ chartId: 'a' })).receipt.chartId).toBe('a')
  })
})

describe('I-10 structured target, I-11 rows, I-12 receipt', () => {
  it('"the 20 EMA" resolves by definition + inputs; ambiguity returns candidates; ordinal picks one', () => {
    const cs = chart()
    // a default chart already carries an adopted EMA 20 (`ovl:*`), so "the 20 EMA" alone is AMBIGUOUS
    const two = resolveIndicatorTarget(cs, registry, { defId: 'movingAverage', inputs: { period: 20, maType: 'ema' } })
    expect(two.reason).toBe('ambiguous')
    expect(two.detail.candidates.map((c) => c.instanceId)).toContain('inst:movingAverage:20')
    expect(resolveIndicatorTarget(cs, registry, { defId: 'movingAverage', inputs: { period: 20, maType: 'ema', color: '#2196f3' } })).toMatchObject({ ok: true, instanceId: 'inst:movingAverage:20' })
    expect(resolveIndicatorTarget(cs, registry, { defId: 'movingAverage', inputs: { period: '20', color: '#2196f3' } })).toMatchObject({ ok: true, instanceId: 'inst:movingAverage:20' })
    const amb = resolveIndicatorTarget(cs, registry, { defId: 'movingAverage', inputs: { maType: 'ema' } })
    expect(amb.reason).toBe('ambiguous')
    expect(amb.detail.candidates.map((c) => c.instanceId)).toEqual(expect.arrayContaining(['inst:movingAverage:9', 'inst:movingAverage:20']))
    expect(resolveIndicatorTarget(cs, registry, { defId: 'movingAverage', inputs: { maType: 'ema' }, ordinal: -1 }).ok).toBe(true)
    expect(resolveIndicatorTarget(cs, registry, { defId: 'movingAverage', inputs: { period: 199 } })).toMatchObject({ ok: false, reason: 'not-found' })
    // the existing forms are unchanged
    expect(resolveIndicatorTarget(cs, registry, { instanceId: 'inst:rsi:1' })).toMatchObject({ ok: true, instanceId: 'inst:rsi:1' })
  })
  it('instancesOf rows carry inputs, presentation, hiddenVia, displayTarget and paneKey', () => {
    const rows = instancesOf(chart(), registry)
    expect(rows.find((r) => r.instanceId === 'inst:movingAverage:9')).toMatchObject({ inputs: { period: 9, maType: 'ema' }, displayTarget: '@inst:rsi:1', paneKey: 'inst:rsi:1', hiddenVia: null })
    expect(rows.find((r) => r.instanceId === 'inst:movingAverage:20')).toMatchObject({ displayTarget: 'price', paneKey: 'price' })
    expect(rows.find((r) => r.instanceId === 'inst:macd:1').presentation).toEqual({ plots: { histogram: { signColors: true } } })
  })
  it('every confirmed receipt — old ops included — carries instanceFingerprintAfter from the read-back', () => {
    const cs = chart()
    for (const req of [{ op: 'setVisible', instanceId: 'inst:rsi:1', visible: false }, { op: 'add', defId: 'atr' }, { op: 'setColor', instanceId: 'inst:rsi:1', target: 'input:color', color: '#ffffff' }]) {
      const r = run(cs, req)
      expect(r.receipt.instanceFingerprintAfter).toBe(instanceFingerprint(r.cs))
    }
  })
  it('styleOptionsOf lists exactly what the ops accept', () => {
    const o = styleOptionsOf(chart(), registry, 'inst:movingAverage:20')
    expect(o.appearance.map((a) => a.key).sort()).toEqual(['lineStyle', 'lineWidth', 'overlap'])
    expect(o.colors).toEqual([expect.objectContaining({ target: 'input:color', current: '#2196f3' })])
    expect(o.displayTarget.options[0]).toEqual({ value: 'auto', label: 'Automatic' })
    expect(styleOptionsOf(chart(), registry, 'inst:nope:1')).toMatchObject({ ok: false, reason: 'not-found' })
  })
})

describe('staleness and permission across the new ops', () => {
  it('an edit plan is refused once the instance changes; its Undo once it changes again', () => {
    const cs = chart()
    const p = planIndicatorMutation(cs, { op: 'setAppearance', instanceId: 'inst:movingAverage:20', key: 'lineWidth', value: 3 }, ctx())
    const touched = setInstanceInput(cs, 'inst:movingAverage:20', 'period', 21, registry)
    expect(applyIndicatorMutation(touched, p.plan, ctx())).toMatchObject({ ok: false, reason: 'changed-while-working', detail: { what: 'indicator' } })
    const r = run(cs, { op: 'setPlotStyle', instanceId: 'inst:movingAverage:20', style: 'area' })
    const later = json(setInstanceInput(r.cs, 'inst:movingAverage:20', 'period', 21, registry))
    expect(undoIndicatorMutation(later, r.undo, ctx())).toMatchObject({ ok: false, reason: 'restore-conflict' })
  })
  it('access lost between plan and apply is permission-changed; a board revision move is changed-while-working', () => {
    const cs = chart()
    const p = planIndicatorMutation(cs, { op: 'setColor', instanceId: 'inst:rsi:1', target: 'input:color', color: '#ffffff' }, ctx({ boardRevision: 3 }))
    expect(applyIndicatorMutation(cs, p.plan, ctx({ canManage: false }))).toMatchObject({ ok: false, reason: 'permission-changed' })
    expect(applyIndicatorMutation(cs, p.plan, ctx({ boardRevision: 4 }))).toMatchObject({ ok: false, reason: 'changed-while-working', detail: { what: 'board' } })
    const r = run(cs, { op: 'setColor', instanceId: 'inst:rsi:1', target: 'input:color', color: '#ffffff' })
    expect(undoIndicatorMutation(r.cs, r.undo, ctx({ canManage: false }))).toMatchObject({ ok: false, reason: 'permission-changed' })
  })
  it('a read-back that does not show the change is did-not-land, never confirmed', () => {
    const cs = chart()
    const p = planIndicatorMutation(cs, { op: 'setAppearance', instanceId: 'inst:movingAverage:20', key: 'lineWidth', value: 3 }, ctx())
    const a = applyIndicatorMutation(cs, p.plan, ctx())
    expect(confirmIndicatorMutation(json(cs), a.pending, ctx()).status).toBe('did-not-land')
    expect(confirmIndicatorMutation(null, a.pending, ctx()).status).toBe('unconfirmed')
  })
})
