// ─── `let` BINDINGS ARE SOURCE SUGAR — THE TREE NEVER LEARNS THEM ────────────
// Spec §5.2: `let c1 = …` lines, then the expression; the parser inlines and the
// AST and `astHash` are UNCHANGED; `compute.source` keeps the text verbatim.
// This module is a PRE-PASS over the source string, not a parser: `parse.js`
// stays the one grammar (D-A1). It runs inside `pcf.readFormulaSource` (the one
// read door), so a `let` source meets the same `parseFormula`, the same budget,
// the same linter and the same schema rule 2 as a formula with none.
//
// ⭐ WHY A PRE-PASS AND NOT A GRAMMAR. A binding is not a node: adding one to
// `closedTable.json` would put a `let` in every walker (interpret, lint, budget,
// freshness, sentence, and the whole Python lane), and the hash of a formula
// would then depend on whether its author factored it — so the SAME maths would
// save under two `fn`s. Inlining before the parser makes "bindings are sugar"
// true BY CONSTRUCTION rather than by a rule somebody has to keep.
//
// ⛔ REFUSE BY NAME, AT THE TOKEN. Three gates, a closed set (`LET_GUARDS`):
//   let:syntax     a `let` line that is not `let <name> = <expr>`, a name the
//                  ONE key grammar refuses, a `let` after the expression, or
//                  bindings with nothing to feed
//   let:shadow     a binding named like a closed-table entry, like a recurrence
//                  binding (both DERIVED from the manifest, never listed here)
//                  or like a declared input
//   let:undefined  a binding used before it is bound, or bound to itself
// ⚠️ THE EXTENSION IS LOAD-BEARING, not style. `tests/test_scan_definition.py`
// boots these modules in RAW NODE (`await import(pathToFileURL(…))`), where an
// extensionless specifier is `ERR_MODULE_NOT_FOUND` rather than a resolution —
// and this module is now one hop from `pcf.js`, the one read door a lane would
// boot to check a stored `compute.source` across lanes.
import { TABLE, KEY_RE, RECURRENCE_BINDINGS } from './parse.js'

export const LET_GUARDS = Object.freeze(['let:syntax', 'let:shadow', 'let:undefined'])

/** A line that CLAIMS to be a binding. `\b` so a formula whose expression starts
 *  with `letter` is not read as a malformed `let`. */
const LET_LINE_RE = /^\s*let\b/

/** `let <name> = <expression>`, trailing `;` optional. ⭐ THE PREFIX AND THE
 *  SEPARATOR ARE CAPTURED, not skipped: their LENGTHS are how every refusal
 *  below reports a column. `raw.indexOf(name)` would find `et` inside `let`
 *  for a binding named `et`, and hand-arithmetic (`name.length + 3`) assumes
 *  one space either side of `=` — a lint mark on the wrong character.
 *
 *  The name is captured LOOSELY (any run of non-space, non-`=`) and validated
 *  against `KEY_RE` below, so `let 1a = 2` is refused BY NAME at `1a` instead of
 *  falling through as "this is not a let line at all". */
const LET_RE = /^(\s*let\s+)([^\s=]+)(\s*=\s*)(.*?)\s*;?\s*$/

const IDENT_RE = /[A-Za-z_][A-Za-z0-9_]*/g

/** Every name the closed table already computes, plus every name a recurrence
 *  body binds.
 *
 *  ⭐ DERIVED FROM THE MANIFEST'S OWN SHAPE — the sections are whatever the
 *  manifest declares that is not a `_`-prefixed note, so the `clock` section
 *  landing tomorrow reserves `time` and `barindex` the day it lands with no
 *  edit here. A hand-list of four section names would be a second authority
 *  over "what names are taken".
 *
 *  ⛔ AND A RECURRENCE BINDING IS RESERVED TOO — the same line `interpret.js`
 *  already carries for inputs, for the same reason. `self` is in no section, so
 *  without this `let self = 5` would textually rewrite every `self` inside an
 *  `accum` body to `(5)`: a formula that still computes, and computes the wrong
 *  thing. */
const RESERVED = (() => {
  const out = new Set(RECURRENCE_BINDINGS)
  for (const [section, entries] of Object.entries(TABLE)) {
    if (section.startsWith('_') || !entries || typeof entries !== 'object') continue
    for (const name of Object.keys(entries)) out.add(name)
  }
  return out
})()

const refuse = (guard, error, line, column, token) =>
  ({ ok: false, source: null, bindings: [], guard, error, line, column, token })

/** Whole-identifier substitution: `name` → `(expr)`; `x.name` and `namex` are
 *  left alone.
 *
 *  ⛔ THE PARENTHESES ARE THE WHOLE REASON THIS IS SAFE. `let d = high - low`
 *  then `d * 2` must inline to `(high - low) * 2` — a bare paste would bind as
 *  `high - low * 2`, which parses, runs, and answers a different question.
 *  ⛔ AND THE REPLACEMENT IS A FUNCTION, never a string: a `$&` inside an
 *  expression would otherwise be read as a replacement pattern. `name` is
 *  `KEY_RE`-validated before it reaches this, so it cannot carry regex
 *  metacharacters either. */
function substitute(text, name, expr) {
  const re = new RegExp(`(^|[^A-Za-z0-9_.])(${name})(?![A-Za-z0-9_])`, 'g')
  return text.replace(re, (m, pre) => `${pre}(${expr})`)
}

