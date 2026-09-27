// app/src/components/chart/engine/ast/objectFnInline.js
//
// ─── ⭐⭐ A USER FUNCTION THAT DRAWS, INLINED AT EVERY CALL SITE ─────────────
//
// ⚰️⚰️ WHAT THE OBJECT READER DID BEFORE THIS FILE, MEASURED 2026-09-26.
// `collectObjectOps` walked a function DEFINITION's body as if it were top-level
// code: its catch-all *"any other statement may still hide a nested block"*
// descends into every `st.sub`, and a definition's body is exactly that. So
//
//     f() =>
//         label.new(bar_index, high, "x")
//     if close > open
//         f()
//
// compiled to ONE unconditional create that ran on EVERY bar — `ok: true`, a
// clean win — while Pine draws a label only on up bars. And a function that is
// never called at all drew a label on every bar too. Both were accepted without
// a word. That is not a coverage gap, it is a silent mistranslation, and it was
// live in the object program of 31 committed scripts, six of which attach at the
// member door (`dual-view-htf-candlestick-patterns` carried 19 such ops).
//
// ⭐ AND THE SAME DEFECT IS THE LARGEST CAUSE OF `pine:no-output`. When the body
// read a PARAMETER (`drawLine(x1, y1, …) => line.new(x1, y1, …)`), the top-level
// read met `x1` as an undefined name, dropped every op, and the script was told
// it "offers no plot and no alert condition" — 22 of the 33 scripts on that row
// draw from inside a function body, 14 of them from nowhere else.
//
// ─── WHAT PINE ACTUALLY DOES, AND THEREFORE WHAT THIS DOES ────────────────
//
//  • The body runs WHERE AND WHEN the call runs — under the call's own guards.
//  • Every CALL SITE has its own `var` storage. `Fib_line(0.236)` and
//    `Fib_line(0.5)` each own a `var line ln`; that is why the corpus idiom
//    `var line ln = na; line.delete(ln); ln := line.new(…)` keeps one line per
//    call site rather than one line in total. So body locals are RENAMED with a
//    per-call-site suffix and every declaration becomes its own register.
//  • Arguments are bound to parameters (positional, named, then declared
//    defaults) by SUBSTITUTING the argument's tokens. Body locals are renamed
//    before substitution, so an argument can never be captured by a body name.
//  • The function's return value is its last statement. When that is a drawing
//    handle and the caller writes `x = f(…)` / `x := f(…)`, the handle is copied
//    into the caller's register — the `ict-killzone` helper idiom
//    `line_(price) => ret = line.new(…)`.
//
// ─── WHAT IS REFUSED, BY NAME, AND WHY ────────────────────────────────────
//
// ⛔ A CONDITIONAL CALL WHOSE BODY READS HISTORY. Pine advances a function's
// series history only on the bars the call executes, so inside `if cond → f()`
// a `ta.highest(10)` or an `x[1]` in the body measures only the bars where
// `cond` held. The columnar value model evaluates every expression on every
// bar, so inlining that body would answer a different number. A body that reads
// only the current bar (arithmetic, `math.*`, `str.*`, `color.*`, drawing calls)
// is identical either way and is inlined.
// ⛔ A METHOD (`method m(...) =>`) THAT DRAWS. Its receiver is typed and this
// reader has no type system to dispatch on.
// ⛔ A DRAWING FUNCTION CALLED INSIDE AN EXPRESSION (`if f(x)`, `y = 1 + f(x)`,
// `plot(f(x))`), under `var` (`var x = f()` runs once), inside a loop this
// reader could not parse, with a wrong argument count, or nested past a depth
// Pine itself could never reach.
//
// ⭐ EVERY REFUSAL IS A COUNTED DROP (`dropReasons['fn:*']`), never an
// `unsupported` note: an op the program skips must make the program dirty, or
// the object-only door's clean-win rule would accept a drawing with a hole in it.

/** How deep a drawing helper may call another. ⛔ Pine forbids recursion, so a
 *  real script never approaches this — it exists so a cycle this reader
 *  mis-detected stops loudly instead of looping. */
