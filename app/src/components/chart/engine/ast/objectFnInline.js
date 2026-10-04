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
// ⭐⭐ A METHOD (`method m(...) =>`) THAT DRAWS IS INLINED LIKE A FUNCTION (2026-09-27).
// `recv.m(a, b)` IS `m(recv, a, b)` — Pine's own definition of the method form —
// so the receiver binds to the FIRST parameter and everything above applies.
// Measured against TradingView the day it landed: Zero-Lag MA Trend Levels
// draws all 18 of its trend boxes through `up.draw_box(…)`.
// ⛔ WHAT STILL REFUSES `method`, BY NAME: a method defined MORE THAN ONCE (an
// overload — Pine dispatches on the receiver's type, and this reader has no
// type system to choose a body with), a method named like a built-in object or
// collection method called on a declared drawing handle or list (Pine could be
// meaning the built-in), and `copy` (every user type has a built-in one).
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
  'log',
  // ⭐ C34 — a map or a matrix is a collection this bar holds, as an array is.
  'map', 'matrix'])
/** Bare (un-namespaced) calls that read only the current bar — Pine v4's math
 *  spellings and the type casts. `fixnan` is deliberately ABSENT: it carries the
 *  last non-na value forward, which is history. */
const PURE_BARE = new Set(['na', 'nz', 'int', 'float', 'bool', 'string', 'tostring',
  'abs', 'max', 'min', 'round', 'floor', 'ceil', 'sqrt', 'pow', 'log', 'log10', 'exp',
  'sign', 'avg', 'iff', 'timestamp', 'color', 'rgb',
  // ⭐ C42 — the CLOCK functions: `time(tf, session, …)`, `time_close(…)` and the
  // calendar readers answer from the bar's own timestamp and their arguments;
  // none keeps a history a conditional call could starve. (`time[k]` — the
  // SERIES at an offset — is a different read, judged by `historyIn`'s `[`.)
  'time', 'time_close', 'year', 'month', 'weekofyear', 'dayofmonth', 'dayofweek',
  'hour', 'minute', 'second'])

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

/**
 * ⭐⭐ SEVERAL STATEMENTS ON ONE LINE, SEPARATED BY COMMAS — split into one
 * statement each, as Pine runs them.
 *
 * Pine lets a line hold several statements joined by `,`; v4 function bodies
 * are written that way almost by convention:
 *
 *     f_print(_txt) => var _lbl = label(na), label.delete(_lbl), _lbl := label.new(…)
 *
 * `blockStatements` already splits a line whose segments are ALL bindings
 * (`a = 1, b = 2`) and deliberately leaves any other comma line whole, because
 * the plot lane cannot say which segment is an output. The OBJECT reader can,
 * and reading the whole line as one statement cost it exactly the part that
 * matters: in the one-line body above only the LAST statement survived — the
 * `var` handle became a per-bar local and the `label.delete` vanished.
 *
 * ⚰️ MEASURED against TradingView (2026-09-28, NYSE:RDDT 1D):
 * `position-size-calculator` defines four printers in that shape and the
 * vendor holds FOUR labels (one per call site, each deleting its predecessor);
 * we held FIFTY — every label ever made, up to the default cap.
 * `extrapolated-pivot-connector` writes
 * `label.delete(ahigh[1]),label.delete(bhigh[1]),…` at the top level too.
 *
 * ⛔ ONLY A STATEMENT WITH NO BLOCK BENEATH IT, and never a DEFINITION header
 * or one carrying a top-level `=>` (a switch arm, a definition): a body belongs
 * to the line as a whole, and the arrow's right-hand side is not a list of
 * statements to this reader. Commas inside `(…)`/`[…]` are arguments and tuple
 * members and never split — the same depth rule `findTop` uses.
 */
export function splitCommaStatements(list, h) {
  let out = null
  for (let i = 0; i < (list || []).length; i += 1) {
    const st = list[i]
    const parts = commaParts(st, h)
    if (parts && !out) out = list.slice(0, i)
    if (parts) for (const header of parts) out.push({ header, body: [], sub: [] })
    else if (out) out.push(st)
  }
  return out || list || []
}

function commaParts(st, h) {
  const t = st && st.header
  if (!t || !t.length || (st.sub && st.sub.length)) return null
  if (definitionHeader(t, h)) return null
  const parts = []
  let depth = 0
  let start = 0
  for (let i = 0; i < t.length; i += 1) {
    const tk = t[i]
    if (tk.kind !== 'punct') continue
    if (tk.value === '(' || tk.value === '[') depth += 1
    else if (tk.value === ')' || tk.value === ']') depth -= 1
    else if (depth === 0 && tk.value === '=>') return null
    else if (depth === 0 && tk.value === ',') { parts.push(t.slice(start, i)); start = i + 1 }
  }
  if (!parts.length) return null
  parts.push(t.slice(start))
  // ⛔ AN EMPTY SEGMENT (`a, , b` or a trailing comma) is not a statement this
  // reader can name, so the line is left whole rather than half-read.
  return parts.every((x) => x.length) ? parts : null
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
    // ⭐ Either form may join several statements with commas — see
    // `splitCommaStatements`.
    const body = splitCommaStatements(tail.length ? [{ header: tail, sub: st.sub || [] }] : (st.sub || []), h)
    // ⛔ A NAME DEFINED TWICE IS AN OVERLOAD — Pine picks the body by the
    // receiver's (or first argument's) TYPE, which this reader cannot see. The
    // Map keeps only the last body, so the flag is what stops the inliner from
    // running a body Pine might not have chosen (`inlineCall` refuses it).
    const overloaded = defs.has(head.name)
    defs.set(head.name, {
      name: head.name, isMethod: head.isMethod, params, body, line: t[0].line,
      ...(overloaded ? { overloaded: true } : {}),
    })
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
 *  ⭐ AND WHAT IT WOULD HAVE CREATED (`creates`, C13 2026-09-29). A create
 *  that never runs changes which objects Pine's collector cuts once the family
 *  reaches its cap (`objectRuntime.js`, `lostCreates`), so the families a
 *  refused body would have created are reported beside the ones it would have
 *  removed. A create in a body whose family the tokens cannot name (a user
 *  method's `.new` on a type) is not guessed: only `line.new`/`label.new`/
 *  `box.new`/… name one, and a refused call to a function this reader cannot
 *  find reports an unnamed family in `pine.js`.
 *
 *  @returns {{kinds: Object<string, number>, families: (string|null)[], creates: string[]}}
 *    `kinds` counts reader op kinds (`delete`, `clear`, `coll_<method>`);
 *    `families` has one entry per removal, `null` when no family is named;
 *    `creates` has one entry per drawing constructor the body names. */
/** ⭐ C16 — the array methods that CHANGE an array (Pine reference). */
const ARRAY_MUTATORS = new Set(['push', 'set', 'remove', 'clear', 'pop', 'shift',
  'unshift', 'insert', 'reverse', 'sort', 'fill', 'concat'])

export function bodyEffects(def, defs, objColls) {
  const kinds = {}
  const families = []
  const creates = []
  // ⭐ C16 — the drawing collections the body CHANGES, by name: a refused call
  // leaves each one diverged from TradingView's (`divergedColls` in pine.js).
  const colls = []
  // ⭐ C45 — every `<family>.set_*` the body calls, `[family | null, method]`
  // (`null`: the method form on a handle, `l.set_xy1(…)`): a refused body's
  // setters never ran, so the objects they would have moved or re-captioned are
  // not TradingView's (`pine.js`, `lostUnaddressed`).
  const setters = []
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
        } else if (m === 'new') creates.push(ns)
        else if (m.startsWith('set_')) setters.push([ns, m])
        continue
      }
      if (ns === 'array') {
        const a = toks[i + 2]
        if (a && a.kind === 'ident' && objColls.has(String(a.value))) {
          add(`coll_${m}`)
          if (ARRAY_MUTATORS.has(m)) colls.push(String(a.value))
        }
        continue
      }
      if (KNOWN_NAMESPACES.has(ns)) continue
      if (objColls.has(ns)) {
        add(`coll_${m}`)
        if (ARRAY_MUTATORS.has(m)) colls.push(ns)
        continue
      }
      // the method form on a handle, or a user METHOD whose body is read too
      if (m === 'delete') { add('delete'); families.push(null) } else if (m === 'clear') {
        add('clear'); families.push(null)
      } else if (m.startsWith('set_')) setters.push([null, m])
      const method = defs.get(m)
      if (method && method.isMethod) visit(method)
    }
  }
  visit(def)
  return { kinds, families, creates, colls, ...(setters.length ? { setters } : {}) }
}

