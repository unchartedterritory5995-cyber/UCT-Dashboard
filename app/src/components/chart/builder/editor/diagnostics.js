// app/src/components/chart/builder/editor/diagnostics.js
//
// ─── A REFUSAL, 1:1 ONTO A LINT MARK ────────────────────────────────────────
//
// ⛔ THE MESSAGE IS THE DOOR'S, VERBATIM, AND THE RANGE IS DERIVED FROM WHAT THE
// DOOR SAID: `line`/`column` (a translator), `index`/`token` (the TC2000 reader),
// `at character N` inside jsep's own sentence, or the token the sentence quotes.
// When none of those is present the whole buffer is marked — a guess about where
// a refusal "probably" is would be a second authority over the door. A rail in
// `diagnostics.test.js` proves no string in this file is a sentence.
//
// ⛔⛔ AND ON A `let` SOURCE A RAW PARSER OFFSET INDEXES TEXT NOBODY TYPED.
// `letPrepass.prepareSource` inlines the bindings before `parseFormula` sees the
// string, so `Expected ) at character 36` counts characters of the REWRITTEN
// text. Measured on this branch: 36 landed inside the second `let` line, where
// nothing is wrong, while the stray `(` the member typed sat at 63. The pre-pass
// returns `lineOffset` for exactly this — `authorLine = inlinedLine + lineOffset`
// — and its header states that column-within-line is NOT recoverable, so a `let`
// buffer is marked by the LINE.
//
// ⛔ IT IS THE POSITION THAT IS MAPPED, NEVER THE SENTENCE. `parse.js` keeps
// jsep's wording unedited because "a rewritten one loses the character offset the
// text box needs", and `FormulaField.jsx` calls that offset the only part a user
// can act on. Rewriting the message here to hide a stale number would take that
// away for every formula, including the ones the number is still right about.

import { prepareSource } from '../../engine/ast/letPrepass'
import { READER_NAME } from '../../engine/ast/dialect'

/** jsep's own offset, inside jsep's own sentence. ⛔ PINNED TO THE MEASURED
 *  WORDING: `parse.js` forwards `err.message` unedited, so a reworded parser
 *  refusal must lose its mark loudly rather than acquire a wrong one. */
const AT_CHARACTER = / at character (\d+)\b/

/** The first name a refusal QUOTES — `"foo"` from the table's resolve guards,
 *  `` `self` `` from the interpreter's, `` `close` `` from the pre-pass's. */
const QUOTED_TOKEN = /"([^"]+)"|`([^`]+)`/

const ESCAPE_RE = /[.*+?^${}()|[\]\\]/g

/** The `pcf.js::READERS` key the `let` pre-pass runs behind. `dialect.js` calls
 *  itself the ONE place this product's dialect names and that reader map's keys
 *  meet, so the name is read off it rather than typed here. */
const NATIVE_READER = READER_NAME.formula

const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n))

/** A string a door actually filled in, or nothing. */
const named = (v) => (typeof v === 'string' && v ? v : null)

/** ⛔ THE DOOR'S OWN FIELD, IN THE DOOR'S OWN ORDER. `evaluateFormula` answers in
 *  `error`; a translator answers in `message`. Neither is composed here. */
function messageOf(refusal) {
  return named(refusal.error) || named(refusal.message)
}

/** A one-character mark at an offset the door named; an end-of-input offset marks
 *  the last character so the mark is visible at all. */
function markAt(offset, token, len) {
  const from = clamp(offset, 0, len)
  if (token) return { from, to: clamp(from + token.length, from, len) }
  if (from >= len && len > 0) return { from: len - 1, to: len }
  return { from, to: clamp(from + 1, from, len) }
}

/** A 1-based line and a 1-based column the door measured on THIS buffer — the
 *  convention `pine.js`'s lexer sets (`i - lineStart + 1`) and the one
 *  `letPrepass` reports its own refusals in. */
function markAtLineColumn(doc, line, column, token, len) {
  const l = doc.line(clamp(line, 1, doc.lines))
  const from = clamp(l.from + column - 1, l.from, l.to)
  if (token) return { from, to: clamp(from + token.length, from, l.to) }
  return markAt(from, null, len)
}

/** The 1-based line of `text` an offset falls on. */
function lineAt(text, offset) {
  const cut = clamp(offset, 0, text.length)
  let line = 1
  for (let i = 0; i < cut; i += 1) if (text[i] === '\n') line += 1
  return line
}

/** The author's line an INLINED offset came from, whole.
 *
 *  ⭐ `letPrepass` removes a PREFIX of whole lines and then keeps every line of
 *  the expression region, blank ones included — which is what makes
 *  `authorLine = inlinedLine + lineOffset` hold across a gap in the formula, and
 *  is why it kept them. Substitution never introduces a newline (a binding's
 *  expression is one line), so the two regions have the same line count.
 *
 *  ⛔ A BLANK LINE CARRIES NO MARK — a zero-width range renders as nothing — so
 *  when the mapping lands on one, the expression region as a whole is what is
 *  left that is still true. */
