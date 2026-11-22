// A NOTE SAYS WHO SAID IT (ruling 2026-11-18).
//
// Read in the live window: The UCT Agent assumed: "Built to UCT's checked formula for Directional
// Movement Index ...". That sentence is the DOOR's statement of what was built, not something the
// assistant assumed. The door now marks its own notes `by: "uct"`, and the window prints them as
// they stand. What the assistant wrote is still quoted as the assistant's, never stated as fact.
//
// The mark is the door's alone: the door strips it from the assistant's answer and sends it only
// to a browser that says it accepts it (`tests/test_note_by.py`). This file holds the browser half.

import { describe, it, expect } from 'vitest'
import { parseFormula } from '../../engine/ast/parse'
import { applyTurn, newAuthoringState } from './index'
import { validatePatchShape, assertSubset, PATCH_SCHEMA } from './patchValidate'
import { converseBody, ACCEPTS } from './converseClient'

const P = (src) => {
  const r = parseFormula(src)
  if (!r.ok) throw new Error(`${src}: ${JSON.stringify(r)}`)
  return r.ast
}
const C = 'uct.authoring.patch/1'
const CHECKED = "Built to UCT's checked formula for On Balance Volume: checked against an independent calculation."
const patch = (assumptions) => ({
  contract: C, baseRevision: 0, disposition: 'change', assumptions,
  ops: [{ op: 'create', name: 'x', outputs: [{ key: 'a', tree: P('ema(close, 20)') }, { key: 'b', tree: P('ema(close, 50)') }] }],
})
const turn = (assumptions) => {
  const state = newAuthoringState({ lineage: 'auth_000000000000' })
  const got = applyTurn(state, patch(assumptions), { gateCtx: { tf: 'D', symbol: 'SPY' } })
  if (got.result.status !== 'applied') throw new Error(JSON.stringify(got.result.errors))
  return got
}

describe('a note the door wrote', () => {
  it('is printed as it stands; what the assistant wrote is still quoted as the assistant\'s', () => {
    const { readback, state } = turn([
      { output: 'a', text: CHECKED, by: 'uct' },
      { text: 'Using an exponential average, as you chose before.', by: 'uct' },
      { output: 'b', text: 'Drawn on the price pane.' },
      { text: 'you meant daily bars' },
    ])
    expect(readback.assumptions).toEqual([
      CHECKED,
      'Using an exponential average, as you chose before.',
      'The UCT Agent assumed: "Drawn on the price pane."',
      'The UCT Agent assumed: "you meant daily bars"',
    ])
    expect(state.assumptions.map((a) => a.source)).toEqual(['uct', 'uct', 'model', 'model'])
  })

  it('CONTROL: without the mark every note is the assistant\'s, exactly as before', () => {
    const { readback } = turn([{ output: 'a', text: CHECKED }])
    expect(readback.assumptions).toEqual([`The UCT Agent assumed: "${CHECKED}"`])
  })

  it('the contract admits the one value and nothing else', () => {
    expect(() => assertSubset()).not.toThrow()
    expect(PATCH_SCHEMA.$defs.assumption.properties.by).toEqual({ enum: ['uct'], 'x-uct-door-only': true })
    expect(validatePatchShape(patch([{ text: 'x', by: 'uct' }]))).toEqual({ ok: true, errors: [] })
    for (const by of ['model', 'UCT', '', true, null]) {
      expect(validatePatchShape(patch([{ text: 'x', by }])).ok).toBe(false)
    }
    expect(validatePatchShape(patch([{ text: 'x', said_by: 'uct' }])).ok).toBe(false)
  })

  it('the browser tells the door it accepts the mark, on every turn', () => {
    const body = converseBody({ message: 'add an ema', state: newAuthoringState({ lineage: 'auth_000000000000' }) })
    expect(body.accepts).toEqual(['note.by', 'offer'])
    expect(ACCEPTS).toEqual(['note.by', 'offer'])
    body.accepts.push('x')
    expect(ACCEPTS).toEqual(['note.by', 'offer'])                                   // each body gets its own copy
  })
})
