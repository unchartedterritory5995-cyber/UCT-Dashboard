// app/src/components/chart/engine/pineCompareCensus.test.js
//
// ⭐⭐ engine 78 (#1858) (coordinator ruling D1, 2026-11-18) — THE CENSUS OF EVERY `interpret(...)` CALL in the
// shipped app, each with a declared ROLE. A Pine document compares within TradingView's epsilon only when the
// evaluation is handed `pineCompare` (`interpret.js::binaryFor`); a door that builds its own options and
// forgets it evaluates a Pine script with IEEE and nothing else notices ("grep for a name finds one; ask the
// module finds ten"). So every call site is listed here, by an AST walk (never a text search), and:
//   · 'pine'     the file evaluates Pine documents and must carry the document's rule into its options —
//                proved by its naming `semanticsOptsFor` or `pineCompareOptsOf` / `pineCompareOpts`;
//   · 'inherits' the call passes its own caller's options through (`...opts`, a nested evaluation);
//   · 'native'   the call evaluates a member-typed formula or an operator probe, never a Pine document.
// A new call site, a lost one, or a 'pine' file that stops naming the rule turns this red by file.
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { Parser } from 'acorn'
import jsx from 'acorn-jsx'

const ROOT = 'src'
const JsxParser = Parser.extend(jsx())

/** file (relative to app/src) -> { role, calls } */
const DECLARED = Object.freeze({
  'components/chart/engine/astColumns.js': { role: 'pine', calls: 4 },
  'components/chart/engine/objectColumns.js': { role: 'pine', calls: 5 },
  'components/chart/engine/runtimeErrorStop.js': { role: 'pine', calls: 2 },
  'components/chart/engine/ast/pineRuntimeFrontend.js': { role: 'pine', calls: 1 },
  'components/chart/engine/runtime/runtimeColumns.js': { role: 'inherits', calls: 2 },
  // e95 unit 2: +1, `builtinWitnessMask` reads an anchored VWAP's anchor as the chart can know it (`{ ...inner }`)
  // ⭐⭐ U-DAILY (e96): +2, a daily read's child on the daily bars and the tree with its leaves, both on the caller's opts
  'components/chart/engine/ast/interpret.js': { role: 'inherits', calls: 6 },
  'components/chart/engine/lowerTf.js': { role: 'inherits', calls: 1 },
  'components/chart/engine/runtime/lower.js': { role: 'inherits', calls: 1 },
  'components/chart/builder/criteria.js': { role: 'native', calls: 2 },
  'components/chart/builder/toCondition.js': { role: 'native', calls: 1 },
  // the paste worker moved `evaluateFormula` out of `FormulaField.jsx`, verbatim (the member door's worker holds no React)
  'components/chart/builder/evaluateFormula.js': { role: 'native', calls: 1 },
})
/** Does the file USE the document's rule — a call to `semanticsOptsFor` / `pineCompareOptsOf`, or a spread of
 *  `pineCompareOpts` — and not merely import it? (An import alone is what a lost spread leaves behind.) */
function usesPineRule(src) {
  const tree = JsxParser.parse(src, { ecmaVersion: 'latest', sourceType: 'module', allowHashBang: true })
  let used = false
  const visit = (node) => {
    if (used || !node || typeof node.type !== 'string') return
    if (node.type === 'CallExpression' && node.callee && node.callee.type === 'Identifier'
      && (node.callee.name === 'semanticsOptsFor' || node.callee.name === 'pineCompareOptsOf')) used = true
    if (node.type === 'SpreadElement' && node.argument && node.argument.type === 'Identifier'
      && node.argument.name === 'pineCompareOpts') used = true
    for (const k of Object.keys(node)) {
      const v = node[k]
      if (Array.isArray(v)) v.forEach((x) => x && typeof x.type === 'string' && visit(x))
      else if (v && typeof v.type === 'string') visit(v)
    }
  }
  visit(tree)
  return used
}

function walkFiles(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) {
      if (name === 'node_modules' || name === '__tests__' || name === '__fixtures__' || name === '__truth__') continue
      walkFiles(p, out)
    } else if (/\.(js|jsx)$/.test(name) && !/\.(test|measure|spec)\.(js|jsx)$/.test(name)) out.push(p)
  }
  return out
}

function interpretCalls(src) {
  let tree
  try {
    tree = JsxParser.parse(src, { ecmaVersion: 'latest', sourceType: 'module', allowHashBang: true })
  } catch { return null }
  let n = 0
  const visit = (node) => {
    if (!node || typeof node.type !== 'string') return
    if (node.type === 'CallExpression' && node.callee && node.callee.type === 'Identifier' && node.callee.name === 'interpret') n += 1
    for (const k of Object.keys(node)) {
      const v = node[k]
      if (Array.isArray(v)) v.forEach((x) => x && typeof x.type === 'string' && visit(x))
      else if (v && typeof v.type === 'string') visit(v)
    }
  }
  visit(tree)
  return n
}

describe('every interpret() call site in the shipped app has a declared comparison role', () => {
  const found = {}
  const unparsed = []
  for (const f of walkFiles(ROOT)) {
    const src = readFileSync(f, 'utf8')
    if (!/\binterpret\s*\(/.test(src)) continue
    const n = interpretCalls(src)
    const key = relative(ROOT, f).split('\\').join('/')
    if (n === null) { unparsed.push(key); continue }
    if (n > 0) found[key] = n
  }
  it('parses every file that mentions interpret(', () => {
    expect(unparsed).toEqual([])
  })
  it('the census is exactly the declared table (a new call site declares its role here)', () => {
    expect(found).toEqual(Object.fromEntries(Object.entries(DECLARED).map(([k, v]) => [k, v.calls])))
  })
  for (const [file, { role }] of Object.entries(DECLARED)) {
    if (role !== 'pine') continue
    it(`${file} carries the document's comparison rule`, () => {
      expect(usesPineRule(readFileSync(join(ROOT, file), 'utf8'))).toBe(true)
    })
  }
})
