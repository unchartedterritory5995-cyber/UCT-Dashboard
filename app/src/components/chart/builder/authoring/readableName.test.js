// When the dock keeps the assistant's name for a new indicator (`readableName.js`).
//
// Measured on production 2026-11-15: the assistant named fourteen indicators well and the dock
// showed each one's formula instead. The rule that a short derived name follows the maths
// ("EMA 20" becomes "EMA 50" after "make it 50") is kept and proved here beside the new one.

import { describe, it, expect } from 'vitest'
import { newAuthoringState } from './index'
import { modelTurn } from './authoringSession'
import { humanName, humanLabel, derivedIsReadable, keepAssistantName, keepAssistantLabel, DERIVED_READABLE_MAX, LABEL_MAX } from './readableName'

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

  it('arithmetic spelled in words is still a formula; a comparison is a sentence and stays readable', () => {
    for (const formula of ['Close divided by SPY Close', 'EMA 12 minus EMA 26', 'High plus Low', '2 times ATR 14'])
      expect(derivedIsReadable(formula), formula).toBe(false)
    for (const sentence of ['Close above SMA 50', 'EMA 10 crosses above EMA 21', 'Volume below SMA 20'])
      expect(derivedIsReadable(sentence), sentence).toBe(true)
    expect(derivedIsReadable('Timestamp')).toBe(true)                      // "times" inside a word is not the operator
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

// ─── each LINE's label, by the same rule (2026-11-17) ─────────────────────────
//
// Measured on production over fifty requests: the assistant labelled its lines "Signal",
// "Histogram", "+DI", "Upper Band"; the window, the legend and the Plots tab showed
// "EMA 9 (EMA 12 minus EMA 26)" and "PLUSDI 14 (High, Low)".

const MACD = op('-', call('ema', s('close'), num(12)), call('ema', s('close'), num(26)))
const createMacd = (labels = ['MACD', 'Signal', 'Histogram', 'Fast average']) => [{ op: 'create', name: 'MACD', placement: 'pane', outputs: [
  { key: 'macdLine', label: labels[0], tree: MACD },
  { key: 'signalLine', label: labels[1], tree: call('ema', MACD, num(9)) },
  { key: 'hist', label: labels[2], tree: op('-', MACD, call('ema', MACD, num(9))) },
  { key: 'fast', label: labels[3], tree: call('ema', s('close'), num(12)) },
] }]
const labelsOf = (out) => Object.fromEntries(out.state.working.plots.map((p) => [p.key, p.label]))
async function labelTurn(state, words, ops, { name = keepAssistantName, label = keepAssistantLabel } = {}) {
  return modelTurn(state, () => state, words, { converse: async () => reply(state, ops), keepCreateName: name, keepCreateLabel: label })
}

describe('a line\'s label (pure)', () => {
  it('a label is short words; two characters, a leading plus and above / below are allowed', () => {
    for (const ok of ['Signal', 'Histogram', '%K', '%D', '+DI', '-DI', 'R1', 'Upper Band', 'RS at 52-week high',
      '% Below 52W High', 'Price Above 50 Average', 'OBV 20 average', 'Accumulation Days (25)'])
      expect(humanLabel(ok), ok).toBe(ok)
    expect(humanLabel('Midline.')).toBe('Midline')
    for (const bad of ['', 'K', 'x'.repeat(LABEL_MAX + 1), 'Volume > 2x 50-bar average', 'Middle (20 EMA)', 'A + B', 'ema(close, 9)',
      'close when volume is high', 'EMA 9 minus EMA 26', '1 2 3', '12', 'one two three four five six seven', 'What?'])
      expect(humanLabel(bad), bad).toBeNull()
  })

  it('keep the assistant\'s label only when it is a label AND the derived one is not readable', () => {
    expect(keepAssistantLabel('Signal', { derivedLabel: 'EMA 9 (EMA 12 minus EMA 26)' })).toBe(true)
    expect(keepAssistantLabel('Fast average', { derivedLabel: 'EMA 12' })).toBe(false)       // the derived label is fine
    expect(keepAssistantLabel('ema(close, 9)', { derivedLabel: 'EMA 9 (EMA 12 minus EMA 26)' })).toBe(false)
  })
})

describe('a line\'s label, through the turn', () => {
  it('an unreadable derived label gives way to the assistant\'s; a readable one is kept', async () => {
    const st = newAuthoringState()
    const before = labelsOf(await labelTurn(st, 'macd', createMacd(), { label: null }))
    expect(derivedIsReadable(before.signalLine)).toBe(false)               // control: what the window showed
    expect(derivedIsReadable(before.hist)).toBe(false)
    const out = await labelTurn(st, 'macd', createMacd())
    const after = labelsOf(out)
    expect(after.signalLine).toBe('Signal')
    expect(after.hist).toBe('Histogram')
    expect(after.macdLine).toBe('MACD')                                    // the first line: here it follows the indicator's kept name
    expect(after.fast).toBe('EMA 12')                                      // ⛔ readable: still the maths, not "Fast average"
    expect(out.state.history).toHaveLength(1)                              // one revision, one Undo step
  })

  it('⛔ a readable derived label still follows the maths after an edit', async () => {
    const st = newAuthoringState()
    const made = await labelTurn(st, 'macd', createMacd())
    const view = made.state
    const edited = await modelTurn(view, () => view, 'make the fast one 15',
      { converse: async () => reply(view, [{ op: 'set_output_tree', output: 'fast', tree: call('ema', s('close'), num(15)) }]),
        keepCreateName: keepAssistantName, keepCreateLabel: keepAssistantLabel })
    expect(labelsOf(edited).fast).toBe('EMA 15')
    expect(labelsOf(edited).signalLine).toBe('Signal')                     // a kept label is custom: the edit leaves it
  })

  it('the first of several lines is asked against its OWN formula, not the indicator\'s name', async () => {
    const st = newAuthoringState()
    const ops = [{ op: 'create', name: 'Smoothed MACD', placement: 'pane', outputs: [
      { key: 'k', label: '%K', tree: call('ema', MACD, num(9)) },
      { key: 'd', label: '%D', tree: call('sma', call('ema', MACD, num(9)), num(3)) }] }]
    const plain = labelsOf(await labelTurn(st, 'two lines', ops, { label: null }))
    expect(plain.k).not.toBe('%K')                                         // control: it showed the indicator's name
    const out = labelsOf(await labelTurn(st, 'two lines', ops))
    expect(out).toEqual({ k: '%K', d: '%D' })
  })

  it('one line: its label is left to follow the indicator\'s name', async () => {
    const st = newAuthoringState()
    const ops = [{ op: 'create', name: 'Distribution Day Count', placement: 'pane', outputs: [{ key: 'value', label: 'Distribution Days', tree: DIST }] }]
    const plain = labelsOf(await labelTurn(st, 'count distribution days', ops, { label: null }))
    const out = labelsOf(await labelTurn(st, 'count distribution days', ops))
    expect(out.value).toBe(plain.value)                                    // unchanged by the label rule
    expect(out.value).not.toBe('Distribution Days')
  })

  it('a label that is not a label leaves the derived one', async () => {
    const st = newAuthoringState()
    const out = labelsOf(await labelTurn(st, 'macd', createMacd(['MACD', 'ema(macd, 9)', 'MACD minus signal line', 'x'])))
    expect(out.signalLine).not.toBe('ema(macd, 9)')
    expect(out.hist).not.toBe('MACD minus signal line')
    expect(derivedIsReadable(out.signalLine)).toBe(false)
  })

  it('a patch the engine refuses keeps no label and is still refused', async () => {
    const st = newAuthoringState()
    const bad = [{ op: 'create', name: 'X', placement: 'pane', outputs: [
      { key: 'a', label: 'First', tree: MACD }, { key: 'a', label: 'Second', tree: call('ema', MACD, num(9)) }] }]
    const out = await labelTurn(st, 'two lines', bad)
    expect(out.changed).toBe(false)
    expect(out.state).toBeNull()
  })

  it('without the label predicate nothing changes (the Agent\'s path)', async () => {
    const st = newAuthoringState()
    const a = labelsOf(await labelTurn(st, 'macd', createMacd(), { label: null }))
    const b = labelsOf(await modelTurn(st, () => st, 'macd', { converse: async () => reply(st, createMacd()), keepCreateName: keepAssistantName }))
    expect(b).toEqual(a)
  })
})

// ─── a short derived name that is arithmetic in words (2026-11-17) ────────────

describe('a ratio keeps the assistant\'s name', () => {
  const RS = op('/', s('close'), { type: 'sym', value: 'SPY', args: [s('close')] })
  const createRs = (name) => [{ op: 'create', name, placement: 'pane', outputs: [{ key: 'rs', label: 'RS vs SPY', tree: RS }] }]

  it('"Relative Strength vs SPY" is kept where the derived name is "Close divided by SPY Close"', async () => {
    const st = newAuthoringState()
    const plain = await turn(st, 'relative strength line versus SPY', createRs('Relative Strength vs SPY'), null)
    expect(nameOf(plain)).toMatch(/divided by/)                            // control: what the window showed
    const out = await turn(st, 'relative strength line versus SPY', createRs('Relative Strength vs SPY'))
    expect(nameOf(out)).toBe('Relative Strength vs SPY')
  })

  it('⛔ a comparison\'s derived name is still kept, and still follows the maths', async () => {
    const st = newAuthoringState()
    const above = [{ op: 'create', name: 'Price vs 50 Average', placement: 'price', outputs: [
      { key: 'value', tree: op('>', s('close'), call('sma', s('close'), num(50))) }] }]
    const made = await turn(st, 'close above the 50 day average', above)
    expect(nameOf(made)).not.toBe('Price vs 50 Average')
    expect(derivedIsReadable(nameOf(made))).toBe(true)
    const view = made.state
    const edited = await modelTurn(view, () => view, 'make it 100',
      { converse: async () => reply(view, [{ op: 'set_output_tree', output: 'value', tree: op('>', s('close'), call('sma', s('close'), num(100))) }]),
        keepCreateName: keepAssistantName })
    expect(nameOf(edited)).toMatch(/100/)
  })
})
