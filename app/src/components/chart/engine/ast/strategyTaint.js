// app/src/components/chart/engine/ast/strategyTaint.js
//
// ⛔⛔ W9-OQ-N2 r1 (2026-11-07) - WHERE A BROKER VALUE REACHES WHAT A MEMBER SEES.
//
// With the strategy broker DARK no lane computes `strategy.position_size`, `strategy.equity`,
// `strategy.opentrades.*`, ... A read of one inside an expression the host lane resolves
// refuses `pine:strategy-call` by name. But the host lane does not RESOLVE everything a member
// sees: a colour it cannot carry falls soft to one default colour, a fill band likewise, a
// drawing's colour is dropped as a generic property. Each of those served a broker value as if
// it were a default. Patching each route (named colour, positional colour, var state, switch,
// arrays, ...) was tried and missed routes; this file answers the question ONCE, as taint.
//
// TAINT, syntactic and flow-insensitive, over the statement tree `blockStatements` builds:
//   - a SOURCE is a `strategy.*` STATE word (anything under `strategy.` except the constants
//     and the order/risk calls below);
//   - a name is tainted when any statement assigns it (`=`, `:=`, `+=`, ..., `var`, `varip`,
//     a tuple) from an expression holding a tainted token, or assigns it inside a block whose
//     condition is tainted (`if` / `else` / `switch` arm / loop header);
//   - a collection is tainted when a mutating call (`array.*` / `matrix.*` / `map.*`, or the
//     method form `a.push(...)`) is made with a tainted argument;
//   - a user function is tainted (its result) when its body holds a tainted token, and its
//     parameters are tainted when any call passes a tainted argument (methods too);
//   - an expression is tainted when it holds a tainted token: a source, a tainted name (or a
//     field/method of one), a call of a tainted function. So a ternary, `color.new`, `math.*`,
//     `str.*`, `request.security(...)` and a library call over a tainted value are tainted.
// It over-approximates (names are not scoped), so it can only refuse more, never serve more.
//
// A SINK is a call whose output a member sees: plot / plotshape / plotchar / plotcandle /
// plotbar / plotarrow / fill / bgcolor / barcolor / hline / alertcondition / alert, every
// `line.*` / `label.*` / `box.*` / `table.*` / `polyline.*` / `linefill.*` call, and a drawing
// setter in method form (`lbl.set_color(...)`, `t.cell(...)`). A sink whose arguments are
// tainted, or that runs inside a tainted block, is reported with the source word it reaches.

const STRATEGY_CONSTANTS = new Set([
  'strategy.long', 'strategy.short', 'strategy.fixed', 'strategy.cash', 'strategy.percent_of_equity',
  'strategy.account_currency',
])
const STRATEGY_CONSTANT_NS = /^strategy\.(?:direction|oca|commission)\./
const STRATEGY_ORDER_CALL = /^strategy\.(?:entry|order|exit|close|close_all|cancel|cancel_all)$|^strategy\.risk\./

/** Is this identifier token a broker STATE read (not a constant, not an order call)? */
export function isStrategyStateWord(word) {
  const w = String(word || '')
  if (!w.startsWith('strategy.')) return false
  if (STRATEGY_CONSTANTS.has(w) || STRATEGY_CONSTANT_NS.test(w) || STRATEGY_ORDER_CALL.test(w)) return false
  return true
}

const SINK_CALLS = new Set(['plot', 'plotshape', 'plotchar', 'plotcandle', 'plotbar', 'plotarrow',
  'fill', 'bgcolor', 'barcolor', 'hline', 'alertcondition', 'alert'])
const DRAWING_NS = /^(?:line|label|box|table|polyline|linefill)\./
// ⛔ The method form of every drawing call that changes what is on screen: the setters, a table's
// cell writes, and the REMOVALS (`lbl.delete()`, `t.clear()`), which must be sinks in method form
// exactly as `label.delete(lbl)` is, or a removal run under a tainted condition is served silently.
const DRAWING_METHOD = /^(?:set_[a-z_]+|cell|cell_set_[a-z_]+|merge_cells|delete|clear)$/
/** A removal draws no value: it is the broker's choice only when RUN under a tainted condition. */
const REMOVAL_METHOD = /^(?:delete|clear)$/
const COLLECTION_NS = /^(?:array|matrix|map)\./
const COLLECTION_MUTATOR = /^(?:push|unshift|insert|set|fill|concat|put|put_all|add_row|add_col|reverse|sort|remove|pop|shift|clear|swap_rows|swap_columns)$/
const ASSIGN_OPS = new Set(['=', ':=', '+=', '-=', '*=', '/=', '%='])
const CONTROL_WORDS = new Set(['if', 'else', 'for', 'while', 'switch'])
const DECL_WORDS = new Set(['var', 'varip', 'const', 'simple', 'series', 'export'])

const isP = (t, v) => !!t && t.kind === 'punct' && t.value === v
const isIdent = (t) => !!t && t.kind === 'ident'
const keyOf = (t) => `${t.line}:${t.column}`

