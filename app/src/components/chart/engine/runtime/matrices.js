// app/src/components/chart/engine/runtime/matrices.js
//
// ─── W6-T7 — `matrix.*`, A SIBLING OF `collections.js` ──────────────────────
//
// ⛔⛔ ONE DISPATCH TABLE. These members are not a second table: `collections.js`
// spreads `buildMatrixFns(…)` into `ARRAY_FNS`, so the VM reaches a matrix member
// through the same `OP.ARRAY` op, the same operand-kind check and the same front-end
// admitter (`admitArrayCall`) as an `array.*` member. This module imports nothing
// from `collections.js` (it is handed `CollectionError` and `isUnfilled`), so the two
// cannot form an import cycle.
//
// ⛔⛔ A MATRIX IS A REFERENCE, like an array: `m2 = m` names the same matrix, and
// only `matrix.copy` (or `submatrix`) makes a second one. `matrix.row` / `matrix.col`
// hand back NEW arrays (the reference: "creates a one-dimensional array from the
// elements"), so a write to one never reaches the matrix.
//
// ⭐ SERVED ONLY WHERE THE PINE v6 REFERENCE STATES THE RULE (read 2026-11-06 through
// `tools/pine_survey/pine_reference_extract.js`; the JSON stays out of the repo; each
// rail in `runtime/__tests__/w6Matrix.test.js` quotes the sentence it rests on).
// What the entry does NOT state stops the run BY NAME (`W6-M1`, a row in
// `docs/pine/capture-queue-2026-11-06-w6.md`, probe `vw-w6-matrix-members.pine`):
//   · `matrix.new` with an `na` row or column count, a negative or fractional one;
//     a sized matrix of a type other than float/int with no initial value;
//   · an index outside the matrix, or a negative one (the entries say only that
//     indexing starts at zero) — Pine stops there, and so does this, never `na`;
//   · `add_row` / `add_col` with an array of the wrong length, the default `na` row on
//     an empty matrix, and removing the last row or column (what `columns` /
//     `rows` reads after it);
//   · (review N1) a zero-length row or column added (`add_row` on a k×0 matrix, `add_col` on
//     a 0×k one) and an empty-range `submatrix` (a 0×k or k×0 result);
//   · (HONESTY-SWEEP item 3, 2026-11-07) their twins: a zero-length `row` read out of a k×0
//     matrix, a zero-length `col` out of a 0×k one, and a `fill` of an empty area;
//   · `remove_row` / `remove_col` with the index omitted (the entry's default,
//     `matrix.rows()`, is past the last row);
//   · `min` / `max` / `avg` over an `na` cell or an empty matrix; `avg` of a
//     `matrix<int>` whose mean is fractional (the `series int` form does not say how
//     the fraction becomes an int);
//   · `sum` over an `na` cell or `na` scalar, of two matrices of different sizes, and
//     a `matrix<int>` plus a fractional scalar (the `matrix<int>` result).
// ⛔ The linear-algebra members (`det`, `inv`, `mult`, `eigen…`, `pinv`, `rank`,
// `kron`, …) and the rest of the family are NOT in the table, so the front end refuses
// them `runtime:array` at build. No sample script reaches them.

const MATRIX_TAG = Symbol.for('uct.pine.matrix')

/** Is this runtime value a matrix? The test is a Symbol, never the shape. */
export const isMatrix = (v) => !!(v && typeof v === 'object' && v[MATRIX_TAG] === true)

/** `{rows, cols, cells, elem}` — `cells` one array per row; `cols` is kept apart so a
 *  matrix with no rows still knows its column count. `elem` is the `<type>` it was
 *  created with (`'float'`, `'int'`, a user type…), or null. */
const makeMatrix = (rows, cols, cells, elem) => ({ [MATRIX_TAG]: true, rows, cols, cells, elem: elem || null })

/** For `vmState.js` (encode / checkpoint): build a matrix from its parts. */
export const matrixFromParts = (rows, cols, cells, elem) => makeMatrix(rows, cols, cells, elem)

