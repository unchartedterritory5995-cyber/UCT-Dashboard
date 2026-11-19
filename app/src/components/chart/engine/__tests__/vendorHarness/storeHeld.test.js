// storeHeld.js: the pins a row graded with a library store records, and the skip a run without it takes.
import { describe, it, expect, afterEach } from 'vitest'
import { createHash } from 'node:crypto'
import { registerPineLibrary, clearPineLibraries } from '../../ast/pineLibraryStore.js'
import { storeHeldOf, storeHolds, libraryStorePins, supplyHeldOf, supplyHeldStorePins, heldHolds, heldReading,
  heldPinsOf } from './storeHeld.js'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { __setSupplyDirForTests, __setSupplyHeldDirForTests, recordedSupplyFileOf } from './ourSide.js'

const sha = (s) => createHash('sha256').update(s, 'utf8').digest('hex')
const INNER = '//@version=5\nlibrary("inner")\nexport f(float x) => x * 2\n'
const OUTER = '//@version=5\nlibrary("outer")\nimport tester/inner/1 as inn\nexport g(float x) => inn.f(x)\n'
const entry = (path, source) => ({ path, source, sha256: sha(source), licence: 'MPL-2.0' })

describe('store-held pins (libraries chain, 2026-11-19)', () => {
  afterEach(() => clearPineLibraries())

  it('a script reaching a registered version records it, closed over what that version imports', () => {
    registerPineLibrary(entry('tester/inner/1', INNER))
    registerPineLibrary(entry('tester/outer/1', OUTER))
    const src = '//@version=5\nindicator("x")\nimport tester/outer/1 as o\nplot(o.g(close))\n'
    expect(storeHeldOf(src)).toEqual([`tester/inner/1@${sha(INNER)}`, `tester/outer/1@${sha(OUTER)}`])
    expect(storeHolds(storeHeldOf(src))).toBe(true)
    expect(libraryStorePins(['tester/outer/1', 'tester/inner/1']))
      .toEqual([{ path: 'tester/inner/1', sha256: sha(INNER) }, { path: 'tester/outer/1', sha256: sha(OUTER) }])
  })

  it('a script importing nothing registered records nothing (no row is marked by accident)', () => {
    registerPineLibrary(entry('tester/inner/1', INNER))
    expect(storeHeldOf('//@version=5\nindicator("x")\nplot(close)\n')).toEqual([])
    expect(storeHeldOf('//@version=5\nindicator("x")\nimport tester/other/1 as t\nplot(close)\n')).toEqual([])
  })

  it('a run without the store, or with other code under the same version, does not hold the pins', () => {
    const pins = [`tester/inner/1@${sha(INNER)}`]
    expect(storeHolds(pins)).toBe(false)                       // nothing loaded: CI
    registerPineLibrary(entry('tester/inner/1', INNER.replace('2', '3')))
    expect(storeHolds(pins)).toBe(false)                       // the same version, other code
    clearPineLibraries()
    registerPineLibrary(entry('tester/inner/1', INNER))
    expect(storeHolds(pins)).toBe(true)                        // CONTROL: the graded code, held
    expect(storeHolds([])).toBe(true)                          // a row needing nothing is never skipped
  })
})


// ⭐⭐ HELD INPUTS, TWO KINDS, ONE RULE (coordinator ruling 2026-11-19): a LOCAL supply record (the held directory,
// never tests/fixtures/vendor-supply) is held exactly as a library version is.
describe('supply-held pins (Q-FRED-NHDOT, 2026-11-19)', () => {
  const ID = 'rs-rating-fred6724-nhdot-adt-1d-2026-11-19'
  let committed, held
  const write = (dir, id, body) => fs.writeFileSync(path.join(dir, `${id}.json`), body)
  const fresh = () => {
    committed = fs.mkdtempSync(path.join(os.tmpdir(), 'supply-committed-'))
    held = fs.mkdtempSync(path.join(os.tmpdir(), 'supply-held-'))
    __setSupplyDirForTests(committed)
    __setSupplyHeldDirForTests(held)
  }
  afterEach(() => { __setSupplyDirForTests(null); __setSupplyHeldDirForTests(null) })

  it('a held record is read after the committed directory, and pinned at the sha of its bytes', () => {
    fresh()
    write(held, ID, '{"held": 1}')
    expect(recordedSupplyFileOf(ID)).toEqual({ file: path.join(held, `${ID}.json`), held: true })
    const pins = supplyHeldOf(ID)
    expect(pins).toEqual([`supply/${ID}@${sha('{"held": 1}')}`])
    expect(supplyHeldStorePins()).toEqual([{ captureId: ID, sha256: sha('{"held": 1}') }])
    expect(heldHolds(pins)).toBe(true)                                    // CONTROL: the record graded, held
    expect(heldReading(pins)).toBe(`supply-held: ${pins[0]}`)
  })

  it('a committed record of the same id wins: nothing is supply-held', () => {
    fresh()
    write(held, ID, '{"held": 1}')
    write(committed, ID, '{"committed": 1}')
    expect(recordedSupplyFileOf(ID)).toEqual({ file: path.join(committed, `${ID}.json`), held: false })
    expect(supplyHeldOf(ID)).toEqual([])
    expect(supplyHeldStorePins()).toEqual([])
  })

  it('a run without the record, or with another version of it, does not hold the pin (the row is skipped by name)', () => {
    fresh()
    write(held, ID, '{"held": 1}')
    const pins = supplyHeldOf(ID)
    write(held, ID, '{"held": 2}')                                        // the record changed since the grade
    expect(heldHolds(pins)).toBe(false)
    fs.rmSync(path.join(held, `${ID}.json`))                              // a machine without it (CI)
    expect(heldHolds(pins)).toBe(false)
    expect(supplyHeldOf(ID)).toEqual([])
  })

  it('both kinds read as one row: its pins, sorted, and its name', () => {
    const lib = `tester/inner/1@${sha(INNER)}`
    const sup = `supply/${ID}@${'d'.repeat(64)}`
    expect(heldPinsOf({ storeHeld: [lib], supplyHeld: [sup] })).toEqual([sup, lib].sort())
    expect(heldReading([lib, sup])).toBe(`store-held: ${lib}; supply-held: ${sup}`)
    expect(heldReading([lib])).toBe(`store-held: ${lib}`)                  // a store-only row reads as it always did
  })
})