export const MAX_INLINE_DEPTH = 8

/** The suffix a renamed body local carries. ⛔ Double underscore plus a word no
 *  Pine author writes, so a renamed local can never collide with a real name. */
export const INLINE_SUFFIX = '__uctfn'

/** Namespaces whose calls read only the CURRENT bar. ⛔ An allowlist, never a
 *  denylist: a function this list does not name is assumed to read history,
 *  which refuses a conditional call rather than mistranslating one. */
const PURE_NAMESPACES = new Set(['math', 'str', 'color', 'array', 'line', 'label', 'box',
  'table', 'linefill', 'polyline', 'chart', 'syminfo', 'timeframe', 'barstate',
  // `log.info(…)` writes to Pine's own log pane and returns nothing — no value,
  // no history.
  'log'])
/** Bare (un-namespaced) calls that read only the current bar — Pine v4's math
 *  spellings and the type casts. `fixnan` is deliberately ABSENT: it carries the
 *  last non-na value forward, which is history. */
const PURE_BARE = new Set(['na', 'nz', 'int', 'float', 'bool', 'string', 'tostring',
  'abs', 'max', 'min', 'round', 'floor', 'ceil', 'sqrt', 'pow', 'log', 'log10', 'exp',
  'sign', 'avg', 'iff', 'timestamp', 'color', 'rgb'])

/** Object-method spellings that WRITE a drawing — the method form's half of
 *  "does this body draw". ⛔ `get_*` is a read, not a write, and is excluded: a
 *  value helper like `getSlope(line) => line.get_y2(line) - …` draws nothing and
 *  must keep being resolved as a value. */
const writesObject = (method) => method === 'delete' || method.startsWith('set_')
  || method === 'cell' || method.startsWith('cell_set_') || method === 'clear'
  || method === 'merge_cells' || method === 'new'

/** Pine's own namespaces. ⛔ A dotted token under one of these is a built-in,
 *  never a method call on a script's handle — `color.new(…)` is not `x.new`. */
const KNOWN_NAMESPACES = new Set(['math', 'str', 'ta', 'color', 'request', 'array', 'matrix',
  'map', 'syminfo', 'timeframe', 'barstate', 'chart', 'input', 'strategy', 'runtime', 'log',
  'ticker', 'session', 'extend', 'xloc', 'yloc', 'size', 'text', 'position', 'shape',
  'location', 'display', 'plot', 'hline', 'format', 'currency', 'dayofweek', 'order', 'alert',
  'adjustment', 'font', 'scale', 'earnings', 'dividends', 'splits', 'polyline', 'time',
  'barmerge', 'backadjustment', 'settlement_as_close'])

const nsOf = (word) => {
  const dot = word.indexOf('.')
  return dot > 0 ? word.slice(0, dot) : null
}
const methodOf = (word) => word.slice(word.indexOf('.') + 1)

/** The index closing the bracket opened at `open`, or -1. */
function closeOf(toks, open) {
  let depth = 0
  for (let i = open; i < toks.length; i += 1) {
    const tk = toks[i]
    if (!tk || tk.kind !== 'punct') continue
    if (tk.value === '(' || tk.value === '[') depth += 1
    else if (tk.value === ')' || tk.value === ']') {
      depth -= 1
      if (depth === 0) return i
    }
  }
  return -1
}

/** Split a bracketed span `(a, b = c, …)` opened at `open` into argument token
 *  lists, each `{name, toks}`; null when it does not close. */
export function splitArgs(toks, open, isPunct) {
  const close = closeOf(toks, open)
  if (close < 0) return null
  const out = []
  let cur = []
  let depth = 0
  for (let i = open + 1; i < close; i += 1) {
    const tk = toks[i]
    if (tk.kind === 'punct') {
      if (tk.value === '(' || tk.value === '[') depth += 1
      else if (tk.value === ')' || tk.value === ']') depth -= 1
      else if (tk.value === ',' && depth === 0) { out.push(cur); cur = []; continue }
    }
    cur.push(tk)
  }
  if (cur.length || out.length) out.push(cur)
  return out.map((a) => {
    if (a.length >= 2 && a[0].kind === 'ident' && isPunct(a[1], '=')) {
      return { name: String(a[0].value), toks: a.slice(2) }
    }
    return { name: null, toks: a }
  })
}

