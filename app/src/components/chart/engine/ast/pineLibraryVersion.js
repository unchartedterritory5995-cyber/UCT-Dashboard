// app/src/components/chart/engine/ast/pineLibraryVersion.js
//
// ─── ⭐⭐ U15 PHASE B — A PINE v5 LIBRARY IMPORTED INTO A v6 SCRIPT ─────────────
//
// TradingView compiles a published library at its OWN `//@version` and lets a v6
// script import a v5 library (its own v6 built-ins do: Relative Volume at Time
// imports `TradingView/ta/7`, a v5 library). This engine compiles ONE program at
// ONE version (`pineLibraries.js` splices the library's definitions into the
// script). So a v5 library inside a v6 script is compiled under v6 rules, and
// that is exact only where v5 and v6 mean the same thing.
//
// What changed between the two is a closed, published list: TradingView's
// "To Pine Script version 6" migration guide. This module reads the code the
// script REACHES in the library (`pineLibraries.js` keeps nothing else) and
// answers the first construct whose meaning that guide changed, or null when
// there is none. The linker links a v5 library into a v6 script only on null,
// and otherwise refuses the import line BY NAME (`pine:library-version`),
// naming the construct and the change. ⛔ Every check here is CONSERVATIVE: when
// the token stream cannot show that a construct means the same in both
// versions, the answer is "it may not", and the import is refused.
//
// The guide's changes, and how each is read here (guide section in brackets):
//   and / or        [Lazy evaluation of conditions] v5 evaluates both sides on
//                   every bar, v6 skips the right side when the left decides:
//                   refused when the right side calls anything but a pure read.
//   bool na         [Boolean values cannot be na] v5 bools can be na, v6 not:
//                   refused on `na()`/`nz()`/`fixnan()` of anything not shown to
//                   be a number, on history of a bool, on `na` given to a bool,
//                   and on an `if`/`switch` value without `else`/`default`.
//   implicit cast   [Explicit "bool" casting] v5 reads a number as a condition:
//                   refused when a condition is not shown to be a bool.
//   const int /     [Fractional division of constants] v5 truncates `5 / 2`:
//                   refused when both operands may be `const int`.
//   timeframe.period [Timeframes must include a multiplier] "D" vs "1D".
//   color.red/teal/yellow [Color changes] the values changed.
//   label.new       [Color changes] its default text colour changed (refused
//                   unless the call names `textcolor`).
//   for             [Dynamic for loop boundaries] refused when the end bound
//                   calls anything but a size read of a collection the loop does
//                   not resize, or names a variable the loop body reassigns.
//   request.*       [Dynamic requests]; strategy.* [Strategies]; `transp`,
//                   `offset`, `linewidth` arguments [transp removed, No series
//                   offset values, Minimum linewidth]; a repeated argument
//                   [Cannot repeat parameters]; history of a literal or of a
//                   field [History-referencing operator]; a negative literal
//                   array index [Negative indices in arrays].
// Compile-only changes (v6 rejects what v5 accepted, e.g. "mutable variables are
// always series", "unique parameters cannot be na") never change a value v5
// computes, so they need no check here.
//
// ⛔ A v6 library inside a v5 script stays refused (`pineLibraries.js`): the
// guide describes v5 → v6, and nothing here reads the reverse.

import ADMISSION from './pineLibraryCrossVersion.json'

export const LIBRARY_VERSION = 'pine:library-version'

// ⭐⭐ U15 Phase B (coordinator ruling 2026-11-16) — THE ADMISSION TABLE. A v5 version is linked into a
// v6 script only when `pineLibraryCrossVersion.json` names it: a `promote` version of the promotion
// allowlist whose newly attaching v6 importers all grade MATCH host-only. So cross-version linking never
// widens the reach of a version a store holds that nobody graded in a v6 script.
/** The admission table of a parsed document: Set(path), or NULL when the document cannot be read as a
 *  list of rows that each name a path. ⛔ FAIL CLOSED: null admits NOTHING. */
export function admissionTableOf(doc) {
  const rows = doc && typeof doc === 'object' ? doc.admit : null
  if (!Array.isArray(rows)) return null
  if (rows.some((d) => !d || typeof d !== 'object' || typeof d.path !== 'string' || !d.path)) return null
  return new Set(rows.map((d) => d.path))
}
const ADMITTED = admissionTableOf(ADMISSION)

/** Is the v5 version `path` admitted into v6 scripts? `table` is the committed one; a rail passes another. */
export function crossVersionAdmitted(path, table = ADMITTED) {
  return !!table && table.has(String(path))
}

