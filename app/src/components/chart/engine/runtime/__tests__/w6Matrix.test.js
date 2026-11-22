// app/src/components/chart/engine/runtime/__tests__/w6Matrix.test.js
//
// ─── ⭐⭐ W6-T7 — `matrix.*` ON THE RUNTIME LANE ─────────────────────────────────
//
// Each member here is served from its Pine v6 REFERENCE entry and nothing else (read
// 2026-11-06 through `tools/pine_survey/pine_reference_extract.js`; each `describe` cites,
// in one short sentence, the rule it rests on). What an entry does not state STOPS the run
// by name — `W6-M1` in `docs/pine/capture-queue-2026-11-06-w6.md`, probe
// `tools/visual_conformance/probes/vw-w6-matrix-members.pine` — and every such stop has a
// rail below that reaches it. The members live in `runtime/matrices.js`, dispatched
// through `collections.js`'s ONE table (`ARRAY_FNS`).
//
// ⛔ EVERY FIXTURE IS `na`-FREE (unless the `na` is the question) and MOVES with the bars:
// the expected value is computed here in JavaScript from the same bars, never typed in.
import { describe, it, expect } from 'vitest'

import { buildRuntimeIr } from '../../ast/pineRuntimeFrontend.js'
import { lowerIrProgram } from '../lowerIr.js'
import { execute } from '../vm.js'
import { ARRAY_FNS, DOOR_GATED_ARRAY, kindOf } from '../collections.js'
import { isMatrix } from '../matrices.js'
import { encodeState, cloneValues } from '../vmState.js'

const N = 6
// FRACTIONAL prices, so a `matrix<float>` built from them is provably float
const BARS = Array.from({ length: N }, (_, i) => (
  { t: 1700000000 + i * 86400, o: 99.5 + i, h: 101.25 + i * 2, l: 98.75 - i, c: 100.5 + i * 3, v: 1000 + i }))
const SERIES = ['o', 'h', 'l', 'c', 'v'].map((k) => Float64Array.from(BARS.map((b) => b[k])))
const per = (f) => BARS.map((b, i) => f(b, i))

function build(src, version = 6, extra = {}) {
  return buildRuntimeIr(`//@version=${version}\nindicator("t", overlay = true)\n${src}`, { bars: BARS, inputs: {}, ...extra })
}
function runPine(src, version = 6) {
  const built = build(src, version)
  if (!built.ok) throw new Error(`refused: ${built.refusal.guard} — ${built.refusal.message}`)
  const program = lowerIrProgram(built.ir)
  const { outputs } = execute(program, { bars: N, series: SERIES, columns: program.columns, confirmed: true })
  return outputs.map((o) => Array.from(o))
}
const close = (got, want) => {
  expect(got.length).toBe(want.length)
  got.forEach((g, i) => expect(g).toBeCloseTo(want[i], 9))
}
const W6M1 = /W6-M1/
// a 2×2 of the bar's prices: [[open, high], [low, close]]
const M22 = 'm = matrix.new<float>(2, 2, 0.0)\nmatrix.set(m, 0, 0, open)\nmatrix.set(m, 0, 1, high)\n'
  + 'matrix.set(m, 1, 0, low)\nmatrix.set(m, 1, 1, close)\n'

