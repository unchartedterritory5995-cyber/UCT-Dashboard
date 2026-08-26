// app/src/components/chart/builder/editor/completions.js
//
// ─── COMPLETIONS, DERIVED ───────────────────────────────────────────────────
//
// Three sources, one list: the closed table (name · arity/lookback · the
// manifest's own sentence), the definition's declared inputs (the same scope
// object the linter and the read-back take), and every `let` binding in the
// buffer. ⛔ Nothing here is typed by hand; the day the manifest gains a
// function it is offered, and a name the manifest drops is gone.
//
// ⛔⛔ AND THE SECTIONS ARE NOT NAMED EITHER — the kind is read off the ENTRY'S
// OWN SHAPE. Naming `functions`/`series`/`scalars` would have been a second
// authority over "what the manifest holds", and it would already be wrong: W2a's
// `clock` section landed while this was being written, and a hand list would
// have silently stopped offering thirteen names a member can type today. An
// entry with `args` is a call; one with a `cadence` is a fundamental; anything
// else is a column, and it wears its SECTION as its detail (`series`, `clock`).
//
// ⛔ THE OPERATOR SECTION IS EXCLUDED BY THE ONLY RULE THAT MATTERS HERE: a
// completion is a NAME a member types, and `&&`/`?:`/`u-` are not names. That is
// `KEY_RE` — parse.js's own definition of a writable name — not a section list.

import { TABLE, KEY_RE, LOOKBACK_RE } from '../../engine/ast/parse'
import { prepareSource } from '../../engine/ast/letPrepass'

const WORD_UNDER_CARET = /[A-Za-z_][A-Za-z0-9_]*/

/** `{0}`/`{1}` are the manifest's argument positions; the manifest's own
 *  `argRoles` name them. A position with no role stays as written. */
function renderSentence(entry) {
  if (typeof entry.sentence !== 'string') return undefined
  const roles = Array.isArray(entry.argRoles) ? entry.argRoles : []
  return entry.sentence.replace(/\{(\d+)\}/g, (whole, i) => (roles[Number(i)] !== undefined ? roles[Number(i)] : whole))
}

/** A `lookback` declaration as a member can read it.
 *
 *  ⭐ THE SAME SUBSTITUTION `renderSentence` DOES, ON THE SAME 0-BASED POSITIONS.
 *  The manifest writes a lookback as a REFERENCE to an argument (`arg1`, and
 *  `2*arg3` with a multiplier) for 28 of today's 50 functions — `sma` among
 *  them, the first name anyone types — so printing it verbatim put `lookback
 *  arg1` in front of a member. `LOOKBACK_RE` is `parse.js`'s own pattern for
 *  that grammar (`lint.js` uses it under the alias `ARG_REF`, and reads the
 *  index the same 0-based way at `argNodes[Number(m[2])]`), so this resolves the
 *  reference with the manifest's own regex and the manifest's own role names.
 *  A shape it does not recognise — a plain number, anything new — is printed
 *  as written rather than guessed at. */
function renderLookback(entry) {
  const raw = String(entry.lookback)
  const m = LOOKBACK_RE.exec(raw)
  if (!m) return raw
  const roles = Array.isArray(entry.argRoles) ? entry.argRoles : []
  const role = roles[Number(m[2])]
  if (role === undefined) return raw
  return m[1] === undefined ? role : `${m[1]}*${role}`
}

/** One manifest entry → the option CodeMirror shows for it.
 *
 *  ⛔ THE ORDER OF THESE THREE TESTS IS LOAD-BEARING, AND IT IS ABOUT TO MATTER.
 *  The closed-table v2 contract has every function declare a `cadence` alongside
 *  its `args`; a `cadence` test placed first would then relabel all fifty calls
 *  as fundamentals — offering `sma` as `scalar · nightly`, with nothing refusing.
 *  `args` is what makes a thing callable, so `args` decides first.
 *
 *  `detail` resolves the lookback REFERENCE (`renderLookback`) rather than
 *  printing it verbatim — see there for why and with whose regex. */
function optionFor(label, entry, section) {
  const info = renderSentence(entry) || (typeof entry.doc === 'string' ? entry.doc : undefined)
  if (Array.isArray(entry.args)) {
    const roles = Array.isArray(entry.argRoles) ? entry.argRoles : entry.args
    return { label, type: 'function', detail: `(${roles.join(', ')}) · lookback ${renderLookback(entry)}`, info }
  }
  if (entry.cadence !== undefined) {
    return { label, type: 'property', detail: `scalar · ${entry.cadence}`, info }
  }
  return { label, type: 'variable', detail: section, info }
}

