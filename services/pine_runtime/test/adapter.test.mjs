// W5-T7 rail, HP-7 ADAPTER AGREEMENT (docs/pine/SERVER-RUNTIME-DESIGN.md 2.3): the browser's
// worker (`runtimeWorker.js`, the call and its opts; `runtimeAsync.js::messageOf`, the def / ctx /
// rows it ships) and the service's adapter (`job.mjs`) build the same `(def, rows, ctx, opts)`,
// minus `now`, compared by a STATIC PARSE. The only differences allowed are job.mjs's declared
// SERVER_ONLY_OPTS and DECLARED_DIFFERENCES; anything else is drift and fails here by name.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { parse } from '../../../app/node_modules/acorn/dist/acorn.mjs'
import { DECLARED_DIFFERENCES, SERVER_ONLY_OPTS } from '../job.mjs'

const RT = new URL('../../../app/src/components/chart/engine/runtime/', import.meta.url)
const read = (u) => readFileSync(u, 'utf8')
const files = {
  worker: read(new URL('runtimeWorker.js', RT)),
  async: read(new URL('runtimeAsync.js', RT)),
  job: read(new URL('../job.mjs', import.meta.url)),
}
const ast = (text) => parse(text, { ecmaVersion: 'latest', sourceType: 'module' })

function walk(node, visit) {
  if (!node || typeof node.type !== 'string') return
  visit(node)
  for (const v of Object.values(node)) {
    if (Array.isArray(v)) v.forEach((c) => walk(c, visit))
    else if (v && typeof v.type === 'string') walk(v, visit)
  }
}
const find = (root, pred) => { const out = []; walk(root, (n) => { if (pred(n)) out.push(n) }); return out }
/** RS RATING L3: bind.js::BIND_SYMBOL_FIELDS, read off its source by the same parse (bind.js imports
 *  JSON, so node cannot load it bare): the projection's own list, never restated here. */
const BIND_SYMBOL_FIELDS = (() => {
  const text = read(new URL('../ast/bind.js', RT))
  const [d] = find(ast(text), (n) => n.type === 'VariableDeclarator' && n.id.type === 'Identifier' && n.id.name === 'BIND_SYMBOL_FIELDS')
  const arr = d && d.init.type === 'CallExpression' ? d.init.arguments[0] : null
  assert.ok(arr && arr.type === 'ArrayExpression' && arr.elements.length, 'bind.js declares BIND_SYMBOL_FIELDS as a frozen list')
  return arr.elements.map((e) => e.value)
})()
const keyName = (p) => (p.key.type === 'Identifier' ? p.key.name : String(p.key.value))

/** A value as "what it reads": a constant by its name (`X` or `rt.X`), a literal, or an argument. */
function valueOf(node, text) {
  if (node.type === 'LogicalExpression') return valueOf(node.left, text) // `rows || []`: the value the caller passed
  if (node.type === 'Identifier') return `name:${node.name}`
  if (node.type === 'MemberExpression' && node.object.type === 'Identifier' && node.object.name === 'rt') return `name:${node.property.name}`
  if (node.type === 'Literal') return `literal:${node.raw}`
  return `expr:${text.slice(node.start, node.end)}`
}

/** The keys an object literal can carry, spreads of `cond ? {...} : {}` included, with nested shapes. */
function shapeOf(node, text) {
  const out = {}
  for (const p of node.properties) {
    if (p.type === 'Property') {
      out[keyName(p)] = p.value.type === 'ObjectExpression' ? shapeOf(p.value, text) : valueOf(p.value, text)
    } else if (p.type === 'SpreadElement' && p.argument.type === 'ConditionalExpression' && p.argument.consequent.type === 'ObjectExpression') {
      Object.assign(out, shapeOf(p.argument.consequent, text))
    } else if (p.type === 'SpreadElement' && p.argument.type === 'MemberExpression') {
      out['...'] = 'copy' // `{ ...ctx.runtimeInputs }`: a copy of the caller's map
    } else if (p.type === 'SpreadElement' && p.argument.type === 'CallExpression'
      && p.argument.callee.type === 'Identifier' && p.argument.callee.name === 'bindSymbolOf') {
      // RS RATING L3: `...bindSymbolOf(x)` carries every field of bind.js::BIND_SYMBOL_FIELDS (the
      // projection's own list, read from the module, never restated here)
      const from = text.slice(p.argument.arguments[0].start, p.argument.arguments[0].end)
      for (const f of BIND_SYMBOL_FIELDS) out[f] = `expr:${from}.${f}`
    } else {
      throw new Error(`an object part the HP-7 parse does not read: ${text.slice(p.start, p.end)}`)
    }
  }
  return out
}