/** Keywords a `(` may follow without being a call — `if (a and b)`. */
const NOT_A_CALL = new Set(['if', 'for', 'while', 'switch', 'and', 'or', 'not', 'else',
  'to', 'by', 'in', 'var', 'varip', 'return'])

// ─── ⭐⭐ C34 — WHOSE HISTORY A CONDITIONAL CALL READS (2026-09-30) ──────────
//
// Pine keeps ONE history per call site for what the FUNCTION owns — its locals,
// its parameters, the state inside a `ta.*` call it makes — and that history
// advances only on the bars the call runs. That is what `conditional-history`
// refuses, and it still does. But the detector below also refused reads that
// are not the call's history at all:
//
//  • ⭐ THE CHART'S OWN SERIES. `low[k]` inside a body is the chart's low `k`
//    bars ago whether or not the call ran on the bars between: the series is
//    the chart's, kept by the chart on every bar. ⚰️ WITNESSED, not assumed —
//    `trend-lines-supports-and-resistances` (NYSE:RDDT 1D, committed capture
//    `trend-lines-supports-and-resistances-rddt-1d-2026-09-28`) calls
//    `f_drawSupport` / `f_drawResistance` ONLY on the last bar (under
//    `barstate.islast`, inside a `while`), and each reads
//    `low[historyReference]`, `high[…]`, `open[…]`, `close[…]` 40 to 257 bars
//    back. Had those reads been the CALL's history (one execution, none before
//    it) every one would be `na`. TradingView drew four boxes whose edges are
//    exactly the chart's values at the pivot bars — `119.27 / 122.5` (low /
//    min(open, close), bar 506), `135.2223 / 140.67` (bar 591), `263.4999 /
//    257.67` (high / max(open, close), bar 452), `282.95 / 271.99` (bar 374) —
//    and printed them in four label texts. `vendorHarness.c34ChartSeries` replays
//    it. ⛔ ONLY a series a capture reads this way passes (`CHART_SERIES_WITNESSED`
//    — these four here, the rest by C42 and C48); `bar_index` is witnessed NOT to
//    be the chart's inside a call (`CALL_OWNED_SERIES`).
//    ⛔ And only when the name IS the built-in: a parameter, a body local, or any
//    script name spelled `low` is the script's own series and refuses as before.
//  • ⭐ A KEYWORD BEFORE `[` IS NOT A SERIES. `for [i, v] in line.all` is a
//    destructure and `for x in [a, b]` an array literal; both were read as a
//    history offset on the keyword (`f_clearAll`, the same script, line 258).
//  • ⭐ A BUILT-IN METHOD ON A CHAINED VALUE. `arr.pop().delete()`,
//    `lns.get(0).set_x2(t)`, `hl.lbl.get(0).get_y()` act on the value this bar
//    holds, exactly as the un-chained `l.get_x2()` does (already admitted); the
//    chained segment lexes as a MEMBER token and fell to "reads more than the
//    current bar" (`ict-killzones-pivots-tfo`, 16 calls). A user METHOD named in
//    the chain is still judged as one.
//  • ⭐ `map.*` AND `matrix.*` read and write the collection this bar holds, as
//    `array.*` does — a collection has no series history of its own.
//  • ⭐ A USER METHOD whose body reads only the current bar is pure, by the same
//    fixpoint as a function (an OVERLOADED method never is — its body is not
//    decidable from the tokens). A method that DRAWS is judged where it is
//    inlined, under the same guards, as a drawing function already is.

/** ⭐ C34 — the chart series a conditional call's body may read at an offset.
 *  Each one WITNESSED (see the section above).
 *  ⭐ C42 — `volume`, `time`, `hl2`, `hlc3`, `ohlc4`: capture
 *  `vw-fn-series-history-rddt-1d-2026-09-30`, rows S01 / S03–S06 — a helper
 *  called only on the last bar prints each at k = 5, 40 and 200, and all fifteen
 *  labels are the capture's own bars `k` back (`vendorHarness.c42OneExecution`).
 *  ⭐ C48 — `time_close`, `hlcc4`: capture `vw-call-site-history-{rddt,spy}-1d-
 *  2026-10-01`, rows B02 / B03 — the last-bar helper prints `time_close[5]` and
 *  `hlcc4[5]` as the capture's own bar five back on both charts; and row H06
 *  (`volume[1]` in a helper called under `close > open`) is the previous BAR's
 *  volume on every bar the call runs (280 / 280, 941 / 941) — the chart's, not
 *  the call's (`vendorHarness.c48CallSite`). */
export const CHART_SERIES_WITNESSED = new Set(['open', 'high', 'low', 'close',
  'volume', 'time', 'hl2', 'hlc3', 'ohlc4', 'time_close', 'hlcc4'])
/** ⛔⛔ C42 — `bar_index` IS NOT THE CHART'S IN A CONDITIONAL CALL. Row S02 of the
 *  same capture: `bar_index[k]` inside the last-bar helper prints `NaN` at all
 *  three offsets, where the chart's value is 628 / 593 / 433. It answers like the
 *  call's OWN history (nothing before the call's first run), so it is carried
 *  only where a parameter's or a local's history is — a call that runs exactly
 *  once (`oneExecutionBody`) — and refuses for every other varying guard. */
export const CALL_OWNED_SERIES = new Set(['bar_index'])

/** The first history read in these tokens, or null. `pureFns` are user
 *  functions (and methods) already proven history-free; `methods` are user
 *  METHOD names; `chart` the witnessed chart series this body may read at an
 *  offset (empty unless the caller proved no script name shadows them);
 *  `drawMethods` user methods that DRAW — judged where they are inlined. */
