// app/src/components/chart/builder/settingsRecordParity.test.js — A1.0 parity proof
//
// A1.0 moved the change-record helpers out of `agentMutations.js` into
// `engine/settingsRecord.js`. This file holds the moved code BYTE-IDENTICAL to a frozen copy
// of the pre-move helpers (`__fixtures__/preA1AgentRecord.js`, never edited) over:
//   · the Agent M2 fixture chart (RSI, MA(RSI), header info value, hidden MACD) and every
//     product writer the Agent uses (add / remove / show-hide / input), alone and chained;
//   · stale-state Undo (an out-of-band edit after the record) — both refuse, same path;
//   · a seeded property run of random settings edits (keyed reorders, removals, nested keys).
// Agent Undo behaviour itself stays pinned by the Agent's own suites (agentMutations*.test,
// agentIndicatorsM2/M3, agentBatch6), which this commit does not edit.
import { describe, it, expect, beforeAll } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import * as registry from '../engine/nativeRegistry'
import { mergeChartSettings } from '../chartDefaults'
import { addInstance, removeInstance, setInstanceHidden, setInstanceInput, withInstances } from '../engine/instanceControls'
import { adoptOverlayAverages } from '../maAdoption'
import * as frozen from './__fixtures__/preA1AgentRecord'
import * as live from '../engine/settingsRecord'
import { changeRecord as agentChangeRecord, removeInstanceWithRecord, restoreRemoved } from './agentMutations'

const SAVED = 'u_aaaaaaaaaab2'
beforeAll(() => {
  const FIX = JSON.parse(fs.readFileSync(path.resolve(globalThis.process.cwd(), '..', 'tests/fixtures/authoring/batch2_definitions.json'), 'utf8'))
  const res = registry.installUserDefinitions([{ ...FIX.styled_markers, id: SAVED, version: 4 }])
  expect(res.errors, JSON.stringify(res.errors)).toEqual([])
})

const view = (cs) => adoptOverlayAverages(cs) || cs
const norm = (cs) => mergeChartSettings(JSON.stringify(cs))
const bytes = (v) => JSON.stringify(v)

