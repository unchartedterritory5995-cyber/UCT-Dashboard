// THE NUMBERS OF A BUILT INDICATOR, AS SETTINGS (derivedSettings.js).
//
// Derived from the tree at read time, stored nowhere. A change is the ordinary `set_slot` edit.
import { describe, it, expect } from 'vitest'
import { parseFormula } from '../../engine/ast/parse'
import { applyPatch, openAuthoringState, newAuthoringState, undo } from './index'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { settingsOf, settingsCount, settingPatch, settingRefusal, runningValueOwns, CAPTION_MAX } from './derivedSettings'
import { settingTurn } from './authoringSession'
import { compactView } from './compactView'

const P = (src) => { const r = parseFormula(src); if (!r.ok) throw new Error(`${src}: ${r.error}`); return r.ast }
const C = 'uct.authoring.patch/1'
const GATE = { tf: 'D', symbol: 'AAPL' }
const build = (outputs) => {
  const r = applyPatch(null, { contract: C, baseRevision: 0, assumptions: [], ops: [{ op: 'create', name: 'x',
    outputs: outputs.map(([key, src, hidden]) => ({ key, label: key, tree: P(src), ...(hidden ? { hidden: true } : {}) })) }] }, { gateCtx: GATE })
  expect(r.status, JSON.stringify(r.errors)).toBe('applied')
  return r.definition
}
/** A conversation state whose working indicator is `def`, as the dock holds it after a build. */
const stateOf = (def) => {
  const s = openAuthoringState ? openAuthoringState(def, { gateCtx: GATE }) : null
  return s && s.working ? s : { ...newAuthoringState(), working: def, revision: 1 }
}
const brief = (def) => settingsOf(def).map((s) => `${s.caption} | ${s.role} | ${s.value}${s.whole ? ' (whole)' : ''} x${s.slots.length}`)

// the distribution-day count as the assistant builds it: one condition in two outputs
const DIST = [
  ['ddCount', 'sum(((close <= close[1] * 0.997) && (volume > volume[1])) ? 1 : 0, 20)'],
  ['isDD', '(close <= close[1] * 0.997) && (volume > volume[1])'],
]