/**
 * Every NAME the closed table declares, as completion options.
 *
 * @param {object} [table] defaults to the frozen manifest `parse.js` exports.
 */
export function tableOptions(table = TABLE) {
  const out = []
  for (const [section, entries] of Object.entries(table || {})) {
    // `_`-prefixed keys are the manifest's own notes; `tableVersion` is a number.
    if (section.startsWith('_') || !entries || typeof entries !== 'object') continue
    for (const [label, entry] of Object.entries(entries)) {
      if (!KEY_RE.test(label) || !entry || typeof entry !== 'object') continue
      out.push(optionFor(label, entry, section))
    }
  }
  return out
}

/** The definition's declared knobs — `lint.declaredInputs`' `{[key]: true}`. */
export function inputOptions(inputs) {
  return Object.keys(inputs || {}).map((label) => ({ label, type: 'variable', detail: 'input' }))
}

/**
 * The `let` bindings a buffer declares, with the LINE each was declared on.
 *
 * ⛔⛔ THE GRAMMAR IS `letPrepass.prepareSource`'S, NOT THIS FILE'S. A
 * `^\s*let\s+(\w+)` scan here would be a second authority over what a binding
 * is, and it would already disagree: `let close = high` matches that regex and
 * is REFUSED (`let:shadow`), so the editor would offer a name in the very line
 * it is about to underline. One module owns `let`; this asks it.
 *
 * ⚠️ AND IT IS ASKED TWICE, BECAUSE AN EDITOR BUFFER IS NOT A SAVED SOURCE. The
 * pre-pass requires the expression the bindings feed, and the commonest state a
 * caret is ever in is "bindings written, expression not yet" — a refusal, and
 * the right one for a save. So a refused source is offered the one thing it is
 * missing (a trailing `0`) and the SAME grammar is asked again. That supplies a
 * line; it never decides what binds. A source that still refuses binds nothing.
 *
 * ⛔⛔ AND THE SCOPE GOES WITH IT. `prepareSource`'s second argument is the
 * declared-input scope, and its own docblock warns that ABSENT IS NOT EMPTY: a
 * caller that omits it has the input-shadow gate short-circuited to an empty
 * set. This module is a caller that KNOWS the inputs — `formulaCompletionSource`
 * is handed them — so omitting them was asking the grammar a question with the
 * answer removed. Measured: `let period = 5` beside a declared `period` read
 * `ok` without the scope and `let:shadow` with it, and the popup offered
 * `period` TWICE, the second labelled `let` for a binding the save gate refuses.
 *
 * @param {string} text the buffer
 * @param {object} [inputs] the declared-input scope, when the caller knows it
 */
export function letBindings(text, inputs = undefined) {
  const src = typeof text === 'string' ? text : ''
  if (!src.includes('let')) return []
  const read = prepareSource(src, inputs)
  const settled = read.ok ? read : prepareSource(`${src}\n0`, inputs)
  if (!settled.ok) return []
  return settled.bindings.map((b) => ({ name: b.name, line: b.line }))
}

/** Just the names — `letBindings` without the lines. */
export function letNames(text, inputs = undefined) {
  return letBindings(text, inputs).map((b) => b.name)
}

/**
 * @param {{inputs?: object, table?: object}} [opts] `inputs` is the declared-input
 *   SCOPE (`lint.declaredInputs` output), the same object `FormulaField` takes.
 * @returns {(ctx: import('@codemirror/autocomplete').CompletionContext) => object|null}
 */
export function formulaCompletionSource({ inputs = undefined, table = TABLE } = {}) {
  const fixed = [...tableOptions(table), ...inputOptions(inputs)]
  return (ctx) => {
    const word = ctx.matchBefore(WORD_UNDER_CARET)
    if (!word && !ctx.explicit) return null
    const typed = word ? word.text.toLowerCase() : ''
    const from = word ? word.from : ctx.pos
    // ⛔ A BINDING IS NOT OFFERED ON THE LINE THAT DECLARES IT. `let slow = slo…`
    // cannot mean anything — the pre-pass refuses a binding bound to itself — so
    // offering it there completes into a refusal. The declaring LINE comes from
    // the pre-pass's own `bindings[].line`; matching the typed text against the
    // buffer by hand would find a later USE and suppress the wrong one.
    const caretLine = ctx.state.doc.lineAt(ctx.pos).number
    const lets = letBindings(ctx.state.doc.toString(), inputs)
      .filter((b) => b.line !== caretLine)
      .map((b) => ({ label: b.name, type: 'variable', detail: 'let' }))
    const options = [...fixed, ...lets].filter((o) => o.label.toLowerCase().startsWith(typed))
    return { from, options, validFor: /^[A-Za-z_][A-Za-z0-9_]*$/ }
  }
}
