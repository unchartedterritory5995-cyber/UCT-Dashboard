// ─── THE thinkScript READER — A THIRD SURFACE LANGUAGE, ONE CANONICAL TREE ───
//
// A member who has spent five years in thinkorswim types
// `def x = Average(close, 50); plot scan = close > x;`. This file is how that
// reaches the same engine `sma(close, 50)` reaches: it produces the SAME
// canonical tree `parse.js` produces, so the chart, the scan and the alert all
// get the object they already share, and the budget, the repaint linter and the
// read-back all decide about it unchanged.
//
// ⭐ IT IS `pine.js`'s SHAPE, NOT ITS COPY. When this module first emits a tree
// it will IMPORT `printFormula` and `treeYieldsBool` from `pine.js` — one
// printer, one round-trip, one `yields` reader — and `closedTable.json` stays
// the only list of what a formula may call. Every engine function this module
// emits is to be LOOKED UP in `TABLE.functions` at translation time; a token
// whose engine function the table does not declare refuses BY NAME rather than
// resolving to something this file believes.
//
// ⛔ AND THOSE IMPORTS ARE NOT HERE YET, DELIBERATELY. This task ships the
// refusal vocabulary and nothing that emits a tree, so importing a printer it
// never calls would be four symbols of decoration in a file a later engineer
// audits against — the "built, tested, green and unreachable" shape this repo
// keeps paying for. The rule above is recorded where the task that needs it will
// read it; the wiring lands with the task that first has a tree to print.
//
// ⛔ WHAT THIS TRANSLATOR WILL NOT DO: guess a proprietary formula. thinkorswim
// publishes the maths for `Average`, `ExpAverage`, `WildersAverage`, `StDev`,
// `TrueRange`, `Highest`/`Lowest`, `Log`, `within`, `between` and
// `CompoundValue`, and every one of those will be mapped by an IDENTITY quoted
// at its call shape. It publishes no formula for `TTM_Squeeze` or for a study's
// undeclared defaults, and those refuse at their token with the reason. A silent
// mistranslation is far worse than a refusal: the member gets a chart that looks
// right and is wrong.
//
// ⚠️ ONE CONVENTION IS OURS AND IS SAID OUT LOUD: the reference defines
// `crosses above` only as *"tests if value1 gets higher than value2"*, while
// this engine's `crossOver(a, b)` is `a > b && a[1] <= b[1]` (interpret.js).
// The strict/non-strict edge on the PRIOR bar is therefore this engine's
// reading, not a quoted one, and the read-back says `crossing above` so a member
// sees which function they got.
//
// ⏳ WHAT IT READS TODAY: NOTHING, AND THAT IS THE MEASUREMENT. Every source
// refuses `thinkscript:unsupported` at the first token of the first line that
// carries any text. `thinkscript.corpus.test.js` pins that at 0 of the 24 real
// published studies in `tests/fixtures/thinkscript/`, in BOTH directions, so
// every later task's gain is a fact rather than a claim.
//
// SOURCES for the language (read 2026-08-25, toslc.thinkorswim.com; the pages
// are Schwab's and are quoted, never copied):
//   * Reserved words — /center/reference/thinkScript/Reserved-Words/{within,between,rec,crosses,reference}
//   * Functions — /center/reference/thinkScript/Functions/{Tech-Analysis,Others,Statistical,Math---Trig}/…
//   * Studies — /center/reference/Tech-Indicators/studies-library/…
//   * Tutorials — /center/reference/thinkScript/tutorials/{Basic,Advanced}/…

/** guard → the sentence it always refuses with. CLOSED, and closed in two places
 *  that fail differently: `thinkscript.test.js` derives the guard strings from
 *  this module's own source and fails on any absent here, and the constructor
 *  below rejects one arriving from another module at runtime — which no regex
 *  over this file could ever see. This table stays the single authority; both
 *  rails read it.
 *
 *  Every sentence is pairwise-disjoint from the other six declared tables in the
 *  engine (`pine`, `pcf`, `parse`, `interpret`, `budget`, `sentence`) in BOTH
 *  directions, because a gate that checks a refusal by its words can otherwise
 *  keep passing with the safety it was watching deleted. */
