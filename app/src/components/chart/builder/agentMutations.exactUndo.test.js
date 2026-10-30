// app/src/components/chart/builder/agentMutations.exactUndo.test.js — WS3, exact Undo
//
// The Agent's Undo (`undoIndicatorMutation`) must restore the STORED chart settings, not
// merely what the chart draws. Agent Phase 2 measured (PHASE2-NL-INTELLIGENCE.md, "Note
// for Indicators"): "add rsi" -> "undo" on a chart on its default style preset left
//   indicatorInstances  a tombstone `{instanceId:'inst:rsi:1', deleted:true}` appended
//   indicators.rsi      `{enabled:false}` where there was no entry
//   preset              'custom' where it was 'classic'
// because Undo-of-add ran the product's DELETE (`removeInstance`) instead of reverting
// the add. Every assertion here compares the canonical stored state (the settings as the
// chart reads them back after a save), never the visible output.
import { describe, it, expect, beforeAll, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import * as registry from '../engine/nativeRegistry'
import { mergeChartSettings } from '../chartDefaults'
import { adoptOverlayAverages } from '../maAdoption'
import { findInstance, setInstanceHidden } from '../engine/instanceControls'
import { changeRecord } from '../engine/settingsRecord'
import {
  REASONS, planIndicatorMutation, applyIndicatorMutation, confirmIndicatorMutation, undoIndicatorMutation,
} from './agentMutations'

const SAVED = 'u_aaaaaaaaaac7'
beforeAll(() => {
  const FIX = JSON.parse(fs.readFileSync(path.resolve(globalThis.process.cwd(), '..', 'tests/fixtures/authoring/batch2_definitions.json'), 'utf8'))
  const res = registry.installUserDefinitions([{ ...FIX.styled_markers, id: SAVED, version: 2 }])
  expect(res.errors, JSON.stringify(res.errors)).toEqual([])
})

const view = (cs) => adoptOverlayAverages(cs) || cs
const json = (v) => JSON.parse(JSON.stringify(v))
/** As the chart reads its settings back after a save: stored (JSON), merged, adopted. */
const load = (cs) => view(mergeChartSettings(JSON.stringify(cs)))
const VOL = { volumeSeparatePane: true, blankVolume: false }
const ctx = (over = {}) => ({ canManage: true, ownedDefinitionIds: [SAVED], registry, chartId: 'c1', volumeOpts: VOL, ...over })
/** Names every stored field that differs — the failure message IS the defect report. */
const diff = (a, b) => changeRecord(load(a), load(b)).paths.map((p) => JSON.stringify(p.path))
const expectSameStored = (actual, expected) => expect(diff(expected, actual)).toEqual([])

/** A fresh chart on its DEFAULT style preset (never touched by a writer). */
const fresh = () => load(mergeChartSettings(null))
/** The default preset, plus RSI and MACD in their own panes, as loaded — still 'classic'. */
function withPanes() {
  const base = mergeChartSettings(null)
  return load({
    ...base,
    indicatorInstances: [
      ...(base.indicatorInstances || []),
      { instanceId: 'inst:rsi:1', defId: 'rsi', inputs: { period: 14 }, hidden: false },
      { instanceId: 'inst:macd:1', defId: 'macd', inputs: {}, hidden: false },
    ],
    indicators: { ...(base.indicators || {}), rsi: { enabled: true }, macd: { enabled: true } },
  })
}

function run(cs, request, c = ctx()) {
  const p = planIndicatorMutation(cs, request, c)
  expect(p.ok, JSON.stringify(p)).toBe(true)
  const a = applyIndicatorMutation(cs, p.plan, c)
  expect(a.ok, JSON.stringify(a)).toBe(true)
  const persisted = json(a.cs)
  const done = confirmIndicatorMutation(persisted, a.pending, c)
  expect(done.status).toBe('confirmed')
  return { cs: persisted, undo: done.undo, receipt: done.receipt }
}
function runUndo(cs, undo, c = ctx()) {
  const u = undoIndicatorMutation(cs, undo, c)
  expect(u.ok, JSON.stringify(u)).toBe(true)
  const persisted = json(u.cs)
  const done = confirmIndicatorMutation(persisted, u.pending, c)
  expect(done.status).toBe('confirmed')
  return { cs: persisted, receipt: done.receipt }
}

describe('add -> Undo restores the stored settings exactly', () => {
  it('the Phase 2 repro: a default-preset chart, "add rsi", "undo" — no tombstone, no mirror, preset back', () => {
    const cs = fresh()
    expect(cs.preset).toBe('classic')
    const r = run(cs, { op: 'add', defId: 'rsi' })
    expect(r.cs.preset).toBe('custom')
    const back = runUndo(r.cs, r.undo)
    expectSameStored(back.cs, cs)
    expect(back.cs.preset).toBe('classic')
    expect(back.cs.indicatorInstances.some((i) => i.instanceId === 'inst:rsi:1')).toBe(false)   // no tombstone
    expect(back.cs.indicators?.rsi).toBeUndefined()
    expect(back.receipt).toMatchObject({ op: 'undo', undoOf: 'add', status: 'confirmed', instanceIds: ['inst:rsi:1'] })
  })
  it('the same after a store round trip between the add and the Undo', () => {
    const cs = fresh()
    const r = run(cs, { op: 'add', defId: 'rsi' })
    expectSameStored(runUndo(load(r.cs), r.undo).cs, cs)
  })
  it('an add WITH settings ("add a 34 EMA") is undone exactly too', () => {
    const cs = fresh()
    const r = run(cs, { op: 'add', defId: 'movingAverage', inputs: { period: 34, maType: 'ema' } })
    expectSameStored(runUndo(r.cs, r.undo).cs, cs)
  })
  it('a re-add after the Undo gets the SAME id the first add had (no tombstone renumbering)', () => {
    const cs = fresh()
    const r = run(cs, { op: 'add', defId: 'rsi' })
    const back = runUndo(r.cs, r.undo)
    expect(run(back.cs, { op: 'add', defId: 'rsi' }).receipt.instanceIds).toEqual(r.receipt.instanceIds)
  })
  it('a saved (member) definition: Undo removes it from the chart and never touches the saved definition', () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(() => { throw new Error('no network expected') })
    try {
      const cs = fresh()
      const r = run(cs, { op: 'add', defId: SAVED })
      expectSameStored(runUndo(r.cs, r.undo).cs, cs)
      expect(registry.getDefinition(SAVED)).toBeTruthy()
      expect(fetchSpy).not.toHaveBeenCalled()
    } finally { fetchSpy.mockRestore() }
  })
})