function theCall(text, calleeIs) {
  const calls = find(ast(text), (n) => n.type === 'CallExpression' && calleeIs(n.callee))
  assert.equal(calls.length, 1, 'exactly one computeRuntimeColumns call')
  return calls[0]
}
const byName = (c) => c.type === 'Identifier' && c.name === 'computeRuntimeColumns'
const byMember = (c) => c.type === 'MemberExpression' && c.property.name === 'computeRuntimeColumns'

function declarators(text, fnName) {
  const [fn] = find(ast(text), (n) => n.type === 'FunctionDeclaration' && n.id && n.id.name === fnName)
  assert.ok(fn, `${fnName} exists`)
  const out = {}
  walk(fn, (n) => { if (n.type === 'VariableDeclarator' && n.id.type === 'Identifier') out[n.id.name] = n.init })
  return out
}
/** The object one row is built as: the body of the arrow that maps each bar. */
const rowObject = (node) => find(node, (n) => n.type === 'ArrowFunctionExpression' && n.body.type === 'ObjectExpression')[0].body

function browserSide() {
  const call = theCall(files.worker, byName)
  const d = declarators(files.async, 'messageOf')
  return {
    args: call.arguments.slice(0, 3).map((a) => valueOf(a, files.worker)),
    opts: shapeOf(call.arguments[3], files.worker),
    def: shapeOf(d.plainDef, files.async),
    ctx: shapeOf(d.plainCtx, files.async),
    row: Object.keys(shapeOf(rowObject(d.plainRows), files.async)),
  }
}
function serverSide(text = files.job) {
  const call = theCall(text, byMember)
  const d = declarators(text, 'runArgs')
  return {
    args: call.arguments.slice(0, 3).map((a) => valueOf(a, text)),
    opts: shapeOf(call.arguments[3], text),
    def: shapeOf(d.def, text),
    ctx: shapeOf(d.ctx, text),
    row: Object.keys(shapeOf(rowObject(d.rows), text)),
  }
}
const without = (o, keys) => Object.fromEntries(Object.entries(o).filter(([k]) => !keys.includes(k)))

/** Every disagreement between the two adapters, outside the declared ones. Empty = they agree. */
function drift(b, s) {
  const out = []
  if (JSON.stringify(b.args) !== JSON.stringify(s.args)) out.push(`args ${JSON.stringify(b.args)} vs ${JSON.stringify(s.args)}`)
  const serverOnly = Object.keys(SERVER_ONLY_OPTS)
  const bo = without(b.opts, ['now', ...DECLARED_DIFFERENCES.optsBrowserOnly])
  const so = without(s.opts, ['now', ...serverOnly])
  if (JSON.stringify(bo) !== JSON.stringify(so)) out.push(`opts ${JSON.stringify(bo)} vs ${JSON.stringify(so)}`)
  for (const k of serverOnly) {
    if (s.opts[k] !== `literal:${JSON.stringify(SERVER_ONLY_OPTS[k])}`) out.push(`server-only opt ${k} is ${s.opts[k]}`)
  }
  if (JSON.stringify(Object.keys(b.def)) !== JSON.stringify(Object.keys(s.def))) out.push(`def keys ${Object.keys(b.def)} vs ${Object.keys(s.def)}`)
  if (s.def.meta !== `expr:${DECLARED_DIFFERENCES.defMeta}`) out.push(`def.meta is ${JSON.stringify(s.def.meta)}`)
  const bc = without(b.ctx, DECLARED_DIFFERENCES.ctxBrowserOnly)
  const serverCtx = Object.keys(DECLARED_DIFFERENCES.ctxServerOnly)
  const sc = without(s.ctx, serverCtx)
  if (JSON.stringify(Object.keys(bc)) !== JSON.stringify(Object.keys(sc))) out.push(`ctx keys ${Object.keys(bc)} vs ${Object.keys(sc)}`)
  for (const k of serverCtx) {
    if (s.ctx[k] !== `literal:${JSON.stringify(DECLARED_DIFFERENCES.ctxServerOnly[k])}`) out.push(`server-only ctx ${k} is ${s.ctx[k]}`)
  }
  const bs = Object.keys(without(bc.symbol || {}, DECLARED_DIFFERENCES.ctxSymbolBrowserOnly))
  const ss = Object.keys(s.ctx.symbol || {})
  if (JSON.stringify(bs) !== JSON.stringify(ss)) out.push(`ctx.symbol shape ${bs} vs ${ss}`)
  if (JSON.stringify(b.row) !== JSON.stringify(s.row)) out.push(`row keys ${b.row} vs ${s.row}`)
  return out
}

