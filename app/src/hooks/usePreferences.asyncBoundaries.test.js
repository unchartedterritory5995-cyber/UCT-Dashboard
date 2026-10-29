// ⛔⛔ THE STRUCTURAL RAIL: every async boundary in usePreferences.js checks the member first.
//
// Four reviews in a row found one more door through which a step that ran AFTER a change of member
// put the previous member's data into the next member's cache or account: a merge stamped after
// awaiting a read, a setPref queued behind a POST, refreshPreferences, the fetcher's side effects,
// postPref's answer, mergeIntoPreferenceCache. Fixing doors one at a time is how the next one is
// missed, so this rail parses the module (an AST, never a grep) and fails on ANY boundary that does
// not begin with a stale check before its next side effect:
//
//   - an `await` — the statement after it (climbing out of `if`/`try` blocks that end with it) must
//     be `if (op.stale()) …`, or nothing may follow it in its function, or it is a `return`;
//   - a `catch` around an `await` — its body must begin with the stale check, or do nothing;
//   - a `.then(…)` / `.catch(…)` callback, a `setTimeout` callback, an SWR cache updater passed to
//     `mutate` / `mutateGlobal` — the function must begin with the stale check.
//
// A boundary that genuinely needs no check is listed in ALLOWED with the reason, keyed by its
// enclosing function and source text, so a NEW unguarded boundary fails by name.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { Parser } from 'acorn'
import jsx from 'acorn-jsx'

const SRC_PATH = join(process.cwd(), 'src', 'hooks', 'usePreferences.js')

const ALLOWED = {
  'fetcher|then|p.then(clear, clear)':
    'identity-guarded: clears _inflightRead only while it is still this very read; touches no member data',
  'whenWritesSettle|then|Promise.all((keys || []).map(k => _writeChains.get(k) || Promise.resolve())).then(() => undefined)':
    'resolves to undefined; no side effect',
  'queueWrite|then|previous.then(task)':
    'task is always postPref(…, op), whose first statement is the stale check',
  'postPref|catch-body|catch { d = null }':
    'assigns a local; the stale check follows the try statement',
  'refreshPreferences|catch-body|catch {\n    return null\n  }':
    'returns null; touches nothing',
}

function parse(src) {
  return Parser.extend(jsx()).parse(src, { ecmaVersion: 'latest', sourceType: 'module', locations: true })
}

const isFn = (n) => n && (n.type === 'FunctionDeclaration' || n.type === 'FunctionExpression' || n.type === 'ArrowFunctionExpression')
const containsStaleCall = (node, src) => /\.stale\(\)/.test(src.slice(node.start, node.end))
const isStaleIf = (stmt, src) => !!stmt && stmt.type === 'IfStatement' && containsStaleCall(stmt.test, src)

/** A function begins with the stale check (block body: first statement; expression body: a
 *  conditional whose test is the stale check). An empty function does nothing and passes. */
function fnBeginsWithCheck(fn, src) {
  if (fn.body.type === 'BlockStatement') {
    if (!fn.body.body.length) return true
    return isStaleIf(fn.body.body[0], src)
  }
  return fn.body.type === 'ConditionalExpression' && containsStaleCall(fn.body.test, src)
}

/** Walk with parents. */
function walk(node, visit, parents = []) {
  if (!node || typeof node.type !== 'string') return
  visit(node, parents)
  for (const k of Object.keys(node)) {
    if (k === 'loc' || k === 'start' || k === 'end') continue
    const v = node[k]
    if (Array.isArray(v)) v.forEach((c) => walk(c, visit, [...parents, node]))
    else if (v && typeof v.type === 'string') walk(v, visit, [...parents, node])
  }
}

function enclosingFnName(parents) {
  for (let i = parents.length - 1; i >= 0; i -= 1) {
    const p = parents[i]
    if (p.type === 'FunctionDeclaration' && p.id) return p.id.name
    if (p.type === 'VariableDeclarator' && p.id?.name && isFn(p.init)) return p.id.name
    if (p.type === 'ExportNamedDeclaration' && p.declaration?.id) return p.declaration.id.name
  }
  return '<module>'
}

/** Is the code AFTER `stmtIdx` of `parents` guarded? Climbs out of blocks/ifs/trys that end. */
function guardedAfter(stmt, parents, src) {
  let cur = stmt
  for (let i = parents.length - 1; i >= 0; i -= 1) {
    const p = parents[i]
    if (isFn(p)) return true                          // nothing follows in this function
    const list = p.type === 'BlockStatement' || p.type === 'Program' ? p.body
      : p.type === 'SwitchCase' ? p.consequent : null
    if (list) {
      const idx = list.indexOf(cur)
      if (idx >= 0 && idx < list.length - 1) return isStaleIf(list[idx + 1], src)
      // last statement of this block: climb
    }
    cur = p
  }
  return true
}