export const REFUSALS = Object.freeze({
  'thinkscript:empty':
    'there is no thinkScript here to translate',
  'thinkscript:unsupported':
    'this part of thinkScript is not read by the translator yet',
  'thinkscript:character':
    'thinkorswim has no character like this one',
  'thinkscript:syntax':
    'this thinkScript line does not end where a statement has to end',
  'thinkscript:statement':
    'this thinkScript line is not a shape the translator reads',
  'thinkscript:builtin':
    'this thinkorswim name has no home in this engine grammar',
  'thinkscript:function':
    'this engine declares no function for that thinkorswim call',
  'thinkscript:arity':
    'that thinkorswim call was handed a different number of arguments than it takes',
  'thinkscript:window':
    'a length here has to be a written whole number before a screen can budget it',
  'thinkscript:named-argument':
    'that argument name is not one the called thinkorswim function declares',
  'thinkscript:undefined':
    'this name is used before anything in the script gives it a value',
  'thinkscript:cycle':
    'these thinkorswim names are defined in terms of each other with no way in',
  'thinkscript:type':
    'this thinkorswim value is not a number a column can hold',
  'thinkscript:offset-literal':
    'a bar index has to reduce to a written whole number',
  'thinkscript:future-offset':
    'a negative bar index reads a bar that has not happened, and a closed-bar engine cannot',
  'thinkscript:state':
    'this value carries forward from bar to bar in a way the bounded accumulator cannot hold',
  'thinkscript:block':
    'this thinkorswim block spans several statements and this engine stores a single expression',
  'thinkscript:aggregation':
    'a second aggregation period reads bars of another size than the ones being screened',
  'thinkscript:symbol':
    'another ticker inside one column is outside what a single screened value reads',
  'thinkscript:strategy':
    'placing an order is a backtest instruction and answers with no value to filter on',
  'thinkscript:account':
    'this reads your own position, which is a fact about your account and not about the stock',
  'thinkscript:time':
    'a session clock reading is outside the bar fields this engine keeps',
  'thinkscript:study-ref':
    'this names another thinkorswim study whose formula thinkorswim does not publish',
  'thinkscript:fold':
    'a fold loop repeats an expression, and this engine stores one expression rather than a program',
  'thinkscript:no-output':
    'nothing in this script offers a value a screen could read',
  'thinkscript:roundtrip':
    'the translated text did not read back as the same tree, so nothing is offered',
  'thinkscript:input-kind':
    'this input has no default this translator can freeze it at',
})

/** ⛔ THE ONE PLACE A GUARD ENTERS THIS DOOR. Reads `REFUSALS` rather than
 *  trusting its caller, so a guard invented in another module — where no sweep
 *  over this file can reach — dies where the mistake was made instead of
 *  reaching a member as a refusal with no sentence at all. */
function assertDeclared(guard) {
  if (!Object.prototype.hasOwnProperty.call(REFUSALS, guard)) {
    throw new Error(
      `thinkscript.js: ${guard} is not a guard REFUSALS declares — the refusal set is closed`)
  }
}

/** A thinkScript construct this translator will not translate. Carries the guard
 *  AND the exact token, because "somewhere in your script" is not a refusal a
 *  member can act on.
 *
 *  ⛔ ITS OWN CLASS, like `PineRefusal`'s and `PcfRefusal`'s and for the same
 *  reason: one shared class lets one guard's deletion be covered by another
 *  guard's test. */
export class ThinkScriptRefusal extends Error {
  constructor(guard, message, at) {
    super(message)
    assertDeclared(guard)
    this.name = 'ThinkScriptRefusal'
    this.guard = guard
    this.at = at || null
  }
}

/** ⭐ THE WARM-UP THIS TRANSLATOR GIVES A CARRIED VALUE — 250 bars, one trading
 *  year. thinkScript accumulates from the first bar the chart ever loaded;
 *  `accum` is bounded ON PURPOSE (`closedTable.json::_functions_recurrence`).
 *  ⚠️ IT IS THE SAME NUMBER `pine.js::PINE_STATE_WARMUP` picked, DECLARED AGAIN
 *  rather than imported, because that constant is not exported and `pine.js` is
 *  another lane's file. Two translators may legitimately differ here; if they
 *  ever must not, exporting it from `pine.js` is a one-line W3b hand-back. */
export const TS_STATE_WARMUP = 250

// --------------------------------------------------------------------------- //
// refusal values — the same five helpers `pine.js` declares, same shape
// --------------------------------------------------------------------------- //

/** `{guard, message, line, column, index, token, excerpt}` — identical to
 *  `pine.js::refusalValue`'s shape, because `ImportBox` and the corpus fixture
 *  both read these keys by name and one door's refusal must render like every
 *  other door's.
 *
 *  ⚠️ THE `assertDeclared` BELOW IS UNREACHABLE TODAY AND IS KEPT ON PURPOSE —
 *  W3.2's mutation sweep deleted it and every rail stayed green, which is
 *  recorded rather than papered over. It cannot fire yet because every caller
 *  passes a LITERAL guard (closed by the source sweep in `thinkscript.test.js`)
 *  or one off a `ThinkScriptRefusal`, whose constructor already checked it. It
 *  becomes live the first time a task builds a guard name from a construct kind
 *  — the shape W3.3 has — and deleting cheap defence at a chokepoint because
 *  today's two callers happen to be safe is how the chokepoint stops being one. */
