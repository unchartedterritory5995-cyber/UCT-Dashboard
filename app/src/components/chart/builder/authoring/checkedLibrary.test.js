// A CHECKED LIBRARY INDICATOR IN THE WINDOW: its Inputs are the entry's own settings, a setting
// moves every place it sits, its read-back says what it is, and its title stops claiming the name
// once the formula is edited away (rulings 2026-11-18).
//
// ⚰️ Read in the live window: KAMA showed "Inputs 8" ("2 plus 1 amount", "2 divided by (30 plus 1)
// divisor"); On Balance Volume showed one, "0 minus Volume amount"; and KAMA's read-back began "the
// running value that starts at close and becomes (the running value so far plus ((((((".
//
// The first block is the WINDOW'S HALF of one shared list of cases; the door's half is
// `tests/test_checked_library_parity.py`. Both must agree with what each case was built to be.

import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { collapseExpansions } from '../../engine/ast/callExpansions'
import { applyTurn, newAuthoringState } from './index'
import { settingsOf, settingPatch, settingRefusal } from './derivedSettings'
import { noLongerChecked } from './readback'
import { CHECKED_LIBRARY, libraryParts, libraryOutputOf, settingsWords, namedByTitle } from './checkedLibrary'
import { compactView } from './compactView'
import { parameterSlots } from './slots'

const CASES = JSON.parse(fs.readFileSync(
  path.resolve(globalThis.process.cwd(), '..', 'tests/fixtures/authoring/checked_library_cases.json'), 'utf8')).cases
const ENTRY = new Map(CHECKED_LIBRARY.map((e) => [e.id, e]))
const C = 'uct.authoring.patch/1'
const GATE = { tf: 'D', symbol: 'SPY' }
const clone = (v) => JSON.parse(JSON.stringify(v))
const nodeAt = (tree, p) => p.reduce((n, i) => n.args[i], tree)

/** The case's tree: the recipe applied to the entry's output tree (the fixture says how). */
function built(c) {
  const e = ENTRY.get(c.entry)
  const o = e.outputs.find((x) => x.key === c.output)
  let tree = clone(o.tree)
  for (const [key, value] of Object.entries(c.set || {})) for (const p of o.sites[key]) nodeAt(tree, p).value = value
  if (c.set_one) { const [key, n, value] = c.set_one; nodeAt(tree, o.sites[key][n]).value = value }
  if (c.series) for (const p of o.sites[c.series]) nodeAt(tree, p.slice(0, -1)).args[p[p.length - 1]] = { type: 'series', name: 'myOwnSetting' }
  if (c.bump) { const [p, d] = c.bump; nodeAt(tree, p).value += d }
  if (c.wrap) tree = { type: 'op', name: '>', args: [tree, { type: 'num', value: 987654 }] }
  return { e, o, tree }
}

describe('the window recognises a library formula by the door\'s own rule (the shared cases)', () => {
  it('holds the same cases as the door, and both answers appear in them', () => {
    expect(CASES.length).toBeGreaterThan(500)
    expect(CASES.filter((c) => c.expect === null).length).toBeGreaterThan(100)
    expect(CASES.filter((c) => c.expect !== null).length).toBeGreaterThan(60)
    const outputs = CHECKED_LIBRARY.flatMap((e) => e.outputs.map((o) => `${e.id}.${o.key}`))
    expect(CASES.filter((c) => c.kind === 'defaults').map((c) => `${c.entry}.${c.output}`).sort()).toEqual(outputs.sort())
  })

  it.each(CASES.map((c) => [`${c.entry}.${c.output}: ${c.kind}`, c]))('%s', (_name, c) => {
    const { e, o, tree } = built(c)
    const whole = libraryOutputOf(tree, c.inputs || [])
    const mine = whole && whole.entry.id === e.id && whole.output.key === o.key ? whole.values : null
    if (c.expect === null) expect(mine).toBeNull()
    else expect(mine).toEqual(c.expect)
    if (c.expect_inside) {
      const part = libraryParts(tree, c.inputs || []).find((p) => p.entry.id === e.id && p.output.key === o.key)
      expect(part && part.values).toEqual(c.expect_inside)
      expect(part.at).toEqual([0])
    }
  })

  it('no output of one indicator is read as an output of another', () => {
    for (const e of CHECKED_LIBRARY) {
      for (const o of e.outputs) {
        const whole = libraryOutputOf(o.tree)
        expect([whole.entry.id, whole.output.key]).toEqual([e.id, o.key])
      }
    }
  })

  it('the OUTERMOST output is the one recognised: a signal line is not also the line it smooths', () => {
    const ppo = ENTRY.get('percentage_price_oscillator')
    for (const key of ['signal', 'histogram']) {
      const parts = libraryParts(ppo.outputs.find((o) => o.key === key).tree)
      expect(parts.map((p) => [p.output.key, p.at])).toEqual([[key, []]])
    }
  })
})

