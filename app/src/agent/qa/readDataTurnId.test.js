// agent-qa — every Agent call to the MD-1 browser door passes the CURRENT turn's id (requested by agent-lead).
//
// The gateway's per-turn budget (MD-1 §5: 8 reads, 1 scan, 20 provider requests) is keyed by `turn_id`. A caller that
// passes a literal ('t1'), a self-minted id (crypto.randomUUID(), Date.now()) or nothing at all either refuses every
// read or gets a fresh budget per read — the cap silently stops capping. The only legitimate source is
// `currentTurnId()` from app/src/agent/trace.js, called at the read.
//
// The rule, checked from an acorn AST over every non-test module under app/src (never a grep: `readData` is ALSO the
// name of unrelated local helpers in app/src/lib, which is exactly why names are resolved through imports):
//   * a call to `readData` imported from agent/marketdata/client(.js) — by name, alias or namespace —
//     passes a third argument that is an object literal with `turnId: currentTurnId()`, where `currentTurnId` is
//     itself imported from agent/trace(.js) (by name, alias or namespace), called with no arguments;
//   * `readData` is never used as a value (passed, stored, re-exported): an indirect call cannot be checked.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { Parser } from 'acorn'
import jsx from 'acorn-jsx'

const SRC = path.resolve(__dirname, '../..')                    // app/src
const CLIENT = path.join(SRC, 'agent', 'marketdata', 'client.js')
const TRACE = path.join(SRC, 'agent', 'trace.js')
const parse = (src) => Parser.extend(jsx()).parse(src, { ecmaVersion: 'latest', sourceType: 'module', locations: true })

function walk(node, visit, anc = []) {
  if (!node || typeof node !== 'object') return
  if (Array.isArray(node)) { node.forEach((n) => walk(n, visit, anc)); return }
  if (typeof node.type === 'string') visit(node, anc[anc.length - 1] || null, anc)
  const next = typeof node.type === 'string' ? [...anc, node] : anc
  for (const [k, v] of Object.entries(node)) if (k !== 'loc' && v && typeof v === 'object') walk(v, visit, next)
}
const FN = new Set(['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression'])

function resolves(fromFile, spec, target) {
  if (!spec.startsWith('.')) return false
  const base = path.resolve(path.dirname(fromFile), spec)
  return [base, `${base}.js`, `${base}.jsx`, path.join(base, 'index.js')].some(p => path.normalize(p) === path.normalize(target))
}

