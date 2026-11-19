// storeHeld.js: the pins a row graded with a library store records, and the skip a run without it takes.
import { describe, it, expect, afterEach } from 'vitest'
import { createHash } from 'node:crypto'
import { registerPineLibrary, clearPineLibraries } from '../../ast/pineLibraryStore.js'
import { storeHeldOf, storeHolds, libraryStorePins } from './storeHeld.js'

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