/** The Agent M2 fixture chart (agentMutations.test.js `chart()`), as a chart reads it back. */
function chart() {
  const base = mergeChartSettings(null)
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

/** The frozen revert's result, and the live module's under the Agent wrapper's mapping. */
const frozenRevert = (cs, rec) => frozen.revert(cs, rec)
const liveRevert = (cs, rec) => {
  const r = live.revertRecord(cs, rec)
  return r.ok ? r : { ok: false, reason: 'restore-conflict', detail: { path: r.path } }
}

function expectParity(prev, next, label) {
  const a = frozen.changeRecord(prev, next)
  const b = live.changeRecord(prev, next)
  const c = agentChangeRecord(prev, next)
  expect(bytes(b), `${label}: record`).toBe(bytes(a))
  expect(bytes(c), `${label}: agentMutations.changeRecord`).toBe(bytes(a))
  // Undo from the after-state: both restore, byte-identically
  const ra = frozenRevert(next, a); const rb = liveRevert(next, b)
  expect(bytes(rb), `${label}: revert`).toBe(bytes(ra))
  for (const e of a.paths) expect(live.holds(next, e), `${label}: holds`).toBe(frozen.holds(next, e))
  return a
}

// The Agent's writers, as (cs) → cs steps.
const STEPS = {
  addStoch: (cs) => addInstance(cs, 'stoch', registry),
  addSaved: (cs) => addInstance(cs, SAVED, registry),
  addRsi: (cs) => addInstance(cs, 'rsi', registry),
  removeRsi: (cs) => removeInstance(cs, 'inst:rsi:1', registry),
  removeMa: (cs) => removeInstance(cs, 'inst:movingAverage:9', registry),
  hideRsi: (cs) => setInstanceHidden(cs, 'inst:rsi:1', true, registry),
  showMacd: (cs) => setInstanceHidden(cs, 'inst:macd:1', false, registry),
  rsiPeriod: (cs) => setInstanceInput(cs, 'inst:rsi:1', 'period', 21, registry),
  maPeriod: (cs) => setInstanceInput(cs, 'inst:movingAverage:9', 'period', 50, registry),
}

describe('A1.0 — settingsRecord is byte-identical to the pre-move helpers', () => {
  it('every Agent writer, alone, through the read-back the Agent compares in', () => {
    const cs = norm(chart())
    for (const [name, step] of Object.entries(STEPS)) {
      const next = norm(view(step(cs)))
      const rec = expectParity(cs, next, name)
      expect(rec.paths.length, `${name} changed something`).toBeGreaterThan(0)
    }
  })

  it('chained writers (two-step histories), every ordered pair', () => {
    const cs = norm(chart())
    const names = Object.keys(STEPS)
    for (const x of names) {
      for (const y of names) {
        const mid = norm(view(STEPS[x](cs)))
        const end = norm(view(STEPS[y](mid)))
        expectParity(cs, end, `${x}→${y}`)
        expectParity(mid, end, `${x}|${y}`)
      }
    }
  })

  it('stale Undo: an out-of-band edit after the record — both refuse at the same path', () => {
    const cs = norm(chart())
    for (const [name, step] of Object.entries(STEPS)) {
      const next = norm(view(step(cs)))
      const rec = frozen.changeRecord(cs, next)
      for (const [other, step2] of Object.entries(STEPS)) {
        const moved = norm(view(step2(next)))
        expect(bytes(liveRevert(moved, live.changeRecord(cs, next))), `${name} then ${other}`).toBe(bytes(frozenRevert(moved, rec)))
      }
    }
  })

  it('removeInstanceWithRecord / restoreRemoved (the exported Agent path) round-trip exactly', () => {
    const cs = norm(chart())
    for (const id of ['inst:rsi:1', 'inst:movingAverage:9', 'inst:macd:1']) {
      const r = removeInstanceWithRecord(cs, id, registry)
      expect(r.ok).toBe(true)
      expect(bytes(r.record.paths)).toBe(bytes(frozen.changeRecord(norm(view(cs)), norm(r.cs)).paths))
      const back = restoreRemoved(JSON.parse(JSON.stringify(r.cs)), r.record)
      expect(back.ok).toBe(true)
      expect(live.same(back.cs, norm(view(cs)))).toBe(true)
    }
  })

  it('seeded property run: random edits of a settings-shaped tree', () => {
    let seed = 0x5eed
    const rnd = () => { seed = (Math.imul(seed, 1103515245) + 12345) >>> 0; return seed / 2 ** 32 }
    const pick = (a) => a[Math.floor(rnd() * a.length)]
    const base = norm(chart())
    let checked = 0
    for (let n = 0; n < 400; n++) {
      const prev = JSON.parse(JSON.stringify(base))
      const next = JSON.parse(JSON.stringify(base))
      const list = next.indicatorInstances
      for (let k = 0; k < 1 + Math.floor(rnd() * 4); k++) {
        const op = pick(['reorder', 'edit', 'drop', 'add', 'nested', 'tombstone', 'del'])
        if (op === 'reorder' && list.length > 1) { const i = Math.floor(rnd() * list.length); const j = Math.floor(rnd() * list.length); [list[i], list[j]] = [list[j], list[i]] }
        if (op === 'edit' && list.length) { const e = pick(list); if (e && !e.deleted) e.inputs = { ...(e.inputs || {}), period: 2 + Math.floor(rnd() * 90) } }
        if (op === 'drop' && list.length) list.splice(Math.floor(rnd() * list.length), 1)
        if (op === 'add') list.push({ instanceId: `inst:rnd:${n}:${k}`, defId: 'rsi', inputs: { period: 5 + k }, hidden: rnd() < 0.5 })
        if (op === 'nested') next.header = { ...(next.header || {}), probe: { a: rnd() < 0.5 ? [1, 2, { b: k }] : null } }
        if (op === 'tombstone' && list.length) { const i = Math.floor(rnd() * list.length); if (list[i]) list[i] = { instanceId: list[i].instanceId, deleted: true } }
        if (op === 'del') { const keys = Object.keys(next).filter((x) => x !== 'indicatorInstances'); delete next[pick(keys)] }
      }
      expectParity(prev, next, `seed ${n}`)
      // and Undo against a third, unrelated state
      const third = JSON.parse(JSON.stringify(next)); third.preset = `p${n}`
      const ra = frozenRevert(third, frozen.changeRecord(prev, next)); const rb = liveRevert(third, live.changeRecord(prev, next))
      expect(bytes(rb), `seed ${n}: third-state revert`).toBe(bytes(ra))
      checked++
    }
    expect(checked).toBe(400)
  })
})
