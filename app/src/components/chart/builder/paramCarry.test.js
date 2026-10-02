// app/src/components/chart/builder/paramCarry.test.js
//
// C46 — the carry rule and its tie-breaks, as a pure function. The door that
// calls it is railed in `BuilderSheet.pineRepaste.test.jsx`; the server's answer
// to what it produces in `tests/test_param_repaste_c46.py`.
import { describe, it, expect } from 'vitest'
import { carryPriorParamIds, savedParamManifest, carryNotice, inputPlaces } from './paramCarry.js'

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

  it('⛔ a new NAME with no known place matches nothing: it keeps the id the translation gave it', () => {
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

// ─── a RENAME is recognised by its place ─────────────────────────────────────
// `places` is what the door reads off the translation: each pasted input's turn
// in the walk (the number the old counter would have given it) and its place in
// the source. A saved counter id is compared with the first, a saved source id
// with the second.
const at = (walk, ordinal) => ({ walk, ordinal })

describe('C46 — a renamed input keeps its saved id when it stands exactly where the saved one stood', () => {
  it('⭐ a document saved under COUNTER ids: the place is the turn in the walk', () => {
    const prior = { __uct_param_1: e('slow', 'int', 'Slow'), __uct_param_2: e('fast', 'int', 'Fast') }
    const next = { __uct_param_1001: e('quick', 'int', 'Quick'), __uct_param_1002: e('slow', 'int', 'Slow') }
    const r = carryPriorParamIds(next, prior, { __uct_param_1001: at(2, 1), __uct_param_1002: at(1, 2) })
    expect(roster(r.manifest)).toEqual({ __uct_param_2: 'quick', __uct_param_1: 'slow' })
    expect(r.renamed).toEqual([{ from: 'Fast', to: 'Quick', id: '__uct_param_2' }])
    expect(r.added).toEqual([])
    expect(r.dropped).toEqual([])
    expect(carryNotice(r)).toBe('The input "Fast" is now "Quick". It is the same saved setting under its new name.')
  })

  it('⭐ a document saved under SOURCE ids: the place is the place in the source', () => {
    const prior = { __uct_param_1001: e('fast', 'int', 'Fast'), __uct_param_1002: e('slow', 'int', 'Slow') }
    const next = { __uct_param_1001: e('quick', 'int', 'Quick'), __uct_param_1002: e('slow', 'int', 'Slow') }
    // the walk reaches them the other way round, and that must not matter here
    const r = carryPriorParamIds(next, prior, { __uct_param_1001: at(2, 1), __uct_param_1002: at(1, 2) })
    expect(roster(r.manifest)).toEqual({ __uct_param_1001: 'quick', __uct_param_1002: 'slow' })
    expect(r.renamed).toEqual([{ from: 'Fast', to: 'Quick', id: '__uct_param_1001' }])
  })

  it('⛔ a different PLACE is not a rename (the walk reaches it at another turn)', () => {
    const prior = { __uct_param_1: e('slow'), __uct_param_2: e('fast') }
    const next = { __uct_param_1001: e('quick'), __uct_param_1002: e('slow') }
    const r = carryPriorParamIds(next, prior, { __uct_param_1001: at(3, 1), __uct_param_1002: at(1, 2) })
    expect(roster(r.manifest)).toEqual({ __uct_param_1001: 'quick', __uct_param_1: 'slow' })
    expect(r.renamed).toEqual([])
    expect(r.added.map((a) => a.name)).toEqual(['quick'])
  })

  it('⛔ a different KIND is not a rename, in the same place', () => {
    const prior = { __uct_param_1: e('slow'), __uct_param_2: e('fast', 'int') }
    const next = { __uct_param_1001: e('quick', 'float'), __uct_param_1002: e('slow') }
    const r = carryPriorParamIds(next, prior, { __uct_param_1001: at(2, 1), __uct_param_1002: at(1, 2) })
    expect(roster(r.manifest)).toEqual({ __uct_param_1001: 'quick', __uct_param_1: 'slow' })
    expect(r.renamed).toEqual([])
  })

  it('⭐ a rename beside an ADDED input: the rename carries, the added one does not take a saved id', () => {
    const prior = { __uct_param_1: e('slow'), __uct_param_2: e('fast', 'int', 'Fast') }
    const next = { __uct_param_1001: e('sig', 'int', 'Signal'), __uct_param_1002: e('quick', 'int', 'Quick'), __uct_param_1003: e('slow') }
    const r = carryPriorParamIds(next, prior, {
      __uct_param_1001: at(3, 1), __uct_param_1002: at(2, 2), __uct_param_1003: at(1, 3),
    })
    expect(roster(r.manifest)).toEqual({ __uct_param_1001: 'sig', __uct_param_2: 'quick', __uct_param_1: 'slow' })
    expect(r.renamed.map((x) => x.to)).toEqual(['Quick'])
    expect(r.added.map((a) => a.title)).toEqual(['Signal'])
    expect(carryNotice(r)).toMatch(/^The input "Fast" is now "Quick"\. .* `Signal` is not among the adjustable settings/)
  })

  it('⭐ two renames at once, both in place: both carry', () => {
    const prior = { __uct_param_1: e('slow', 'int', 'Slow'), __uct_param_2: e('fast', 'int', 'Fast') }
    const next = { __uct_param_1001: e('quick', 'int', 'Quick'), __uct_param_1002: e('lag', 'int', 'Lag') }
    const r = carryPriorParamIds(next, prior, { __uct_param_1001: at(2, 1), __uct_param_1002: at(1, 2) })
    expect(roster(r.manifest)).toEqual({ __uct_param_2: 'quick', __uct_param_1: 'lag' })
    expect(r.renamed).toEqual([
      { from: 'Fast', to: 'Quick', id: '__uct_param_2' }, { from: 'Slow', to: 'Lag', id: '__uct_param_1' },
    ])
    expect(r.added).toEqual([])
  })

  it('⛔ a NAME match is decided first, and a swap of two inputs never reaches the rename rule', () => {
    const prior = { __uct_param_1: e('slow'), __uct_param_2: e('fast') }
    // the script now declares slow first; the walk order is whatever it is
    const next = { __uct_param_1001: e('slow'), __uct_param_1002: e('fast') }
    const r = carryPriorParamIds(next, prior, { __uct_param_1001: at(2, 1), __uct_param_1002: at(1, 2) })
    expect(roster(r.manifest)).toEqual({ __uct_param_1: 'slow', __uct_param_2: 'fast' })
    expect(r.renamed).toEqual([])
    expect(carryNotice(r)).toBeNull()
  })

  it('⛔ a saved input that is still in the script is never given away as a rename target', () => {
    // `quick` stands at walk 1, which is where the saved `slow` was minted — but
    // `slow` is still declared, and took its own id by name.
    const prior = { __uct_param_1: e('slow'), __uct_param_2: e('fast') }
    const next = { __uct_param_1001: e('quick'), __uct_param_1002: e('slow') }
    const r = carryPriorParamIds(next, prior, { __uct_param_1001: at(1, 1), __uct_param_1002: at(2, 2) })
    expect(roster(r.manifest)).toEqual({ __uct_param_1001: 'quick', __uct_param_1: 'slow' })
    expect(r.renamed).toEqual([])
  })

  it('⛔ TWO saved inputs it could be is not a rename: nothing is carried on a guess', () => {
    // a counter id and a source id that both name the place this input stands at
    const prior = { __uct_param_2: e('fast'), __uct_param_1001: e('gone') }
    const next = { __uct_param_1001: e('quick') }
    const r = carryPriorParamIds(next, prior, { __uct_param_1001: at(2, 1) })
    expect(r.renamed).toEqual([])
    expect(Object.values(roster(r.manifest))).toEqual(['quick'])
    expect(Object.keys(r.manifest)).not.toContain('__uct_param_2')
    expect(Object.keys(r.manifest)).not.toContain('__uct_param_1001')
  })

  it('`inputPlaces` reads the two places off the translation entries, which carry them non-enumerably', () => {
    const p = { id: '__uct_param_1001', sourceName: 'x' }
    Object.defineProperty(p, 'ordinal', { value: 1, enumerable: false })
    Object.defineProperty(p, 'walkIndex', { value: 2, enumerable: false })
    expect(inputPlaces([p])).toEqual({ __uct_param_1001: { walk: 2, ordinal: 1 } })
    expect(inputPlaces(null)).toEqual({})
  })
})
