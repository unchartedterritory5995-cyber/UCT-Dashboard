// ─── ⭐ PERF (Fred RS filled chart, C5) — THE UNFILLED-ELEMENT GUARD, AS A LOOP ──────────────────────────────────────
//
// `collections.js` guards every member that reads all of an array's elements (`READS_ALL`): an element that is the
// unmeasured fill (`UNFILLED`) stops the run by name, naming the FIRST such element. The scan was `x.find(isUnfilled)`
// and is now the same predicate in a plain loop. These rails hold it to the `find` answer: over every READS_ALL member
// a script reaches through `array.includes` / `indexof` / `sum` / `covariance` (two arrays), with the fill first, in the
// middle, last, twice with two different types (the first is named), in a sparse array, and absent (the member's own
// answer). And every RUNTIME rail that reaches the guard stays as it was (arrays.test.js).
import { describe, it, expect } from 'vitest'
import { ARRAY_FNS, UNFILLED, isUnfilled, CollectionError } from '../collections.js'
import { Budget } from '../limits.js'

/** The guard as it was (`x.find(isUnfilled)`), around the same member: the reference. */
function reference(name, args) {
  for (const x of args) {
    if (Array.isArray(x)) {
      const hit = x.find(isUnfilled)
      if (hit) return { e: 'unfilled', typeArg: hit.typeArg }
    }
  }
  return null
}
const run = (name, args) => {
  try { return { v: ARRAY_FNS[name].fn(args, new Budget(), undefined) } } catch (e) {
    return { e: e instanceof CollectionError ? 'collection' : String(e), message: e.message }
  }
}
const fill = (typeArg) => Object.freeze({ ...UNFILLED, typeArg })

describe('the unfilled-element guard is the find answer, written as a loop', () => {
  const B = fill('bool')
  const S = fill('string')
  const shapes = {
    'no fill': [1, 2, 3],
    'fill first': [B, 2, 3],
    'fill in the middle': [1, B, 3],
    'fill last': [1, 2, B],
    'two fills, the first named': [1, B, S],
    'two fills reversed': [S, 2, B],
    'a sparse array': (() => { const a = [1]; a[3] = B; return a })(),
    'empty': [],
  }
  for (const [shape, arr] of Object.entries(shapes)) {
    for (const [name, args] of [['array.includes', [arr, 2]], ['array.indexof', [arr, 3]], ['array.sum', [arr]],
      ['array.covariance', [[1, 2, 3], arr]]]) {
      it(`${name}, ${shape}`, () => {
        const ref = reference(name, args)
        const got = run(name, args)
        if (ref) {
          expect(got.e, 'stopped by name').toBe('collection')
          // the first fill's type is the one the sentence names
          const other = ref.typeArg === 'bool' ? 'string' : 'bool'
          expect(got.message).toMatch(new RegExp(ref.typeArg === null ? '.' : ref.typeArg))
          if (shape.startsWith('two fills')) expect(got.message).not.toMatch(new RegExp(`\\b${other}\\b`))
        } else {
          expect(got.e === undefined || got.e === 'collection', JSON.stringify(got)).toBe(true)
        }
      })
    }
  }
})
