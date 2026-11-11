// app/src/components/chart/builder/agentDefinitions.test.js — uct.indicators.definitions/1
//
// Search / describe / usage reads over the real registry, and duplicate / safe delete /
// exact Undo through the product's own doors — with the NETWORK doors replaced by an
// in-memory store that behaves as the server does (soft delete = 404 on read; a PUT over
// a tombstone resurrects it under the same id).
import { describe, it, expect, beforeAll, vi, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import * as registry from '../engine/nativeRegistry'
import { mergeChartSettings } from '../chartDefaults'
import { checkInstanceInput, isValidColorValue } from '../engine/instanceControls'
import {
  DEFINITIONS_CONTRACT, DEFINITION_OPS, searchDefinitions, describeDefinition, findDefinitionUsage,
  planDefinitionAction, executeDefinitionAction, undoDefinitionAction, discardDraft, DELETE_REFUSALS,
} from './agentDefinitions'
import { withoutEngineStamp, engineStampOf } from '../engine/scriptEngineVersion'
import { readUserDefinition } from '../../../hooks/useUserDefinitions'
import { isScriptDocument } from './memberPane/savedScriptUpgrade'

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
  // ⛔ F-15 follow-up — nothing was written, so this is a REFUSAL in a true sentence, never
  // `unconfirmed` (which the member read as "could not read it back" + "some changes could not
  // be reversed")
  it('nothing is deleted when the stored document cannot be read first — refused, in its own words', async () => {
    const srv = { ...fakeServer(), read: async () => ({ ok: false, status: null, error: 'offline' }) }
    let deleted = false
    srv.remove = async () => { deleted = true; return { ok: true } }
    const p = planDefinitionAction({ op: 'delete', defId: MINE }, ctx({ charts: [] }))
    const res = await executeDefinitionAction(p.plan, ctx({ charts: [] }), srv)
    expect(res).toEqual({ ok: false, reason: 'unsupported-definition', detail: { why: DELETE_REFUSALS.unreadBefore } })
    expect(res.detail.why).toBe('could not read this indicator’s saved definition before deleting it, so a delete could not be undone exactly')
    expect(deleted).toBe(false)
  })
  it('a read that answers but carries no document is refused the same way; nothing is deleted', async () => {
    const srv = { ...fakeServer(), read: async () => ({ ok: true, row: { def_id: MINE, version: 2, definition: null } }) }
    let deleted = false
    srv.remove = async () => { deleted = true; return { ok: true } }
    const p = planDefinitionAction({ op: 'delete', defId: MINE }, ctx({ charts: [] }))
    expect(await executeDefinitionAction(p.plan, ctx({ charts: [] }), srv)).toEqual({ ok: false, reason: 'unsupported-definition', detail: { why: DELETE_REFUSALS.unreadBefore } })
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

// ─── F-15 — a Pine import's stored script and engine stamp survive delete → Undo ──────
//
// The in-memory server below follows the REAL doors' rules for a Pine import:
//   - a read sends `pine_source` only when asked (`?source=1`) and always says
//     `has_pine_source`;
//   - a delete's tombstone keeps the script;
//   - a save strips `meta.engineVersion` unless it carries the script — the rule
//     `saveUserDefinition` applies with the real `withoutEngineStamp` — marks a
//     script-shaped document saved without its script `scriptEdited` (L2), and
//     stores whatever script it was given (null when none).
const SCRIPT = '//@version=5\nindicator("x")\nplot(ta.sma(close, 20))'
const SHARE_ORIGIN = { author_id: 'author-1', def_id: 'u_dddddddddddd', version: 3, ast_hash: 'h', table_version: 1 }
function pineServer({ hasScript = true, stamp = true, dropScriptOnSave = false, scriptShaped = false, scriptEdited = false,
  origin = false, stampOnSave = null, markAnyOnSave = false, storeScriptOnSave = null, unmarkOnSave = false, originOnSave } = {}) {
  const meta = { ...(FIX.styled_markers.meta || {}), name: 'My Breakout Dots', ...(stamp ? { engineVersion: 1 } : {}),
    ...(scriptShaped ? { recurrenceOrigin: registry.PINE_RECURRENCE_ORIGIN } : {}), ...(scriptEdited ? { scriptEdited: true } : {}) }
  // `origin` is what `install_share` writes on a copy installed from someone else's share
  const definition = { ...FIX.styled_markers, id: MINE, meta, ...(origin ? { origin: SHARE_ORIGIN } : {}) }
  const rows = new Map([[MINE, { def_id: MINE, version: 2, definition, repaint: null, live: true, pine_source: hasScript ? SCRIPT : null }]])
  const calls = []
  const view = (r, opts) => {
    const { pine_source: src, live: _l, ...rest } = r
    return { ...rest, has_pine_source: src != null, ...(opts && opts.withSource === true && src != null ? { pine_source: src } : {}) }
  }
  return {
    calls, rows, original: JSON.parse(JSON.stringify(definition)),
    read: async (id, opts) => { calls.push(['read', id, opts || null]); const r = rows.get(id); return r && r.live ? { ok: true, row: view(r, opts) } : { ok: false, status: 404, error: 'Not found' } },
    remove: async (id) => { calls.push(['delete', id]); const r = rows.get(id); if (!r || !r.live) return { ok: false, error: 'Not found' }; r.live = false; r.version += 1; return { ok: true } },
    save: async (doc, id, _t, opts) => {
      calls.push(['save', id, opts || null])
      const script = opts && typeof opts.pineSource === 'string' && opts.pineSource.trim() ? opts.pineSource : null
      let stored = script ? doc : withoutEngineStamp(doc)
      // `markAnyOnSave`: a save door that drifted and marks EVERY scriptless save (N2's backstop)
      if (!script && (markAnyOnSave || isScriptDocument(stored)) && stored.meta.scriptEdited !== true) stored = { ...stored, meta: { ...stored.meta, scriptEdited: true } }
      // `stampOnSave`: a door that moves the stamp on a scripted save (R4: same script, different stamp)
      if (script && stampOnSave !== null) stored = { ...stored, meta: { ...stored.meta, engineVersion: stampOnSave } }
      // `unmarkOnSave`: a door that drops the hand-edited mark (review #1087 mutation O)
      if (unmarkOnSave) { const { scriptEdited: _m, ...rest } = stored.meta; stored = { ...stored, meta: rest } }
      // `originOnSave`: a store that drops (null) or rewrites (an object) the share provenance (N4)
      if (originOnSave === null) { const { origin: _o, ...rest } = stored; stored = rest } else if (originOnSave !== undefined) stored = { ...stored, origin: originOnSave }
      const r = rows.get(id)
      // `storeScriptOnSave`: a door that stores a script other than the one it was sent (mutation H)
      const keptScript = storeScriptOnSave !== null ? storeScriptOnSave : (dropScriptOnSave ? null : script)
      Object.assign(r, { definition: JSON.parse(JSON.stringify(stored)), live: true, version: r.version + 1, pine_source: keptScript })
      return { ok: true, row: { def_id: id, version: r.version } }
    },
  }
}
const deleteThenUndo = async (srv) => {
  const p = planDefinitionAction({ op: 'delete', defId: MINE }, ctx({ charts: [] }))
  expect(p.ok).toBe(true)
  const done = await executeDefinitionAction(p.plan, ctx({ charts: [] }), srv)
  return { done, undone: done.undo ? await undoDefinitionAction(done.undo, ctx(), srv) : null }
}

describe('F-15 — deleting and undoing a saved Pine indicator is exact or refused', () => {
  it('Undo restores the SAME document, engine stamp included, and the SAME stored script', async () => {
    const srv = pineServer()
    const { done, undone } = await deleteThenUndo(srv)
    expect(done.status).toBe('confirmed')
    expect(srv.calls[0]).toEqual(['read', MINE, { withSource: true }]) // read WITH the script, before deleting
    expect(done.undo.pineSource).toBe(SCRIPT)
    expect(undone).toMatchObject({ status: 'confirmed', receipt: { undoOf: 'delete', defId: MINE } })
    const row = srv.rows.get(MINE)
    expect(row.definition).toEqual(srv.original)
    expect(engineStampOf(row.definition)).toBe(1)
    expect(row.pine_source).toBe(SCRIPT)
    expect(srv.calls.filter((c) => c[0] === 'save')).toEqual([['save', MINE, { pineSource: SCRIPT }]])
  })

  it('the defect, for the record: an Undo save WITHOUT the script loses the stamp and the script', async () => {
    const srv = pineServer()
    await srv.remove(MINE)
    await srv.save(srv.original, MINE, null, null)
    expect(engineStampOf(srv.rows.get(MINE).definition)).toBe(null)
    expect(srv.rows.get(MINE).pine_source).toBe(null)
  })

  it('nothing is deleted when the stored script cannot be read back first', async () => {
    const srv = pineServer()
    srv.read = async (id) => {
      srv.calls.push(['read', id, null])
      const { pine_source: _s, live: _l, ...rest } = srv.rows.get(id)
      return { ok: true, row: { ...rest, has_pine_source: true } }
    }
    const { done } = await deleteThenUndo(srv)
    expect(done).toMatchObject({ ok: false, reason: 'unsupported-definition', detail: { why: DELETE_REFUSALS.scriptUnread } })
    expect(done.detail.why).toBe('could not read this indicator’s saved script, so a delete could not be undone exactly')
    expect(srv.calls.some((c) => c[0] === 'delete')).toBe(false)
    expect(srv.rows.get(MINE).live).toBe(true)
  })

  it('a stamped document with no stored script is not deleted: its stamp could not be restored', async () => {
    const srv = pineServer({ hasScript: false })
    const { done } = await deleteThenUndo(srv)
    // there is NO script on this row, so "could not read its saved script" would be false
    expect(done).toMatchObject({ ok: false, reason: 'unsupported-definition', detail: { why: DELETE_REFUSALS.stampWithoutScript } })
    expect(done.detail.why).toBe('this indicator is marked as translated from a Pine script that is not stored with it, so a delete could not be undone exactly')
    expect(srv.calls.some((c) => c[0] === 'delete')).toBe(false)
  })

  it('an undo record without the script (made before F-15) is refused, and nothing is written', async () => {
    const srv = pineServer()
    const p = planDefinitionAction({ op: 'delete', defId: MINE }, ctx({ charts: [] }))
    const done = await executeDefinitionAction(p.plan, ctx({ charts: [] }), srv)
    const { pineSource: _drop, ...legacy } = done.undo
    expect(await undoDefinitionAction(legacy, ctx(), srv)).toMatchObject({ ok: false, reason: 'restore-conflict' })
    expect(srv.calls.some((c) => c[0] === 'save')).toBe(false)
    expect(srv.rows.get(MINE).live).toBe(false)
  })

  it('a restore that comes back without its script is reported, never "confirmed"', async () => {
    const srv = pineServer({ dropScriptOnSave: true })
    const { undone } = await deleteThenUndo(srv)
    expect(undone.status).toBe('did-not-land')
    expect(undone.error).toBe('The indicator came back, but without its saved script, so it is not exactly as it was.')
  })

  it('a repaint-acknowledged Pine import carries BOTH the acknowledgement and the script', async () => {
    const srv = pineServer()
    srv.rows.get(MINE).repaint = { acknowledged: true }
    const { undone } = await deleteThenUndo(srv)
    expect(undone.status).toBe('confirmed')
    expect(srv.calls.filter((c) => c[0] === 'save')).toEqual([['save', MINE, { previewAcked: true, pineSource: SCRIPT }]])
  })

  it('an unstamped formula with no script takes the unchanged path', async () => {
    const srv = pineServer({ hasScript: false, stamp: false })
    const { done, undone } = await deleteThenUndo(srv)
    expect(done.status).toBe('confirmed')
    expect(done.undo.pineSource).toBe(undefined)
    expect(undone.status).toBe('confirmed')
    expect(srv.calls.filter((c) => c[0] === 'save')).toEqual([['save', MINE, null]])
  })

  // ⛔ Ruling 2026-11-10: a LEGACY Pine import (script-shaped, no stored script, no stamp)
  // could only come back marked `scriptEdited` by the save door, so it is not deleted.
  it('a legacy Pine import (script-shaped, no script, no stamp) is refused, and nothing is deleted', async () => {
    const srv = pineServer({ hasScript: false, stamp: false, scriptShaped: true })
    expect(isScriptDocument(srv.original)).toBe(true) // the fixture IS what the save door would mark
    const { done } = await deleteThenUndo(srv)
    expect(done).toMatchObject({ ok: false, reason: 'unsupported-definition', detail: { why: DELETE_REFUSALS.legacyImport } })
    expect(done.detail.why).toBe('this indicator was imported from Pine before its script was kept, so a delete could not be undone exactly')
    expect(done.undo).toBe(undefined)
    expect(srv.calls.some((c) => c[0] === 'delete')).toBe(false)
    expect(srv.rows.get(MINE).live).toBe(true)
    expect(srv.rows.get(MINE).definition).toEqual(srv.original)
  })

  it('control: an unstamped document that is NOT script-shaped still deletes and comes back EXACTLY', async () => {
    const srv = pineServer({ hasScript: false, stamp: false })
    expect(isScriptDocument(srv.original)).toBe(false)
    const { done, undone } = await deleteThenUndo(srv)
    expect(done.status).toBe('confirmed')
    expect(undone.status).toBe('confirmed')
    expect(srv.rows.get(MINE).live).toBe(true)
    expect(srv.rows.get(MINE).definition).toEqual(srv.original)
    expect(srv.rows.get(MINE).definition.meta.scriptEdited).toBe(undefined)
  })

  it('control: a script-shaped document ALREADY marked scriptEdited deletes and comes back EXACTLY', async () => {
    const srv = pineServer({ hasScript: false, stamp: false, scriptShaped: true, scriptEdited: true })
    const { done, undone } = await deleteThenUndo(srv)
    expect(done.status).toBe('confirmed')
    expect(undone.status).toBe('confirmed')
    expect(srv.rows.get(MINE).definition).toEqual(srv.original)
  })
})

// ─── F-15 follow-ups (review of #617: N1 shared copies, N2 the hand-edited mark, N3 rails) ──
describe('F-15 N1 — a copy installed from someone else\'s share is refused in its OWN words', () => {
  // `install_share` saves the copy with NO script (the author's Pine never travels) and keeps
  // the source row's stamp and `origin`. There is no script to read, so the old sentence
  // ("could not read its saved script") was false; so was "imported before its script was kept".
  const SHARED = 'this indicator is a copy shared with you, and a shared copy never carries the author’s Pine script, so a delete could not be undone exactly'
  it('a stamped share copy (no script, has_pine_source false) is refused with the shared-copy sentence; nothing is deleted', async () => {
    const srv = pineServer({ hasScript: false, stamp: true, scriptShaped: true, origin: true })
    const { done } = await deleteThenUndo(srv)
    expect(done).toMatchObject({ ok: false, reason: 'unsupported-definition' })
    expect(done.detail.why).toBe(SHARED)
    expect(done.detail.why).not.toMatch(/Could not read|before its script was kept/)
    expect(srv.calls.some((c) => c[0] === 'delete')).toBe(false)
    expect(srv.rows.get(MINE).live).toBe(true)
    expect(srv.rows.get(MINE).definition).toEqual(srv.original)
  })
  it('a share copy of a LEGACY unstamped script gets the same shared-copy sentence, not the legacy-import one', async () => {
    const srv = pineServer({ hasScript: false, stamp: false, scriptShaped: true, origin: true })
    const { done } = await deleteThenUndo(srv)
    expect(done.detail.why).toBe(SHARED)
    expect(srv.calls.some((c) => c[0] === 'delete')).toBe(false)
  })
  it('control: a share copy whose restore IS exact (not script-shaped, unstamped) still deletes and comes back exactly, origin kept', async () => {
    const srv = pineServer({ hasScript: false, stamp: false, origin: true })
    const { done, undone } = await deleteThenUndo(srv)
    expect(done.status).toBe('confirmed')
    expect(undone.status).toBe('confirmed')
    expect(srv.rows.get(MINE).definition).toEqual(srv.original)
    expect(srv.rows.get(MINE).definition.origin).toEqual(SHARE_ORIGIN)
  })
  it('control: a share copy the member later saved WITH a script deletes and restores exactly, script and stamp included', async () => {
    const srv = pineServer({ origin: true, scriptShaped: true })
    const { done, undone } = await deleteThenUndo(srv)
    expect(done.status).toBe('confirmed')
    expect(undone.status).toBe('confirmed')
    expect(srv.rows.get(MINE).definition).toEqual(srv.original)
    expect(srv.rows.get(MINE).pine_source).toBe(SCRIPT)
  })
  it('a share copy that DOES hold a script the read did not return says so (that sentence is true there)', async () => {
    const srv = pineServer({ origin: true, scriptShaped: true })
    srv.read = async (id) => { const { pine_source: _s, live: _l, ...rest } = srv.rows.get(id); return { ok: true, row: { ...rest, has_pine_source: true } } }
    const { done } = await deleteThenUndo(srv)
    expect(done.detail.why).toBe(DELETE_REFUSALS.scriptUnread)
  })
})

describe('F-15 N3 — rails for the two terms no test proved (review mutations R4, R5)', () => {
  it('R5: an UNSTAMPED, NOT script-shaped row whose read dropped its script is refused (only has_pine_source says so)', async () => {
    const srv = pineServer({ stamp: false })
    expect(isScriptDocument(srv.original)).toBe(false)
    expect(engineStampOf(srv.original)).toBe(null)
    srv.read = async (id) => { srv.calls.push(['read', id, null]); const { pine_source: _s, live: _l, ...rest } = srv.rows.get(id); return { ok: true, row: { ...rest, has_pine_source: true } } }
    const { done } = await deleteThenUndo(srv)
    expect(done).toMatchObject({ ok: false, reason: 'unsupported-definition', detail: { why: DELETE_REFUSALS.scriptUnread } })
    expect(srv.calls.some((c) => c[0] === 'delete')).toBe(false)
    expect(srv.rows.get(MINE).live).toBe(true)
  })
  it('R4: a read-back with the SAME script but a MOVED stamp is never "confirmed", and says what moved', async () => {
    const srv = pineServer({ stampOnSave: 2 })
    const { done, undone } = await deleteThenUndo(srv)
    expect(done.status).toBe('confirmed')
    expect(srv.rows.get(MINE).pine_source).toBe(SCRIPT) // the script half agrees
    expect(engineStampOf(srv.rows.get(MINE).definition)).toBe(2)
    expect(undone.status).toBe('did-not-land')
    expect(undone.error).toBe('The indicator came back, but with a different engine version, so it is not exactly as it was.')
  })
})

describe('F-15 N2 — "confirmed" also means the hand-edited mark (`meta.scriptEdited`) came back the same', () => {
  it('P5: a scriptless undo record for an unstamped LEGACY script document is refused before anything is written', async () => {
    const srv = pineServer({ hasScript: false, stamp: false, scriptShaped: true })
    expect(isScriptDocument(srv.original)).toBe(true)
    await srv.remove(MINE)
    const record = { contract: DEFINITIONS_CONTRACT, kind: 'undo', op: 'delete', defId: MINE, name: 'My Breakout Dots', definition: srv.original, repaint: false }
    const undone = await undoDefinitionAction(record, ctx(), srv)
    expect(undone).toMatchObject({ ok: false, reason: 'restore-conflict' })
    expect(undone.detail.why).toBe('it was imported from Pine before its script was kept')
    expect(srv.calls.some((c) => c[0] === 'save')).toBe(false)
    expect(srv.rows.get(MINE).live).toBe(false)
  })
  it('backstop: a save door that marks a document the record did not have marked is reported, never "confirmed"', async () => {
    const srv = pineServer({ hasScript: false, stamp: false, markAnyOnSave: true })
    expect(isScriptDocument(srv.original)).toBe(false)
    const { done, undone } = await deleteThenUndo(srv)
    expect(done.status).toBe('confirmed')
    expect(srv.rows.get(MINE).definition.meta.scriptEdited).toBe(true)
    expect(undone.status).toBe('did-not-land')
    expect(undone.error).toBe('The indicator came back, but marked as hand-edited, so it is not exactly as it was.')
  })
  // review #1087 mutation O: the check must notice a LOST mark as well as a gained one
  it('a read-back that LOST the hand-edited mark is reported, never "confirmed"', async () => {
    const srv = pineServer({ hasScript: false, stamp: false, scriptShaped: true, scriptEdited: true, unmarkOnSave: true })
    const { done, undone } = await deleteThenUndo(srv)
    expect(done.status).toBe('confirmed')
    expect(srv.rows.get(MINE).definition.meta.scriptEdited).toBe(undefined)
    expect(undone.status).toBe('did-not-land')
    expect(undone.error).toBe('The indicator came back, but no longer marked as hand-edited, so it is not exactly as it was.')
  })
  // review #1087 mutation M: only `scriptEdited === true` is the mark; `false` is unmarked
  it('`scriptEdited: false` is NOT the mark: a legacy import carrying it is still refused (its restore would come back marked)', async () => {
    const srv = pineServer({ hasScript: false, stamp: false, scriptShaped: true })
    const row = srv.rows.get(MINE)
    row.definition = { ...row.definition, meta: { ...row.definition.meta, scriptEdited: false } }
    const { done } = await deleteThenUndo(srv)
    expect(done).toMatchObject({ ok: false, reason: 'unsupported-definition', detail: { why: DELETE_REFUSALS.legacyImport } })
    expect(srv.calls.some((c) => c[0] === 'delete')).toBe(false)
  })
})

// review #1087 N4: `origin` is part of "exact". The real store keeps the document's keys as sent
// (`user_definitions.save` stores `json.dumps(stored, sort_keys=True)`; `get` returns it parsed),
// so an exact restore reads the same `origin` back; anything else is named, never "confirmed".
describe('F-15 N4 — "confirmed" also means the share provenance (`origin`) came back the same', () => {
  const MOVED = { ...SHARE_ORIGIN, version: 4 }
  it('a read-back that LOST `origin` is reported, never "confirmed"', async () => {
    const srv = pineServer({ hasScript: false, stamp: false, origin: true, originOnSave: null })
    const { done, undone } = await deleteThenUndo(srv)
    expect(done.status).toBe('confirmed')
    expect(srv.rows.get(MINE).definition.origin).toBe(undefined)
    expect(undone.status).toBe('did-not-land')
    expect(undone.error).toBe('The indicator came back, but without the details of the share it was copied from, so it is not exactly as it was.')
  })
  it('a read-back with a DIFFERENT `origin` is reported, never "confirmed"', async () => {
    const srv = pineServer({ hasScript: false, stamp: false, origin: true, originOnSave: MOVED })
    const { done, undone } = await deleteThenUndo(srv)
    expect(done.status).toBe('confirmed')
    expect(undone.status).toBe('did-not-land')
    expect(undone.error).toBe('The indicator came back, but with different details of the share it was copied from, so it is not exactly as it was.')
  })
  it('a read-back that GAINED an `origin` the deleted row did not have is reported, never "confirmed"', async () => {
    const srv = pineServer({ hasScript: false, stamp: false, originOnSave: SHARE_ORIGIN })
    const { done, undone } = await deleteThenUndo(srv)
    expect(done.status).toBe('confirmed')
    expect(done.undo.definition.origin).toBe(undefined)
    expect(undone.status).toBe('did-not-land')
    expect(undone.error).toBe('The indicator came back, but with share details it did not have, so it is not exactly as it was.')
  })
  it('control: the same `origin` with its keys in another order (the store sorts them) still confirms', async () => {
    const reordered = Object.fromEntries(Object.entries(SHARE_ORIGIN).reverse())
    expect(JSON.stringify(reordered)).not.toBe(JSON.stringify(SHARE_ORIGIN))
    const srv = pineServer({ hasScript: false, stamp: false, origin: true, originOnSave: reordered })
    const { undone } = await deleteThenUndo(srv)
    expect(undone.status).toBe('confirmed')
  })
})

// review #1087 mutation H: each script wording is pinned to its own case
describe('F-15 — the not-exact message names the script difference it saw', () => {
  it('the read-back holds a DIFFERENT script than the one restored: "with a different saved script"', async () => {
    const srv = pineServer({ storeScriptOnSave: '//@version=5\nindicator("y")\nplot(close)' })
    const { undone } = await deleteThenUndo(srv)
    expect(undone.status).toBe('did-not-land')
    expect(undone.error).toBe('The indicator came back, but with a different saved script, so it is not exactly as it was.')
  })
  it('the read-back holds a script the deleted row did NOT have: "with a script it did not have"', async () => {
    const srv = pineServer({ hasScript: false, stamp: false, storeScriptOnSave: SCRIPT })
    const { done, undone } = await deleteThenUndo(srv)
    expect(done.status).toBe('confirmed')
    expect(done.undo.pineSource).toBe(undefined)
    expect(undone.status).toBe('did-not-land')
    expect(undone.error).toBe('The indicator came back, but with a script it did not have, so it is not exactly as it was.')
  })
})

describe('F-15 N4 — delete → Undo through the REAL doors (only fetch is stubbed)', () => {
  afterEach(() => { vi.unstubAllGlobals() })
  // A server double that follows the router: GET (with `?source=1` the script), DELETE (soft:
  // 404 after), PUT over the tombstone resurrects the same id, storing exactly the body it got.
  function fetchServer(row) {
    const state = { ...row, live: true }
    const puts = []
    const json = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body })
    const fetchStub = async (url, init = {}) => {
      const method = init.method || 'GET'
      if (!String(url).includes(`/api/user-definitions/${MINE}`)) return json(404, { detail: 'Not found' })
      if (method === 'GET') {
        if (!state.live) return json(404, { detail: 'Not found' })
        const withSource = String(url).includes('source=1')
        return json(200, { def_id: MINE, version: state.version, definition: JSON.parse(JSON.stringify(state.definition)), repaint: null,
          has_pine_source: state.pine_source != null, ...(withSource && state.pine_source != null ? { pine_source: state.pine_source } : {}) })
      }
      if (method === 'DELETE') { state.live = false; state.version += 1; return json(200, {}) }
      if (method === 'PUT') {
        const body = JSON.parse(init.body)
        puts.push(body)
        Object.assign(state, { definition: body.definition, pine_source: body.pine_source ?? null, live: true, version: state.version + 1 })
        return json(200, { def_id: MINE, version: state.version })
      }
      return json(405, { detail: 'Method not allowed' })
    }
    return { state, puts, fetchStub }
  }
  it('a stamped Pine import with its script: the real save door keeps the stamp, sends the script, and the restore is confirmed exact', async () => {
    const meta = { ...(FIX.styled_markers.meta || {}), name: 'My Breakout Dots', engineVersion: 1, recurrenceOrigin: registry.PINE_RECURRENCE_ORIGIN }
    const original = { ...FIX.styled_markers, id: MINE, meta }
    const srv = fetchServer({ version: 2, definition: JSON.parse(JSON.stringify(original)), pine_source: SCRIPT })
    vi.stubGlobal('fetch', srv.fetchStub)
    const p = planDefinitionAction({ op: 'delete', defId: MINE }, ctx({ charts: [] }))
    const done = await executeDefinitionAction(p.plan, ctx({ charts: [] }))
    expect(done.status).toBe('confirmed')
    expect(srv.state.live).toBe(false)
    const undone = await undoDefinitionAction(done.undo, ctx())
    expect(undone.status).toBe('confirmed')
    expect(srv.puts).toHaveLength(1)
    expect(srv.puts[0].pine_source).toBe(SCRIPT)
    expect(srv.puts[0].definition).toEqual(original)
    expect(srv.state.definition.meta.scriptEdited).toBe(undefined)
  })
  it('a legacy Pine import: the real doors are never asked to delete it (the save door WOULD mark it scriptEdited)', async () => {
    const meta = { ...(FIX.styled_markers.meta || {}), name: 'My Breakout Dots', recurrenceOrigin: registry.PINE_RECURRENCE_ORIGIN }
    const srv = fetchServer({ version: 2, definition: { ...FIX.styled_markers, id: MINE, meta }, pine_source: null })
    vi.stubGlobal('fetch', srv.fetchStub)
    const p = planDefinitionAction({ op: 'delete', defId: MINE }, ctx({ charts: [] }))
    const done = await executeDefinitionAction(p.plan, ctx({ charts: [] }))
    expect(done.detail.why).toBe(DELETE_REFUSALS.legacyImport)
    expect(srv.state.live).toBe(true)
    // and the premise, through the REAL save door: a scriptless save of it would come back marked
    const { saveUserDefinition } = await import('../../../hooks/useUserDefinitions')
    await saveUserDefinition(srv.state.definition, MINE, null, null)
    expect(srv.puts[0].definition.meta.scriptEdited).toBe(true)
  })
})

describe('F-15 — the read door asks for the script only when told to', () => {
  afterEach(() => { vi.unstubAllGlobals() })
  it('readUserDefinition(id, {withSource: true}) requests ?source=1; the default read does not', async () => {
    const urls = []
    vi.stubGlobal('fetch', async (url) => { urls.push(url); return { ok: true, status: 200, json: async () => ({ def_id: MINE }) } })
    await readUserDefinition(MINE, { withSource: true })
    await readUserDefinition(MINE)
    expect(urls[0].endsWith(`/${MINE}?source=1`)).toBe(true)
    expect(urls[1].endsWith(`/${MINE}`)).toBe(true)
  })
})
