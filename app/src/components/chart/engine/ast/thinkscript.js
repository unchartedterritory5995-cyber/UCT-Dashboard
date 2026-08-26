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
// ⏳ WHAT IT READS TODAY (W3.4): the LEXER, the STATEMENT READER and the
// EXPRESSIONS. `declare`, `input`, `def`/`rec`, a forward declaration and its
// later assignment, `plot` (quoted names included) and a bare condition all
// read; the expression grammar is ONE binding-power loop over the `BP` ladder
// below, covering numbers, the five bar fields, the arithmetic and comparison
// operators in BOTH their symbol and their word spellings, `and`/`or`/`not`,
// `if … then … else`, `[n]`, the `Double.*` constants, `between`,
// `within N bars`, `crosses [above|below]` and `%`.
//
// ⏳ THE FUNCTION MAP ITSELF IS STILL W3.5's. What landed here is the call-shape
// MECHANISM — thinkorswim's own parameter names, named arguments in any order,
// documented defaults, arity and the window check — seeded with the four rows
// (`Average`, `StDev`, `Highest`, `Lowest`) this task's own rails exercise,
// because a named-argument guard with no declared parameter list to check
// against is unimplementable. Every OTHER call still refuses
// `thinkscript:function` AT ITS NAME rather than resolving to a neighbour.
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
 *  not an identifier start.
 *
 *  ⚠️ `&&` AND `||` JOINED IN W3.4, AND THE REFERENCE IS ASYMMETRIC ABOUT THEM.
 *  thinkorswim's Logical Operators page (fetched 2026-08-26) spells its AND row
 *  `and, &&` — the symbol is the platform's own — while its OR row reads `or`
 *  alone. `||` is accepted anyway, because the pair is ONE grammar: a member who
 *  writes `&&` writes `||` in the next line, and reading one while refusing the
 *  other would refuse half a script over punctuation. ⛔ A SINGLE `&` OR `|` IS
 *  STILL A CHARACTER THIS LEXER CANNOT NAME and refuses at its own column — the
 *  superset stops at the two spellings the page and its own grammar imply. */