// ─── ⭐⭐ THE VERSION ISLAND, STEP 1: THE CARRIER AND ITS ONE READER (coordinator ruling 2026-11-19) ─────────────
//
// TradingView runs a v5 library under v5 rules inside a v6 script. The linker stamps every spliced token of a
// library whose `//@version` differs from the program's with that version (`stampLibraryVersion`), and ONE reader
// answers the version a construct at a token is judged under (`versionAt`). A token of the program's own version
// carries nothing, so every same-version script links token for token as before.
// ⛔ THE ONE READER. No engine source but this one names the stamp (`ISLAND_KEY`): the rail
// (`pineLibraryVersion.test.js`, "the island has one reader") greps every engine source for its literal. A rule that
// decides by version asks `versionAt(node.tok, programVersion)`, never the token. (Named apart from `pineVersion`,
// which `pine.js` reads 73 times as its Resolver's program version, so the grep is exact.)
// An island is whole statements: the linker splices whole definitions, so every token of a library body shares one
// version and a node is never half v5, half v6. Nothing reads the version yet (step 2 moves the rules whose meaning
// changed between v5 and v6 onto `versionAt`), and the cross-version gate above still decides what links.
const ISLAND_KEY = 'libPineVersion'

/** `tok`, stamped with `libVersion` when that differs from `programVersion`; else unchanged (no key at all). The
 *  linker's `emit` calls it on its own fresh copy of each spliced token. */
export function stampLibraryVersion(tok, libVersion, programVersion) {
  if (!tok || typeof tok !== 'object' || !Number.isFinite(libVersion) || libVersion === programVersion) return tok
  tok[ISLAND_KEY] = libVersion
  return tok
}

/** The Pine version a construct at `tok` is judged under: its library's inside an island, else `programVersion`. */
export function versionAt(tok, programVersion) {
  const v = tok && typeof tok === 'object' ? tok[ISLAND_KEY] : undefined
  return Number.isFinite(v) ? v : programVersion
}

// ─── ⭐⭐ THE VERSION ISLAND, STEP 2: THE FAMILIES A LANE JUDGES PER TOKEN ─────────────────────────────────────────
//
// Each construct `crossVersionDifference` finds belongs to one FAMILY of the v6 migration guide. A lane whose every
// rule for a family asks `versionAt` judges a v5 library's code in that family under v5, as TradingView does, so the
// linker stops refusing that family for it: the lane hands its families to `linkLibraries` (`islandFamilies`) and
// the check skips exactly those. ⛔ Only the RUNTIME lane hands any; the host lane keeps the whole check until its own
// rules read per token. ⛔ A family joins `RUNTIME_ISLAND_FAMILIES` in the commit that moves the last of the runtime
// lane's rules for it onto `versionAt`, with its rail: a v5 library in a v6 script computes what the same library
// computes in a v5 script (`pineLibraryVersion.test.js`, "the version island, family by family"). A construct with
// no family (`request.*`, `strategy.*`, `transp`/`offset`/`linewidth`, a repeated argument, a negative literal
// index, history of a literal or a field, a const-int division, `label.new` without `textcolor`) stays refused on
// every lane.
export const ISLAND_FAMILY = Object.freeze({
  BOOL_NA: 'bool-na',
  IMPLICIT_CAST: 'implicit-cast',
  LAZY_AND_OR: 'lazy-and-or',
  FOR_BOUND: 'for-bound',
  COLOURS: 'colours',
  TIMEFRAME_PERIOD: 'timeframe.period',
  TOSTRING_LITERAL: 'str.tostring-literal',
})
/** The families the runtime lane judges per token (`pineRuntimeFrontend.js` hands them to the linker). */
export const RUNTIME_ISLAND_FAMILIES = Object.freeze([
  ISLAND_FAMILY.TIMEFRAME_PERIOD,
  ISLAND_FAMILY.COLOURS,
  ISLAND_FAMILY.TOSTRING_LITERAL,
  ISLAND_FAMILY.FOR_BOUND,
])

const isPunct = (t, v) => !!t && t.kind === 'punct' && t.value === v
const isWord = (t, v) => !!t && t.kind === 'ident' && !t.member && t.value === v
const OPENERS = new Set(['(', '['])
const CLOSERS = new Set([')', ']'])
const COMPARISONS = new Set(['>', '<', '>=', '<=', '==', '!='])
const ARITHMETIC = new Set(['+', '-', '*', '/', '%'])
const ASSIGN_OPS = new Set([':=', '+=', '-=', '*=', '/=', '%='])
const TYPE_WORDS = new Set(['int', 'float', 'bool', 'string', 'color', 'line', 'label', 'box', 'table', 'linefill', 'polyline'])
const QUALIFIERS = new Set(['simple', 'series', 'const', 'var', 'varip'])

/** Calls whose result is a pure read: evaluating them or not on a bar is invisible. */
const PURE_CALLS = new Set(['na', 'nz', 'int', 'float', 'bool', 'color.new', 'color.rgb', 'color.r', 'color.g',
  'color.b', 'color.t'])
const PURE_PREFIXES = ['math.', 'str.']
const PURE_MEMBERS = new Set(['size', 'get', 'first', 'last', 'includes', 'indexof', 'min', 'max', 'sum', 'avg'])
/** Calls that answer a bool (a condition built on one is a bool). */
const BOOL_CALLS = new Set(['na', 'ta.crossover', 'ta.crossunder', 'ta.cross', 'ta.rising', 'ta.falling',
  'str.contains', 'str.startswith', 'str.endswith', 'array.includes', 'timeframe.change', 'bool'])
