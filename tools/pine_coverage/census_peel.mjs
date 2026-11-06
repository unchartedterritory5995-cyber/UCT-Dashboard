// tools/pine_coverage/census_peel.mjs
//
// ─── THE CENSUS PEEL'S UNIT IS THE LOGICAL STATEMENT, NOT THE PHYSICAL LINE ───
//
// `coverageMapDoorCensus.measure.test.js` peels a refused script: it neutralises the
// source the door refused and asks the door again, so a script's walls are its whole
// wall list. It used to overwrite ONE physical line with `name = 0.0` (or blank it).
// When that line was part of a multi-line call, or a function's header, the lines
// left behind were then refused as `pine:statement` ("bar_index - 1,",
// "border_color = boxBorderColor,", a body with no header): 76 touches of that wall
// in the 2026-11-02 map, real on 6 scripts (W4-BREAKDOWN section 0, finding 1). The
// same mechanism inflated runtime:function, runtime:unbound, runtime:statement,
// runtime:tuple and runtime:nothing-drawn.
//
// ⭐ THE ENGINE'S OWN GROUPING DECIDES WHAT A STATEMENT IS. `blockStatements`
// (ast/pine.js) is the pass the translator and the runtime front end both read their
// statements through, so a continuation line (inside brackets, after a dangling
// operator, deeper than a statement that has not opened a block) and a block's body
// are exactly the lines the door itself treats as belonging to the refused line. A
// second opinion about "where a statement ends" would be a second authority over one
// value, so this imports the engine's and writes none.
//
// ⛔ MEASUREMENT ONLY. Nothing here decides what the engine supports.
import { lexPine, blockStatements } from '../../app/src/components/chart/engine/ast/pine.js'

const headLine = (st) => st.header[0].line
const headEnd = (st) => st.header[st.header.length - 1].line
const lastLine = (st) => (st.body.length ? st.body[st.body.length - 1].line : headEnd(st))
const opensIf = (st) => st.header.some((t) => t.kind === 'ident' && t.value === 'if')
const isElse = (st) => st.header[0].kind === 'ident' && st.header[0].value === 'else'

/** The statements, innermost last, whose HEADER holds `line`, or whose body does and no
 *  inner statement claims it. Each entry: `{list, i}` (the sibling list and the index). */
function pathTo(list, line) {
  const hits = []
  list.forEach((st, i) => {
    if (st.header && st.header.length && line >= headLine(st) && line <= lastLine(st)) hits.push(i)
  })
  if (!hits.length) return null
  // (several statements on one line, `a = 1, b = f(`: `blockStatements` splits them only when every
  // segment is a binding, and the first is taken)
  const i = hits[0]
  const st = list[i]
  const here = { list, i, st }
  if (line <= headEnd(st) || !(st.sub && st.sub.length)) return [here]
  const inner = pathTo(st.sub, line)
  if (!inner) return [here]
  return [here, ...inner]
}

/**
 * The physical lines of the logical statement that holds `line` (1-based).
 *
 *   * a refused line inside a call/binding wrapped over lines: the whole statement;
 *   * a refused HEADER (a function's, an `if`'s, a loop's): the header and its body;
 *   * a refused statement inside a body: that statement alone ...
 *   * ... unless it is the body's ONLY statement and peeling would leave it blank: an
 *     emptied block is no program (`a body with no statements`), so its header goes too;
 *   * an `if` takes its `else` / `else if` clauses with it (`else with no if` was a
 *     peeled `if` line).
 *
 * @param {(line: string) => ({indent: string, name: string}|null)} [bindingNameOf]
 *   decides whether a peeled first line would be left blank (needed only by the
 *   emptied-block rule; without it the rule never fires)
 * @returns {{start: number, end: number}} inclusive; `{start: line, end: line}` when the
 *   source cannot be grouped (a lexer throw, a line that holds no token such as a
 *   comment), which is the old one-line behaviour and never a wider guess.
 */
export function statementSpanOf(source, line, bindingNameOf) {
  const one = { start: line, end: line }
  try {
    const lexed = lexPine(source)
    const stmts = blockStatements(lexed.tokens, lexed.indents, 0)
    const path = pathTo(stmts, line)
    if (!path) return one
    const span = (st) => ({ start: headLine(st), end: lastLine(st) })
    const rows = source.split(/\r?\n/)
    let depth = path.length - 1
    // an emptied block takes its header: the node is the sole statement of its list and
    // its first line would be left blank (it binds no name)
    while (depth > 0 && path[depth].list.length === 1
      && !(bindingNameOf && bindingNameOf(rows[headLine(path[depth].st) - 1] || ''))) {
      depth -= 1
    }
    const { list, i } = path[depth]
    const first = span(list[i])
    let end = first.end
    if (opensIf(list[i])) {
      for (let k = i + 1; k < list.length && isElse(list[k]); k += 1) end = Math.max(end, lastLine(list[k]))
    }
    return { start: first.start, end }
  } catch {
    return one
  }
}

/**
 * Neutralise the logical statement that holds `line`, in place on `work` (an array of
 * physical lines). The statement's FIRST line keeps a binding's name as `x = 0.0` (the
 * rule `peelToBuilding.js` measured) and is otherwise blanked; every other line of the
 * statement is blanked.
 *
 * @param {string[]} work
 * @param {number} line 1-based
 * @param {(line: string) => ({indent: string, name: string}|null)} bindingNameOf
 * @param {string} [snapshot] the program the span is read from (default: `work` as it stands);
 *   a caller peeling several lines of one refusal reads every span off the same program
 * @returns {boolean} whether the program changed
 */
export function peelStatement(work, line, bindingNameOf, snapshot) {
  const src = snapshot == null ? work.join(String.fromCharCode(10)) : snapshot
  const { start, end } = statementSpanOf(src, line, bindingNameOf)
  let changed = false
  for (let n = start; n <= end && n <= work.length; n += 1) {
    let next = ''
    if (n === start) {
      const b = bindingNameOf(work[n - 1])
      next = b ? `${b.indent}${b.name} = 0.0` : ''
    }
    if (work[n - 1] !== next) { work[n - 1] = next; changed = true }
  }
  return changed
}