function refusalValue(guard, message, at) {
  assertDeclared(guard)
  return {
    guard,
    message,
    line: at ? at.line : null,
    column: at ? at.column : null,
    index: at ? at.index : null,
    token: at ? at.token : null,
    excerpt: null,
  }
}

function fromError(err) {
  if (err instanceof ThinkScriptRefusal) return refusalValue(err.guard, err.message, err.at)
  return refusalValue('thinkscript:statement',
    `${REFUSALS['thinkscript:statement']} (${err && err.message ? err.message : err})`, null)
}

/** The source line and a caret under the offending token. A refusal that names a
 *  line number and shows nothing is a refusal a member has to go looking for. */
function withExcerpt(refusal, lines) {
  if (!refusal || refusal.line == null) return refusal
  const text = lines[refusal.line - 1]
  if (typeof text !== 'string') return refusal
  const caret = `${' '.repeat(Math.max(0, (refusal.column || 1) - 1))}^`
  return { ...refusal, excerpt: `${text}\n${caret}` }
}

function withExcerpts(list, lines) {
  return list.map((r) => withExcerpt(r, lines))
}

function byPosition(a, b) {
  const al = a.line == null ? Infinity : a.line
  const bl = b.line == null ? Infinity : b.line
  if (al !== bl) return al - bl
  return (a.column || 0) - (b.column || 0)
}

// --------------------------------------------------------------------------- //
// where a refusal points when the translator has read nothing
// --------------------------------------------------------------------------- //

/** The first place in the source that carries text, as a position a caret can
 *  sit under.
 *
 *  ⛔ NOT `{line: 1, column: 1, token: source.slice(0, 12)}`. A token taken from
 *  a TRIMMED first line is not at the column the refusal claims the moment that
 *  line is indented, so the caret and the token disagree and neither can be
 *  checked — and "it refused" is satisfiable by a translator that points at
 *  nothing. The token here is read AT the column, so the corpus gate's
 *  `line.slice(column - 1, …) === token` is a real assertion.
 *
 *  ⚠️ IT SKIPS BLANK LINES AND NOTHING ELSE. Skipping comments would need a
 *  lexer, which is the next task's, and a translator that claims to have skipped
 *  a comment has claimed to read the language. A `#` banner therefore reports
 *  its `#` — the honest answer for a reader that starts here and stops. */
function firstToken(lines) {
  for (let i = 0; i < lines.length; i += 1) {
    const text = lines[i]
    const at = text.search(/\S/)
    if (at < 0) continue
    const word = /^[A-Za-z_][A-Za-z0-9_]*/.exec(text.slice(at))
    return {
      line: i + 1,
      column: at + 1,
      index: at,
      token: word ? word[0] : text[at],
    }
  }
  return null
}

// --------------------------------------------------------------------------- //
// the door
// --------------------------------------------------------------------------- //

/**
 * Translate a pasted thinkorswim study into this engine's column formulas.
 *
 * ⏳ TODAY IT TRANSLATES NOTHING and refuses `thinkscript:unsupported` at the
 * first token of the source. The shape below is complete from day one so that
 * `ImportBox`, the intake bench and the corpus fixture are all written against
 * the finished contract rather than against a stub's.
 *
 * ⛔ IT NEVER THROWS. Four callers treat it as total — the corpus gate runs it
 * over 24 real published studies, and a member's paste is arbitrary text.
 *
 * @param {string} source the pasted thinkScript
 * @param {object} [opts] reserved; `opts.table` becomes the closed-table
 *   injection point for the task that first emits a tree.
 * @returns {{
 *   ok: boolean,
 *   version: 'thinkscript',
 *   declaration: string|null,
 *   title: string|null,
 *   outputs: Array<object>,
 *   selected: number,
 *   refusal: object|null,
 *   refusals: Array<object>,
 *   ignored: Array<object>,
 *   folded: Array<object>,
 * }}
 */
export function translateThinkScript(source, opts = {}) {
  void opts
  const blank = {
    ok: false, version: 'thinkscript', declaration: null, title: null,
    outputs: [], selected: -1, refusal: null, refusals: [], ignored: [], folded: [],
  }

  if (typeof source !== 'string' || source.trim() === '') {
    const r = refusalValue('thinkscript:empty', REFUSALS['thinkscript:empty'], null)
    return { ...blank, refusal: r, refusals: [r] }
  }

  const lines = source.replace(/\r\n?/g, '\n').split('\n')

  let refusals
  try {
    refusals = [refusalValue('thinkscript:unsupported',
      REFUSALS['thinkscript:unsupported'], firstToken(lines))].sort(byPosition)
  } catch (err) {
    const r = withExcerpt(fromError(err), lines)
    return { ...blank, refusal: r, refusals: [r] }
  }

  return {
    ...blank,
    refusal: withExcerpt(refusals[0] || null, lines),
    refusals: withExcerpts(refusals, lines),
  }
}