/** Is this statement header a function or method DEFINITION? Returns
 *  `{name, isMethod, open, arrow}` or null. */
export function definitionHeader(t, h) {
  if (!t || t.length < 3 || t[0].kind !== 'ident') return null
  let i = 0
  let isMethod = false
  if (t[0].value === 'method' && t[1] && t[1].kind === 'ident') { i = 1; isMethod = true }
  if (!t[i + 1] || !h.isPunct(t[i + 1], '(')) return null
  const close = closeOf(t, i + 1)
  if (close < 0 || !t[close + 1] || !h.isPunct(t[close + 1], '=>')) return null
  return { name: String(t[i].value), isMethod, open: i + 1, arrow: close + 1 }
}

/** Every top-level function and method definition. ⭐ Pine allows a definition
 *  only at the top level, so the top-level statement list is the whole set. */
export function readFunctionDefs(stmts, h) {
  const defs = new Map()
  for (const st of stmts || []) {
    const t = st.header
    const head = definitionHeader(t, h)
    if (!head) continue
    const params = []
    const raw = splitArgs(t, head.open, h.isPunct) || []
    for (const seg of raw) {
      // `simple int len = 14`, `float src`, `line l` — the name is the LAST
      // identifier before any default. `splitArgs` has already peeled `name =`.
      if (seg.name !== null) {
        // `len = 14` (untyped with default): splitArgs read it as named.
        params.push({ name: seg.name, dflt: seg.toks })
        continue
      }
      const eq = seg.toks.findIndex((x) => h.isPunct(x, '='))
      const decl = eq >= 0 ? seg.toks.slice(0, eq) : seg.toks
      const idents = decl.filter((x) => x.kind === 'ident')
      if (!idents.length) continue
      params.push({ name: String(idents[idents.length - 1].value), dflt: eq >= 0 ? seg.toks.slice(eq + 1) : null })
    }
    const tail = t.slice(head.arrow + 1)
    // ⭐ A ONE-LINE BODY (`g(z) => label.new(…)`) is the tokens after `=>`; a
    // block body is the sub-statements. Both become one statement list.
    const body = tail.length ? [{ header: tail, sub: st.sub || [] }] : (st.sub || [])
    defs.set(head.name, { name: head.name, isMethod: head.isMethod, params, body, line: t[0].line })
  }
  return defs
}

/** Every token of a statement list, headers and bodies. */
function allTokens(stmts, out = []) {
  for (const s of stmts || []) {
    for (const tk of s.header || []) out.push(tk)
    if (s.sub && s.sub.length) allTokens(s.sub, out)
  }
  return out
}

/** Names of top-level collections that hold drawings — `var line[] ls =
 *  array.new_line()`, `ls = array.new<box>()`. A function that pushes into one
 *  of these draws even though no `line.` token appears in it. */
export function objectCollections(stmts, h) {
  const out = new Set()
  for (const st of stmts || []) {
    const t = st.header || []
    const eq = h.findTop(t, (x) => h.isPunct(x, '='))
    if (eq < 1) continue
    const rhs = t[eq + 1]
    if (!rhs || rhs.kind !== 'ident') continue
    const v = String(rhs.value)
    const fam = v.startsWith('array.new_') ? v.slice('array.new_'.length)
      : (v === 'array.new' && Array.isArray(rhs.typeArgs) ? String(rhs.typeArgs[0] || '') : null)
    if (!fam || !['line', 'label', 'box', 'linefill', 'table'].includes(fam)) continue
    const nameTok = t[eq - 1]
    if (nameTok && nameTok.kind === 'ident') out.add(String(nameTok.value))
  }
  return out
}