// ── through the window's own engine ──────────────────────────────────────────

const createOp = (e, overrides = {}) => ({
  op: 'create', name: e.name, placement: 'pane',
  outputs: e.outputs.map((o) => ({ key: o.key.replace(/_/g, ''), label: o.label, tree: overrides[o.key] || o.tree })),
})
/** Build `ops` and name the result, as the Create Indicator window does (the assistant's name is kept). */
function make(ops, name = null) {
  let got = applyTurn(newAuthoringState({ lineage: 'auth_000000000000' }),
    { contract: C, baseRevision: 0, disposition: 'change', assumptions: [], ops }, { gateCtx: GATE })
  if (got.result.status !== 'applied') throw new Error(JSON.stringify(got.result.errors))
  if (name) got = turn(got.state, [{ op: 'rename_definition', name }])
  return got
}
function turn(state, ops) {
  const got = applyTurn(state, { contract: C, baseRevision: state.revision, disposition: 'change', assumptions: [], ops }, { gateCtx: GATE })
  if (got.result.status !== 'applied') throw new Error(JSON.stringify(got.result.errors))
  return got
}
const library = (id) => { const e = ENTRY.get(id); return { e, ...make([createOp(e)], e.name) } }
const captions = (state) => settingsOf(state.working).map((s) => [s.caption, s.value, s.slots.length])

describe('a library indicator\'s lines are labelled by the library', () => {
  // (the view marks a label as text a member or the library wrote: read the text itself)
  const text = (v) => (v && typeof v === 'object' && 'untrusted_text' in v ? v.untrusted_text : v)
  const labels = (state) => compactView(state.working, {}, GATE).definition.outputs.map((o) => text(o.label))
  /** As the assistant often sends it: with no labels at all. */
  const bare = (e) => make([{ op: 'create', name: e.name, placement: 'pane',
    outputs: e.outputs.map((o) => ({ key: o.key.replace(/_/g, ''), tree: o.tree })) }], e.name)

  it('the Fisher Transform\'s second line is "Trigger" (it read "previous FISHER 9")', () => {
    expect(labels(bare(ENTRY.get('fisher_transform')).state).slice(1)).toEqual(['Trigger'])
    expect(labels(bare(ENTRY.get('directional_movement_index')).state).slice(1)).toEqual(['-DI', 'ADX'])
  })

  it.each(CHECKED_LIBRARY.filter((e) => e.outputs.length > 1).map((e) => [e.name, e]))('%s: every line after the first carries its own library label', (_n, e) => {
    // (the first line follows the indicator's name, as plot 1 always does)
    expect(labels(bare(e).state).slice(1)).toEqual(e.outputs.slice(1).map((o) => o.label))
  })

  it('a formula that only USES a library output inside other maths is named by its maths', () => {
    const fisher = ENTRY.get('fisher_transform').outputs[0].tree
    const above = { type: 'op', name: '>', args: [fisher, { type: 'num', value: 2 }] }
    const got = make([{ op: 'create', name: 'x', placement: 'pane',
      outputs: [{ key: 'line', tree: fisher }, { key: 'hot', tree: above }] }])
    expect(labels(got.state)[1]).not.toBe('Fisher')
    expect(labels(got.state)[1]).toContain('above 2')
  })

  it('a function\'s number is read by what it is, not as "argument 1"', () => {
    const roles = (id) => parameterSlots(library(id).state.working).filter((s) => s.kind === 'number').map((s) => s.label)
    expect(roles('fisher_transform')).toEqual(['fisher length', 'bars ago', 'fisher length'])     // the line, and the trigger one bar back
    expect(roles('laguerre_rsi')).toEqual(['laguerreRsi gamma'])
    expect(roles('laguerre_filter')).toContain('laguerre gamma')
    for (const id of ['fisher_transform', 'laguerre_rsi', 'laguerre_filter']) for (const r of roles(id)) expect(r).not.toMatch(/argument/)
  })
})

