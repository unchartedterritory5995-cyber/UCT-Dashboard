// app/src/components/chart/builder/agentDefinitions.test.js — uct.indicators.definitions/1
//
// Search / describe / usage reads over the real registry, and duplicate / safe delete /
// exact Undo through the product's own doors — with the NETWORK doors replaced by an
// in-memory store that behaves as the server does (soft delete = 404 on read; a PUT over
// a tombstone resurrects it under the same id).
import { describe, it, expect, beforeAll } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import * as registry from '../engine/nativeRegistry'
import { mergeChartSettings } from '../chartDefaults'
import { checkInstanceInput, isValidColorValue } from '../engine/instanceControls'
import {
  DEFINITIONS_CONTRACT, DEFINITION_OPS, searchDefinitions, describeDefinition, findDefinitionUsage,
  planDefinitionAction, executeDefinitionAction, undoDefinitionAction, discardDraft,
} from './agentDefinitions'

const MINE = 'u_aaaaaaaaaac1'
const THEIRS = 'u_aaaaaaaaaac2'
let FIX
beforeAll(() => {
  FIX = JSON.parse(fs.readFileSync(path.resolve(globalThis.process.cwd(), '..', 'tests/fixtures/authoring/batch2_definitions.json'), 'utf8'))
  const res = registry.installUserDefinitions([
    { ...FIX.styled_markers, id: MINE, version: 2, meta: { ...(FIX.styled_markers.meta || {}), name: 'My Breakout Dots' } },
    { ...FIX.styled_markers, id: THEIRS, version: 1 },
  ])
  expect(res.errors, JSON.stringify(res.errors)).toEqual([])
})

const ctx = (over = {}) => ({ canManage: true, ownedDefinitionIds: [MINE], registry, ...over })
const chartWith = (defId) => {
  const base = mergeChartSettings(null)
  return { ...base, indicatorInstances: [...(base.indicatorInstances || []), { instanceId: `inst:${defId}:1`, defId, defVersion: 2, inputs: {}, hidden: false }] }
}

/** The server, in memory: owner-scoped rows, soft delete, resurrect-on-PUT, fork mints a new id. */
function fakeServer() {
  const rows = new Map([[MINE, { def_id: MINE, version: 2, definition: { ...FIX.styled_markers, id: MINE }, repaint: null, live: true }]])
  let n = 0
  const calls = []
  return {
    calls,
    rows,
    read: async (id) => { calls.push(['read', id]); const r = rows.get(id); return r && r.live ? { ok: true, row: { ...r } } : { ok: false, status: 404, error: 'Not found' } },
    remove: async (id) => { calls.push(['delete', id]); const r = rows.get(id); if (!r || !r.live) return { ok: false, error: 'Not found' }; r.live = false; r.version += 1; return { ok: true } },
    save: async (definition, id, _t, opts) => {
      calls.push(['save', id, opts || null])
      if (id) { const r = rows.get(id); if (!r) return { ok: false, status: 404, error: 'Not found' }; Object.assign(r, { definition, live: true, version: r.version + 1 }); return { ok: true, row: { def_id: id, version: r.version } } }
      const nid = `u_bbbbbbbbbb${String(++n).padStart(2, '0')}`
      rows.set(nid, { def_id: nid, version: 1, definition: { ...definition, id: nid }, live: true })
      return { ok: true, row: { def_id: nid, version: 1 } }
    },
    fork: async (id) => {
      calls.push(['fork', id])
      const src = rows.get(id)
      if (!src || !src.live) return { ok: false, error: 'Not found' }
      const nid = `u_cccccccccc${String(++n).padStart(2, '0')}`
      const definition = { ...src.definition, id: nid, meta: { ...(src.definition.meta || {}), name: 'My Breakout Dots (copy)' } }
      rows.set(nid, { def_id: nid, version: 1, definition, live: true })
      return { ok: true, row: { def_id: nid, version: 1, definition } }
    },
  }
}

