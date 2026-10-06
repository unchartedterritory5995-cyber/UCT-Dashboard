// P2 release gate — THE NAME DESCRIBES THE DEFINITION (name-drift fix, 2026-10-06).
//
// ⚰️ Measured in the Slice 1 browser proof: "Add a 20 EMA" → "Make it 50" saved an
// indicator NAMED "EMA 20" that computed ema(close, 50). Each case: ASKED / CLAIMED / DID.

import { describe, it, expect } from 'vitest'
import {
  newAuthoringState, applyTurn, undo, readback, prepareSave, openAuthoringState, derivedDefName, modelOf,
} from '../../builder/authoring'
import { validateUserDefinitions } from '../nativeRegistry'

const C = 'uct.authoring.patch/1'
const num = (value) => ({ type: 'num', value })
const ser = (name) => ({ type: 'series', name })
const call = (name, ...args) => ({ type: 'call', name, args })
const op = (name, ...args) => ({ type: 'op', name, args })
const env = (s, ops, extra = {}) => ({ contract: C, baseRevision: s.revision, ops, assumptions: [], ...extra })
const turn = (s, ops) => {
  const out = applyTurn(s, env(s, ops))
  expect(out.result.status, JSON.stringify(out.result.errors)).toBe('applied')
  return out.state
}
const name = (s) => s.working.meta.name
const plot1Label = (s) => (s.working.plots ? s.working.plots[0].label : null)
const ema = (n, src = 'close') => call('ema', ser(src), num(n))

const createEma = (n = 20, modelName = 'My lovely moving average') =>
  turn(newAuthoringState({ lineage: 'auth_00000000name' }),
    [{ op: 'create', name: modelName, placement: 'price', outputs: [{ key: 'value', tree: ema(n), label: modelName }] }])