/** Violations as `file:line  why`. `file` is an absolute path (it decides how relative imports resolve). */
export function readDataTurnIdViolations(src, file) {
  const ast = parse(src)
  const rd = new Set(); const rdNs = new Set(); const ct = new Set(); const ctNs = new Set()
  const out = []
  const rel = path.relative(SRC, file).split(path.sep).join('/')
  const at = (n, why) => out.push(`${rel}:${n.loc.start.line}  ${why}`)
  for (const st of ast.body) {
    if (st.type === 'ImportDeclaration') {
      const isClient = resolves(file, st.source.value, CLIENT); const isTrace = resolves(file, st.source.value, TRACE)
      for (const s of st.specifiers) {
        if (isClient && s.type === 'ImportSpecifier' && s.imported.name === 'readData') rd.add(s.local.name)
        if (isClient && s.type === 'ImportNamespaceSpecifier') rdNs.add(s.local.name)
        if (isTrace && s.type === 'ImportSpecifier' && s.imported.name === 'currentTurnId') ct.add(s.local.name)
        if (isTrace && s.type === 'ImportNamespaceSpecifier') ctNs.add(s.local.name)
      }
    }
    if ((st.type === 'ExportAllDeclaration' || st.type === 'ExportNamedDeclaration') && st.source
        && resolves(file, st.source.value, CLIENT)) at(st, 're-exports the MD-1 client: its callers cannot be checked')
  }
  if (!rd.size && !rdNs.size) return out
  const isRd = (n) => (n.type === 'Identifier' && rd.has(n.name))
    || (n.type === 'MemberExpression' && !n.computed && n.object.type === 'Identifier' && rdNs.has(n.object.name)
        && n.property.name === 'readData')
  const isCurrentTurnIdCall = (v) => v && v.type === 'CallExpression' && v.arguments.length === 0 && (
    (v.callee.type === 'Identifier' && ct.has(v.callee.name))
    || (v.callee.type === 'MemberExpression' && !v.callee.computed && v.callee.object.type === 'Identifier'
        && ctNs.has(v.callee.object.name) && v.callee.property.name === 'currentTurnId'))
  const calls = new Set()
  // `const id = currentTurnId()` in the SAME function as the read, never reassigned (const), is the id itself: it lets
  // the caller say something kinder than the client's own refusal when no turn is open. A wrapper is NOT accepted.
  const isTurnConst = (v, anc) => {
    if (!v || v.type !== 'Identifier') return false
    const fn = [...anc].reverse().find(a => FN.has(a.type))
    if (!fn) return false            // a module-level const is read ONCE, at import: never the current turn
    let ok = false
    walk(fn.body, (d) => {
      if (d.type === 'VariableDeclaration' && d.kind === 'const') {
        for (const x of d.declarations) if (x.id.type === 'Identifier' && x.id.name === v.name && isCurrentTurnIdCall(x.init)) ok = true
      }
    })
    return ok
  }
  walk(ast, (n, _parent, anc) => {
    if (n.type !== 'CallExpression' || !isRd(n.callee)) return
    calls.add(n.callee)
    const opt = n.arguments[2]
    if (!opt) return at(n, 'readData called without options: no turnId')
    if (opt.type !== 'ObjectExpression') return at(n, 'readData options are not an object literal: turnId cannot be checked')
    if (opt.properties.some(p => p.type === 'SpreadElement')) return at(n, 'readData options spread another object: turnId cannot be checked')
    const t = opt.properties.find(p => !p.computed && (p.key.name === 'turnId' || p.key.value === 'turnId'))
    if (!t) return at(n, 'readData called without turnId')
    if (!isCurrentTurnIdCall(t.value) && !isTurnConst(t.value, anc)) at(n, `turnId is not currentTurnId() from agent/trace (${src.slice(t.value.start, t.value.end)})`)
  })
  walk(ast, (n, parent) => {                                    // any other use of the binding is a value use
    if (!isRd(n) || calls.has(n)) return
    if (n.type === 'Identifier' && parent && (parent.type === 'ImportSpecifier' || (parent.type === 'MemberExpression' && parent.property === n))) return
    if (n.type === 'Identifier' && parent && parent.type === 'MemberExpression' && isRd(parent)) return
    at(n, 'readData used as a value (passed, stored or re-exported): the call it makes cannot be checked')
  })
  return out
}

function sourceFiles(dir, acc = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) {
      if (e.name === 'node_modules' || e.name === '__fixtures__' || e.name === 'testing') continue
      sourceFiles(p, acc)
    } else if (/\.(js|jsx|mjs)$/.test(e.name) && !/\.test\.|\.spec\./.test(e.name)) acc.push(p)
  }
  return acc
}

const at = (rel) => path.join(SRC, ...rel.split('/'))