describe('reads', () => {
  it('search ranks an exact name first and finds built-ins and the member\'s own formulas — never another member\'s', () => {
    const rsi = searchDefinitions('rsi', ctx())
    expect(rsi[0]).toMatchObject({ defId: 'rsi', kind: 'builtin' })
    const mine = searchDefinitions('breakout dots', ctx())
    expect(mine.map((r) => r.defId)).toContain(MINE)
    expect(searchDefinitions('', ctx({ limit: 500 })).map((r) => r.defId)).not.toContain(THEIRS)
    expect(searchDefinitions('', ctx({ kind: 'custom', limit: 500 })).every((r) => r.kind === 'custom')).toBe(true)
    expect(searchDefinitions('moving average', ctx())[0].inputs.map((i) => i.key)).toEqual(expect.arrayContaining(['period', 'maType']))
  })
  it('describe returns settings, outputs and the evaluability gate\'s alert/scan answer; a foreign formula is unknown', () => {
    const d = describeDefinition('macd', ctx())
    expect(d.ok).toBe(true)
    expect(d.definition).toMatchObject({ contract: DEFINITIONS_CONTRACT, defId: 'macd', kind: 'builtin', placement: 'pane' })
    expect(d.definition.outputs.map((o) => o.key)).toEqual(expect.arrayContaining(['macd', 'signal', 'histogram']))
    expect(Object.keys(d.definition.capabilities.macd)).toEqual(['alert', 'scan'])
    expect(describeDefinition(MINE, ctx()).definition.kind).toBe('custom')
    expect(describeDefinition(THEIRS, ctx())).toMatchObject({ ok: false, reason: 'unknown-definition' })
    expect(describeDefinition('nope', ctx())).toMatchObject({ ok: false, reason: 'unknown-definition' })
  })
  it('usage names every chart that draws the definition', () => {
    const charts = [{ chartId: 'a', cs: chartWith(MINE) }, { chartId: 'b', cs: mergeChartSettings(null) }]
    expect(findDefinitionUsage(MINE, charts, registry)).toEqual([{ chartId: 'a', instances: [expect.objectContaining({ instanceId: `inst:${MINE}:1`, hidden: false })] }])
  })
  it('discardDraft is the authoring contract\'s own export', async () => {
    const { discardDraft: original } = await import('./agentAuthoring')
    expect(discardDraft).toBe(original)
  })
})

describe('duplicate — "make a copy of my breakout dots"', () => {
  it('forks through createCustomCopy, confirms by read-back, and its Undo deletes only the copy', async () => {
    const srv = fakeServer()
    const p = planDefinitionAction({ op: 'duplicate', defId: MINE }, ctx())
    expect(p).toMatchObject({ ok: true, plan: { contract: DEFINITIONS_CONTRACT, op: 'duplicate', defId: MINE } })
    const done = await executeDefinitionAction(p.plan, ctx(), srv)
    expect(done.status).toBe('confirmed')
    expect(done.receipt).toMatchObject({ op: 'duplicate', defId: MINE, newDefId: expect.stringMatching(/^u_c/), status: 'confirmed' })
    expect(registry.getDefinition(done.receipt.newDefId)).toBeTruthy()
    expect(srv.calls.map((c) => c[0])).toEqual(['fork', 'read'])
    const undone = await undoDefinitionAction(done.undo, ctx({ ownedDefinitionIds: [MINE, done.receipt.newDefId] }), srv)
    expect(undone).toMatchObject({ status: 'confirmed', receipt: { op: 'undo', undoOf: 'duplicate' } })
    expect(srv.rows.get(done.receipt.newDefId).live).toBe(false)
    expect(srv.rows.get(MINE).live).toBe(true)
  })
  it('a built-in duplicates as a formula copy when it can, and refuses in the library\'s own words when it cannot', () => {
    const verdicts = ['rsi', 'macd', 'atr'].map((d) => planDefinitionAction({ op: 'duplicate', defId: d }, ctx()))
    for (const v of verdicts) expect(v.ok || v.reason === 'unsupported-definition').toBe(true)
    expect(planDefinitionAction({ op: 'duplicate', defId: THEIRS }, ctx())).toMatchObject({ ok: false, reason: 'unknown-definition' })
    expect(planDefinitionAction({ op: 'duplicate', defId: MINE }, ctx({ canManage: false }))).toMatchObject({ ok: false, reason: 'readonly' })
  })
  it('a server refusal is did-not-land, never confirmed', async () => {
    const srv = { ...fakeServer(), fork: async () => ({ ok: false, error: 'You have reached your formula limit.' }) }
    const p = planDefinitionAction({ op: 'duplicate', defId: MINE }, ctx())
    expect(await executeDefinitionAction(p.plan, ctx(), srv)).toMatchObject({ status: 'did-not-land', error: 'You have reached your formula limit.' })
  })
})