describe('⭐ matrix.new — rows / columns "Optional. The default value is 0"; initial_value "Optional. The default is \'na\'."', () => {
  it('the sized form fills every element with the initial value', () => {
    const [r, c, g] = runPine('m = matrix.new<float>(2, 3, close)\nplot(matrix.rows(m))\nplot(matrix.columns(m))\nplot(matrix.get(m, 1, 2))')
    expect(r).toEqual(per(() => 2))
    expect(c).toEqual(per(() => 3))
    expect(g).toEqual(per((b) => b.c))
  })
  it('no initial value: `na` in a float / int matrix; no sizes: 0 × 0', () => {
    const [n, i, r, c] = runPine('m = matrix.new<float>(2, 2)\nplot(na(matrix.get(m, 1, 1)) ? 1 : 0)\n'
      + 'k = matrix.new<int>(1, 1)\nplot(na(matrix.get(k, 0, 0)) ? 1 : 0)\ne = matrix.new<float>()\nplot(matrix.rows(e))\nplot(matrix.columns(e))')
    expect(n).toEqual(per(() => 1))
    expect(i).toEqual(per(() => 1))
    expect(r).toEqual(per(() => 0))
    expect(c).toEqual(per(() => 0))
  })
  it('⛔ an `na` row or column count stops by name (W6-M1; `candlestick-patterns-on-backtest` writes `matrix.new<float>(na, n, na)`)', () => {
    expect(() => runPine('m = matrix.new<float>(na, 2, na)\nplot(matrix.rows(m))')).toThrow(/matrix\.new with an `na` row count.*W6-M1/)
    expect(() => runPine('m = matrix.new<float>(2, na)\nplot(matrix.rows(m))')).toThrow(/`na` column count.*W6-M1/)
  })
  it('⛔ a negative or fractional count, and a sized bool / string matrix with no initial value, stop by name', () => {
    expect(() => runPine('m = matrix.new<float>(-1, 2, 0.0)\nplot(matrix.rows(m))')).toThrow(W6M1)
    expect(() => runPine('m = matrix.new<bool>(1, 1)\nplot(matrix.rows(m))')).toThrow(/matrix\.new<bool>\(1, 1\) with no initial value.*W6-M1/)
  })
})

describe('⭐ matrix.get / matrix.set — "Indexing of the rows and columns starts at zero."', () => {
  it('set writes the element get reads, in both forms', () => {
    const [a, b, c, d] = runPine(`${M22}plot(matrix.get(m, 0, 0))\nplot(m.get(0, 1))\nplot(matrix.get(m, 1, 0))\nm.set(1, 1, open)\nplot(m.get(1, 1))`)
    expect(a).toEqual(per((x) => x.o))
    expect(b).toEqual(per((x) => x.h))
    expect(c).toEqual(per((x) => x.l))
    expect(d).toEqual(per((x) => x.o))
  })
  it('⛔ an index outside the matrix — past the end or negative — STOPS by name, never na', () => {
    expect(() => runPine(`${M22}plot(matrix.get(m, 2, 0))`)).toThrow(/matrix\.get: row index 2 is outside a matrix with 2 rows.*W6-M1/)
    expect(() => runPine(`${M22}plot(matrix.get(m, 0, 2))`)).toThrow(/column index 2.*W6-M1/)
    expect(() => runPine(`${M22}plot(matrix.get(m, -1, 0))`)).toThrow(/row index -1.*W6-M1/)
    expect(() => runPine(`${M22}matrix.set(m, 0, 5, close)\nplot(close)`)).toThrow(/matrix\.set: column index 5.*W6-M1/)
  })
})

describe('⭐ matrix.rows / columns / elements_count — "returns the number of rows in the matrix"; "the total number of all matrix elements"', () => {
  it('counts', () => {
    const [r, c, n] = runPine('m = matrix.new<float>(3, 4, close)\nplot(m.rows())\nplot(matrix.columns(m))\nplot(matrix.elements_count(m))')
    expect(r).toEqual(per(() => 3))
    expect(c).toEqual(per(() => 4))
    expect(n).toEqual(per(() => 12))
  })
})

describe('⭐ a matrix is a REFERENCE — `m2 = m` names the same matrix; "matrix.copy … creates a new matrix which is a copy of the original."', () => {
  it('a write through an alias is seen through the original', () => {
    const [x] = runPine(`${M22}m2 = m\nmatrix.set(m2, 0, 0, close)\nplot(matrix.get(m, 0, 0))`)
    expect(x).toEqual(per((b) => b.c))
  })
  it('a write to a copy is not', () => {
    const [x, y] = runPine(`${M22}c = matrix.copy(m)\nmatrix.set(c, 0, 0, close)\nplot(matrix.get(m, 0, 0))\nplot(matrix.get(c, 0, 0))`)
    expect(x).toEqual(per((b) => b.o))
    expect(y).toEqual(per((b) => b.c))
  })
})

