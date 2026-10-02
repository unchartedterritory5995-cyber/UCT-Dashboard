// @vitest-environment node
/**
 * ⛔⛔ Wave 11 (lane 11B): THE FORMULA ENGINE NEVER EVALUATES TEXT.
 *
 * Two independent checks, because each can miss what the other sees:
 *   1. an AST scan of formulaEngine.js (acorn) — no `eval`, no `Function` /
 *      `new Function`, no `setTimeout`/`setInterval` with a string, no dynamic
 *      `import()`, and no computed member access whose key is not a literal or a
 *      plain loop index (the shape `obj[memberText]` would take);
 *   2. a runtime spy — `globalThis.eval` and `globalThis.Function` are replaced
 *      with traps while EVERY shared vector runs, so a call smuggled in through
 *      an alias the scan cannot see still fails.
 * Each check has a CONTROL proving it can fail.
 */
import { describe, it, expect, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import * as acorn from 'acorn'
import vectors from './formulaVectors.json'
import { runCase } from './formulaEngine.vectors.test.js'

const SRC = readFileSync(join(__dirname, 'formulaEngine.js'), 'utf8')

function walk(node, visit) {
  if (!node || typeof node.type !== 'string') return
  visit(node)
  for (const key of Object.keys(node)) {
    const v = node[key]
    if (Array.isArray(v)) v.forEach((child) => walk(child, visit))
    else if (v && typeof v === 'object' && typeof v.type === 'string') walk(v, visit)
  }
}

export function forbiddenConstructs(source) {
  const found = []
  const ast = acorn.parse(source, { ecmaVersion: 'latest', sourceType: 'module', locations: true })
  walk(ast, (n) => {
    const at = n.loc ? ` at line ${n.loc.start.line}` : ''
    if (n.type === 'CallExpression' || n.type === 'NewExpression') {
      const c = n.callee
      const name = c.type === 'Identifier' ? c.name : (c.type === 'MemberExpression' && !c.computed ? c.property.name : null)
      if (['eval', 'Function', 'setTimeout', 'setInterval', 'execScript'].includes(name)) found.push(`${name}()${at}`)
    }
    if (n.type === 'ImportExpression') found.push(`import()${at}`)
    if (n.type === 'Identifier' && (n.name === 'eval' || n.name === 'Function')) found.push(`identifier ${n.name}${at}`)
    if (n.type === 'MemberExpression' && n.computed) {
      // Allowed: a literal key (`s[0]`), or a plain index variable into a
      // string/array the engine built itself (`text[i]`, `digits[keep]`, `arr[k]`).
      const p = n.property
      const ok = p.type === 'Literal' || (p.type === 'Identifier' && ['i', 'k', 'keep'].includes(p.name))
      if (!ok) found.push(`computed member access${at}`)
    }
  })
  return found
}

describe('⛔⛔ the formula engine never evaluates text', () => {
  it('the AST scan finds nothing in formulaEngine.js', () => {
    expect(forbiddenConstructs(SRC)).toEqual([])
  })

  it.each([
    ['eval', 'eval(text)'],
    ['new Function', 'new Function("return 1")'],
    ['Function()', 'Function("return 1")()'],
    ['setTimeout with a string', 'setTimeout("x()", 1)'],
    ['dynamic import', 'import(text)'],
    ['computed access by member text', 'const o = {}; o[text]'],
    ['an alias to eval', 'const e = eval'],
  ])('CONTROL: the scan sees a planted %s', (_label, planted) => {
    expect(forbiddenConstructs(`${SRC}\nexport function planted(text) { ${planted} }\n`).length).toBeGreaterThan(0)
  })
})

describe('⛔⛔ runtime: eval and Function are never reached while the vectors run', () => {
  const realEval = globalThis.eval
  const realFunction = globalThis.Function
  afterEach(() => {
    globalThis.eval = realEval
    globalThis.Function = realFunction
  })

  function trap() {
    const calls = []
    globalThis.eval = (...a) => { calls.push(['eval', a]); throw new Error('eval reached') }
    globalThis.Function = function TrappedFunction(...a) { calls.push(['Function', a]); throw new Error('Function reached') }
    return calls
  }

  it('every shared vector runs with eval and Function trapped, and none is called', () => {
    const calls = trap()
    for (const c of vectors.cases) runCase(c)
    expect(calls).toEqual([])
  })

  it('CONTROL: the trap does catch a call', () => {
    const calls = trap()
    expect(() => globalThis.eval('1')).toThrow('eval reached')
    expect(calls.length).toBe(1)
  })
})
