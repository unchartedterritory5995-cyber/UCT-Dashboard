// app/src/components/chart/engine/__tests__/sourceScan.js
//
// ─── READING SHIPPED SOURCE WITHOUT READING ITS PROSE ───────────────────────
//
// ⭐ THE DEFECT THIS EXISTS FOR, MEASURED TWICE ON THIS BRANCH.
//
//   1. B4 Task 10: writing `stoch::k` in a COMMENT in `readout.js` pushed that
//      file over `enumerationSites`' "four or more indicator ids" floor and the
//      discovery scan flagged it as an unledgered enumeration site. The prose was
//      reworded to make the suite green — which fixed the symptom and left the
//      scan reading prose as if it were code.
//   2. Wave B, the same wave: a mount rail matched `useChartIndicatorBus()` in
//      RAW source, so a mutation that COMMENTED THE CALL OUT survived. A source
//      probe defeated by a comment is not a weaker probe; it is one that answers
//      a different question than the one it is asked.
//
// Both directions matter, and they are opposite. A comment that NAMES a thing
// makes a scan see something that is not there; a comment that HIDES a call makes
// a probe miss something that is. One stripper closes both, which is why it lives
// in one place instead of being re-typed per suite — a predicate in two files is
// exactly the twin this phase is retiring.
//
// ⛔ IT IS NOT A PARSER, AND ITS LIMITS ARE STATED. It tracks five states —
// code, line comment, block comment, string (all three quotes), regex literal —
// and nothing else. It does not understand JSX text, nested template
// substitutions, or ASI. What it guarantees is narrow and sufficient: text
// inside `//` and `/* */` does not reach the caller, and text inside a string,
// a template literal or a regex literal DOES (`ChartsWorkspace`'s frozen
// settings capture is a JSON *string* naming all fifteen sections, and it is a
// real enumeration site — losing it would be the false negative that makes a
// scan worthless).
//
// ⚠️ REGEX LITERALS ARE HANDLED FOR ONE REASON: `/\/\//` and friends. Without
// it, the `//` inside a regex opens a phantom line comment and the rest of that
// line vanishes from the scan. Detection is the standard previous-significant-
// character heuristic (a `/` after an operator or an opening bracket starts a
// regex; a `/` after an identifier, `)`, `]` or a literal is division). Guessing
// WRONG in the "this is division" direction is harmless — the characters are
// copied through either way — so the heuristic only has to be right where a
// regex actually contains a comment opener.

/** Characters after which a `/` begins a REGEX LITERAL rather than a division.
 *  Deliberately conservative: everything not listed is treated as division, and
 *  treating a regex as division is harmless unless it contains `//` or `/*`. */