describe('⭐ matrix.row / matrix.col — "creates a one-dimensional array from the elements of a matrix row": a COPY', () => {
  it('the row and the column, as arrays', () => {
    const [r0, r1, c0, c1] = runPine(`${M22}r = matrix.row(m, 1)\nplot(array.get(r, 0))\nplot(array.get(r, 1))\nk = matrix.col(m, 1)\nplot(array.get(k, 0))\nplot(array.size(k))`)
    expect(r0).toEqual(per((b) => b.l))
    expect(r1).toEqual(per((b) => b.c))
    expect(c0).toEqual(per((b) => b.h))
    expect(c1).toEqual(per(() => 2))
  })
  it('a name bound to `matrix.row` / `matrix.col` holds an ARRAY: its method form is an `array.*` member', () => {
    const [a, n] = runPine(`${M22}r = matrix.row(m, 1)\nplot(r.get(1))\nk = matrix.col(m, 0)\nk.push(close)\nplot(k.size())`)
    expect(a).toEqual(per((b) => b.c))
    expect(n).toEqual(per(() => 3))
  })
  it('a write to the returned array does not reach the matrix (row and col)', () => {
    const [a, b] = runPine(`${M22}r = matrix.row(m, 0)\narray.set(r, 0, -1.0)\nplot(matrix.get(m, 0, 0))\n`
      + 'k = matrix.col(m, 1)\narray.set(k, 1, -1.0)\nplot(matrix.get(m, 1, 1))')
    expect(a).toEqual(per((x) => x.o))
    expect(b).toEqual(per((x) => x.c))
  })
  it('⛔ an index outside the matrix stops by name', () => {
    expect(() => runPine(`${M22}r = matrix.row(m, 2)\nplot(array.size(r))`)).toThrow(/matrix\.row: row index 2.*W6-M1/)
    expect(() => runPine(`${M22}k = matrix.col(m, -1)\nplot(array.size(k))`)).toThrow(/matrix\.col: column index -1.*W6-M1/)
  })
})

describe('⭐ matrix.add_row — "Must be a value from 0 to `matrix.rows(id)`"; "its size must equal `matrix.columns(id)`"; "By default, the function inserts a row of na values."', () => {
  it('inserts at the index and shifts the rows at or after it', () => {
    const [r, a, b] = runPine(`${M22}matrix.add_row(m, 1, array.from(close, close))\nplot(matrix.rows(m))\nplot(matrix.get(m, 1, 0))\nplot(matrix.get(m, 2, 0))`)
    expect(r).toEqual(per(() => 3))
    expect(a).toEqual(per((x) => x.c))
    expect(b).toEqual(per((x) => x.l))
  })
  it('the default index is the end, the default row is na; on an empty matrix any size', () => {
    const [r, n, e, c] = runPine(`${M22}m.add_row()\nplot(m.rows())\nplot(na(m.get(2, 1)) ? 1 : 0)\n`
      + 'e = matrix.new<float>()\nmatrix.add_row(e, 0, array.from(open, high, low))\nplot(matrix.rows(e))\nplot(matrix.columns(e))')
    expect(r).toEqual(per(() => 3))
    expect(n).toEqual(per(() => 1))
    expect(e).toEqual(per(() => 1))
    expect(c).toEqual(per(() => 3))
  })
  it('the added row is a copy of the array', () => {
    const [x] = runPine(`${M22}a = array.from(close, close)\nmatrix.add_row(m, 0, a)\narray.set(a, 0, -1.0)\nplot(matrix.get(m, 0, 0))`)
    expect(x).toEqual(per((b) => b.c))
  })
  it('⛔ an array of the wrong length, an index past rows, and the default row on an empty matrix stop by name', () => {
    expect(() => runPine(`${M22}matrix.add_row(m, 0, array.from(close))\nplot(close)`)).toThrow(/matrix\.add_row: an array of 1 into a matrix of 2×2.*W6-M1/)
    expect(() => runPine(`${M22}matrix.add_row(m, 3, array.from(close, open))\nplot(close)`)).toThrow(/row index 3 outside 0 to 2.*W6-M1/)
    expect(() => runPine('e = matrix.new<float>()\nmatrix.add_row(e)\nplot(close)')).toThrow(/no array on an empty matrix.*W6-M1/)
  })
})

