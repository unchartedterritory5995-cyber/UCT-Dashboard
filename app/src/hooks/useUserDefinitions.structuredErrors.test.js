// app/src/hooks/useUserDefinitions.structuredErrors.test.js
//
// ⭐ AGENT M1 / M2 PREP — the save door's structured refusals reach the caller. A 422
// `refusal {gate, plot, mode, guard, errors?}` and a 409 `conflict {def_id,
// expected_version, current_version}` used to be flattened to one sentence; they now
// ride beside it, additively — `error`, `conflict: true` and `ok` are exactly as before.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { saveUserDefinition, structuredRefusal, structuredConflict } from './useUserDefinitions'
import { storeConversation } from '../components/chart/builder/conversationSave'

const reply = (status, body) => vi.spyOn(globalThis, 'fetch').mockResolvedValue(
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }))

afterEach(() => vi.restoreAllMocks())

describe('saveUserDefinition — structured refusals', () => {
  it('422: the refusal is passed through (plain fields), the sentence is unchanged', async () => {
    reply(422, { detail: 'plots[0].colorPalette[1] is not a colour', refusal: {
      gate: 'presentation', guard: 'presentation:colour', plot: null, mode: null,
      errors: [{ code: 'presentation-colour', message: 'not a colour', path: 'plots[0].colorPalette[1]', extra: { x: 1 } }] } })
    const r = await saveUserDefinition({ id: 'x' }, null)
    expect(r).toMatchObject({ ok: false, status: 422, error: 'plots[0].colorPalette[1] is not a colour' })
    expect(r.refusal).toEqual({ gate: 'presentation', guard: 'presentation:colour', plot: null, mode: null,
      errors: [{ code: 'presentation-colour', message: 'not a colour', path: 'plots[0].colorPalette[1]' }] })
    expect(r.conflict).toBeUndefined()
  })

  it('409: conflict stays `true` and its details ride in `conflictInfo`', async () => {
    reply(409, { detail: 'This indicator changed since you opened it.', conflict: { def_id: 'u_aaaaaaaaaaaa', expected_version: 2, current_version: 3 } })
    const r = await saveUserDefinition({ id: 'u_aaaaaaaaaaaa' }, 'u_aaaaaaaaaaaa', null, { baseVersion: 2 })
    expect(r).toMatchObject({ ok: false, status: 409, conflict: true,
      conflictInfo: { defId: 'u_aaaaaaaaaaaa', expectedVersion: 2, currentVersion: 3 } })
  })

  it('a body with no structure adds nothing new but the status (the old shape, unchanged)', async () => {
    reply(400, { detail: 'too many definitions' })
    const r = await saveUserDefinition({ id: 'x' }, null)
    expect(r).toEqual({ ok: false, status: 400, error: 'too many definitions' })
  })

  it('the reducers drop anything that is not the documented shape', () => {
    expect(structuredRefusal(null)).toBe(null)
    expect(structuredRefusal({ plot: 'p' })).toBe(null)                 // no gate, no guard
    expect(structuredRefusal({ gate: 'tree', guard: 7, errors: 'x' })).toEqual({ gate: 'tree', guard: null, plot: null, mode: null })
    expect(structuredConflict([1])).toBe(null)
    expect(structuredConflict({ current_version: 4 })).toEqual({ defId: null, expectedVersion: null, currentVersion: 4 })
  })
})

describe('storeConversation carries them to the studio', () => {
  it('a 422 refusal reaches the caller of the studio save', async () => {
    const save = vi.fn().mockResolvedValue({ ok: false, error: 'refused', status: 422, refusal: { gate: 'budget', guard: 'budget:nodes', plot: 'v', mode: null } })
    const { newAuthoringState } = await import('../components/chart/builder/authoring/authoringState')
    const { applyTurn } = await import('../components/chart/builder/authoring/authoringState')
    const st = applyTurn(newAuthoringState(), { contract: 'uct.authoring.patch/1', baseRevision: 0, assumptions: [],
      ops: [{ op: 'create', name: 'X', placement: 'pane', outputs: [{ key: 'v', tree: { type: 'call', name: 'rsi', args: [{ type: 'series', name: 'close' }, { type: 'num', value: 14 }] } }] }] },
    { gateCtx: { tf: 'D', symbol: 'AAPL' } }).state
    const r = await storeConversation(st, { save })
    expect(r).toMatchObject({ ok: false, stage: 'store', refusal: { gate: 'budget', guard: 'budget:nodes' } })
  })
})