/** index of the bracket matching `toks[open]`, or toks.length */
function matchClose(toks, open) {
  const o = toks[open].value
  const c = o === '(' ? ')' : o === '[' ? ']' : '}'
  let d = 0
  for (let i = open; i < toks.length; i++) {
    if (isP(toks[i], o)) d++
    else if (isP(toks[i], c)) { d--; if (d === 0) return i }
  }
  return toks.length
}

/** first depth-0 index in toks satisfying pred, or -1 */
function topIndex(toks, pred) {
  let d = 0
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i]
    if (t.kind === 'punct' && (t.value === '(' || t.value === '[' || t.value === '{')) d++
    else if (t.kind === 'punct' && (t.value === ')' || t.value === ']' || t.value === '}')) d--
    else if (d === 0 && pred(t, i)) return i
  }
  return -1
}

/** A function / method definition header: `[method] name(params) =>`. */
function fnDefOf(header) {
  let i = 0
  if (isIdent(header[0]) && header[0].value === 'export') i++
  const isMethod = isIdent(header[i]) && header[i].value === 'method' && isIdent(header[i + 1])
  if (isMethod) i++
  if (!isIdent(header[i]) || !isP(header[i + 1], '(')) return null
  const close = matchClose(header, i + 1)
  if (!isP(header[close + 1], '=>')) return null
  const params = []
  let d = 0
  let last = null
  let seenEq = false
  for (let k = i + 2; k < close; k++) {
    const t = header[k]
    if (t.kind === 'punct' && (t.value === '(' || t.value === '[' || t.value === '<')) d++
    else if (t.kind === 'punct' && (t.value === ')' || t.value === ']' || t.value === '>')) d--
    else if (d === 0 && isP(t, ',')) { if (last) params.push(last); last = null; seenEq = false }
    else if (d === 0 && isP(t, '=')) seenEq = true
    else if (d === 0 && !seenEq && isIdent(t)) last = t.value
  }
  if (last) params.push(last)
  return { name: header[i].value, params, rest: header.slice(close + 2) }
}

/** The calls in a token list: `{ name, at, args: [from, to) }` for every `ident (`. */
function callsIn(toks) {
  const out = []
  for (let i = 0; i < toks.length - 1; i++) {
    if (isIdent(toks[i]) && isP(toks[i + 1], '(')) {
      out.push({ name: toks[i].value, tok: toks[i], from: i + 2, to: matchClose(toks, i + 1) })
    }
  }
  return out
}

/**
 * The tainted sinks of a Pine program.
 * @param {Array} stmts  `blockStatements(tokens, indents, 0)`
 * @returns {Map<string, {word: string, name: string, tok: object}>} keyed `line:column` of the
 *   sink's call token; empty when the program reads no broker state.
 */