/**
 * Inline the `let` bindings a source declares, or refuse by name at the token.
 *
 * Grammar: `let <name> = <expression>`, one per line, trailing `;` optional, ALL
 * `let` lines before the expression; the remaining non-blank lines ARE the
 * expression. Substitution is textual, whole-identifier, parenthesised, in
 * binding order — a later binding may use an earlier one, never a later one.
 *
 * @param {string} source the text the member typed, verbatim
 * @param {object} [inputs] the declared input scope (`declaredInputs(def)`'s
 *        `{[key]: true}` shape). ⚠️ OPTIONAL, AND ABSENT IS NOT EMPTY: a caller
 *        that does not know the inputs (the text box mid-type) must not have a
 *        binding refused for shadowing a knob it cannot see. The sheet's save
 *        gate and W1a's diagnostics hand it in; `readFormulaSource` does not.
 * @returns {{ok: true, source: string, bindings: {name: string, expr: string, line: number}[]}
 *          | {ok: false, source: null, bindings: [], guard: string, error: string,
 *             line: number, column: number, token: string}}
 */
export function prepareSource(source, inputs = undefined) {
  // A non-string is the PARSER's refusal to name, not this one's: handing the
  // empty string on keeps `canonicalise:empty` the message a caller sees, which
  // is byte-identical to what `parseFormula` said before this door existed.
  if (typeof source !== 'string') return { ok: true, source: '', bindings: [] }

  const lines = source.split('\n')
  const lets = []
  const exprLines = []
  for (let i = 0; i < lines.length; i += 1) {
    const raw = lines[i]
    if (raw.trim() === '') continue
    if (!LET_LINE_RE.test(raw)) { exprLines.push(raw); continue }
    const line = i + 1
    // ⭐ POSITION FIRST, SHAPE SECOND. A `let` below the expression is refused
    // for being below it whether or not the line itself is well formed — the
    // defect the author must fix is the ordering.
    if (exprLines.length) {
      return refuse('let:syntax',
        '`let` lines come before the expression they feed, never after it', line, raw.indexOf('let') + 1, 'let')
    }
    const m = LET_RE.exec(raw)
    if (!m) {
      return refuse('let:syntax',
        'a `let` line is `let <name> = <expression>`', line, raw.indexOf('let') + 1, raw.trim())
    }
    const [, prefix, name, sep, expr] = m
    const column = prefix.length + 1
    if (!KEY_RE.test(name)) {
      return refuse('let:syntax',
        `\`${name}\` is not a name — a binding is named like an input or a plot: a letter, then ` +
        `letters, digits and underscores`, line, column, name)
    }
    if (expr === '') {
      return refuse('let:syntax',
        `\`let ${name}\` binds nothing — write \`let ${name} = <expression>\``, line, column, name)
    }
    lets.push({ name, expr, line, column, exprColumn: prefix.length + name.length + sep.length + 1 })
  }

  // ⭐ THE NO-`let` PATH RETURNS THE SOURCE ITSELF, before any of the work
  // below. Every formula this product has ever saved takes it, so the pre-pass
  // is invisible to all of them.
  if (!lets.length) return { ok: true, source, bindings: [] }

  const declared = inputs && typeof inputs === 'object' ? new Set(Object.keys(inputs)) : new Set()
  const names = lets.map((b) => b.name)
  for (let i = 0; i < lets.length; i += 1) {
    const b = lets[i]
    if (RESERVED.has(b.name)) {
      return refuse('let:shadow',
        `\`${b.name}\` is a name the closed table already computes — a binding cannot shadow it`,
        b.line, b.column, b.name)
    }
    if (declared.has(b.name)) {
      return refuse('let:shadow',
        `\`${b.name}\` is a declared input — a binding cannot shadow it`, b.line, b.column, b.name)
    }
    if (names.indexOf(b.name) !== i) {
      return refuse('let:shadow', `\`${b.name}\` is already bound above`, b.line, b.column, b.name)
    }
    // ⛔ USE-BEFORE-DEFINE IS WHAT MAKES THE SUBSTITUTION ORDER SOUND. Because a
    // binding may only name bindings ABOVE it, no expression can still hold a
    // binding name after its own turn — so inlining in declaration order can
    // never re-substitute text a previous pass wrote.
    for (const hit of b.expr.matchAll(IDENT_RE)) {
      const id = hit[0]
      if (names.indexOf(id) >= i) {
        return refuse('let:undefined',
          `\`${id}\` is used before it is bound`, b.line, b.exprColumn + hit.index, id)
      }
    }
  }

  let out = exprLines.join('\n')
  if (out.trim() === '') {
    return refuse('let:syntax',
      'the last line must be the expression the bindings feed', lines.length, 1, '')
  }

  const bindings = []
  for (const b of lets) {
    // ⚠️ `expr` IS THE INLINED TEXT, not what the author typed — it is what
    // actually replaced the name, which is the only version a caller can hand
    // to the parser and get the same tree back.
    let inlined = b.expr
    for (const prev of bindings) inlined = substitute(inlined, prev.name, prev.expr)
    bindings.push({ name: b.name, expr: inlined, line: b.line })
  }
  for (const b of bindings) out = substitute(out, b.name, b.expr)
  return { ok: true, source: out, bindings }
}
