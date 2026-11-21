// app/src/components/chart/builder/authoring/derivedName.legacyWording.test.js
//
// ─── A NAME SAVED BEFORE 2026-11-21 IS STILL AN AUTOMATIC NAME ───────────────────────────────
//
// Until that day an automatic name said most functions by their upper-cased engine name ("PERCENTRANK 100",
// "WILLIAMSR 9 (High, Low)"). The builder's first answer now opens with the names, so names moved to the plain
// words the settings rows already used (`CALL_WORDS`). A saved name is recognised as automatic by comparing it
// with the wording it was derived in, so the wording of that day is kept as `legacy`: recognised, never
// written again. A name saved in it moves to the plain words the next time its indicator is edited; a name a
// member typed never moves; nothing at rest is rewritten.
//
// ⛔ `legacyNameWording.fixture.json` IS A RECORDING, NOT A SPECIFICATION. It was written by the code as it
// stood before the change: for every function of the closed table, and every function either word table of
// that day named, how `f(9)` read in a name. The legacy wording is held to it word for word.
import { describe, it, expect } from 'vitest'
import TABLE from '../../engine/ast/closedTable.json'
import RECORDED from './legacyNameWording.fixture.json'
import { nameOfTree, namingSnapshot, applyDerivedNaming, CALL_WORDS, WORDED_BEFORE_2026_11_21, NAME_MODES } from './derivedName'

const call = (fn, n = 9) => ({ type: 'call', name: fn, args: [{ type: 'num', value: n }] })
const legacy = (fn, n) => nameOfTree(call(fn, n), 0, 'legacy')
const plain = (fn, n) => nameOfTree(call(fn, n))
/** `f(n) > 5`: a formula whose three wordings ALL differ ("Percent rank 9 above 5", "PERCENTRANK 9 above 5",
 *  "PERCENTRANK 9 > 5"). A bare call reads the same in `legacy` and in `formula`, so a test on a bare call
 *  cannot tell whether the LEGACY wording is recognised: it passed with that recognition removed. */
const above5 = (fn, n = 9) => ({ type: 'op', name: '>', args: [call(fn, n), { type: 'num', value: 5 }] })
/** how that formula was named until 2026-11-21, built from the RECORDING and never from the legacy code path */
const wasNamed = (fn) => `${RECORDED[fn]} above 5`
/** a saved indicator with one line: `{name, the line's maths}` */
const saved = (fn, name, n = 9, label = '') => ({ name, scanKey: 'value', rows: [{ key: 'value', label, ast: above5(fn, n) }] })
const NOTHING_TYPED = { renamedDefinition: false, renamedOutputs: new Set() }
/** every function whose word in a name CHANGED on 2026-11-21, derived from the table and the recording */
const REWORDED = Object.keys(CALL_WORDS).filter((fn) => plain(fn) !== (RECORDED[fn] || `${fn.toUpperCase()} 9`))

describe('the legacy wording is the wording of 2026-11-20, word for word', () => {
  it('every recorded function reads in `legacy` exactly as the code of that day wrote it', () => {
    expect(Object.keys(RECORDED).length).toBeGreaterThan(100)
    const differ = Object.keys(RECORDED).filter((fn) => legacy(fn) !== RECORDED[fn]).map((fn) => `${fn}: ${legacy(fn)} != ${RECORDED[fn]}`)
    expect(differ).toEqual([])
  })

  it('the recording covers every function of that day\'s table and every function that has a word', () => {
    // (a function ADDED to the table later was never in a saved name: it is not required here)
    expect(Object.keys(CALL_WORDS).filter((fn) => !(fn in RECORDED))).toEqual([])
    expect(Object.keys(RECORDED).filter((fn) => !(fn in TABLE.functions) && !(fn in CALL_WORDS))).toEqual([])
  })

  it('a function added to the table after that day reads upper-cased in `legacy` (it had no word then)', () => {
    for (const fn of Object.keys(TABLE.functions).filter((f) => !(f in RECORDED))) expect(legacy(fn), fn).toBe(`${fn.toUpperCase()} 9`)
    expect(legacy('aFunctionThatDoesNotExist')).toBe('AFUNCTIONTHATDOESNOTEXIST 9')
    expect(legacy('constructor')).toBe('CONSTRUCTOR 9')                    // never a property of the table object itself
    expect(plain('constructor')).toBe('CONSTRUCTOR 9')
  })

  it('⛔ the frozen list IS the functions that had a word that day: derived from the recording, never by hand', () => {
    const hadAWord = Object.keys(RECORDED).filter((fn) => RECORDED[fn] !== `${fn.toUpperCase()} 9`).sort()
    expect([...WORDED_BEFORE_2026_11_21].sort()).toEqual(hadAWord)
    expect(Object.isFrozen(WORDED_BEFORE_2026_11_21)).toBe(true)
    expect(hadAWord).toHaveLength(13)
    // those thirteen read the same in both wordings: their names did not change
    for (const fn of hadAWord) expect(plain(fn), fn).toBe(legacy(fn))
  })

  it('`legacy` is a wording of its own beside the other two, and differs from `plain` only in the function words', () => {
    expect(NAME_MODES).toEqual(['plain', 'formula', 'legacy'])
    const tree = { type: 'op', name: '>', args: [call('percentrank', 100), { type: 'offset', value: 1, args: [call('ema', 21)] }] }
    expect(nameOfTree(tree)).toBe('Percent rank 100 above previous EMA 21')
    expect(nameOfTree(tree, 0, 'legacy')).toBe('PERCENTRANK 100 above previous EMA 21')     // the same sentence, the older word
    expect(nameOfTree(tree, 0, 'formula')).toBe('PERCENTRANK 100 > EMA 21[1]')
  })
})

