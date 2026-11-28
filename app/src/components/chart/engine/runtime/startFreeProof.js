// app/src/components/chart/engine/runtime/startFreeProof.js
//
// ─── ⭐⭐ E104 (2026-11-28, DEEPVUE) — A STATIC START-FREE PROOF, READ OFF THE PROGRAM ────────────────────────────────
//
// A runtime document is stamped `runtimeHistory: 'listing'` (R-W): its run starts at TradingView's bar 0. On a chart
// whose history does not reach the listing it is refused (`runtime:history-start`), because the off-listing curtain
// (two starts agreeing, e102) released wrong values and is OFF. That refuses nearly every intraday chart.
//
// THIS DECIDES IT BY READING THE PROGRAM, NEVER BY COMPARING RUNS. A program is START-FREE WITH REACH R when its value
// on bar i is a function of rows[i-R .. i] only. Off the listing, bars R.. are then exactly what a run from ANY earlier
// first bar computes, and bars before R are withheld by name. It is `computeStartFree`'s shape (Fred RS, by hash),
// generalised to a property of the lowered IR.
//
// ⛔⛔ FAIL CLOSED. Anything this walker does not know is NOT start-free and the refusal stands:
//   1. no persistent slot (`var` / `varip`), and no history read whose recursion does not settle (`x := x[1] + …`);
//   2. no carried built-in (`ta.ema`, `ta.rma`, `ta.rsi`, `ta.cum`, …: each remembers its whole history), no user
//      function (its frame may hold a `var`), no loop, no array / record / drawing / request / broker;
//   3. every window is a FINITE window (`interpret.js::FINITE_WINDOW`) of a literal length; a window that reaches past
//      `na` holes (every policy but `PROPAGATE`) only over a source that is never `na` once its own reach is met;
//   4. no read of where the chart starts: only OHLCV, the bar's own clock and session, and literal numbers are leaves
//      (`bar_index`, `barstate.isfirst`, `ta.barssince` and the rest are not leaves this walker admits);
//   5. no window or history read inside a branch (an `if` body or a `?:` arm): Pine runs those only when the branch
//      does, so their state counts the branch's runs since the listing;
//   6. no condition (an `if` test, a `?:` test, an operand of `and` / `or` / `not`) that can be `na` once its reach is
//      met: on the listing an `na` condition reads as Pine reads it, off it the shared {0,1,NaN} rules stand
//      (`lowerIr.js`), so only a condition that is never `na` reads one way in both runs.
// The census (`__tests__/vendorHarness/curtainCensus.*.measure.test.js`) is the measurement: wrong == 0 on every bar
// released, on every series, for every script this calls start-free.

import { STMT, EXPR, SLOT, COLUMN_TREES } from './ir.js'
import { SERIES_NAMES } from './program.js'
import { FINITE_WINDOW } from '../ast/interpret.js'

// `interpret.js::PROPAGATE`: a clean n-bar window (any `na` inside it answers `na`); every other policy reaches past holes
const PROPAGATE = 'propagate'

/** The ceiling a reach may grow to before the walker calls it unbounded (a recursion through history that never
 *  settles grows without end; a real script's windows are far below this). */
export const START_FREE_MAX_REACH = 5000

// the columnar lane's leaves this walker admits (OHLCV and the price means: each a function of the bar itself)
const AST_SERIES = new Set(['open', 'high', 'low', 'close', 'volume', 'hl2', 'hlc3', 'ohlc4', 'hlcc4'])
// pointwise math the columnar lane computes from the bar's own values; the first set never yields `na` from finite input
const AST_POINTWISE_TOTAL = new Set(['abs', 'max', 'min', 'ceil', 'floor', 'round', 'sign', 'nz', 'na'])
const AST_POINTWISE_PARTIAL = new Set(['acos', 'asin', 'atan', 'cos', 'exp', 'idiv', 'ln', 'log10', 'mod', 'pow',
  'sin', 'sinh', 'sqrt', 'tan'])