const PUNCT = [
  '==', '!=', '<>', '>=', '<=', '&&', '||',
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

/** ⭐⭐ THE PRECEDENCE, LOOSEST FIRST, AND IT IS THE ONLY COPY. thinkorswim's
 *  reference publishes the operator ROSTER (its Arithmetic / Comparison /
 *  Logical / Conditional pages, all fetched 2026-08-26) and does NOT publish a
 *  precedence table, so this ladder is the conventional one every C-family
 *  language uses — stated HERE, in one place, rather than living implicitly in a
 *  recursive-descent chain nobody can read.
 *
 *  ⛔⛔ AND THE PARSER READS IT. W3.3 shipped the chain
 *  (`parseOr → parseAnd → parseWithin → parseComparison → parseAdditive → …`),
 *  which encodes exactly this ladder in the SHAPE of its call graph. Writing the
 *  table beside that chain would have created the defect this repo names as its
 *  most repeated — a second authority over one value — where the readable copy
 *  and the executed copy drift and the drift is silent. So the chain was
 *  replaced by ONE binding-power loop that reads this table: change a number
 *  here and the grammar changes, or nothing does.
 *
 *  ⚠️ THREE RULINGS IN THIS LADDER ARE MEASURED RATHER THAN CONVENTIONAL:
 *
 *  1. `between` and `crosses` SIT WITH THE COMPARISONS, because the reference's
 *     own Comparison Operators page lists `between`, `crosses`, `crosses above`
 *     and `crosses below` as ROWS OF THAT TABLE, beside `>` and `is greater
 *     than`. The lane brief put `between` on a looser tier of its own; that
 *     would be this translator inventing a level the platform does not document.
 *     Same-tier and left-associative hands `between` the comparison already
 *     built, which is the reading the brief wanted from the looser tier anyway.
 *
 *  2. `within` MUST NEVER BIND TIGHTER THAN COMPARISON, and it is the one place
 *     this ladder departs from the operator pages — because `within` is not on
 *     them. It is a RESERVED WORD whose left operand is a CONDITION ("true at
 *     least one time for the given number of bars"), so
 *     `close > open within 3 bars` can only mean `(close > open) within 3 bars`;
 *     bound tighter it would take `open` as its condition and leave the `>`
 *     dangling.
 *     ⚠️ THE RUNG ITSELF IS NOT LOAD-BEARING AND THE SWEEP PROVED IT. Moving
 *     `within` from 25 to 30 — onto the comparison tier — changes NOTHING any
 *     rail can see, because the loop is left-associative: at either rung
 *     `within` is handed the comparison that has already been built. Moving it
 *     to 35, above comparison, reds three tests. So the ruling is the BOUNDARY
 *     (`<= 30`), not the number, and 25 is a readable rung on the correct side
 *     of it rather than a measured value. Recorded because a comment claiming a
 *     difference no test can see is the defect this file keeps warning about.
 *
 *  3. UNARY AND POSTFIX CARRY NO NUMBER HERE, deliberately. The brief listed
 *     `UNARY_BP` and `POSTFIX_BP` constants, but `parseUnary` and `parsePostfix`
 *     below sit at FIXED positions in the grammar — binding tighter than every
 *     binary operator is what their position IS — so a number for them would be
 *     read by nothing. An unread constant beside the code that decides the same
 *     thing is the same second authority as an unread ladder. `pine.js`'s
 *     printer declares its own `UNARY_BP`/`POSTFIX_BP` because its PRINTER
 *     genuinely compares them; nothing here does. */
const BP = Object.freeze({
  '||': 10,
  '&&': 20,
  'within': 25,
  '==': 30, '!=': 30, '<': 30, '>': 30, '<=': 30, '>=': 30,
  'between': 30, 'crosses': 30,
  '+': 40, '-': 40,
  '*': 50, '/': 50, '%': 50,
})

/** The symbol an operator is CANONICALLY spelled with. `<>` is thinkScript's
 *  other spelling of `!=` (`10-rsi-laguerre` writes it), and folding it here
 *  means the tree, the printer and `BP` only ever see one of the two. */
const CMP = Object.freeze({ '==': '==', '!=': '!=', '<>': '!=', '>': '>', '<': '<', '>=': '>=', '<=': '<=' })

/** ⭐ THE WORD SPELLINGS ARE THE SYMBOL SPELLINGS. thinkorswim's Comparison
 *  Operators page lists `is greater than` and `>` as SEPARATE ROWS WITH THE SAME
 *  DESCRIPTION, and its Logical page does the same for `and` / `&&`. So these
 *  are not a convenience mapping bolted onto a symbol grammar — they are the
 *  same operators, and the reader must not grow a second grammar for the long
 *  ones. Every entry below is a row of one of those two pages, quoted.
 *
 *  ⛔ LONGEST MATCH WINS, AND IT IS DECIDED BY MEASURING THE PHRASE, NOT BY THE
 *  ORDER OF THIS LIST. `is greater than or equal to` and `is greater than` share
 *  a prefix; a matcher that took the first hit in list order would read
 *  `a is greater than or equal to b` as `a > (or equal to b)` and die at `or`
 *  with a wrong reason at a wrong token — and it would do it silently the day
 *  somebody re-sorted the list alphabetically. `infixAt` picks the longest
 *  phrase that matches, so the order here carries no meaning at all.
 *
 *  ⚠️⚠️ AND THAT LAST SENTENCE IS WHY NO TEST CAN CATCH THE LONGEST-MATCH GUARD
 *  ALONE — MEASURED, not assumed. The sweep replaced it with "take the first
 *  match" and all 144 tests stayed GREEN, because the rows below HAPPEN to be
 *  written longest-first, so the two rules agree on this table: it is an
 *  EQUIVALENT MUTANT, not an unrailed guard. What separates them is a pair:
 *  re-ordering the rows short-first with the guard KEPT stays green (the guard
 *  absorbs the order — which is its whole job), and re-ordering with the guard
 *  REMOVED reds `is greater than or equal to`. The behavioural rail that does
 *  exist is `every row of the word-operator table is REACHABLE, and parses as
 *  ITSELF` in `thinkscript.test.js`, which walks THIS array — so a row added in
 *  the wrong place is caught by the guard, and a row that is unreachable for any
 *  other reason is caught by name.
 *
 *  ⚠️ `is true` / `is false` ARE ON THE LOGICAL PAGE, whose NOT row reads
 *  `!, is false` — the two spellings are literally one row, so `is false` is `!`
 *  by quotation rather than by inference. `is true` is that row's neighbour,
 *  `is true | logical value`, and it resolves to the operand UNCHANGED: passing
 *  the value straight through hands this engine exactly the truthiness decision
 *  thinkorswim's own runtime would make on it, which is what every other boolean
 *  context in this translator already does. */
export const TS_WORD_OPERATORS = Object.freeze([
  { words: ['and'], kind: 'binary', op: '&&' },
  { words: ['or'], kind: 'binary', op: '||' },
  { words: ['is', 'greater', 'than', 'or', 'equal', 'to'], kind: 'binary', op: '>=' },
  { words: ['is', 'less', 'than', 'or', 'equal', 'to'], kind: 'binary', op: '<=' },
  { words: ['is', 'not', 'equal', 'to'], kind: 'binary', op: '!=' },
  { words: ['is', 'greater', 'than'], kind: 'binary', op: '>' },
  { words: ['is', 'less', 'than'], kind: 'binary', op: '<' },
  { words: ['is', 'equal', 'to'], kind: 'binary', op: '==' },
  { words: ['equals'], kind: 'binary', op: '==' },
  { words: ['is', 'true'], kind: 'postfix', op: null },
  { words: ['is', 'false'], kind: 'postfix', op: '!' },
  { words: ['crosses', 'above'], kind: 'cross', dir: 'above' },
  { words: ['crosses', 'below'], kind: 'cross', dir: 'below' },
  { words: ['crosses'], kind: 'cross', dir: 'either' },
  { words: ['between'], kind: 'between', op: 'between' },
  { words: ['within'], kind: 'within', op: 'within' },
])

/** The binding power an infix entry answers to — ONE lookup, so `is greater
 *  than` and `>` can never end up on different rungs. ⚠️ `is true` / `is false`
 *  take no right operand, so they answer to the COMPARISON tier they are
 *  documented beside rather than to a rung of their own. */
function bpOf(entry) {
  if (entry.kind === 'cross') return BP.crosses
  if (entry.kind === 'postfix') return BP['==']
  return BP[entry.op]
}

const cursorOf = (toks) => ({ toks, i: 0 })
const peek = (c, k = 0) => c.toks[c.i + k] || null
const take = (c) => c.toks[c.i++]

const syntaxAt = (c, tok) => refuse('thinkscript:syntax', tok || c.toks[c.toks.length - 1] || null)

/** The infix operator sitting at the cursor, WITHOUT consuming it — a symbol, or
 *  the LONGEST word phrase that matches from here.
 *
 *  ⛔ THE LONGEST, not the first: `is greater than or equal to` and
 *  `is greater than` share a prefix, and taking the shorter one reads
 *  `a is greater than or equal to b` as `a > (or equal to b)`.
 *
 *  @returns {{entry: object, bp: number, tok: object, length: number}|null} */
function infixAt(c) {
  const t = peek(c)
  if (!t) return null
  if (t.kind === 'punct') {
    const op = has(CMP, t.value) ? CMP[t.value] : t.value
    return has(BP, op) ? { entry: { kind: 'binary', op }, bp: BP[op], tok: t, length: 1 } : null
  }
  if (t.kind !== 'ident') return null
  let best = null
  for (const entry of TS_WORD_OPERATORS) {
    if (best && entry.words.length <= best.length) continue
    if (entry.words.every((w, i) => isWordTok(peek(c, i), w))) {
      best = { entry, bp: bpOf(entry), tok: t, length: entry.words.length }
    }
  }
  return best
}

/**
 * One expression, read at a binding power.
 *
 * ⭐ ONE LOOP, DRIVEN BY `BP` ABOVE. Everything about precedence lives in that
 * table; this function only knows "looser than what I was called at means stop".
 * The left-associativity of every tier is the `+ 1` on the recursive call.
 *
 * ⚠️ `if … then … else …` IS A PREFIX FORM HERE, not an infix ternary, which is
 * how thinkScript writes it — so it is read by `parseExpression` below, at the
 * front of a value, and its `else` arm re-enters there. That is what makes
 * `if a then 1 else if b then -1 else 0` nest to the right without a rung.
 */
function parseBinary(c, minBp) {
  let left = parseUnary(c)
  for (;;) {
    const found = infixAt(c)
    if (!found || found.bp < minBp) return left
    const { entry, bp, tok } = found
    for (let n = 0; n < found.length; n += 1) take(c)

    // ⭐ `x between a and b` — the reference's own words are *"within the range
    // of value1 and value2 (inclusive)"*. ⛔ THE BOUNDS ARE READ AT THE TIER
    // ABOVE, which is the load-bearing half: `between` SPENDS an `and` closing
    // its own phrase, so a reader that let the logical `and` win would take
    // `high and volume > 0` as the upper bound — a wrong column, not a refusal.
    // ⚠️ The CALL form `between(a, b, c)` is untouched and still refuses at its
    // name — `23-previous-day-high-low-mean` uses it six times, and a FUNCTION
    // called `Between` needs its own citation, which is the function map's job.
    // That is why `between` is not in `NOT_AN_ATOM`.
    if (entry.kind === 'between') {
      const lo = parseBinary(c, bp + 1)
      if (!isWordTok(peek(c), 'and')) throw syntaxAt(c, peek(c))
      take(c)
      left = { e: 'between', x: left, lo, hi: parseBinary(c, bp + 1), tok }
      continue
    }

    // `<cond> within N bars` — *"true at least one time for the given number of
    // bars starting from the current one"*. The trailing `bar`/`bars` is
    // consumed POSITIONALLY rather than reserved, because `23-previous-day`
    // opens `def bar = barNumber();` and reads `bar` seventeen times.
    if (entry.kind === 'within') {
      const count = parseBinary(c, bp + 1)
      if (isWordTok(peek(c), 'bars') || isWordTok(peek(c), 'bar')) take(c)
      left = { e: 'within', cond: left, count, tok }
      continue
    }

    // `x is true` / `x is false` take no right operand at all.
    if (entry.kind === 'postfix') {
      left = entry.op === null ? left : { e: 'unary', op: entry.op, arg: left, tok }
      continue
    }

    const right = parseBinary(c, bp + 1)
    left = entry.kind === 'cross'
      ? { e: 'cross', dir: entry.dir, left, right, tok }
      : { e: 'binary', op: entry.op, left, right, tok }
  }
}

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
  return parseBinary(c, 0)
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
    let nameTok = null
    const a = peek(c)
    // ⭐ THE NAME'S OWN TOKEN IS KEPT, and it is the whole reason a refusal can
    // land on `source` rather than on the call. A quoted name is the same name —
    // `19-consecutive-bars` writes `MovAvgExponential("length" = 21)` — so the
    // token's TEXT stays `"length"` (with its quotes) while its VALUE is
    // `length`, which is what keeps the corpus gate's caret assertion honest.
    if (a && (a.kind === 'ident' || a.kind === 'string') && isPunctTok(peek(c, 1), '=')) {
      name = a.value
      nameTok = a
      take(c)
      take(c)
    }
    args.push({ name, nameTok, value: parseExpression(c) })
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
/** ⛔ NEVER CALLED DIRECTLY — `Resolver.engineCall` is the only caller, because
 *  the promise this module makes is that every engine name it emits was LOOKED
 *  UP in the closed table first. A `cCall` reachable from anywhere else is how
 *  that promise quietly stops being true. */
const cCall = (name, args) => ({ type: 'call', name, args })

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

/**
 * ⭐⭐ THE CALL SHAPES — a thinkorswim function, its OWN parameter names, and the
 * engine function it is an IDENTITY for.
 *
 * ⛔ EVERY ROW IS A QUOTED IDENTITY, and `cite` is where the quote lives so it
 * travels with the row instead of ageing in a comment three screens up.
 * `thinkscript.test.js` reads both fields: it asserts every `engine` name is one
 * `closedTable.json` declares, and that every row carries a citation. A shape is
 * therefore never "the function I believe this is" — it is the function the
 * reference's own formula says it is, checked against the table that owns the
 * name.
 *
 * ⏳ AND IT IS A SEED, NOT THE MAP. W3.5 owns the function map proper —
 * `ExpAverage` and `WildersAverage` with their seeding note, `MovingAverage`'s
 * enum dispatch, `TrueRange`'s role order, `RSI`/`ATR`'s averaging convention,
 * `Log` → `ln`, `Round`'s digit count, `HighestAll`'s refusal and
 * `CompoundValue` → `accum`. What lands HERE is the MECHANISM (named arguments,
 * arity, documented defaults, the window check) plus the four rows this task's
 * own rails exercise, because a named-argument guard with no declared parameter
 * list to check against is unimplementable and untestable.
 *
 * ⚠️ `defaults` IS DELIBERATELY SPARSE, AND THE ASYMMETRY IS THE POINT. The
 * reference publishes `length` default 12 for `Average` and for
 * `Highest`/`Lowest`; it publishes none for `StDev` on the page this lane
 * quoted, so `StDev(close)` refuses `:arity` rather than being handed a 12 this
 * translator made up. A guessed default is invisible in the result — the member
 * gets a deviation they never asked for and never see.
 */
export const TS_CALL_SHAPES = Object.freeze({
  average: {
    engine: 'sma',
    params: ['data', 'length'],
    defaults: { length: 12 },
    cite: 'Functions/Tech-Analysis/Average: "Returns the average value of a set of data '
      + 'for the last length bars", shown as Sum(data, length) / length; length default 12',
  },
  stdev: {
    engine: 'stdev',
    params: ['data', 'length'],
    defaults: {},
    cite: 'Functions/Statistical/StDev: reimplemented on the page itself as '
      + 'Sqrt(Average(Sqr(data), length) - Sqr(Average(data, length))) — divided by length, '
      + 'i.e. the POPULATION deviation, which is the divisor closedTable declares for stdev',
  },
  highest: {
    engine: 'highest',
    params: ['data', 'length'],
    defaults: { length: 12 },
    cite: 'Functions/Tech-Analysis/Highest: "the highest value of data for the last '
      + 'length bars"; length default 12',
  },
  lowest: {
    engine: 'lowest',
    params: ['data', 'length'],
    defaults: { length: 12 },
    cite: 'Functions/Tech-Analysis/Lowest: "the lowest value of data for the last '
      + 'length bars"; length default 12 — the same page row as Highest',
  },
})

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

  /**
   * ⛔⛔ THE ONE DOOR TO THE ENGINE'S TABLE, and every engine name this module
   * emits goes through it — the shapes above, `within`'s `highest`, `crosses`'s
   * `crossOver`/`crossUnder` and `%`'s `mod` alike. A name the table does not
   * declare refuses `:function` HERE rather than being printed into a formula
   * the engine will later fail to parse: the module header promises the lookup
   * happens at translation time, and this is where that promise is kept.
   *
   * ⭐ THE `int` CHECK IS THE REPAINT LINTER'S RULE, NOT THIS MODULE'S TASTE —
   * the same one `pine.js` applies at the same seam. `lint.js::resolveDeclaration`
   * answers UNKNOWN for a window that is not a `num` node, which fails the whole
   * tree closed to `repaints` at the save door. Refusing here names the LENGTH;
   * refusing there would name the badge. ⚠️ A negative literal is `u-` of a
   * positive one, so it is not a `num` node either and lands here too.
   *
   * @param {string} name the ENGINE function
   * @param {Array<{node: object, tok: object}>} args resolved, each with the
   *   token a refusal about it should point at
   */
  engineCall(name, args, tok) {
    if (!has(TABLE.functions, name)) throw refuse('thinkscript:function', tok)
    const spec = TABLE.functions[name]
    if (args.length !== spec.args.length) throw refuse('thinkscript:arity', tok)
    return cCall(name, args.map((a, i) => {
      if (spec.args[i] === 'int'
        && (a.node.type !== 'num' || !Number.isInteger(a.node.value))) {
        throw refuse('thinkscript:window', a.tok || tok)
      }
      return a.node
    }))
  }

  /**
   * A written thinkorswim call → the engine identity its shape declares.
   *
   * ⭐ THE k-TH POSITIONAL FILLS THE k-TH PARAMETER, which is the rule that
   * catches a slot handed two values. "Fill the leftmost FREE slot" reads
   * `Average(close, data = open)` as `sma(open, close)` — a wrong column with no
   * refusal anywhere — because it quietly slides the positional past the slot it
   * was written for. The two rules differ ONLY on that collision, which is
   * exactly the case worth refusing.
   */
  resolveCall(n) {
    // A method's receiver refuses at ITS OWN token first, so
    // `BollingerBands(length = X).LowerBand` names `BollingerBands`; and a method
    // form is never one of these shapes, so it refuses at the method name.
    if (n.base) {
      this.resolve(n.base)
      throw refuse('thinkscript:function', n.tok)
    }
    const shape = TS_CALL_SHAPES[key(n.name)]
    if (!shape) throw refuse('thinkscript:function', n.tok)

    const slots = new Array(shape.params.length).fill(null)
    for (const a of n.args) {
      if (a.name == null) continue
      const i = shape.params.findIndex((p) => key(p) === key(a.name))
      if (i === -1) throw refuse('thinkscript:named-argument', a.nameTok || n.tok)
      if (slots[i]) throw refuse('thinkscript:arity', a.nameTok || n.tok)
      slots[i] = a
    }
    let k = 0
    for (const a of n.args) {
      if (a.name != null) continue
      if (k >= slots.length) throw refuse('thinkscript:arity', n.tok)
      if (slots[k]) throw refuse('thinkscript:arity', a.value.tok || n.tok)
      slots[k] = a
      k += 1
    }

    const filled = slots.map((a, i) => {
      if (a) return { node: this.asNode(this.resolve(a.value), a.value.tok || n.tok), tok: a.value.tok || n.tok }
      const p = shape.params[i]
      if (!has(shape.defaults, p)) throw refuse('thinkscript:arity', n.tok)
      return { node: cNum(shape.defaults[p], n.tok), tok: n.tok }
    })
    return this.engineCall(shape.engine, filled, n.tok)
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
    // ⭐ `%` IS THE ENGINE'S `mod`, A FUNCTION RATHER THAN AN OPERATOR, so it
    // goes through the same door a written call does. thinkorswim's Arithmetic
    // Operators page reads `%` → "remainder"; `closedTable.json` reads `mod` →
    // "the remainder of {0} divided by {1}". One identity, and the printed text
    // names the function a member can then read back in the formula box.
    if (n.op === '%') {
      return this.engineCall('mod', [{ node: a, tok: n.tok }, { node: b, tok: n.tok }], n.tok)
    }
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
      case 'call': return this.resolveCall(n)
      // ⭐ `x between a and b` → `(x >= a) && (x <= b)`, INCLUSIVE BOTH ENDS,
      // because the reference's own words are *"within the range of value1 and
      // value2 (inclusive)"*. ⚠️ `x` appears in both halves as the SAME node
      // object: the budget counts DISTINCT subtrees, so sharing costs nothing,
      // and every walker in this engine reads trees rather than mutating them.
      case 'between': {
        const x = this.asNode(this.resolve(n.x), n.tok)
        return cOp('&&', [
          cOp('>=', [x, this.asNode(this.resolve(n.lo), n.tok)]),
          cOp('<=', [x, this.asNode(this.resolve(n.hi), n.tok)]),
        ])
      }
      // ⭐ `<cond> within N bars` → `highest(<cond>, N) > 0`. The reference:
      // *"true at least one time for the given number of bars starting from the
      // current one"* / *"at least one Doji among three candles including the
      // current one"* — and `highest` over a 0/1 column IS that sentence, using
      // a function the shipped table already declares. ⛔ N MUST BE A POSITIVE
      // WHOLE NUMBER once inputs are folded: `within 0 bars` names no window at
      // all, and a length the engine cannot read fails the repaint linter closed.
      case 'within': {
        const cond = this.asNode(this.resolve(n.cond), n.tok)
        const countTok = n.count.tok || n.tok
        const k = literalInteger(this.asNode(this.resolve(n.count), countTok))
        if (k === null || k <= 0) throw refuse('thinkscript:window', countTok)
        return cOp('>', [
          this.engineCall('highest', [
            { node: cond, tok: n.tok }, { node: { type: 'num', value: k }, tok: countTok },
          ], n.tok),
          { type: 'num', value: 0 },
        ])
      }
      // ⭐ `crosses above` / `crosses below` are the reference's *"human-readable
      // version of the Crosses function"*, and this engine's `crossOver` /
      // `crossUnder` are what they name. ⚠️ THE PRIOR-BAR EDGE IS OURS AND IS
      // SAID OUT LOUD in the module header: the page pins "gets higher than",
      // never the inequality on the bar before. ⭐ BARE `crosses` IS "EITHER
      // DIRECTION", and the disjunction of the two named crossings is exactly
      // that sentence rather than a third convention this file invented.
      case 'cross': {
        const a = this.asNode(this.resolve(n.left), n.tok)
        const b = this.asNode(this.resolve(n.right), n.tok)
        const pair = [{ node: a, tok: n.tok }, { node: b, tok: n.tok }]
        if (n.dir === 'above') return this.engineCall('crossOver', pair, n.tok)
        if (n.dir === 'below') return this.engineCall('crossUnder', pair, n.tok)
        return cOp('||', [
          this.engineCall('crossOver', pair, n.tok),
          this.engineCall('crossUnder', pair, n.tok),
        ])
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
