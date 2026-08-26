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
//
// ⛔⛔ THE ONE REAL COST, NAMED: A PARSER OFFSET NO LONGER INDEXES THE MEMBER'S
// TEXT. `parseFormula` sees the INLINED string, so jsep's character offset — the
// part `parse.js` keeps unedited *because* "a rewritten one loses the character
// offset the text box needs", and the part `FormulaField.jsx` calls "the only
// part a user can act on" — counts characters nobody typed. Measured:
//
//     let fast = ema(close, 12)        the typo `(` is at character 64
//     let slow = ema(close, 26)        the door says "Expected ) at character 36"
//     fast - slow(                     36 indexes the inlined string
//
// This is inherent: substitution changes the length of the text before the
// error, so no offset survives it. ⚠️ It is PINNED by a case, not just written
// here, so it stays a known fact rather than a surprise.
//
// ⭐ WHAT IS RECOVERABLE IS THE **LINE**, EXACTLY — and the result carries it as
// `lineOffset`: `authorLine = inlinedLine + lineOffset`. That identity holds
// because the pre-pass removes only a PREFIX of whole lines (the bindings) and
// then preserves every line of the expression region, blank ones included.
// ⛔ THE BLANK LINES ARE KEPT FOR THIS REASON ALONE. Dropping them was free and
// invisible to the parser, and it broke the identity for any expression with a
// gap in it — which is precisely when a member most needs the mark in the right
// place. A CALLER PLACING A DIAGNOSTIC ON A `let` SOURCE MUST NOT USE A RAW
// PARSER OFFSET: map the offset to a line in `source`, add `lineOffset`, and
// mark the whole line — or mark the expression region as a whole.
// ⚠️ AND KEEPING THEM IS NOT FREE IN EVERY DIRECTION — say it accurately.
// It is free for the TREE and for the HASH: measured, `(2) +\n\n1`, `(2) +\n1`
// and `(2) + 1` all canonicalise and hash identically, so no `def_hash` moves on
// account of a gap. It is NOT free for the CHARACTER offset — every kept newline
// pushes the reported character further from the one the member typed. That cost
// is inside the one this header already names (the offset indexes the inlined
// string, never the member's text); it is not a second, and it is the trade the
// paragraph above takes deliberately, because the LINE is what a mark needs.
//
// ⚠️ THE `.js` EXTENSION BELOW IS LOAD-BEARING, not style. `tools/ast_conformance.py`
// boots these modules in RAW NODE and its `_JS_JSON_HOOK` shims `.json` ONLY —
// it registers no `resolve` hook, so an extensionless specifier there is
// `ERR_MODULE_NOT_FOUND` rather than a resolution, and this module is one hop
// from `pcf.js`. ⚰️ SAID `tests/test_scan_definition.py` was the exposure — it
// is not: that harness's `_JS_HOOK` DOES carry a `resolve` that appends `.js`
// (reviewer, fix round 1). The extension is still required; the witness moved.
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
 *  ⛔ AND THE `_` TEST IS LOAD-BEARING, NOT TIDINESS. The `_`-prefixed keys are
 *  not all prose: `_functions_excluded` and `_scalars_excluded` are OBJECTS
 *  whose keys are the names this table deliberately does NOT compute. Without
 *  the prefix test they would be reserved too — and a member would be refused
 *  `let:shadow` for naming a binding after something the engine cannot compute
 *  at all, which is the exact opposite of what the gate is for. A case pins
 *  that an excluded name is still a legal binding.
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
 *        binding refused for shadowing a knob it cannot see.
 *
 *        ⛔⛔ A CALLER THAT PASSES NO SCOPE GETS NO INPUT-SHADOW PROTECTION, AND
 *        THE OUTCOME WAS A STORED DEFECT, NOT A MISSED WARNING. Until W1b.5
 *        `readFormulaSource` passed none, so `defSchema.validateAstCompute`
 *        ACCEPTED a document that declares an input `period` and also says
 *        `let period = 5`: the pre-pass rewrites every `period` to `(5)`, the
 *        tree agrees with the source, rule 2 is satisfied, and the document
 *        SAVED WITH ITS DECLARED KNOB DOING NOTHING. Turning the knob changed
 *        nothing and the definition looked broken for no visible reason.
 *        ✅ FIXED, AND THE FIX IS THE WIRING RATHER THAN THIS DEFAULT.
 *        `readFormulaSource(source, dialect, inputs)` threads a scope into
 *        `READERS.native`, and the three callers that KNOW the inputs hand
 *        theirs in: `evaluateFormula` (the text box, and every save gate that
 *        reads its verdict), `defSchema.validateCompute` (`declaredInputs(def)`,
 *        so a document POSTed straight at the API is refused too) and
 *        `editor/completions.js`, which already did — which is why the popup was
 *        for a while STRICTER than the door that could actually stop a save.
 *        `BuilderSheet.letScope.test.jsx` is the rail on the handing-in, because
 *        the wiring is the part that can be silently dropped later.
 * @returns {{ok: true, source: string, bindings: {name: string, expr: string, line: number}[],
 *             lineOffset: number}
 *          | {ok: false, source: null, bindings: [], guard: string, error: string,
 *             line: number, column: number, token: string}}
 *
 *        `bindings[].expr` is the INLINED text — what actually replaced the
 *        name, and the only version that hands back to the parser as the same
 *        tree. ⚠️ The author's own words are not lost and need no second field:
 *        `bindings[].line` is the line of `source` they are on, so a caller
 *        that wants `let line = fast - slow` reads it off the member's text.
 *
 *        `lineOffset` maps a position in the returned `source` back to the
 *        member's: `authorLine = inlinedLine + lineOffset`. It is 0 whenever the
 *        source is returned verbatim. See the header for what is NOT mappable.
 */
export function prepareSource(source, inputs = undefined) {
  // A non-string is the PARSER's refusal to name, not this one's: handing the
  // empty string on keeps `canonicalise:empty` the message a caller sees, which
  // is byte-identical to what `parseFormula` said before this door existed.
  if (typeof source !== 'string') return { ok: true, source: '', bindings: [], lineOffset: 0 }

  const lines = source.split('\n')
  const lets = []
  const exprLines = []
  // The member's line number of the FIRST expression line, minus one. Once the
  // expression has started EVERY line joins it, blank ones included, so
  // `authorLine = inlinedLine + lineOffset` holds for the whole region.
  let lineOffset = 0
  for (let i = 0; i < lines.length; i += 1) {
    const raw = lines[i]
    const started = exprLines.length > 0
    // ⛔ BLANK LINES ARE SKIPPED ONLY *ABOVE* THE EXPRESSION. Inside it they are
    // kept, or a gap in the member's formula silently slides every line below it
    // and `lineOffset` stops being a mapping. Above it they cost nothing: the
    // offset already counts them.
    if (raw.trim() === '' && !started) continue
    if (!LET_LINE_RE.test(raw)) {
      if (!started) lineOffset = i
      exprLines.push(raw)
      continue
    }
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
  // `lineOffset: 0` because `source` IS the member's text — every position in it
  // is already theirs, and that is the claim, not an absence of one.
  if (!lets.length) return { ok: true, source, bindings: [], lineOffset: 0 }

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
  return { ok: true, source: out, bindings, lineOffset }
}