const AST_OPS = new Set(['+', '-', '*', '/', '>', '<', '>=', '<=', '==', '!=', '&&', '||', 'u-', '!', '?:'])
const CMP_OR_LOGIC = new Set(['>', '<', '>=', '<=', '==', '!=', '&&', '||', '!'])
// runtime pointwise builtins whose value is never `na` from finite input (the rest may be)
const RT_TOTAL = new Set(['abs', 'max', 'min', 'ceil', 'floor', 'round', 'sign', 'nz', 'na'])
const bareName = (fn) => String(fn || '').replace(/^(math|ta)\./, '')

class NotStartFree extends Error {
  constructor(why) { super(why); this.name = 'NotStartFree'; this.why = why }
}
const no = (why) => { throw new NotStartFree(why) }

/** `{ reach, mayNa }` of a canonical (columnar lane) tree. */
function astFacts(node, depth = 0) {
  if (depth > 400) no('a column tree too deep to read')
  if (!node || typeof node !== 'object') no('a column node that is not a node')
  const args = Array.isArray(node.args) ? node.args : []
  switch (node.type) {
    case 'num':
      return { reach: 0, mayNa: !Number.isFinite(node.value) }
    case 'series':
      if (!AST_SERIES.has(node.name)) no(`a column reads \`${node.name}\`, which this walker does not admit as a leaf`)
      return { reach: 0, mayNa: false }
    case 'offset': {
      const n = node.value
      if (!Number.isInteger(n) || n < 0 || args.length !== 1) no('a column offset that is not a literal count')
      const c = astFacts(args[0], depth + 1)
      return { reach: c.reach + n, mayNa: c.mayNa }
    }
    case 'op': {
      if (!AST_OPS.has(node.name)) no(`a column operator \`${node.name}\``)
      const fs = args.map((a) => astFacts(a, depth + 1))
      const reach = Math.max(0, ...fs.map((f) => f.reach))
      if (node.name === '?:') {
        // ⛔ rule 5: a window or history read inside an arm is not admitted (the columnar lane evaluates both arms
        // over every bar, but the runtime lane's own `?:` does not; one rule for both keeps the walker simple)
        if (fs.length !== 3) no('a column `?:` without three operands')
        if (fs[1].reach > 0 || fs[2].reach > 0) no('a column `?:` arm reads history')
        if (fs[0].mayNa) no('a column `?:` whose test can be na')
        return { reach, mayNa: fs[1].mayNa || fs[2].mayNa }
      }
      const anyNa = fs.some((f) => f.mayNa)
      // ⛔ rule 6: a logic operator over an `na`-able operand reads differently on and off the listing
      // (`interpret.js::pineBoolAt`); a comparison over one is itself `na`-able (it is `na` off the listing)
      if ((node.name === '&&' || node.name === '||' || node.name === '!') && anyNa) no(`a column \`${node.name}\` over a value that can be na`)
      if (CMP_OR_LOGIC.has(node.name)) return { reach, mayNa: anyNa }
      return { reach, mayNa: node.name === '/' || anyNa }
    }
    case 'call': {
      const name = node.name
      const win = FINITE_WINDOW[name]
      if (win) {
        if (args.length !== 2 || !args[1] || args[1].type !== 'num' || !Number.isInteger(args[1].value) || args[1].value < 1) {
          no(`a column \`${name}\` whose length is not a literal`)
        }
        const src = astFacts(args[0], depth + 1)
        if (win.na !== PROPAGATE && src.mayNa) no(`a column \`${name}\` over a source that can be na reaches past its holes`)
        const span = win.span(args[1].value)
        return { reach: src.reach + span - 1, mayNa: win.na === PROPAGATE && src.mayNa }
      }
      if (AST_POINTWISE_TOTAL.has(name) || AST_POINTWISE_PARTIAL.has(name)) {
        const fs = args.map((a) => astFacts(a, depth + 1))
        const reach = Math.max(0, ...fs.map((f) => f.reach))
        if (name === 'nz' || name === 'na') return { reach, mayNa: false }
        return { reach, mayNa: AST_POINTWISE_PARTIAL.has(name) || fs.some((f) => f.mayNa) }
      }
      return no(`a column calls \`${name}\`, which is not a finite window or pointwise math`)
    }
    default:
      return no(`a column node of type \`${node.type}\``)
  }
}