export function auditAsyncBoundaries(src) {
  const ast = parse(src)
  const found = []                                     // { key, ok, line }
  const add = (key, ok, node) => found.push({ key, ok, line: node.loc.start.line })
  walk(ast, (node, parents) => {
    const fnName = enclosingFnName(parents)
    if (node.type === 'AwaitExpression') {
      // the statement holding this await
      let si = parents.length - 1
      while (si >= 0 && !/Statement$|Declaration$/.test(parents[si].type)) si -= 1
      const stmt = parents[si]
      if (stmt.type === 'ReturnStatement') return add(`${fnName}|await-return`, true, node)
      const ok = guardedAfter(stmt, parents.slice(0, si), src)
      add(`${fnName}|await|${src.slice(node.start, node.end).slice(0, 60)}`, ok, node)
    }
    if (node.type === 'TryStatement' && node.handler) {
      let hasAwait = false
      walk(node.block, (n, ps) => { if (n.type === 'AwaitExpression' && !ps.some(isFn)) hasAwait = true })
      if (hasAwait) {
        const body = node.handler.body
        const ok = !body.body.length || isStaleIf(body.body[0], src)
        add(`${fnName}|catch-body|${src.slice(node.handler.start, node.handler.end)}`, ok, node.handler)
      }
    }
    if (node.type === 'CallExpression') {
      const c = node.callee
      const method = c.type === 'MemberExpression' && !c.computed ? c.property.name : null
      const callee = c.type === 'Identifier' ? c.name : null
      if (method === 'then' || method === 'catch') {
        const fns = node.arguments.filter(isFn)
        const ok = fns.length > 0 && fns.every((f) => fnBeginsWithCheck(f, src))
        add(`${fnName}|then|${src.slice(node.start, node.end).replace(/\s+/g, ' ').slice(0, 120)}`, ok, node)
      }
      if (callee === 'setTimeout' && isFn(node.arguments[0])) {
        add(`${fnName}|setTimeout`, fnBeginsWithCheck(node.arguments[0], src), node)
      }
      if ((callee === 'mutate' || callee === 'mutateGlobal') && node.arguments.some(isFn)) {
        const f = node.arguments.find(isFn)
        add(`${fnName}|updater|${callee}`, fnBeginsWithCheck(f, src), node)
      }
    }
  })
  return found
}

describe('usePreferences.js — every async boundary checks the member before its next side effect', () => {
  const SRC = readFileSync(SRC_PATH, 'utf8').replace(/\r\n/g, '\n')
  const found = auditAsyncBoundaries(SRC)

  it('the audit sees the module\'s boundaries (it cannot pass by finding none)', () => {
    expect(found.filter((f) => f.key.includes('|await')).length).toBeGreaterThanOrEqual(10)
    expect(found.filter((f) => f.key.includes('|then|')).length).toBeGreaterThanOrEqual(6)
    expect(found.some((f) => f.key.endsWith('|setTimeout'))).toBe(true)
    expect(found.filter((f) => f.key.includes('|updater|')).length).toBeGreaterThanOrEqual(3)
  })

  it('no unguarded boundary outside the allow-list', () => {
    const bad = found.filter((f) => !f.ok && !Object.prototype.hasOwnProperty.call(ALLOWED, f.key))
      .map((f) => `line ${f.line}: ${f.key}`)
    expect(bad, `UNGUARDED ASYNC BOUNDARY — begin it with \`if (op.stale()) …\` (beginPrefsOp), or list it in ALLOWED with the reason:\n${bad.join('\n')}`).toEqual([])
  })

  it('every allow-list entry still exists and is still unguarded (the list cannot rot)', () => {
    for (const key of Object.keys(ALLOWED)) {
      const f = found.find((x) => x.key === key)
      expect(f, `allow-list entry no longer matches a boundary: ${key}`).toBeTruthy()
      expect(f.ok, `allow-list entry is guarded now — remove it: ${key}`).toBe(false)
    }
  })

  it('CONTROL: an unguarded await, .then, timer and updater are each caught', () => {
    const bad = `
      async function f(op) { const r = await fetch('/x'); sideEffect(r) }
      function g(p) { p.then((x) => { sideEffect(x) }) }
      function h() { setTimeout(() => { sideEffect() }, 1) }
      function k(mutate) { mutate((prev) => ({ ...prev, a: 1 })) }
      async function okOne(op) { const r = await fetch('/x'); if (op.stale()) return; sideEffect(r) }`
    const res = auditAsyncBoundaries(bad)
    const byFn = (n) => res.filter((x) => x.key.startsWith(`${n}|`))
    expect(byFn('f').every((x) => !x.ok)).toBe(true)
    expect(byFn('g').every((x) => !x.ok)).toBe(true)
    expect(byFn('h').every((x) => !x.ok)).toBe(true)
    expect(byFn('k').every((x) => !x.ok)).toBe(true)
    expect(byFn('okOne').every((x) => x.ok)).toBe(true)
  })
})

