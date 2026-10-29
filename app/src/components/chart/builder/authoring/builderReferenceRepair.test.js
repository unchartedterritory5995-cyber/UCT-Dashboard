// 2026-10-28 production failure — "create a custom indicator that shows the difference between the 9ema
// and 20ema as a percentage, put it in a separate pane" ended at "UCT Intelligence proposed a change that
// does not fit this indicator". The server now refuses (and repairs) a dangling reference before the
// browser sees it (`tests/test_builder_reference_repair.py`). These rails pin the BROWSER half: the
// correct answer builds in its own pane, the server and browser name the same slots, a first output with
// no key is disclosed like a keyed one, and the canonical refusals are unchanged.
import { describe, it, expect } from 'vitest'
import { newAuthoringState, applyTurn } from './index'
import { slotsOfTree } from './slots'
import CASES from './slotIdCases.json'

const close = { type: 'series', name: 'close' }
const call = (name, ...args) => ({ type: 'call', name, args })
const num = (value) => ({ type: 'num', value })
const op = (name, ...args) => ({ type: 'op', name, args })
const E9 = call('ema', close, num(9)), E20 = call('ema', close, num(20))
const PCT = op('*', op('/', op('-', E9, E20), E20), num(100))
const WORDS = 'create a custom indicator that shows the difference between the 9ema and 20ema as a percentage, put it in a separate pane'
const env = (ops, assumptions = []) => ({ contract: 'uct.authoring.patch/1', baseRevision: 0, disposition: 'change', reply: 'Built it.', assumptions, ops })
const create = (outputs, extra = {}) => ({ op: 'create', name: 'EMA 9/20 % Diff', placement: 'pane', outputs, ...extra })
const turn = (patch) => applyTurn(newAuthoringState(), patch, { memberWords: WORDS })

describe('the 2026-10-28 request, in the browser engine', () => {
  it('builds ((EMA9 − EMA20) / EMA20) × 100 in its own pane', () => {
    const { result, state } = turn(env([create([{ key: 'diff', label: 'EMA 9/20 % Diff', tree: PCT }])],
      [{ slot: 'diff#0.0.0.1', text: 'The member’s 9.' }]))
    expect(result.status).toBe('applied')
    expect(state.working.placement.target).toBe('pane')
    expect(state.working.plots.map((p) => p.key)).toEqual(['diff'])
    expect(result.assumptions[0]).toMatchObject({ slot: 'diff#0.0.0.1', value: 9 })
  })

  it('builds the helper-outputs form too (hidden EMAs, the percentage primary)', () => {
    const { result } = turn(env([create([{ key: 'ema9', tree: E9, hidden: true }, { key: 'ema20', tree: E20, hidden: true },
      { key: 'pct', tree: PCT }], { primary: 'pct' })]))
    expect(result.status).toBe('applied')
  })

  it('discloses against a first output with no key exactly as against a keyed one', () => {
    const keyed = turn(env([create([{ key: 'value', tree: PCT }])], [{ slot: 'value#1', text: 'Scaled to percent.' }])).result
    const bare = turn(env([create([{ tree: PCT }])], [{ slot: 'value#1', text: 'Scaled to percent.' }])).result
    expect(bare.status).toBe('applied')
    expect(bare.assumptions).toEqual(keyed.assumptions)
  })
})

describe('canonical validation is unchanged', () => {
  it.each([
    ['an assumption naming no output', env([create([{ key: 'diff', tree: PCT }])], [{ output: 'pct_diff', text: 'x' }]), 'assumption:unknown-output'],
    ['a guessed slot id', env([create([{ key: 'diff', tree: PCT }])], [{ slot: 'diff#9', text: 'x' }]), 'assumption:unknown-slot'],
    ['an unkeyed second output', env([create([{ key: 'a', tree: E9 }, { tree: PCT }])]), 'create:key-required'],
    ['a placement outside the enum', env([create([{ key: 'diff', tree: PCT }], { placement: 'separate' })]), 'schema:enum'],
  ])('%s is still refused whole', (_label, patch, code) => {
    const { result, state } = turn(patch)
    expect(result.status).toBe('refused')
    expect(result.errors.map((e) => e.code)).toContain(code)
    expect(state.working).toBeNull()
  })
})

describe('server and browser name the same slots (slotIdCases.json)', () => {
  it('has cases', () => expect(CASES.cases.length).toBeGreaterThanOrEqual(3))
  it.each(CASES.cases.map((c) => [c.name, c]))('%s', (_name, c) => {
    expect(slotsOfTree(c.key, c.tree).map((s) => s.id)).toEqual(c.ids)
  })
})
