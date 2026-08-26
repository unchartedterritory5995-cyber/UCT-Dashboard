// ─── THE thinkScript READER — A THIRD SURFACE LANGUAGE, ONE CANONICAL TREE ───
//
// A member who has spent five years in thinkorswim types
// `def x = Average(close, 50); plot scan = close > x;`. This file is how that
// reaches the same engine `sma(close, 50)` reaches: it produces the SAME
// canonical tree `parse.js` produces, so the chart, the scan and the alert all
// get the object they already share, and the budget, the repaint linter and the
// read-back all decide about it unchanged.
//
// ⭐ IT IS `pine.js`'s SHAPE, NOT ITS COPY. This module IMPORTS `printFormula`
// and `treeYieldsBool` from `pine.js` — one printer, one round-trip, one
// `yields` reader — and `closedTable.json` stays the only list of what a formula
// may call. Every engine name this module emits is LOOKED UP in the table at
// translation time (`TABLE.series` today, `TABLE.functions` from W3.4); a token
// whose engine name the table does not declare refuses BY NAME rather than
// resolving to something this file believes.
//
// ✅ THOSE IMPORTS LANDED WITH THIS TASK, WHICH IS THE ONE THAT FIRST HAS A TREE
// TO PRINT. W3.2 deliberately shipped without them ("built, tested, green and
// unreachable" is the shape this repo keeps paying for); the wiring arrives now
// that there is a formula to print and a round trip to verify.
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
// ⏳ WHAT IT READS TODAY (W3.3): the LEXER and the STATEMENT READER. `declare`,
// `input`, `def`/`rec`, a forward declaration and its later assignment, `plot`
// (quoted names included) and a bare condition all read, over an expression
// grammar of numbers, the five bar fields, the arithmetic and comparison
// operators, `and`/`or`/`not`, `if … then … else`, `[n]` and the `Double.*`
// constants. ⛔ NOT ONE FUNCTION IS MAPPED YET — every call refuses
// `thinkscript:function` AT ITS NAME, and so does every reserved phrase that
// needs one (`crosses above`, `within N bars`, `%`). That map is W3.4's, and
// until it exists a call must refuse rather than resolve to a neighbour.
// `thinkscript.corpus.test.js` pins where all 24 real published studies in
// `tests/fixtures/thinkscript/` now land, so every later task's gain stays a
// fact rather than a claim.
//
// SOURCES for the language (read 2026-08-25, toslc.thinkorswim.com; the pages
// are Schwab's and are quoted, never copied):
//   * Reserved words — /center/reference/thinkScript/Reserved-Words/{within,between,rec,crosses,reference}
//   * Functions — /center/reference/thinkScript/Functions/{Tech-Analysis,Others,Statistical,Math---Trig}/…
//   * Studies — /center/reference/Tech-Indicators/studies-library/…
//   * Tutorials — /center/reference/thinkScript/tutorials/{Basic,Advanced}/…

import { TABLE, parseFormula, astHash } from './parse.js'
import { printFormula, treeYieldsBool } from './pine.js'

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
  'thinkscript:enum-arm':
    'this is not one of the choices the thinkorswim input declares',
  'thinkscript:offset-chained':
    'a second bar offset on one value names a bar that a single offset already names',
})

/** ⭐ A NOTE IS NOT A REFUSAL, AND IT GETS ITS OWN CLOSED TABLE. What `ignored[]`
 *  carries is the opposite of a refusal: a line this translator DID read and
 *  deliberately left out of the column, recorded so the member can see it was
 *  seen. Putting these codes in `REFUSALS` would have made "how much of this
 *  door can say no" — the number `thinkscript.test.js` measures — quietly
 *  include two things that never say no.
 *
 *  ⛔ SO THE `note-` PREFIX IS LOAD-BEARING, not decoration: it is what lets the
 *  source sweep tell a note code from a guard without a second hand-typed list.
 *  Their sentences join the disjointness sweep for the same reason every guard's
 *  does — a gate that matches on words must not be satisfiable by another
 *  table's words.
 *
 *  ⚠️⚠️ AND `assertNote` BELOW IS A RUNTIME GUARD, **NOT A RAIL** — MEASURED, not
 *  assumed. W3.3's mutation sweep deleted it and all 97 tests stayed GREEN, for
 *  exactly the reason the identical disclosure above `refusalValue` gives: every
 *  caller passes a LITERAL code that the source sweep already closes. It is kept
 *  anyway, and the two tables' guards are kept SEPARATE, because one shared
 *  check would let a note code stand in for a missing guard — and that is the
 *  mistake no test could see either. Re-measured on the same sweep:
 *  `refusalValue`'s `assertDeclared` STILL survives deletion, now against W3.3's
 *  much larger call surface, so that disclosure is current rather than inherited. */