describe('the other ops -> Undo, on a default-preset chart', () => {
  const cases = [
    ['hide', { op: 'setVisible', instanceId: 'inst:rsi:1', visible: false }],
    ['inputs', { op: 'setInputs', instanceId: 'inst:rsi:1', inputs: { period: 21 } }],
    ['style', { op: 'setAppearance', instanceId: 'ovl:1', key: 'lineWidth', value: 3 }],
    ['colour', { op: 'setColor', instanceId: 'inst:rsi:1', target: 'input:color', color: '#22c55e' }],
    ['placement', { op: 'setDisplayTarget', instanceId: 'inst:rsi:1', target: 'price' }],
    ['pane move', { op: 'movePane', paneKey: 'inst:macd:1', beforeKey: 'inst:rsi:1' }],
    ['pane size', { op: 'setPaneSize', paneKey: 'inst:rsi:1', share: 0.3 }],
    ['remove (a pane goes away)', { op: 'remove', instanceId: 'inst:macd:1' }],
    ['duplicate (a pane is created)', { op: 'duplicate', instanceId: 'inst:rsi:1' }],
  ]
  for (const [label, request] of cases) {
    it(`${label} -> Undo: stored settings identical, preset back to 'classic'`, () => {
      const cs = withPanes()
      expect(cs.preset).toBe('classic')
      const r = run(cs, request)
      const back = runUndo(r.cs, r.undo)
      expectSameStored(back.cs, cs)
      expect(back.cs.preset).toBe('classic')
    })
  }
})

