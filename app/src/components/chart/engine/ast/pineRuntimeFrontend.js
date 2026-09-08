// app/src/components/chart/engine/ast/pineRuntimeFrontend.js
//
// ─── PINE SOURCE → SEMANTIC IR ──────────────────────────────────────────────
//
// 2D-2. The first path by which REAL Pine source reaches the bar-by-bar runtime.
//
// ⛔⛔ THIS IS NOT A SECOND PARSER, AND THAT IS THE POINT. It reuses `pine.js`'s
// lexer, its indent-aware statement tree (`blockStatements`, which already
// produces `{header, body, sub}` at every level), its expression parser and its
// `Resolver`. What the old lowering did was DISCARD that structure, because the
// artifact it targeted could only hold expressions. This one keeps it.
//
// ⭐⭐ THE ROUTE IS CHOSEN BY EFFECT, NOT BY SYNTAX (§47/§48). One rule decides
// every expression:
//
//      does this subtree READ A MUTABLE SLOT?
//        no  → it is pure: `Resolver` → canonical tree → ONE column, evaluated by
//              the columnar lane, read per bar. All 70 builtins keep their
//              warm-ups, recurrences and vendor pins.
//        yes → it is stateful: lowered structurally into IR expression nodes,
//              with its pure subterms still becoming columns.
//
// So `ta.sma(close, len)` where `len` is an ordinary binding stays in the graph
// lane at full speed, and `acc := acc + close` becomes real statements — in the
// same program, from the same parse.
//
// ⛔ NOTHING IS EVER SILENTLY DROPPED (§18). A statement form this front end
// cannot yet lower produces a NAMED refusal identifying the exact family, so the
// next true dependency is exposed rather than hidden behind `pine:state`.

import {
  lexPine, blockStatements, parseWholeExpression, Resolver,
  findTop, isPunct, boundName, locate, PineRefusal,
} from './pine.js'
import { TABLE } from './parse.js'
import { interpret } from './interpret.js'
import {
  makeIrProgram, SLOT, num, series, column, read, hist, binary, unary, ternary,
  declare, assign, ifStmt, emit,
} from '../runtime/ir.js'

/** ⭐ THE REFUSAL VOCABULARY IS ITS OWN, AND DELIBERATELY GRANULAR (§19).
 *  Collapsing these into `pine:state` would hide the next dependency, which is
 *  the single most useful thing this wave can report. Every entry names a
 *  capability family from the completion matrix, so a refusal maps to a row. */
export const RUNTIME_REFUSALS = Object.freeze({
  'runtime:loop': 'a loop — the runtime has no iteration yet',
  'runtime:function': 'a user-defined function — the runtime has no call frames yet',
  'runtime:tuple': 'a tuple — the runtime has no multiple-value form yet',
  'runtime:array': 'an array or collection operation — the runtime has no collections yet',
  'runtime:object-op': 'a graphical-object operation — these belong to the object program, not the value runtime',
  'runtime:history-variable': 'history over a mutable variable — that needs per-slot history committed at end of bar',
  'runtime:expression-statement': 'an expression evaluated for effect — nothing in this runtime has an effect yet',
  'runtime:call-with-state': 'a builtin fed by a mutable variable — feeding runtime state into a series builtin needs the series bridge',
  'runtime:operator': 'an operator the runtime has no instruction for',
  'runtime:switch': 'a switch — the runtime has no multi-way branch yet',
  'runtime:varip': 'varip — intrabar persistence, which a closed-bar runtime cannot reproduce',
  'runtime:udt': 'a user-defined type',
  'runtime:presentation': 'a presentation call — this belongs to the presentation program, which the runtime lane does not carry yet',
  'runtime:directive': 'a compiler directive',
  'runtime:unbound': 'a name nothing in this script binds',
  'runtime:statement': 'a statement shape this front end does not recognise',
  'runtime:declaration': 'a script that is not an indicator',
  'runtime:no-output': 'a script with nothing to plot',
})