export const NOTES = Object.freeze({
  'thinkscript:note-declare':
    'a chart placement is a drawing instruction, and a screened column has no chart to be placed on',
  'thinkscript:note-endash':
    'a dash pasted out of a web page was read as the minus sign it was written to be',
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

/** The same door for a note code, and separate for the same reason the tables
 *  are: one shared check would let a note code stand in for a missing guard. */
function assertNote(code) {
  if (!Object.prototype.hasOwnProperty.call(NOTES, code)) {
    throw new Error(
      `thinkscript.js: ${code} is not a code NOTES declares — the note set is closed`)
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
 *  ⚠️⚠️ THE `assertDeclared` BELOW IS A RUNTIME GUARD, **NOT A RAIL**, AND NO
 *  TEST WILL EVER CATCH ITS DELETION. Measured twice and recorded rather than
 *  papered over:
 *    1. W3.2's mutation sweep deleted it — every rail stayed GREEN. It cannot
 *       fire today because every caller passes a LITERAL guard (closed by the
 *       source sweep in `thinkscript.test.js`) or one off a
 *       `ThinkScriptRefusal`, whose constructor already checked it.
 *    2. W3.2's REVIEW then planted W3.3's actual shape — a branch emitting
 *       `` `thinkscript:${kind}` `` — and BOTH variants stayed GREEN too. So it
 *       is not even prospectively railed: the source sweep's
 *       `/'(thinkscript:[a-z-]+)'/g` is structurally blind to a template
 *       literal, which is exactly how a computed guard will be written.
 *
 *  ⛔ IT IS KEPT ANYWAY, and the next engineer should know why: it is the only
 *  thing that will catch a computed guard name that `REFUSALS` does not declare,
 *  precisely because no test can. Deleting cheap defence at a chokepoint because
 *  today's two callers happen to be safe is how the chokepoint stops being one.
 *
 *  ✅ W3.3 ANSWERED THE ⏳ THAT SAT HERE, AND ANSWERED IT THE OTHER WAY. The note
 *  said "widen the source sweep to match `` `thinkscript:${…}` `` too, or it
 *  ships blind", and widening it to MATCH one would still not check it: a regex
 *  can read the prefix and can never read `kind`. So the sweep in
 *  `thinkscript.test.js` was widened to DETECT a computed guard and pin the set
 *  of them — measured EMPTY, because this task deliberately writes every guard
 *  as a literal. That turns "structurally blind" into "acknowledged and zero",
 *  and the day somebody writes the first computed guard the sweep reds and says
 *  in its own message that `assertDeclared` below is then the only check there
 *  is. The blindness was real; what was wrong was believing a wider regex could
 *  cure it. */
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

/** A thrown error as a refusal value, mirroring `pine.js::fromError`.
 *
 *  ✅ THE FIRST BRANCH IS LIVE AS OF W3.3 — the lexer, the statement splitter and
 *  the resolver all throw `ThinkScriptRefusal`, which is the whole mechanism by
 *  which a construct refuses at its token. W3.2 shipped it unreachable and said
 *  so; this is that disclosure closing.
 *
 *  ⚠️ THE SECOND BRANCH DELIBERATELY SWALLOWS A NON-REFUSAL INTO A MEMBER-FACING
 *  GUARD, the same trade `pine.js` makes: the promise that this door never
 *  throws outranks a clean stack, and the underlying message is appended so the
 *  bug is still legible in what the member is shown. */
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

/** A note value — the shape `ignored[]` carries. Same positional keys a refusal
 *  carries, because `ImportBox` renders both in one list. */
function noteValue(code, line, column, detail) {
  assertNote(code)
  return { code, message: detail ? `${NOTES[code]} (${detail})` : NOTES[code], line, column }
}

// --------------------------------------------------------------------------- //
// TWO FOLDS, AND THEY ARE NOT THE SAME FOLD
// --------------------------------------------------------------------------- //

/** The SCRIPT's own symbol table. thinkorswim matches a member's identifiers and
 *  its own keywords case-insensitively and does NOTHING ELSE to them — that is
 *  measured, not assumed: `13-scan-52-week-high` is published as
 *  `Def High52 = Highest(High,52);` and runs, `21` writes `ArrowUP` for a plot it
 *  declared `ArrowUp`, and `06` writes `compoundValue` and `addlabel`. */
const key = (name) => String(name).toLowerCase()

/** The ENGINE table's fold, which ALSO strips `_` — the same one
 *  `pine.js::functionIndex` applies, so `williams_r` and `williamsR` are one
 *  entry on both sides of the engine.
 *
 *  ⛔ IT IS A SECOND FUNCTION ON PURPOSE AND MUST STAY ONE. Sharing `key` above
 *  would make `bull_cross` and `bullcross` the same MEMBER name, and
 *  `02-macd-lookback-cross-watchlist` binds `bull_cross` — a member who typo'd it
 *  would silently be handed someone else's series instead of a refusal. One fold
 *  serves the member's names; the other serves the engine's table. */
const normaliseName = (name) => String(name).toLowerCase().replace(/_/g, '')

const has = (obj, k) => Object.prototype.hasOwnProperty.call(obj, k)

/** The source, as the member pasted it, split into lines.
 *
 *  ⛔ ONE FUNCTION, CALLED FROM BOTH PLACES THAT NEED IT — the lexer and the
 *  door's excerpt fallback for a source the lexer REFUSED. Two copies of
 *  `.replace(/\r\n?/g, '\n').split('\n')` would be a second authority over where
 *  line 3 starts, and the caret is drawn from one of them while the position is
 *  measured against the other. */
const sourceLines = (src) => String(src == null ? '' : src).replace(/\r\n?/g, '\n').split('\n')

/** A token as a refusal position. ⭐ `token` is the token's SOURCE TEXT, never
 *  its parsed value, so the corpus gate's `line.slice(column - 1, …) === token`
 *  stays a real assertion — for a quoted plot name that is `"DI+"`, not `DI+`. */
const locate = (tok) => (tok
  ? { line: tok.line, column: tok.column, index: tok.index, token: tok.text }
  : null)

const refuse = (guard, tok) => new ThinkScriptRefusal(guard, REFUSALS[guard], locate(tok))

// --------------------------------------------------------------------------- //
// the lexer
// --------------------------------------------------------------------------- //

const DIGIT = /[0-9]/
const IDENT_START = /[A-Za-z_]/
const IDENT_PART = /[A-Za-z0-9_]/

/** ⚠️ LONGEST FIRST. `<>` before `<`, `>=` before `>`: a shorter match taken
 *  first turns `a <> b` into `a < (> b)` and reports the syntax error one token
 *  past the real one.
 *
 *  ⭐ IT IS `lexPine`'s LIST WITH THREE CHANGES, each measured off the corpus:
 *  `<>` joins (thinkScript's other spelling of `!=`, in `10-rsi-laguerre`);
 *  Pine's `=>` and `:=` leave (thinkScript has neither); and `;` `{` `}` `.`
 *  join, because a statement here is `;`-terminated, an enum default is a brace
 *  group, and `BollingerBands(length = X).LowerBand` takes a member off a call
 *  result — a dot the identifier lexer cannot swallow because what follows it is
 *  not an identifier start. */
const PUNCT = [
  '==', '!=', '<>', '>=', '<=',
  '?', ':', ',', ';', '.', '(', ')', '[', ']', '{', '}',
  '>', '<', '+', '-', '*', '/', '%', '=', '!',
]

/** Every dash a web page can render where thinkScript wanted `-`: U+2010 HYPHEN
 *  through U+2015 HORIZONTAL BAR, plus U+2212 MINUS SIGN. `10-rsi-laguerre`
 *  carries EN DASHes inside its arithmetic because that is what the forum it was
 *  published on served, and it runs on thinkorswim after a paste through the
 *  platform's own editor. Refusing the script would be refusing published code
 *  for an artefact of the page it was published on — so it is repaired, and the
 *  repair is RECORDED per line in `ignored[]` rather than done silently. */
const DASH_LOOKALIKES = /[‐-―−]/g

/**
 * Read a pasted thinkScript source into tokens.
 *
 * ⛔ IT NEVER SKIPS A CHARACTER IT CANNOT NAME. An unknown character refuses
 * `thinkscript:character` AT ITS OWN COLUMN, because a lexer that quietly drops
 * what it does not recognise produces a tree for a script the member did not
 * write.
 *
 * @param {string} src
 * @returns {{tokens: Array<object>, lines: string[], notes: Array<object>, text: string}}
 *   `lines` is the source AS PASTED — the dash repair below is 1:1 by
 *   construction, so every column measured against `text` is the same column in
 *   `lines`, and the excerpt a member reads is their own text rather than ours.
 */
export function lexThinkScript(src) {
  const lines = sourceLines(src)
  const notes = []
  const text = lines.map((line, i) => {
    const fixed = line.replace(DASH_LOOKALIKES, '-')
    if (fixed === line) return line
    notes.push(noteValue('thinkscript:note-endash', i + 1, line.search(DASH_LOOKALIKES) + 1))
    return fixed
  }).join('\n')

  const tokens = []
  let i = 0
  let line = 1
  let lineStart = 0
  const at = (index, ln, col, raw) => ({ line: ln, column: col, index, token: raw })

  while (i < text.length) {
    const ch = text[i]
    if (ch === '\n') { i += 1; line += 1; lineStart = i; continue }
    if (ch === ' ' || ch === '\t') { i += 1; continue }
    const col = i - lineStart + 1

    // ⭐ `#` TO END OF LINE IS THE ONLY COMMENT, AND `#hint` IS ONE OF THEM.
    // thinkScript has no `//`; the reference documents `#hint <name>: <text>` as
    // a comment the platform reads for its input dialog, which is chrome for a
    // screened column. `10-rsi-laguerre` writes one on the same line as an input.
    if (ch === '#') {
      let end = text.indexOf('\n', i)
      if (end === -1) end = text.length
      i = end
      continue
    }

    if (ch === '"') {
      let j = i + 1
      let out = ''
      while (j < text.length && text[j] !== '"' && text[j] !== '\n') { out += text[j]; j += 1 }
      if (text[j] !== '"') {
        throw new ThinkScriptRefusal('thinkscript:character', REFUSALS['thinkscript:character'],
          at(i, line, col, ch))
      }
      tokens.push({ kind: 'string', value: out, text: text.slice(i, j + 1), line, column: col, index: i })
      i = j + 1
      continue
    }

    if (DIGIT.test(ch) || (ch === '.' && DIGIT.test(text[i + 1] || ''))) {
      let j = i
      while (j < text.length && DIGIT.test(text[j])) j += 1
      if (text[j] === '.') { j += 1; while (j < text.length && DIGIT.test(text[j])) j += 1 }
      if (text[j] === 'e' || text[j] === 'E') {
        let k = j + 1
        if (text[k] === '+' || text[k] === '-') k += 1
        if (DIGIT.test(text[k] || '')) { k += 1; while (k < text.length && DIGIT.test(text[k])) k += 1; j = k }
      }
      const raw = text.slice(i, j)
      tokens.push({ kind: 'number', value: Number(raw), text: raw, line, column: col, index: i })
      i = j
      continue
    }

    // An identifier is DOTTED exactly as Pine's is, so `Double.NaN`, `Color.RED`,
    // `mode.UseA` and `TTM_Squeeze` are each ONE token — which is what lets a
    // refusal name `Double.POSITIVE_INFINITY` rather than `Double`.
    if (IDENT_START.test(ch)) {
      let j = i
      while (j < text.length && IDENT_PART.test(text[j])) j += 1
      while (text[j] === '.' && IDENT_START.test(text[j + 1] || '')) {
        j += 1
        while (j < text.length && IDENT_PART.test(text[j])) j += 1
      }
      const word = text.slice(i, j)
      tokens.push({ kind: 'ident', value: word, text: word, line, column: col, index: i })
      i = j
      continue
    }

    const punct = PUNCT.find((p) => text.startsWith(p, i))
    if (punct) {
      tokens.push({ kind: 'punct', value: punct, text: punct, line, column: col, index: i })
      i += punct.length
      continue
    }

    throw new ThinkScriptRefusal('thinkscript:character', REFUSALS['thinkscript:character'],
      at(i, line, col, ch))
  }

  return { tokens, lines, notes, text }
}

// --------------------------------------------------------------------------- //
// the statement splitter
// --------------------------------------------------------------------------- //

const isPunctTok = (t, v) => !!t && t.kind === 'punct' && t.value === v
const isWordTok = (t, w) => !!t && t.kind === 'ident' && key(t.value) === w

/**
 * Split a token stream into statement runs.
 *
 * ⭐ TWO TERMINATORS, AND THEY PULL IN OPPOSITE DIRECTIONS. `;` at depth zero
 * ends a statement — but `input mode = {default A, B};` closes a brace and then
 * still wants its `;`, while `if … { … } else { … }` closes a brace and is OVER.
 * Splitting on `;` alone swallows the statement after every block; splitting at
 * every closing brace splits an enum default in half. So a `}` that returns to
 * depth zero ends the run UNLESS the next token is its `;` or the `else` that
 * continues it.
 *
 * ⛔⛔ AND A TRAILING RUN WITH NEITHER IS STILL A STATEMENT — the lane brief said
 * it "throws `thinkscript:syntax` at the last token", and that is WRONG against
 * this lane's own corpus. `16-scan-rsi-crosses-30-70.ts` is published as
 * `RSI() crosses above 30 or RSI() crosses below 70` with no `plot`, no `def`
 * and NO `;` ANYWHERE — a thinkorswim scan condition, which is the single
 * commonest shape a member pastes into a screener. Refusing it here would refuse
 * real published code for punctuation the platform does not require. An
 * unfinished statement still refuses `thinkscript:syntax` at the token it ran out
 * on — `plot p = close >` does — but it refuses because the EXPRESSION READER
 * ran out of tokens, which is where that fact actually lives.
 *
 * @param {Array<object>} tokens
 * @returns {Array<{tokens: Array<object>}>}
 */
export function readStatements(tokens) {
  const runs = []
  let cur = []
  let paren = 0
  let brace = 0
  for (let i = 0; i < tokens.length; i += 1) {
    const t = tokens[i]
    if (t.kind === 'punct') {
      if (t.value === '(' || t.value === '[') paren += 1
      else if (t.value === ')' || t.value === ']') paren = Math.max(0, paren - 1)
      else if (t.value === '{') brace += 1
      else if (t.value === '}') brace = Math.max(0, brace - 1)
      else if (t.value === ';' && paren === 0 && brace === 0) {
        if (cur.length) runs.push({ tokens: cur })
        cur = []
        continue
      }
    }
    cur.push(t)
    if (isPunctTok(t, '}') && brace === 0 && paren === 0) {
      const nxt = tokens[i + 1]
      const continues = isPunctTok(nxt, ';') || isWordTok(nxt, 'else')
      if (!continues) { runs.push({ tokens: cur }); cur = [] }
    }
  }
  if (cur.length) runs.push({ tokens: cur })
  return runs
}

// --------------------------------------------------------------------------- //
// the expression reader
// --------------------------------------------------------------------------- //

/** Words that can never begin a value. Reaching one where an atom is due means
 *  the statement's shape is not what the reader thought, and saying so AT that
 *  word is more useful than resolving whatever came before it.
 *
 *  ⛔⛔ `bar` AND `bars` ARE NOT IN HERE, AND THE CORPUS IS WHY. thinkorswim's
 *  own reserved-word page lists both, and `14-scan-inside-bar` writes
 *  `inside within 1 bars` — but `23-previous-day-high-low-mean` opens with
 *  `def bar = barNumber();` and then reads `then bar` seventeen times, published
 *  and running. Reserving them refused a real script at `bar` with
 *  `thinkscript:syntax`, which is both the wrong reason and the wrong place.
 *  `within` consumes its trailing `bar`/`bars` POSITIONALLY, which is all the
 *  phrase ever needed. ⭐ The corpus is the measurement, not the reference page. */
const NOT_AN_ATOM = Object.freeze(new Set([
  'then', 'else', 'and', 'or', 'not', 'if', 'def', 'plot', 'input', 'declare', 'rec',
  'within', 'crosses', 'above', 'below', 'is', 'than', 'greater', 'less',
  'case', 'switch', 'do', 'to', 'with', 'while', 'default',
]))

const CMP = Object.freeze({ '==': '==', '!=': '!=', '<>': '!=', '>': '>', '<': '<', '>=': '>=', '<=': '<=' })

const cursorOf = (toks) => ({ toks, i: 0 })
const peek = (c, k = 0) => c.toks[c.i + k] || null
const take = (c) => c.toks[c.i++]

const syntaxAt = (c, tok) => refuse('thinkscript:syntax', tok || c.toks[c.toks.length - 1] || null)

function parseExpression(c) {
  if (isWordTok(peek(c), 'if')) {
    const tok = take(c)
    const cond = parseExpression(c)
    if (!isWordTok(peek(c), 'then')) throw syntaxAt(c, peek(c))
    take(c)
    const a = parseExpression(c)
    if (!isWordTok(peek(c), 'else')) throw syntaxAt(c, peek(c))
    take(c)
    return { e: 'if', cond, then: a, otherwise: parseExpression(c), tok }
  }
  return parseOr(c)
}

function parseOr(c) {
  let left = parseAnd(c)
  while (isWordTok(peek(c), 'or')) {
    const tok = take(c)
    left = { e: 'binary', op: '||', left, right: parseAnd(c), tok }
  }
  return left
}

function parseAnd(c) {
  let left = parseWithin(c)
  while (isWordTok(peek(c), 'and')) {
    const tok = take(c)
    left = { e: 'binary', op: '&&', left, right: parseWithin(c), tok }
  }
  return left
}

/** `<cond> within N bars` — the reference calls it *"true at least one time for
 *  the given number of bars starting from the current one"*, which is
 *  `highest(<cond>, N) > 0`. ⏳ THAT IDENTITY IS W3.5's TO EMIT; this task reads
 *  the shape and refuses at the word, because a phrase that needs an engine
 *  function and has none mapped is the same fact as a call that has none. */
function parseWithin(c) {
  let left = parseComparison(c)
  while (isWordTok(peek(c), 'within')) {
    const tok = take(c)
    const count = parseComparison(c)
    if (isWordTok(peek(c), 'bars') || isWordTok(peek(c), 'bar')) take(c)
    left = { e: 'call', name: 'within', base: null, args: [{ name: null, value: left }, { name: null, value: count }], tok }
  }
  return left
}

function parseComparison(c) {
  let left = parseAdditive(c)
  for (;;) {
    const t = peek(c)
    if (t && t.kind === 'punct' && has(CMP, t.value)) {
      const tok = take(c)
      left = { e: 'binary', op: CMP[tok.value], left, right: parseAdditive(c), tok }
      continue
    }
    if (isWordTok(t, 'crosses')) {
      const tok = take(c)
      let name = 'crosses'
      if (isWordTok(peek(c), 'above') || isWordTok(peek(c), 'below')) name = `crosses ${key(take(c).value)}`
      left = { e: 'call', name, base: null, args: [{ name: null, value: left }, { name: null, value: parseAdditive(c) }], tok }
      continue
    }
    // ⭐ `x between a and b` — the reference's own words are *"within the range
    // of value1 and value2 (inclusive)"*, i.e. `(x >= a) && (x <= b)`. ⏳ That
    // identity is W3.5's to emit; read here so the construct refuses BY NAME
    // rather than as a syntax error at a word thinkorswim documents. ⚠️ The CALL
    // form `between(a, b, c)` is untouched — `23-previous-day-high-low-mean`
    // uses it six times — which is why `between` is not in `NOT_AN_ATOM`.
    if (isWordTok(t, 'between')) {
      const tok = take(c)
      const lo = parseAdditive(c)
      if (!isWordTok(peek(c), 'and')) throw syntaxAt(c, peek(c))
      take(c)
      left = {
        e: 'call',
        name: 'between',
        base: null,
        args: [{ name: null, value: left }, { name: null, value: lo }, { name: null, value: parseAdditive(c) }],
        tok,
      }
      continue
    }
    if (isWordTok(t, 'is') && isWordTok(peek(c, 2), 'than')
      && (isWordTok(peek(c, 1), 'greater') || isWordTok(peek(c, 1), 'less'))) {
      const tok = take(c)
      const which = key(take(c).value)
      take(c)
      left = { e: 'call', name: `is ${which} than`, base: null, args: [{ name: null, value: left }, { name: null, value: parseAdditive(c) }], tok }
      continue
    }
    return left
  }
}

function parseAdditive(c) {
  let left = parseMultiplicative(c)
  for (;;) {
    const t = peek(c)
    if (t && t.kind === 'punct' && (t.value === '+' || t.value === '-')) {
      const tok = take(c)
      left = { e: 'binary', op: tok.value, left, right: parseMultiplicative(c), tok }
      continue
    }
    return left
  }
}

function parseMultiplicative(c) {
  let left = parseUnary(c)
  for (;;) {
    const t = peek(c)
    if (t && t.kind === 'punct' && (t.value === '*' || t.value === '/' || t.value === '%')) {
      const tok = take(c)
      left = { e: 'binary', op: tok.value, left, right: parseUnary(c), tok }
      continue
    }
    return left
  }
}

function parseUnary(c) {
  const t = peek(c)
  if (t && t.kind === 'punct' && (t.value === '-' || t.value === '!')) {
    const tok = take(c)
    return { e: 'unary', op: tok.value, arg: parseUnary(c), tok }
  }
  if (isWordTok(t, 'not')) {
    const tok = take(c)
    return { e: 'unary', op: '!', arg: parseUnary(c), tok }
  }
  return parsePostfix(c)
}

function parsePostfix(c) {
  let node = parseAtom(c)
  for (;;) {
    const t = peek(c)
    if (isPunctTok(t, '[')) {
      // ⭐ THE `[` IS KEPT. `tok` stays the value's own token so a refusal inside
      // the value points at the value; `bracket` is where the OFFSET itself
      // lives, and it is the only honest caret for "this offset is the problem".
      const bracket = take(c)
      const index = parseExpression(c)
      if (!isPunctTok(peek(c), ']')) throw syntaxAt(c, peek(c))
      take(c)
      node = { e: 'offset', base: node, index, tok: node.tok, bracket }
      continue
    }
    if (isPunctTok(t, '.')) {
      const dot = take(c)
      const nameTok = peek(c)
      if (!nameTok || (nameTok.kind !== 'ident' && nameTok.kind !== 'string')) throw syntaxAt(c, nameTok || dot)
      take(c)
      node = isPunctTok(peek(c), '(')
        ? { e: 'call', name: nameTok.value, base: node, args: parseArguments(c), tok: node.tok || dot }
        : { e: 'member', base: node, name: nameTok.value, tok: node.tok || dot }
      continue
    }
    return node
  }
}

function parseArguments(c) {
  if (!isPunctTok(peek(c), '(')) throw syntaxAt(c, peek(c))
  take(c)
  const args = []
  if (isPunctTok(peek(c), ')')) { take(c); return args }
  for (;;) {
    let name = null
    const a = peek(c)
    if (a && (a.kind === 'ident' || a.kind === 'string') && isPunctTok(peek(c, 1), '=')) {
      name = a.value
      take(c)
      take(c)
    }
    args.push({ name, value: parseExpression(c) })
    if (isPunctTok(peek(c), ',')) { take(c); continue }
    break
  }
  if (!isPunctTok(peek(c), ')')) throw syntaxAt(c, peek(c))
  take(c)
  return args
}

function parseAtom(c) {
  const t = peek(c)
  if (!t) throw syntaxAt(c, null)
  if (t.kind === 'number') { take(c); return { e: 'num', value: t.value, tok: t } }
  if (t.kind === 'string') { take(c); return { e: 'text', value: t.value, tok: t } }
  if (isPunctTok(t, '(')) {
    take(c)
    const inner = parseExpression(c)
    if (!isPunctTok(peek(c), ')')) throw syntaxAt(c, peek(c))
    take(c)
    return inner
  }
  if (t.kind === 'ident') {
    const k = key(t.value)
    // ⛔ A `fold` LOOP REFUSES AS A FOLD, NEVER AS A SYNTAX ERROR. It is real,
    // documented thinkScript (`fold i = 0 to 8 with p do …`, and
    // `18-fold-up-down-points-ratio` is published with two of them); telling a
    // member their line "does not end where a statement has to end" would be a
    // false reason at a true position, which is the worse half of a wrong
    // refusal. This engine stores ONE expression rather than a program, so the
    // construct has nowhere to go and says exactly that.
    if (k === 'fold') throw refuse('thinkscript:fold', t)
    // ⛔ `reference <Study>` NAMES ANOTHER STUDY, and thinkorswim publishes no
    // formula for one. Refusing at the word is the whole reason `:study-ref`
    // exists; before this it reported a syntax error at the study's NAME, which
    // is a false reason pointing one token past the real one.
    if (k === 'reference') throw refuse('thinkscript:study-ref', t)
    if (NOT_AN_ATOM.has(k)) throw syntaxAt(c, t)
    take(c)
    if (isPunctTok(peek(c), '(')) {
      return { e: 'call', name: t.value, base: null, args: parseArguments(c), tok: t }
    }
    // `yes` and `no` are thinkScript's two boolean literals, and the reference
    // is explicit that they are 1 and 0.
    if (k === 'yes') return { e: 'num', value: 1, tok: t }
    if (k === 'no') return { e: 'num', value: 0, tok: t }
    return { e: 'name', name: t.value, tok: t }
  }
  throw syntaxAt(c, t)
}

/** Parse a whole run as ONE expression and refuse at whatever is left over.
 *  ⭐ THE LEFTOVER CHECK IS THE HALF THAT CATCHES A MISSING `;`: `def x = close`
 *  followed by `plot p = x > 0;` reads as one statement whose expression stops at
 *  `close`, and the honest place to say so is `plot`, on line 2. */
function parseWhole(toks) {
  const c = cursorOf(toks)
  const expr = parseExpression(c)
  if (peek(c)) throw syntaxAt(c, peek(c))
  return expr
}

// --------------------------------------------------------------------------- //
// the statement reader — what each shape of line MEANS
// --------------------------------------------------------------------------- //

/** thinkorswim price series this engine keeps no field for. ⭐ IT EXISTS SO A
 *  REAL BUILT-IN IS NOT REPORTED AS A TYPO. `01-supertrend-mobius` reads `HL2`;
 *  telling a member "this name is used before anything in the script gives it a
 *  value" would send them hunting for a `def` they never omitted, when the true
 *  answer is that this engine's bar has five fields and `HL2` is not one.
 *  ⚠️ AND THE DISTINCTION IS A BEST EFFORT, SAID OUT LOUD: thinkorswim's
 *  vocabulary is thousands of names and this is the handful the reference lists
 *  as bar-derived prices, so an unlisted built-in still reads as `:undefined`.
 *  Every entry here is one the corpus or the reference's Constants page names. */
const TS_BUILTIN_PRICES = Object.freeze(new Set([
  'hl2', 'hlc3', 'ohlc4', 'vwap', 'open_interest', 'imp_volatility', 'tick', 'bid', 'ask',
]))

const nameOf = (tok) => tok.value

/** The default of an `input NAME = { … };`.
 *
 *  ⭐ THE ARM MARKED `default` WINS, AND WHERE NONE IS MARKED THE FIRST DOES —
 *  which is what the reference says the platform does. `24-position-capital`
 *  writes `default` thirteenth in a list of seventeen, so "take the first" alone
 *  would fold every one of its three colour inputs to the wrong arm.
 *
 *  ⛔⛔ AND IT RETURNS THE ARMS, WHICH IS NOT A CONVENIENCE. Returning only the
 *  chosen arm made an undeclared one UNCHECKABLE — `mode == mode.UseZ` folded to
 *  `false` and `if … then close else open` silently became `open`, with no
 *  refusal anywhere. That is a chart that looks right and is wrong, the one
 *  outcome this translator exists to prevent, and it was structural: nothing
 *  downstream HAD the list to check against. Found in W3.3 review. */
function readEnumDefault(rest, nameTok) {
  let depth = 0
  const arms = []
  let chosen = null
  let markNext = false
  for (const t of rest) {
    if (isPunctTok(t, '{')) { depth += 1; continue }
    if (isPunctTok(t, '}')) { depth -= 1; if (depth <= 0) break; continue }
    if (isPunctTok(t, ',')) continue
    if (t.kind === 'ident' && key(t.value) === 'default') { markNext = true; continue }
    if (t.kind === 'ident' || t.kind === 'string') {
      arms.push(t.value)
      if (markNext) { chosen = t.value; markNext = false }
      continue
    }
    throw refuse('thinkscript:input-kind', nameTok)
  }
  if (!arms.length) throw refuse('thinkscript:input-kind', nameTok)
  return { arms, chosen: chosen === null ? arms[0] : chosen }
}

/** What an input froze at, spelled the way the member wrote it. A single string
 *  token gives its CONTENT (`"SPY"` → `SPY`); everything else is the exact source
 *  slice, so `-2.0` reads as `-2.0` rather than as two tokens joined. */
function defaultText(rest, text) {
  if (rest.length === 1 && rest[0].kind === 'string') return rest[0].value
  const first = rest[0]
  const last = rest[rest.length - 1]
  return text.slice(first.index, last.index + last.text.length).trim()
}

/** Read one statement into the program under construction.
 *
 * ⛔ ONE RULE DECIDES WHAT A BARE EXPRESSION IS, AND IT IS THE RULE THAT KEEPS
 * `AddLabel(…)` FROM BECOMING A COLUMN: a statement that is nothing but a CALL
 * answers with no value to screen on — it draws, alerts, orders or asserts — so
 * it refuses `thinkscript:statement` at the call. Anything else bare IS the
 * output, which is what `16-scan-rsi-crosses-30-70` needs: it has no `plot`, no
 * `def` and no `;` at all. ⏳ W3.6 reclassifies the chrome subset into
 * `ignored[]`; refusing it is this task's honest answer, not its final one. */
function readStatement(toks, ctx) {
  const head = toks[0]
  const k = head.kind === 'ident' ? key(head.value) : null

  const bindNew = (name, binding) => {
    if (ctx.env.has(key(name))) throw refuse('thinkscript:statement', binding.tok)
    ctx.env.set(key(name), binding)
  }

  if (k === 'declare') {
    const word = toks[1]
    if (!word || word.kind !== 'ident') throw refuse('thinkscript:statement', head)
    ctx.declaration = key(word.value)
    ctx.ignored.push(noteValue('thinkscript:note-declare', head.line, head.column,
      `\`${head.text} ${word.text}\``))
    return
  }

  if (k === 'input') {
    const nameTok = toks[1]
    if (!nameTok || (nameTok.kind !== 'ident' && nameTok.kind !== 'string')) throw refuse('thinkscript:statement', head)
    const name = nameOf(nameTok)
    if (toks.length === 2) {
      // Bound anyway, so a USE of it refuses by name too rather than reading as
      // a typo — but the declaration is what carries the first refusal.
      ctx.env.set(key(name), { kind: 'no-default', tok: nameTok })
      throw refuse('thinkscript:input-kind', nameTok)
    }
    if (!isPunctTok(toks[2], '=')) throw refuse('thinkscript:statement', head)
    const rest = toks.slice(3)
    if (!rest.length) throw refuse('thinkscript:input-kind', nameTok)
    if (isPunctTok(rest[0], '{')) {
      const { arms, chosen } = readEnumDefault(rest, nameTok)
      bindNew(name, { kind: 'enum', family: key(name), arm: chosen, arms, tok: nameTok, input: true })
      ctx.folded.push({ name, folded: chosen, line: nameTok.line, column: nameTok.column })
      return
    }
    const expr = parseWhole(rest)
    bindNew(name, { kind: 'input', expr, tok: nameTok })
    ctx.folded.push({ name, folded: defaultText(rest, ctx.text), line: nameTok.line, column: nameTok.column })
    return
  }

  if (k === 'def' || k === 'rec' || k === 'plot') {
    const nameTok = toks[1]
    if (!nameTok || (nameTok.kind !== 'ident' && nameTok.kind !== 'string')) throw refuse('thinkscript:statement', head)
    const name = nameOf(nameTok)
    // ⭐⭐ A `plot` NEVER OVERWRITES A NAME A `def` ALREADY BOUND — it keeps its
    // expression inline instead, and the earlier binding stays the one every
    // reader sees. `11-money-flow-index-mobile` is published as
    // `def mfi = …; plot MFI = mfi;`, and identifiers here fold case-insensitively
    // (measured: `02` reads `Value` back as `value`, `21` reads `ArrowUp` back as
    // `ArrowUP`, `22` reads `open` back as `OPEN`), so those two are ONE key.
    // Rebinding would make the plot read itself — a cycle refusal on a published
    // script; refusing the statement would be a wall at a line that is not the
    // member's problem. ⚠️ A colliding `def` still refuses: a variable really
    // cannot be defined twice, and that is a different fact from this one.
    // ⛔ THE SAME PLOT NAME TWICE IS A DUPLICATE COLUMN, NOT A SHADOW. W3.3
    // disclosed this asymmetry and review asked for the guard: a duplicate `def`
    // refused while a duplicate `plot` quietly produced two columns both titled
    // `p` with `ok: true`. ⚠️ Checked BEFORE `shadowed`, because it is the
    // shadowing rule below that would otherwise absorb it.
    if (k === 'plot') {
      if (ctx.plotted.has(key(name))) throw refuse('thinkscript:statement', nameTok)
      ctx.plotted.add(key(name))
    }
    const shadowed = k === 'plot' && ctx.env.has(key(name))
    if (toks.length === 2) {
      // ⭐ A FORWARD DECLARATION. `10-rsi-laguerre` writes `plot RSI;` at the top
      // and `RSI = …;` forty lines down; `06`, `17` and `20` all do the same with
      // `def`. One binding, filled later — never two names.
      if (!shadowed) bindNew(name, { kind: 'forward', plot: k === 'plot', tok: nameTok })
      if (k === 'plot') ctx.outputs.push({ kind: 'plot', title: name, name: shadowed ? null : key(name), tok: head, nameTok, expr: shadowed ? { e: 'name', name, tok: nameTok } : null })
      return
    }
    if (!isPunctTok(toks[2], '=')) throw refuse('thinkscript:statement', head)
    const expr = parseWhole(toks.slice(3))
    if (!shadowed) bindNew(name, { kind: 'def', expr, tok: nameTok })
    if (k === 'plot') {
      ctx.outputs.push({
        kind: 'plot', title: name, name: shadowed ? null : key(name), tok: head, nameTok, expr,
      })
    }
    return
  }

  if (k === 'if' || k === 'switch' || k === 'script') {
    // ⛔ A BLOCK ASSIGNS ONE NAME FROM SEVERAL STATEMENTS. This engine stores a
    // single expression per column, so the shape has nowhere to go — and saying
    // so at the word that opened it is more useful than refusing the name it
    // was going to fill. ⭐ `script foo { … }` — a user-defined sub-script — is
    // the same fact: a program where one expression is stored. It reported a
    // syntax error at the script's NAME until W3.3 review.
    throw refuse('thinkscript:block', head)
  }

  if ((head.kind === 'ident' || head.kind === 'string') && isPunctTok(toks[1], '=')) {
    const name = nameOf(head)
    const prior = ctx.env.get(key(name))
    if (!prior || prior.kind !== 'forward') throw refuse('thinkscript:statement', head)
    ctx.env.set(key(name), { kind: 'def', expr: parseWhole(toks.slice(2)), tok: prior.tok })
    return
  }

  const expr = parseWhole(toks)
  if (expr.e === 'call') throw refuse('thinkscript:statement', expr.tok)
  ctx.outputs.push({ kind: 'condition', title: null, name: null, tok: head, nameTok: head, expr })
}

/** Every statement, read; a statement that refuses does NOT stop the rest.
 *  ⭐ THE WHOLE PROGRAM IS STILL READ AROUND A REFUSAL, because a member's
 *  chrome line must not hide the function token their column actually died on —
 *  which is the position that tells them what to do next. */
function readProgram(lexed) {
  const ctx = {
    env: new Map(), outputs: [], ignored: [...lexed.notes], folded: [],
    hard: [], declaration: null, text: lexed.text, plotted: new Set(),
  }
  for (const run of readStatements(lexed.tokens)) {
    try { readStatement(run.tokens, ctx) } catch (err) { ctx.hard.push(fromError(err)) }
  }
  ctx.ignored.sort((a, b) => (a.line - b.line) || (a.column - b.column))
  return ctx
}

// --------------------------------------------------------------------------- //
// the resolver — thinkScript names to the engine's canonical tree
// --------------------------------------------------------------------------- //

const cSeries = (name) => ({ type: 'series', name })
const cOp = (name, args) => ({ type: 'op', name, args })

/** ⚠️ A NEGATIVE LITERAL IS `u-` OF A POSITIVE ONE, which is what `parseFormula`
 *  produces and therefore what the round trip demands. Emitting `{num: -2}` for
 *  `-2.0` prints the same text and hashes differently. */
function cNum(value, tok) {
  if (!Number.isFinite(value)) throw refuse('thinkscript:type', tok)
  return value < 0
    ? cOp('u-', [{ type: 'num', value: -value }])
    : { type: 'num', value }
}

/** `Double.NaN` — the engine's not-computable, spelled the way its own parser
 *  reads it. The identity `pine.js` already uses for a bare `na`. */
const cNaN = () => cOp('/', [{ type: 'num', value: 0 }, { type: 'num', value: 0 }])

function literalInteger(node) {
  if (node && node.type === 'num' && Number.isInteger(node.value)) return node.value
  if (node && node.type === 'op' && node.name === 'u-' && node.args.length === 1
    && node.args[0].type === 'num' && Number.isInteger(node.args[0].value)) return -node.args[0].value
  return null
}

const isEnum = (v) => !!v && v.ts === 'enum'

class Resolver {
  constructor(env) {
    this.env = env
    this.memo = new Map()
    this.stack = []
    this.inputs = new Set()
    this.lagged = false
  }

  /** ⛔ A COMPILE-TIME VALUE IS NOT A COLUMN. An enum arm and a text literal are
   *  values thinkScript carries and this engine's tree has no node for, so they
   *  refuse HERE, where they are used as a number, rather than being coerced. */
  asNode(v, tok) {
    if (v && v.ts === 'bool') return { type: 'num', value: v.value ? 1 : 0 }
    if (v && v.ts === 'enum') throw refuse('thinkscript:builtin', v.tok || tok)
    if (v && v.ts === 'text') throw refuse('thinkscript:type', v.tok || tok)
    return v
  }

  resolveBinding(k, tok) {
    const cached = this.memo.get(k)
    if (cached) {
      if (cached.err) throw cached.err
      cached.inputs.forEach((n) => this.inputs.add(n))
      return cached.value
    }
    const b = this.env.get(k)
    if (!b) throw refuse('thinkscript:undefined', tok)
    if (b.kind === 'no-default') throw refuse('thinkscript:input-kind', tok)
    if (b.kind === 'forward') throw refuse('thinkscript:undefined', tok)
    if (this.stack.includes(k)) {
      // ⭐ TWO DIFFERENT FACTS, AND A MEMBER FIXES THEM DIFFERENTLY. A name that
      // reads its OWN PREVIOUS bar is carried state (`def ST = if close < ST[1]
      // …`), which the bounded accumulator would hold and W3.6 will map; a name
      // that reads itself at the SAME bar, or two names through each other, has
      // no way in at all.
      throw refuse(
        this.stack[this.stack.length - 1] === k && this.lagged ? 'thinkscript:state' : 'thinkscript:cycle',
        tok)
    }
    const outerInputs = this.inputs
    const outerLag = this.lagged
    const mine = new Set()
    if (b.kind === 'input' || b.input) mine.add(k)
    this.inputs = mine
    this.lagged = false
    this.stack.push(k)
    let value = null
    let err = null
    try {
      value = b.kind === 'enum'
        ? { ts: 'enum', family: b.family, arm: key(b.arm), arms: b.arms, tok: b.tok }
        : this.resolve(b.expr)
    } catch (e) { err = e }
    this.stack.pop()
    this.inputs = outerInputs
    this.lagged = outerLag
    mine.forEach((n) => outerInputs.add(n))
    this.memo.set(k, { value, err, inputs: mine })
    if (err) throw err
    return value
  }

  resolveDotted(tok) {
    const parts = tok.value.split('.')
    const base = key(parts[0])
    const rest = key(parts.slice(1).join('.'))
    if (base === 'double') {
      if (rest === 'nan') return cNaN()
      if (rest === 'pi') return { type: 'num', value: Math.PI }
      // ⛔ AN INFINITY IS NOT A NUMBER A COLUMN CAN HOLD. The canonical tree
      // carries finite numbers only (`printFormula` refuses one outright), so
      // this refuses at the name rather than at the print.
      if (rest === 'positive_infinity' || rest === 'negative_infinity') throw refuse('thinkscript:type', tok)
      throw refuse('thinkscript:builtin', tok)
    }
    if (this.env.has(base)) {
      const v = this.resolveBinding(base, tok)
      if (isEnum(v)) {
        // ⛔⛔ THE ARM MUST BE ONE THE INPUT DECLARED. `mode.UseZ` against
        // `{default UseA, UseB}` used to sail through and then quietly decide a
        // comparison, which is a mistranslation rather than a refusal.
        if (!Array.isArray(v.arms) || !v.arms.some((a) => key(a) === rest)) {
          throw refuse('thinkscript:enum-arm', tok)
        }
        return { ts: 'enum', family: v.family, arm: rest, arms: v.arms, tok }
      }
      throw refuse('thinkscript:builtin', tok)
    }
    // `Color.RED`, `AverageType.HULL`, `AggregationPeriod.DAY` — a symbolic
    // constant of thinkorswim's own, comparable with an enum input's arm and
    // refusable the moment it is asked to be a number.
    return { ts: 'enum', family: base, arm: rest, tok }
  }

  resolveName(tok) {
    if (tok.value.includes('.')) return this.resolveDotted(tok)
    const k = key(tok.value)
    if (this.env.has(k)) return this.resolveBinding(k, tok)
    // ⭐ THE SCRIPT'S OWN NAMES SHADOW THE ENGINE'S. `22-average-daily-range`
    // writes `def open = open(period = …);` and then reads `OPEN` — the member's
    // binding is the one they meant.
    const engine = normaliseName(k)
    if (has(TABLE.series, engine)) return cSeries(engine)
    if (TS_BUILTIN_PRICES.has(k)) throw refuse('thinkscript:builtin', tok)
    throw refuse('thinkscript:undefined', tok)
  }

  binary(n) {
    const l = this.resolve(n.left)
    const r = this.resolve(n.right)
    if ((n.op === '==' || n.op === '!=') && (isEnum(l) || isEnum(r))) {
      // ⭐ AN ENUM COMPARISON IS DECIDED AT TRANSLATION TIME, which is the whole
      // point of folding an input: `17-compoundvalue` plots BOTH arms of
      // `{default UseCompoundValue, ManualCalculation}` and the member gets one.
      if (!isEnum(l) || !isEnum(r)) throw refuse('thinkscript:type', n.tok)
      // ⛔⛔ FOLD ONLY WHAT A DECLARED ARM LIST CAN DECIDE. The old form compared
      // `family` and `arm` as plain strings, so a cross-family pair and an
      // undeclared arm BOTH came out "not equal" — a decision this translator
      // had no grounds to make, delivered silently as a column. Now one side
      // must be an input whose arms are known, the other must name one of them,
      // and anything else refuses AT THE OFFENDING TOKEN.
      const declared = Array.isArray(l.arms) ? l : (Array.isArray(r.arms) ? r : null)
      if (!declared) throw refuse('thinkscript:enum-arm', n.tok)
      const other = declared === l ? r : l
      if (other.family !== declared.family
        || !declared.arms.some((a) => key(a) === other.arm)) {
        throw refuse('thinkscript:enum-arm', other.tok || n.tok)
      }
      const same = declared.arm === other.arm
      return { ts: 'bool', value: n.op === '==' ? same : !same, tok: n.tok }
    }
    const a = this.asNode(l, n.tok)
    const b = this.asNode(r, n.tok)
    // ⏳ `%` IS THE ENGINE'S `mod`, A FUNCTION RATHER THAN AN OPERATOR — so it
    // needs the map W3.4 builds, exactly as a written call does, and refuses the
    // same way until it exists. Refused AFTER both sides resolve so an earlier
    // refusal inside them keeps the earlier position.
    if (n.op === '%') throw refuse('thinkscript:function', n.tok)
    return cOp(n.op, [a, b])
  }

  resolve(n) {
    switch (n.e) {
      case 'num': return cNum(n.value, n.tok)
      case 'text': {
        // ⭐ A QUOTED PLOT NAME IS AN IDENTIFIER. `03-adx-dmi-lower` writes
        // `plot "DI+" = …` and reads `"DI+"` back in `def DX`; a string that
        // names nothing is text, and text is not a number a column can hold.
        const k = key(n.value)
        if (this.env.has(k)) return this.resolveBinding(k, n.tok)
        return { ts: 'text', value: n.value, tok: n.tok }
      }
      case 'name': return this.resolveName(n.tok)
      case 'call': {
        // A method's receiver refuses at ITS OWN token first, so
        // `BollingerBands(length = X).LowerBand` names `BollingerBands`.
        if (n.base) this.resolve(n.base)
        throw refuse('thinkscript:function', n.tok)
      }
      case 'member': {
        this.resolve(n.base)
        throw refuse('thinkscript:study-ref', n.tok)
      }
      case 'offset': {
        const outerLag = this.lagged
        this.lagged = false
        let idx
        try { idx = this.asNode(this.resolve(n.index), n.tok) } finally { this.lagged = outerLag }
        const k = literalInteger(idx)
        if (k === null) throw refuse('thinkscript:offset-literal', n.index.tok || n.tok)
        // ⛔ `x[-1]` READS A BAR THAT HAS NOT HAPPENED. The reference's own
        // tutorial says the study "will wait for a new quote"; a closed-bar
        // engine cannot, and the offset node has no slot for a negative value.
        if (k < 0) throw refuse('thinkscript:future-offset', n.index.tok || n.tok)
        this.lagged = k > 0
        let base
        try { base = this.asNode(this.resolve(n.base), n.tok) } finally { this.lagged = outerLag }
        if (k === 0) return base
        // ⛔ `close[1][1]` AND `close[2]` ARE THE SAME COLUMN WITH TWO HASHES, so
        // the engine refuses the chain (`canonicalise:offset-chained`). Decided
        // HERE rather than discovered by the round trip, because the round trip
        // could only name the OUTPUT — W3.3 review measured the caret landing on
        // `p` in `plot p = close[1][1];`, which is correct code. A caret on
        // correct code sends a member to fix the wrong thing.
        if (base && base.type === 'offset') {
          throw refuse('thinkscript:offset-chained', n.bracket || n.tok)
        }
        return { type: 'offset', value: k, args: [base] }
      }
      case 'unary': {
        const v = this.asNode(this.resolve(n.arg), n.tok)
        if (n.op !== '-') return cOp('!', [v])
        return v.type === 'num' ? cNum(-v.value, n.tok) : cOp('u-', [v])
      }
      case 'binary': return this.binary(n)
      case 'if': {
        const cond = this.resolve(n.cond)
        // ⚠️ THE ARM NOT TAKEN IS NOT READ, DELIBERATELY. Once the enum is
        // frozen the other branch is not part of the member's column, and
        // refusing the script for something it will never evaluate would refuse
        // a study that works.
        if (cond && cond.ts === 'bool') return this.resolve(cond.value ? n.then : n.otherwise)
        return cOp('?:', [
          this.asNode(cond, n.tok),
          this.asNode(this.resolve(n.then), n.tok),
          this.asNode(this.resolve(n.otherwise), n.tok),
        ])
      }
      default: throw refuse('thinkscript:statement', n.tok)
    }
  }
}

/** ⛔ `printFormula` THROWS A `PineRefusal`, WHICH IS ANOTHER DOOR'S CLASS. Left
 *  uncaught it would reach `fromError` and be swallowed into
 *  `thinkscript:statement` with a Pine sentence inside it — a refusal naming the
 *  wrong door. */
function printOrRefuse(ast, tok) {
  try { return printFormula(ast) } catch (err) {
    throw new ThinkScriptRefusal('thinkscript:roundtrip',
      `${REFUSALS['thinkscript:roundtrip']} (${err && err.message ? err.message : err})`, locate(tok))
  }
}

/** The text this translator offers must read back as the tree it was printed
 *  from. Mirrors `pine.js::verifyRoundTrip` — a drift between the printer and
 *  the parser cannot ship a wrong formula, only a loud refusal with nothing
 *  offered. */
function verifyRoundTrip(formula, ast, tok) {
  const reparsed = parseFormula(formula)
  if (!reparsed.ok) {
    throw new ThinkScriptRefusal('thinkscript:roundtrip',
      `${REFUSALS['thinkscript:roundtrip']} (${reparsed.error})`, locate(tok))
  }
  let a
  let b
  try { a = astHash(reparsed.ast); b = astHash(ast) } catch (err) {
    throw new ThinkScriptRefusal('thinkscript:roundtrip',
      `${REFUSALS['thinkscript:roundtrip']} (${err && err.message ? err.message : err})`, locate(tok))
  }
  if (a !== b) throw refuse('thinkscript:roundtrip', tok)
}

/** Which column is offered first. A `plot` that yields a truth is a scan; a
 *  bare condition IS one by construction. ⭐ `treeYieldsBool` is IMPORTED from
 *  `pine.js` rather than re-decided here — one `yields` reader for the engine. */
function chooseOutput(rows) {
  const usable = rows.map((r, i) => i).filter((i) => rows[i].refusal === null && !rows[i].hidden)
  if (!usable.length) return -1
  const boolish = usable.find((i) => {
    if (rows[i].kind === 'condition') return true
    try { return treeYieldsBool(rows[i].ast) } catch { return false }
  })
  return boolish === undefined ? usable[0] : boolish
}

// --------------------------------------------------------------------------- //
// the door
// --------------------------------------------------------------------------- //

/**
 * Translate a pasted thinkorswim study into this engine's column formulas.
 *
 * ⛔ IT NEVER THROWS. Four callers treat it as total — the corpus gate runs it
 * over 24 real published studies, and a member's paste is arbitrary text.
 *
 * @param {string} source the pasted thinkScript
 * @param {object} [opts] reserved; `opts.table` becomes the closed-table
 *   injection point for the task that first maps a function.
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

  // ⛔ THE **WHOLE** BODY IS INSIDE THE TRY, AND THAT IS A FIX, NOT A STYLE.
  // The empty-source branch used to sit above it, calling `refusalValue` —
  // which asserts its guard — outside any catch. The day that assert fires it
  // would throw straight out of a function whose header promises it never
  // throws, and the four callers that treat this as total (the corpus gate over
  // 24 real files, the intake bench, `ImportBox`, a member's arbitrary paste)
  // would all see the exception instead of a refusal. Found in W3.2 review.
  let lines = []
  try {
    if (typeof source !== 'string' || source.trim() === '') {
      const r = refusalValue('thinkscript:empty', REFUSALS['thinkscript:empty'], null)
      return { ...blank, refusal: r, refusals: [r] }
    }

    lines = sourceLines(source)
    const lexed = lexThinkScript(source)
    const program = readProgram(lexed)
    const resolver = new Resolver(program.env)

    const rows = program.outputs.map((o) => {
      resolver.inputs = new Set()
      const site = { kind: o.kind, title: o.title, line: o.tok.line, column: o.tok.column }
      try {
        // ⭐ A NAMED OUTPUT RESOLVES THROUGH ITS BINDING, so `plot RSI;` reaches
        // the `RSI = …;` forty lines below it. A plot whose name a `def` already
        // owns carries its expression inline and resolves that instead.
        const value = o.name
          ? resolver.resolveBinding(o.name, o.nameTok)
          : resolver.resolve(o.expr)
        const ast = resolver.asNode(value, o.nameTok)
        const formula = printOrRefuse(ast, o.nameTok)
        verifyRoundTrip(formula, ast, o.nameTok)
        return {
          ...site,
          formula,
          ast,
          inputsFolded: program.folded.filter((f) => resolver.inputs.has(key(f.name))),
          hidden: false,
          refusal: null,
        }
      } catch (err) {
        return { ...site, formula: null, ast: null, inputsFolded: [], hidden: false, refusal: fromError(err) }
      }
    })

    const usable = rows.filter((r) => r.refusal === null && !r.hidden)
    const refusals = [...program.hard, ...rows.filter((r) => r.refusal).map((r) => r.refusal)]
      .sort(byPosition)

    if (rows.length === 0) {
      const none = refusalValue('thinkscript:no-output', REFUSALS['thinkscript:no-output'], null)
      const all = program.hard.length ? refusals : [none, ...refusals]
      return {
        ...blank,
        declaration: program.declaration,
        ignored: program.ignored,
        folded: program.folded,
        refusal: withExcerpt(all[0] || null, lines),
        refusals: withExcerpts(all, lines),
      }
    }

    // ⛔ A STATEMENT THIS TRANSLATOR CANNOT READ REFUSES THE WHOLE SCRIPT EVEN
    // WHEN A PLOT TRANSLATED — the same ruling `pine.js` makes for a `strategy()`
    // whose plots are perfectly good Pine. A study whose `AddLabel` line was not
    // read is a study we have not finished reading, and offering one of its plots
    // as "your scan" is answering about a different document than the one pasted.
    const blocked = program.hard.length > 0
    return {
      ok: usable.length > 0 && !blocked,
      version: 'thinkscript',
      declaration: program.declaration,
      title: null,
      outputs: rows.map((r) => (r.refusal ? { ...r, refusal: withExcerpt(r.refusal, lines) } : r)),
      selected: blocked ? -1 : chooseOutput(rows),
      refusal: (usable.length > 0 && !blocked) ? null : withExcerpt(refusals[0] || null, lines),
      refusals: withExcerpts(refusals, lines),
      ignored: program.ignored,
      folded: program.folded,
    }
  } catch (err) {
    const r = withExcerpt(fromError(err), lines)
    return { ...blank, refusal: r, refusals: [r] }
  }
}