const BOOL_PREFIXES = ['barstate.', 'session.is', 'timeframe.is']
/** Built-in series that are numbers. */
const NUMERIC_SERIES = new Set(['open', 'high', 'low', 'close', 'volume', 'hl2', 'hlc3', 'ohlc4', 'hlcc4', 'time',
  'time_close', 'bar_index', 'last_bar_index', 'syminfo.mintick', 'syminfo.pointvalue', 'timenow'])
const NUMERIC_CALL_PREFIXES = ['math.', 'ta.']
const NOT_NUMERIC_TA = new Set(['ta.crossover', 'ta.crossunder', 'ta.cross', 'ta.rising', 'ta.falling'])
const SIZE_READS = new Set(['array.size', 'map.size', 'matrix.rows', 'matrix.columns', 'str.length'])
const RESIZERS = new Set(['push', 'pop', 'insert', 'remove', 'shift', 'unshift', 'clear', 'concat', 'splice',
  'put', 'add_row', 'add_col', 'remove_row', 'remove_col'])
const INDEX_CALLS = new Set(['get', 'set', 'insert', 'remove'])
/** Built-in namespaces: `syminfo.mintick[1]` is the history of a built-in, not of a field. */
const BUILTIN_HEADS = new Set(['syminfo', 'timeframe', 'barstate', 'chart', 'session', 'ta', 'math', 'str', 'array',
  'map', 'matrix', 'request', 'strategy', 'color', 'line', 'label', 'box', 'table', 'polyline', 'linefill',
  'dividends', 'earnings', 'splits', 'currency', 'dayofweek', 'display', 'extend', 'font', 'format', 'hline',
  'location', 'order', 'plot', 'position', 'scale', 'shape', 'size', 'text', 'xloc', 'yloc', 'adjustment',
  'backadjustment', 'settlement_as_close', 'input', 'ticker', 'alert', 'runtime', 'log'])
const CHANGED_COLOURS = {
  'color.red': '#FF5252 in v5, #F23645 in v6',
  'color.teal': '#00897B in v5, #089981 in v6',
  'color.yellow': '#FFEB3B in v5, #FDD835 in v6',
}

const nameOf = (t) => (t && t.kind === 'ident' ? String(t.value) : null)
const isPureCall = (name, member) => name !== 'math.random' && (PURE_CALLS.has(name) || PURE_PREFIXES.some((p) => name.startsWith(p)))
  || (member && PURE_MEMBERS.has(name))
  || (!member && /\.(size|get|first|last|includes|indexof|min|max|sum|avg)$/.test(name) && !name.startsWith('ta.'))

/** The index just past the bracket group opening at `i` (or `i + 1` when it is not one). */
function closeOf(toks, i) {
  if (!OPENERS.has(toks[i] && toks[i].value) || toks[i].kind !== 'punct') return i + 1
  let d = 0
  for (let j = i; j < toks.length; j += 1) {
    const t = toks[j]
    if (t.kind === 'punct' && OPENERS.has(t.value)) d += 1
    else if (t.kind === 'punct' && CLOSERS.has(t.value)) { d -= 1; if (d === 0) return j + 1 }
  }
  return toks.length
}

/** The logical lines of a definition's tokens: a new one starts on a new physical line at
 *  bracket depth 0 unless the previous token leaves the expression open. Each is
 *  `{toks, indent}`. */
function logicalLines(toks, indents) {
  const out = []
  let cur = null
  let depth = 0
  for (let i = 0; i < toks.length; i += 1) {
    const t = toks[i]
    const prev = toks[i - 1]
    // `=>` closes a header: the body below it is its own line
    const dangles = prev && ((prev.kind === 'punct' && !CLOSERS.has(prev.value) && prev.value !== '=>')
      || isWord(prev, 'and') || isWord(prev, 'or') || isWord(prev, 'not'))
    if (!cur || (t.line !== prev.line && depth === 0 && !dangles)) {
      cur = { toks: [], indent: indents[t.line - 1] || 0 }
      out.push(cur)
    }
    cur.toks.push(t)
    if (t.kind === 'punct' && OPENERS.has(t.value)) depth += 1
    else if (t.kind === 'punct' && CLOSERS.has(t.value)) depth = Math.max(0, depth - 1)
  }
  return out
}

/** Split a token span at depth 0 on any token `stop(t)` answers true for. */
function splitTop(toks, stop) {
  const parts = [[]]
  let d = 0
  for (const t of toks) {
    if (t.kind === 'punct' && OPENERS.has(t.value)) d += 1
    else if (t.kind === 'punct' && CLOSERS.has(t.value)) d -= 1
    if (d === 0 && stop(t)) { parts.push([]); continue }
    parts[parts.length - 1].push(t)
  }
  return parts.filter((p) => p.length)
}

/** The index of the first token at bracket depth 0 that `pred(t, i)` accepts, or -1. */
function topIndex(toks, pred) {
  let d = 0
  for (let i = 0; i < toks.length; i += 1) {
    const t = toks[i]
    if (t.kind === 'punct' && OPENERS.has(t.value)) { d += 1; continue }
    if (t.kind === 'punct' && CLOSERS.has(t.value)) { d -= 1; continue }
    if (d === 0 && pred(t, i)) return i
  }
  return -1
}