test('HP-7: the service adapter builds the browser worker\'s (def, rows, ctx, opts), minus now and the declared differences', () => {
  const b = browserSide()
  const s = serverSide()
  assert.deepEqual(drift(b, s), [])
  // the facts the rail rests on, so a parse that silently read nothing cannot pass
  assert.deepEqual(b.opts, { budgetMs: 'name:RUNTIME_PANE_TIME_BUDGET_MS', budgetScales: 'literal:true' })
  assert.deepEqual(s.opts, { budgetMs: 'name:RUNTIME_PANE_TIME_BUDGET_MS', incremental: 'literal:false' })
  assert.deepEqual(b.row, ['t', 'o', 'h', 'l', 'c', 'v'])
  assert.deepEqual(Object.keys(s.ctx), ['tf', 'newestBarIsForming', 'historyFromListing', 'runtimeInputs', 'symbol', 'otherSymbolSupply', 'historyWindowBars'])
  // RS RATING L3 / L5: the browser ships every bind field and the other-symbol cache; the server
  // ships neither, and says so (DECLARED_DIFFERENCES), so the parse read them rather than skipped them
  // (2026-11-19) plus the browser's optional listing fact, `firstTradeDate` (declared browser-only in job.mjs)
  // (2026-11-20) and whether that listing answer is still in flight, `firstTradeDatePending` (declared browser-only too)
  assert.deepEqual(Object.keys(b.ctx.symbol), [...BIND_SYMBOL_FIELDS, 'firstTradeDate', 'firstTradeDatePending'])
  assert.ok('secondaryEntries' in b.ctx)
  assert.deepEqual(Object.keys(s.ctx.symbol), ['ticker', 'exchange'])
  // W9-T11: both hosts forward the window from their own ctx, never from a literal
  assert.equal(b.ctx.historyWindowBars, 'expr:ctx.historyWindowBars')
  assert.equal(s.ctx.historyWindowBars, 'expr:job.ctx.historyWindowBars')
})

test('HP-7: every declared difference is still a real one (no stale declaration)', () => {
  const b = browserSide()
  assert.deepEqual(SERVER_ONLY_OPTS, { incremental: false })
  for (const k of Object.keys(SERVER_ONLY_OPTS)) assert.ok(!(k in b.opts), `the browser does not pass ${k}`)
  for (const k of DECLARED_DIFFERENCES.ctxBrowserOnly) assert.ok(k in b.ctx, `the browser still ships ctx.${k}`)
  for (const k of DECLARED_DIFFERENCES.optsBrowserOnly) assert.ok(k in b.opts, `the browser still passes ${k}`)
  for (const k of DECLARED_DIFFERENCES.ctxSymbolBrowserOnly) assert.ok(k in b.ctx.symbol, `the browser still ships ctx.symbol.${k}`)
  for (const k of Object.keys(DECLARED_DIFFERENCES.ctxServerOnly)) assert.ok(!(k in b.ctx), `the browser does not ship ctx.${k}`)
  assert.notEqual(b.def.meta, `expr:${DECLARED_DIFFERENCES.defMeta}`, 'the browser meta still differs')
})

test('HP-7 can fail: drift in any argument of the server adapter is named', () => {
  const edits = [
    ['an extra opt', 'incremental: false })', 'incremental: false, warmupCurtain: false })', /opts/],
    ['a different budget', '{ budgetMs: rt.RUNTIME_PANE_TIME_BUDGET_MS,', '{ budgetMs: 5000,', /opts/],
    ['a server-only opt flipped', 'incremental: false })', 'incremental: true })', /server-only opt incremental/],
    ['a ctx key dropped', '    runtimeInputs: { ...job.ctx.runtimeInputs },\n', '', /ctx keys/],
    ['a ctx key added', '    tf: job.tf,\n', '    tf: job.tf,\n    framed: true,\n', /ctx keys/],
    ['a row key dropped', ', v: v[i] }', ' }', /row keys/],
    ['def meta projected', 'meta: doc.meta }', 'meta: {} }', /def\.meta/],
    ['a declared symbol field mirrored', 'exchange: job.symbol.exchange },', 'exchange: job.symbol.exchange, industry: job.symbol.industry },', /ctx\.symbol shape/],
    ['a symbol field dropped', '{ ticker: job.symbol.ticker, exchange: job.symbol.exchange },', '{ ticker: job.symbol.ticker },', /ctx\.symbol shape/],
    ['the server-only ctx flipped', '    otherSymbolSupply: false,\n', '    otherSymbolSupply: true,\n', /server-only ctx otherSymbolSupply/],
    ['the server-only ctx dropped', '    otherSymbolSupply: false,\n', '', /server-only ctx otherSymbolSupply/],
  ]
  const text = files.job.replace(/\r\n/g, '\n')
  for (const [name, from, to, expect] of edits) {
    assert.ok(text.includes(from), `fixture text for ${name}`)
    const found = drift(browserSide(), serverSide(text.replace(from, to)))
    assert.ok(found.some((d) => expect.test(d)), `${name}: ${JSON.stringify(found)}`)
  }
})
