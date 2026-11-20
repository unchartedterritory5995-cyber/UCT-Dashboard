// app/src/testing/runtimeGateScope.rail.test.js
//
// ⛔ NO RUNTIME-GATE NARROWING AT MODULE OR DESCRIBE-BODY SCOPE, IN ANY TEST FILE.
//
// The runtime rail (`src/test-setup.js` -> `runtimeGate.js::gateNarrowedOutsideTest`) catches a gate
// narrowed by a hook outside any test. It cannot see a narrowing made while vitest COLLECTS the file
// (module scope, a describe callback's body, a loop or `.forEach` there, a helper called there): that
// runs before the root `beforeAll` grants the gate, so the grant overwrites it before the first diff,
// and every test in the file then runs under the grant while asserting the member's doors. This
// parses every test file under src/ and finds such a call: a name on `GATE_NARROWINGS` (imported
// under any alias, or called on a namespace import), or a local helper that reaches one.
// A narrowing belongs in `asMember({...})` (a beforeEach) or inside a test body.
import fs from 'node:fs'
import path from 'node:path'
import { describe, it, expect } from 'vitest'
import { Parser } from 'acorn'
import jsx from 'acorn-jsx'
import { GATE_NARROWINGS } from './runtimeGate'

const SRC = path.resolve(__dirname, '..')
const JsxParser = Parser.extend(jsx())
const NARROW = new Set(GATE_NARROWINGS)
const SUITES = new Set(['describe', 'suite'])
const DEFERRED = new Set(['it', 'test', 'beforeEach', 'afterEach', 'beforeAll', 'afterAll', 'bench'])
// callbacks these run at once, so a body passed to one at collection runs at collection
const IMMEDIATE = new Set(['forEach', 'map', 'flatMap', 'filter', 'some', 'every', 'reduce', 'find', 'findIndex'])
const isFn = (n) => n && (n.type === 'ArrowFunctionExpression' || n.type === 'FunctionExpression' || n.type === 'FunctionDeclaration')

/** `describe.each(rows)('x', fn)`, `it.skipIf(c)('x', fn)`, `describe.skip(...)` -> the base name. */
function baseName(callee) {
  if (!callee) return null
  if (callee.type === 'Identifier') return callee.name
  if (callee.type === 'CallExpression') return baseName(callee.callee)
  if (callee.type === 'MemberExpression') {
    if (callee.object.type === 'Identifier' && (SUITES.has(callee.object.name) || DEFERRED.has(callee.object.name))) {
      return callee.object.name
    }
    if (callee.object.type === 'MemberExpression' || callee.object.type === 'CallExpression') {
      const b = baseName(callee.object)
      if (b && (SUITES.has(b) || DEFERRED.has(b))) return b
    }
    return callee.property && !callee.computed ? callee.property.name : null
  }
  return null
}

function children(node) {
  const out = []
  for (const k of Object.keys(node)) {
    if (k === 'loc' || k === 'start' || k === 'end') continue
    const v = node[k]
    if (Array.isArray(v)) { for (const c of v) if (c && typeof c.type === 'string') out.push(c) } else if (v && typeof v.type === 'string') out.push(v)
  }
  return out
}

/** Every narrowing call made while the file is COLLECTED: `[{line, name, via?}]`. */
export function narrowingsOutsideTests(code) {
  const ast = JsxParser.parse(code, { ecmaVersion: 'latest', sourceType: 'module', locations: true })
  const local = new Map()       // local identifier -> narrowing name
  const namespaces = new Set()  // `import * as X`
  for (const n of ast.body) {
    if (n.type !== 'ImportDeclaration') continue
    for (const s of n.specifiers) {
      if (s.type === 'ImportNamespaceSpecifier') namespaces.add(s.local.name)
      else if (s.type === 'ImportSpecifier') {
        const imported = s.imported.name || s.imported.value
        if (NARROW.has(imported)) local.set(s.local.name, imported)
      }
    }
  }
  const narrowingOf = (call) => {
    const c = call.callee
    if (c.type === 'Identifier' && local.has(c.name)) return local.get(c.name)
    if (c.type === 'MemberExpression' && !c.computed && c.object.type === 'Identifier'
      && namespaces.has(c.object.name) && NARROW.has(c.property.name)) return c.property.name
    return null
  }
  // pass 1: every named local function -> the narrowings its own body reaches (not its hooks' bodies)
  const helpers = new Map()     // name -> { direct: Set, calls: Set }
  const bodyOf = new Map()
  ;(function collect(node) {
    if (node.type === 'FunctionDeclaration' && node.id) bodyOf.set(node.id.name, node.body)
    if (node.type === 'VariableDeclarator' && node.id.type === 'Identifier' && isFn(node.init)) bodyOf.set(node.id.name, node.init.body)
    for (const c of children(node)) collect(c)
  })(ast)
  for (const [name, body] of bodyOf) {
    const h = { direct: new Set(), calls: new Set() }
    ;(function scan(node) {
      if (node.type === 'CallExpression') {
        const nm = narrowingOf(node)
        if (nm) h.direct.add(nm)
        else if (node.callee.type === 'Identifier' && bodyOf.has(node.callee.name)) h.calls.add(node.callee.name)
        if (DEFERRED.has(baseName(node.callee))) return   // a hook or test registered inside it runs later
      }
      if (node !== body && isFn(node) && node.type === 'FunctionDeclaration') return // its own helper
      for (const c of children(node)) scan(c)
    })(body)
    helpers.set(name, h)
  }
  const reach = (name, seen = new Set()) => {
    if (seen.has(name) || !helpers.has(name)) return new Set()
    seen.add(name)
    const h = helpers.get(name)
    const out = new Set(h.direct)
    for (const c of h.calls) for (const x of reach(c, seen)) out.add(x)
    return out
  }
  // pass 2: walk what runs at collection
  const sites = []
  ;(function walk(node) {
    if (isFn(node)) return                                  // a body that runs later (or never)
    if (node.type === 'CallExpression') {
      const nm = narrowingOf(node)
      if (nm) sites.push({ line: node.loc.start.line, name: nm })
      else if (node.callee.type === 'Identifier' && helpers.has(node.callee.name)) {
        for (const x of reach(node.callee.name)) sites.push({ line: node.loc.start.line, name: x, via: node.callee.name })
      }
      const base = baseName(node.callee)
      if (isFn(node.callee)) walk(node.callee.body)          // an IIFE runs now
      else walk(node.callee)
      for (const a of node.arguments) {
        if (isFn(a)) {
          if (SUITES.has(base) || IMMEDIATE.has(base)) walk(a.body)   // runs at collection
          // DEFERRED (hooks, tests) and unknown wrappers: runs later
        } else walk(a)
      }
      return
    }
    for (const c of children(node)) walk(c)
  })(ast)
  return sites.sort((a, b) => a.line - b.line)
}