/** The subset of `defs` whose body WRITES a drawing — directly, through an
 *  object collection, or by calling another function that does. A fixpoint,
 *  because a helper may be defined below its first caller. */
export function drawingFunctions(defs, objColls) {
  const direct = (def) => {
    const toks = allTokens(def.body)
    for (let i = 0; i < toks.length; i += 1) {
      const tk = toks[i]
      if (tk.kind !== 'ident') continue
      const v = String(tk.value)
      const ns = nsOf(v)
      if (!ns) continue
      const m = methodOf(v)
      if (['line', 'label', 'box', 'table', 'linefill'].includes(ns)) {
        if (writesObject(m)) return true
        continue
      }
      if (ns === 'array') {
        // `array.push(ls, …)` on an object collection.
        const a = toks[i + 2]
        if (a && a.kind === 'ident' && objColls.has(String(a.value))) return true
        continue
      }
      if (KNOWN_NAMESPACES.has(ns)) continue
      if (objColls.has(ns)) return true
      // the method form on a handle: `ln.delete()`, `b.set_right(…)`
      if (writesObject(m) && m !== 'new') return true
    }
    return false
  }
  const out = new Set()
  for (const d of defs.values()) if (direct(d)) out.add(d.name)
  let grew = true
  while (grew) {
    grew = false
    for (const d of defs.values()) {
      if (out.has(d.name)) continue
      const toks = allTokens(d.body)
      for (let i = 0; i + 1 < toks.length; i += 1) {
        if (toks[i].kind === 'ident' && out.has(String(toks[i].value))
          && toks[i + 1].kind === 'punct' && toks[i + 1].value === '(') {
          out.add(d.name); grew = true; break
        }
      }
    }
  }
  return out
}

const DRAWN_FAMILIES = ['line', 'label', 'box', 'table', 'linefill']

/** ⭐⭐ WHAT A DRAWING FUNCTION'S BODY WOULD HAVE REMOVED, OR RE-LISTED, HAD IT RUN.
 *
 *  A REFUSED call (`objectFnInline` refuses a method, a call inside an
 *  expression, `var x = f()`, a conditional call that reads history, …) is ONE
 *  counted drop — but its body never becomes ops, so no other counter sees
 *  what the body held. The member door's partial-drawing rule (owner ruling
 *  2026-09-27, option b) refuses a drawing that lost anything which REMOVES an
 *  object, and a `line.delete(ln)` inside a refused helper removes exactly as
 *  much as a dropped top-level one. This is the loop-body question
 *  (`unconvertedLoopOps`) asked of a function body.
 *
 *  Read off TOKENS, transitively through the user functions and methods the
 *  body calls, because the body was never walked.
 *
 *  ⛔ FAIL-CLOSED WHERE THE TOKENS CANNOT NAME A FAMILY. `ln.delete()` and
 *  `t.clear()` on a handle report family `null`, which the door reads as
 *  "reaches something drawn" — never as "removes nothing". A method-form
 *  `.clear()` on a NUMERIC array is therefore read as a table clear: a louder
 *  answer than the truth, never a quieter one.
 *
 *  @returns {{kinds: Object<string, number>, families: (string|null)[]}}
 *    `kinds` counts reader op kinds (`delete`, `clear`, `coll_<method>`);
 *    `families` has one entry per removal, `null` when no family is named. */