function historyIn(toks, drawFns, userFns, pureFns, methods, chart = EMPTY_SET, drawMethods = EMPTY_SET) {
  const methodVerdict = (m, line) => {
    if (pureFns.has(m) || drawMethods.has(m)) return null
    return `a call to the method \`${m}\`, which may read history, at line ${line}`
  }
  for (let i = 0; i < toks.length; i += 1) {
    const tk = toks[i]
    if (tk.kind === 'punct' && tk.value === '[') {
      const prev = toks[i - 1]
      const next = toks[i + 1]
      // `line[]` is a TYPE, and a statement-initial `[a, b] =` is a destructure.
      if (next && next.kind === 'punct' && next.value === ']') continue
      if (!prev || prev.line !== tk.line) continue
      // ⭐ C34 — `for [i, v] in …`, `in [a, b]`: a keyword holds no series.
      if (prev.kind === 'ident' && !prev.member && NOT_A_CALL.has(String(prev.value))) continue
      // ⭐ C34 — the chart's own series, witnessed (see the section above).
      if (prev.kind === 'ident' && !prev.member && chart.has(String(prev.value))) continue
      // ⛔ C42 — witnessed NOT to be the chart's: see `CALL_OWNED_SERIES`.
      if (prev.kind === 'ident' && !prev.member && CALL_OWNED_SERIES.has(String(prev.value))) {
        return `a history read \`${prev.value}[…]\` at line ${tk.line} — inside a conditional call \`${prev.value}\` answers like the call's own history (\`na\` on the call's first run, capture \`vw-fn-series-history\`), which is carried only for a call that runs once`
      }
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
    // ⭐ C34 — a chained segment (`….delete(`, `….get_y(`): a built-in method
    // on the value this bar holds, unless the script defines a method so named.
    if (tk.member) {
      if (methods.has(v)) {
        const why = methodVerdict(v, tk.line)
        if (why) return why
      }
      continue
    }
    if (NOT_A_CALL.has(v)) continue
    if (drawFns.has(v)) continue
    const ns = nsOf(v)
    if (ns && PURE_NAMESPACES.has(ns)) continue
    if (ns && !KNOWN_NAMESPACES.has(ns)) {
      // `pivot.new(…)` builds a user type; `arr.size()`, `l.get_x2()` read the
      // current state of a value this bar holds. None of them is history. A
      // USER METHOD is the exception — judged by its own body (C34).
      const m = methodOf(v)
      if (methods.has(m)) {
        const why = methodVerdict(m, tk.line)
        if (why) return why
      }
      continue
    }
    if (!ns && PURE_BARE.has(v)) continue
    if (!ns && pureFns.has(v)) continue
    if (!ns && methods.has(v)) {
      const why = methodVerdict(v, tk.line)
      if (why) return why
      continue
    }
    if (!ns && userFns.has(v)) return `a call to the user function \`${v}\`, which reads history, at line ${tk.line}`
    return `\`${v}\` at line ${tk.line}, which reads more than the current bar`
  }
  return null
}

const EMPTY_SET = new Set()

/** ⭐ C34 — every name the script binds anywhere: a declaration or `:=` target,
 *  a destructured part, a loop variable, a function's parameter. A witnessed
 *  chart series spelled like one of them is the SCRIPT's name, not the chart's. */
export function scriptBoundNames(stmts, h) {
  const out = new Set()
  const scan = (list) => {
    for (const st of list || []) {
      const t = st.header || []
      const def = t.length ? definitionHeader(t, h) : null
      if (def) {
        for (const tk of t.slice(def.open + 1, def.arrow)) if (tk.kind === 'ident') out.add(String(tk.value))
      }
      for (let i = 1; i < t.length; i += 1) {
        if (t[i].kind === 'punct' && (t[i].value === '=' || isMutator(t[i])) && t[i - 1].kind === 'ident') {
          out.add(String(t[i - 1].value))
        }
      }
      const lead = t.length && t[0].kind === 'ident' && t[0].value === 'for' ? 1 : 0
      if (t[lead] && h.isPunct(t[lead], '[')) {
        for (let i = lead + 1; i < t.length && !h.isPunct(t[i], ']'); i += 1) {
          if (t[i].kind === 'ident') out.add(String(t[i].value))
        }
      } else if (lead && t[1] && t[1].kind === 'ident') out.add(String(t[1].value))
      if (st.sub && st.sub.length) scan(st.sub)
    }
  }
  scan(stmts)
  return out
}

/** ⭐ C34 — the witnessed chart series this script's bodies may read at an
 *  offset: all of them, minus any the script binds. `null` context → none. */
export function chartSeriesFor(stmts, h) {
  if (!stmts || !h) return EMPTY_SET
  const bound = scriptBoundNames(stmts, h)
  return new Set([...CHART_SERIES_WITNESSED].filter((n) => !bound.has(n)))
}

/** User functions AND methods whose bodies read only the current bar — a
 *  fixpoint, since one may call another. ⛔ An overloaded method never
 *  qualifies. `chart` / `drawMethods` as in `historyIn`. */
export function pureFunctions(defs, drawFns, chart = EMPTY_SET, drawMethods = EMPTY_SET) {
  const userFns = new Set([...defs.keys()].filter((n) => !defs.get(n).isMethod))
  const methods = new Set([...defs.keys()].filter((n) => defs.get(n).isMethod))
  const pure = new Set()
  let grew = true
  while (grew) {
    grew = false
    for (const n of defs.keys()) {
      const d = defs.get(n)
      if (pure.has(n) || (d.isMethod && d.overloaded)) continue
      if (!historyIn(allTokens(d.body), drawFns, userFns, pure, methods, chart, drawMethods)) {
        pure.add(n); grew = true
      }
    }
  }
  return pure
}

// ─── ⭐⭐ A GUARD THAT CANNOT CHANGE FROM BAR TO BAR (C13, 2026-09-29) ────────
//
// The conditional-history refusal exists because a function's series history
// advances only on the bars its call RUNS. That is a statement about guards
// that VARY. A guard built only from inputs and constants — `if tfbool`,
// `if i_q`, `if i_t and not hideTable` — holds on every bar or on none: the
// call runs on every bar (its history is the every-bar history the columnar
// model computes) or never runs at all (its ops never fire, and no history is
// read). Either way inlining it is exact, and refusing it threw away a
// drawing Pine draws identically.
//
// ⚰️ MEASURED 2026-09-29: `high-low-open-mid-ranges` (NYSE:RDDT 1D) calls its
// range helpers under `if tfbool` / `if i_q` / `if i_t` — three `input.bool`s —
// and 44 of its calls were refused as conditional-history. TradingView holds
// 504 lines and 504 labels from exactly those calls.
//
// ⛔ AN ALLOWLIST, NEVER A DENYLIST, and every rule fails CLOSED:
//   • a name is invariant only if it is declared ONCE in the WHOLE tree, at the
//     TOP LEVEL, from an `input.*` call (never `input.source` — that is a
//     series — and never a bare `input(…)`, which v4 uses for sources too), a
//     literal, a constant (`color.red`, `extend.right`), a pure call over
//     those, or other invariant names — and is NEVER reassigned anywhere
//     (`:=`, `+=`, …), never a destructure target (`[a, b] = …`) and never a
//     `for … in` variable. A second declaration ANYWHERE (a block local, a
//     function-body local of the same spelling) excludes the name, so no
//     block-local can shadow an invariant one at a call site;
//   • a guard is invariant only if every one of its tokens is such an atom. A
//     `[` (history, or an array literal), `:=`, an unknown call, or a series
//     name (`close`, `bar_index`, `barstate.*`, `time`) makes it variant;
//   • an EMPTY guard — the walk's "unreadable" marker — is variant.

/** Namespaces whose dotted, UNCALLED members are constants for the whole run. */
const CONSTANT_NAMESPACES = new Set(['color', 'extend', 'xloc', 'yloc', 'size', 'position',
  'text', 'shape', 'location', 'display', 'format', 'dayofweek', 'font', 'plot', 'hline',
  'line', 'label', 'box', 'currency', 'order', 'alert', 'barmerge', 'scale', 'adjustment',
  'syminfo', 'timeframe'])
/** `timeframe.*` members that vary bar to bar despite the namespace. */
const VARYING_CONSTANT_MEMBERS = new Set(['timeframe.change'])
/** Calls whose result is invariant when every argument is. ⛔ `math.random` is
 *  the one `math.*` that is not a function of its arguments. */
const INVARIANT_CALLS = new Set(['color.new', 'color.rgb', 'color.r', 'color.g', 'color.b',
  'color.t', 'int', 'float', 'bool', 'string', 'nz', 'na'])
const INVARIANT_CALL_NAMESPACES = new Set(['math', 'str'])
/** `input.*` kinds that return a SIMPLE value. ⛔ `input.source` is a series. */
const INVARIANT_INPUTS = new Set(['input.bool', 'input.int', 'input.float', 'input.string',
  'input.color', 'input.timeframe', 'input.session', 'input.symbol', 'input.text_area',
  'input.price', 'input.time', 'input.enum'])
const INVARIANT_WORDS = new Set(['true', 'false', 'na', 'and', 'or', 'not'])
/** Punctuation that combines values without reading another bar or writing a name. */
const INVARIANT_PUNCT = new Set(['(', ')', ',', '?', ':', '==', '!=', '<', '>', '<=', '>=',
  '+', '-', '*', '/', '%', '='])
export const isMutator = (tk) => tk && tk.kind === 'punct' && typeof tk.value === 'string'
  && tk.value.length >= 2 && tk.value.endsWith('=')
  && !['==', '!=', '<=', '>=', '=>'].includes(tk.value)

/** Is every token in `toks[from, to)` an invariant atom? `names` are the
 *  invariant names. */
function allInvariant(toks, from, to, names) {
  for (let i = from; i < to; i += 1) {
    const tk = toks[i]
    if (!tk) return false
    if (tk.kind === 'number' || tk.kind === 'string' || tk.kind === 'colour') continue
    if (tk.kind === 'punct') {
      if (!INVARIANT_PUNCT.has(tk.value)) return false
      continue
    }
    if (tk.kind !== 'ident' || tk.member) return false
    const v = String(tk.value)
    const next = toks[i + 1]
    const called = next && next.kind === 'punct' && next.value === '('
    if (called) {
      if (INVARIANT_INPUTS.has(v)) {
        // ⭐ The value of an input is fixed for the run whatever its
        // arguments say (a title, an `options=[…]` list, a tooltip).
        const close = closeOf(toks, i + 1)
        if (close < 0 || close >= to) return false
        i = close
        continue
      }
      // ⭐ C42 — a bare `input(<literal>, …)` is a simple input too: its default
      // is a number, a string or `true` / `false` written into the call, so it
      // cannot be the v4 SOURCE form (`input(close, …)`), which stays excluded.
      // ⚰️ MEASURED: `show_equal_highlow = input(true, …)` guarding
      // `high_eqh := ta.pivothigh(…)` (smart-money-concepts-by-welotrades) read as
      // a guard that varies, and the conditional-call mark refused four drawings
      // of a block that runs on every bar.
      if (v === 'input') {
        const first = toks[i + 2]
        const after = toks[i + 3]
        const literal = first && (first.kind === 'number' || first.kind === 'string'
          || (first.kind === 'ident' && !first.member && (first.value === 'true' || first.value === 'false')))
        const ends = after && after.kind === 'punct' && (after.value === ',' || after.value === ')')
        const close = closeOf(toks, i + 1)
        if (!literal || !ends || close < 0 || close >= to) return false
        i = close
        continue
      }
      const ns = nsOf(v)
      if (INVARIANT_CALLS.has(v) || (ns && INVARIANT_CALL_NAMESPACES.has(ns) && v !== 'math.random')) continue
      return false
    }
    if (INVARIANT_WORDS.has(v)) continue
    if (names.has(v)) continue
    const ns = nsOf(v)
    if (ns && CONSTANT_NAMESPACES.has(ns) && !VARYING_CONSTANT_MEMBERS.has(v)) continue
    return false
  }
  return true
}

/** ⭐ Every top-level name whose value is fixed for the whole run. See the
 *  section header above for the rules, each of which fails closed. */
export function barInvariantNames(stmts, h) {
  const declared = new Map()
  const mutated = new Set()
  const scan = (list, top) => {
    for (const st of list || []) {
      const t = st.header || []
      for (let i = 1; i < t.length; i += 1) {
        if (isMutator(t[i]) && t[i - 1] && t[i - 1].kind === 'ident') mutated.add(String(t[i - 1].value))
      }
      // `[a, b] = …` anywhere, and `for x in` / `for [i, v] in`: names bound
      // without a `name =` this scan reads — excluded outright.
      const lead = t.length && t[0].kind === 'ident' && t[0].value === 'for' ? 1 : 0
      if (t[lead] && h.isPunct(t[lead], '[')) {
        for (let i = lead + 1; i < t.length && !h.isPunct(t[i], ']'); i += 1) {
          if (t[i].kind === 'ident') mutated.add(String(t[i].value))
        }
      } else if (lead && t[1] && t[1].kind === 'ident') {
        mutated.add(String(t[1].value))
      }
      const eq = t.length ? h.findTop(t, (x) => h.isPunct(x, '=')) : -1
      if (eq > 0 && h.findTop(t, (x) => h.isPunct(x, '=>')) < 0) {
        const nameTok = h.boundName(t, eq)
        if (nameTok) {
          const nm = String(nameTok.value)
          const prev = declared.get(nm)
          declared.set(nm, prev ? { twice: true } : { top, t, eq })
        }
      }
      if (st.sub && st.sub.length) scan(st.sub, false)
    }
  }
  scan(stmts, true)
  const names = new Set()
  let grew = true
  while (grew) {
    grew = false
    for (const [nm, d] of declared) {
      if (names.has(nm) || d.twice || !d.top || mutated.has(nm)) continue
      if (d.eq + 1 >= d.t.length) continue
      if (allInvariant(d.t, d.eq + 1, d.t.length, names)) { names.add(nm); grew = true }
    }
  }
  return names
}

/** ⭐ Does this guard hold the same value on every bar? `names` comes from
 *  `barInvariantNames`, which already excludes any name declared twice, so a
 *  block local can never be mistaken for the input it shares a spelling with. */
export function guardIsBarInvariant(toks, names) {
  if (!toks || !toks.length) return false
  return allInvariant(toks, 0, toks.length, names)
}

/** ⭐ C14 — `toks[from..]` is exactly one getter on a NAMED handle:
 *  `label.get_y(l)` or `l.get_y()`. Which handle and which property are real is
 *  the converter's question (`getterRef`); this reads only the shape. */
const GETTER_FN_RE = /^(line|label|box)\.get_[a-z0-9_]+$/
const GETTER_METHOD_RE = /^[A-Za-z_][A-Za-z0-9_]*\.get_[a-z0-9_]+$/
export function isBareGetterAt(toks, from, h) {
  const t = toks || []
  const n = t.length - from
  const head = t[from]
  if (!head || head.kind !== 'ident' || !h.isPunct(t[from + 1], '(')) return false
  const name = String(head.value)
  if (n === 4 && GETTER_FN_RE.test(name)) {
    const a = t[from + 2]
    return !!a && a.kind === 'ident' && !String(a.value).includes('.') && h.isPunct(t[from + 3], ')')
  }
  return n === 3 && GETTER_METHOD_RE.test(name) && !GETTER_FN_RE.test(name) && h.isPunct(t[from + 2], ')')
}

/** `toks[from..]` is a numeric literal or `na` → `{init}` (null for `na`), else null. */
export function literalInit(t, from, h) {
  const rest = t.slice(from)
  if (rest.length === 1 && rest[0].kind === 'ident' && rest[0].value === 'na') return { init: null }
  if (rest.length === 1 && rest[0].kind === 'number' && Number.isFinite(Number(rest[0].value))) {
    return { init: Number(rest[0].value) }
  }
  if (rest.length === 2 && h.isPunct(rest[0], '-') && rest[1].kind === 'number') {
    return { init: -Number(rest[1].value) }
  }
  return null
}

/**
 * ⭐⭐ C14 — NAMES THAT HOLD A NUMBER READ OFF A DRAWING.
 *
 * `rsi-swing-indicator` writes `last_actual_label_hh_price := label.get_y(labelhh)`
 * inside an `if` and reads it in a label's text; `labelll_ts = label.get_x(labelll)`
 * is a block local its `line.new` reads as `x2`. Both are exact when the object
 * RUNTIME holds them as a scalar written at the statement's place in the bar —
 * the getter answers what the program last set on that object.
 *
 * ⛔ A NAME QUALIFIES ONLY WHEN EVERY WRITE TO IT IS A BARE GETTER. Its one
 * declaration is `var x = <number | na>` at the top level, or `x = <getter>`
 * itself; every `:=` is a bare getter; none sits in a loop or a function body;
 * it is declared once, and is never a parameter, a loop variable, a
 * destructured part or a function's name. Anything else — a name the program
 * ALSO computes some other way — is not a scalar this runtime can hold, and
 * stays refused wherever it is read.
 *
 * @returns {Map<string, {init: number|null, persist: boolean, top: boolean}>}
 */
export function getterScalars(stmts, h) {
  const info = new Map()
  const at = (nm) => {
    let d = info.get(nm)
    if (!d) { d = { decls: [], getterWrites: 0, bad: false }; info.set(nm, d) }
    return d
  }
  const scan = (list, ctx) => {
    for (const st of splitCommaStatements(list || [], h)) {
      const t = st.header || []
      if (!t.length) { scan(st.sub, { ...ctx, top: false }); continue }
      const def = definitionHeader(t, h)
      if (def) {
        at(def.name).bad = true
        for (const tk of t.slice(def.open + 1, def.arrow)) if (tk.kind === 'ident') at(String(tk.value)).bad = true
        const body = t.slice(def.arrow + 1)
        if (body.length) scan([{ header: body, sub: [] }], { top: false, inFn: true, inLoop: ctx.inLoop })
        scan(st.sub, { top: false, inFn: true, inLoop: ctx.inLoop })
        continue
      }
      const w = t[0].kind === 'ident' ? t[0].value : null
      if (w === 'for' || w === 'while') {
        for (const tk of t) if (tk.kind === 'ident') at(String(tk.value)).bad = true
        scan(st.sub, { top: false, inFn: ctx.inFn, inLoop: true })
        continue
      }
      if (h.isPunct(t[0], '[')) {
        for (const tk of t) {
          if (h.isPunct(tk, ']')) break
          if (tk.kind === 'ident') at(String(tk.value)).bad = true
        }
      }
      for (let i = 1; i < t.length; i += 1) {
        if (!isMutator(t[i]) || !t[i - 1] || t[i - 1].kind !== 'ident') continue
        const d = at(String(t[i - 1].value))
        if (t[i].value === ':=' && i === 1 && !ctx.inFn && !ctx.inLoop && isBareGetterAt(t, 2, h)) d.getterWrites += 1
        else d.bad = true
      }
      const eq = h.findTop(t, (x) => h.isPunct(x, '='))
      if (eq > 0 && h.findTop(t, (x) => h.isPunct(x, '=>')) < 0) {
        const nameTok = h.boundName(t, eq)
        if (nameTok) {
          const d = at(String(nameTok.value))
          const lit = w === 'var' ? literalInit(t, eq + 1, h) : null
          if (ctx.inFn || ctx.inLoop || w === 'varip') d.bad = true
          else if (w === 'var') {
            if (ctx.top && lit) d.decls.push({ init: lit.init, persist: true, top: true })
            else d.bad = true
          } else if (isBareGetterAt(t, eq + 1, h)) {
            // ⭐ C48 — `top`: declared at the top level, so its `[1]` is the value
            // it held at the end of the previous BAR (`vw-getter-history`, G03).
            d.decls.push({ init: null, persist: false, top: !!ctx.top })
            d.getterWrites += 1
          } else d.bad = true
        }
      }
      if (st.sub && st.sub.length) scan(st.sub, { ...ctx, top: false })
    }
  }
  scan(stmts, { top: true, inFn: false, inLoop: false })
  const out = new Map()
  for (const [nm, d] of info) {
    if (d.bad || d.decls.length !== 1 || d.getterWrites < 1) continue
    out.set(nm, d.decls[0])
  }
  return out
}

/** Why this body cannot be inlined under a CONDITIONAL call, or null.
 *  See the header: a body that reads history measures a different set of bars
 *  when its call is conditional. */
export function historyReason(def, drawFns, userFns, pureFns = new Set(), methods = new Set(),
  chart = EMPTY_SET, drawMethods = EMPTY_SET) {
  return historyIn(allTokens(def.body), drawFns, userFns, pureFns, methods, chart, drawMethods)
}

// ─── ⭐⭐ C42 — A CALL THAT RUNS EXACTLY ONCE (2026-09-30) ────────────────────
//
// The per-call-site rule, WITNESSED for one case: a call that has run once.
// Capture `vw-fn-series-history-rddt-1d-2026-09-30` (NYSE:RDDT 1D, 634 bars from
// the listing) calls `f_series(k)` / `f_call(close)` only under
// `if barstate.islast` and prints what each read answers:
//
//   C01  a body local    `x[1]`  (`x = close * 2`)   NaN   (every bar: 290.72)
//   C02  a parameter     `src[1]` (`f_call(close)`)  NaN   (every bar: 145.36)
//   C03  `ta.sma(close, 3)`                          NaN   (every bar: 143.6267)
//   C04  `ta.highest(high, 10)`                      151.8899 — the last bar's
//        OWN high, a window holding the one execution (every bar: 161.67)
//   S02  `bar_index[k]`, k = 5 / 40 / 200            NaN   (chart: 628 / 593 / 433)
//
// and `ema-ribbon-trend-filter-strixedge-rddt-1d-2026-09-28` shows the same C04
// answer in a block: `ta.highest(spread, 50)` under `if showTable and
// barstate.islast` draws ten full glyphs (the ratio 1).
//
// So, for a call whose guard is PROVABLY `barstate.islast` (`guardIsLastBarOnly`)
// and that stands in no loop — one execution on the bars a chart loads:
//   • `<parameter>[n]`, `<body local>[n]`, `bar_index[n]`, n a whole number ≥ 1
//     written into the script (or a parameter bound to one) → `na`;
//   • `ta.highest(src, len)` → `src` (the window holds this execution alone);
//   • `ta.sma(src, len)`, `len` a whole number ≥ 2 written the same way → `na`
//     (fewer executions than the average needs).
// ⭐⭐ C48 — THE QUEUED PROBE WAS TAKEN (`vw-call-site-history-{rddt,spy}-1d-
// 2026-10-01`, both charts agreeing on every row; `vendorHarness.c48CallSite`):
//   • the other `ta.*` on their first run — `ONE_EXECUTION_TA`, form by form;
//   • `<parameter>[0]`, `<body local>[0]` → the value this run holds (B06, B07);
//   • `time_close[k]`, `hlcc4[k]` in the helper → the chart's (B02, B03);
//   • `bar_index[k]` in the helper → `na` again (B01), but in a BLOCK it is the
//     chart's (A13 — `owned` is empty for a block, so it was never rewritten);
//   • a BLOCK local's `bx[1]` → `na` (A12): read by the value reader, which
//     marks a name declared in such a block (`Resolver.blockLocalHistory`).
// ⛔ MANY EXECUTIONS ARE WITNESSED AND NOT SERVED. Under `close > open` (and on
// every other bar) a `ta.sma` / `ta.ema` window counts executions, a local's or
// a parameter's `[1]` is the previous execution, a helper's `bar_index[1]` the
// previous execution's index — each exact on every bar of both captures — and
// `ta.highest` / `ta.lowest` fit no rule tried. Serving the first group needs a
// history indexed by EXECUTION per call site, which neither lane keeps; every
// guard that is not provably `barstate.islast` therefore still refuses by name,
// now in the plot lane too (`Resolver.resolveBinding`).
// ⛔ NOTHING ELSE: a form `ONE_EXECUTION_TA` does not list, an offset or a
// length that is not a literal — no row, refused by name (`fn:conditional-history`).
// ⚠️ ONE EXECUTION IS THE LOADED CHART. On a chart left open, TradingView runs the
// block again on each new realtime bar and the call's history grows; this
// engine recomputes from the bars it holds, where the last bar is the only
// `barstate.islast` bar — the state the capture was taken in.

/** ⭐⭐ C42 / C48 — WHAT A `ta.*` CALL ANSWERS ON ITS FIRST EXECUTION, form by
 *  form, each a row of a committed capture (C42: `vw-fn-series-history-rddt-1d-
 *  2026-09-30`; C48: `vw-call-site-history-{rddt,spy}-1d-2026-10-01`, the two
 *  charts agreeing on every row):
 *
 *    ta.highest(src, len)   → src            C04, A01, B10
 *    ta.highest(len)        → high           A08, B08
 *    ta.lowest(src, len)    → src            A02, B04
 *    ta.sma(src, 1)         → src            A09, B09
 *    ta.sma(src, len ≥ 2)   → na             C03, A03
 *    ta.ema(src, len ≥ 2)   → na             A04, B05
 *    ta.rsi(src, len ≥ 2)   → na             A05          (block only)
 *    ta.stdev(src, len ≥ 2) → na             A10          (block only)
 *    ta.atr(len ≥ 2)        → na             A06          (block only)
 *    ta.change(src)         → na             A07          (block only)
 *    ta.cum(src)            → src            A11          (block only until F1)
 *    ta.wma(src, len ≥ 2)   → na             T06, B06     (F1, vw-once-ta-helper)
 *  F1: T01–T05 of `vw-once-ta-helper` answer the five "block only" rows inside a
 *  helper called once, the same as in the block, on RDDT and SPY.
 *
 *  A key that is a NUMBER is an arity: what that many positional arguments
 *  answer — 'source' the first argument · 'high' the chart's `high` · 'na' ·
 *  'len' — `na` for a whole length ≥ 2 written into the script, the source for a
 *  written 1 where `one` says so, unwitnessed otherwise.
 *  ⛔ `helper: false` — the probe asks the row only in a BLOCK (`A*`); inside a
 *  helper called once it stays refused by name. Every row asked in both places
 *  (six of them) answers the same in both; that the other five would too is an
 *  inference, not a row.
 *  ⛔ NOTHING ELSE: `ta.lowest(len)`, `ta.ema(src, 1)`, `ta.change(src, n)`, a
 *  named argument, a length that is not a written whole number — no row. */
export const ONE_EXECUTION_TA = Object.freeze({
  'ta.highest': Object.freeze({ helper: true, 2: 'source', 1: 'high' }),
  'ta.lowest': Object.freeze({ helper: true, 2: 'source' }),
  'ta.sma': Object.freeze({ helper: true, 2: 'len', one: true }),
  'ta.ema': Object.freeze({ helper: true, 2: 'len' }),
  // ⭐ F1 — `helper: true` for the five block-only rows and the new `ta.wma` row:
  // `vw-once-ta-helper-{rddt,spy}-1d-2026-10-02` (CAP round 4) prints T01–T06 in a
  // helper called once and B01–B06 in the block, and every pair answers the same
  // on both charts (NaN · NaN · NaN · NaN · the bar's volume · NaN).
  'ta.rsi': Object.freeze({ helper: true, 2: 'len' }),
  'ta.stdev': Object.freeze({ helper: true, 2: 'len' }),
  'ta.atr': Object.freeze({ helper: true, 1: 'len' }),
  'ta.change': Object.freeze({ helper: true, 1: 'na' }),
  'ta.cum': Object.freeze({ helper: true, 1: 'source' }),
  'ta.wma': Object.freeze({ helper: true, 2: 'len' }),
})

/** ⭐ C42 — is this guard `barstate.islast`, alone or as a top-level `and`
 *  conjunct? ⛔ Fails closed: an `or`, a ternary, a `not`, or the word inside
 *  brackets is not proof (`not barstate.islast` runs on every bar but one). */
export function guardIsLastBarOnly(toks) {
  if (!toks || !toks.length) return false
  let depth = 0
  let found = false
  let start = 0
  const conjunct = (from, to) => {
    if (to - from === 1 && toks[from].kind === 'ident' && !toks[from].member
      && toks[from].value === 'barstate.islast') found = true
  }
  for (let i = 0; i < toks.length; i += 1) {
    const tk = toks[i]
    if (tk.kind === 'punct') {
      if (tk.value === '(' || tk.value === '[') depth += 1
      else if (tk.value === ')' || tk.value === ']') depth -= 1
      else if (depth === 0 && (tk.value === '?' || tk.value === ':')) return false
      continue
    }
    if (depth !== 0 || tk.kind !== 'ident') continue
    if (tk.value === 'or') return false
    if (tk.value === 'and') { conjunct(start, i); start = i + 1 }
  }
  conjunct(start, toks.length)
  return found
}

/** A whole number ≥ `min` written into the script — directly, or as a parameter
 *  the call binds to one. null otherwise. */
function literalCountOf(toks, bind, locals, min) {
  if (!toks || toks.length !== 1) return null
  let tk = toks[0]
  if (tk.kind === 'ident' && !tk.member && bind && bind.has(String(tk.value)) && !locals.has(String(tk.value))) {
    const arg = bind.get(String(tk.value))
    if (!arg || arg.length !== 1) return null
    tk = arg[0]
  }
  if (tk.kind !== 'number') return null
  const n = Number(tk.value)
  return Number.isInteger(n) && n >= min ? n : null
}

/** ⭐ C42 — the first `ta.*(` call in these tokens, or null. */
export function taCallIn(toks) {
  for (let i = 0; i + 1 < (toks || []).length; i += 1) {
    const tk = toks[i]
    if (tk && tk.kind === 'ident' && !tk.member && String(tk.value).startsWith('ta.')
      && toks[i + 1].kind === 'punct' && toks[i + 1].value === '(') return tk
  }
  return null
}

/**
 * ⭐⭐ C42 — these tokens, as they read on the ONE execution of the block or
 * call they stand in (see the section above). Only the witnessed shapes are
 * rewritten:
 *   `owned[n ≥ 1]` → `na` · `<parameter or local>[0]` → the name (B06 / B07) ·
 *   a `ta.*` call → what `ONE_EXECUTION_TA` says its form answers
 * `owned` are the names whose history belongs to the call (a body's parameters
 * and locals, `CALL_OWNED_SERIES`) — empty for a top-level block, whose locals
 * the value reader answers (`Resolver.blockLocalHistory`). `helper` says the
 * tokens are a helper's body (some rows are witnessed in a block only); `chart`
 * the chart series no script name shadows (`chartSeriesFor`) — the one-argument
 * `ta.highest(len)` reads `high` only where `high` is the chart's.
 * `why` is the first witnessed NAME met in a shape the
 * capture does not show; `left` the first `ta.*` call still standing, or the
 * first call to a user function that reads its own history (`historyFns`,
 * `callHistoryFunctions`). With `flagRest`, every such call left standing is
 * marked `onceUnwitnessed`, which the object lane refuses by name where the
 * value is read.
 * @returns {{toks: object[], why: string|null, left: object|null}}
 */
export function oneExecutionTokens(toks, h, {
  bind = null, locals = EMPTY_SET, owned = EMPTY_SET, flagRest = false, historyFns = EMPTY_SET,
  helper = false, chart = EMPTY_SET, fnDefs = null, depth = 0, callOwned = EMPTY_SET,
} = {}) {
  let why = null
  const ident = (value, at) => ({ kind: 'ident', value, line: at.line, column: at.column, index: at.index })
  const na = (at) => ident('na', at)
  const P = (value, at) => ({ kind: 'punct', value, line: at.line, column: at.column, index: at.index })
  const rw = (t) => {
    const out = []
    for (let i = 0; i < t.length; i += 1) {
      const tk = t[i]
      const next = t[i + 1]
      if (tk.kind !== 'ident' || tk.member || !next || next.kind !== 'punct') { out.push(tk); continue }
      const v = String(tk.value)
      if (next.value === '[' && next.line === tk.line && owned.has(v)) {
        const close = closeOf(t, i + 1)
        // `float[] x` — a type, not a read
        if (close === i + 2) { out.push(tk); continue }
        const count = close < 0 ? null : literalCountOf(t.slice(i + 2, close), bind, locals, 0)
        // ⭐ C48 — `x[0]` / `src[0]` is the value this run holds (B06 / B07). ⛔ Not
        // `bar_index[0]`: the probe asks the call's `bar_index` at k = 5 only.
        if (count === 0 && !CALL_OWNED_SERIES.has(v)) {
          out.push(tk)
          i = close
          continue
        }
        if (count === null || count === 0) {
          why = why || `a history read \`${v}[…]\` at line ${tk.line} — the call's own history, \`na\` on its one run only where the offset is a whole number above 0 written into the script`
          out.push(tk)
          continue
        }
        out.push(na(tk))
        i = close
        continue
      }
      if (next.value !== '(') { out.push(tk); continue }
      // ⭐⭐ F1 — A ONE-EXPRESSION HELPER CALLED FROM THE BLOCK THAT RUNS ONCE
      // (`f() => ta.rsi(close, 14)`). Its body runs once with it, so it reads as
      // that body's one-execution rewrite with the arguments in place of the
      // parameters — the rows `vw-once-ta-helper-{rddt,spy}-1d-2026-10-02` (T01–T06)
      // witness, each answering what the same call written in the block answers.
      // ⛔ Only a one-statement body with no sub-block, called with exactly its
      // parameters, positionally; anything the rewrite cannot settle stays standing
      // and is flagged by name below, as before.
      // ⛔ The body is rewritten FIRST, with its parameters (and the call-owned
      // series) as the call's OWN history — `src[1]` in `fp(src) => src[1]` is the
      // call's one run, `na` (C42), never the argument's every-bar history — and
      // only then are the arguments put in.
      const def = !helper && fnDefs && depth < 4 && historyFns.has(v) ? fnDefs.get(v) : null
      const inl = def ? inlineOnceHelper(t, i, def, h) : null
      if (inl) {
        const owned2 = new Set([...callOwned, ...def.params.map((p) => p.name)])
        const r = oneExecutionTokens(inl.body, h, { chart, helper: true, owned: owned2, depth: depth + 1 })
        if (!r.why && !r.left) {
          out.push(P('(', tk), ...substituteParams(r.toks, inl.byName), P(')', tk))
          i = inl.close
          continue
        }
      }
      const spec = Object.prototype.hasOwnProperty.call(ONE_EXECUTION_TA, v) ? ONE_EXECUTION_TA[v] : null
      if (!spec) { out.push(tk); continue }
      if (helper && !spec.helper) {
        why = why || `\`${v}\` at line ${tk.line} — its first run is witnessed in a block that runs once, not inside a function called once (capture \`vw-call-site-history\`, rows A05–A11)`
        out.push(tk)
        continue
      }
      const close = closeOf(t, i + 1)
      const args = close < 0 ? null : splitArgs(t, i + 1, h.isPunct)
      const form = args && !args.some((a) => a.name !== null || !a.toks.length) ? spec[args.length] : null
      if (!form) {
        why = why || `\`${v}\` at line ${tk.line}, called in a form no capture reads from a call that runs once`
        out.push(tk)
        continue
      }
      if (form === 'source') {
        out.push(P('(', tk), ...rw(args[0].toks), P(')', tk))
      } else if (form === 'high') {
        if (!chart.has('high')) {
          why = why || `\`${v}\` at line ${tk.line} reads the chart's \`high\`, a name this script binds itself`
          out.push(tk)
          continue
        }
        out.push(ident('high', tk))
      } else if (form === 'na') {
        out.push(na(tk))
      } else {
        const len = literalCountOf(args[args.length - 1].toks, bind, locals, 1)
        if (len === 1 && spec.one && args.length === 2) {
          out.push(P('(', tk), ...rw(args[0].toks), P(')', tk))
        } else if (len === null || len < 2) {
          why = why || `\`${v}\` at line ${tk.line}, whose length is not a whole number above 1 written into the script — only then is its first run known to be \`na\``
          out.push(tk)
          continue
        } else {
          out.push(na(tk))
        }
      }
      i = close
    }
    return out
  }
  let out = rw(toks || [])
  const left = taCallIn(out) || historyCallIn(out, historyFns)
  if (flagRest && left) {
    out = out.map((tk, i) => (historyCallAt(out, i, historyFns) || (tk.kind === 'ident' && !tk.member
      && String(tk.value).startsWith('ta.') && out[i + 1] && out[i + 1].kind === 'punct' && out[i + 1].value === '(')
      ? { ...tk, onceUnwitnessed: true } : tk))
  }
  return { toks: out, why, left }
}

/** ⭐ F1 — `f(a, b)` at `toks[i]` with `def` a one-statement body `=> expr`: the
 *  body's tokens with each parameter replaced by its argument (bracketed), and the
 *  call's closing index; null for any other shape. */
function inlineOnceHelper(toks, i, def, h) {
  if (!def || def.isMethod || def.overloaded || !Array.isArray(def.body) || def.body.length !== 1) return null
  const st = def.body[0]
  if (!st || (st.sub && st.sub.length) || !st.header || !st.header.length) return null
  const close = closeOf(toks, i + 1)
  if (close < 0) return null
  const args = close === i + 2 ? [] : splitArgs(toks, i + 1, h.isPunct)
  if (!args || args.length !== def.params.length || args.some((a) => a.name !== null || !a.toks.length)) return null
  const byName = new Map(def.params.map((p, k) => [p.name, args[k].toks]))
  const body = st.header
  if (body.some((x) => x.kind === 'punct' && (x.value === '=' || x.value === ':=' || x.value === '=>'))) return null
  return { body, byName, close }
}

/** ⭐ F1 — each parameter name in `toks` replaced by its argument, bracketed. */
function substituteParams(toks, byName) {
  const out = []
  for (const x of toks) {
    if (x.kind === 'ident' && !x.member && byName.has(String(x.value))) {
      const at = x
      out.push({ kind: 'punct', value: '(', line: at.line, column: at.column, index: at.index },
        ...byName.get(String(x.value)), { kind: 'punct', value: ')', line: at.line, column: at.column, index: at.index })
    } else out.push(x)
  }
  return out
}

/** Is `toks[i]` the head of a call to one of `names` — `f(…)`, or the method
 *  form `x.f(…)` on a script value (never under one of Pine's own namespaces)? */
function historyCallAt(toks, i, names) {
  const tk = toks[i]
  const next = toks[i + 1]
  if (!names || !names.size || !tk || tk.kind !== 'ident' || !next || next.kind !== 'punct' || next.value !== '(') return false
  const v = String(tk.value)
  if (names.has(v)) return true
  const dot = v.lastIndexOf('.')
  if (dot <= 0) return false
  const first = v.split('.')[0]
  return names.has(v.slice(dot + 1)) && !KNOWN_NAMESPACES.has(first) && !DRAWN_FAMILIES.includes(first)
}

/** ⭐ C42 — the first call, in these tokens, to a function that reads its own
 *  history (`callHistoryFunctions`), or null. */
export function historyCallIn(toks, names) {
  if (!names || !names.size) return null
  for (let i = 0; i + 1 < (toks || []).length; i += 1) if (historyCallAt(toks, i, names)) return toks[i]
  return null
}

/**
 * ⭐⭐ C42 — USER FUNCTIONS AND METHODS WHOSE BODY READS THE CALL'S OWN HISTORY:
 * a `ta.*` call, or a parameter / a body local / a `CALL_OWNED_SERIES` name at an
 * offset — directly, or through another such function. Exactly the reads the
 * capture shows answering differently from a call that has not run on every
 * bar (C01–C04, S02). ⛔ Not "impure": a `request.*` or an `input.*` inside a
 * body is not the call's history and does not put the function here.
 * @returns {Set<string>}
 */
export function callHistoryFunctions(defs, h, callOwned = EMPTY_SET) {
  const direct = (d) => {
    const toks = allTokens(d.body)
    if (taCallIn(toks)) return true
    const owned = new Set([...callOwned, ...bodyNames(d, h).locals, ...d.params.map((p) => p.name)])
    for (let i = 0; i + 2 < toks.length; i += 1) {
      const tk = toks[i]
      const next = toks[i + 1]
      if (tk.kind === 'ident' && !tk.member && owned.has(String(tk.value))
        && next.kind === 'punct' && next.value === '[' && next.line === tk.line
        && !(toks[i + 2].kind === 'punct' && toks[i + 2].value === ']')) return true
    }
    return false
  }
  const out = new Set()
  for (const [name, d] of defs) if (direct(d)) out.add(name)
  let grew = true
  while (grew) {
    grew = false
    for (const [name, d] of defs) {
      if (out.has(name)) continue
      if (historyCallIn(allTokens(d.body), out)) { out.add(name); grew = true }
    }
  }
  return out
}

/**
 * ⭐⭐ C42 — the body of `def`, as it reads on the call's ONE execution. What the
 * rewrite leaves is for `historyIn` to judge, so whatever stays refused keeps
 * its own sentence. `callOwned` are the built-in series whose history is the
 * call's (`callOwnedSeriesFor`), beside its parameters and its locals.
 * @returns {{body: object[]}|{why: string}}
 */
export function oneExecutionBody(def, bind, locals, h, callOwned = EMPTY_SET, chart = EMPTY_SET) {
  const owned = new Set([...callOwned, ...locals, ...def.params.map((p) => p.name)])
  let why = null
  const list = (stmts) => (stmts || []).map((st) => {
    const r = oneExecutionTokens(st.header || [], h, { bind, locals, owned, helper: true, chart })
    why = why || r.why
    return { ...st, header: r.toks, sub: list(st.sub) }
  })
  const body = list(def.body)
  return why ? { why } : { body }
}

/** ⭐ C42 — `CALL_OWNED_SERIES` this script does not bind itself. */
export function callOwnedSeriesFor(stmts, h) {
  if (!stmts || !h) return EMPTY_SET
  const bound = scriptBoundNames(stmts, h)
  return new Set([...CALL_OWNED_SERIES].filter((n) => !bound.has(n)))
}

/** Names a body DECLARES or ASSIGNS (all become per-call-site locals), and the
 *  subset that is MUTABLE — `var`/`varip`, `:=` targets, destructured parts.
 *  ⭐ C21 — and the subset CARRIED: a `var`/`varip` declared inside a `for` or
 *  `while` of the body, which is ONE variable across the loop's passes and the
 *  bars (`dual-view`'s `var float htf_o` in `update_drawings`), named apart from
 *  a local the function merely reassigns (`objectDiagnostics.guardRefusals`). */
export function bodyNames(def, h) {
  const locals = new Set()
  const mutable = new Set()
  const carried = new Set()
  const walk = (list, inLoop = false) => {
    for (const st of list || []) {
      const t = st.header || []
      if (!t.length) { walk(st.sub, inLoop); continue }
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
            if ((w === 'var' || w === 'varip') && inLoop) carried.add(String(nameTok.value))
          }
        }
      }
      if (st.sub && st.sub.length) walk(st.sub, inLoop || w === 'for' || w === 'while')
    }
  }
  walk(def.body)
  return { locals, mutable, carried }
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