// ─── The callers' half: a cache merge made AFTER a door's await carries the operation begun before it.
//
// ⛔ THREE CALLERS ARE KNOWN AND NOT FIXED HERE, ON PURPOSE. They live under the Notebook
// workstream's paths, which this branch may not edit (rule 12, `hub/rule12Paths.test.js`: "any other
// need is a STOP and a report to the owner, not an edit"). Each awaits its own door and then merges
// the door's answer into the cache without the op, so an answer for the previous member can land in
// the next member's cache (locally only: this module never posts a merged-in cache value on its
// own). The fix is one line each — `const op = beginPrefsOp()` before the await, `op` as the third
// argument — and is reported to the owner. Any NEW such caller fails this rail.
const NOTEBOOK_CALLERS_PENDING = {
  'pages/journal-2-0/components/notebook/onboarding/tourSeenState.js': 'rule 12: the tour-row PUT answer merged after its await',
  'pages/journal-2-0/lib/notebookSets.js': 'rule 12: the chart-sets POST answer merged after its await',
  'pages/journal-2-0/components/notebook/AdoptLayoutSheet.jsx': 'rule 12: the put-back after a failed write and re-read',
}
describe('mergeIntoPreferenceCache callers — an op begun before the await is passed in', () => {
  const { readdirSync, statSync } = require('node:fs')
  const SRC_ROOT = join(process.cwd(), 'src')
  function filesUnder(dir) {
    const out = []
    for (const name of readdirSync(dir)) {
      const p = join(dir, name)
      if (statSync(p).isDirectory()) { if (name !== 'node_modules') out.push(...filesUnder(p)) } else if (/\.(js|jsx)$/.test(name) && !/\.test\./.test(name)) out.push(p)
    }
    return out
  }
  const callers = filesUnder(SRC_ROOT)
    .filter((f) => !f.endsWith(join('hooks', 'usePreferences.js')))
    .map((f) => [f, readFileSync(f, 'utf8')])
    .filter(([, s]) => /\bmergeIntoPreferenceCache\b/.test(s) && /from ['"][./]*(?:\.\.\/)*hooks\/usePreferences['"]/.test(s))

  it('finds the callers (cannot pass by finding none)', () => {
    expect(callers.length).toBeGreaterThanOrEqual(3)
  })

  it('every call that follows an await in its function passes the operation (third argument)', () => {
    const bad = []
    for (const [file, s] of callers) {
      const ast = parse(s)
      walk(ast, (node, parents) => {
        if (node.type !== 'CallExpression' || node.callee.type !== 'Identifier' || node.callee.name !== 'mergeIntoPreferenceCache') return
        const fn = [...parents].reverse().find(isFn)
        if (!fn) return
        let awaitBefore = false
        walk(fn.body, (n, ps) => { if (n.type === 'AwaitExpression' && n.start < node.start && !ps.slice(ps.indexOf(fn.body)).some((x) => isFn(x) && x !== fn)) awaitBefore = true })
        if (awaitBefore && node.arguments.length < 3) bad.push(file.slice(SRC_ROOT.length + 1).split(/[\\/]/).join('/'))
      })
    }
    const unlisted = bad.filter((f) => !NOTEBOOK_CALLERS_PENDING[f])
    expect(unlisted, `a cache merge after an await without the op begun BEFORE it (beginPrefsOp):\n${unlisted.join('\n')}`).toEqual([])
    // the pending list cannot rot: each entry is still such a call (remove it once its file passes op)
    for (const f of Object.keys(NOTEBOOK_CALLERS_PENDING)) expect(bad, `no longer pending, remove from the list: ${f}`).toContain(f)
  })

  it('CONTROL: the audit flags a merge after an await without the op, and passes one with it', () => {
    const flag = (code) => {
      const out = []
      walk(parse(code), (node, parents) => {
        if (node.type !== 'CallExpression' || node.callee.name !== 'mergeIntoPreferenceCache') return
        const fn = [...parents].reverse().find(isFn)
        let awaitBefore = false
        walk(fn.body, (n) => { if (n.type === 'AwaitExpression' && n.start < node.start) awaitBefore = true })
        if (awaitBefore && node.arguments.length < 3) out.push(node)
      })
      return out.length
    }
    expect(flag('async function a() { await door(); mergeIntoPreferenceCache("k", v) }')).toBe(1)
    expect(flag('async function a() { const op = beginPrefsOp(); await door(); mergeIntoPreferenceCache("k", v, op) }')).toBe(0)
  })
})
