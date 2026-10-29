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
//   - a `.then(…)` / `.catch(…)` / `.finally(…)` callback; a `setTimeout` / `setInterval` /
//     `queueMicrotask` / `requestAnimationFrame` callback (bare or as `window.` / `globalThis.` …);
//     an SWR cache updater passed to `mutate` / `mutateGlobal` — the function must begin with the
//     stale check;
//   - such a handler passed BY NAME (`mutate(fnRef)`, `setTimeout(namedFn)`, `.then(handler)`) can
//     not be seen into, so it fails unless allow-listed;
//   - an `await` inside a loop whose body ends after it: the loop's next iteration is what follows,
//     so the loop body must BEGIN with the stale check.
//
// ⛔ THE CHECK IS AN UN-NEGATED EXIT: `if (op.stale()) return …` / `throw …` (a block whose last
// statement returns or throws counts). `if (!op.stale())`, a check that falls through, or a mere
// mention of `.stale()` somewhere in the test does not.
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
/** `x.stale()` itself — not negated, not buried in another expression. A `||` whose LEFT side is
 *  the call also counts (`if (op.stale() || aborted) return`): the left side alone already exits. */
function isStaleCall(test) {
  if (!test) return false
  if (test.type === 'LogicalExpression' && test.operator === '||') return isStaleCall(test.left)
  return test.type === 'CallExpression' && test.arguments.length === 0
    && test.callee.type === 'MemberExpression' && !test.callee.computed && test.callee.property.name === 'stale'
}
const exits = (s) => !!s && (s.type === 'ReturnStatement' || s.type === 'ThrowStatement'
  || (s.type === 'BlockStatement' && s.body.length > 0 && exits(s.body[s.body.length - 1])))
/** `if (op.stale()) return …` / `throw …` — the only shape that counts as the guard. */
function isStaleExit(stmt) {
  return !!stmt && stmt.type === 'IfStatement' && isStaleCall(stmt.test) && exits(stmt.consequent)
}
// eslint-disable-next-line no-unused-vars
const isStaleIf = (stmt) => isStaleExit(stmt)

/** A function begins with the stale exit (block body: first statement; expression body: a
 *  conditional whose test is the stale call). An empty function does nothing and passes. */