export function bodyEffects(def, defs, objColls) {
  const kinds = {}
  const families = []
  const add = (k) => { kinds[k] = (kinds[k] || 0) + 1 }
  const seen = new Set()
  const visit = (d) => {
    if (!d || seen.has(d.name)) return
    seen.add(d.name)
    const toks = allTokens(d.body)
    for (let i = 0; i + 1 < toks.length; i += 1) {
      const tk = toks[i]
      const next = toks[i + 1]
      if (tk.kind !== 'ident' || next.kind !== 'punct' || next.value !== '(') continue
      const v = String(tk.value)
      const ns = nsOf(v)
      if (!ns) {
        const callee = defs.get(v)
        if (callee && !callee.isMethod) visit(callee)
        continue
      }
      const m = methodOf(v)
      if (DRAWN_FAMILIES.includes(ns)) {
        if (m === 'delete') { add('delete'); families.push(ns) } else if (ns === 'table' && m === 'clear') {
          add('clear'); families.push('table')
        }
        continue
      }
      if (ns === 'array') {
        const a = toks[i + 2]
        if (a && a.kind === 'ident' && objColls.has(String(a.value))) add(`coll_${m}`)
        continue
      }
      if (KNOWN_NAMESPACES.has(ns)) continue
      if (objColls.has(ns)) { add(`coll_${m}`); continue }
      // the method form on a handle, or a user METHOD whose body is read too
      if (m === 'delete') { add('delete'); families.push(null) } else if (m === 'clear') {
        add('clear'); families.push(null)
      }
      const method = defs.get(m)
      if (method && method.isMethod) visit(method)
    }
  }
  visit(def)
  return { kinds, families }
}

/** Keywords a `(` may follow without being a call — `if (a and b)`. */
const NOT_A_CALL = new Set(['if', 'for', 'while', 'switch', 'and', 'or', 'not', 'else',
  'to', 'by', 'in', 'var', 'varip', 'return'])

/** The first history read in these tokens, or null. `pureFns` are user
 *  functions already proven history-free; `methods` are user METHOD names (a
 *  method's body is not inlined, so it is assumed to read history). */
function historyIn(toks, drawFns, userFns, pureFns, methods) {
  for (let i = 0; i < toks.length; i += 1) {
    const tk = toks[i]
    if (tk.kind === 'punct' && tk.value === '[') {
      const prev = toks[i - 1]
      const next = toks[i + 1]
      // `line[]` is a TYPE, and a statement-initial `[a, b] =` is a destructure.
      if (next && next.kind === 'punct' && next.value === ']') continue
      if (!prev || prev.line !== tk.line) continue
      if (prev.kind === 'ident' || prev.kind === 'number'
        || (prev.kind === 'punct' && (prev.value === ')' || prev.value === ']'))) {
        return `a history read \`[…]\` at line ${tk.line}`
      }
      continue
    }
    if (tk.kind !== 'ident') continue
    const next = toks[i + 1]
    if (!next || next.kind !== 'punct' || next.value !== '(') continue
    const v = String(tk.value)
    if (NOT_A_CALL.has(v)) continue
    if (drawFns.has(v)) continue
    const ns = nsOf(v)
    if (ns && PURE_NAMESPACES.has(ns)) continue
    if (ns && !KNOWN_NAMESPACES.has(ns)) {
      // `pivot.new(…)` builds a user type; `arr.size()`, `l.get_x2()` read the
      // current state of a value this bar holds. None of them is history. A
      // USER METHOD is the exception — its body is not inlined, so it is
      // treated like any function this reader cannot see into.
      const m = methodOf(v)
      if (methods.has(m)) return `a call to the method \`${m}\`, which may read history, at line ${tk.line}`
      continue
    }
    if (!ns && PURE_BARE.has(v)) continue
    if (!ns && pureFns.has(v)) continue
    if (!ns && userFns.has(v)) return `a call to the user function \`${v}\`, which reads history, at line ${tk.line}`
    return `\`${v}\` at line ${tk.line}, which reads more than the current bar`
  }
  return null
}

/** User functions whose bodies read only the current bar — a fixpoint, since
 *  one may call another. */
export function pureFunctions(defs, drawFns) {
  const userFns = new Set([...defs.keys()].filter((n) => !defs.get(n).isMethod))
  const methods = new Set([...defs.keys()].filter((n) => defs.get(n).isMethod))
  const pure = new Set()
  let grew = true
  while (grew) {
    grew = false
    for (const n of userFns) {
      if (pure.has(n)) continue
      if (!historyIn(allTokens(defs.get(n).body), drawFns, userFns, pure, methods)) {
        pure.add(n); grew = true
      }
    }
  }
  return pure
}