/** Strip one pair of enclosing parentheses. */
function unwrap(toks) {
  let t = toks
  while (t.length >= 2 && isPunct(t[0], '(') && closeOf(t, 0) === t.length) t = t.slice(1, -1)
  return t
}

/**
 * The first construct in `kept` whose meaning the v6 migration guide changed, as
 * `{what, why, tok}`, or null when the reached code means the same in v5 and v6.
 * @param {Array<{stmt: {header: object[], body: object[]}, kind: string, name?: string}>} kept
 *   the library's kept definitions (what the importing script reaches)
 * @param {number[]} indents the library's indent table (`lexPine(...).indents`)
 */
export function crossVersionDifference(kept, indents, { skip } = {}) {
  // ⭐⭐ the version island: a family the lane judges per token (`islandFamilies`) is not a difference there
  const skipped = new Set(Array.isArray(skip) ? skip : [])
  const hit = (family, d) => (family && skipped.has(family) ? null : { ...d, family: family || null })
  // ── type evidence: names shown to be bools / numbers anywhere in the kept code ──
  const boolNames = new Set()
  const numNames = new Set()
  const intLiteralNames = new Set()
  const notConstNames = new Set()
  const bindings = []
  const possiblyConstInt = (span) => span.length > 0 && span.every((t) => (t.kind === 'number' && /^\d+$/.test(String(t.raw)))
    || (t.kind === 'ident' && !t.member && intLiteralNames.has(String(t.value)) && !notConstNames.has(String(t.value)))
    || (t.kind === 'punct' && (['+', '-', '*', '%', '(', ')'].includes(t.value))))
  for (const d of kept) {
    const toks = [...d.stmt.header, ...d.stmt.body]
    // typed declarations and parameters: `[qualifier] TYPE name`
    for (let i = 0; i + 1 < toks.length; i += 1) {
      const t = toks[i]
      const n = toks[i + 1]
      if (t.kind !== 'ident' || t.member || n.kind !== 'ident' || n.member || String(n.value).includes('.')) continue
      if (t.value === 'bool') boolNames.add(String(n.value))
      if (t.value === 'float' || t.value === 'int') numNames.add(String(n.value))
      if (TYPE_WORDS.has(t.value) && t.value !== 'int') notConstNames.add(String(n.value))
      if (QUALIFIERS.has(t.value) && t.value !== 'const') {
        // `simple int x`, `var float x`, `series x`: the name after the type word, or the word itself
        const after = TYPE_WORDS.has(String(n.value)) ? toks[i + 2] : n
        if (after && after.kind === 'ident' && !after.member) notConstNames.add(String(after.value))
      }
    }
    // a function's parameters are never `const int`
    if (d.kind === 'fn' || d.kind === 'method') {
      const h = d.stmt.header
      const open = h.findIndex((t) => isPunct(t, '('))
      if (open >= 0) {
        const end = closeOf(h, open)
        for (const part of splitTop(h.slice(open + 1, end - 1), (t) => isPunct(t, ','))) {
          const eq = part.findIndex((t) => isPunct(t, '='))
          const name = nameOf((eq > 0 ? part.slice(0, eq) : part).slice(-1)[0])
          if (name) notConstNames.add(name)
        }
      }
    }
    // untyped bindings: the right side says what they hold
    for (const line of logicalLines(toks, indents)) {
      const lt = line.toks
      const eqAt = topIndex(lt, (t, i) => i > 0 && t.kind === 'punct' && (t.value === '=' || t.value === ':='))
      if (eqAt < 1) continue
      const target = lt[eqAt - 1]
      const name = nameOf(target)
      if (!name || name.includes('.') || target.member) continue
      const rhs = lt.slice(eqAt + 1)
      bindings.push({ name, rhs })
      if (evidentlyBool(rhs, boolNames)) boolNames.add(name)
      else if (evidentlyNumber(rhs, numNames)) numNames.add(name)
    }
  }
  // ⭐ v5 keeps a name `const int` once it is bound to one, even when it is reassigned later
  // (`c = 28`, `c := c / 100` is 0 in v5, witnessed by `vw-int-div-assign` D05): a name
  // bound anywhere to a const-int expression may be one, unless it is typed otherwise, given a
  // qualifier, or is a parameter.
  for (let grew = true; grew;) {
    grew = false
    for (const b of bindings) {
      if (!intLiteralNames.has(b.name) && !notConstNames.has(b.name) && possiblyConstInt(b.rhs)) {
        intLiteralNames.add(b.name)
        grew = true
      }
    }
  }

  for (const d of kept) {
    const toks = [...d.stmt.header, ...d.stmt.body]
    const lines = logicalLines(toks, indents)
    for (let i = 0; i < toks.length; i += 1) {
      const t = toks[i]
      const v = t.kind === 'ident' ? String(t.value) : null
      const next = toks[i + 1]
      const prev = toks[i - 1]
      if (v === 'timeframe.period') {
        const r = hit(ISLAND_FAMILY.TIMEFRAME_PERIOD, { what: '`timeframe.period`', why: 'its text is "D" in Pine v5 and "1D" in v6 (Timeframes must include a multiplier)', tok: t })
        if (r) return r
      }
      // ⭐⭐ the version island: `str.tostring` of a numeric constant with no format prints the literal in full
      // at v5 and to ten decimals at v6 (`pineTextFormat.js::literalTostringText`, captures S10 / S17 / s21).
      // ⚰️ Phase B's check did not hold it, so a v5 library's `str.tostring(0.123456789012)` was linked and
      // printed under v6 rules; it is a difference now, judged per token on the runtime lane.
      if ((v === 'str.tostring' || v === 'tostring') && !t.member && isPunct(next, '(')) {
        const args = splitTop(toks.slice(i + 2, closeOf(toks, i + 1) - 1), (x) => isPunct(x, ','))
        const constant = args.length === 1 && args[0].some((x) => x.kind === 'number')
          && args[0].every((x) => x.kind === 'number' || (x.kind === 'punct' && ['+', '-', '*', '/', '(', ')'].includes(x.value)))
        if (constant) {
          const r = hit(ISLAND_FAMILY.TOSTRING_LITERAL, { what: '`str.tostring` of a numeric constant with no format', why: 'TradingView prints the literal in full at v5 and to ten decimals at v6', tok: t })
          if (r) return r
        }
      }
      if (v && CHANGED_COLOURS[v]) {
        const r = hit(ISLAND_FAMILY.COLOURS, { what: `\`${v}\``, why: `its value changed: ${CHANGED_COLOURS[v]} (Color changes)`, tok: t })
        if (r) return r
      }
      if (v && !t.member && (v.startsWith('request.') || v === 'security')) {
        return hit(null, { what: `\`${v}\``, why: 'request rules changed in v6 (Dynamic requests)', tok: t })
      }
      if (v && !t.member && v.startsWith('strategy.')) {
        return hit(null, { what: `\`${v}\``, why: 'strategy rules changed in v6 (Strategies)', tok: t })
      }
      if (v === 'label.new' && isPunct(next, '(')) {
        const args = toks.slice(i + 2, closeOf(toks, i + 1) - 1)
        if (!args.some((a, k) => isWord(a, 'textcolor') && isPunct(args[k + 1], '='))) {
          return hit(null, { what: '`label.new` without `textcolor`', why: 'its default text colour is black in v5 and white in v6 (Color changes)', tok: t })
        }
      }
      if ((v === 'transp' || v === 'offset' || v === 'linewidth') && !t.member && isPunct(next, '=') && (isPunct(prev, ',') || isPunct(prev, '('))) {
        return hit(null, { what: `the \`${v}\` argument`, why: `v6 changed it (${v === 'transp' ? 'The transp parameter is removed' : v === 'offset' ? 'No series offset values' : 'Minimum linewidth is 1'})`, tok: t })
      }
      // a repeated named argument
      if (isPunct(t, '(') && prev && prev.kind === 'ident') {
        const end = closeOf(toks, i)
        const seen = new Set()
        for (const part of splitTop(toks.slice(i + 1, end - 1), (x) => isPunct(x, ','))) {
          if (part.length > 1 && part[0].kind === 'ident' && isPunct(part[1], '=')) {
            if (seen.has(part[0].value)) {
              return hit(null, { what: `the argument \`${part[0].value}\` given twice`, why: 'v5 keeps the first and v6 refuses (Cannot repeat parameters)', tok: part[0] })
            }
            seen.add(part[0].value)
          }
        }
        // a negative literal index
        const callee = String(prev.value)
        const last = callee.slice(callee.lastIndexOf('.') + 1)
        if (INDEX_CALLS.has(last) && (prev.member || callee.startsWith('array.') || callee.includes('.'))) {
          const parts = splitTop(toks.slice(i + 1, end - 1), (x) => isPunct(x, ','))
          const idx = callee.startsWith('array.') ? parts[1] : parts[0]
          if (idx && isPunct(idx[0], '-') && idx[1] && idx[1].kind === 'number') {
            return hit(null, { what: `the negative index in \`${callee}\``, why: 'v5 stops with a runtime error and v6 counts from the end (Negative indices in arrays)', tok: idx[0] })
          }
        }
      }
      // history of a literal, a built-in constant, or a field
      if (isPunct(t, '[') && prev && !isPunct(toks[i - 2], '.') && prev.line === t.line) {
        const lit = prev.kind === 'number' || prev.kind === 'string' || isWord(prev, 'true') || isWord(prev, 'false')
          || (prev.kind === 'ident' && String(prev.value).startsWith('color.'))
        const pv = prev.kind === 'ident' ? String(prev.value) : ''
        const field = prev.kind === 'ident' && (prev.member || (pv.includes('.') && !BUILTIN_HEADS.has(pv.split('.')[0])))
        if (lit || field) {
          return hit(null, { what: `\`${pv || prev.value}[…]\``, why: 'v6 no longer reads the history of a literal or of a field directly (History-referencing operator)', tok: t })
        }
        if (prev.kind === 'ident' && boolNames.has(pv)) {
          const r = hit(ISLAND_FAMILY.BOOL_NA, { what: `the history of the bool \`${pv}\``, why: 'on the first bars it is na in v5 and false in v6 (Boolean values cannot be na)', tok: t })
          if (r) return r
        }
      }
      // na() / nz() / fixnan() of anything not shown to be a number
      if ((v === 'na' || v === 'nz' || v === 'fixnan') && !t.member && isPunct(next, '(')) {
        const arg = splitTop(toks.slice(i + 2, closeOf(toks, i + 1) - 1), (x) => isPunct(x, ','))[0] || []
        if (!evidentlyNumber(arg, numNames)) {
          const r = hit(ISLAND_FAMILY.BOOL_NA, { what: `\`${v}()\` of a value not shown to be a number`, why: 'v5 reads an na bool there and v6 refuses a bool (Boolean values cannot be na)', tok: t })
          if (r) return r
        }
      }
      // const int / const int
      if (isPunct(t, '/') || isPunct(t, '/=')) {
        let a = i - 1
        if (isPunct(toks[a], ')')) {
          let dd = 0
          for (; a >= 0; a -= 1) {
            if (isPunct(toks[a], ')')) dd += 1
            else if (isPunct(toks[a], '(')) { dd -= 1; if (dd === 0) break }
          }
          if (a > 0 && toks[a - 1].kind === 'ident' && toks[a - 1].line === toks[a].line) a = -1 // a call
        }
        // `a * 3 / 2` is `(a * 3) / 2`: a product before the left operand belongs to it
        while (a > 0 && toks[a - 1].kind === 'punct' && ['*', '/', '%'].includes(toks[a - 1].value)) {
          a -= 2
          if (a >= 0 && isPunct(toks[a], ')')) {
            let dd = 0
            for (; a >= 0; a -= 1) {
              if (isPunct(toks[a], ')')) dd += 1
              else if (isPunct(toks[a], '(')) { dd -= 1; if (dd === 0) break }
            }
          }
          if (a < 0) break
        }
        const left = a >= 0 ? toks.slice(a, i) : []
        let b = i + 1
        if (isPunct(toks[b], '-')) b += 1
        const right = isPunct(toks[b], '(') ? toks.slice(i + 1, closeOf(toks, b)) : toks.slice(i + 1, b + 1)
        const leftOk = isPunct(t, '/=') ? possiblyConstInt(toks.slice(i - 1, i)) : possiblyConstInt(left)
        if (leftOk && possiblyConstInt(right) && !(right.length === 1 && right[0].kind === 'ident' && isPunct(toks[i + 2], '('))) {
          return hit(null, { what: 'a division of two values that may be `const int`', why: 'v5 truncates it and v6 keeps the fraction (Fractional division of constants)', tok: t })
        }
      }
    }
    // ── per logical line: and/or, conditions, for bounds, value if/switch, na given to a bool ──
    for (let k = 0; k < lines.length; k += 1) {
      const lt = lines[k].toks
      for (let i = 0; i < lt.length; i += 1) {
        const t = lt[i]
        if ((isWord(t, 'and') || isWord(t, 'or'))) {
          const right = []
          let d = 0
          for (let j = i + 1; j < lt.length; j += 1) {
            const x = lt[j]
            if (x.kind === 'punct' && OPENERS.has(x.value)) d += 1
            else if (x.kind === 'punct' && CLOSERS.has(x.value)) { d -= 1; if (d < 0) break }
            if (d === 0 && (isPunct(x, ',') || isPunct(x, '?') || isPunct(x, ':') || isPunct(x, '=>')
              || isWord(x, 'and') || isWord(x, 'or'))) break
            right.push(x)
          }
          for (let j = 0; j < right.length; j += 1) {
            const x = right[j]
            if (x.kind === 'ident' && isPunct(right[j + 1], '(') && !isPureCall(String(x.value), !!x.member)) {
              const r = hit(ISLAND_FAMILY.LAZY_AND_OR, { what: `\`${t.value}\` with a call on its right (\`${x.value}\`)`, why: 'v5 evaluates both sides on every bar and v6 skips the right side when the left decides (Lazy evaluation of conditions)', tok: t })
              if (r) return r
            }
          }
        }
      }
      // conditions: `if <cond>`, `<cond> ? a : b`, `not <x>`, operands of and/or
      const conds = []
      if (isWord(lt[0], 'if') || (isWord(lt[0], 'else') && isWord(lt[1], 'if'))) conds.push(lt.slice(isWord(lt[0], 'if') ? 1 : 2))
      const eqAt = lt.findIndex((x) => isPunct(x, '=') || isPunct(x, ':=') || isPunct(x, '=>'))
      const valueStart = eqAt >= 0 ? eqAt + 1 : 0
      if (isWord(lt[valueStart], 'if')) conds.push(lt.slice(valueStart + 1))
      for (let i = 0; i < lt.length; i += 1) {
        if (isPunct(lt[i], '?')) {
          let s = i - 1
          let d = 0
          for (; s >= 0; s -= 1) {
            const x = lt[s]
            if (x.kind === 'punct' && CLOSERS.has(x.value)) d += 1
            else if (x.kind === 'punct' && OPENERS.has(x.value)) { if (d === 0) break; d -= 1 }
            if (d === 0 && (isPunct(x, '=') || isPunct(x, ':=') || isPunct(x, '=>') || isPunct(x, ',') || isPunct(x, ':') || isPunct(x, '?'))) break
          }
          conds.push(lt.slice(s + 1, i))
        }
        if (isWord(lt[i], 'not')) {
          // the operand: a bracket group, or a name with its call / history brackets
          let e = i + 2
          if (isPunct(lt[i + 1], '(')) e = closeOf(lt, i + 1)
          else while (e < lt.length && (isPunct(lt[e], '(') || isPunct(lt[e], '['))) e = closeOf(lt, e)
          conds.push(lt.slice(i + 1, e))
        }
      }
      for (const c of conds) {
        for (const part of splitTop(unwrap(c), (x) => isWord(x, 'and') || isWord(x, 'or'))) {
          if (!evidentlyBool(part, boolNames)) {
            const r = hit(ISLAND_FAMILY.IMPLICIT_CAST, { what: `a condition not shown to be a bool (\`${part.map((x) => x.value).join(' ').slice(0, 60)}\`)`, why: 'v5 reads a number there as a bool and v6 refuses it (Explicit "bool" casting)', tok: part[0] })
            if (r) return r
          }
        }
      }
      // for: the end bound
      if (isWord(lt[0], 'for')) {
        const toAt = lt.findIndex((x) => isWord(x, 'to'))
        if (toAt > 0) {
          const byAt = lt.findIndex((x, j) => j > toAt && isWord(x, 'by'))
          const bound = lt.slice(toAt + 1, byAt > 0 ? byAt : lt.length)
          const body = []
          for (let j = k + 1; j < lines.length && lines[j].indent > lines[k].indent; j += 1) body.push(...lines[j].toks)
          const reassigned = new Set()
          const resized = new Set()
          for (let j = 0; j < body.length; j += 1) {
            const x = body[j]
            if (x.kind === 'ident' && ASSIGN_OPS.has(body[j + 1] && body[j + 1].value) && body[j + 1].kind === 'punct') reassigned.add(String(x.value))
            if (x.kind === 'ident' && isPunct(body[j + 1], '(')) {
              const s = String(x.value)
              const last = s.slice(s.lastIndexOf('.') + 1)
              if (RESIZERS.has(last)) {
                if (s.includes('.') && !/^(array|map|matrix)\./.test(s)) resized.add(s.slice(0, s.lastIndexOf('.')))
                else { const a0 = body[j + 2]; if (a0 && a0.kind === 'ident') resized.add(String(a0.value)) }
              }
            }
          }
          for (let j = 0; j < bound.length; j += 1) {
            const x = bound[j]
            if (x.kind !== 'ident' || x.member) continue
            const s = String(x.value)
            if (isPunct(bound[j + 1], '(')) {
              const arg = bound[j + 2]
              const sizeOf = SIZE_READS.has(s) && arg && arg.kind === 'ident' ? String(arg.value)
                : (/\.size$/.test(s) && !/^(array|map|matrix)\./.test(s) ? s.slice(0, -5) : null)
              if (!sizeOf || resized.has(sizeOf) || reassigned.has(sizeOf)) {
                const r = hit(ISLAND_FAMILY.FOR_BOUND, { what: `a \`for\` loop whose end bound calls \`${s}\``, why: 'v5 evaluates the bound once and v6 before every iteration (Dynamic for loop boundaries)', tok: lt[0] })
                if (r) return r
              }
              j = closeOf(bound, j + 1) - 1
              continue
            }
            if (reassigned.has(s.split('.')[0])) {
              const r = hit(ISLAND_FAMILY.FOR_BOUND, { what: `a \`for\` loop whose end bound reads \`${s}\`, which the loop reassigns`, why: 'v5 evaluates the bound once and v6 before every iteration (Dynamic for loop boundaries)', tok: lt[0] })
              if (r) return r
            }
          }
        }
      }
      // na given to a bool
      if (eqAt > 0 && lt[eqAt].value !== '=>') {
        const target = nameOf(lt[eqAt - 1])
        const rhs = lt.slice(eqAt + 1)
        if (target && boolNames.has(target) && rhs.some((x, j) => isWord(x, 'na') && !isPunct(rhs[j + 1], '('))) {
          const r = hit(ISLAND_FAMILY.BOOL_NA, { what: `\`na\` given to the bool \`${target}\``, why: 'a bool can be na in v5 and not in v6 (Boolean values cannot be na)', tok: lt[eqAt] })
          if (r) return r
        }
      }
      for (let i = 0; i < lt.length; i += 1) {
        if (!isWord(lt[i], 'na') || isPunct(lt[i + 1], '(')) continue
        const before = lt[i - 1]
        const after = lt[i + 1]
        if (isPunct(before, '?') || isPunct(before, ':') || isPunct(after, ':')) {
          // the other arm of the ternary
          const arms = lt.filter((x) => isWord(x, 'true') || isWord(x, 'false'))
          if (arms.length) {
            const r = hit(ISLAND_FAMILY.BOOL_NA, { what: '`na` as the arm of a bool ternary', why: 'a bool can be na in v5 and not in v6 (Boolean values cannot be na)', tok: lt[i] })
            if (r) return r
          }
        }
      }
    }
    // an `if` / `switch` VALUE without `else` / a default arm: v5 gives na, v6 false for a bool
    for (let k = 0; k < lines.length; k += 1) {
      const lt = lines[k].toks
      const eqAt = lt.findIndex((x) => isPunct(x, '=') || isPunct(x, ':='))
      const opener = eqAt >= 0 ? lt[eqAt + 1] : null
      const value = (opener && (isWord(opener, 'if') || isWord(opener, 'switch')))
      // the function's last statement is its value
      const lastAtBody = (d.kind === 'fn' || d.kind === 'method') && k > 0 && (isWord(lt[0], 'if') || isWord(lt[0], 'switch'))
        && !lines.slice(k + 1).some((l) => l.indent <= lines[k].indent && !isWord(l.toks[0], 'else'))
      if (!value && !lastAtBody) continue
      const word = value ? opener.value : lt[0].value
      const indent = lines[k].indent
      let closed = false
      const arms = []
      for (let j = k + 1; j < lines.length && lines[j].indent >= indent; j += 1) {
        const l = lines[j]
        if (word === 'if' && l.indent === indent && isWord(l.toks[0], 'else') && !isWord(l.toks[1], 'if')) closed = true
        if (word === 'switch' && l.indent > indent && isPunct(l.toks[0], '=>')) closed = true
        if (l.indent === indent && !isWord(l.toks[0], 'else')) break
        if (l.indent > indent) arms.push(...l.toks)
      }
      // only a BOOL result differs (v5 na, v6 false); a number is na in both
      const mayBeBool = arms.some((x) => (x.kind === 'punct' && COMPARISONS.has(x.value))
        || (x.kind === 'ident' && !x.member && (['true', 'false', 'and', 'or', 'not'].includes(x.value)
          || boolNames.has(String(x.value)) || BOOL_CALLS.has(String(x.value))
          || BOOL_PREFIXES.some((pre) => String(x.value).startsWith(pre)))))
      if (!closed && mayBeBool) {
        const r = hit(ISLAND_FAMILY.BOOL_NA, { what: `an \`${word}\` used as a value without ${word === 'if' ? '`else`' : 'a default arm'}`, why: 'a bool result is na in v5 and false in v6 (Boolean values cannot be na)', tok: value ? opener : lt[0] })
        if (r) return r
      }
    }
  }
  return null
}