/**
 * ⭐⭐ THE PROOF. `{ startFree: true, reach }` or `{ startFree: false, why }` for a built runtime IR.
 */
export function startFreeProofOf(ir) {
  try {
    return { startFree: true, reach: proveReach(ir) }
  } catch (err) {
    if (err instanceof NotStartFree) return { startFree: false, why: err.why }
    return { startFree: false, why: `the walker could not read this program (${String((err && err.message) || err).slice(0, 80)})` }
  }
}

function proveReach(ir) {
  if (!ir || typeof ir !== 'object' || !Array.isArray(ir.statements)) no('no program')
  if ((ir.requests || []).length) no('it requests other bars')
  if ((ir.carried || []).length || (ir.carried2 || []).length) no('it holds a carried built-in')
  if ((ir.callSites || []).length) no('it calls a function of its own')
  if ((ir.objectTreeOutputs || []).length || (ir.iterOutputs || []).length) no('it draws objects')
  if (ir.broker) no('it runs a strategy')
  for (const s of ir.slots || []) if (s && s.owner === null && s.kind === SLOT.PERSIST) no('it keeps a `var`')
  const trees = ir[COLUMN_TREES]
  if (!Array.isArray(trees)) no('its columns were not read')
  const colFacts = new Map()
  const columnFacts = (i) => {
    if (!colFacts.has(i)) {
      if (!trees[i]) no(`column ${i} has no tree`)
      colFacts.set(i, astFacts(trees[i]))
    }
    return colFacts.get(i)
  }
  const windows = ir.windows || []

  // the slots' facts settle by iteration: reaches only grow, so a recursion through history that never settles
  // passes `START_FREE_MAX_REACH` and is refused
  let slotFacts = new Map()
  const slotOf = (slot) => slotFacts.get(slot) || { reach: 0, mayNa: false }
  let changed = true
  let rounds = 0
  let emitted = 0
  while (changed) {
    rounds += 1
    if (rounds > (ir.slots || []).length + 3) no('a recursion through history that does not settle')
    changed = false
    const next = new Map(slotFacts)
    emitted = 0
    const write = (slot, f) => {
      const was = next.get(slot) || { reach: 0, mayNa: false }
      const now = { reach: Math.max(was.reach, f.reach), mayNa: was.mayNa || f.mayNa }
      if (now.reach > START_FREE_MAX_REACH) no('a reach past the walker\'s ceiling')
      if (now.reach !== was.reach || now.mayNa !== was.mayNa) { next.set(slot, now); changed = true }
    }

    const expr = (e, inBranch, depth = 0) => {
      if (depth > 400) no('an expression too deep to read')
      if (!e || typeof e !== 'object') no('an expression that is not a node')
      switch (e.kind) {
        case EXPR.NUM: return { reach: 0, mayNa: !!e.na || !Number.isFinite(e.value) }
        case EXPR.STR: return { reach: 0, mayNa: false }
        case EXPR.SERIES:
          if (!SERIES_NAMES.includes(e.name)) no(`it reads \`${e.name}\``)
          return { reach: 0, mayNa: false }
        case EXPR.CLOCK: case EXPR.SESSION: return { reach: 0, mayNa: e.kind === EXPR.SESSION }
        case EXPR.COLUMN: {
          const f = columnFacts(e.index)
          if (inBranch && f.reach > 0) no('a column that reads history inside a branch')
          return f
        }
        case EXPR.READ:
          if (e.global) no('a read of a global from inside a function')
          return slotOf(e.slot)
        case EXPR.HIST: {
          if (!Number.isInteger(e.back) || e.back < 0) no('a history offset that is not a literal')
          if (inBranch) no('a history read inside a branch')
          const f = expr(e.of, inBranch, depth + 1)
          return { reach: f.reach + e.back, mayNa: f.mayNa }
        }
        case EXPR.BINARY: {
          const l = expr(e.left, inBranch, depth + 1)
          const r = expr(e.right, inBranch, depth + 1)
          const reach = Math.max(l.reach, r.reach)
          if ((e.op === '&&' || e.op === '||') && (l.mayNa || r.mayNa)) no(`an \`${e.op}\` over a value that can be na`)
          if (CMP_OR_LOGIC.has(e.op)) return { reach, mayNa: l.mayNa || r.mayNa }
          return { reach, mayNa: e.op === '/' || l.mayNa || r.mayNa }
        }
        case EXPR.UNARY: {
          const f = expr(e.of, inBranch, depth + 1)
          if (e.op === '!' && f.mayNa) no('a `not` over a value that can be na')
          return { reach: f.reach, mayNa: e.op === '!' ? false : f.mayNa }
        }
        case EXPR.TERNARY: {
          const t = expr(e.test, inBranch, depth + 1)
          if (t.mayNa) no('a `?:` whose test can be na')
          const a = expr(e.then, true, depth + 1)
          const b = expr(e.else, true, depth + 1)
          return { reach: Math.max(t.reach, a.reach, b.reach), mayNa: a.mayNa || b.mayNa }
        }
        case EXPR.BUILTIN: case EXPR.TEXT: case EXPR.COLOUR: {
          const fs = (e.args || []).map((a) => (a == null ? { reach: 0, mayNa: true } : expr(a, inBranch, depth + 1)))
          const reach = Math.max(0, ...fs.map((f) => f.reach))
          const name = bareName(e.fn)
          if (e.kind === EXPR.BUILTIN && (name === 'nz' || name === 'na')) return { reach, mayNa: false }
          return { reach, mayNa: !(e.kind === EXPR.BUILTIN && RT_TOTAL.has(name)) || fs.some((f) => f.mayNa) }
        }
        case EXPR.CONCAT: {
          const l = expr(e.left, inBranch, depth + 1)
          const r = expr(e.right, inBranch, depth + 1)
          return { reach: Math.max(l.reach, r.reach), mayNa: false }
        }
        case EXPR.WINDOW: {
          if (inBranch) no('a window inside a branch')
          const w = windows[e.site]
          if (!w) no(`window site ${e.site} has no plan`)
          if (w.dynamic || e.length !== undefined) no('a window whose length is read per bar')
          const table = FINITE_WINDOW[w.fn]
          if (!table) no(`a window of \`${w.fn}\`, which is not a finite window`)
          if (!Number.isInteger(w.span) || w.span < 1) no('a window with no literal span')
          const src = expr(e.source, inBranch, depth + 1)
          if (table.na !== PROPAGATE && src.mayNa) no(`a \`${w.fn}\` over a source that can be na reaches past its holes`)
          return { reach: src.reach + w.span - 1, mayNa: table.na === PROPAGATE && src.mayNa }
        }
        default:
          return no(`an expression of kind \`${e.kind}\``)
      }
    }

    let R = 0
    const stmts = (list, ctrl, inBranch) => {
      for (const s of list || []) {
        switch (s && s.kind) {
          case STMT.DECLARE: case STMT.ASSIGN: {
            const f = expr(s.value, inBranch)
            write(s.slot, { reach: Math.max(f.reach, ctrl), mayNa: f.mayNa })
            break
          }
          case STMT.IF: {
            const t = expr(s.test, inBranch)
            if (t.mayNa) no('an `if` whose test can be na')
            stmts(s.then, Math.max(ctrl, t.reach), true)
            stmts(s.else, Math.max(ctrl, t.reach), true)
            break
          }
          case STMT.EMIT: {
            const f = expr(s.value, inBranch)
            R = Math.max(R, f.reach, ctrl)
            emitted += 1
            break
          }
          case STMT.EXPR:
            expr(s.value, inBranch)
            break
          default:
            no(`a statement of kind \`${s && s.kind}\``)
        }
      }
    }
    stmts(ir.statements, 0, false)
    slotFacts = next
    if (!changed) {
      if (!emitted) no('it emits nothing')
      return R
    }
  }
  return no('a recursion through history that does not settle')
}
