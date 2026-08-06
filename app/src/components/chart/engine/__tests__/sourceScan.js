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
