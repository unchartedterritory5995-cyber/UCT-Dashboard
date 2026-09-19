// app/src/components/chart/engine/ast/twoTreeLanguages.test.js
//
// ─── ⚰️⚰️ TWO TREE LANGUAGES, FOUR LETTERS APART ────────────────────────────
//
// This module carries two node vocabularies and they are easy to mistake for one:
//
//   PARSE tree   `{ type: 'number', value, tok }`   what `parsePrimary` emits
//                `{ type: 'unary', op: '-', arg }`   and what `resolve` READS
//   OUTPUT tree  `{ type: 'num', value }`            what `cNum` emits
//                `{ type: 'op', name: 'u-', args }`  and what `foldScalar` reads
//
// ⚰️ THE INCIDENT. a3's `substConst` rewrites a parse tree, replacing the loop
// variable with its constant — and it wrote `{type:'num'}`, the OUTPUT spelling.
// `resolve`'s switch has `case 'number'` and no `case 'num'`, so every rewritten
// index fell off the end of that switch, threw `pine:statement`, was swallowed by
// the fold's catch and came back `null`. No slot was ever written, all 21 of
// Uncharted Clouds' layers rendered `na`, and the translation reported `ok` with
// ZERO refusals for a whole session.
//
// ⛔ THE FAILURE IS SILENT BY CONSTRUCTION, which is why it needs a rail rather
// than care. An unknown node type does not crash: it raises the generic
// `pine:statement`, and every constant-fold in this file catches and returns null
// because a thing that will not fold is ordinarily just not a constant.
//
// ⭐ BOTH VOCABULARIES ARE READ OUT OF THE SOURCE, never typed here. A rail that
// restated either list would be the second authority over it, and would go stale
// in exactly the way it exists to prevent.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { NODE_TYPES } from './parse.js'

const PINE = fs.readFileSync(path.resolve(__dirname, 'pine.js'), 'utf8')

/** The body of a `{ … }` block, by brace matching from the first `{` after `at`. */
function blockAt(src, at) {
  const open = src.indexOf('{', at)
  let depth = 0
  for (let i = open; i < src.length; i++) {
    if (src[i] === '{') depth += 1
    else if (src[i] === '}') { depth -= 1; if (depth === 0) return src.slice(open + 1, i) }
  }
  throw new Error('unbalanced block')
}

/** `case 'x':` labels of the switch inside `resolve(node)`. */
function resolveCases() {
  const at = PINE.indexOf('\n  resolve(node) {')
  expect(at, '`resolve(node)` is no longer declared as expected').toBeGreaterThan(0)
  const body = blockAt(PINE, at)
  return new Set([...body.matchAll(/case\s+'([a-z_]+)'/g)].map((m) => m[1]))
}

/** `type: 'x'` literals CONSTRUCTED inside one named function. */
function typesWrittenBy(name) {
  const at = PINE.indexOf(`function ${name}(`)
  expect(at, `${name} is no longer declared`).toBeGreaterThan(0)
  const body = blockAt(PINE, at)
  return new Set([...body.matchAll(/type:\s*'([a-z_]+)'/g)].map((m) => m[1]))
}

describe('the parse language and the output language stay apart', () => {
  it('⛔⛔ every node type `substConst` writes has a `case` in `resolve`', () => {
    // substConst is the ONE function that splices freshly-built nodes into a tree
    // the resolver will walk, so it is the one place the two languages can meet by
    // accident. This is the exact assertion a3 shipped broken.
    const cases = resolveCases()
    const written = typesWrittenBy('substConst')
    expect(written.size, 'substConst constructs no nodes at all — did it move?')
      .toBeGreaterThan(0)
    const unhandled = [...written].filter((ty) => !cases.has(ty))
    expect(unhandled,
      `substConst writes ${JSON.stringify(unhandled)} into a parse tree, and `
      + '`resolve` has no case for it — the node will raise pine:statement and be '
      + 'swallowed by a constant-fold, exactly as in the a3 incident')
      .toEqual([])
  })

  it('⭐⭐ the two vocabularies OVERLAP in exactly two names, and that is the trap', () => {
    // `call` and `offset` are spelled the same in both languages, which is why the
    // split reads as one language at a glance: a reader who checks two node kinds
    // finds them handled and concludes the vocabularies match.
    const cases = resolveCases()
    const shared = NODE_TYPES.filter((ty) => cases.has(ty)).sort()
    expect(shared).toEqual(['call', 'offset'])

    // …and the rest of the OUTPUT language is deliberately absent from `resolve`.
    // If a future change adds one of these cases, the languages are being merged
    // and this file's premise needs revisiting — which is the point of pinning it.
    const absent = NODE_TYPES.filter((ty) => !cases.has(ty))
    expect(absent).toContain('num')
    expect(absent).toContain('series')
  })

  it('⛔ `number` and `num` are BOTH live — neither is a typo for the other', () => {
    // The cheapest possible misreading is "one of these is a leftover". Both are
    // constructed, in different languages, and a rail that let one disappear would
    // hide the merge rather than catch it.
    const cases = resolveCases()
    expect(cases.has('number'), 'the parse language spells a literal `number`').toBe(true)
    expect(NODE_TYPES).toContain('num')
    expect(cases.has('num'), 'the output spelling must NOT be a resolve case').toBe(false)
  })

  it('⛔⛔ CONTROL — the checker SEES a planted mismatch', () => {
    // Without this, a `typesWrittenBy` that silently returned an empty set would
    // make the first case pass forever. It is the same shape as the six recorded
    // instances in this repo of a literal-hunting check that matched nothing.
    const cases = resolveCases()
    expect(cases.size, 'resolve has no cases — the extractor is broken').toBeGreaterThan(5)

    const planted = new Set(['number', 'num'])
    const unhandled = [...planted].filter((ty) => !cases.has(ty))
    expect(unhandled, 'the membership test must reject the output spelling')
      .toEqual(['num'])
  })

  it('⛔ CONTROL — the block matcher returns a real body, not the whole file', () => {
    const at = PINE.indexOf('\n  resolve(node) {')
    const body = blockAt(PINE, at)
    expect(body.length).toBeGreaterThan(200)
    expect(body.length, 'the matcher ran off the end of the function')
      .toBeLessThan(PINE.length / 2)
  })
})
