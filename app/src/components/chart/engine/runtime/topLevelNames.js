// app/src/components/chart/engine/runtime/topLevelNames.js
//
// ⭐ STUDIO R5, half 1 (Indicators backlog 44): A SCRIPT'S TOP-LEVEL NAMES, WITH THEIR LINES.
// "Inspect a bar" derives a probe copy of a member's script that plots each named top-level
// value, so it needs the names the script declares at its top level, in source order, each
// with the 1-based line its name is written on. Re-exported by `serverEntry.js` (the W5 server
// bundle) beside the run, so a page and the service read one function.
//
// ⛔ ONE PARSE, THE ENGINE'S OWN, NEVER A REGEX OVER THE SOURCE: `lexPine` (a comment is no
// token and a string is one `string` token, so neither can read as a declaration) and then
// `blockStatements` (the statement tree both lanes read). Only the TOP level of that tree is
// read: a block's body and a function's body are its `sub`, which is never visited.
//
// WHAT COUNTS (each name at the line of its own token):
//   x = expr                     a plain declaration, an input's included: `len = input.int(14)`
//   float x = expr               a typed one: any run of Pine type words or qualifiers, or a
//   series float x = expr          user type's name, written before the name
//   var x = expr / varip x = expr / var float x = expr
//   [a, b] = f()                 a tuple declaration: each name
//   x = if c … / x = switch s …  a declaration whose value is a block: `x`, and nothing inside it
//   a = 1, b = 2                 several declarations on one line (`blockStatements` splits them)
// WHAT DOES NOT:
//   f(x) => …                    a function (or `method`) definition, and every name in its body
//   x := expr, x += expr         a reassignment declares nothing (`:=` and `+=` lex as their own
//                                tokens, never `=`)
//   any name inside an `if` / `for` / `while` / `switch` block, and a `for` loop's counter
//   `type` / `enum` fields, `indicator(...)` and other call arguments (`title = …` sits inside
//   brackets, never at the statement's top)
//   a comment or a string that reads like a declaration
// A source that does not lex or split answers [] and never throws. Pine refuses a name declared
// twice in one scope, so the list is not de-duplicated: it is what the script wrote.

import { lexPine, blockStatements, findTop, isPunct, boundName } from '../ast/pine.js'

/** The tokens a top-level statement header declares names with, or []. */
function declaredNameTokens(toks) {
  const first = toks[0]
  if (!first) return []
  // ⛔ `for i = 0 to n` has a top-level `=` with only names before it; `i` is the loop's own.
  if (first.kind === 'ident' && first.value === 'for') return []
  const eq = findTop(toks, (t) => isPunct(t, '='))
  if (eq <= 0 || eq >= toks.length - 1) return []
  if (isPunct(first, '[')) {
    // `[a, b] = …`: names and commas only, the bracket closing right before the `=`
    if (!isPunct(toks[eq - 1], ']')) return []
    const names = []
    for (let k = 1; k < eq - 1; k += 1) {
      const t = toks[k]
      if (t.kind === 'ident') names.push(t)
      else if (!isPunct(t, ',')) return []
    }
    return names
  }
  // every token before the `=` a word (`var`, `series`, `float`, a type name, the name itself);
  // the name is the engine's own reading of which word is bound (`boundName`)
  for (let k = 0; k < eq; k += 1) if (toks[k].kind !== 'ident') return []
  const name = boundName(toks, eq)
  return name ? [name] : []
}

/**
 * The names a Pine script declares at its top level, in source order.
 * @param {string} source a Pine script
 * @returns {Array<{name: string, line: number}>} `line` is 1-based; [] for a source that does not parse
 */
export function topLevelNames(source) {
  if (typeof source !== 'string') return []
  let stmts
  try {
    const lexed = lexPine(source)
    stmts = blockStatements(lexed.tokens, lexed.indents, 0)
  } catch {
    return []
  }
  const out = []
  for (const st of stmts || []) {
    for (const tok of declaredNameTokens((st && st.header) || [])) {
      out.push({ name: String(tok.value), line: tok.line })
    }
  }
  return out
}