function testFiles(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) { if (e.name !== 'node_modules') testFiles(p, out) } else if (/\.test\.(js|jsx|mjs)$/.test(e.name)) out.push(p)
  }
  return out
}

const imp = "import { __resetRuntimeAllowList, setRuntimeCapabilityAdmission as admit } from '../runtimeKill'\n"
  + "import * as K from '../runtimeKill'\nimport { asMember } from './runtimeGate'\n"

describe('narrowingsOutsideTests: planted cases (the rail can say yes)', () => {
  const lines = (code) => narrowingsOutsideTests(imp + code).map((s) => `${s.name}${s.via ? ` via ${s.via}` : ''}`)
  it.each([
    ['module scope', '__resetRuntimeAllowList()', ['__resetRuntimeAllowList']],
    ['a describe body', "describe('d', () => { __resetRuntimeAllowList(); it('t', () => {}) })", ['__resetRuntimeAllowList']],
    ['an aliased import', "describe('d', () => { admit(true) })", ['setRuntimeCapabilityAdmission']],
    ['a namespace import', 'K.__resetRuntimeAllowList()', ['__resetRuntimeAllowList']],
    ['a helper called in a describe body', "function member() { K.__resetRuntimeAllowList() }\ndescribe('d', () => { member() })",
      ['__resetRuntimeAllowList via member']],
    ['a helper calling a helper, at module scope', 'const a = () => __resetRuntimeAllowList()\nconst b = () => a()\nb()',
      ['__resetRuntimeAllowList via b']],
    ['describe.each', "describe.each([1])('d %s', () => { __resetRuntimeAllowList() })", ['__resetRuntimeAllowList']],
    ['a .forEach in a describe body', "describe('d', () => { [1].forEach(() => __resetRuntimeAllowList()) })", ['__resetRuntimeAllowList']],
    ['a loop in a describe body', "describe('d', () => { for (const x of [1]) { __resetRuntimeAllowList() } })", ['__resetRuntimeAllowList']],
    ['an IIFE at module scope', '(() => { __resetRuntimeAllowList() })()', ['__resetRuntimeAllowList']],
  ])('%s is found', (_, code, want) => { expect(lines(code)).toEqual(want) })
})

describe('narrowingsOutsideTests: controls (the rail can say no)', () => {
  it.each([
    ['a beforeEach', "beforeEach(() => { __resetRuntimeAllowList() })"],
    ['a test body', "it('t', () => { __resetRuntimeAllowList() })"],
    ['a describe\'s beforeEach', "describe('d', () => { beforeEach(() => { admit(true) }) })"],
    ['a beforeAll (the runtime rail\'s case, not this one)', "beforeAll(() => { __resetRuntimeAllowList() })"],
    ['a helper only called from a beforeEach', "function member() { __resetRuntimeAllowList() }\nbeforeEach(member)\nbeforeEach(() => member())"],
    ['a helper registering its own beforeEach, called at module scope', "function m() { beforeEach(() => __resetRuntimeAllowList()) }\nm()"],
    ['a test wrapper that defers its body', "describe('d', () => { itNeedsHeld([], 'x', () => { __resetRuntimeAllowList() }) })"],
    ['asMember at module or describe scope', "asMember({ allow: true })\ndescribe('d', () => { asMember({ hkd: true }) })"],
    ['a same-named function that is not the import', "const o = { __resetRuntimeAllowList() {} }\no.__resetRuntimeAllowList()"],
  ])('%s is not', (_, code) => { expect(narrowingsOutsideTests(imp + code)).toEqual([]) })
})

describe('every test file under src/', () => {
  const files = testFiles(SRC)
  it('reads the whole suite, not a corner of it (a rail over nothing passes)', () => {
    expect(files.length).toBeGreaterThan(5000)
    const importing = files.filter((f) => GATE_NARROWINGS.some((n) => fs.readFileSync(f, 'utf8').includes(n)))
    expect(importing.length).toBeGreaterThan(40)
  })
  it('narrows the runtime gate nowhere at module or describe-body scope', () => {
    const found = []
    for (const f of files) {
      const code = fs.readFileSync(f, 'utf8')
      if (!GATE_NARROWINGS.some((n) => code.includes(n))) continue
      for (const s of narrowingsOutsideTests(code)) {
        found.push(`${path.relative(SRC, f).replace(/\\/g, '/')}:${s.line} ${s.name}${s.via ? ` (via ${s.via}())` : ''}`)
      }
    }
    expect(found, 'move each into asMember({...}) (src/testing/runtimeGate.js) or a test body').toEqual([])
  })
})