describe('⭐ matrix.add_col — "Must be a value from 0 to `matrix.columns(id)`"; "its size must equal `matrix.rows(id)`"', () => {
  it('inserts a column at the index; default na at the end', () => {
    const [c, a, b, n] = runPine(`${M22}matrix.add_col(m, 0, array.from(close, open))\nplot(matrix.columns(m))\nplot(matrix.get(m, 0, 0))\nplot(matrix.get(m, 1, 2))\n`
      + 'm.add_col()\nplot(na(m.get(1, 3)) ? 1 : 0)')
    expect(c).toEqual(per(() => 3))
    expect(a).toEqual(per((x) => x.c))
    expect(b).toEqual(per((x) => x.c))
    expect(n).toEqual(per(() => 1))
  })
  it('⛔ an array of the wrong length stops by name', () => {
    expect(() => runPine(`${M22}matrix.add_col(m, 0, array.from(close, close, close))\nplot(close)`)).toThrow(/matrix\.add_col: an array of 3.*W6-M1/)
  })
})

describe('⭐ matrix.remove_row / remove_col — "removes the row at `row` index … and returns an array containing the removed row\'s values"', () => {
  it('removes and hands the values back', () => {
    const [r, v, g, c, w] = runPine(`${M22}x = matrix.remove_row(m, 0)\nplot(matrix.rows(m))\nplot(array.get(x, 1))\nplot(matrix.get(m, 0, 0))\n`
      + 'k = matrix.new<float>(2, 2, close)\nmatrix.set(k, 1, 0, open)\ny = matrix.remove_col(k, 0)\nplot(matrix.columns(k))\nplot(array.get(y, 1))')
    expect(r).toEqual(per(() => 1))
    expect(v).toEqual(per((b) => b.h))
    expect(g).toEqual(per((b) => b.l))
    expect(c).toEqual(per(() => 1))
    expect(w).toEqual(per((b) => b.o))
  })
  it('⛔ the omitted index (its stated default, matrix.rows(), is past the last row), the last row and an outside index stop by name', () => {
    expect(() => runPine(`${M22}x = matrix.remove_row(m)\nplot(close)`)).toThrow(/remove_row with the row omitted.*W6-M1/)
    expect(() => runPine('m = matrix.new<float>(1, 2, close)\nx = matrix.remove_row(m, 0)\nplot(close)')).toThrow(/remove_row of the last row.*W6-M1/)
    expect(() => runPine('m = matrix.new<float>(2, 1, close)\nx = matrix.remove_col(m, 0)\nplot(close)')).toThrow(/remove_col of the last column.*W6-M1/)
    expect(() => runPine(`${M22}x = matrix.remove_row(m, 2)\nplot(close)`)).toThrow(/remove_row: row index 2.*W6-M1/)
  })
})

describe('⭐ matrix.fill — "from `from_column` to `to_column` (not including it) and `from_row` to `to_row` (not including it)"', () => {
  it('fills the rectangle, ends exclusive', () => {
    const [a, b, c, d] = runPine('m = matrix.new<float>(3, 3, 0.5)\nmatrix.fill(m, close, 1, 3, 0, 2)\n'
      + 'plot(matrix.get(m, 1, 0))\nplot(matrix.get(m, 2, 1))\nplot(matrix.get(m, 1, 2))\nplot(matrix.get(m, 0, 0))')
    expect(a).toEqual(per((x) => x.c))
    expect(b).toEqual(per((x) => x.c))
    expect(c).toEqual(per(() => 0.5))
    expect(d).toEqual(per(() => 0.5))
  })
  it('the defaults are the whole matrix', () => {
    const [a] = runPine('m = matrix.new<float>(2, 2, 0.5)\nm.fill(close)\nplot(m.get(1, 1))')
    expect(a).toEqual(per((x) => x.c))
  })
  it('⛔ a range past the matrix, reversed, or na stops by name', () => {
    expect(() => runPine('m = matrix.new<float>(2, 2, 0.5)\nmatrix.fill(m, close, 0, 3)\nplot(close)')).toThrow(/matrix\.fill: the row range \[0, 3\).*W6-M1/)
    expect(() => runPine('m = matrix.new<float>(2, 2, 0.5)\nmatrix.fill(m, close, 0, 2, 2, 1)\nplot(close)')).toThrow(/column range \[2, 1\).*W6-M1/)
    expect(() => runPine('m = matrix.new<float>(2, 2, 0.5)\nmatrix.fill(m, close, 0, na)\nplot(close)')).toThrow(W6M1)
  })
})