function fnBeginsWithCheck(fn) {
  if (fn.body.type === 'BlockStatement') {
    if (!fn.body.body.length) return true
    return isStaleExit(fn.body.body[0])
  }
  return fn.body.type === 'ConditionalExpression' && isStaleCall(fn.body.test)
}
const LOOPS = new Set(['ForStatement', 'ForInStatement', 'ForOfStatement', 'WhileStatement', 'DoWhileStatement'])

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
      if (idx >= 0 && idx < list.length - 1) return isStaleExit(list[idx + 1])
      // last statement of this block: climb — unless the block is a LOOP body, whose next
      // statement is the loop's next iteration
      const loop = parents[i - 1]
      if (loop && LOOPS.has(loop.type) && loop.body === p) return isStaleExit(p.body[0])
    }
    if (LOOPS.has(p.type) && p.body === cur) return isStaleExit(cur)   // a loop whose body is one statement
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
        const ok = !body.body.length || isStaleExit(body.body[0])
        add(`${fnName}|catch-body|${src.slice(node.handler.start, node.handler.end)}`, ok, node.handler)
      }
    }
    if (node.type === 'CallExpression') {
      const c = node.callee
      const method = c.type === 'MemberExpression' && !c.computed ? c.property.name : null
      const callee = c.type === 'Identifier' ? c.name : null
      const text = () => src.slice(node.start, node.end).replace(/\s+/g, ' ').slice(0, 120)
      if (method === 'then' || method === 'catch' || method === 'finally') {
        // every handler must be inline AND begin with the exit; a handler passed by name is opaque
        const ok = node.arguments.length > 0 && node.arguments.every((a) => isFn(a) && fnBeginsWithCheck(a))
        add(`${fnName}|then|${text()}`, ok, node)
      }
      // a scheduler, bare or as a property of window / globalThis / self
      const sched = callee || (c.type === 'MemberExpression' && !c.computed && c.object.type === 'Identifier'
        && ['window', 'globalThis', 'self'].includes(c.object.name) ? c.property.name : null)
      if (['setTimeout', 'setInterval', 'queueMicrotask', 'requestAnimationFrame'].includes(sched)) {
        const h = node.arguments[0]
        add(`${fnName}|${sched}|${text()}`, isFn(h) && fnBeginsWithCheck(h), node)
      }
      // an SWR updater: mutate(updater, …) / mutateGlobal(KEY, updater, …) — inline functions are
      // read; a NAME passed where the updater goes is opaque and fails
      const upd = callee === 'mutate' ? node.arguments[0] : callee === 'mutateGlobal' ? node.arguments[1] : undefined
      if (upd && (isFn(upd) || upd.type === 'Identifier' && upd.name !== 'undefined')) {
        add(`${fnName}|updater|${callee}`, isFn(upd) && fnBeginsWithCheck(upd), node)
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
    expect(found.some((f) => f.key.includes('|setTimeout|'))).toBe(true)
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

  it('CONTROL (hardened): finally, microtask, rAF, interval, window.setTimeout, named handlers, loops, negated / fall-through checks', () => {
    const cases = {
      fin: 'function fin(p) { p.finally(() => { sideEffect() }) }',
      micro: 'function micro() { queueMicrotask(() => { sideEffect() }) }',
      raf: 'function raf() { requestAnimationFrame(() => { sideEffect() }) }',
      ivl: 'function ivl() { setInterval(() => { sideEffect() }, 5) }',
      wto: 'function wto() { window.setTimeout(() => { sideEffect() }, 5) }',
      named: 'function named(mutate, upd) { mutate(upd) }',
      namedT: 'function namedT(cb) { setTimeout(cb, 1) }',
      namedThen: 'function namedThen(p, h) { p.then(h) }',
      loop: 'async function loop(op, xs) { for (const x of xs) { sideEffect(x); await fetch(x) } }',
      neg: 'async function neg(op) { await fetch("/x"); if (!op.stale()) return; sideEffect() }',
      fall: 'async function fall(op) { await fetch("/x"); if (op.stale()) { log() } sideEffect() }',
      mention: 'async function mention(op) { await fetch("/x"); if (x === op.stale) return; sideEffect() }',
    }
    for (const [name, code] of Object.entries(cases)) {
      const res = auditAsyncBoundaries(code).filter((x) => x.key.startsWith(`${name}|`))
      expect(res.length, `${name}: no boundary found`).toBeGreaterThan(0)
      expect(res.some((x) => !x.ok), `${name}: not flagged`).toBe(true)
    }
    const good = {
      loopOk: 'async function loopOk(op, xs) { for (const x of xs) { if (op.stale()) return; sideEffect(x); await fetch(x) } }',
      orOk: 'async function orOk(op, s) { await fetch("/x"); if (op.stale() || s.aborted) return null; sideEffect() }',
      blockOk: 'async function blockOk(op) { await fetch("/x"); if (op.stale()) { reset(); return } sideEffect() }',
    }
    for (const [name, code] of Object.entries(good)) {
      const res = auditAsyncBoundaries(code).filter((x) => x.key.startsWith(`${name}|`))
      expect(res.length, `${name}: no boundary found`).toBeGreaterThan(0)
      expect(res.every((x) => x.ok), `${name}: a correct guard was flagged`).toBe(true)
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

// ─── The callers' half: a preference write or cache merge made AFTER an await of the caller's own
// (a door, an adopt round trip, a PUT) carries the operation the caller began BEFORE that await.
//
// ⛔ Without it the write begins its own operation at the call, i.e. for whoever is signed in by
// then: a door's answer, or a fallback write, for member A lands in member B's cache AND account
// (review of 6f9fbaff4d reproduced A's notebook_tours posted into B; the earlier note here that
// this was "local only" was wrong). So every call of `mergeIntoPreferenceCache`, `setPref` or
// `setPrefMerged` that follows an await in its function must pass the op (third argument), or be
// immediately preceded by `if (op.stale()) return …` with no await between, or be listed in
// CALLERS_ALLOWED with the reason. The Notebook callers were fixed under the owner's rule-12
// approval of 2026-10-29, so NOTEBOOK_CALLERS_PENDING is empty and must stay so.
const NOTEBOOK_CALLERS_PENDING = {}
const WRITE_FNS = new Set(['mergeIntoPreferenceCache', 'setPref', 'setPrefMerged'])
const CALLERS_ALLOWED = {
  // ⚠️ FOUND BY THIS RAIL, NOT FIXED HERE, REPORTED: outside the files this change may touch.
  'pages/journal-2-0/components/notebook/styles/StarterPackOffer.jsx|writeStarterPackState(…bare writer)':
    'PENDING owner approval (rule 12: a Notebook path not in the 2026-10-29 approval): writes notebook_starter_pack through setPrefMerged after awaiting installStarterPack, with no op',
  'pages/Settings.jsx|fetch(PREFS_URL POST)':
    'PENDING (outside this change’s approved scope): the backup-restore loop POSTs each key after its own reads; a member change mid-restore is not checked',
  'testing/device/authHarness.js|setPref':
    'a device test harness: `api.setPref` is its own HTTP client for ONE scripted session, not the hook; there is no member change inside a run',
}

function callName(node) {
  const c = node.callee
  if (c.type === 'Identifier') return c.name
  if (c.type === 'MemberExpression' && !c.computed && c.property.type === 'Identifier') {
    // an indirect writer held in a ref: setPrefMergedRef.current(...), setPrefRef.current(...)
    if (c.property.name === 'current' && c.object.type === 'Identifier' && /^(setPref|setPrefMerged|mergeIntoPreferenceCache)Ref$/.test(c.object.name)) {
      return c.object.name.replace(/Ref$/, '')
    }
    return c.property.name
  }
  return null
}

const isPrefsUrl = (n) => n && ((n.type === 'Identifier' && n.name === 'PREFS_URL')
  || (n.type === 'Literal' && n.value === '/api/auth/preferences'))
const isPostOptions = (n) => n && n.type === 'ObjectExpression' && n.properties.some((p) => p.type === 'Property'
  && ((p.key.type === 'Identifier' && p.key.name === 'method') || (p.key.type === 'Literal' && p.key.value === 'method'))
  && p.value.type === 'Literal' && String(p.value.value).toUpperCase() === 'POST')

/** The function the node sits in, and whether an await ran in it BEFORE the node (not inside a
 *  nested function). Also returns the first such await's start. */
function awaitContext(node, parents) {
  const fi = parents.map(isFn).lastIndexOf(true)
  if (fi < 0) return null
  const fn = parents[fi]
  let first = null
  walk(fn.body, (n, ps) => {
    if (n.type === 'AwaitExpression' && n.end <= node.start && !ps.some((x) => isFn(x))) {
      if (first === null || n.start < first) first = n.start
    }
  })
  return first === null ? null : { fi, fn, firstAwait: first }
}

/** The statement holding `node` is preceded by the stale exit — directly, or as the first statement
 *  of a block (try / if) whose own statement is so preceded. */
function guardedBefore(node, parents, fi) {
  let si = parents.length - 1
  while (si > fi && !/Statement$|Declaration$/.test(parents[si].type)) si -= 1
  let stmt = parents[si]
  for (let i = si - 1; i > fi; i -= 1) {
    const block = parents[i]
    const list = block.type === 'BlockStatement' ? block.body : null
    if (!list) { stmt = block; continue }
    const idx = list.indexOf(stmt)
    if (idx > 0) return isStaleExit(list[idx - 1])
    if (idx < 0) return false
    stmt = block                                       // first of its block: look before the block's owner
  }
  return false
}

/** Is identifier `name` bound before `before` — a parameter of an enclosing function, or declared
 *  ahead of that position in one? (An op begun AFTER the await proves nothing.) */
function boundBefore(name, parents, before) {
  for (let i = parents.length - 1; i >= 0; i -= 1) {
    const p = parents[i]
    if (isFn(p)) {
      const params = p.params.flatMap((x) => (x.type === 'Identifier' ? [x.name]
        : x.type === 'AssignmentPattern' && x.left.type === 'Identifier' ? [x.left.name] : []))
      if (params.includes(name)) return true
      let declaredAt = null
      walk(p.body, (n, ps) => {
        if (n.type === 'VariableDeclarator' && n.id.type === 'Identifier' && n.id.name === name && !ps.some((x) => isFn(x) && x !== p)) declaredAt = n.start
      })
      if (declaredAt !== null) return declaredAt < before
    }
  }
  return false
}

/** Writes after an await of the caller's own without a valid op (or a stale exit right before).
 *  Returns [{ name, line }]. */
export function writesAfterAwaitWithoutOp(code) {
  const out = []
  walk(parse(code), (node, parents) => {
    if (node.type !== 'CallExpression') return
    const name = callName(node)
    // (1) setPref / setPrefMerged / mergeIntoPreferenceCache (also through a ref)
    // (2) a raw POST to the preferences endpoint
    // (3) an op BEGUN after the await and handed on (`write(answer, beginPrefsOp())`)
    // (4) a writer handed on bare (`replayBoardWrites(steps, setPref)`) after an await
    const isWrite = WRITE_FNS.has(name)
    const isRawPost = name === 'fetch' && isPrefsUrl(node.arguments[0]) && isPostOptions(node.arguments[1])
    const lateOp = node.arguments.some((x) => x.type === 'CallExpression' && x.callee.type === 'Identifier' && x.callee.name === 'beginPrefsOp'
      || (x.type === 'LogicalExpression' && x.right.type === 'CallExpression' && x.right.callee.name === 'beginPrefsOp'))
    const bareWriter = node.arguments.some((x) => x.type === 'Identifier' && WRITE_FNS.has(x.name))
    if (!isWrite && !isRawPost && !lateOp && !bareWriter) return
    const ctx = awaitContext(node, parents)
    if (!ctx) return
    if (lateOp) { out.push({ name: `${name}(…beginPrefsOp())`, line: node.loc.start.line }); return }
    if (bareWriter && !isWrite) { out.push({ name: `${name}(…bare writer)`, line: node.loc.start.line }); return }
    if (isWrite) {
      const opArg = node.arguments[2]
      if (opArg && opArg.type === 'Identifier' && boundBefore(opArg.name, parents, ctx.firstAwait)) return
    }
    if (guardedBefore(node, parents, ctx.fi)) return
    out.push({ name: isRawPost ? 'fetch(PREFS_URL POST)' : name, line: node.loc.start.line })
  })
  return out
}

describe('callers — a write after an await of their own carries the op begun before it', () => {
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
  const rel = (f) => f.slice(SRC_ROOT.length + 1).split(/[\\/]/).join('/')
  const files = filesUnder(SRC_ROOT)
    .filter((f) => !f.endsWith(join('hooks', 'usePreferences.js')))
    .map((f) => [rel(f), readFileSync(f, 'utf8')])
    .filter(([, s]) => /\b(mergeIntoPreferenceCache|setPref|setPrefMerged)\b/.test(s))

  it('scans the writers (cannot pass by finding none)', () => {
    expect(files.length).toBeGreaterThan(20)
    expect(files.some(([f]) => f.endsWith('onboarding/tourSeenState.js'))).toBe(true)
  })

  it('no unlisted write after an await without the op', () => {
    const bad = []
    for (const [f, s] of files) {
      let found
      try { found = writesAfterAwaitWithoutOp(s) } catch (e) { bad.push(`${f}: unparseable (${e.message})`); continue }
      for (const x of found) {
        const key = `${f}|${x.name}`
        if (!CALLERS_ALLOWED[key]) bad.push(`${f}:${x.line} ${x.name}`)
      }
    }
    expect(bad, `a preference write after an await without the op begun BEFORE it (pass \`op\` from beginPrefsOp(), or guard it, or list it with the reason):\n${bad.join('\n')}`).toEqual([])
    expect(Object.keys(NOTEBOOK_CALLERS_PENDING)).toEqual([])
  })

  it('CONTROL: flags a merge / setPref / member-call setPrefMerged after an await; passes op-carrying and guarded ones', () => {
    expect(writesAfterAwaitWithoutOp('async function a() { await door(); mergeIntoPreferenceCache("k", v) }')).toHaveLength(1)
    expect(writesAfterAwaitWithoutOp('async function a(setPref) { await door(); setPref("k", v) }')).toHaveLength(1)
    expect(writesAfterAwaitWithoutOp('async function a(api) { await door(); await api.setPrefMerged("k", f) }')).toHaveLength(1)
    expect(writesAfterAwaitWithoutOp('async function a() { const op = beginPrefsOp(); await door(); mergeIntoPreferenceCache("k", v, op) }')).toHaveLength(0)
    expect(writesAfterAwaitWithoutOp('async function a(op, setPrefMerged) { await door(); if (op.stale()) return false; await setPrefMerged("k", f) }')).toHaveLength(0)
    expect(writesAfterAwaitWithoutOp('async function a(op, setPrefMerged) { await door(); if (!op.stale()) return false; await setPrefMerged("k", f) }')).toHaveLength(1)
    expect(writesAfterAwaitWithoutOp('function a(setPref) { setPref("k", v) }')).toHaveLength(0)
  })

  it('CONTROL (hardened): an op begun AFTER the await, a raw POST, a ref writer and a bare writer are caught', () => {
    // an op begun after the await, as a write's argument or handed on
    expect(writesAfterAwaitWithoutOp('async function a(setPref) { await door(); const op = beginPrefsOp(); setPref("k", v, op) }')).toHaveLength(1)
    expect(writesAfterAwaitWithoutOp('async function a(setPref) { await door(); setPref("k", v, beginPrefsOp()) }')).toHaveLength(1)
    expect(writesAfterAwaitWithoutOp('async function a(write) { await door(); await write(answer, beginPrefsOp()) }')).toHaveLength(1)
    expect(writesAfterAwaitWithoutOp('async function a(write, r) { await door(); await write(r, r.op || beginPrefsOp()) }')).toHaveLength(1)
    // a raw POST to the endpoint after an await
    expect(writesAfterAwaitWithoutOp('async function a() { await readRaw(); await fetch(PREFS_URL, { method: "POST", body: b }) }')).toHaveLength(1)
    expect(writesAfterAwaitWithoutOp('async function a() { const op = beginPrefsOp(); await readRaw(); if (op.stale()) return null; try { await fetch(PREFS_URL, { method: "POST", body: b }) } catch {} }')).toHaveLength(0)
    expect(writesAfterAwaitWithoutOp('async function a() { await readRaw(); await fetch(PREFS_URL) }')).toHaveLength(0)
    // an indirect writer in a ref, and a writer handed on bare
    expect(writesAfterAwaitWithoutOp('async function a() { await door(); setPrefMergedRef.current("k", f) }')).toHaveLength(1)
    expect(writesAfterAwaitWithoutOp('async function a(setPref) { await door(); replayBoardWrites(steps, setPref) }')).toHaveLength(1)
    // the op as a parameter, and declared before the first await, both pass
    expect(writesAfterAwaitWithoutOp('async function a(setPref, op) { await door(); setPref("k", v, op) }')).toHaveLength(0)
    expect(writesAfterAwaitWithoutOp('async function a(setPref) { const op = beginPrefsOp(); await door(); setPref("k", v, op) }')).toHaveLength(0)
  })
})
