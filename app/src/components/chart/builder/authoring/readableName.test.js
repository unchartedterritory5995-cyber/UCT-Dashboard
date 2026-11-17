// When the dock keeps the assistant's name for a new indicator (`readableName.js`).
//
// Measured on production 2026-11-15: the assistant named fourteen indicators well and the dock
// showed each one's formula instead. The rule that a short derived name follows the maths
// ("EMA 20" becomes "EMA 50" after "make it 50") is kept and proved here beside the new one.

import { describe, it, expect } from 'vitest'
import { newAuthoringState } from './index'
import { modelTurn } from './authoringSession'
import { humanName, derivedIsReadable, keepAssistantName, DERIVED_READABLE_MAX } from './readableName'

const PATCH = 'uct.authoring.patch/1'
const num = (value) => ({ type: 'num', value })
const s = (name) => ({ type: 'series', name })
const call = (name, ...args) => ({ type: 'call', name, args })
const op = (name, ...args) => ({ type: 'op', name, args })
const reply = (state, ops) => ({
  ok: true, turn: 'patch', disposition: 'change', reply: 'done', notUnderstood: [], unavailable: [],
  envelope: { contract: PATCH, baseRevision: state.revision || 0, ops, assumptions: [], disposition: 'change', reply: 'done' },
})
/** A long tree whose derived name is a formula: a 25-bar count of down days on higher volume. */
const DIST = call('sum', op('&&', op('<', s('close'), { type: 'offset', value: 1, args: [s('close')] }),
  op('>', s('volume'), { type: 'offset', value: 1, args: [s('volume')] })), num(25))
const createDist = (name) => [{ op: 'create', name, placement: 'pane', outputs: [{ key: 'value', tree: DIST }] }]
const createEma = (name) => [{ op: 'create', name, placement: 'price', outputs: [{ key: 'value', tree: call('ema', s('close'), num(20)) }] }]

async function turn(state, words, ops, keep = keepAssistantName) {
  const out = await modelTurn(state, () => state, words, { converse: async () => reply(state, ops), keepCreateName: keep })
  return out
}
const nameOf = (out) => out.state.working.meta.name

describe('the two questions (pure)', () => {
  it('a derived name is readable when it is short and not a formula', () => {
    expect(derivedIsReadable('EMA 20')).toBe(true)
    expect(derivedIsReadable('RSI 14')).toBe(true)
    expect(derivedIsReadable('EMA 9 > EMA 20')).toBe(false)
    expect(derivedIsReadable('SUM 25 (1 when Close at or below 0.998 times previous Close and Volume above pr…')).toBe(false)
    expect(derivedIsReadable('x'.repeat(DERIVED_READABLE_MAX + 1))).toBe(false)
    expect(derivedIsReadable('')).toBe(false)
    expect(derivedIsReadable(null)).toBe(false)
  })

  it('a human name is short words: no formula, no sentence, at most two number words', () => {
    for (const ok of ['Distribution Day Count', 'ATR Extension', 'Tight Weekly Closes', 'RS Line vs SPY', '50-Day Volume Ratio',
      // the assistant's own names from the house set, 2026-11-16: a slash, a percent sign, a bracketed number
      'Up/Down Volume Ratio (50)', 'Inside / Outside Bars', 'EMA 10/21 Trend', 'Average Daily Range %', 'Previous Week High/Low'])
      expect(humanName(ok), ok).toBe(ok)
    expect(humanName('Up Volume.')).toBe('Up Volume')                       // a trailing full stop is dropped
    for (const bad of ['', 'ab', 'x'.repeat(41), 'EMA 9 > EMA 20', 'Close above the 50 day average',
      'one two three four five six seven', '1 2 3', 'sum(close, 5)', 'What is this?', 'Ratio (close)', 'A * B'])
      expect(humanName(bad), bad).toBeNull()
  })

  it('keep the assistant\'s name only when it is a name AND the derived one is not readable', () => {
    expect(keepAssistantName('Distribution Day Count', { derivedName: 'SUM 25 (Close < Close[1] and …' })).toBe(true)
    expect(keepAssistantName('My Trend', { derivedName: 'EMA 20' })).toBe(false)            // the derived name is fine
    expect(keepAssistantName('close below previous close', { derivedName: 'SUM 25 (…' })).toBe(false)  // not a name
    expect(keepAssistantName('Distribution Day Count')).toBe(true)                          // nothing derived at all
  })
})

describe('through the turn', () => {
  it('an unreadable derived name gives way to the assistant\'s name', async () => {
    const st = newAuthoringState()
    const plain = await turn(st, 'count distribution days', createDist('Distribution Day Count'), null)
    expect(derivedIsReadable(nameOf(plain))).toBe(false)                   // control: what the dock showed before
    const out = await turn(st, 'count distribution days', createDist('Distribution Day Count'))
    expect(nameOf(out)).toBe('Distribution Day Count')
    expect(out.state.revision).toBe(plain.state.revision)                  // one revision, one Undo step
    expect(out.state.history).toHaveLength(1)
  })

  it('⛔ the rule it leaves alone: a short derived name is kept and still follows the maths', async () => {
    const st = newAuthoringState()
    const made = await turn(st, 'Add a 20 EMA', createEma('My Great Average'))
    expect(nameOf(made)).toBe('EMA 20')                                    // not the assistant's prose
    const view = made.state
    const slot = { op: 'set_output_tree', output: 'value', tree: call('ema', s('close'), num(50)) }
    const edited = await modelTurn(view, () => view, 'make it 50',
      { converse: async () => reply(view, [slot]), keepCreateName: keepAssistantName })
    expect(nameOf(edited)).toBe('EMA 50')
  })

  it('a kept name is a custom name: a later maths edit does not rewrite it', async () => {
    const st = newAuthoringState()
    const made = await turn(st, 'count distribution days', createDist('Distribution Day Count'))
    const view = made.state
    const wider = call('sum', DIST.args[0], num(30))
    const edited = await modelTurn(view, () => view, 'make it 30 days',
      { converse: async () => reply(view, [{ op: 'set_output_tree', output: 'value', tree: wider }]), keepCreateName: keepAssistantName })
    expect(nameOf(edited)).toBe('Distribution Day Count')
  })

  it('the member\'s own name wins over both', async () => {
    const st = newAuthoringState()
    const out = await turn(st, 'count distribution days and call it Selling Pressure', createDist('Distribution Day Count'))
    expect(nameOf(out)).toBe('Selling Pressure')
  })

  it('a name that is not a name leaves the derived one', async () => {
    const st = newAuthoringState()
    const out = await turn(st, 'count distribution days', createDist('close below previous close on higher volume'))
    expect(derivedIsReadable(nameOf(out))).toBe(false)
    expect(nameOf(out)).not.toMatch(/close below previous close on higher volume/)
  })
})