describe('delete — safe by default', () => {
  it('refuses while a chart draws it, naming the usage; built-ins and foreign formulas cannot be deleted', () => {
    const charts = [{ chartId: 'a', cs: chartWith(MINE) }]
    expect(planDefinitionAction({ op: 'delete', defId: MINE }, ctx({ charts }))).toMatchObject({ ok: false, reason: 'dependent-exists', detail: { usage: [{ chartId: 'a' }] } })
    expect(planDefinitionAction({ op: 'delete', defId: 'rsi' }, ctx())).toMatchObject({ ok: false, reason: 'unsupported-definition' })
    expect(planDefinitionAction({ op: 'delete', defId: THEIRS }, ctx())).toMatchObject({ ok: false, reason: 'unknown-definition' })
  })
  it('reads first, soft-deletes, confirms the 404, and Undo resurrects the exact document under the same id', async () => {
    const srv = fakeServer()
    const doc = JSON.parse(JSON.stringify(srv.rows.get(MINE).definition))
    const p = planDefinitionAction({ op: 'delete', defId: MINE }, ctx({ charts: [] }))
    expect(p.ok).toBe(true)
    const done = await executeDefinitionAction(p.plan, ctx({ charts: [] }), srv)
    expect(done).toMatchObject({ status: 'confirmed', receipt: { op: 'delete', defId: MINE, status: 'confirmed' } })
    expect(srv.calls.map((c) => c[0])).toEqual(['read', 'delete', 'read'])
    expect(srv.rows.get(MINE).live).toBe(false)
    const undone = await undoDefinitionAction(done.undo, ctx(), srv)
    expect(undone).toMatchObject({ status: 'confirmed', receipt: { undoOf: 'delete', defId: MINE } })
    expect(srv.rows.get(MINE)).toMatchObject({ live: true, definition: doc })
    expect(srv.calls.filter((c) => c[0] === 'save')).toEqual([['save', MINE, null]])
    // a second Undo is refused: it is live again
    expect(await undoDefinitionAction(done.undo, ctx(), srv)).toMatchObject({ ok: false, reason: 'restore-conflict' })
  })
  it('allowInUse is honoured only with the usage it was planned against', async () => {
    const srv = fakeServer()
    const a = { chartId: 'a', cs: chartWith(MINE) }
    const p = planDefinitionAction({ op: 'delete', defId: MINE, allowInUse: true }, ctx({ charts: [a] }))
    expect(p.ok).toBe(true)
    expect(p.plan.preview.usage).toHaveLength(1)
    const b = { chartId: 'b', cs: chartWith(MINE) }
    expect(await executeDefinitionAction(p.plan, ctx({ charts: [a, b] }), srv)).toMatchObject({ ok: false, reason: 'changed-while-working', detail: { what: 'usage' } })
    expect(srv.calls).toEqual([])
    expect((await executeDefinitionAction(p.plan, ctx({ charts: [a] }), srv)).status).toBe('confirmed')
  })
  it('nothing is deleted when the stored document cannot be read first', async () => {
    const srv = { ...fakeServer(), read: async () => ({ ok: false, status: null, error: 'offline' }) }
    let deleted = false
    srv.remove = async () => { deleted = true; return { ok: true } }
    const p = planDefinitionAction({ op: 'delete', defId: MINE }, ctx({ charts: [] }))
    expect(await executeDefinitionAction(p.plan, ctx({ charts: [] }), srv)).toMatchObject({ status: 'unconfirmed' })
    expect(deleted).toBe(false)
  })
  it('a token from another contract, or a stale definition version, is refused', async () => {
    expect(await executeDefinitionAction({ contract: 'uct.indicators.mutation/1', op: 'delete', defId: MINE }, ctx(), fakeServer())).toMatchObject({ ok: false, reason: 'bad-request' })
    const p = planDefinitionAction({ op: 'delete', defId: MINE }, ctx({ charts: [] }))
    const stale = { ...p.plan, pins: { ...p.plan.pins, version: 99 } }
    expect(await executeDefinitionAction(stale, ctx({ charts: [] }), fakeServer())).toMatchObject({ ok: false, reason: 'changed-while-working', detail: { what: 'definition' } })
    expect(DEFINITION_OPS).toEqual(['duplicate', 'delete'])
  })
})

describe('I-13 — a colour input takes only a colour the chart can draw', () => {
  it('hex, rgb()/hsl() and resolvable theme tokens pass; anything else is refused with why', () => {
    for (const ok of ['#fff', '#ffff', '#22c55e', '#22c55ecc', 'rgba(1, 2, 3, 0.5)', 'hsl(120 50% 50%)', 'token:bull', 'token:info@band']) {
      expect(isValidColorValue(ok), ok).toBe(true)
    }
    for (const bad of ['green-ish', '#12345', 'token:nope', 'token:info@soft', ' #fff', '', 7, null]) expect(isValidColorValue(bad), String(bad)).toBe(false)
    const rsi = registry.getDefinition('rsi')
    expect(checkInstanceInput(rsi, 'color', '#22c55e')).toEqual({ ok: true, value: '#22c55e' })
    expect(checkInstanceInput(rsi, 'color', 'green-ish')).toMatchObject({ ok: false, why: expect.stringMatching(/colour/) })
  })
  it('the definition\'s own declared default is always admitted, whatever its spelling', () => {
    const def = { id: 'x', meta: { name: 'X' }, inputs: [{ key: 'color', type: 'color', default: 'orange' }] }
    expect(checkInstanceInput(def, 'color', 'orange')).toEqual({ ok: true, value: 'orange' })
    expect(checkInstanceInput(def, 'color', 'purple')).toMatchObject({ ok: false })
  })
})
