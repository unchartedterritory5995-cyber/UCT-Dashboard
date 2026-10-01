// app/src/components/chart/builder/paramCarry.test.js
//
// C46 — the carry rule and its tie-breaks, as a pure function. The door that
// calls it is railed in `BuilderSheet.pineRepaste.test.jsx`; the server's answer
// to what it produces in `tests/test_param_repaste_c46.py`.
import { describe, it, expect } from 'vitest'
import { carryPriorParamIds, savedParamManifest, carryNotice } from './paramCarry.js'

const e = (sourceName, type = 'int', title = sourceName) => ({ sourceName, title, type, default: 1, locators: [] })
const roster = (m) => Object.fromEntries(Object.entries(m).map(([id, x]) => [id, x.sourceName]))

describe('C46 — an input the saved document holds keeps its saved id', () => {
  it('matches by NAME, not by position', () => {
    const prior = { __uct_param_1: e('slow'), __uct_param_2: e('fast') }
    const next = { __uct_param_1001: e('fast'), __uct_param_1002: e('slow') }
    const r = carryPriorParamIds(next, prior)
    expect(roster(r.manifest)).toEqual({ __uct_param_2: 'fast', __uct_param_1: 'slow' })
    expect(r.added).toEqual([])
    expect(r.dropped).toEqual([])
    expect(carryNotice(r)).toBeNull()
    // the ENTRY is the fresh translation's (its locators address the tree being saved)
    expect(r.manifest.__uct_param_2).toBe(next.__uct_param_1001)
  })

  it('no saved roster (a fresh formula, or one saved with no parameters): nothing is carried', () => {
    const next = { __uct_param_1001: e('fast') }
    expect(carryPriorParamIds(next, null).manifest).toBe(next)
    expect(carryPriorParamIds(next, {}).manifest).toBe(next)
    expect(carryPriorParamIds(null, { __uct_param_1: e('x') }).manifest).toBeNull()
  })

  it('⛔ a RENAMED input matches nothing: it keeps the id the translation gave it', () => {
    const prior = { __uct_param_1: e('slow'), __uct_param_2: e('fast') }
    const next = { __uct_param_1001: e('quick', 'int', 'Quick'), __uct_param_1002: e('slow') }
    const r = carryPriorParamIds(next, prior)
    expect(roster(r.manifest)).toEqual({ __uct_param_1001: 'quick', __uct_param_1: 'slow' })
    expect(r.added).toEqual([{ name: 'quick', title: 'Quick', id: '__uct_param_1001' }])
    expect(r.dropped).toEqual(['fast'])
    expect(carryNotice(r)).toMatch(/^`Quick` is not among the adjustable settings/)
  })

  it('⛔ a changed KIND matches nothing, under the same name', () => {
    const prior = { __uct_param_1: e('len', 'int') }
    const next = { __uct_param_1001: e('len', 'float') }
    const r = carryPriorParamIds(next, prior)
    expect(roster(r.manifest)).toEqual({ __uct_param_1001: 'len' })
    expect(r.added.map((a) => a.name)).toEqual(['len'])
  })

  it('⛔ two inputs declared under ONE name are matched in order: incoming in source order, prior in id order', () => {
    const prior = { __uct_param_2: e('len', 'int', 'second'), __uct_param_1: e('len', 'int', 'first') }
    const next = { __uct_param_1004: e('len', 'int', 'A'), __uct_param_1009: e('len', 'int', 'B'), __uct_param_1011: e('len', 'int', 'C') }
    const r = carryPriorParamIds(next, prior)
    expect(Object.fromEntries(Object.entries(r.manifest).map(([id, x]) => [id, x.title])))
      .toEqual({ __uct_param_1: 'A', __uct_param_2: 'B', __uct_param_1011: 'C' })
    expect(r.added.map((a) => a.title)).toEqual(['C'])
  })

  it('⛔⛔ a new input never sits on an id the saved document holds for a DIFFERENT input', () => {
    // Saved after C46: `c` was the third input call → 1003. An input is then added
    // above it, so `c` is now the fourth call and the NEW input `x` is the third.
    const prior = { __uct_param_1003: e('c') }
    const next = { __uct_param_1003: e('x'), __uct_param_1004: e('c') }
    const r = carryPriorParamIds(next, prior)
    expect(roster(r.manifest)).toEqual({ __uct_param_1003: 'c', __uct_param_1005: 'x' })
    expect(r.added).toEqual([{ name: 'x', title: 'x', id: '__uct_param_1005' }])
  })

  it('…also when the saved input it would collide with is no longer in the script', () => {
    const prior = { __uct_param_1001: e('gone') }
    const next = { __uct_param_1001: e('x') }
    const r = carryPriorParamIds(next, prior)
    expect(roster(r.manifest)).toEqual({ __uct_param_1002: 'x' })
    expect(r.dropped).toEqual(['gone'])
  })

  it('the notice names every unmatched input and says what to do', () => {
    const r = carryPriorParamIds({ __uct_param_1001: e('a', 'int', 'A'), __uct_param_1002: e('b', 'int', 'B') }, { __uct_param_1: e('z') })
    expect(carryNotice(r)).toMatch(/^`A`, `B` are not among/)
    expect(carryNotice(r)).toMatch(/Save it as a new formula/)
  })

  it('the saved roster is read from whichever slot the document keeps it in', () => {
    expect(savedParamManifest({ compute: { paramManifest: { __uct_param_1: e('a') } } })).toBeTruthy()
    expect(savedParamManifest({ compute: { graph: { parameters: { __uct_param_1: e('a') } } } })).toBeTruthy()
    expect(savedParamManifest({ compute: { paramManifest: {} } })).toBeNull()
    expect(savedParamManifest(null)).toBeNull()
  })
})