describe('which numbers are settings', () => {
  it('a length, a level and a multiple are; the structure around them is not', () => {
    const def = build(DIST)
    const got = settingsOf(def)
    // the 20-session window, and the 0.997 that sits in BOTH outputs as ONE setting
    expect(got.map((s) => [s.role, s.value, s.whole, s.slots.length])).toEqual([
      ['multiple', 0.997, false, 2],
      ['length', 20, true, 1],
    ])
    // not the "[1]" (the bar before) and not the 1 and 0 the yes/no is counted with
    expect(got.some((s) => s.value === 1 || s.value === 0)).toBe(false)
    expect(settingsCount(def)).toBe(2)
  })

  it('the 100 that makes a ratio a percent is not a setting; the average it reads is ONE setting', () => {
    const def = build([['value', '(close - sma(close, 50)) / sma(close, 50) * 100']])
    expect(settingsOf(def).map((s) => [s.role, s.value, s.slots.length])).toEqual([['length', 50, 2]])
  })

  it('a threshold, a band multiple, a ratio minus one, "no value", and a real look-back', () => {
    expect(brief(build([['value', 'rsi(close, 14) >= 70']])).map((l) => l.split(' | ').slice(1).join(' | ')))
      .toEqual(['length | 14 (whole) x1', 'level | 70 x1'])
    const bb = settingsOf(build([['value', 'close > bbUpper(close, 20, 2)']]))
    expect(bb.map((s) => [s.role, s.value, s.whole])).toEqual([['length', 20, true], ['multiple', 2, false]])
    // high / low - 1: the 1 is the ratio's own, not a knob
    expect(settingsOf(build([['value', 'sma(high / low - 1, 20) * 100']])).map((s) => s.value)).toEqual([20])
    // 0 / 0 spells "no value"
    expect(settingsOf(build([['value', 'close > sma(close, 50) ? close : 0 / 0']])).map((s) => s.value)).toEqual([50])
    // five bars back is a setting; one or two bars back are a pattern's neighbouring bars
    expect(settingsOf(build([['value', 'close - close[5]']])).map((s) => [s.role, s.value, s.whole])).toEqual([['bars back', 5, true]])
    expect(settingsOf(build([['value', 'close - close[1]']]))).toEqual([])
    expect(settingsOf(build([['value', 'close > close[1] && close[1] > close[2]']]))).toEqual([])
    // the 1 / 2 / 3 that pick a colour state are not settings; the level that picks them is
    expect(settingsOf(build([['value', 'rsi(close, 14) > 70 ? 1 : 2']])).map((s) => [s.role, s.value])).toEqual([['length', 14], ['level', 70]])
  })

  it('every setting says in plain words where its number sits', () => {
    for (const s of settingsOf(build(DIST))) {
      expect(s.caption, JSON.stringify(s)).toBeTruthy()
      expect(s.caption).not.toMatch(/[<>≥≤÷]|\?:|\[\d+\]|#/)      // words, never formula symbols or a slot id
    }
    expect(settingsOf(build([['value', 'volume > 1.5 * sma(volume, 50)']])).map((s) => `${s.caption} / ${s.role}`))
      .toEqual(['1.5 times SMA 50 (Volume) / multiple', 'SMA 50 (Volume) / length'])
  })

  it('a long caption keeps its start and its end, and the whole of it is still there', () => {
    const [level] = settingsOf(build([['value', '(highest(high, 25) - lowest(low, 25)) / lowest(low, 25) <= 0.15']])).filter((s) => s.role === 'level')
    expect(level.captionFull.length).toBeGreaterThan(CAPTION_MAX)
    expect(level.caption.length).toBeLessThanOrEqual(CAPTION_MAX)
    expect(level.caption).toContain(' … ')
    expect(level.caption.endsWith(level.captionFull.slice(-10))).toBe(true)
  })

  it('the same number in DIFFERENT places is two settings', () => {
    const got = settingsOf(build([['value', 'sma(close, 20) > sma(volume, 20)']]))
    expect(got.map((s) => [s.value, s.slots.length])).toEqual([[20, 1], [20, 1]])
    expect(new Set(got.map((s) => s.id)).size).toBe(2)
  })

  it('⛔ a number inside several LINKED running values is the formula\'s own, not a setting', () => {
    // a two-pole filter: its coefficients were checked together, and one changed alone is another filter
    const filter = 'accum2(1, 300, close, close, 0.2 * close + 1.4 * state1 - 0.6 * state2, state1)'
    expect(settingsOf(build([['smooth', filter]]))).toEqual([])
    // a length inside it sits in every repeat of an update: it is not a setting either
    const chain = 'accum2(2, 300, 0, 0, 0.5 * (close - lowest(low, 10)) + 0.5 * state1, '
      + 'ln(2 + 0.5 * (close - lowest(low, 10)) + 0.5 * state1) + 0.5 * state2)'
    expect(settingsOf(build([['stretch', chain]]))).toEqual([])
    // CONTROL: a number OUTSIDE it is a setting as ever
    expect(settingsOf(build([['gap', `close - 2 * ${filter}`]])).map((x) => [x.role, x.value, x.slots.length])).toEqual([['multiple', 2, 1]])
    // and a formula beside it keeps its settings
    expect(brief(build([['smooth', filter], ['avg', 'ema(close, 20)']]))).toEqual(['EMA 20 | length | 20 (whole) x1'])
  })

  it('⛔ a one-value running value keeps its OWN two numbers (its gain and its warm-up); the rest are settings', () => {
    // the shape that can settle: the gain and the warm-up are what its sentence was written from
    expect(settingsOf(build([['one', 'accum(close, self + 0.1 * (close - self), 300)']]))).toEqual([])
    // a stop that only rises: its warm-up is its own; the ATR length and the multiple are the member's to tune
    const stop = 'accum(low, max(self, close - 3 * atr(high, low, close, 14)), 300)'
    expect(settingsOf(build([['stop', stop]])).map((x) => [x.role, x.value]).sort()).toEqual([['length', 14], ['multiple', 3]])
    // a streak: the 100-bar warm-up is its own; what is left is the number it starts from
    expect(settingsOf(build([['streak', 'accum(0, close > close[1] ? self + 1 : 0, 100)']])).map((x) => x.id)).toEqual(['streak#0'])
  })

  it('the door and this window agree, case by case, on which numbers are a running value\'s own', () => {
    const here = path.dirname(fileURLToPath(import.meta.url))
    const doc = JSON.parse(fs.readFileSync(path.resolve(here, '../../../../../../tests/fixtures/authoring/running_value_own_numbers.json'), 'utf8'))
    expect(doc.cases.length).toBeGreaterThanOrEqual(8)
    let own = 0
    let other = 0
    for (const c of doc.cases) {
      for (const p of c.own) {
        expect(runningValueOwns(c.tree, p.path), `${c.name} ${p.path.join('.')} is its own`).toBe(p.by)
        own += 1
      }
      for (const p of c.other) {
        expect(runningValueOwns(c.tree, p), `${c.name} ${p.join('.')} is an ordinary number`).toBe(null)
        other += 1
      }
    }
    expect(own).toBeGreaterThan(20)            // NON-VACUITY: both answers occur, many times
    expect(other).toBeGreaterThan(10)
  })

  it('⛔ the view the assistant is sent lists no number that is a running value\'s own', () => {
    // (a slot is a number OR a bar field the assistant may swap; this reads the numbers)
    const slotsIn = (def) => compactView(def, {}, GATE).definition.outputs
      .flatMap((o) => o.slots.filter((s) => typeof s.value === 'number').map((s) => [s.id, s.value]))
    const all = (def) => compactView(def, {}, GATE).definition.outputs.flatMap((o) => o.slots)
    // linked running values: not one of their numbers
    const filter = 'accum2(1, 300, close, close, 0.2 * close + 1.4 * state1 - 0.6 * state2, state1)'
    expect(all(build([['smooth', filter]]))).toEqual([])               // nor a bar field inside them
    // ... and the multiple OUTSIDE them still is
    expect(slotsIn(build([['gap', `close - 2 * ${filter}`]])).map(([, v]) => v)).toEqual([2])
    // a one-value running value: its gain and warm-up are its own, the ATR length and the multiple are not
    const stop = 'accum(low, max(self, close - 3 * atr(high, low, close, 14)), 300)'
    expect(slotsIn(build([['stop', stop]])).map(([, v]) => v).sort((a, b) => a - b)).toEqual([3, 14])
    expect(slotsIn(build([['one', 'accum(close, self + 0.1 * (close - self), 300)']]))).toEqual([])
    // ⛔ a function that STANDS FOR linked running values keeps its own number: `fisher(9)`'s length
    // is one slot, though the formula it expands to is linked running values through and through
    expect(all(build([['f', 'fisher(9)']])).map((s) => [s.id, s.value])).toEqual([['f#0', 9]])
    expect(slotsIn(build([['st', 'supertrend(3, 10)']])).map(([, v]) => v)).toEqual([3, 10])
    // CONTROL: a formula with no running value lists its numbers as before
    expect(slotsIn(build([['avg', 'ema(close, 20) - ema(close, 50)']])).map(([, v]) => v)).toEqual([20, 50])
    // and the view of a formula of linked running values is small enough to send
    const stages = ['accum4(4, 300, close, close, close, close, 0.2 * close + 0.8 * state1, '
      + 'state1 - 0.8 * (0.2 * close + 0.8 * state1) + 0.8 * state2, state2 - 0.8 * state1 + 0.8 * state3, state3 - 0.8 * state2 + 0.8 * state4)']
    expect(JSON.stringify(compactView(build([['line', stages[0]]]), {}, GATE)).length).toBeLessThan(12000)
  })

  it('nothing to tune answers an empty list, and junk answers an empty list', () => {
    expect(settingsOf(build([['value', 'close > open']]))).toEqual([])
    for (const junk of [null, undefined, 7, 'x', {}, { plots: 'no' }]) expect(settingsOf(junk)).toEqual([])
  })
})

describe('changing one', () => {
  it('moves every place the number sits, in one step, and Undo takes it back', () => {
    const before = stateOf(build(DIST))
    const level = settingsOf(before.working).find((s) => s.value === 0.997)
    const out = settingTurn(before, level, 0.995, { gateCtx: GATE })
    expect(out.ok, JSON.stringify(out)).toBe(true)
    expect(out.state.revision).toBe(before.revision + 1)
    const after = settingsOf(out.state.working).find((s) => s.role === 'multiple')
    expect([after.value, after.slots.length]).toEqual([0.995, 2])          // both outputs moved together
    expect(JSON.stringify(out.state.working)).not.toContain('0.997')
    expect(out.entries[0].lines[0]).toMatch(/^Set .+ multiple from 0\.997 to 0\.995\.$/)
    const back = undo(out.state, GATE)
    expect(settingsOf(back.working).find((s) => s.role === 'multiple').value).toBe(0.997)
  })

  it('a length takes whole numbers of at least 1, in a member’s words, and nothing changes', () => {
    const before = stateOf(build(DIST))
    const len = settingsOf(before.working).find((s) => s.role === 'length')
    for (const bad of [0, -3, 2.5, NaN, Infinity, '20']) {
      const out = settingTurn(before, len, bad, { gateCtx: GATE })
      expect(out.ok).toBe(false)
      expect(out.state).toBeNull()
      expect(out.message).toMatch(/whole number of at least 1|Enter a number/)
    }
    expect(settingRefusal(len, 25)).toBeNull()
    expect(settingTurn(before, len, 25, { gateCtx: GATE }).ok).toBe(true)
  })

  it('a level takes decimals; a number keeps its sign', () => {
    const before = stateOf(build([['value', 'rsi(close, 14) >= 70']]))
    const level = settingsOf(before.working).find((s) => s.role === 'level')
    expect(settingTurn(before, level, 62.5, { gateCtx: GATE }).ok).toBe(true)
    const below = settingTurn(before, level, -5, { gateCtx: GATE })
    expect(below).toMatchObject({ ok: false, state: null })
    expect(below.message).toBe('This number cannot go below zero here. Describe the change instead.')
  })

  it('a number written negative is shown negative and edited as one ("down 3% or more")', () => {
    const before = stateOf(build([['value', '((open - close[1]) / close[1]) * 100 <= -3']]))
    const [level] = settingsOf(before.working)
    expect([level.role, level.value, level.negated]).toEqual(['level', -3, true])
    const out = settingTurn(before, level, -4.5, { gateCtx: GATE })
    expect(out.ok, JSON.stringify(out)).toBe(true)
    expect(settingsOf(out.state.working)[0].value).toBe(-4.5)
    expect(out.entries[0].lines[0]).toMatch(/from -3 to -4\.5\.$/)
    const up = settingTurn(before, level, 2, { gateCtx: GATE })
    expect(up.ok).toBe(false)
    expect(up.message).toMatch(/negative in the formula/)
  })

  it('⛔ COMPARE-AND-SET: a setting read from an earlier version of the indicator writes nothing', () => {
    const before = stateOf(build(DIST))
    const len = settingsOf(before.working).find((s) => s.role === 'length')
    const moved = settingTurn(before, len, 25, { gateCtx: GATE }).state
    // the control still shows 20; the indicator now says 25
    expect(settingPatch(moved, len, 30)).toBeNull()
    const out = settingTurn(moved, len, 30, { gateCtx: GATE })
    expect(out).toMatchObject({ ok: false, stale: true, state: null })
    expect(settingsOf(moved.working).find((s) => s.role === 'length').value).toBe(25)
    // and the same value is not a change
    expect(settingPatch(before, len, 20)).toBeNull()
  })

  it('the patch is the ordinary slot edit and nothing else', () => {
    const before = stateOf(build(DIST))
    const level = settingsOf(before.working).find((s) => s.value === 0.997)
    const patch = settingPatch(before, level, 0.99)
    expect(patch.baseRevision).toBe(before.revision)
    expect(patch.ops.map((o) => o.op)).toEqual(['set_slot', 'set_slot'])
    expect(patch.ops.map((o) => o.slot)).toEqual(level.slots)
    expect(JSON.stringify(before.working)).not.toMatch(/paramManifest":\s*\{/)   // nothing is stored for it
  })
})
