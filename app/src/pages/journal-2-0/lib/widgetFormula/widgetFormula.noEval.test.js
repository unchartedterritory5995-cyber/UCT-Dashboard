// @vitest-environment node
/**
 * Task 10.3: THE WIDGET FORMULA TWIN NEVER EVALUATES TEXT (the `formulaEngine.noEval.test.js`
 * pattern, wave 11 lane 11B).
 *
 * Two independent checks, because each can miss what the other sees:
 *   1. an AST scan of widgetFormula.js (acorn): no `eval`, no `Function` / `new Function`, no
 *      `setTimeout` / `setInterval` with a string, no dynamic `import()`, no `__proto__`
 *      assignment (nor `setPrototypeOf`), and no computed member access whose key is anything but
 *      a number literal or a plain index (the shape `obj[parsedName]` would take);
 *   2. a runtime trap: `globalThis.eval` and `globalThis.Function` are replaced while EVERY shared
 *      vector runs, so a call smuggled in through an alias the scan cannot see still fails.
 * Each check has a CONTROL proving it can fail.
 */
import { describe, it, expect, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import * as acorn from 'acorn'
import { runEveryVector } from './test-vectors.js'

const SRC = readFileSync(new URL('./widgetFormula.js', import.meta.url), 'utf8')

/** Names allowed as an index: loop counters and positions the module computes itself. */
const INDEX_NAMES = new Set(['i', 'j', 'k', 'idx', 'mi', 'mid', 'wi', 'found', 'from'])

function walk(node, visit) {
  if (!node || typeof node.type !== 'string') return
  visit(node)
  for (const key of Object.keys(node)) {
    const v = node[key]
    if (Array.isArray(v)) v.forEach((child) => walk(child, visit))
    else if (v && typeof v === 'object' && typeof v.type === 'string') walk(v, visit)
  }
}

/** An index the module computed: a number literal, a plain index name, `this.i`, or one of
 *  those plus or minus a number literal. Never a string literal and never anything parsed. */
function isIndex(p) {
  if (p.type === 'Literal') return typeof p.value === 'number'
  if (p.type === 'Identifier') return INDEX_NAMES.has(p.name)
  if (p.type === 'MemberExpression' && !p.computed) {
    return p.object.type === 'ThisExpression' && p.property.name === 'i'
  }
  if (p.type === 'BinaryExpression' && (p.operator === '+' || p.operator === '-')) {
    return isIndex(p.left) && p.right.type === 'Literal' && typeof p.right.value === 'number'
  }
  return false
}

export function forbiddenConstructs(source) {
  const found = []
  const ast = acorn.parse(source, { ecmaVersion: 'latest', sourceType: 'module', locations: true })
  walk(ast, (n) => {
    const at = n.loc ? ` at line ${n.loc.start.line}` : ''
    if (n.type === 'CallExpression' || n.type === 'NewExpression') {
      const c = n.callee
      const name = c.type === 'Identifier' ? c.name : (c.type === 'MemberExpression' && !c.computed ? c.property.name : null)
      if (['eval', 'Function', 'execScript', 'setPrototypeOf'].includes(name)) found.push(`${name}()${at}`)
      if (['setTimeout', 'setInterval'].includes(name)) found.push(`${name}()${at}`)
    }
    if (n.type === 'ImportExpression') found.push(`import()${at}`)
    if (n.type === 'Identifier' && (n.name === 'eval' || n.name === 'Function')) found.push(`identifier ${n.name}${at}`)
    if (n.type === 'MemberExpression' && n.computed && !isIndex(n.property)) found.push(`computed member access${at}`)
    if (n.type === 'AssignmentExpression' && n.left.type === 'MemberExpression') {
      const p = n.left.property
      const key = n.left.computed ? (p.type === 'Literal' ? p.value : null) : p.name
      if (key === '__proto__') found.push(`__proto__ assignment${at}`)
    }
    if (n.type === 'Property' && !n.computed) {
      const key = n.key.type === 'Identifier' ? n.key.name : n.key.value
      if (key === '__proto__') found.push(`__proto__ literal${at}`)
    }
  })
  return found
}

describe('the widget formula twin never evaluates text', () => {
  it('the AST scan finds nothing in widgetFormula.js', () => {
    expect(forbiddenConstructs(SRC)).toEqual([])
  })

  it('NON-VACUITY: the scan really walks the module (it sees its index reads and its dispatch table)', () => {
    expect(SRC.length).toBeGreaterThan(20000)
    expect(SRC).toContain('const FN = new Map([')
    expect(SRC).toContain('FN.get(name)')
  })

  it.each([
    ['eval', 'eval(text)'],
    ['new Function', 'new Function("return 1")'],
    ['Function()', 'Function("return 1")()'],
    ['setTimeout with a string', 'setTimeout("x()", 1)'],
    ['dynamic import', 'import(text)'],
    ['computed access by member text', 'const o = {}; return o[text]'],
    ['computed access by a string', 'const o = {}; return o["con" + "structor"]'],
    ['__proto__ assignment', 'const o = {}; o.__proto__ = text'],
    ['__proto__ literal', 'return { __proto__: text }'],
    ['setPrototypeOf', 'Object.setPrototypeOf({}, text)'],
    ['an alias to eval', 'const e = eval; return e'],
  ])('CONTROL: the scan sees a planted %s', (_label, planted) => {
    expect(forbiddenConstructs(`${SRC}\nexport function planted(text) { ${planted} }\n`).length).toBeGreaterThan(0)
  })

  it('CONTROL: a plain index read is allowed (the scan is not refusing everything)', () => {
    expect(forbiddenConstructs('export function ok(s, i) { return s[i] + s[i + 1] + s[0] }\n')).toEqual([])
  })
})

describe('runtime: eval and Function are never reached while the vectors run', () => {
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
    const n = runEveryVector()
    expect(calls).toEqual([])
    expect(n).toBeGreaterThan(500)
  })

  it('CONTROL: the trap does catch a call', () => {
    const calls = trap()
    expect(() => globalThis.eval('1')).toThrow('eval reached')
    expect(calls.length).toBe(1)
  })
})