describe('several ops, then Undo each in reverse', () => {
  it('add -> hide -> style -> pane move, undone newest first, lands exactly on each earlier state', () => {
    const cs = withPanes()
    const a = run(cs, { op: 'add', defId: 'stoch' })
    const b = run(a.cs, { op: 'setVisible', instanceId: 'inst:rsi:1', visible: false })
    const c = run(b.cs, { op: 'setAppearance', instanceId: 'ovl:1', key: 'lineWidth', value: 3 })
    const d = run(c.cs, { op: 'movePane', paneKey: 'inst:stoch:1', beforeKey: 'inst:macd:1' })   // RSI is hidden: no pane
    let s = runUndo(d.cs, d.undo).cs
    expectSameStored(s, c.cs)
    s = runUndo(s, c.undo).cs
    expectSameStored(s, b.cs)
    s = runUndo(s, b.undo).cs
    expectSameStored(s, a.cs)
    s = runUndo(s, a.undo).cs
    expectSameStored(s, cs)
    expect(s.preset).toBe('classic')
  })
  it("two adds, undone in either order: newest-first is exact; out of order only the preset stamp stays 'custom'", () => {
    const cs = fresh()
    const a = run(cs, { op: 'add', defId: 'rsi' })
    const b = run(a.cs, { op: 'add', defId: 'macd' })
    // newest first
    expectSameStored(runUndo(runUndo(b.cs, b.undo).cs, a.undo).cs, cs)
    // oldest first: the second add survives the first Undo, then the second Undo is exact
    const first = runUndo(b.cs, a.undo).cs
    expect(findInstance(first, a.receipt.instanceIds[0])).toBeNull()
    expect(findInstance(first, b.receipt.instanceIds[0])).toBeTruthy()
    expect(first.preset).toBe('custom')                 // MACD is still there: the chart is not as it was
    // ⚠️ OUT OF ORDER, the preset stamp is the one thing not restored: MACD's own token was
    // minted on an already-'custom' chart, and no token knows the state before the first
    // add. Conservative on purpose — Undo never labels a chart pristine without proof.
    const last = runUndo(first, b.undo).cs
    expectSameStored(last, { ...cs, preset: 'custom' })
  })
})

describe('stale state — unrelated changes survive, conflicts refuse', () => {
  it('add, then an unrelated change: Undo removes ONLY the add; the change and its "custom" survive', () => {
    const cs = fresh()
    const r = run(cs, { op: 'add', defId: 'rsi' })
    const later = json({ ...setInstanceHidden(r.cs, 'ovl:2', true, registry), background: '#101010' })
    const back = runUndo(later, r.undo).cs
    expect(findInstance(back, 'inst:rsi:1')).toBeNull()
    expect(back.indicatorInstances.some((i) => i.instanceId === 'inst:rsi:1')).toBe(false)
    expect(findInstance(back, 'ovl:2').hidden).toBe(true)
    expect(back.background).toBe('#101010')
    // the chart still differs from the preset (the member's own change), so it stays 'custom'
    expect(back.preset).toBe('custom')
    // and everything except the add is exactly what the member had
    const expected = json({ ...setInstanceHidden(cs, 'ovl:2', true, registry), background: '#101010', preset: 'custom' })
    expectSameStored(back, expected)
  })
  it('add, then a different style preset applied: Undo removes the add and keeps that preset', () => {
    const cs = fresh()
    const r = run(cs, { op: 'add', defId: 'rsi' })
    const back = runUndo(json({ ...r.cs, preset: 'oled' }), r.undo).cs
    expect(findInstance(back, 'inst:rsi:1')).toBeNull()
    expect(back.preset).toBe('oled')
  })
  it('add, then the member edits the added instance: Undo refuses and writes nothing', () => {
    const r = run(fresh(), { op: 'add', defId: 'rsi' })
    const edited = json(r.cs)
    edited.indicatorInstances.find((i) => i.instanceId === 'inst:rsi:1').inputs.period = 30
    expect(undoIndicatorMutation(edited, r.undo, ctx())).toMatchObject({ ok: false, reason: REASONS.RESTORE_CONFLICT })
  })
  it('add, then the instance was already removed: Undo refuses', () => {
    const r = run(fresh(), { op: 'add', defId: 'rsi' })
    const gone = run(r.cs, { op: 'remove', instanceId: 'inst:rsi:1' }).cs
    expect(undoIndicatorMutation(gone, r.undo, ctx())).toMatchObject({ ok: false, reason: REASONS.RESTORE_CONFLICT })
  })
  it('hide, then an unrelated change: Undo puts only the flag back; the chart stays "custom"', () => {
    const cs = withPanes()
    const r = run(cs, { op: 'setVisible', instanceId: 'inst:rsi:1', visible: false })
    const back = runUndo(json({ ...r.cs, background: '#101010' }), r.undo).cs
    expect(findInstance(back, 'inst:rsi:1').hidden).toBe(false)
    expect(back.background).toBe('#101010')
    expect(back.preset).toBe('custom')
  })
  it('a preset change after an op never blocks its Undo', () => {
    const cs = withPanes()
    const r = run(cs, { op: 'setVisible', instanceId: 'inst:rsi:1', visible: false })
    const back = runUndo(json({ ...r.cs, preset: 'tradingview' }), r.undo).cs
    expect(findInstance(back, 'inst:rsi:1').hidden).toBe(false)
    expect(back.preset).toBe('tradingview')
  })
})
