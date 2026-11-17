// THE NUMBERS OF A BUILT INDICATOR, AS SETTINGS (derivedSettings.js).
//
// Derived from the tree at read time, stored nowhere. A change is the ordinary `set_slot` edit.
import { describe, it, expect } from 'vitest'
import { parseFormula } from '../../engine/ast/parse'
import { applyPatch, openAuthoringState, newAuthoringState, undo } from './index'
import { settingsOf, settingsCount, settingPatch, settingRefusal, CAPTION_MAX } from './derivedSettings'
import { settingTurn } from './authoringSession'

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
