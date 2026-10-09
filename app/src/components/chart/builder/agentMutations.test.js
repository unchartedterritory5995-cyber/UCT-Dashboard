// app/src/components/chart/builder/agentMutations.test.js — Agent Milestone 2, Indicators half
//
// The four operations (add, remove, show/hide, Undo) through the SAME writers as the
// product UI, with permission re-checks, stale-state refusals, persistence read-back and
// exact, identity-preserving Undo. Real registry, real saved definition, real settings.
import { describe, it, expect, beforeAll } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import * as registry from '../engine/nativeRegistry'
import { mergeChartSettings } from '../chartDefaults'
import { addInstance, removeInstance, setInstanceHidden, findInstance, withInstances } from '../engine/instanceControls'
import { createFromResult, technicalResults } from '../discoveryCatalog'
import { adoptOverlayAverages } from '../maAdoption'
import { instancesOf, instanceFingerprint } from './agentSeams'
import {
  REASONS, MUTATION_CONTRACT, planIndicatorMutation, applyIndicatorMutation, confirmIndicatorMutation,
  undoIndicatorMutation, removeInstanceWithRecord, restoreRemoved, dependentsOf, groupFingerprint,
  checkIndicatorPermission, resolveIndicatorTarget,
} from './agentMutations'

const SAVED = 'u_aaaaaaaaaab2'
beforeAll(() => {
  const FIX = JSON.parse(fs.readFileSync(path.resolve(globalThis.process.cwd(), '..', 'tests/fixtures/authoring/batch2_definitions.json'), 'utf8'))
  const res = registry.installUserDefinitions([{ ...FIX.styled_markers, id: SAVED, version: 4 }])
  expect(res.errors, JSON.stringify(res.errors)).toEqual([])
})

const view = (cs) => adoptOverlayAverages(cs) || cs
const json = (v) => JSON.parse(JSON.stringify(v))
const ctx = (over = {}) => ({ canManage: true, ownedDefinitionIds: [SAVED], registry, chartId: 'c1', ...over })

