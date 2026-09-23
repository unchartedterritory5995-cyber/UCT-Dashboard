// ⛔ NO REGEX LOOKBEHIND IN PRODUCT CODE — the declared floor is iOS 16.
//
// Safari only learned `(?<=…)` / `(?<!…)` in 16.4. On 16.0–16.3 a regex LITERAL
// with a lookbehind is a SyntaxError when the chunk is parsed, and a bundler that
// lowers it to `new RegExp(…)` moves the throw to the moment the code runs. Either
// way the member gets an error screen. Found 2026-09-23 in
// `pages/desk/TeamSection.jsx`, live since at least 2026-08-24.
//
// ⭐ PARSED, never grepped: a text scan matches comments and prose that NAME the
// construct (this file, mathNodes.js's header). acorn + acorn-jsx is the parser
// `components/screener/reachable.test.js` already uses over the same tree.
// Tests are exempt — they run in Node, never on a phone.
import fs from 'node:fs'
import path from 'node:path'
import { describe, it, expect } from 'vitest'
import { Parser } from 'acorn'
import jsx from 'acorn-jsx'

const SRC = path.resolve(__dirname)
const JsxParser = Parser.extend(jsx())
const LOOKBEHIND = /\(\?<[=!]/

function productFiles(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) {
      if (e.name === '__tests__' || e.name === 'node_modules') continue
      productFiles(p, out)
    } else if (/\.(js|jsx)$/.test(e.name) && !/\.test\.|\.spec\.|^setupTests|^test-utils/.test(e.name)) {
      out.push(p)
    }
  }
  return out
}

function walk(node, visit) {
  if (!node || typeof node.type !== 'string') return
  visit(node)
  for (const key of Object.keys(node)) {
    const v = node[key]
    if (Array.isArray(v)) v.forEach((c) => walk(c, visit))
    else if (v && typeof v.type === 'string') walk(v, visit)
  }
}

export function lookbehindSites(code) {
  const ast = JsxParser.parse(code, { ecmaVersion: 'latest', sourceType: 'module', locations: true })
  const hits = []
  walk(ast, (n) => {
    if (n.type === 'Literal' && n.regex && LOOKBEHIND.test(n.regex.pattern)) hits.push(n.loc.start.line)
    // new RegExp('…') / RegExp('…') with a static pattern
    if ((n.type === 'NewExpression' || n.type === 'CallExpression') && n.callee?.name === 'RegExp') {
      const a = n.arguments?.[0]
      if (a?.type === 'Literal' && typeof a.value === 'string' && LOOKBEHIND.test(a.value)) hits.push(n.loc.start.line)
      if (a?.type === 'TemplateLiteral' && a.quasis.some((q) => LOOKBEHIND.test(q.value.cooked ?? ''))) hits.push(n.loc.start.line)
    }
  })
  return hits
}

describe('no regex lookbehind in product code (iOS 16 floor)', () => {
  it('the detector fires on every form it guards (control)', () => {
    expect(lookbehindSites("const a = 'x'.split(/(?<=[.!?])\\s/)")).toEqual([1])
    expect(lookbehindSites("const b = new RegExp('(?<!x)y')")).toEqual([1])
    expect(lookbehindSites('const c = RegExp(`(?<=${"a"})b`)')).toEqual([1])
    expect(lookbehindSites('// (?<= a comment naming it\nconst d = /(?=x)y/')).toEqual([])
  })

  it('no product file under app/src uses one', () => {
    const files = productFiles(SRC)
    expect(files.length).toBeGreaterThan(500) // non-vacuity: the walk found the app
    const offenders = []
    for (const f of files) {
      const lines = lookbehindSites(fs.readFileSync(f, 'utf8'))
      for (const l of lines) offenders.push(`${path.relative(SRC, f)}:${l}`)
    }
    expect(offenders).toEqual([])
  })
})