/** Is this span a bool by its own shape? */
function evidentlyBool(span, boolNames) {
  const s = unwrap(span || [])
  if (!s.length) return false
  let d = 0
  for (let i = 0; i < s.length; i += 1) {
    const t = s[i]
    if (t.kind === 'punct' && OPENERS.has(t.value)) { d += 1; continue }
    if (t.kind === 'punct' && CLOSERS.has(t.value)) { d -= 1; continue }
    if (d !== 0) continue
    if (t.kind === 'punct' && COMPARISONS.has(t.value)) return true
    if (isWord(t, 'and') || isWord(t, 'or') || isWord(t, 'not')) return true
  }
  if (s.length === 1 && (isWord(s[0], 'true') || isWord(s[0], 'false'))) return true
  if (s.length === 1 && s[0].kind === 'ident' && !s[0].member) {
    const v = String(s[0].value)
    return boolNames.has(v) || BOOL_PREFIXES.some((p) => v.startsWith(p))
  }
  if (s[0].kind === 'ident' && isPunct(s[1], '(') && closeOf(s, 1) === s.length) return BOOL_CALLS.has(String(s[0].value))
  return false
}

/** Is this span a number by its own shape? */
function evidentlyNumber(span, numNames) {
  const s = unwrap(span || [])
  if (!s.length) return false
  let d = 0
  for (let i = 0; i < s.length; i += 1) {
    const t = s[i]
    if (t.kind === 'punct' && OPENERS.has(t.value)) { d += 1; continue }
    if (t.kind === 'punct' && CLOSERS.has(t.value)) { d -= 1; continue }
    if (d === 0 && t.kind === 'punct' && (ARITHMETIC.has(t.value)) && i > 0) return true
    if (d === 0 && (t.kind === 'punct' && (COMPARISONS.has(t.value) || t.value === '?'))) return false
    if (d === 0 && (isWord(t, 'and') || isWord(t, 'or') || isWord(t, 'not'))) return false
  }
  if (s.length === 1 && s[0].kind === 'number') return true
  if (s.length === 2 && isPunct(s[0], '-') && s[1].kind === 'number') return true
  const head = s[0]
  if (head.kind !== 'ident' || head.member) return false
  const v = String(head.value)
  // `x` or `x[n]`
  const rest = s.slice(1)
  const historyOnly = !rest.length || (isPunct(rest[0], '[') && closeOf(rest, 0) === rest.length)
  if (historyOnly) return numNames.has(v) || NUMERIC_SERIES.has(v)
  // a numeric call (optionally with history)
  if (isPunct(s[1], '(')) {
    const end = closeOf(s, 1)
    const tail = s.slice(end)
    if (tail.length && !(isPunct(tail[0], '[') && closeOf(tail, 0) === tail.length)) return false
    return NUMERIC_CALL_PREFIXES.some((p) => v.startsWith(p)) && !NOT_NUMERIC_TA.has(v)
  }
  return false
}