/** The type words whose default element the reference states and this lane holds:
 *  `initial_value` "The default is 'na'", and `na` is a value of `float` / `int`. */
const NA_FILLED = new Set(['float', 'int'])

export const W6M1 = 'the Pine v6 reference does not state it, so the run stops here rather than '
  + 'serving a guessed convention (W6-M1)'

/**
 * The `matrix.*` members, built against `collections.js`'s error class and its
 * unfilled-element test (handed in, so this module imports nothing from it).
 * @param {{CollectionError: Function, isUnfilled: Function}} deps
 */
export function buildMatrixFns({ CollectionError, isUnfilled }) {
  const unpinned = (what) => new CollectionError(`${what} — ${W6M1}`)
  const isNa = (v) => typeof v === 'number' && Number.isNaN(v)

  /** A row or column count: a whole number ≥ 0. `na` is a W6-M1 question (a corpus
   *  script writes `matrix.new<float>(na, n, na)`). */
  const countArg = (v, what, which) => {
    if (isNa(v)) throw unpinned(`${what} with an \`na\` ${which} count`)
    if (!Number.isInteger(v) || v < 0) throw unpinned(`${what} with ${which} count ${v}`)
    return v
  }
  /** An index into `[0, n)`. ⛔ Outside it (a negative index included) the run STOPS
   *  by name: the entries say only "Indexing … starts at zero". */
  const indexArg = (v, n, what, which) => {
    if (!Number.isInteger(v) || v < 0 || v >= n) {
      throw unpinned(`${what}: ${which} index ${v} is outside a matrix with ${n} ${which}${n === 1 ? '' : 's'} `
        + '(Pine stops the script on an index outside the matrix, never answering na)')
    }
    return v
  }
  /** A `[from, to)` range; `to` exclusive, defaults stated by the entries. */
  const rangeArg = (a, i, n, what, which) => {
    const from = a.length > i ? a[i] : 0
    const to = a.length > i + 1 ? a[i + 1] : n
    if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || to > n || from > to) {
      throw unpinned(`${what}: the ${which} range [${from}, ${to}) over a matrix with ${n} ${which}s`)
    }
    return [from, to]
  }
  /** Every cell a real number: a non-number is not reduced; an `na` cell is W6-M1. */
  const realCells = (m, what) => {
    const xs = []
    for (const row of m.cells) {
      for (const v of row) {
        if (typeof v !== 'number') throw new CollectionError(`${what} over a non-numeric element — this runtime reduces numbers only`)
        if (Number.isNaN(v)) throw unpinned(`${what} over an \`na\` element`)
        xs.push(v)
      }
    }
    return xs
  }
  /** ⛔ An array handed in whole (`add_row(m, i, arr)`) whose fill has never been
   *  measured (`collections.js::UNFILLED`) would let `matrix.get` hand the marker back. */
  const cellsFrom = (arr, what) => {
    if (arr.some(isUnfilled)) {
      throw new CollectionError(`${what}: the array holds an element whose fill value has not been measured`)
    }
    return arr.slice()
  }
  /** The `na` row / column the entries insert by default — a value only a numeric matrix holds. */
  const naLine = (m, n, what) => {
    if (!NA_FILLED.has(m.elem)) throw unpinned(`${what} with no array on a \`matrix<${m.elem || '?'}>\` (an \`na\` element of that type)`)
    return new Array(n).fill(NaN)
  }
  /** Is this matrix provably float? Its `<type>` says so, or it holds a fraction. */
  const provablyFloat = (m, xs) => m.elem === 'float' || xs.some((v) => !Number.isInteger(v))

  const MATRIX_FNS = {
    // "matrix.new<type>(rows, columns, initial_value)": rows / columns "Optional. The
    // default value is 0"; initial_value "Optional. The default is 'na'".
    'matrix.new': {
      args: ['number', 'number', 'any'], returns: 'matrix', generic: true, minArgs: 0, maxArgs: 3,
      fn: (a, budget, typeArg) => {
        const rows = a.length > 0 ? countArg(a[0], 'matrix.new', 'row') : 0
        const cols = a.length > 1 ? countArg(a[1], 'matrix.new', 'column') : 0
        budget.peak('ARRAY_ELEMENTS', rows * cols)
        let init
        if (a.length > 2) init = a[2]
        else if (rows * cols === 0) init = NaN // no element exists to hold the default
        else if (NA_FILLED.has(typeArg)) init = NaN
        else throw unpinned(`matrix.new<${typeArg || '?'}>(${rows}, ${cols}) with no initial value (an \`na\` element of that type)`)
        const cells = []
        for (let r = 0; r < rows; r += 1) cells.push(new Array(cols).fill(init))
        return makeMatrix(rows, cols, cells, typeArg)
      },
    },
    'matrix.rows': { args: ['matrix'], returns: 'number', fn: (a) => a[0].rows },
    'matrix.columns': { args: ['matrix'], returns: 'number', fn: (a) => a[0].cols },
    'matrix.elements_count': { args: ['matrix'], returns: 'number', fn: (a) => a[0].rows * a[0].cols },
    'matrix.get': {
      args: ['matrix', 'number', 'number'], returns: 'any',
      fn: (a) => {
        const m = a[0]
        return m.cells[indexArg(a[1], m.rows, 'matrix.get', 'row')][indexArg(a[2], m.cols, 'matrix.get', 'column')]
      },
    },
    'matrix.set': {
      args: ['matrix', 'number', 'number', 'any'], returns: 'void',
      fn: (a, budget) => {
        const m = a[0]
        budget.charge('ARRAY_OPERATIONS', 1)
        m.cells[indexArg(a[1], m.rows, 'matrix.set', 'row')][indexArg(a[2], m.cols, 'matrix.set', 'column')] = a[3]
      },
    },
    // "creates a one-dimensional array from the elements of a matrix row": a NEW array
    'matrix.row': {
      args: ['matrix', 'number'], returns: 'array',
      fn: (a, budget) => {
        const m = a[0]
        budget.peak('ARRAY_ELEMENTS', m.cols)
        const r = indexArg(a[1], m.rows, 'matrix.row', 'row')
        // ⛔ HONESTY-SWEEP item 3 — a ZERO-LENGTH row read out of a k×0 matrix, the read twin
        // of review N1's zero-length `add_row` (W6-M1 row D05).
        if (m.cols === 0) throw unpinned(`matrix.row of a zero-length row out of a matrix of ${m.rows}×${m.cols}`)
        return m.cells[r].slice()
      },
    },
    'matrix.col': {
      args: ['matrix', 'number'], returns: 'array',
      fn: (a, budget) => {
        const m = a[0]
        const c = indexArg(a[1], m.cols, 'matrix.col', 'column')
        // ⛔ HONESTY-SWEEP item 3 — a ZERO-LENGTH column out of a 0×k matrix (W6-M1 row D06).
        if (m.rows === 0) throw unpinned(`matrix.col of a zero-length column out of a matrix of ${m.rows}×${m.cols}`)
        budget.peak('ARRAY_ELEMENTS', m.rows)
        return m.cells.map((row) => row[c])
      },
    },
    // "Inserts a new row at the `row` index": `row` "Must be a value from 0 to
    // `matrix.rows(id)`… The default is `matrix.rows(id)`"; `array_id` "If the matrix is
    // empty, the array can be of any size. Otherwise, its size must equal
    // `matrix.columns(id)`. By default, the function inserts a row of na values."
    'matrix.add_row': {
      args: ['matrix', 'number', 'array'], returns: 'void', minArgs: 1, maxArgs: 3,
      fn: (a, budget) => {
        const m = a[0]
        const at = a.length > 1 ? a[1] : m.rows
        if (!Number.isInteger(at) || at < 0 || at > m.rows) {
          throw unpinned(`matrix.add_row: row index ${at} outside 0 to ${m.rows} (Pine stops the script here)`)
        }
        const empty = m.rows === 0 && m.cols === 0
        let line
        if (a.length > 2) {
          const arr = a[2]
          if (empty ? arr.length === 0 : arr.length !== m.cols) {
            throw unpinned(`matrix.add_row: an array of ${arr.length} into a matrix of ${m.rows}×${m.cols} `
              + '(the size must equal `matrix.columns`; what Pine does otherwise)')
          }
          line = cellsFrom(arr, 'matrix.add_row')
        } else {
          if (empty) throw unpinned('matrix.add_row with no array on an empty matrix (how many `na` values)')
          line = naLine(m, m.cols, 'matrix.add_row')
        }
        // ⛔ review N1 — a ZERO-LENGTH row (on a k×0 matrix): whether Pine errors, or counts a
        // k×0 matrix as "empty", is not stated (W6-M1)
        if (line.length === 0) throw unpinned(`matrix.add_row of a zero-length row into a matrix of ${m.rows}×${m.cols}`)
        budget.charge('ARRAY_OPERATIONS', 1)
        budget.peak('ARRAY_ELEMENTS', (m.rows + 1) * line.length)
        m.cells.splice(at, 0, line)
        m.rows += 1
        m.cols = line.length
      },
    },
    'matrix.add_col': {
      args: ['matrix', 'number', 'array'], returns: 'void', minArgs: 1, maxArgs: 3,
      fn: (a, budget) => {
        const m = a[0]
        const at = a.length > 1 ? a[1] : m.cols
        if (!Number.isInteger(at) || at < 0 || at > m.cols) {
          throw unpinned(`matrix.add_col: column index ${at} outside 0 to ${m.cols} (Pine stops the script here)`)
        }
        const empty = m.rows === 0 && m.cols === 0
        let line
        if (a.length > 2) {
          const arr = a[2]
          if (empty ? arr.length === 0 : arr.length !== m.rows) {
            throw unpinned(`matrix.add_col: an array of ${arr.length} into a matrix of ${m.rows}×${m.cols} `
              + '(the size must equal `matrix.rows`; what Pine does otherwise)')
          }
          line = cellsFrom(arr, 'matrix.add_col')
        } else {
          if (empty) throw unpinned('matrix.add_col with no array on an empty matrix (how many `na` values)')
          line = naLine(m, m.rows, 'matrix.add_col')
        }
        // ⛔ review N1 — a ZERO-LENGTH column (on a 0×k matrix), as `add_row` (W6-M1)
        if (line.length === 0) throw unpinned(`matrix.add_col of a zero-length column into a matrix of ${m.rows}×${m.cols}`)
        budget.charge('ARRAY_OPERATIONS', line.length)
        budget.peak('ARRAY_ELEMENTS', line.length * (m.cols + 1))
        if (empty) {
          for (const v of line) m.cells.push([v])
          m.rows = line.length
        } else {
          for (let r = 0; r < m.rows; r += 1) m.cells[r].splice(at, 0, line[r])
        }
        m.cols += 1
      },
    },
    // "removes the row at `row` index … and returns an array containing the removed
    // row's values". ⛔ The entry's default index, `matrix.rows()`, is past the last
    // row, so an omitted index stops (W6-M1); so does removing the LAST row (what
    // `matrix.columns` reads afterwards is unstated).
    'matrix.remove_row': {
      args: ['matrix', 'number'], returns: 'array', minArgs: 1, maxArgs: 2,
      fn: (a, budget) => {
        const m = a[0]
        if (a.length < 2) throw unpinned('matrix.remove_row with the row omitted (its stated default, `matrix.rows()`, is past the last row)')
        const r = indexArg(a[1], m.rows, 'matrix.remove_row', 'row')
        if (m.rows === 1) throw unpinned('matrix.remove_row of the last row (what `matrix.columns` reads after it)')
        budget.charge('ARRAY_OPERATIONS', 1)
        m.rows -= 1
        return m.cells.splice(r, 1)[0]
      },
    },
    'matrix.remove_col': {
      args: ['matrix', 'number'], returns: 'array', minArgs: 1, maxArgs: 2,
      fn: (a, budget) => {
        const m = a[0]
        if (a.length < 2) throw unpinned('matrix.remove_col with the column omitted (its stated default, `matrix.columns()`, is past the last column)')
        const c = indexArg(a[1], m.cols, 'matrix.remove_col', 'column')
        if (m.cols === 1) throw unpinned('matrix.remove_col of the last column (what `matrix.rows` reads after it)')
        budget.charge('ARRAY_OPERATIONS', Math.max(1, m.rows))
        m.cols -= 1
        return m.cells.map((row) => row.splice(c, 1)[0])
      },
    },
    // "fills a rectangular area … `from_column` to `to_column` (not including it) and
    // `from_row` to `to_row` (not including it)"; defaults 0 and `matrix.rows()` /
    // `matrix.columns()`. ⛔ A range past the matrix, reversed, or `na` stops (W6-M1).
    'matrix.fill': {
      args: ['matrix', 'any', 'number', 'number', 'number', 'number'], returns: 'void', minArgs: 2, maxArgs: 6,
      fn: (a, budget) => {
        const m = a[0]
        const [r0, r1] = rangeArg(a, 2, m.rows, 'matrix.fill', 'row')
        const [c0, c1] = rangeArg(a, 4, m.cols, 'matrix.fill', 'column')
        // ⛔ HONESTY-SWEEP item 3 — an EMPTY area (a range `from == to`, or a 0×k / k×0 matrix
        // filled whole), the twin of review N1's empty-range `submatrix` (W6-M1 row D07).
        if (r0 === r1 || c0 === c1) {
          throw unpinned(`matrix.fill of an empty area (rows [${r0}, ${r1}), columns [${c0}, ${c1}))`)
        }
        budget.charge('ARRAY_OPERATIONS', Math.max(1, (r1 - r0) * (c1 - c0)))
        for (let r = r0; r < r1; r += 1) for (let c = c0; c < c1; c += 1) m.cells[r][c] = a[1]
      },
    },
    // "extracts a submatrix … `from_row` (inclusive) … `to_row` (non inclusive)", a NEW matrix
    'matrix.submatrix': {
      args: ['matrix', 'number', 'number', 'number', 'number'], returns: 'matrix', minArgs: 1, maxArgs: 5,
      fn: (a, budget) => {
        const m = a[0]
        const [r0, r1] = rangeArg(a, 1, m.rows, 'matrix.submatrix', 'row')
        const [c0, c1] = rangeArg(a, 3, m.cols, 'matrix.submatrix', 'column')
        // ⛔ review N1 — an EMPTY range (from == to) would give a 0×k or k×0 matrix, a shape no
        // sentence pins (W6-M1)
        if (r0 === r1 || c0 === c1) {
          throw unpinned(`matrix.submatrix of an empty range (rows [${r0}, ${r1}), columns [${c0}, ${c1}))`)
        }
        budget.peak('ARRAY_ELEMENTS', (r1 - r0) * (c1 - c0))
        const cells = []
        for (let r = r0; r < r1; r += 1) cells.push(m.cells[r].slice(c0, c1))
        return makeMatrix(r1 - r0, c1 - c0, cells, m.elem)
      },
    },
    // "creates a new matrix which is a copy of the original"
    'matrix.copy': {
      args: ['matrix'], returns: 'matrix',
      fn: (a, budget) => {
        const m = a[0]
        budget.peak('ARRAY_ELEMENTS', m.rows * m.cols)
        return makeMatrix(m.rows, m.cols, m.cells.map((row) => row.slice()), m.elem)
      },
    },
    // "returns the smallest value from the matrix elements"
    'matrix.min': {
      args: ['matrix'], returns: 'number',
      fn: (a, budget) => {
        const xs = realCells(a[0], 'matrix.min')
        if (!xs.length) throw unpinned('matrix.min of an empty matrix')
        budget.charge('ARRAY_OPERATIONS', xs.length)
        return xs.reduce((lo, v) => (v < lo ? v : lo), Infinity)
      },
    },
    'matrix.max': {
      args: ['matrix'], returns: 'number',
      fn: (a, budget) => {
        const xs = realCells(a[0], 'matrix.max')
        if (!xs.length) throw unpinned('matrix.max of an empty matrix')
        budget.charge('ARRAY_OPERATIONS', xs.length)
        return xs.reduce((hi, v) => (v > hi ? v : hi), -Infinity)
      },
    },
    // "calculates the average of all elements in the matrix". ⛔ The `matrix<int>` form
    // returns `series int`, and the entry does not say how a fractional mean becomes an
    // int: served when the matrix is provably float, or the mean is whole (every
    // conversion maps a whole number to itself); otherwise W6-M1.
    'matrix.avg': {
      args: ['matrix'], returns: 'number',
      fn: (a, budget) => {
        const m = a[0]
        const xs = realCells(m, 'matrix.avg')
        if (!xs.length) throw unpinned('matrix.avg of an empty matrix')
        budget.charge('ARRAY_OPERATIONS', xs.length)
        const mean = xs.reduce((s, v) => s + v, 0) / xs.length
        if (!provablyFloat(m, xs) && !Number.isInteger(mean)) {
          throw unpinned(`matrix.avg of a matrix that may be \`matrix<int>\` with a fractional mean (${mean}): the \`series int\` form does not say how it becomes an int`)
        }
        return mean
      },
    },
    // "returns a new matrix resulting from the sum of two matrices `id1` and `id2`, or of
    // an `id1` matrix and an `id2` scalar". ⛔ Of two matrices of different sizes, over
    // `na`, and a possibly-int matrix plus a fraction (its `matrix<int>` form): W6-M1.
    'matrix.sum': {
      args: ['matrix', 'any'], returns: 'matrix',
      fn: (a, budget) => {
        const m = a[0]
        const b = a[1]
        const xs = realCells(m, 'matrix.sum')
        budget.charge('ARRAY_OPERATIONS', Math.max(1, xs.length))
        budget.peak('ARRAY_ELEMENTS', m.rows * m.cols)
        if (isMatrix(b)) {
          if (b.rows !== m.rows || b.cols !== m.cols) {
            throw unpinned(`matrix.sum of a ${m.rows}×${m.cols} and a ${b.rows}×${b.cols} matrix`)
          }
          const ys = realCells(b, 'matrix.sum')
          const elem = m.elem === b.elem ? m.elem : (provablyFloat(m, xs) || provablyFloat(b, ys) ? 'float' : null)
          return makeMatrix(m.rows, m.cols, m.cells.map((row, r) => row.map((v, c) => v + b.cells[r][c])), elem)
        }
        if (typeof b !== 'number') throw new CollectionError('matrix.sum takes a matrix or a number as its second argument')
        if (Number.isNaN(b)) throw unpinned('matrix.sum with an `na` scalar')
        if (!Number.isInteger(b) && !provablyFloat(m, xs)) {
          throw unpinned(`matrix.sum of a matrix that may be \`matrix<int>\` and the fraction ${b} (its \`matrix<int>\` result)`)
        }
        return makeMatrix(m.rows, m.cols, m.cells.map((row) => row.map((v) => v + b)), m.elem)
      },
    },
  }
  return MATRIX_FNS
}

/** What each member writes (`collections.js::ARRAY_WRITES`, read by the v6 `for`
 *  bound guard): `size` the shape can change, `elements` values only, `none` reads. */
export const MATRIX_WRITES = Object.freeze({
  'matrix.new': 'none', 'matrix.rows': 'none', 'matrix.columns': 'none', 'matrix.elements_count': 'none',
  'matrix.get': 'none', 'matrix.row': 'none', 'matrix.col': 'none', 'matrix.submatrix': 'none',
  'matrix.copy': 'none', 'matrix.min': 'none', 'matrix.max': 'none', 'matrix.avg': 'none', 'matrix.sum': 'none',
  'matrix.set': 'elements', 'matrix.fill': 'elements',
  'matrix.add_row': 'size', 'matrix.add_col': 'size', 'matrix.remove_row': 'size', 'matrix.remove_col': 'size',
})