describe('agent-qa: every Agent readData call passes currentTurnId()', () => {
  it('no module under app/src calls the MD-1 client with anything but the current turn id', () => {
    const files = sourceFiles(SRC)
    expect(files.length).toBeGreaterThan(500)                      // non-vacuity: the walk reached the app
    expect(fs.existsSync(CLIENT) && fs.existsSync(TRACE)).toBe(true)
    const bad = []; let importers = 0
    for (const f of files) {
      if (path.normalize(f) === path.normalize(CLIENT)) continue
      const src = fs.readFileSync(f, 'utf8')
      if (!src.includes('marketdata/client')) continue
      importers += 1
      bad.push(...readDataTurnIdViolations(src, f))
    }
    expect(bad, bad.join('\n')).toEqual([])
    // `importers` is 0 on agent/int today: no capability calls readData yet (F-1). The real-file and control cases
    // below are what make this rail non-vacuous; the count is printed so a reader sees which state it is in.
    console.info(`[agent-qa] modules importing the MD-1 client (excluding tests): ${importers}`)
  })

  it('resolves a REAL importer: agentData.test.js imports readData from the client', () => {
    const f = at('agent/agentData.test.js')
    const src = fs.readFileSync(f, 'utf8')
    expect(src).toMatch(/marketdata\/client/)
    // it calls readData with literal ids on purpose (it tests the client itself), so the detector must SEE them
    expect(readDataTurnIdViolations(src, f).length).toBeGreaterThan(0)
  })

  const CAP = at('agent/capabilities/qaExample.js')               // a virtual capability file (never written)
  const head = "import { readData } from '../marketdata/client'\nimport { currentTurnId } from '../trace'\n"
  it.each([
    ['the canonical form', `${head}export const f = () => readData('quote', { symbol: 'SPY' }, { purpose: 'answer', turnId: currentTurnId() })`],
    ['aliases', "import { readData as rd } from '../marketdata/client.js'\nimport { currentTurnId as tid } from '../trace.js'\nrd('quote', {}, { turnId: tid() })"],
    ['a const from currentTurnId() in the same function (null-checked)', `${head}export async function f() { const turnId = currentTurnId(); if (!turnId) return null; return readData('quote', {}, { purpose: 'answer', turnId }) }`],
    ['namespaces', "import * as md from '../marketdata/client'\nimport * as tr from '../trace'\nmd.readData('quote', {}, { turnId: tr.currentTurnId() })"],
    ['an unrelated local readData', "const readData = (e) => JSON.parse(e.data)\nreadData({ data: '{}' })"],
  ])('ACCEPTS %s', (_, src) => {
    expect(readDataTurnIdViolations(src, CAP)).toEqual([])
  })
  it.each([
    ['a literal turn id', `${head}readData('quote', {}, { turnId: 't1' })`],
    ['a self-minted id', `${head}readData('quote', {}, { turnId: crypto.randomUUID() })`],
    ['Date.now()', `${head}readData('quote', {}, { turnId: String(Date.now()) })`],
    ['no options', `${head}readData('quote', {})`],
    ['options without turnId', `${head}readData('quote', {}, { purpose: 'scan' })`],
    ['a let holding the id', `${head}export async function f() { let id = currentTurnId(); id = 'x'; return readData('quote', {}, { turnId: id }) }`],
    ['a const from a WRAPPER', `${head}const t = () => currentTurnId()\nexport async function f() { const id = t(); return readData('quote', {}, { turnId: id }) }`],
    ['a const in ANOTHER function', `${head}const id = 'x'\nfunction g() { const id = currentTurnId(); return id }\nexport async function f() { return readData('quote', {}, { turnId: id }) }`],
    ['a MODULE-level const (read once at import)', `${head}const id = currentTurnId()
readData('quote', {}, { turnId: id })`],
    ['shorthand with a minted id', `${head}export async function f() { const turnId = Math.random(); return readData('quote', {}, { turnId }) }`],
    ['a spread', `${head}const o = { turnId: currentTurnId() }\nreadData('quote', {}, { ...o })`],
    ['a currentTurnId from elsewhere', "import { readData } from '../marketdata/client'\nconst currentTurnId = () => 'x'\nreadData('quote', {}, { turnId: currentTurnId() })"],
    ['readData passed as a value', `${head}const run = (fn) => fn('quote', {}, {})\nrun(readData)`],
    ['a re-export', "export { readData } from '../marketdata/client'"],
  ])('REFUSES %s', (_, src) => {
    expect(readDataTurnIdViolations(src, CAP).length).toBeGreaterThan(0)
  })
})