/** Why this body cannot be inlined under a CONDITIONAL call, or null.
 *  See the header: a body that reads history measures a different set of bars
 *  when its call is conditional. */
export function historyReason(def, drawFns, userFns, pureFns = new Set(), methods = new Set()) {
  return historyIn(allTokens(def.body), drawFns, userFns, pureFns, methods)
}

/** Names a body DECLARES or ASSIGNS (all become per-call-site locals), and the
 *  subset that is MUTABLE — `var`/`varip`, `:=` targets, destructured parts. */
export function bodyNames(def, h) {
  const locals = new Set()
  const mutable = new Set()
  const walk = (list) => {
    for (const st of list || []) {
      const t = st.header || []
      if (!t.length) { walk(st.sub); continue }
      const w = t[0].kind === 'ident' ? t[0].value : null
      if (w === 'for' && t[1]) {
        if (t[1].kind === 'ident') { locals.add(String(t[1].value)); mutable.add(String(t[1].value)) }
        if (h.isPunct(t[1], '[')) {
          for (const x of t.slice(2)) {
            if (h.isPunct(x, ']')) break
            if (x.kind === 'ident') { locals.add(String(x.value)); mutable.add(String(x.value)) }
          }
        }
      } else if (h.isPunct(t[0], '[')) {
        const close = t.findIndex((x) => h.isPunct(x, ']'))
        const eq = close > 0 ? t.findIndex((x, xi) => xi > close && h.isPunct(x, '=')) : -1
        if (eq > close) {
          for (const x of t.slice(1, close)) {
            if (x.kind === 'ident') { locals.add(String(x.value)); mutable.add(String(x.value)) }
          }
        }
      } else {
        const re = h.findTop(t, (x) => h.isPunct(x, ':='))
        if (re > 0 && t[re - 1].kind === 'ident') {
          locals.add(String(t[re - 1].value)); mutable.add(String(t[re - 1].value))
        }
        const eq = h.findTop(t, (x) => h.isPunct(x, '='))
        if (eq > 0 && h.findTop(t, (x) => h.isPunct(x, '=>')) < 0) {
          const nameTok = w === 'var' || w === 'varip' ? t[eq - 1] : (h.boundName(t, eq) || null)
          if (nameTok && nameTok.kind === 'ident') {
            locals.add(String(nameTok.value))
            if (w === 'var' || w === 'varip') mutable.add(String(nameTok.value))
          }
        }
      }
      if (st.sub && st.sub.length) walk(st.sub)
    }
  }
  walk(def.body)
  return { locals, mutable }
}

/**
 * Bind a call's arguments to the definition's parameters.
 * @returns {{bind: Map<string, object[]>}|{error: string}}
 */
export function bindArgs(def, args) {
  const bind = new Map()
  const positional = args.filter((a) => a.name === null)
  if (positional.length > def.params.length) return { error: 'arity' }
  positional.forEach((a, i) => bind.set(def.params[i].name, a.toks))
  for (const a of args) {
    if (a.name === null) continue
    if (!def.params.some((p) => p.name === a.name)) return { error: 'arity' }
    bind.set(a.name, a.toks)
  }
  for (const p of def.params) {
    if (bind.has(p.name)) continue
    if (!p.dflt || !p.dflt.length) return { error: 'arity' }
    bind.set(p.name, p.dflt)
  }
  for (const toks of bind.values()) if (!toks || !toks.length) return { error: 'arity' }
  return { bind }
}

/**
 * The body, rewritten for ONE call site: locals renamed with `suffix`,
 * parameters replaced by their argument tokens.
 *
 * ⛔ A NAMED-ARGUMENT KEY IS NOT A NAME. `line.new(…, color = c)` inside a body
 * whose parameter is ALSO called `color` must keep the key and substitute only
 * the value — `mtf-watchlist` passes `color`, `style`, `text` and `size` exactly
 * that way.
 * ⛔ A NAMESPACE IS NOT A NAME EITHER. `color.red` inside that same body is the
 * built-in namespace, never the parameter `color`; only a dotted token whose
 * first segment the body itself declared (or a parameter bound to a single
 * identifier) is rewritten.
 *
 * @returns {{stmts: object[]}|{error: string}}
 */
