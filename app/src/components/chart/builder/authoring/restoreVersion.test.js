// GOING BACK TO AN EARLIER SAVED VERSION (restoreVersion.js; Indicators backlog 30).
//
// The rules were agreed with the engine's owner on 2026-11-17 and each has a rail here:
//   · one undoable step, nothing saved, the save still an edit on the opened version;
//   · a line keeps its place only when its identity is today's identity for the same key —
//     a key that holds a different line today, or that is absent today, comes back NEW;
//   · a version that cannot come back says why, by name;
//   · nothing the store decides is copied from the old version.
import { describe, it, expect } from 'vitest'
import { parseFormula } from '../../engine/ast/parse'
import { NEW_LINE_FLAG, lineIdentity } from '../../engine/lineIdentity'
import { HOST_KNOWN_DIVERGENCE_STAMP } from '../../engine/hostKnownDivergence'
import { applyPatch, openAuthoringState, undo, isDirty, prepareSave } from './index'
import {
  restoredDocument, restoreLineSummary, savedVersionRows, restoreTurn, restoreNote, NOT_USABLE,
} from './restoreVersion'

const P = (src) => { const r = parseFormula(src); if (!r.ok) throw new Error(`${src}: ${r.error}`); return r.ast }
const C = 'uct.authoring.patch/1'
const GATE = { tf: 'D', symbol: 'AAPL' }
const ID = 'u_0123456789ab'
const UID = (n) => `p_${String(n).repeat(12).slice(0, 12)}`

/** A stored document: outputs `[key, source, uid?]`, as the store serves it at `version`. */
const stored = (version, outputs, name = 'Mine') => {
  const r = applyPatch(null, { contract: C, baseRevision: 0, assumptions: [], ops: [{ op: 'create', name,
    outputs: outputs.map(([key, src]) => ({ key, label: key, tree: P(src) })) }] }, { gateCtx: GATE })
  expect(r.status, JSON.stringify(r.errors)).toBe('applied')
  const uids = Object.fromEntries(outputs.map(([key, , uid]) => [key, uid]))
  return {
    ...r.definition, id: ID, version,
    plots: r.definition.plots.map((p) => (uids[p.key] ? { ...p, uid: uids[p.key] } : p)),
  }
}
const row = (def, extra = {}) => ({ def_id: ID, version: def.version, definition: def, created_at: 1763300000 + def.version, deleted_at: null, ...extra })
const plot = (def, key) => def.plots.find((p) => p.key === key)

// version 1: two lines. version 2 (today): `fast` is the SAME line, `slow` was deleted, `mid` is new.
const V1 = stored(1, [['fast', 'ema(close, 10)', UID(1)], ['slow', 'ema(close, 50)', UID(2)]])
const V2 = stored(2, [['fast', 'ema(close, 12)', UID(1)], ['mid', 'ema(close, 21)', UID(3)]])