describe('Inputs: a library indicator shows the entry\'s own settings', () => {
  it('KAMA has three (it showed eight), each holding every place it sits; On Balance Volume has none (it showed one)', () => {
    expect(captions(library('kaufman_adaptive_moving_average').state)).toEqual([
      ['Efficiency length', 10, 2], ['Fast length', 2, 1], ['Slow length', 30, 2]])
    expect(settingsOf(library('on_balance_volume').state.working)).toEqual([])
    // one length for +DI, -DI and ADX together
    expect(captions(library('directional_movement_index').state)).toEqual([['Length', 14, 3]])
  })

  it.each(CHECKED_LIBRARY.map((e) => [e.name, e]))('%s: exactly its declared settings, at their defaults, every place held', (_n, e) => {
    const { state } = library(e.id)
    const got = settingsOf(state.working)
    expect(got.map((s) => [s.caption, s.value]).sort()).toEqual(e.params.map((p) => [p.label, p.default]).sort())
    for (const s of got) {
      const places = e.outputs.reduce((n, o) => n + ((o.sites[s.library.param] || []).length), 0)
      expect(s.slots.length).toBe(places)
      expect(s.library).toMatchObject({ id: e.id, name: e.name })
    }
  })

  it.each(CHECKED_LIBRARY.filter((e) => e.params.length).map((e) => [e.name, e]))(
    '%s: moving each setting moves every place together, and it is still that indicator', (_n, e) => {
      let { state } = library(e.id)
      for (const p of e.params) {
        const setting = settingsOf(state.working).find((s) => s.library.param === p.key)
        // (a 0-to-1 setting such as the Laguerre Filter's gamma has no room above its default: step down)
        const step = p.integer ? 3 : 0.25
        const next = p.default + step <= p.max ? p.default + step : p.default - (p.integer ? 1 : step)
        const patch = settingPatch(state, setting, next)
        expect(patch.ops.length).toBe(setting.slots.length)                 // ONE patch, one edit per place
        state = applyTurn(state, patch, { gateCtx: GATE }).state
        const now = settingsOf(state.working)
        expect(now.length).toBe(e.params.length)                            // never split into two settings
        expect(now.find((s) => s.library.param === p.key).value).toBe(next)
      }
      expect(state.working.meta.name).toBe(e.name)                          // still the checked indicator: the title stays
    })

  it('a value outside what the maths allows is refused with a sentence, and a valid one is not', () => {
    const { state } = library('kaufman_adaptive_moving_average')
    const slow = settingsOf(state.working).find((s) => s.library.param === 'slow')
    expect(settingRefusal(slow, 1200)).toBeNull()                           // it was refused over 400, for no reason of the maths
    expect(settingRefusal(slow, 5000)).toBeNull()
    expect(settingRefusal(slow, 5001)).toBe('This is a count of bars: a whole number from 2 to 5000 (a chart holds 5000 bars, so a longer one could never have a value).')
    expect(settingRefusal(slow, 1)).toMatch(/whole number from 2 to 5000/)
    expect(settingRefusal(slow, 30.5)).toBe('This is a count of bars: a whole number from 2 to 5000.')
    expect(settingPatch(state, slow, 5001)).toBeNull()
    const squeeze = library('squeeze_momentum')
    const mult = settingsOf(squeeze.state.working).find((s) => s.library.param === 'bb_mult')
    expect(settingRefusal(mult, 2.5)).toBeNull()
    expect(settingRefusal(mult, 51)).toBe('Enter a number from 0.001 to 50.')
    expect(settingRefusal(mult, 0)).toBe('Enter a number from 0.001 to 50.')
  })

  it('the indicator\'s name goes in front only when a caption has to tell settings apart', () => {
    // beside a number of the member's own formula
    const kama = ENTRY.get('kaufman_adaptive_moving_average')
    const above = make([{ op: 'create', name: 'x', outputs: [{ key: 'a', tree: { type: 'op', name: '>', args: [kama.outputs[0].tree, { type: 'num', value: 50 }] } }] }])
    const got = settingsOf(above.state.working)
    expect(got.filter((s) => s.library).map((s) => s.caption)).toEqual([
      'Kaufman Adaptive Moving Average: Efficiency length', 'Kaufman Adaptive Moving Average: Fast length', 'Kaufman Adaptive Moving Average: Slow length'])
    expect(got.filter((s) => !s.library).map((s) => [s.value, s.role])).toEqual([[50, 'level']])
    // two library indicators in one
    const dema = ENTRY.get('double_exponential_moving_average')
    const tema = ENTRY.get('triple_exponential_moving_average')
    const two = make([{ op: 'create', name: 'x', outputs: [{ key: 'a', tree: dema.outputs[0].tree }, { key: 'b', tree: tema.outputs[0].tree }] }])
    expect(settingsOf(two.state.working).map((s) => [s.caption, s.slots.length])).toEqual([
      ['Double Exponential Moving Average: Length', 3], ['Triple Exponential Moving Average: Length', 6]])
  })

  it('two outputs of one indicator at DIFFERENT numbers are two settings, each named for its number', () => {
    const vortex = ENTRY.get('vortex_indicator')
    const minus = clone(vortex.outputs[1].tree)
    for (const p of vortex.outputs[1].sites['length']) nodeAt(minus, p).value = 9   // the parameter is called `length`
    const { state } = make([createOp(vortex, { minus })], vortex.name)
    expect(settingsOf(state.working).map((s) => [s.caption, s.value]).sort()).toEqual([['Length', 14], ['Length', 9]].sort())
  })

  it('a setting one of the member\'s own inputs drives is the member\'s, not a library setting', () => {
    const dema = ENTRY.get('double_exponential_moving_average').outputs[0]
    const tree = clone(dema.tree)
    for (const p of dema.sites['length']) nodeAt(tree, p.slice(0, -1)).args[p[p.length - 1]] = { type: 'series', name: 'myLen' }
    const part = libraryOutputOf(tree, ['myLen'])
    expect(part.values).toEqual({ length: null })
    expect(part.places).toEqual([])
    expect(settingsWords(part)).toBe('')
    expect(libraryOutputOf(tree, [])).toBeNull()
  })

  it('CONTROL: a formula that is no library indicator is derived as before', () => {
    const got = make([{ op: 'create', name: 'x', outputs: [{ key: 'a', tree: { type: 'op', name: '>', args: [
      { type: 'call', name: 'rsi', args: [{ type: 'series', name: 'close' }, { type: 'num', value: 14 }] }, { type: 'num', value: 70 }] } }] }])
    const s = settingsOf(got.state.working)
    expect(s.map((x) => [x.value, x.role, !!x.library])).toEqual([[14, 'length', false], [70, 'level', false]])
    expect(settingRefusal(s[0], 100000)).toBeNull()                         // the general rule has no library range
  })
})