/** A chart with RSI, an MA reading RSI, a header value reading RSI, MACD hidden. */
function chart() {
  const base = mergeChartSettings(null)
  // as a real chart holds it: stored (JSON), read back through the merge, its list in the
  // writers' order (every product write goes through `withInstances`)
  const load = (cs) => view(mergeChartSettings(JSON.stringify(cs)))
  const raw = load({
    ...base,
    indicatorInstances: [
      ...(base.indicatorInstances || []),
      { instanceId: 'inst:rsi:1', defId: 'rsi', inputs: { period: 14 }, hidden: false },
      { instanceId: 'inst:movingAverage:9', defId: 'movingAverage', inputs: { source: '@inst:rsi:1::rsi', period: 9, maType: 'ema', color: '#ff9800' }, hidden: false },
      { instanceId: 'inst:macd:1', defId: 'macd', inputs: {}, hidden: true },
    ],
    indicators: { ...(base.indicators || {}), rsi: { enabled: true }, macd: { enabled: true } },
    header: { ...(base.header || {}), infoValues: [{ instanceId: 'inst:rsi:1', plotKey: 'rsi', format: 'auto' }] },
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

describe('equivalence with the product UI writers', () => {
  it('add = Add to Chart (createFromResult → addInstance), byte for byte — built-in and saved', () => {
    const cs = chart()
    for (const defId of ['stoch', SAVED]) {
      const ui = createFromResult(cs, technicalResults(registry).find((r) => r.id === defId) || { create: { via: 'definition', defId }, capability: 'chartable' }, registry)
      expect(run(cs, { op: 'add', defId }).cs).toEqual(json(ui))
    }
  })
  it('remove = Chart Settings ✕ / legend Delete (removeInstance); hide = the eye (setInstanceHidden)', () => {
    const cs = chart()
    expect(run(cs, { op: 'remove', instanceId: 'inst:rsi:1' }).cs).toEqual(json(removeInstance(cs, 'inst:rsi:1', registry)))
    expect(run(cs, { op: 'setVisible', instanceId: 'inst:rsi:1', visible: false }).cs).toEqual(json(setInstanceHidden(cs, 'inst:rsi:1', true, registry)))
    expect(run(cs, { op: 'setVisible', instanceId: 'inst:macd:1', visible: true }).cs).toEqual(json(setInstanceHidden(cs, 'inst:macd:1', false, registry)))
  })
  it('a classic average (ovl:) is removed and hidden as the instance the settings rows show', () => {
    const cs = chart()
    const ovl = instancesOf(cs, registry).find((r) => r.instanceId.startsWith('ovl:'))
    expect(ovl).toBeTruthy()
    const r = run(cs, { op: 'remove', instanceId: ovl.instanceId })
    expect(instancesOf(r.cs, registry).some((x) => x.instanceId === ovl.instanceId)).toBe(false)
    const back = runUndo(r.cs, r.undo)
    expect(back.cs).toEqual(json(cs))
  })
})

describe('receipts are deterministic and come only from a confirmed read-back', () => {
  it('add receipt names the new instance; Undo token is minted only on confirmation', () => {
    const r = run(chart(), { op: 'add', defId: SAVED })
    expect(r.receipt).toMatchObject({ contract: MUTATION_CONTRACT, op: 'add', status: 'confirmed', defId: SAVED, chartId: 'c1' })
    expect(r.receipt.instanceIds).toEqual([`inst:${SAVED}:1`])
    expect(typeof r.receipt.name).toBe('string')
    expect(r.undo).toMatchObject({ kind: 'undo', op: 'add', ids: [`inst:${SAVED}:1`] })
  })
  it('remove receipt lists exactly what was severed (and the plan showed it first)', () => {
    const p = planIndicatorMutation(chart(), { op: 'remove', instanceId: 'inst:rsi:1' }, ctx())
    expect(p.plan.preview.severs.map((d) => [d.kind, d.instanceId || d.index, d.reads])).toEqual([
      ['infoValue', 0, 'inst:rsi:1'], ['source', 'inst:movingAverage:9', 'inst:rsi:1']])
    const r = run(chart(), { op: 'remove', instanceId: 'inst:rsi:1' })
    expect(r.receipt.severed).toEqual(p.plan.preview.severs)
  })
  it('⛔ no read-back → unconfirmed, no Undo; a read-back without the change → did-not-land', () => {
    const cs = chart()
    const p = planIndicatorMutation(cs, { op: 'setVisible', instanceId: 'inst:rsi:1', visible: false }, ctx())
    const a = applyIndicatorMutation(cs, p.plan, ctx())
    const none = confirmIndicatorMutation(null, a.pending, ctx())
    expect(none).toMatchObject({ status: 'unconfirmed', reason: REASONS.UNCONFIRMED, receipt: { status: 'unconfirmed' } })
    expect(none.undo).toBeUndefined()
    const stale = confirmIndicatorMutation(json(cs), a.pending, ctx())   // persist lost: the store still has the old blob
    expect(stale).toMatchObject({ status: 'did-not-land', reason: REASONS.NOT_LANDED })
    expect(stale.mismatch.path).toEqual(['indicatorInstances', { instanceId: 'inst:rsi:1' }, 'hidden'])
    // delayed acknowledgement: confirming later against the landed copy still works
    expect(confirmIndicatorMutation(json(a.cs), a.pending, ctx()).status).toBe('confirmed')
  })
})

describe('⭐ exact Undo', () => {
  it('remove → Undo restores the SAME ids, positions, inputs and every severed reference — byte-identical', () => {
    const cs = chart()
    const r = run(cs, { op: 'remove', instanceId: 'inst:rsi:1' })
    expect(findInstance(r.cs, 'inst:rsi:1')).toBeNull()
    expect(findInstance(r.cs, 'inst:movingAverage:9').inputs.source).not.toBe('@inst:rsi:1::rsi')   // severed
    expect(r.cs.header.infoValues[0].severed).toBe(true)
    const back = runUndo(r.cs, r.undo)
    expect(back.cs).toEqual(json(cs))
    expect(back.receipt).toMatchObject({ op: 'undo', status: 'confirmed', undoOf: 'remove', instanceIds: ['inst:rsi:1'] })
    expect(back.receipt.restored.map((d) => [d.kind, d.reads])).toEqual([['infoValue', 'inst:rsi:1'], ['source', 'inst:rsi:1']])
    expect(back.receipt.severed).toBeUndefined()
    expect(back.cs.indicatorInstances.map((i) => i.instanceId)).toEqual(cs.indicatorInstances.map((i) => i.instanceId))
  })
  it('reload between remove and Undo (store round trip) keeps the Undo exact', () => {
    const cs = chart()
    const r = run(cs, { op: 'remove', instanceId: 'inst:rsi:1' })
    const reloaded = view(mergeChartSettings(JSON.stringify(r.cs)))
    expect(runUndo(reloaded, r.undo).cs).toEqual(json(view(mergeChartSettings(JSON.stringify(cs)))))
  })
  it('an unrelated edit after the remove (another indicator, theme, timeframe) does not block Undo', () => {
    const cs = chart()
    const r = run(cs, { op: 'remove', instanceId: 'inst:rsi:1' })
    let other = setInstanceHidden(r.cs, 'inst:macd:1', false, registry)
    other = { ...other, background: '#101010', timeframe: '1W' }
    const back = runUndo(json(other), r.undo)
    expect(findInstance(back.cs, 'inst:rsi:1')).toMatchObject({ instanceId: 'inst:rsi:1', inputs: { period: 14 } })
    expect(findInstance(back.cs, 'inst:movingAverage:9').inputs.source).toBe('@inst:rsi:1::rsi')
    expect(findInstance(back.cs, 'inst:macd:1').hidden).toBe(false)               // the unrelated edit survives
    expect(back.cs.background).toBe('#101010')
  })
  it('⛔ Undo is refused after a conflicting edit — the member re-pointed the severed source', () => {
    const cs = chart()
    const r = run(cs, { op: 'remove', instanceId: 'inst:rsi:1' })
    const edited = json(r.cs)
    edited.indicatorInstances.find((i) => i.instanceId === 'inst:movingAverage:9').inputs.source = 'close'
    const u = undoIndicatorMutation(edited, r.undo, ctx())
    expect(u).toMatchObject({ ok: false, reason: REASONS.RESTORE_CONFLICT })
    expect(u.detail.path).toEqual(['indicatorInstances', { instanceId: 'inst:movingAverage:9' }, 'inputs', 'source'])
  })
  it('⛔ never a new id: re-add the definition, then Undo — the ORIGINAL inst:rsi:1 comes back beside the new one', () => {
    const r = run(chart(), { op: 'remove', instanceId: 'inst:rsi:1' })
    const readded = json(addInstance(r.cs, 'rsi', registry))
    expect(findInstance(readded, 'inst:rsi:2')).toBeTruthy()          // the member's own new RSI
    const back = runUndo(readded, r.undo)
    expect(findInstance(back.cs, 'inst:rsi:1')).toMatchObject({ defId: 'rsi', inputs: { period: 14 } })
    expect(findInstance(back.cs, 'inst:rsi:2')).toBeTruthy()          // a later add is not destroyed
    expect(findInstance(back.cs, 'inst:movingAverage:9').inputs.source).toBe('@inst:rsi:1::rsi')
    expect(back.cs.header.infoValues[0]).toMatchObject({ instanceId: 'inst:rsi:1' })
    expect(back.cs.header.infoValues[0].severed).toBeUndefined()
  })
  it('hide → Undo puts the hidden flag back exactly; refused if the indicator changed since', () => {
    const cs = chart()
    const r = run(cs, { op: 'setVisible', instanceId: 'inst:rsi:1', visible: false })
    expect(runUndo(r.cs, r.undo).cs).toEqual(json(cs))
    const edited = json(r.cs); edited.indicatorInstances.find((i) => i.instanceId === 'inst:rsi:1').inputs.period = 21
    expect(undoIndicatorMutation(edited, r.undo, ctx())).toMatchObject({ ok: false, reason: REASONS.RESTORE_CONFLICT })
  })
  it('add → Undo removes the created instance; refused once something reads it', () => {
    const r = run(chart(), { op: 'add', defId: 'rsi' })
    const id = r.receipt.instanceIds[0]
    const back = runUndo(r.cs, r.undo)
    expect(findInstance(back.cs, id)).toBeNull()
    const reader = json(r.cs)
    reader.indicatorInstances.find((i) => i.instanceId === 'inst:movingAverage:9').inputs.source = `@${id}::rsi`
    expect(undoIndicatorMutation(reader, r.undo, ctx())).toMatchObject({ ok: false, reason: REASONS.DEPENDENT_EXISTS })
  })
})

describe('permission — checked at plan, at apply, at Undo', () => {
  it('read-only chart, foreign or unknown definition, the live preview', () => {
    expect(planIndicatorMutation(chart(), { op: 'add', defId: 'rsi' }, ctx({ canManage: false }))).toMatchObject({ reason: REASONS.READONLY })
    expect(planIndicatorMutation(chart(), { op: 'add', defId: SAVED }, ctx({ ownedDefinitionIds: [] }))).toMatchObject({ reason: REASONS.UNKNOWN_DEFINITION })
    expect(planIndicatorMutation(chart(), { op: 'add', defId: 'u_ffffffffffff' }, ctx({ ownedDefinitionIds: ['u_ffffffffffff'] }))).toMatchObject({ reason: REASONS.UNKNOWN_DEFINITION })
    expect(checkIndicatorPermission('add', { defId: 'u_studio-preview' }, ctx())).toMatchObject({ reason: REASONS.UNKNOWN_DEFINITION })
  })
  it('⛔ access lost between plan and apply → permission-changed, nothing to write', () => {
    const cs = chart()
    const p = planIndicatorMutation(cs, { op: 'remove', instanceId: 'inst:rsi:1' }, ctx())
    expect(applyIndicatorMutation(cs, p.plan, ctx({ canManage: false }))).toMatchObject({ ok: false, reason: REASONS.PERMISSION_CHANGED })
    const pa = planIndicatorMutation(cs, { op: 'add', defId: SAVED }, ctx())
    expect(applyIndicatorMutation(cs, pa.plan, ctx({ ownedDefinitionIds: [] }))).toMatchObject({ ok: false, reason: REASONS.PERMISSION_CHANGED })
  })
  it('⛔ access lost before Undo → refused', () => {
    const r = run(chart(), { op: 'remove', instanceId: 'inst:rsi:1' })
    expect(undoIndicatorMutation(r.cs, r.undo, ctx({ canManage: false }))).toMatchObject({ ok: false, reason: REASONS.PERMISSION_CHANGED })
  })
})

describe('stale state — refused before writing', () => {
  it('remove refused when the target was edited', () => {
    const cs = chart()
    const p = planIndicatorMutation(cs, { op: 'remove', instanceId: 'inst:rsi:1' }, ctx())
    const now = json(cs); now.indicatorInstances.find((i) => i.instanceId === 'inst:rsi:1').inputs.period = 7
    expect(applyIndicatorMutation(now, p.plan, ctx())).toMatchObject({ ok: false, reason: REASONS.CHANGED_WHILE_WORKING, detail: { what: 'indicator' } })
  })
  it('a new MA reading the target between plan and apply → changed-while-working (dependents)', () => {
    const cs = chart()
    const p = planIndicatorMutation(cs, { op: 'remove', instanceId: 'inst:rsi:1' }, ctx())
    const now = json(cs)
    now.indicatorInstances.push({ instanceId: 'inst:movingAverage:10', defId: 'movingAverage', inputs: { source: '@inst:rsi:1::rsi', period: 20, maType: 'sma', color: '#00ff00' }, hidden: false })
    expect(applyIndicatorMutation(now, p.plan, ctx())).toMatchObject({ ok: false, reason: REASONS.CHANGED_WHILE_WORKING, detail: { what: 'dependents' } })
  })
  it('the target was removed elsewhere → not-found', () => {
    const cs = chart()
    const p = planIndicatorMutation(cs, { op: 'setVisible', instanceId: 'inst:rsi:1', visible: false }, ctx())
    expect(applyIndicatorMutation(removeInstance(cs, 'inst:rsi:1', registry), p.plan, ctx())).toMatchObject({ ok: false, reason: REASONS.NOT_FOUND })
  })
  it('a newer definition version → changed-while-working (definition)', () => {
    const cs = chart()
    const p = planIndicatorMutation(cs, { op: 'add', defId: SAVED }, ctx())
    const stale = { ...p.plan, pins: { defVersion: 3 } }
    expect(applyIndicatorMutation(cs, stale, ctx())).toMatchObject({ ok: false, reason: REASONS.CHANGED_WHILE_WORKING, detail: { what: 'definition' } })
  })
  it('board revision moved → changed-while-working (board)', () => {
    const cs = chart()
    const p = planIndicatorMutation(cs, { op: 'add', defId: 'rsi' }, ctx({ boardRevision: 7 }))
    expect(applyIndicatorMutation(cs, p.plan, ctx({ boardRevision: 8 }))).toMatchObject({ ok: false, reason: REASONS.CHANGED_WHILE_WORKING, detail: { what: 'board' } })
  })
  it('⭐ theme, timeframe or another indicator changing does NOT make a plan stale', () => {
    const cs = chart()
    const p = planIndicatorMutation(cs, { op: 'remove', instanceId: 'inst:rsi:1' }, ctx())
    const now = { ...setInstanceHidden(cs, 'inst:macd:1', false, registry), background: '#000000', timeframe: '1W' }
    expect(applyIndicatorMutation(now, p.plan, ctx()).ok).toBe(true)
  })
})

describe('targets, names, multiple charts', () => {
  it('ambiguous names are refused with the candidates; nonexistent ids are not-found', () => {
    const cs = run(chart(), { op: 'add', defId: 'rsi' }).cs
    const names = instancesOf(cs, registry).filter((r) => r.defId === 'rsi').map((r) => r.name)
    expect(names).toEqual(['RSI (14)', 'RSI (14)'])
    const amb = resolveIndicatorTarget(cs, registry, { name: 'rsi (14)' })
    expect(amb).toMatchObject({ ok: false, reason: REASONS.AMBIGUOUS })
    expect(amb.detail.candidates.map((c) => c.instanceId).sort()).toEqual(['inst:rsi:1', 'inst:rsi:2'])
    expect(resolveIndicatorTarget(cs, registry, { name: 'MACD' }).ok).toBe(true)
    expect(resolveIndicatorTarget(cs, registry, { instanceId: 'inst:nope:1' })).toMatchObject({ reason: REASONS.NOT_FOUND })
    expect(planIndicatorMutation(cs, { op: 'remove', instanceId: 'volume' }, ctx())).toMatchObject({ reason: REASONS.NOT_FOUND })
  })
  it('two charts with the same indicators: an Undo token for one chart is refused on the other', () => {
    const a = run(chart(), { op: 'remove', instanceId: 'inst:rsi:1' }, ctx({ chartId: 'left' }))
    expect(undoIndicatorMutation(chart(), a.undo, ctx({ chartId: 'right' }))).toMatchObject({ ok: false, reason: REASONS.BAD_REQUEST })
  })
  it('no-change requests are refused rather than written', () => {
    expect(planIndicatorMutation(chart(), { op: 'setVisible', instanceId: 'inst:macd:1', visible: false }, ctx())).toMatchObject({ reason: REASONS.NO_CHANGE })
  })
})

describe('nothing else moves', () => {
  it('a mutation changes only indicator state: no other top-level settings key differs', () => {
    const cs = chart()
    for (const req of [{ op: 'add', defId: SAVED }, { op: 'remove', instanceId: 'inst:rsi:1' }, { op: 'setVisible', instanceId: 'inst:rsi:1', visible: false }]) {
      const out = run(cs, req).cs
      const moved = Object.keys({ ...cs, ...out }).filter((k) => JSON.stringify(cs[k]) !== JSON.stringify(out[k])).sort()
      for (const k of moved) expect(['indicatorInstances', 'indicators', 'header', 'preset']).toContain(k)
    }
  })
  it('the interface never imports a network, alert or definition-store module', () => {
    const src = fs.readFileSync(path.resolve(globalThis.process.cwd(), 'src/components/chart/builder/agentMutations.js'), 'utf8')
    const imports = src.split('\n').filter((l) => /^import /.test(l)).join('\n')
    expect(imports).not.toMatch(/hooks\/|api|alert|userDefinitions|swr/i)
    expect(src).not.toMatch(/\bfetch\(|XMLHttpRequest|indicator-alerts/)
  })
  it('M1 seams are unchanged: fingerprint, list', () => {
    const cs = chart()
    expect(instanceFingerprint(cs)).toMatch(/^ii:\d+:[0-9a-f]{8}$/)
    expect(groupFingerprint(cs, ['inst:rsi:1'])).toMatch(/^gf:1:[0-9a-f]{8}$/)
    expect(dependentsOf(cs, ['inst:macd:1'], registry)).toEqual([])
  })
  it('removeInstanceWithRecord is exactly removeInstance, and restoreRemoved inverts it', () => {
    const cs = chart()
    const r = removeInstanceWithRecord(cs, 'inst:rsi:1', registry)
    expect(r.cs).toEqual(removeInstance(cs, 'inst:rsi:1', registry))
    expect(restoreRemoved(r.cs, r.record).cs).toEqual(cs)
  })
})

describe('a grouped product (several panes, one logical indicator)', () => {
  const grouped = () => {
    const cs = chart()
    return json({ ...cs, indicatorInstances: cs.indicatorInstances.map((i) => (i.instanceId === 'inst:rsi:1' || i.instanceId === 'inst:macd:1'
      ? { ...i, group: { id: 'grp:test', label: 'Pair' } } : i)) })
  }
  it('remove takes the whole group; Undo brings the whole group back exactly', () => {
    const cs = grouped()
    const r = run(cs, { op: 'remove', instanceId: 'inst:macd:1' })
    expect(r.receipt.instanceIds).toEqual(['inst:macd:1', 'inst:rsi:1'])
    expect(findInstance(r.cs, 'inst:rsi:1')).toBeNull()
    expect(runUndo(r.cs, r.undo).cs).toEqual(json(view(mergeChartSettings(JSON.stringify(cs)))))
  })
  it('show/hide acts on the group, and Undo restores each member’s own prior flag', () => {
    const cs = grouped()                                  // rsi shown, macd hidden
    const r = run(cs, { op: 'setVisible', instanceId: 'inst:rsi:1', visible: false })
    expect(findInstance(r.cs, 'inst:macd:1').hidden).toBe(true)
    expect(findInstance(r.cs, 'inst:rsi:1').hidden).toBe(true)
    const back = runUndo(r.cs, r.undo)
    expect(findInstance(back.cs, 'inst:rsi:1').hidden).toBe(false)
    expect(findInstance(back.cs, 'inst:macd:1').hidden).toBe(true)
  })
})