describe('⭐ matrix.submatrix — "`from_row` … (inclusive)"; "`to_row` … (non inclusive)"; a new matrix', () => {
  it('extracts, and the result is a new matrix', () => {
    const [r, c, a, o] = runPine(`${M22}s = matrix.submatrix(m, 1, 2, 0, 2)\nplot(matrix.rows(s))\nplot(matrix.columns(s))\nplot(matrix.get(s, 0, 1))\n`
      + 'matrix.set(s, 0, 0, -1.0)\nplot(matrix.get(m, 1, 0))')
    expect(r).toEqual(per(() => 1))
    expect(c).toEqual(per(() => 2))
    expect(a).toEqual(per((x) => x.c))
    expect(o).toEqual(per((x) => x.l))
  })
  it('⛔ a range past the matrix stops by name', () => {
    expect(() => runPine(`${M22}s = matrix.submatrix(m, 0, 3)\nplot(close)`)).toThrow(/matrix\.submatrix: the row range.*W6-M1/)
  })
})

describe('⭐ matrix.min / max / avg — "returns the smallest value from the matrix elements"; "calculates the average of all elements in the matrix"', () => {
  it('over a float matrix', () => {
    const [lo, hi, av] = runPine(`${M22}plot(matrix.min(m))\nplot(m.max())\nplot(matrix.avg(m))`)
    close(lo, per((b) => Math.min(b.o, b.h, b.l, b.c)))
    close(hi, per((b) => Math.max(b.o, b.h, b.l, b.c)))
    close(av, per((b) => (b.o + b.h + b.l + b.c) / 4))
  })
  it('avg of a `matrix<int>` with a WHOLE mean is served (any int conversion leaves it unchanged)', () => {
    const [a] = runPine('m = matrix.new<int>(1, 2, 1)\nmatrix.set(m, 0, 1, 3)\nplot(matrix.avg(m))')
    expect(a).toEqual(per(() => 2))
  })
  it('⛔ avg of a `matrix<int>` with a FRACTIONAL mean stops by name (its `series int` form does not say how)', () => {
    expect(() => runPine('m = matrix.new<int>(1, 2, 1)\nmatrix.set(m, 0, 1, 2)\nplot(matrix.avg(m))')).toThrow(/matrix\.avg of a matrix that may be `matrix<int>`.*W6-M1/)
  })
  it('⛔ an `na` cell (in min, max and avg) and an empty matrix stop by name', () => {
    for (const fn of ['min', 'max', 'avg']) {
      expect(() => runPine(`m = matrix.new<float>(2, 2)\nmatrix.set(m, 0, 0, close)\nplot(matrix.${fn}(m))`)).toThrow(new RegExp(`matrix\\.${fn} over an \`na\` element.*W6-M1`))
      expect(() => runPine(`m = matrix.new<float>()\nplot(matrix.${fn}(m))`)).toThrow(new RegExp(`matrix\\.${fn} of an empty matrix.*W6-M1`))
    }
  })
})

