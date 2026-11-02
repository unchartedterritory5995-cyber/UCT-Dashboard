// app/src/components/chart/builder/authoring/lineIdentity.authoring.test.js
//
// ⭐⭐ LINE IDENTITY — THE CONVERSATION'S HALF OF THE DRAFT MARKER (owner decision 2026-11-02).
//
// An output the conversation ADDS to a stored definition reaches the store with
// `newLine: true`, through the real doors: `applyTurn` → `prepareSave` (the shipped
// `validateUserDefinitions`) → `storeConversation` → `saveUserDefinition` (the PUT body).
// The copy the tab installs marks it pending, and the next conversation opened from that
// copy does not resend it.

import { describe, it, expect, vi, afterEach } from 'vitest'
import { parseFormula } from '../../engine/ast/parse'
import { buildDefinition } from '../BuilderSheet'
import { evaluateFormula } from '../FormulaField'
import { BUILDER_INPUTS, BUILDER_INPUT_SCOPE } from '../builderInputs'
import { applyTurn, openAuthoringState, newAuthoringState, prepareSave, isDirty } from './index'
import { storeConversation } from '../conversationSave'
import { saveUserDefinition } from '../../../../hooks/useUserDefinitions'

const P = (src) => { const r = parseFormula(src); if (!r.ok) throw new Error(`${src}: ${r.error}`); return r.ast }
const C = 'uct.authoring.patch/1'
const env = (rev, ops) => ({ contract: C, baseRevision: rev, ops, assumptions: [] })
const GATE = { tf: 'D', symbol: 'AAPL' }
const DEF_ID = 'u_0000000lid02'
const UID_V = 'p_000000000001'
const UID_F = 'p_aaaaaaaaaaaa'

function row(key, text) {
  const ev = evaluateFormula(text, BUILDER_INPUT_SCOPE)
  return { key, label: '', style: 'line', color: BUILDER_INPUTS[0].default, width: BUILDER_INPUTS[1].default,
    hidden: false, source: ev.source, ast: ev.ast, mode: ev.verdict.mode, readback: ev.readback }
}
function stored() {
  const rows = [row('value', 'close'), row('fast', 'close * 2')]
  const d = buildDefinition({
    defId: DEF_ID, version: 1, rev: 1, name: 'Lines', source: rows[0].source, ast: rows[0].ast,
    mode: rows[0].mode, readback: rows[0].readback, inputs: [...BUILDER_INPUTS], plots: rows, scanPlot: 'value',
  })
  d.plots = d.plots.map((p) => ({ ...p, uid: p.key === 'value' ? UID_V : UID_F }))
  return d
}
const plotOf = (doc, key) => doc.plots.find((p) => p.key === key)
function turn(state, ops) {
  const out = applyTurn(state, env(state.revision, ops), { defId: DEF_ID, gateCtx: GATE })
  expect(out.result.status, JSON.stringify(out.result.errors)).toBe('applied')
  return out.state
}

afterEach(() => { vi.restoreAllMocks(); delete global.fetch })

describe('the conversation marks a line it adds to a stored definition', () => {
  it('ASKED remove "fast", add a NEW "fast" in one turn · CLAIMED the body says new line · DID — through the real save doors', async () => {
    const s = turn(openAuthoringState(stored(), { defId: DEF_ID, version: 1 }), [
      { op: 'remove_output', output: 'fast' },
      { op: 'add_output', key: 'fast', label: 'Fast', tree: P('close * 3') },
    ])
    expect(plotOf(s.working, 'fast').newLine).toBe(true)
    expect(plotOf(s.working, 'fast').uid, "the removed line's uid was grafted onto the new one").toBeUndefined()
    expect('newLine' in plotOf(s.working, 'value')).toBe(false)
    expect(plotOf(s.working, 'value').uid).toBe(UID_V)

    const prep = prepareSave(s)
    expect(prep.errors).toEqual([])                     // the shipped validator admits the marker
    expect(plotOf(prep.doc, 'fast').newLine).toBe(true)

    // the REAL `saveUserDefinition` — what reaches the network
    const sent = []
    global.fetch = vi.fn(async (url, init = {}) => {
      sent.push({ method: init.method, body: init.body ? JSON.parse(init.body) : null })
      return { ok: true, status: 200, json: async () => ({ def_id: DEF_ID, version: 2, rev: 2 }) }
    })
    const res = await storeConversation(s, { save: saveUserDefinition })
    expect(res.ok, res.error).toBe(true)
    const put = sent.find((r) => r.method === 'PUT')
    expect(plotOf(put.body.definition, 'fast').newLine).toBe(true)
    expect('newLine' in plotOf(put.body.definition, 'value')).toBe(false)

    // this tab's copy: the continuing line keeps its uid, the new one is pending
    expect(plotOf(res.storedDoc, 'value').uid).toBe(UID_V)
    expect(plotOf(res.storedDoc, 'fast')).toMatchObject({ newLine: true })
    expect(plotOf(res.storedDoc, 'fast').uid).toBeUndefined()

    // …and the conversation reopened from it does not resend the marker
    const reopened = openAuthoringState(res.storedDoc, { defId: DEF_ID, version: 2 })
    expect(reopened.working.plots.some((p) => 'newLine' in p)).toBe(false)
    expect(isDirty(reopened)).toBe(false)
    expect(prepareSave(reopened).doc.plots.some((p) => 'newLine' in p)).toBe(false)
  })

  it("the store's answer, when it gives one, is what the tab installs", async () => {
    const s = turn(openAuthoringState(stored(), { defId: DEF_ID, version: 1 }), [
      { op: 'add_output', key: 'extra', label: 'Extra', tree: P('close * 4') },
    ])
    const save = async () => ({ ok: true, row: { def_id: DEF_ID, version: 2, rev: 2,
      plot_identities: { value: UID_V, fast: UID_F, extra: 'p_eeeeeeeeeeee' } } })
    const res = await storeConversation(s, { save })
    expect(plotOf(res.storedDoc, 'extra')).toMatchObject({ uid: 'p_eeeeeeeeeeee' })
    expect('newLine' in plotOf(res.storedDoc, 'extra')).toBe(false)
  })

  it('CONTROL — changing a stored output\'s maths is the SAME line: no marker', () => {
    const s = turn(openAuthoringState(stored(), { defId: DEF_ID, version: 1 }), [
      { op: 'set_output_tree', output: 'fast', tree: P('close * 3') },
    ])
    expect(s.working.plots.some((p) => 'newLine' in p)).toBe(false)
    expect(prepareSave(s).doc.plots.some((p) => 'newLine' in p)).toBe(false)
  })

  it('a CREATE carries no marker (nothing stored to inherit from)', () => {
    const s = turn(newAuthoringState(), [
      { op: 'create', name: 'Fresh', outputs: [{ key: 'value', label: 'Value', tree: P('close') }] },
      { op: 'add_output', key: 'fast', label: 'Fast', tree: P('close * 2') },
    ])
    expect(s.working.plots.some((p) => 'newLine' in p)).toBe(false)
    expect(prepareSave(s).doc.plots.some((p) => 'newLine' in p)).toBe(false)
  })
})
