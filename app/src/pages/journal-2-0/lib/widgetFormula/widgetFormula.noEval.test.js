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
import { DOC, runEveryVector } from './test-vectors.js'

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
      if (['eval', 'Function', 'execScript', 'setPrototypeOf', 'constructor'].includes(name)) found.push(`${name}()${at}`)
      if (['setTimeout', 'setInterval'].includes(name)) found.push(`${name}()${at}`)
    }
    if (n.type === 'ImportExpression') found.push(`import()${at}`)
    if (n.type === 'Identifier' && (n.name === 'eval' || n.name === 'Function')) found.push(`identifier ${n.name}${at}`)
    if (n.type === 'MemberExpression' && n.computed && !isIndex(n.property)) found.push(`computed member access${at}`)
    // `x.constructor` reaches Function from any value (`x.constructor.constructor("code")()`).
    if (n.type === 'MemberExpression' && !n.computed && n.property.name === 'constructor') found.push(`.constructor${at}`)
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
    ['the constructor chain', 'return x.constructor.constructor("1")()'],
    ['a constructor read without a call', 'const F = x.constructor; return F'],
    ['a bare constructor() call', 'return constructor("1")'],
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

// ---------------------------------------------------------------------------------------------
// Every invisible or refused character in the module is written as an escape, never raw: a raw
// one cannot be seen in review, and an editor or a line-ending pass can change it silently. The
// ranges are read from the shared vector file's own conventions (forbidden_characters and the
// shown_text invisible list), never retyped here; tab and newline are source whitespace.

function rangesFrom(text) {
  const out = []
  for (const m of text.matchAll(/U\+([0-9A-F]{4,6})(?:-([0-9A-F]{4,6}))?/g)) {
    out.push([parseInt(m[1], 16), parseInt(m[2] || m[1], 16)])
  }
  return out
}

const INVISIBLE = [
  ...rangesFrom(DOC.conventions.forbidden_characters),
  ...rangesFrom(DOC.conventions.shown_text),
]

export function rawInvisibles(source) {
  const found = []
  let line = 1
  for (const ch of source) {
    const o = ch.codePointAt(0)
    if (ch === '\n') { line += 1; continue }
    if (ch === '\t') continue
    if (INVISIBLE.some(([lo, hi]) => lo <= o && o <= hi)) found.push(`U+${o.toString(16).toUpperCase().padStart(4, '0')} at line ${line}`)
  }
  return found
}

describe('no raw invisible or refused character in the module source', () => {
  it('the source holds none: each one is written as an escape', () => {
    expect(rawInvisibles(SRC)).toEqual([])
  })

  it('NON-VACUITY: the ranges were read from the contract, and the escapes are really there', () => {
    expect(INVISIBLE.length).toBeGreaterThan(20)
    for (const o of [0x200D, 0xFE0F, 0x20E3, 0x2028, 0x00A0, 0xE0001]) {
      expect(INVISIBLE.some(([lo, hi]) => lo <= o && o <= hi), o.toString(16)).toBe(true)
    }
    const bs = String.fromCharCode(92)
    for (const esc of ['u200D', 'uFE0F', 'u20E3', 'u2028', 'uFFFD']) expect(SRC).toContain(bs + esc)
  })

  it.each([['a zero-width joiner', 0x200D], ['a variation selector', 0xFE0F], ['a line separator', 0x2028],
    ['a no-break space', 0x00A0], ['a tag character', 0xE0041]])('CONTROL: a raw %s is caught', (_l, o) => {
    expect(rawInvisibles(`${SRC}\nconst planted = '${String.fromCodePoint(o)}'\n`).length).toBe(1)
  })
})