describe('⭐ matrix.sum — "the sum of two matrices `id1` and `id2`, or of an `id1` matrix and an `id2` scalar"', () => {
  it('a matrix plus a scalar, and two matrices, each a new matrix', () => {
    const [a, b, o] = runPine(`${M22}s = matrix.sum(m, 0.25)\nplot(matrix.get(s, 1, 1))\nt = matrix.sum(m, m)\nplot(matrix.get(t, 0, 1))\nplot(matrix.get(m, 0, 1))`)
    close(a, per((x) => x.c + 0.25))
    close(b, per((x) => 2 * x.h))
    expect(o).toEqual(per((x) => x.h))
  })
  it('a `matrix<int>` plus a whole number', () => {
    const [a] = runPine('m = matrix.new<int>(1, 1, 2)\ns = matrix.sum(m, 3)\nplot(matrix.get(s, 0, 0))')
    expect(a).toEqual(per(() => 5))
  })
  it('⛔ a `matrix<int>` plus a fraction, an `na`, and two sizes stop by name', () => {
    expect(() => runPine('m = matrix.new<int>(1, 1, 2)\ns = matrix.sum(m, 0.5)\nplot(close)')).toThrow(/matrix\.sum of a matrix that may be `matrix<int>`.*W6-M1/)
    expect(() => runPine('m = matrix.new<float>(1, 1, 2.5)\ns = matrix.sum(m, na)\nplot(close)')).toThrow(/`na` scalar.*W6-M1/)
    expect(() => runPine('m = matrix.new<float>(1, 1, 2.5)\nk = matrix.new<float>(2, 1, 2.5)\ns = matrix.sum(m, k)\nplot(close)')).toThrow(/a 1×1 and a 2×1 matrix.*W6-M1/)
    expect(() => runPine('m = matrix.new<float>(1, 1)\ns = matrix.sum(m, 1.5)\nplot(close)')).toThrow(/matrix\.sum over an `na` element.*W6-M1/)
  })
})

describe('⛔ what the lane does not serve is refused by name', () => {
  it('the linear-algebra members and the rest of the family are refused at build (runtime:array, naming the member)', () => {
    for (const m of ['det', 'inv', 'pinv', 'rank', 'transpose', 'eigenvalues', 'reshape', 'median', 'mode', 'sort']) {
      const b = build(`m = matrix.new<float>(2, 2, 1.5)\nplot(matrix.${m}(m))`)
      expect(b.ok).toBe(false)
      expect(b.refusal.guard).toBe('runtime:array')
      expect(b.refusal.message).toContain(`matrix.${m}`)
    }
    const k = build('m = matrix.new<float>(2, 2, 1.5)\nx = matrix.kron(m, m)\nplot(close)')
    expect(k.ok).toBe(false)
    expect(k.refusal.message).toContain('matrix.kron')
  })
  it('the method form refuses by the canonical name', () => {
    const b = build('m = matrix.new<float>(2, 2, 1.5)\nplot(m.det())')
    expect(b.ok).toBe(false)
    expect(b.refusal.guard).toBe('runtime:array')
    expect(b.refusal.message).toContain('`matrix.det`')
  })
  it('an `na` matrix is a named stop, never the VM\'s kind sentence', () => {
    expect(() => runPine('var matrix<float> m = na\nplot(matrix.rows(m))')).toThrow(/`matrix\.rows`: the matrix is `na`/)
  })
  it('a matrix where an array is taken, and an array where a matrix is taken, stop naming both kinds', () => {
    expect(() => runPine('m = matrix.new<float>(1, 1, 1.5)\nplot(array.size(m))')).toThrow(/`array\.size` argument 1 takes an array, got matrix/)
    expect(() => runPine('a = array.from(1.5)\nplot(matrix.rows(a))')).toThrow(/`matrix\.rows` argument 1 takes a matrix, got array/)
  })
  it('`for … in` over a matrix keeps its W6-F1 refusal (runtime:loop), now reached past the creation', () => {
    const b = build('m = matrix.new<float>(2, 2, 0.5)\nfor r in m\n    log.info("x")\nplot(close)')
    expect(b.ok).toBe(false)
    expect(b.refusal.guard).toBe('runtime:loop')
    expect(b.refusal.message).toMatch(/a walk over a matrix is not yet captured \(W6-F1\)/)
  })
})