export class RuntimeRefusal extends Error {
  constructor(guard, detail, at) {
    super(`${RUNTIME_REFUSALS[guard] || guard}${detail ? ` — ${detail}` : ''}`)
    this.name = 'RuntimeRefusal'
    this.guard = guard
    this.detail = detail || null
    // ⭐ SOURCE LOCATION IS CARRIED (§50). Not for polish — a capability gap has
    // to be attributable to a line before any of the later product work
    // (diagnostics, Builder editing, import receipts) is possible at all.
    this.line = at && at.line != null ? at.line : null
    this.column = at && at.column != null ? at.column : null
    this.token = at && at.token != null ? at.token : null
  }
}

const BIN = Object.freeze({
  '+': '+', '-': '-', '*': '*', '/': '/',
  '<': '<', '>': '>', '<=': '<=', '>=': '>=', '==': '==', '!=': '!=',
  and: '&&', or: '||',
})
const PRICE = new Set(['open', 'high', 'low', 'close', 'volume'])
const BLOCK_WORDS = new Set(['for', 'while'])
const OBJECT_NS = /^(line|label|box|table|polyline|linefill)\./
const ARRAY_NS = /^(array|matrix|map)\./

// ── mutability pre-scan ─────────────────────────────────────────────────────

/** Every name this script ever MUTATES, and whether it was declared `var`.
 *
 *  ⛔ SCANNED OVER THE WHOLE TREE INCLUDING NESTED BODIES, before any lowering.
 *  A name reassigned inside an `if` is mutable everywhere, and deciding that
 *  lazily — as each statement is reached — would classify its first read as pure
 *  and fold it, which is the silent-wrong-result shape this whole program exists
 *  to prevent. */
export function scanMutability(stmts, out) {
  const acc = out || { mutated: new Set(), persistent: new Set() }
  for (const st of stmts) {
    const toks = st.header || []
    const first = toks[0]
    if (first && first.kind === 'ident' && (first.value === 'var' || first.value === 'varip')) {
      const eq = findTop(toks, (t) => isPunct(t, '='))
      const nameTok = eq > 0 ? boundName(toks, eq) : null
      if (nameTok) { acc.mutated.add(nameTok.value); acc.persistent.add(nameTok.value) }
    }
    const walrus = findTop(toks, (t) => isPunct(t, ':='))
    if (walrus > 0 && toks[walrus - 1] && toks[walrus - 1].kind === 'ident') {
      acc.mutated.add(toks[walrus - 1].value)
    }
    if (st.sub && st.sub.length) scanMutability(st.sub, acc)
  }
  return acc
}

// ── scope chain ─────────────────────────────────────────────────────────────

/** ⭐⭐ A SCOPE IS A FRAME, AND A SLOT IS ALLOCATED PER DECLARATION — never per
 *  NAME (§5). Two `x`es in sibling `if` bodies are two slots and cannot alias;
 *  resolving by name at runtime is what would let one mutate the other. */
class Scope {
  constructor(parent) { this.parent = parent; this.names = new Map() }
  lookup(name) {
    for (let s = this; s; s = s.parent) {
      if (s.names.has(name)) return s.names.get(name)
    }
    return null
  }
  declare(name, slot) { this.names.set(name, slot); return slot }
}

// ── the builder ─────────────────────────────────────────────────────────────

/**
 * @param {string} source  Pine source
 * @param {object} opts    { bars, inputs, interpretOpts }
 * @returns {{ok:boolean, ir?:object, refusal?:object, diagnostics:object}}
 */