export function strategyTaintSinks(stmts) {
  const sinks = new Map()
  const all = []
  const flat = (list) => { for (const s of list || []) { all.push(s); flat(s.sub) } }
  flat(stmts)
  if (!all.some((s) => s.header.some((t) => isIdent(t) && isStrategyStateWord(t.value)))) return sinks

  const fns = new Map() // name -> { params }
  for (const s of all) {
    const d = fnDefOf(s.header)
    if (d) fns.set(d.name, { params: d.params })
  }
  const names = new Map() // tainted name -> source word
  const fnRet = new Map() // tainted function result -> source word

  /** the first source word an expression reaches, or null */
  const wordOf = (toks) => {
    for (let i = 0; i < toks.length; i++) {
      const t = toks[i]
      if (!isIdent(t)) continue
      const v = t.value
      if (isStrategyStateWord(v)) return v
      if (names.has(v)) return names.get(v)
      const dot = v.indexOf('.')
      if (dot > 0) {
        const root = v.slice(0, dot)
        if (names.has(root)) return names.get(root)
        const meth = v.slice(v.lastIndexOf('.') + 1)
        if (isP(toks[i + 1], '(') && fns.has(meth) && fnRet.has(meth)) return fnRet.get(meth)
      }
      if (isP(toks[i + 1], '(') && fnRet.has(v)) return fnRet.get(v)
    }
    return null
  }
  let changed = false
  const taint = (map, k, w) => { if (k && w && !map.has(k)) { map.set(k, w); changed = true } }

  /** Assignment targets of a header (`x = ...`, `var float x = ...`, `[a, b] = ...`, `x.f := ...`). */
  const targetsOf = (header) => {
    const at = topIndex(header, (t) => t.kind === 'punct' && ASSIGN_OPS.has(t.value))
    if (at <= 0) return null
    const lhs = header.slice(0, at)
    let out = []
    if (lhs.some((t) => isP(t, '['))) {
      out = lhs.filter((t) => isIdent(t) && !DECL_WORDS.has(t.value)).map((t) => t.value)
    } else {
      const ids = lhs.filter(isIdent)
      const last = ids[ids.length - 1]
      if (last) out = [last.value.split('.')[0]]
    }
    return { targets: out, rhs: header.slice(at + 1) }
  }

  /** Every token of a statement and its block. */
  const tokensOf = (s) => {
    const out = [...s.header]
    const add = (list) => { for (const c of list || []) { out.push(...c.header); add(c.sub) } }
    add(s.sub)
    return out
  }

  /** Calls inside a token list: collection mutators, user-function args, and sinks. */
  const visitCalls = (toks, ctxWord, collectSinks) => {
    for (const c of callsIn(toks)) {
      const args = toks.slice(c.from, c.to)
      const w = wordOf(args) || ctxWord
      const dot = c.name.indexOf('.')
      const root = dot > 0 ? c.name.slice(0, dot) : null
      const meth = dot > 0 ? c.name.slice(c.name.lastIndexOf('.') + 1) : c.name
      const recvWord = root && names.has(root) ? names.get(root) : null
      // a collection written with a tainted value becomes tainted
      if (COLLECTION_NS.test(c.name) && COLLECTION_MUTATOR.test(meth) && w) {
        const first = args[0]
        if (isIdent(first) && (isP(args[1], ',') || args.length === 1)) taint(names, first.value.split('.')[0], w)
      } else if (root && !/^(?:array|matrix|map|math|str|ta|color|request|input|line|label|box|table|polyline|linefill|chart|strategy|syminfo|timeframe|ticker|barstate|session|runtime|log|time|plot|hline|display|format|position|size|shape|location|text|xloc|yloc|extend|font|order|scale|currency|dayofweek|earnings|dividends|splits|adjustment|backadjustment|settlement_as_close)$/.test(root)
          && COLLECTION_MUTATOR.test(meth) && !fns.has(meth) && w) {
        taint(names, root, w) // method form `a.push(x)`
      }
      // a user function (or method) called with a tainted argument: its parameters are tainted
      const fnName = fns.has(c.name) ? c.name : (root && fns.has(meth) ? meth : null)
      if (fnName && (w || recvWord)) {
        for (const p of fns.get(fnName).params) taint(names, p, w || recvWord)
      }
      if (!collectSinks) continue
      const isSink = SINK_CALLS.has(c.name) || DRAWING_NS.test(c.name)
        || (root && !DRAWING_NS.test(c.name) && DRAWING_METHOD.test(meth) && !fns.has(meth))
      // ⛔ A DELETE draws no value: deleting a drawing the taint already withheld shows nothing a
      // broker value decided. Only a delete RUN under a tainted condition is the broker's choice.
      // (Treating its handle as the sink withheld the delete, and a lost delete hides EVERY drawing
      // of the script: rsi-vwap-indicator, owner ruling 2026-11-08.)
      const sw = REMOVAL_METHOD.test(meth) && (SINK_CALLS.has(c.name) || DRAWING_NS.test(c.name) || root) ? ctxWord : (w || recvWord)
      if (isSink && sw && !sinks.has(keyOf(c.tok))) sinks.set(keyOf(c.tok), { word: sw, name: c.name, tok: c.tok })
    }
  }

  const walk = (list, ctxWord, collectSinks) => {
    let ifWord = null // the condition word of the `if` an `else` belongs to
    for (const s of list || []) {
      const h = s.header
      const first = h[0]
      const def = fnDefOf(h)
      if (def) {
        const body = [...def.rest]
        const add = (l) => { for (const c of l || []) { body.push(...c.header); add(c.sub) } }
        add(s.sub)
        taint(fnRet, def.name, wordOf(body))
        visitCalls(def.rest, ctxWord, collectSinks)
        walk(s.sub, ctxWord, collectSinks)
        ifWord = null
        continue
      }
      if (isIdent(first) && CONTROL_WORDS.has(first.value)) {
        let w = wordOf(h)
        if (first.value === 'else') w = w || ifWord
        if (first.value === 'if') ifWord = w
        else if (first.value === 'else') ifWord = w
        else ifWord = null
        visitCalls(h, ctxWord, collectSinks)
        walk(s.sub, ctxWord || w, collectSinks)
        continue
      }
      ifWord = null
      // a switch arm / `cond => stmt`: the condition taints what the arm does
      const arrow = topIndex(h, (t) => isP(t, '=>'))
      if (arrow >= 0) {
        const armWord = ctxWord || wordOf(h.slice(0, arrow))
        const rest = { header: h.slice(arrow + 1), sub: s.sub }
        visitCalls(h.slice(0, arrow), ctxWord, collectSinks)
        walk([rest], armWord, collectSinks)
        continue
      }
      const asg = targetsOf(h)
      if (asg) {
        const w = ctxWord || wordOf(tokensOf({ header: asg.rhs, sub: s.sub }))
        for (const t of asg.targets) taint(names, t, w)
        visitCalls(h, ctxWord, collectSinks)
        // an `if` / `switch` expression's block: its own conditions taint its assignments
        walk(s.sub, ctxWord || wordOf(asg.rhs), collectSinks)
        continue
      }
      visitCalls(h, ctxWord, collectSinks)
      walk(s.sub, ctxWord, collectSinks)
    }
  }

  for (let round = 0; round < 64; round++) {
    changed = false
    walk(stmts, null, false)
    if (!changed) break
  }
  walk(stmts, null, true)
  return sinks
}