describe('P2 naming — derived names follow the maths; custom names stay custom', () => {
  it('1 CREATE EMA 20 — ASKED "add a 20 EMA" (model proposed prose); DID: name EMA 20, derived from the tree', () => {
    const s = createEma(20)
    expect(name(s)).toBe('EMA 20')
    expect(readback(s.working, s).lines[0]).toBe('Name: EMA 20')
  })

  it('2 PERIOD 20 → 50 — ASKED "make it 50"; DID: name EMA 50 and maths ema(close, 50)', () => {
    let s = createEma(20)
    s = turn(s, [{ op: 'set_slot', slot: 'value#1', value: 50 }])
    expect(s.working.compute.source).toBe('ema(close, 50)')
    expect(name(s)).toBe('EMA 50')
    expect(readback(s.working, s).name).toBe('EMA 50')
  })

  it('3 SOURCE close → open — DID: the name says what it reads (EMA 20 (Open)); readback agrees', () => {
    let s = createEma(20)
    s = turn(s, [{ op: 'set_slot', slot: 'value#0', series: 'open' }])
    expect(s.working.compute.source).toBe('ema(open, 20)')
    expect(name(s)).toBe('EMA 20 (Open)')
    expect(readback(s.working, s).outputs[0].sentence).toMatch(/open/)
  })

  it('4 CREATE RSI 14 > 70 — DID: deterministic name RSI 14 > 70 (not the model\'s "RSI overbought")', () => {
    const s = turn(newAuthoringState(), [{ op: 'create', name: 'RSI overbought', outputs: [{ tree: op('>', call('rsi', ser('close'), num(14)), num(70)) }] }])
    expect(name(s)).toBe('RSI 14 > 70')
  })

  it('5 THRESHOLD 70 → 80 — DID: the threshold is part of the name, so the name follows', () => {
    let s = turn(newAuthoringState(), [{ op: 'create', name: 'x', outputs: [{ tree: op('>', call('rsi', ser('close'), num(14)), num(70)) }] }])
    s = turn(s, [{ op: 'set_slot', slot: 'value#1', value: 80 }])
    expect(s.working.compute.source).toBe('rsi(close, 14) > 80')
    expect(name(s)).toBe('RSI 14 > 80')
  })

  it('6 EXPLICIT RENAME then MATHS EDIT — DID: "My Trend Line" survives "make the EMA 50"', () => {
    let s = createEma(20)
    s = turn(s, [{ op: 'rename_definition', name: 'My Trend Line' }])
    s = turn(s, [{ op: 'set_slot', slot: 'value#1', value: 50 }])
    expect(s.working.compute.source).toBe('ema(close, 50)')
    expect(name(s)).toBe('My Trend Line')
    // and a create that the member named in the same turn is custom from the start
    const named = turn(newAuthoringState(), [
      { op: 'create', name: 'x', placement: 'price', outputs: [{ key: 'value', tree: ema(20) }] },
      { op: 'rename_definition', name: 'Trend' }])
    expect(name(named)).toBe('Trend')
  })

  it('7 UNDO A MATHS EDIT — DID: the derived name returns WITH the maths', () => {
    let s = createEma(20)
    s = turn(s, [{ op: 'set_slot', slot: 'value#1', value: 50 }])
    s = undo(s)
    expect(s.working.compute.source).toBe('ema(close, 20)')
    expect(name(s)).toBe('EMA 20')
  })

  it('8 UNDO AN EXPLICIT RENAME — DID: the prior (auto) naming state is restored and is auto again', () => {
    let s = createEma(20)
    s = turn(s, [{ op: 'rename_definition', name: 'My Trend Line' }])
    s = undo(s)
    expect(name(s)).toBe('EMA 20')
    s = turn(s, [{ op: 'set_slot', slot: 'value#1', value: 50 }])
    expect(name(s)).toBe('EMA 50')                       // auto again, so it follows
  })

  it('9 SAVE / REOPEN — DID: the saved doc\'s name and maths agree; reopened, an auto name still follows, a custom one still holds', () => {
    let s = createEma(20)
    s = turn(s, [{ op: 'set_slot', slot: 'value#1', value: 50 }])
    const { doc, errors } = prepareSave(s, { draftId: 'u_00000000nam1' })
    expect(errors).toEqual([])
    expect(validateUserDefinitions([doc]).errors).toEqual([])
    expect([doc.meta.name, doc.compute.source]).toEqual(['EMA 50', 'ema(close, 50)'])
    // reload: the STORED row is the authority; the rule needs no stored flag
    let r = openAuthoringState({ ...doc, id: 'u_0000000store' }, { defId: 'u_0000000store', version: 1 })
    expect(derivedDefName(modelOf(r.working))).toBe(r.working.meta.name)
    r = turn(r, [{ op: 'set_slot', slot: 'value#1', value: 100 }])
    expect(name(r)).toBe('EMA 100')
    let c = turn(s, [{ op: 'rename_definition', name: 'Slow trend' }])
    const saved = prepareSave(c, { draftId: 'u_00000000nam2' }).doc
    c = openAuthoringState({ ...saved, id: 'u_0000000stor2' }, { defId: 'u_0000000stor2', version: 1 })
    c = turn(c, [{ op: 'set_slot', slot: 'value#1', value: 21 }])
    expect(name(c)).toBe('Slow trend')
  })

  it('10 MULTI-OUTPUT — DID: the name covers more than plot 1; each output label follows its own maths', () => {
    let s = turn(newAuthoringState(), [{ op: 'create', name: 'x', outputs: [
      { key: 'value', tree: op('>', call('rsi', ser('close'), num(14)), num(70)) },
      { key: 'rsi', tree: call('rsi', ser('close'), num(14)), label: 'RSI' }] }])
    expect(name(s)).toBe('RSI 14 > 70 · RSI 14')
    expect(s.working.plots.find((p) => p.key === 'rsi').label).toBe('RSI 14')
    s = turn(s, [{ op: 'set_slot', slot: 'rsi#1', value: 21 }])
    expect(name(s)).toBe('RSI 14 > 70 · RSI 21')
    expect(s.working.plots.find((p) => p.key === 'rsi').label).toBe('RSI 21')
    // a custom output label is kept through its own maths edit
    s = turn(s, [{ op: 'rename_output', output: 'rsi', label: 'Momentum' }])
    s = turn(s, [{ op: 'set_slot', slot: 'rsi#1', value: 9 }])
    expect(s.working.plots.find((p) => p.key === 'rsi').label).toBe('Momentum')
    expect(name(s)).toBe('RSI 14 > 70 · RSI 9')
  })

  it('READBACK CONSISTENCY — after every turn, name / formula / type / presentation all describe the SAME definition', () => {
    let s = createEma(20)
    for (const v of [50, 9, 200]) {
      s = turn(s, [{ op: 'set_slot', slot: 'value#1', value: v }])
      const rb = readback(s.working, s)
      expect(rb.name).toBe(`EMA ${v}`)
      expect(rb.outputs[0].sentence).toMatch(new RegExp(`the ${v}-bar exponential average of close`))
      expect(rb.outputs[0].type).toBe('series')
      expect(plot1Label(s) === null || plot1Label(s) === `EMA ${v}`).toBe(true)
    }
  })
})