describe('⭐ the one table: every matrix member is a collection member, classified and door-gated', () => {
  const names = Object.keys(ARRAY_FNS).filter((n) => n.startsWith('matrix.'))
  it('the roster', () => {
    expect(names.sort()).toEqual(['matrix.add_col', 'matrix.add_row', 'matrix.avg', 'matrix.col', 'matrix.columns',
      'matrix.copy', 'matrix.elements_count', 'matrix.fill', 'matrix.get', 'matrix.max', 'matrix.min', 'matrix.new',
      'matrix.remove_col', 'matrix.remove_row', 'matrix.row', 'matrix.rows', 'matrix.set', 'matrix.sum', 'matrix.submatrix'].sort())
  })
  it('each declares what it writes (the v6 `for` bound guard reads it); shape changes are `size`', () => {
    for (const n of names) expect(['none', 'elements', 'size']).toContain(ARRAY_FNS[n].writes)
    for (const n of ['matrix.add_row', 'matrix.add_col', 'matrix.remove_row', 'matrix.remove_col']) expect(ARRAY_FNS[n].writes).toBe('size')
    expect(ARRAY_FNS['matrix.set'].writes).toBe('elements')
  })
  it('a v6 `for` whose bound reads `matrix.rows` and whose body adds a row is refused (the bound can move); in v5 it runs', () => {
    const src = 'm = matrix.new<float>(1, 1, close)\nfor i = 0 to matrix.rows(m) - 1\n    matrix.add_row(m)\n    if matrix.rows(m) > 3\n        break\nplot(matrix.rows(m))'
    const b = build(src)
    expect(b.ok).toBe(false)
    expect(b.refusal.guard).toBe('runtime:loop')
    expect(b.refusal.message).toContain('matrix.add_row')
    // v5 reads the bound once: one pass over a 1-row matrix adds one row
    expect(runPine(src, 5)[0]).toEqual(per(() => 2))
  })
  it('each is gated at the C18 object door (master held none)', () => {
    for (const n of names) expect(DOOR_GATED_ARRAY.has(n)).toBe(true)
  })
  it('kindOf answers `matrix`', () => {
    const m = ARRAY_FNS['matrix.new'].fn([1, 1, 0.5], { peak: () => {}, charge: () => {} }, 'float')
    expect(isMatrix(m)).toBe(true)
    expect(kindOf(m)).toBe('matrix')
    expect(kindOf([])).toBe('array')
  })
})

describe('⭐ a matrix in a run\'s state: encoded by shape and cells, checkpointed as a deep copy with aliasing kept', () => {
  const budget = { peak: () => {}, charge: () => {} }
  const mk = (v) => ARRAY_FNS['matrix.new'].fn([1, 2, v], budget, 'float')
  it('encodeState: equal matrices encode equal, a different cell encodes different, one shared matrix encodes as a reference', () => {
    const a = encodeState([[mk(1.5)]])
    expect(a).not.toBe(null)
    expect(encodeState([[mk(1.5)]])).toEqual(a)
    expect(encodeState([[mk(2.5)]])).not.toEqual(a)
    const m = mk(1.5)
    expect(encodeState([[m, m]])).not.toEqual(encodeState([[mk(1.5), mk(1.5)]]))
  })
  it('cloneValues: a write to the live matrix does not reach the checkpoint; two slots sharing one matrix still share one', () => {
    const m = mk(1.5)
    const [[c1, c2]] = cloneValues([[m, m]])
    expect(isMatrix(c1)).toBe(true)
    expect(c1).toBe(c2)
    m.cells[0][0] = 9
    expect(c1.cells[0][0]).toBe(1.5)
    expect(c1.rows).toBe(1)
    expect(c1.cols).toBe(2)
  })
})

