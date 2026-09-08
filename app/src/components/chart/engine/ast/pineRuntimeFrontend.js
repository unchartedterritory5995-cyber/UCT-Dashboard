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
import { TABLE, isPointwise } from './parse.js'
import { interpret } from './interpret.js'
import {
  makeIrProgram, SLOT, num, series, column, read, hist, binary, unary, ternary,
  declare, assign, ifStmt, emit, call as irCall,
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
  // ⭐⭐ SPLIT IN 2E, BECAUSE THE MEASUREMENT SAID IT WAS THREE THINGS (§29).
  // `runtime:call-with-state` was the top blocker at 15 and named `na`, `nz`,
  // `math.max`, `int` and `str.upper` in the same breath as `ema` and
  // `request.security` — a POINTWISE function applied to a state value, a
  // WINDOWED one that would need a growing series, and an MTF request are three
  // separately-schedulable capabilities of very different size. One label made
  // them look like one wall.
  'runtime:call-pointwise-state':
    'a POINTWISE builtin applied to a mutable value — no series is needed, only a per-bar apply',
  'runtime:call-windowed-state':
    'a WINDOWED builtin fed by a mutable variable — this one needs the series bridge',
  'runtime:request-with-state':
    'a data request whose argument is a mutable value',
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
  'runtime:recursion': 'a function that calls itself — Pine forbids it',
  'runtime:function-global-state': 'a function body reading a mutable GLOBAL — a frame has no address for one yet',
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
  const functions = []
  const fnByName = new Map()
  const callSites = []
  const root = new Scope(null)

  /** The function currently being compiled — `null` inside the main program.
   *  ⭐ A slot's OWNER, which is what makes its address frame-relative. */
  let owner = null
  /** While a function body is being compiled, the scope its globals live in — so
   *  a reference to a global mutable variable is refused BY NAME rather than
   *  arriving at the columnar resolver as an undefined name. */
  let guardOuter = null

  const newSlot = (name, persistent, index) => {
    slots.push({
      name,
      kind: persistent ? SLOT.PERSIST : SLOT.LOCAL,
      owner,
      ...(index === undefined ? {} : { index }),
    })
    return slots.length - 1
  }

  /** Frame-relative counts for the owner currently being compiled. */
  const countFor = (who, kind) =>
    slots.filter((s) => s.owner === who && s.kind === kind).length

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

  /** THE ROUTE DECISION. Does this subtree need the runtime?
   *
   *  ⭐⭐ TWO REASONS, NOT ONE. It reads a mutable SLOT — or it CALLS a
   *  user-defined function. The second matters because the columnar Resolver has
   *  no knowledge of this front end's function table: sending it a subtree
   *  containing `f(close)` would produce `pine:function` ("there is no `f`")
   *  about a function the member is looking straight at.
   *
   *  ⚠️ SO EVERY UDF CALL GOES THROUGH THE RUNTIME, pure ones included, and that
   *  is a DEFERRED OPTIMISATION rather than a semantic requirement (§26). A pure
   *  UDF could fold into a graph column, and `effects` below records which ones
   *  qualify — but routing it there needs the graph-vs-runtime differential to
   *  cover the seam, so correctness comes first and the classification is kept
   *  ready rather than acted on. */
  const needsRuntime = (node, scope) => {
    if (!node || typeof node !== 'object') return false
    if (node.type === 'name' && scope.lookup(node.name) !== null) return true
    // Inside a function, a GLOBAL mutable name must also reach the runtime path
    // — only so it can be refused precisely there.
    if (node.type === 'name' && guardOuter && guardOuter.lookup(node.name) !== null) return true
    if (node.type === 'call' && fnByName.has(node.name)) return true
    for (const k of ['left', 'right', 'test', 'yes', 'no', 'arg', 'value']) {
      if (needsRuntime(node[k], scope)) return true
    }
    if (Array.isArray(node.args)) {
      for (const a of node.args) {
        if (needsRuntime(a && a.value !== undefined ? a.value : a, scope)) return true
      }
    }
    return false
  }
  const readsSlot = needsRuntime

  /** ⭐ WHICH builtin-with-state family a call belongs to.
   *
   *  ⚠️ THE NAMESPACE STRIP IS A HEURISTIC AND IT ONLY AFFECTS A LABEL. Pine
   *  spells the same table entry as `ema`, `ta.ema` and (in v2) `ema` again; the
   *  authoritative mapping lives inside `pine.js`'s resolver and is not exported.
   *  Stripping a known prefix and asking the closed table is close enough for a
   *  DIAGNOSTIC — a mislabel here misfiles a refusal in the completion matrix, it
   *  never changes a number — and saying so is cheaper than pretending the
   *  mapping is authoritative. */
  const builtinStateFamily = (rawName) => {
    const name = String(rawName || '')
    if (/^request\./.test(name)) return 'runtime:request-with-state'
    const bare = name.replace(/^(ta|math|str|array|matrix|map)\./, '')
    const spec = TABLE.functions[bare]
    if (spec && isPointwise(spec)) return 'runtime:call-pointwise-state'
    // `na`/`nz` are Pine forms rather than table entries, and both are pointwise
    // by construction — they read one value and answer about that value.
    if (bare === 'na' || bare === 'nz') return 'runtime:call-pointwise-state'
    return 'runtime:call-windowed-state'
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
        if (slot !== null) return read(slot)
        if (guardOuter && guardOuter.lookup(node.name) !== null) {
          note('runtime:function-global-state')
          throw new RuntimeRefusal('runtime:function-global-state', `\`${node.name}\``, locate(node.tok))
        }
        throw new RuntimeRefusal('runtime:unbound', `\`${node.name}\``, locate(node.tok))
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
        // ⭐⭐ A USER FUNCTION CALL — the 2E path. Each call gets its OWN call
        // site, and the site is what will own the invocation's persistent
        // locals: `f(1)` and `f(10)` on two lines are two sites, so a `var`
        // inside `f` is two independent counters, which is Pine's semantics and
        // the single most important thing this wave has to get right.
        const fnIndex = fnByName.get(node.name)
        if (fnIndex !== undefined) {
          const fn = functions[fnIndex]
          if (fn.compiling) {
            // Pine forbids a function calling itself. Saying so beats letting it
            // reach a depth limit and reporting exhaustion for a rule violation.
            note('runtime:recursion')
            throw new RuntimeRefusal('runtime:recursion', `\`${node.name}\``, locate(node.tok))
          }
          const args = node.args.map((a) => (a && a.value !== undefined ? a.value : a))
          if (args.length !== fn.params) {
            throw new RuntimeRefusal('runtime:statement',
              `\`${node.name}\` takes ${fn.params} argument${fn.params === 1 ? '' : 's'}, given ${args.length}`,
              locate(node.tok))
          }
          for (const a of node.args) {
            if (a && a.name) {
              throw new RuntimeRefusal('runtime:statement',
                `a named argument \`${a.name}\` on the user function \`${node.name}\``, locate(node.tok))
            }
          }
          const site = callSites.length
          callSites.push({ fn: fnIndex, at: locate(node.tok) })
          // ⭐ ARGUMENTS ARE LOWERED IN THE CALLER'S SCOPE, so a state-derived
          // argument (`f(acc)`) is an ordinary runtime expression rather than a
          // special case — §30.
          return irCall(fnIndex, site, args.map((a) => lowerExpr(a, scope)))
        }
        const fam = callFamily(node.name)
        if (fam) { note(fam); throw new RuntimeRefusal(fam, `\`${node.name}\``, locate(node.tok)) }
        // A builtin whose ARGUMENT is mutable state — and WHICH KIND matters.
        const g = builtinStateFamily(node.name)
        note(g)
        throw new RuntimeRefusal(g, `\`${node.name}\``, locate(node.tok))
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
      {
        const arrow = findTop(toks, (t) => isPunct(t, '=>'))
        if (arrow > 0) {
          defineFunction(st, toks, arrow)
          continue
        }
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

  /** ⭐⭐ A FUNCTION DEFINITION BECOMES A FIRST-CLASS SEMANTIC ENTITY (§4) —
   *  name, parameters, its own frame, its own persistent-local count, a body and
   *  a result. Not a macro, and not re-parsed at each call: the CODE is shared and
   *  only the state is per call site. */
  const defineFunction = (st, toks, arrow) => {
    const nameTok = toks[0]
    if (!nameTok || nameTok.kind !== 'ident' || !isPunct(toks[1], '(') || !isPunct(toks[arrow - 1], ')')) {
      throw new RuntimeRefusal('runtime:function',
        'a definition this front end reads as `name(params) =>`', locate(toks[0]))
    }
    const params = []
    for (let i = 2; i < arrow - 1; i += 1) {
      const t = toks[i]
      if (isPunct(t, ',')) continue
      if (t.kind !== 'ident') {
        throw new RuntimeRefusal('runtime:function',
          `a parameter this front end cannot read (\`${t.value}\`) — default values are not supported yet`,
          locate(t))
      }
      params.push(t.value)
    }

    // ⭐ REGISTERED BEFORE ITS BODY IS COMPILED, so a self-call is caught as
    // RECURSION by name rather than reaching a depth limit and reporting
    // exhaustion for what is actually a Pine rule violation (§19).
    const fnIndex = functions.length
    const record = {
      name: nameTok.value, params: params.length, compiling: true,
      frameSize: 0, persistCount: 0, body: [], result: null,
      effects: null, at: locate(nameTok),
    }
    functions.push(record)
    fnByName.set(nameTok.value, fnIndex)

    const prevOwner = owner
    const prevGuard = guardOuter
    owner = fnIndex
    // ⛔ NO PARENT SCOPE. A Pine function cannot assign to a global, and reading
    // a global mutable slot from inside a frame would need a cross-frame address
    // this model deliberately does not have. `guardOuter` makes that a NAMED
    // refusal instead of a confusing "undefined name" about a name the member
    // can see two lines up.
    guardOuter = root
    const fnScope = new Scope(null)
    params.forEach((p, k) => fnScope.declare(p, newSlot(p, false, k)))

    const sitesBefore = callSites.length
    try {
      let body = []
      let result = null
      if (arrow === toks.length - 1) {
        const lines = st.sub || []
        if (!lines.length) {
          throw new RuntimeRefusal('runtime:function', 'a body with no statements', locate(nameTok))
        }
        body = lowerStmts(lines.slice(0, -1), fnScope)
        // ⭐ PINE RETURNS THE VALUE OF THE LAST STATEMENT (§16) — not an explicit
        // `return`. A final binding yields the value it bound; a final bare
        // expression yields itself.
        const last = lines[lines.length - 1]
        const lt = last.header || []
        const eq = findTop(lt, (t) => isPunct(t, '='))
        const walrus = findTop(lt, (t) => isPunct(t, ':='))
        if (walrus > 0 || (eq > 0 && !isPunct(lt[0], '['))) {
          body = body.concat(lowerStmts([last], fnScope))
          const bound = walrus > 0 ? lt[walrus - 1] : boundName(lt, eq)
          const slot = bound ? fnScope.lookup(bound.value) : null
          if (slot === null) {
            throw new RuntimeRefusal('runtime:function',
              'a body whose last statement binds nothing this front end can return', locate(nameTok))
          }
          result = read(slot)
        } else {
          result = lowerExpr(parseWholeExpression(lt), fnScope)
        }
      } else {
        result = lowerExpr(parseWholeExpression(toks.slice(arrow + 1)), fnScope)
      }
      record.body = body
      record.result = result
      record.frameSize = countFor(fnIndex, SLOT.LOCAL)
      record.persistCount = countFor(fnIndex, SLOT.PERSIST)
      // ⭐ EFFECT CLASSIFICATION PROPAGATES THROUGH THE CALL GRAPH (§25): a
      // function is pure only if it holds no persistent state AND every function
      // it calls is pure. Recorded, not yet exploited — see `needsRuntime`.
      const callsImpure = callSites.slice(sitesBefore)
        .some((cs) => !(functions[cs.fn].effects && functions[cs.fn].effects.pure))
      record.effects = { pure: record.persistCount === 0 && !callsImpure }
    } finally {
      record.compiling = false
      owner = prevOwner
      guardOuter = prevGuard
    }
  }

  let statements
  try {
    statements = lowerStmts(stmts, root)
  } catch (e) {
    return fail(e, diagnostics)
  }

  // ⭐⭐ CALL-SITE PERSISTENT BLOCKS ARE ALLOCATED AFTER THE WALK, because the
  // main program's own persistent count is only final once every statement has
  // been read. Main persists occupy the bottom of the array; each call site then
  // takes its own block — which is what makes two calls to one helper two
  // independent `var`s (§6/§7).
  {
    let base = countFor(null, SLOT.PERSIST)
    for (const cs of callSites) {
      cs.persistBase = base
      base += functions[cs.fn].persistCount
    }
  }

  if (!outputs.length) {
    return fail(new RuntimeRefusal('runtime:no-output', null, null), diagnostics)
  }

  diagnostics.columns = columns.length
  diagnostics.slots = slots.length
  diagnostics.functions = functions.length
  diagnostics.callSites = callSites.length
  diagnostics.pureFunctions = functions.filter((f) => f.effects && f.effects.pure).length

  let ir
  try {
    ir = makeIrProgram({
      version: version || null, statements, slots, columns, outputs,
      functions: functions.map((f) => ({
        name: f.name, params: f.params, frameSize: f.frameSize,
        persistCount: f.persistCount, body: f.body, result: f.result,
        effects: f.effects, at: f.at,
      })),
      callSites,
    })
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