describe('the document that comes back', () => {
  it('a line whose identity is today’s keeps it; the rest of the old version is the old version', () => {
    const doc = restoredDocument(V1, V2)
    expect(doc.plots.map((p) => p.key)).toEqual(['fast', 'slow'])       // rule 3: `mid` is gone, as in any edit
    expect(plot(doc, 'fast').uid).toBe(UID(1))
    expect(NEW_LINE_FLAG in plot(doc, 'fast')).toBe(false)
    expect(JSON.stringify(doc.compute.trees || doc.compute.ast)).toBe(JSON.stringify(V1.compute.trees || V1.compute.ast))
  })

  it('⛔ a line deleted since then comes back as a NEW line: no identity carried, the new-line mark set', () => {
    const doc = restoredDocument(V1, V2)
    const slow = plot(doc, 'slow')
    expect(slow[NEW_LINE_FLAG]).toBe(true)
    expect('uid' in slow).toBe(false)                                   // an archived alert on p_2… cannot re-attach
    // CONTROL: the same key present today under the same identity is NOT marked
    const kept = restoredDocument(V1, { ...V2, plots: [...V2.plots, { ...plot(V1, 'slow') }] })
    expect(NEW_LINE_FLAG in plot(kept, 'slow')).toBe(false)
    expect(plot(kept, 'slow').uid).toBe(UID(2))
  })

  it('⛔ a key that holds a DIFFERENT line today comes back new, not as today’s line', () => {
    const today = { ...V2, plots: V2.plots.map((p) => (p.key === 'fast' ? { ...p, uid: UID(9) } : p)) }
    const fast = plot(restoredDocument(V1, today), 'fast')
    expect(fast[NEW_LINE_FLAG]).toBe(true)
    expect('uid' in fast).toBe(false)
  })

  it('lines from before identities existed are matched by their key, and only by an equal identity', () => {
    const bare = (def) => ({ ...def, plots: def.plots.map(({ uid: _u, ...p }) => p) })
    expect(lineIdentity(plot(bare(V1), 'fast'))).toBe('k:fast')
    const both = plot(restoredDocument(bare(V1), bare(V2)), 'fast')
    expect(NEW_LINE_FLAG in both).toBe(false)
    expect('uid' in both).toBe(false)
    // old version had no identity, today's line has one: not the same line
    expect(plot(restoredDocument(bare(V1), V2), 'fast')[NEW_LINE_FLAG]).toBe(true)
  })

  it('what the store decides follows the CURRENT version, never the old one', () => {
    const old = { ...V1, compute: { ...V1.compute, rev: 1, paramState: { a: 1 } }, meta: { ...V1.meta, semantics: 2 } }
    const today = { ...V2, compute: { ...V2.compute, rev: 7 } }           // no paramState, no semantics today
    const doc = restoredDocument(old, today)
    expect([doc.id, doc.version, doc.compute.rev]).toEqual([ID, 2, 7])
    expect('paramState' in doc.compute).toBe(false)
    expect('semantics' in doc.meta).toBe(false)
    expect(doc.meta.name).toBe(old.meta.name)                             // the member's own content is the old version's
    // and it goes the other way: today's stamps are put on
    const doc2 = restoredDocument(V1, { ...V2, meta: { ...V2.meta, semantics: 2 }, compute: { ...V2.compute, paramState: { b: 2 } } })
    expect(doc2.meta.semantics).toBe(2)
    expect(doc2.compute.paramState).toEqual({ b: 2 })
  })

  it('changes neither document it was given, and has nothing to say about nothing', () => {
    const a = JSON.stringify(V1); const b = JSON.stringify(V2)
    restoredDocument(V1, V2)
    expect([JSON.stringify(V1), JSON.stringify(V2)]).toEqual([a, b])
    expect(restoredDocument(null, V2)).toBeNull()
  })

  it('counts what happens to the lines, and says it in a sentence', () => {
    expect(restoreLineSummary(V1, V2)).toEqual({ same: 1, fresh: 1, removed: 1 })
    expect(restoreNote({ same: 1, fresh: 1, removed: 1 }))
      .toBe('1 line comes back as a new line: alerts and references made to the old one stay off. 1 line added since then is removed.')
    expect(restoreNote({ same: 2, fresh: 0, removed: 0 })).toBe('')
    expect(restoreNote({ same: 0, fresh: 2, removed: 3 })).toMatch(/^2 lines come back as new lines.* 3 lines added since then are removed\.$/)
  })
})

