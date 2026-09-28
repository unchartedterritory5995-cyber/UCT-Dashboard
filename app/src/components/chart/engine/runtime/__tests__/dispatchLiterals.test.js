// app/src/components/chart/engine/runtime/__tests__/dispatchLiterals.test.js
//
// ─── THE DISPATCH SWITCH'S LITERAL LABELS AGREE WITH `OP` (2026-09-28) ────────
//
// `vm.js`'s dispatch switch was rewritten from `case OP.CONST:` to
// `case /* CONST */ 0:` because V8 builds a jump table only for literal integer
// labels (the measurement is in the comment above the switch). That makes the
// numbers a second spelling of `program.js::OP`, and a second spelling drifts.
// This rail is what stops it drifting SILENTLY: it parses `vm.js` with an AST —
// never a regex over the text — and for the switch whose discriminant is `op`
// asserts, by name:
//   · every label is an integer literal preceded by a `/* NAME */` comment,
//   · `OP[NAME]` equals that literal,
//   · no two cases share a value (JavaScript accepts a duplicate label and the
//     second is unreachable — measured: esbuild warns on one in `ir.js`),
//   · every opcode in `IMPLEMENTED` has a case.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { parse } from 'acorn'

import { OP, IMPLEMENTED, OP_NAME } from '../program.js'

const VM = path.resolve(process.cwd(), 'src/components/chart/engine/runtime/vm.js')

/** The dispatch switch's cases as `{name, value, line}` — or the reason it could not read one. */
function dispatchCases(text) {
  const comments = []
  const ast = parse(text, { ecmaVersion: 'latest', sourceType: 'module', locations: true, onComment: comments })
  let found = null
  const visit = (node) => {
    if (!node || typeof node.type !== 'string' || found) return
    if (node.type === 'SwitchStatement' && node.discriminant.type === 'Identifier'
        && node.discriminant.name === 'op') { found = node; return }
    for (const k of Object.keys(node)) {
      const v = node[k]
      if (Array.isArray(v)) v.forEach(visit)
      else if (v && typeof v.type === 'string') visit(v)
    }
  }
  visit(ast)
  if (!found) return { error: 'no `switch (op)` in vm.js' }
  const cases = []
  for (const c of found.cases) {
    if (c.test === null) continue // `default`
    const line = c.loc.start.line
    if (c.test.type !== 'Literal' || !Number.isInteger(c.test.value)) {
      cases.push({ line, error: `label is not an integer literal (${c.test.type})` })
      continue
    }
    // the block comment that ends immediately before the literal (whitespace only between)
    const before = comments.filter((m) => m.type === 'Block' && m.end <= c.test.start
      && /^\s*$/.test(text.slice(m.end, c.test.start)))
    const tag = before.length ? before[before.length - 1].value.trim() : null
    cases.push({ line, value: c.test.value, name: tag })
  }
  return { cases }
}

describe('⭐ the VM dispatch labels are OP, spelled as literals', () => {
  const { cases, error } = dispatchCases(fs.readFileSync(VM, 'utf8'))

  it('⛔ CONTROL: the parse found the dispatch switch and a case for most of OP', () => {
    expect(error).toBeUndefined()
    // a parse that returned nothing would pass every loop below
    expect(cases.length).toBeGreaterThan(40)
    expect(cases.map((c) => c.name)).toContain('LOAD_LOCAL')
  })

  it('every label is a named integer literal equal to OP[name]', () => {
    const bad = cases.filter((c) => c.error || !c.name || OP[c.name] !== c.value)
      .map((c) => `vm.js:${c.line} ${c.error || `/* ${c.name} */ ${c.value} but OP.${c.name} is ${OP[c.name]}`}`)
    expect(bad).toEqual([])
  })

  it('no two cases share a value', () => {
    const seen = new Map()
    const dup = []
    for (const c of cases) {
      if (seen.has(c.value)) dup.push(`${c.value}: vm.js:${seen.get(c.value)} and vm.js:${c.line}`)
      else seen.set(c.value, c.line)
    }
    expect(dup).toEqual([])
  })

  it('every IMPLEMENTED opcode has a case', () => {
    const have = new Set(cases.map((c) => c.value))
    const missing = [...IMPLEMENTED].filter((v) => !have.has(v)).map((v) => OP_NAME[v])
    expect(missing).toEqual([])
  })

  it('⛔ CONTROL: the check SEES a wrong literal and an unnamed one', () => {
    const src = 'function f(op){ switch (op) { case /* CONST */ 1: break; case 2: break } }'
    const got = dispatchCases(src).cases
    expect(got[0]).toMatchObject({ name: 'CONST', value: 1 })
    expect(OP[got[0].name]).not.toBe(got[0].value)
    expect(got[1].name).toBe(null)
  })
})