export function buildRuntimeIr(source, opts = {}) {
  const bars = opts.bars || []
  const inputs = opts.inputs || {}
  const diagnostics = { statements: 0, columns: 0, slots: 0, families: {} }

  const note = (family) => {
    diagnostics.families[family] = (diagnostics.families[family] || 0) + 1
  }

  let lexed
  try { lexed = lexPine(source) } catch (e) { return fail(e, diagnostics) }
  const { tokens, indents, version } = lexed

  let stmts
  try { stmts = blockStatements(tokens, indents, 0) } catch (e) { return fail(e, diagnostics) }

  const mut = scanMutability(stmts)

  // The resolver's environment holds ONLY pure bindings. A mutable name never
  // enters it — that is what keeps the two lanes from disagreeing about a name.
  const env = new Map()
  const makeResolver = () => new Resolver(env, TABLE, new Map(), {})

  const slots = []
  const columns = []
  const columnByKey = new Map()
  const outputs = []
  const root = new Scope(null)

  const newSlot = (name, persistent) => {
    slots.push({ name, kind: persistent ? SLOT.PERSIST : SLOT.LOCAL })
    return slots.length - 1
  }

  /** A PURE parse subtree → a column index. ⭐ The one place the columnar lane
   *  is invoked, and the one place `interpret` runs, so the hybrid seam is a
   *  single function rather than a habit. */
  const columnOf = (node, at) => {
    let canonical
    try {
      canonical = makeResolver().resolve(node)
    } catch (e) {
      // ⛔ A REFUSAL FROM THE VALUE LANE KEEPS ITS OWN NAME. Re-dressing a
      // `pine:builtin` as a runtime gap would send an engineer to the wrong
      // subsystem and lose the real next dependency.
      throw e
    }
    const key = JSON.stringify(canonical)
    if (columnByKey.has(key)) return columnByKey.get(key)
    let value
    try {
      value = interpret(canonical, bars, inputs, undefined, undefined, opts.interpretOpts)
    } catch (e) { throw e }
    let arr
    if (typeof value === 'number') arr = new Float64Array(bars.length).fill(value)
    else if (value instanceof Float64Array) arr = value
    else arr = Float64Array.from(value)
    if (arr.length !== bars.length) {
      throw new RuntimeRefusal('runtime:statement',
        `a column holds ${arr.length} values for ${bars.length} bars`, at)
    }
    columns.push(arr)
    const i = columns.length - 1
    columnByKey.set(key, i)
    return i
  }

  /** Does this parse subtree read a slot that is in scope? THE ROUTE DECISION. */
  const readsSlot = (node, scope) => {
    if (!node || typeof node !== 'object') return false
    if (node.type === 'name' && scope.lookup(node.name) !== null) return true
    for (const k of ['left', 'right', 'test', 'yes', 'no', 'arg', 'value']) {
      if (readsSlot(node[k], scope)) return true
    }
    if (Array.isArray(node.args)) {
      for (const a of node.args) {
        if (readsSlot(a && a.value !== undefined ? a.value : a, scope)) return true
      }
    }
    return false
  }

  /** The family a call belongs to, so a refusal names the right matrix row. */
  const callFamily = (name) => {
    const n = String(name || '')
    if (OBJECT_NS.test(n)) return 'runtime:object-op'
    if (ARRAY_NS.test(n)) return 'runtime:array'
    return null
  }

  const lowerExpr = (node, scope) => {
    if (!node || typeof node !== 'object') {
      throw new RuntimeRefusal('runtime:statement', 'an expression this front end cannot read')
    }
    // ⭐ THE ROUTE DECISION, ASKED ONCE PER SUBTREE. A pure subtree becomes one
    // column no matter how large it is, which is what keeps a stateful program
    // paying runtime cost only for the parts that are actually stateful.
    if (!readsSlot(node, scope)) return column(columnOf(node, locate(node.tok)))

    switch (node.type) {
      case 'number': return num(node.value)
      case 'name': {
        const slot = scope.lookup(node.name)
        if (slot === null) throw new RuntimeRefusal('runtime:unbound', `\`${node.name}\``, locate(node.tok))
        return read(slot)
      }
      case 'binary': {
        const op = BIN[node.op]
        if (!op) {
          throw new RuntimeRefusal('runtime:operator', `\`${node.op}\` beside a mutable value`, locate(node.tok))
        }
        return binary(op, lowerExpr(node.left, scope), lowerExpr(node.right, scope))
      }
      case 'unary': {
        if (node.op === '-') return unary('u-', lowerExpr(node.arg, scope))
        if (node.op === 'not') return unary('!', lowerExpr(node.arg, scope))
        throw new RuntimeRefusal('runtime:operator', `unary \`${node.op}\``, locate(node.tok))
      }
      case 'ternary':
        // ⚠️ BOTH ARMS EVALUATE, which is Pine's `?:` over values. A branch that
        // MUTATES is an `if` STATEMENT and is lowered by `lowerStmts`, never here
        // — routing one through this arm would run both mutations every bar.
        return ternary(lowerExpr(node.test, scope), lowerExpr(node.yes, scope), lowerExpr(node.no, scope))
      case 'offset': {
        // ⛔⛔ HISTORY OVER A MUTABLE VARIABLE IS REFUSED, NOT APPROXIMATED.
        // Reading the slot's CURRENT value is the plausible shortcut and it is
        // silently one bar wrong on every bar. Per-slot history committed at end
        // of bar is 2E; the integration point is the slot table, which already
        // has stable identity, so adding it will not move any slot.
        if (readsSlot(node.arg, scope)) {
          note('runtime:history-variable')
          throw new RuntimeRefusal('runtime:history-variable', null, locate(node.tok))
        }
        const back = Number(node.n)
        if (!Number.isInteger(back) || back < 0) {
          throw new RuntimeRefusal('runtime:statement', 'a bar offset counts backwards in whole bars', locate(node.tok))
        }
        return hist(column(columnOf(node.arg, locate(node.tok))), back)
      }
      case 'call': {
        const fam = callFamily(node.name)
        if (fam) { note(fam); throw new RuntimeRefusal(fam, `\`${node.name}\``, locate(node.tok)) }
        // A builtin whose ARGUMENT is mutable state: the runtime would have to
        // hand a growing series into a windowed builtin. Named, because it is a
        // real and separately-schedulable capability (the series bridge), not a
        // gap in state support.
        note('runtime:call-with-state')
        throw new RuntimeRefusal('runtime:call-with-state', `\`${node.name}\``, locate(node.tok))
      }
      default:
        throw new RuntimeRefusal('runtime:statement', `a \`${node.type}\` beside a mutable value`, locate(node.tok))
    }
  }

  // ⭐⭐ THREE KINDS OF STATEMENT-LEVEL CALL, AND THEY ARE NOT ONE FAMILY (§27).
  // The first measurement of this front end filed `fill()`, `bgcolor()` and
  // `max_bars_back()` under `runtime:expression-statement` — technically true
  // and useless: it put a presentation gap and a compiler directive in the row
  // reserved for effectful calls, so the completion matrix would have shown work
  // where there is none and hidden work where there is.
  //
  //   OUTPUT       carries a VALUE SERIES the runtime emits
  //   PRESENTATION carries appearance — the presentation program's, not this lane's
  //   DIRECTIVE    instructs the compiler and produces nothing
  const OUTPUT_CALLS = new Set(['plot', 'plotshape', 'plotchar', 'plotarrow'])
  const PRESENTATION_CALLS = new Set([
    'fill', 'bgcolor', 'barcolor', 'hline', 'plotcandle', 'plotbar',
    'alertcondition', 'alert',
  ])
  const DIRECTIVE_CALLS = new Set(['max_bars_back'])

  const lowerStmts = (list, scope) => {
    const out = []
    for (let i = 0; i < list.length; i += 1) {
      const st = list[i]
      const toks = st.header || []
      if (!toks.length) continue
      diagnostics.statements += 1
      const first = toks[0]
      const word = first.kind === 'ident' ? first.value : null

      // ── declarations of the script itself ──
      if (word === 'indicator' || word === 'study') continue
      if (word === 'strategy' || word === 'library') {
        throw new RuntimeRefusal('runtime:declaration', `\`${word}()\``, locate(first))
      }
      if (word === 'import' || word === 'export') {
        throw new RuntimeRefusal('runtime:declaration', `\`${word}\``, locate(first))
      }
      if (word === 'type') { note('runtime:udt'); throw new RuntimeRefusal('runtime:udt', null, locate(first)) }
      if (word === 'varip') { note('runtime:varip'); throw new RuntimeRefusal('runtime:varip', null, locate(first)) }
      if (BLOCK_WORDS.has(word)) { note('runtime:loop'); throw new RuntimeRefusal('runtime:loop', `\`${word}\``, locate(first)) }
      if (word === 'switch') { note('runtime:switch'); throw new RuntimeRefusal('runtime:switch', null, locate(first)) }

      // ── a user function definition: `f(a, b) => …` ──
      // ⭐ RECOGNISED BEFORE IT IS REFUSED (§24). The old lowering lost the
      // statement shape entirely; this one identifies it, so the later wave
      // consumes an already-correct semantic classification.
      if (findTop(toks, (t) => isPunct(t, '=>')) > 0) {
        note('runtime:function')
        throw new RuntimeRefusal('runtime:function', null, locate(first))
      }

      // ── tuple destructuring: `[a, b] = …` ──
      if (isPunct(first, '[')) {
        note('runtime:tuple')
        throw new RuntimeRefusal('runtime:tuple', null, locate(first))
      }

      // ── if / else ──
      if (word === 'if') {
        const test = parseWholeExpression(toks.slice(1))
        const thenScope = new Scope(scope)
        const thenStmts = lowerStmts(st.sub || [], thenScope)
        let elseStmts = []
        const nxt = list[i + 1]
        const nxtWord = nxt && nxt.header && nxt.header[0] && nxt.header[0].kind === 'ident'
          ? nxt.header[0].value : null
        if (nxtWord === 'else') {
          const elseToks = nxt.header.slice(1)
          const elseScope = new Scope(scope)
          if (elseToks.length && elseToks[0].kind === 'ident' && elseToks[0].value === 'if') {
            // `else if` — one nested IF, so the chain keeps its structure rather
            // than being flattened into an unreadable condition.
            elseStmts = lowerStmts([{ header: elseToks, body: nxt.body, sub: nxt.sub }], elseScope)
          } else {
            elseStmts = lowerStmts(nxt.sub || [], elseScope)
          }
          i += 1
        }
        out.push(ifStmt(lowerExpr(test, scope), thenStmts, elseStmts))
        continue
      }
      if (word === 'else') {
        // Reached only when an `else` has no `if` before it.
        throw new RuntimeRefusal('runtime:statement', '`else` with no `if`', locate(first))
      }

      // ── reassignment: `name := expr` ──
      const walrus = findTop(toks, (t) => isPunct(t, ':='))
      if (walrus > 0) {
        const nameTok = toks[walrus - 1]
        if (!nameTok || nameTok.kind !== 'ident') {
          throw new RuntimeRefusal('runtime:statement', 'a reassignment target must be a name', locate(first))
        }
        const slot = scope.lookup(nameTok.value)
        if (slot === null) {
          throw new RuntimeRefusal('runtime:unbound', `\`${nameTok.value}\` is reassigned before it is declared`, locate(nameTok))
        }
        const value = parseWholeExpression(toks.slice(walrus + 1))
        out.push(assign(slot, lowerExpr(value, scope)))
        continue
      }

      // ── `var name = expr` ──
      if (word === 'var') {
        const eq = findTop(toks, (t) => isPunct(t, '='))
        const nameTok = eq > 0 ? boundName(toks, eq) : null
        if (!nameTok) throw new RuntimeRefusal('runtime:statement', 'a `var` declaration needs a name and an initialiser', locate(first))
        const value = parseWholeExpression(toks.slice(eq + 1))
        const slot = scope.declare(nameTok.value, newSlot(nameTok.value, true))
        out.push(declare(slot, lowerExpr(value, scope)))
        continue
      }

      // ── an output call ──
      if (word && OUTPUT_CALLS.has(word) && isPunct(toks[1], '(')) {
        const call = parseWholeExpression(toks)
        const arg0 = call.args && call.args.length ? (call.args[0].value !== undefined ? call.args[0].value : call.args[0]) : null
        if (!arg0) throw new RuntimeRefusal('runtime:statement', `\`${word}()\` with no value`, locate(first))
        outputs.push(word)
        out.push(emit(outputs.length - 1, lowerExpr(arg0, scope)))
        continue
      }

      // ── an ordinary binding: `name = expr` ──
      const eq = findTop(toks, (t) => isPunct(t, '='))
      if (eq > 0) {
        const nameTok = boundName(toks, eq)
        if (!nameTok) throw new RuntimeRefusal('runtime:statement', 'a binding needs a name', locate(first))
        const value = parseWholeExpression(toks.slice(eq + 1))
        // ⭐⭐ THE HYBRID DECISION, MADE ONCE PER BINDING. A name this script
        // never mutates, bound to a pure expression, stays a PURE BINDING in the
        // resolver's environment — so `ta.sma(close, len)` is still one column at
        // columnar speed. A name that IS mutated, or one whose initialiser reads
        // a slot, becomes a runtime slot.
        const mutable = mut.mutated.has(nameTok.value)
        if (!mutable && !readsSlot(value, scope)) {
          env.set(nameTok.value, { kind: 'expr', node: value, env: new Map(env), at: locate(nameTok) })
          continue
        }
        const slot = scope.declare(nameTok.value, newSlot(nameTok.value, mut.persistent.has(nameTok.value)))
        out.push(declare(slot, lowerExpr(value, scope)))
        continue
      }

      // ── a bare call statement ──
      if (word && isPunct(toks[1], '(')) {
        if (PRESENTATION_CALLS.has(word)) {
          note('runtime:presentation')
          throw new RuntimeRefusal('runtime:presentation', `\`${word}()\``, locate(first))
        }
        if (DIRECTIVE_CALLS.has(word)) {
          note('runtime:directive')
          throw new RuntimeRefusal('runtime:directive', `\`${word}()\``, locate(first))
        }
        const f = callFamily(word)
        if (f) { note(f); throw new RuntimeRefusal(f, `\`${word}\``, locate(first)) }
        note('runtime:expression-statement')
        throw new RuntimeRefusal('runtime:expression-statement', `\`${word}()\``, locate(first))
      }
      // a dotted call statement — `label.new(...)`, `array.push(...)`
      if (word && isPunct(toks[1], '.') && toks[2] && toks[2].kind === 'ident') {
        const name = `${word}.${toks[2].value}`
        const f = callFamily(name)
        if (f) { note(f); throw new RuntimeRefusal(f, `\`${name}\``, locate(first)) }
        note('runtime:expression-statement')
        throw new RuntimeRefusal('runtime:expression-statement', `\`${name}()\``, locate(first))
      }

      throw new RuntimeRefusal('runtime:statement', null, locate(first))
    }
    return out
  }

  let statements
  try {
    statements = lowerStmts(stmts, root)
  } catch (e) {
    return fail(e, diagnostics)
  }

  if (!outputs.length) {
    return fail(new RuntimeRefusal('runtime:no-output', null, null), diagnostics)
  }

  diagnostics.columns = columns.length
  diagnostics.slots = slots.length

  let ir
  try {
    ir = makeIrProgram({ version: version || null, statements, slots, columns, outputs })
  } catch (e) { return fail(e, diagnostics) }

  return { ok: true, ir, diagnostics }
}

function fail(e, diagnostics) {
  const guard = e instanceof RuntimeRefusal ? e.guard
    : (e instanceof PineRefusal ? e.guard : 'runtime:statement')
  return {
    ok: false,
    refusal: {
      guard,
      message: String(e.message || e),
      line: e.line != null ? e.line : null,
      column: e.column != null ? e.column : null,
      token: e.token != null ? e.token : null,
    },
    diagnostics,
  }
}