describe('the list the dock shows', () => {
  const ctx = (working = V2) => ({ currentDef: V2, currentVersion: 2, workingDef: working })

  it('newest first; an earlier version is one press away; the one the draft started from is not, until the draft moves', () => {
    const rows = savedVersionRows([row(V1), row(V2)], ctx())
    expect(rows.map((r) => [r.version, r.current, r.usable, r.why])).toEqual([
      [2, true, false, NOT_USABLE.current],
      [1, false, true, null],
    ])
    expect(rows[1].lines).toEqual({ same: 1, fresh: 1, removed: 1 })
    expect(rows[1].name).toBe(V1.meta.name)                              // the name it had THEN
    expect(V1.meta.name).not.toBe(V2.meta.name)
    expect(rows[1].at).toBe(1763300001)
    // once the draft is version 1 again, version 2 can come back and version 1 has nothing to offer
    const after = savedVersionRows([row(V1), row(V2)], ctx(rows[1].doc))
    expect(after.map((r) => [r.version, r.usable, r.why])).toEqual([[2, true, null], [1, false, NOT_USABLE.same]])
  })

  it('⛔ a version that cannot come back is LISTED with its reason, never left out', () => {
    const refusedDef = { ...V1, version: 1, meta: { ...V1.meta, [HOST_KNOWN_DIVERGENCE_STAMP]: 'This script is listed as drawing differently from TradingView.' } }
    const V0 = stored(1, [['fast', 'ema(close, 10)', UID(1)]])
    const rows = savedVersionRows([
      row(refusedDef),
      row({ ...V0, version: 3 }, { version: 3, deleted_at: 1763300009 }),
      row({ ...V0, version: 4, compute: { ...V0.compute, paramManifest: { __uct_param_1: { sourceName: 'len' } } } }, { version: 4 }),
      row(V2, { version: 5 }),
    ], { currentDef: V2, currentVersion: 5, workingDef: V2 })
    const by = Object.fromEntries(rows.map((r) => [r.version, r]))
    expect(rows).toHaveLength(4)
    expect([by[1].usable, by[1].why]).toEqual([false, NOT_USABLE.refused])
    expect(by[1].text).toMatch(/^This script is listed as drawing differently from TradingView\./)   // the door's own sentence
    expect(by[1].text).not.toMatch(/u_0123456789ab/)                                                 // without the document's id
    expect([by[3].usable, by[3].why, by[3].text]).toEqual([false, NOT_USABLE.deleted, 'Deleted at this point.'])
    expect([by[4].usable, by[4].why]).toEqual([false, NOT_USABLE.parameters])
    for (const r of rows) if (!r.usable) { expect(r.text, String(r.version)).toBeTruthy(); expect(r.doc).toBeNull() }
    // CONTROL: the same version without the stamp IS usable, so the refusal above is the stamp's
    expect(savedVersionRows([row(V1), row(V2)], { currentDef: V2, currentVersion: 2, workingDef: V2 })[1].usable).toBe(true)
  })

  it('rows that are not versions are ignored, and no list is an empty list', () => {
    expect(savedVersionRows(null, ctx())).toEqual([])
    expect(savedVersionRows([null, { version: 'x' }, row(V1)], ctx()).map((r) => r.version)).toEqual([1])
  })
})

describe('bringing one back', () => {
  const open = () => openAuthoringState(V2, { defId: ID, version: 2 })
  const pick = (state, version) => savedVersionRows([row(V1), row(V2)], { currentDef: state.base, currentVersion: state.baseVersion, workingDef: state.working })
    .find((r) => r.version === version)

  it('is ONE step: the draft is the old version, Undo is today’s again, and nothing about the base moved', () => {
    const before = open()
    expect(isDirty(before)).toBe(false)
    const out = restoreTurn(before, pick(before, 1))
    expect(out.ok).toBe(true)
    expect(out.changed).toBe(true)
    expect(out.state.history).toHaveLength(before.history.length + 1)
    expect(out.state.revision).toBe(before.revision + 1)
    expect(out.state.working.plots.map((p) => p.key)).toEqual(['fast', 'slow'])
    expect([out.state.defId, out.state.baseVersion, out.state.base]).toEqual([ID, 2, before.base])
    expect(isDirty(out.state)).toBe(true)
    expect(out.entries[0].lines[0]).toBe('Went back to saved version 1. Nothing is saved until you save.')
    expect(out.entries[0].lines[1]).toMatch(/comes back as a new line/)
    const back = undo(out.state)
    expect(back.working).toBe(before.working)
    expect(isDirty(back)).toBe(false)
  })

  it('the save it leads to is an ordinary edit on the opened version, carrying the new-line mark', () => {
    const out = restoreTurn(open(), pick(open(), 1))
    const save = prepareSave(out.state)
    expect(save.errors).toEqual([])
    expect([save.defId, save.doc.id, save.doc.version]).toEqual([ID, ID, 3])
    expect(plot(save.doc, 'slow')[NEW_LINE_FLAG]).toBe(true)
    expect(plot(save.doc, 'fast').uid).toBe(UID(1))
  })

  it('a row that is not usable changes nothing and says why', () => {
    const before = open()
    const out = restoreTurn(before, pick(before, 2))
    expect([out.ok, out.state, out.changed]).toEqual([false, null, false])
    expect(out.message).toBe('The saved version this draft started from.')
    expect(restoreTurn(before, null).ok).toBe(false)
  })
})