function markAuthorLine(doc, pre, offset) {
  const l = doc.line(clamp(lineAt(pre.source, offset) + pre.lineOffset, 1, doc.lines))
  if (l.to > l.from) return { from: l.from, to: l.to }
  const first = doc.line(clamp(pre.lineOffset + 1, 1, doc.lines))
  return { from: first.from, to: doc.length }
}

/** The token where the MEMBER typed it — a WHOLE identifier, the same shape
 *  `letPrepass::substitute` matches, so `x.name` and `namex` are not it. */
function markToken(text, name) {
  const re = new RegExp(`(^|[^A-Za-z0-9_.])(${name.replace(ESCAPE_RE, '\\$&')})(?![A-Za-z0-9_])`)
  const m = re.exec(text)
  if (!m) return null
  const from = m.index + m[1].length
  return { from, to: from + name.length }
}

/** What the `let` pre-pass says about this buffer, asked of the door itself.
 *
 *  ⛔ NO SCOPE IS PASSED, BECAUSE THE READ DOOR PASSES NONE. `pcf.js::READERS
 *  .native` calls `prepareSource(source)` with no inputs; handing a scope in here
 *  would let this module see a `let:shadow` the refusal being placed never had —
 *  a second authority over what a source means, in the one file whose whole job
 *  is to repeat what another door already decided.
 *  ⛔ AND IT NEVER THROWS INTO A LINTER: a lint source that raises takes the
 *  gutter down over a formula somebody is halfway through typing. */
function letFacts(text) {
  try {
    return prepareSource(text)
  } catch {
    return null
  }
}

function rangeFor(doc, refusal, message) {
  const text = doc.toString()
  const len = text.length
  const token = named(refusal.token)

  // The pre-pass runs behind the NATIVE reader alone, so its answers apply to a
  // refusal from that lane and to no other: `parsePcf` never sees it, and its
  // `index` already counts the member's own characters. A refusal that names no
  // dialect is a translator's, and a translator measures on the text it was
  // handed — the buffer here.
  const pre = refusal.dialect === undefined || refusal.dialect === NATIVE_READER ? letFacts(text) : null

  // 1. THE PRE-PASS'S OWN REFUSAL, at the token it named in the member's text.
  //    `READERS.native` keeps only its guard and its sentence, so the position is
  //    recovered by asking the same door the same question — and only when it
  //    still refuses for the SAME reason, so nothing here is invented.
  if (pre && pre.ok === false && pre.guard === refusal.guard
      && Number.isInteger(pre.line) && Number.isInteger(pre.column)) {
    return markAtLineColumn(doc, pre.line, pre.column, named(pre.token) || token, len)
  }

  // 2. A door that measured a line and a column on this buffer.
  if (Number.isInteger(refusal.line) && Number.isInteger(refusal.column)) {
    return markAtLineColumn(doc, refusal.line, refusal.column, token, len)
  }

  // 3. The door's own character offset — REMAPPED when bindings were inlined
  //    under it, because then it counts characters nobody typed.
  const at = AT_CHARACTER.exec(message)
  const offset = Number.isInteger(refusal.index) ? refusal.index : (at ? Number(at[1]) : null)
  if (offset !== null) {
    if (pre && pre.ok && pre.bindings.length) return markAuthorLine(doc, pre, offset)
    return markAt(offset, token, len)
  }

  // 4. The token the sentence quotes, where the member typed it. ⭐ THIS ONE
  //    NEEDS NO REMAP: the search runs over the buffer itself, so a name a
  //    binding introduced is found on the `let` line it was written on.
  const quoted = QUOTED_TOKEN.exec(message)
  const name = token || (quoted ? (quoted[1] || quoted[2]) : null)
  if (name) {
    const mark = markToken(text, name)
    if (mark) return mark
  }

  // 5. Nothing the door said locates it, so the whole buffer — never a guess.
  return { from: 0, to: len }
}

/**
 * One refusal → the lint mark that repeats it, or nothing.
 *
 * @param {import('@codemirror/state').Text} doc the buffer the refusal was
 *        measured on. ⚠️ THAT IS THE CONTRACT: every range below is an offset
 *        into this text, so a caller holding a refusal from an older revision
 *        must re-measure rather than mark the newer buffer with it.
 * @param {object|null} refusal an `evaluateFormula` result, or a translator
 *        refusal (`{guard, message, line, column, token}`)
 * @returns {import('@codemirror/lint').Diagnostic[]}
 */
export function toDiagnostics(doc, refusal) {
  if (!refusal || refusal.ok === true) return []
  const message = messageOf(refusal)
  if (!message) return []
  const { from, to } = rangeFor(doc, refusal, message)
  const out = { from, to, severity: 'error', message }
  const guard = named(refusal.guard)
  if (guard) out.source = guard
  return [out]
}