// ⭐ The C7 collector (`objectStore.js::collect`) WITHHOLDS a family when it would reach an
// object held only in a collection (unmeasured), and reaps freely otherwise. A drawing held in
// a matrix cell is held in a collection: `vm.js::heldNow` walks matrix cells for it.
describe('⭐ a drawing held in a matrix cell counts as held in a collection (the C7 collector withholds)', () => {
  const NB = 300
  const BB = Array.from({ length: NB }, (_, i) => { const c = 100 + i * 0.05; return { t: 1700000000 + i * 86400, o: c - 0.5, h: c + 1, l: c - 1, c, v: 1000 } })
  const SB = ['o', 'h', 'l', 'c', 'v'].map((k) => Float64Array.from(BB.map((b) => b[k])))
  const finOf = (hold) => {
    const src = '//@version=6\nindicator("t", overlay = true, max_labels_count = 5)\n' + hold
      + 'if bar_index % 10 == 0 and bar_index > 0\n    label.new(bar_index, close, str.tostring(bar_index))\n'
    const b = buildRuntimeIr(src, { bars: BB, inputs: {}, objectsInRun: true, tf: 'D', basePeriod: 'D' })
    if (!b.ok) throw new Error(`refused: ${b.refusal.guard} — ${b.refusal.message}`)
    const p = lowerIrProgram(b.ir)
    return execute(p, { bars: NB, series: SB, columns: p.columns, confirmed: true, barTimes: BB.map((x) => x.t) }).objects.finish()
  }
  it('held in a matrix: the label family is withheld by name', () => {
    const fin = finOf('var m = matrix.new<label>(1, 1, na)\nif bar_index == 0\n    matrix.set(m, 0, 0, label.new(bar_index, close, "held"))\n')
    expect(fin.withheld.label).toMatch(/held in an array or a user type/)
  })
  it('CONTROL: the same matrix holding no label leaves the collector free', () => {
    const fin = finOf('var m = matrix.new<label>(1, 1, na)\nif bar_index == 0\n    label.new(bar_index, close, "free")\n')
    expect(fin.withheld.label).toBeUndefined()
  })
})

// ⛔ review N1 — the DEGENERATE shapes no reference sentence pins: whether Pine errors on them,
// or counts a 0×k / k×0 matrix as "empty", is W6-M1 (rows D01-D04 of the probe).
describe('⛔ zero-length lines and empty submatrices stop by name (W6-M1, review N1)', () => {
  it('add_row of a zero-length row into a k×0 matrix (default and an empty array)', () => {
    expect(() => runPine('m = matrix.new<float>(2, 0)\nmatrix.add_row(m)\nplot(close)')).toThrow(/matrix\.add_row of a zero-length row into a matrix of 2×0.*W6-M1/)
    expect(() => runPine('m = matrix.new<float>(2, 0)\nmatrix.add_row(m, 0, array.new_float(0))\nplot(close)')).toThrow(/matrix\.add_row of a zero-length row.*W6-M1/)
  })
  it('add_col of a zero-length column into a 0×k matrix (default and an empty array)', () => {
    expect(() => runPine('m = matrix.new<float>(0, 3)\nmatrix.add_col(m)\nplot(close)')).toThrow(/matrix\.add_col of a zero-length column into a matrix of 0×3.*W6-M1/)
    expect(() => runPine('m = matrix.new<float>(0, 3)\nmatrix.add_col(m, 0, array.new_float(0))\nplot(close)')).toThrow(/matrix\.add_col of a zero-length column.*W6-M1/)
  })
  it('submatrix of an empty row range and of an empty column range', () => {
    expect(() => runPine(`${M22}s = matrix.submatrix(m, 1, 1)\nplot(close)`)).toThrow(/matrix\.submatrix of an empty range.*W6-M1/)
    expect(() => runPine(`${M22}s = matrix.submatrix(m, 0, 2, 1, 1)\nplot(close)`)).toThrow(/matrix\.submatrix of an empty range.*W6-M1/)
  })
  it('CONTROL: a one-row submatrix and a non-empty line are still served', () => {
    const [r] = runPine(`${M22}s = matrix.submatrix(m, 1, 2, 1, 2)\nplot(matrix.get(s, 0, 0))`)
    expect(r).toEqual(per((b) => b.c))
    const [c] = runPine('m = matrix.new<float>(0, 2)\nmatrix.add_row(m, 0, array.from(close, open))\nplot(matrix.rows(m))')
    expect(c).toEqual(per(() => 1))
  })
})