describe('read-back: a library indicator says what it is', () => {
  it('one phrase and its settings, never the formula six brackets deep; the formula in words is kept beside it', () => {
    const kama = library('kaufman_adaptive_moving_average')
    const line = kama.readback.lines.find((l) => l.includes('a moving average that speeds up'))
    expect(line).toMatch(/— a moving average that speeds up when price moves cleanly and slows down when it chops \(.*efficiency length 10, fast length 2, slow length 30\)$/)
    expect(kama.readback.lines.join('\n')).not.toMatch(/\(\(\(/)
    const out = kama.readback.outputs[0]
    expect(out.library).toEqual({ id: 'kaufman_adaptive_moving_average', name: 'Kaufman Adaptive Moving Average', version: 1 })
    expect(out.formulaWords).toMatch(/running value/)                       // one tap away, not gone
    const obv = library('on_balance_volume')
    expect(obv.readback.lines.some((l) => l.endsWith('— a running total of volume, added on up closes and subtracted on down closes (On Balance Volume)')
      || l.endsWith('— a running total of volume, added on up closes and subtracted on down closes'))).toBe(true)
  })

  it.each(CHECKED_LIBRARY.map((e) => [e.name, e]))('%s: every output says its own phrase', (_n, e) => {
    const { readback } = library(e.id)
    expect(readback.outputs.map((o) => o.library && o.library.id)).toEqual(e.outputs.map(() => e.id))
    e.outputs.forEach((o, i) => {
      expect(readback.outputs[i].phrase.startsWith(o.says)).toBe(true)
      expect(readback.lines.some((l) => l.includes(`— ${o.says}`))).toBe(true)
    })
  })

  it('CONTROL: a formula of the member\'s own is still read back as its formula in words', () => {
    const got = make([{ op: 'create', name: 'x', outputs: [{ key: 'a', tree: { type: 'call', name: 'ema', args: [{ type: 'series', name: 'close' }, { type: 'num', value: 20 }] } }] }])
    expect(got.readback.outputs[0].library).toBeUndefined()
    expect(got.readback.outputs[0].formulaWords).toBeUndefined()
    expect(got.readback.outputs[0].phrase).toMatch(/^a number on every bar: /)
  })
})

describe('a title that names a library indicator is a claim about the formula', () => {
  const kamaEdited = (state) => {
    // the formula's own "2" (not a setting) becomes 3: no longer Kaufman's formula
    const e = ENTRY.get('kaufman_adaptive_moving_average')
    const tree = clone(collapseExpansions(e.outputs[0].tree))
    const taken = new Set(Object.values(e.outputs[0].sites).flat().map((p) => p.join('.')))
    const find = (n, p) => {
      if (n.type === 'num' && n.value === 2 && !taken.has(p.join('.'))) return p
      for (let i = 0; i < (n.args || []).length; i += 1) { const hit = find(n.args[i], [...p, i]); if (hit) return hit }
      return null
    }
    nodeAt(tree, find(tree, [])).value = 3
    return turn(state, [{ op: 'set_output_tree', output: 'kama', tree }])
  }

  it('edited until it is no longer that indicator: the title follows the maths, the read-back says so, and the Inputs are the formula\'s own again', () => {
    const before = library('kaufman_adaptive_moving_average')
    expect(before.state.working.meta.name).toBe('Kaufman Adaptive Moving Average')
    expect(namedByTitle(before.state.working.meta.name).id).toBe('kaufman_adaptive_moving_average')
    const after = kamaEdited(before.state)
    expect(after.state.working.meta.name).not.toMatch(/kaufman/i)
    expect(after.readback.outputs[0].library).toBeUndefined()
    expect(settingsOf(after.state.working).every((s) => !s.library)).toBe(true)
    expect(settingsOf(after.state.working).length).toBeGreaterThan(3)
  })

  it('a title that still names it over a formula that is not it is said plainly', () => {
    // (a member can type any title; the read-back does not let it stand as a claim)
    const before = library('kaufman_adaptive_moving_average')
    const edited = kamaEdited(before.state)
    const renamed = turn(edited.state, [{ op: 'rename_definition', name: 'Kaufman Adaptive Moving Average' }])
    expect(renamed.state.working.meta.name).toBe('Kaufman Adaptive Moving Average')     // the member's own words stay
    expect(renamed.readback.lines[1]).toBe(noLongerChecked('Kaufman Adaptive Moving Average'))
    expect(noLongerChecked('X')).toBe("No longer UCT's checked formula for X: the formula was edited.")
    // CONTROL: while it IS the indicator the line is not there
    expect(before.readback.lines.join('\n')).not.toMatch(/No longer UCT's checked formula/)
  })

  it('CONTROL: a title of the member\'s own over a library formula is kept through an edit', () => {
    const e = ENTRY.get('kaufman_adaptive_moving_average')
    const mine = make([createOp(e)], 'My trend line')
    expect(kamaEdited(mine.state).state.working.meta.name).toBe('My trend line')
  })
})