export function rewriteBody(def, bind, locals, suffix, h, meta) {
  let error = null
  const cloneTok = (tk, value) => ({ ...tk, value })
  const rwHeader = (t) => {
    const out = []
    let depth = 0
    for (let i = 0; i < t.length; i += 1) {
      const tk = t[i]
      if (tk.kind === 'punct') {
        if (tk.value === '(' || tk.value === '[') depth += 1
        else if (tk.value === ')' || tk.value === ']') depth -= 1
        out.push(tk)
        continue
      }
      if (tk.kind !== 'ident') { out.push(tk); continue }
      const v = String(tk.value)
      const prev = t[i - 1]
      const next = t[i + 1]
      const isKey = depth > 0 && next && h.isPunct(next, '=')
        && prev && (h.isPunct(prev, '(') || h.isPunct(prev, ','))
      if (isKey) { out.push(tk); continue }
      const dot = v.indexOf('.')
      if (dot > 0) {
        const seg = v.slice(0, dot)
        const rest = v.slice(dot)
        // ⛔ `color.new(…)` in a body whose parameter is named `color` is the
        // NAMESPACE — Pine resolves a built-in namespace before a variable.
        if (KNOWN_NAMESPACES.has(seg) || ['line', 'label', 'box', 'table', 'linefill'].includes(seg)) {
          out.push(tk)
          continue
        }
        if (bind.has(seg) && !locals.has(seg)) {
          const arg = bind.get(seg)
          if (arg.length === 1 && arg[0].kind === 'ident') { out.push(cloneTok(tk, String(arg[0].value) + rest)); continue }
          error = error || `receiver:${seg}`
          out.push(tk)
          continue
        }
        if (locals.has(seg)) { out.push(cloneTok(tk, seg + suffix + rest)); continue }
        out.push(tk)
        continue
      }
      if (bind.has(v) && !locals.has(v)) {
        const arg = bind.get(v)
        if (arg.length === 1) { out.push(arg[0]); continue }
        out.push({ kind: 'punct', value: '(', line: arg[0].line, column: arg[0].column, index: arg[0].index })
        for (const a of arg) out.push(a)
        const last = arg[arg.length - 1]
        out.push({ kind: 'punct', value: ')', line: last.line, column: last.column, index: last.index })
        continue
      }
      if (locals.has(v)) { out.push(cloneTok(tk, v + suffix)); continue }
      out.push(tk)
    }
    return out
  }
  const rwList = (list) => (list || []).map((st) => ({
    header: rwHeader(st.header || []),
    sub: rwList(st.sub),
    synthetic: meta,
  }))
  const stmts = rwList(def.body)
  return error ? { error } : { stmts }
}

/** Is `name(` called anywhere in these tokens? Returns the first name found. */
export function callsAny(toks, names) {
  for (let i = 0; i + 1 < (toks || []).length; i += 1) {
    const tk = toks[i]
    if (tk.kind === 'ident' && names.has(String(tk.value))
      && toks[i + 1].kind === 'punct' && toks[i + 1].value === '(') return String(tk.value)
  }
  return null
}

/** A method-form call to one of `names` (`x.m(`) anywhere in these tokens. */
export function callsMethodAny(toks, names) {
  for (let i = 0; i + 1 < (toks || []).length; i += 1) {
    const tk = toks[i]
    if (tk.kind !== 'ident') continue
    const v = String(tk.value)
    const dot = v.lastIndexOf('.')
    if (dot > 0 && names.has(v.slice(dot + 1))
      && toks[i + 1].kind === 'punct' && toks[i + 1].value === '(') return v.slice(dot + 1)
  }
  return null
}