describe('⛔ every function whose name wording changed is still recognised as automatic', () => {
  it('there are many of them, and each one\'s wording really did change', () => {
    expect(REWORDED.length).toBeGreaterThan(35)
    expect(REWORDED).toContain('percentrank')
    expect(REWORDED.filter((fn) => WORDED_BEFORE_2026_11_21.includes(fn))).toEqual([])
    for (const fn of REWORDED) expect(RECORDED[fn], fn).toBe(`${fn.toUpperCase()} 9`)
  })

  it.each(REWORDED)('%s: a name and a label saved in the older wording are automatic', (fn) => {
    const was = wasNamed(fn)
    // the recording and the code agree on what that name was, and it is in NEITHER of the other two wordings
    expect(nameOfTree(above5(fn), 0, 'legacy')).toBe(was)
    expect(was).not.toBe(nameOfTree(above5(fn)))
    expect(was).not.toBe(nameOfTree(above5(fn), 0, 'formula'))
    expect(namingSnapshot(saved(fn, was)).nameAuto, `"${was}" would be frozen as if a member had typed it`).toBe(true)
    // a second line labelled in the older wording follows its maths too
    const two = { name: 'x', scanKey: 'a', rows: [{ key: 'a', label: '', ast: call('ema', 20) }, { key: 'b', label: was, ast: above5(fn) }] }
    expect(namingSnapshot(two).rows.get('b').auto, `the label "${was}"`).toBe(true)
    // and so is the name in today's wording; a typed one is not
    expect(namingSnapshot(saved(fn, nameOfTree(above5(fn)))).nameAuto).toBe(true)
    expect(namingSnapshot(saved(fn, 'My own name')).nameAuto).toBe(false)
  })

  it.each(REWORDED)('%s: on the next edit the older name moves to the plain words, and says so', (fn) => {
    const before = namingSnapshot(saved(fn, wasNamed(fn)))
    const after = saved(fn, wasNamed(fn), 21)                              // the member changed the 9 to 21
    const changes = applyDerivedNaming(after, before, NOTHING_TYPED)
    expect(after.name).toBe(nameOfTree(above5(fn, 21)))
    expect(after.name.startsWith(CALL_WORDS[fn]), after.name).toBe(true)
    expect(after.name.endsWith(' above 5')).toBe(true)
    expect(changes).toEqual([{ kind: 'name-derived', from: wasNamed(fn), to: nameOfTree(above5(fn, 21)) }])
  })

  it('a name a member typed never moves, whatever the maths does', () => {
    for (const fn of REWORDED.slice(0, 8)) {
      const before = namingSnapshot(saved(fn, 'My breadth gauge'))
      const after = saved(fn, 'My breadth gauge', 21)
      expect(applyDerivedNaming(after, before, NOTHING_TYPED)).toEqual([])
      expect(after.name).toBe('My breadth gauge')
    }
  })

  it('CONTROL: a name in a wording nobody ever saved is not automatic (recognition is not "anything goes")', () => {
    for (const fn of REWORDED.slice(0, 8)) {
      expect(namingSnapshot(saved(fn, `${fn} 9 above 5`)).nameAuto, fn).toBe(false)             // the bare lower-case name
      expect(namingSnapshot(saved(fn, `${wasNamed(fn)} `)).nameAuto, fn).toBe(false)           // one stray space
      expect(namingSnapshot(saved(fn, wasNamed(fn).replace('9', '10'))).nameAuto, fn).toBe(false)   // the wording of OTHER maths
    }
  })
})