/** Method spellings Pine's OWN collection namespaces define (`array`, `map`,
 *  `matrix`), beside the object writes `writesObject` names and every `get_*`. */
const BUILTIN_COLLECTION_METHODS = new Set(['push', 'pop', 'shift', 'unshift', 'set', 'get',
  'remove', 'clear', 'size', 'first', 'last', 'insert', 'copy', 'includes', 'indexof',
  'lastindexof', 'sort', 'reverse', 'fill', 'concat', 'slice', 'join', 'keys', 'values',
  'contains', 'put', 'sum', 'avg', 'min', 'max'])

/** ⛔ A user method whose name Pine ALSO defines on a drawing handle or a list.
 *  Called on a declared handle, `b.set_right(…)` might mean the built-in, and
 *  choosing between them is a type decision this reader does not make. */
export function isBuiltinMethodName(m) {
  const s = String(m || '')
  return writesObject(s) || s.startsWith('get_') || BUILTIN_COLLECTION_METHODS.has(s)
}

/**
 * ⭐ A CALL HEAD naming one of `methods`, in either spelling Pine allows:
 *   `recv.m(…)`  → `{fn: 'm', recv: 'recv'}`   the method form
 *   `m(recv, …)` → `{fn: 'm', recv: null}`     the function form
 * ⛔ A head under one of Pine's own namespaces (`color.m`, `box.m`) is NOT a
 * method call on a script value — it is that namespace's function or nothing.
 * @returns {{fn: string, recv: string|null}|null}
 */
export function methodHead(tk, methods) {
  if (!tk || tk.kind !== 'ident') return null
  const v = String(tk.value)
  if (methods.has(v)) return { fn: v, recv: null }
  const dot = v.lastIndexOf('.')
  if (dot <= 0 || dot === v.length - 1) return null
  const m = v.slice(dot + 1)
  const recv = v.slice(0, dot)
  if (!methods.has(m)) return null
  const first = recv.split('.')[0]
  if (KNOWN_NAMESPACES.has(first) || DRAWN_FAMILIES.includes(first)) return null
  return { fn: m, recv }
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
