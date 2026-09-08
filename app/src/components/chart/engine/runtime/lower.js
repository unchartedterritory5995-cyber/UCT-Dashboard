// app/src/components/chart/engine/runtime/lower.js
//
// ─── CANONICAL TREE → EXECUTABLE PROGRAM ────────────────────────────────────
//
// The first lowering. It takes a tree the columnar lane already understands and
// produces a program the bar loop runs — which is precisely what makes the
// graph-vs-runtime differential rail possible: ONE input, TWO lanes, one answer.
//
// ⭐⭐ THE HYBRID SEAM, MADE CONCRETE. Any node the runtime does not have its own
// opcode for — every `call`, `tf`, `sym`, `tf_live`, and any `series` that names
// an input or a clock scalar rather than a price — is handed to `interpret.js`,
// evaluated ONCE into a column, and read per bar through `READ_COLUMN`. So all 70
// closed-table builtins keep their warm-ups, recurrences, rounding conventions
// and vendor-pinned initialisations, and the runtime never mints a second
// implementation of settled arithmetic. That is Phase 1's `%` lesson promoted
// from a three-line fix to the shape of the compiler.
//
// ⚠️ WHAT THIS IS NOT. It is not the Pine front end (§3) — it consumes the
// CANONICAL tree, which has already lost statements, and cannot invent them. It
// exists so the runtime has something real to execute and something honest to be
// differentially tested against while the front end is built. When the semantic
// IR lands, this becomes one of its lowering targets rather than the only door.

import { interpret } from '../ast/interpret.js'
import { OP, SERIES_NAMES, makeProgram } from './program.js'

const OP_FOR = Object.freeze({
  '+': OP.ADD, '-': OP.SUB, '*': OP.MUL, '/': OP.DIV,
  '<': OP.LT, '>': OP.GT, '<=': OP.LE, '>=': OP.GE,
  '==': OP.EQ, '!=': OP.NE,
  '&&': OP.AND, '||': OP.OR,
  '!': OP.NOT, 'u-': OP.NEG,
  '?:': OP.SELECT,
})

export class LoweringError extends Error {
  constructor(message) { super(message); this.name = 'LoweringError' }
}

/**
 * Lower one canonical tree into a single-output program.
 *
 * @param {object} ast     canonical tree (num/series/op/call/offset/tf/sym/tf_live)
 * @param {Array}  bars    the bar array the columns are evaluated against
 * @param {object} inputs  member inputs, passed through to `interpret`
 * @param {object} opts    passed through to `interpret` (tf, symbols, scalars…)
 */