const REGEX_MAY_FOLLOW = /[=(,:[!&|?{};+\-*%<>~^]/

/**
 * `src` with every `//` and every block comment removed, and everything else —
 * including string, template and regex contents — copied through byte for byte.
 *
 * Line structure is preserved for `//` (the newline survives) and a block
 * comment collapses to a single space, so an identifier that hugged a comment
 * cannot be fused to its neighbour (`foo/*x*\/bar` must not read as `foobar`).
 */
export function stripComments(src) {
  let out = ''
  let i = 0
  const n = src.length
  /** The last non-whitespace character emitted from CODE — the regex heuristic's
   *  only input. Not updated inside strings/comments, because what matters is
   *  the grammatical position, not the raw previous byte. */
  let prevSig = ''

  while (i < n) {
    const c = src[i]
    const d = i + 1 < n ? src[i + 1] : ''

    // ── line comment: drop to the newline, keep the newline ──
    if (c === '/' && d === '/') {
      while (i < n && src[i] !== '\n') i++
      continue
    }

    // ── block comment: collapse to one space ──
    if (c === '/' && d === '*') {
      i += 2
      while (i < n && !(src[i] === '*' && src[i + 1] === '/')) i++
      i += 2
      out += ' '
      continue
    }

    // ── string / template literal: copied VERBATIM, escapes respected ──
    if (c === '"' || c === "'" || c === '`') {
      const quote = c
      out += c
      i++
      while (i < n) {
        if (src[i] === '\\') { out += src[i] + (i + 1 < n ? src[i + 1] : ''); i += 2; continue }
        out += src[i]
        const done = src[i] === quote
        i++
        if (done) break
      }
      prevSig = quote
      continue
    }

    // ── regex literal: copied verbatim, character classes respected ──
    if (c === '/' && REGEX_MAY_FOLLOW.test(prevSig)) {
      out += c
      i++
      let inClass = false
      while (i < n) {
        if (src[i] === '\\') { out += src[i] + (i + 1 < n ? src[i + 1] : ''); i += 2; continue }
        if (src[i] === '\n') break            // an unterminated "regex" was division after all
        if (src[i] === '[') inClass = true
        else if (src[i] === ']') inClass = false
        out += src[i]
        const done = !inClass && src[i] === '/'
        i++
        if (done) break
      }
      prevSig = '/'
      continue
    }

    out += c
    if (!/\s/.test(c)) prevSig = c
    i++
  }
  return out
}

/** Python's comment shapes, stripped; STRING CONTENTS PRESERVED.
 *
 *  ⭐ WHY A SECOND STRIPPER EXISTS AT ALL. Two of the enumeration ledger's rows
 *  are PYTHON and the JS discovery scan walks `app/src/**\/*.jsx?`, so it
 *  structurally cannot see either — a Python enumeration is invisible to it
 *  however many indicator ids it names, which is exactly the shape that turned
 *  seven sites into thirty-two. The Python half of that scan needs the same
 *  code-not-prose guarantee `stripComments` gives the JS half, and it needs it
 *  from ONE place: a predicate re-typed per suite is the twin this phase retires.
 *
 *  ⛔ STRINGS ARE NOT STRIPPED, ON PURPOSE — the same ruling `stripComments`
 *  carries. A Python enumeration lives in dict LITERALS (`INDICATOR_FUNCS`,
 *  `_CASE_COLUMNS`, `_INDICATOR_ALIASES`) whose keys are strings; a stripper that
 *  also dropped string contents would lose every real site, which is the false
 *  negative that makes a scan worthless.
 *
 *  ⛔ TRIPLE-QUOTED DOCSTRINGS ARE STRIPPED. They are where this repo's Python
 *  writes its prose, and `indicator_alert_evaluator.py`'s `alert_catalog`
 *  docstring names plot addresses in running text. Read as code, a docstring is a
 *  false positive that a maintainer can only fix by rewording prose — the exact
 *  symptom fix B4 Task 10 had to undo on the JS side.
 *
 *  ⛔ IT IS NOT A PARSER, AND ITS LIMITS ARE STATED. Four states: code, `#` line
 *  comment, triple-quoted block, single-quoted string. It does not model
 *  f-string substitutions, nested quotes inside a docstring, or implicit line
 *  joins. What it guarantees is narrow and sufficient: text after a `#` and text
 *  inside `"""`/`'''` does not reach the caller, and text inside a `'`/`"` string
 *  DOES.
 *
 *  Newlines are preserved so line numbers survive.
 */
export function stripPyComments(src) {
  let out = ''
  let i = 0
  let mode = 'code'
  let quote = ''
  while (i < src.length) {
    const c = src[i]
    if (mode === 'code') {
      if (c === '#') {
        while (i < src.length && src[i] !== '\n' && src[i] !== '\r') i += 1
        continue
      }
      if (src.startsWith('"""', i) || src.startsWith("'''", i)) {
        quote = src.slice(i, i + 3); mode = 'tri'; i += 3; continue
      }
      if (c === '"' || c === "'") { quote = c; mode = 'str'; out += c; i += 1; continue }
      out += c; i += 1; continue
    }
    if (mode === 'tri') {
      if (src.startsWith(quote, i)) { mode = 'code'; i += 3; continue }
      // ⚠️ CR AND LF BOTH SURVIVE. This worktree stores several files CRLF, and
      // collapsing a `\r` to a space would fuse two lines' worth of stripped
      // prose into one — harmless for the id scan, but it destroys the line
      // numbering this function promises.
      out += (c === '\n' || c === '\r') ? c : ' '
      i += 1; continue
    }
    // mode === 'str'
    if (c === '\\') { out += src.slice(i, i + 2); i += 2; continue }
    out += c
    if (c === quote) mode = 'code'
    i += 1
  }
  return out
}