export function lowerTree(ast, bars, inputs, opts) {
  const code = []
  const consts = []
  const columns = []
  const columnKey = new Map()

  const constIndex = (v) => {
    const i = consts.indexOf(v)
    if (i >= 0) return i
    consts.push(v)
    return consts.length - 1
  }

  /** Evaluate a subtree through the COLUMNAR lane and keep it as a column.
   *  ⭐ Memoised on the node OBJECT, so a shared subtree from an expanded V2
   *  graph is evaluated once — the same identity trick `interpret`'s `crossMemo`
   *  uses, and the reason the ×48 compaction keeps paying inside the runtime. */
  const columnIndex = (node) => {
    if (columnKey.has(node)) return columnKey.get(node)
    let col
    try {
      col = interpret(node, bars, inputs || {}, undefined, undefined, opts)
    } catch (e) {
      // ⛔ A REFUSAL FROM THE COLUMNAR LANE IS NOT A LOWERING BUG. It is the
      // table declining what the member wrote, and it must reach the caller
      // wearing its own name rather than being re-dressed as a compiler failure
      // (§45 keeps the failure classes layered).
      throw e
    }
    // ⚰️⚰️ `interpret` RETURNS A SCALAR FOR A TREE THAT READS NO BAR — a member
    // input, a per-symbol constant, `max(8, 42)`. The first draft did
    // `Float64Array.from(col)`, and `Float64Array.from(2.5)` is an EMPTY ARRAY:
    // every read then answered `undefined`, which the dispatch loop turned into
    // NaN on every bar of every column. The differential rail caught it on its
    // first run — `close * len` came back all-NaN against a columnar lane that
    // had the right numbers — and it is precisely
    // `lesson_a_saturated_instrument_reports_zero`: a broken reader that answers
    // "not computable" is indistinguishable from an honest one.
    //
    // ⛔ SO A SCALAR IS BROADCAST, and a length that still disagrees is a NAMED
    // error rather than a column of quiet NaN. The check is the important half:
    // broadcasting alone would have fixed this symptom and left the next
    // wrong-length column silent.
    let arr
    if (typeof col === 'number') {
      arr = new Float64Array(bars.length).fill(col)
    } else if (col instanceof Float64Array) {
      arr = col
    } else if (col && typeof col.length === 'number') {
      arr = Float64Array.from(col)
    } else {
      throw new LoweringError(
        `the columnar lane answered ${typeof col} for a subtree; a column must be a `
        + 'number to broadcast or an indexable series')
    }
    if (arr.length !== bars.length) {
      throw new LoweringError(
        `a lowered column holds ${arr.length} values for ${bars.length} bars — `
        + 'a column that is short reads as `na` on every missing bar and would be invisible')
    }
    columns.push(arr)
    const i = columns.length - 1
    columnKey.set(node, i)
    return i
  }

  const emit = (op, a = 0, b = 0) => { code.push(op, a, b) }

  const walk = (n) => {
    if (!n || typeof n !== 'object') throw new LoweringError(`not a node: ${JSON.stringify(n)}`)
    switch (n.type) {
      case 'num':
        emit(OP.CONST, constIndex(n.value))
        return
      case 'series': {
        const i = SERIES_NAMES.indexOf(n.name)
        if (i >= 0) { emit(OP.READ_SERIES, i); return }
        // An input, a clock scalar, or any other name the scope supplies: the
        // columnar lane resolves it and the runtime reads the result.
        emit(OP.READ_COLUMN, columnIndex(n))
        return
      }
      case 'op': {
        const op = OP_FOR[n.name]
        if (op === undefined) {
          throw new LoweringError(
            `no opcode for operator ${JSON.stringify(n.name)} — this lowering handles `
            + Object.keys(OP_FOR).join(' '))
        }
        for (const child of n.args) walk(child)
        emit(op)
        return
      }
      case 'offset': {
        // ⛔ THE CHILD BECOMES A COLUMN, ALWAYS — matching `interpret`'s own rule
        // that an offset materialises its child first. "Three bars ago" has to
        // mean the same thing for a price, a scalar and a call, and the only way
        // to guarantee that is to shift ONE representation.
        const back = n.value
        if (!Number.isInteger(back) || back < 0) {
          throw new LoweringError(`an offset counts backwards in whole bars; got ${JSON.stringify(back)}`)
        }
        if (n.args.length !== 1) {
          throw new LoweringError(`an offset reads exactly one child, got ${n.args.length}`)
        }
        emit(OP.READ_HIST, columnIndex(n.args[0]), back)
        return
      }
      case 'call':
      case 'tf':
      case 'tf_live':
      case 'sym':
        emit(OP.READ_COLUMN, columnIndex(n))
        return
      default:
        throw new LoweringError(`unknown canonical node type ${JSON.stringify(n.type)}`)
    }
  }

  walk(ast)
  emit(OP.EMIT, 0)
  emit(OP.HALT)

  return makeProgram({ code, consts, columns, outputs: ['value'] })
}

/** The context a lowered program needs, built from the same bars. Kept here so
 *  a caller cannot accidentally pair a program with columns from another run —
 *  the columns are part of the lowering, not of the bars. */
export function contextForProgram(program, bars) {
  const n = bars.length
  const cols = SERIES_NAMES.map((name) => {
    const a = new Float64Array(n)
    for (let i = 0; i < n; i += 1) {
      const v = bars[i] ? bars[i][name === 'open' ? 'o' : name === 'high' ? 'h'
        : name === 'low' ? 'l' : name === 'close' ? 'c' : 'v'] : NaN
      a[i] = typeof v === 'number' ? v : NaN
    }
    return a
  })
  return { bars: n, series: cols, columns: program.columns, confirmed: true }
}
