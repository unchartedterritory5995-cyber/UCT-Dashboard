import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Parser } from 'acorn'
import jsx from 'acorn-jsx'

// ⛔⛔ EVERY READ OF StockChart's RENDER BOX, BY WHEN IT RUNS (chart/latestCallback.js, the #2307 review).
// `__heavy.x` is the NEWEST render's value, and a render can be abandoned after its `put`s (an interrupted
// transition). So:
//   • code that runs AFTER a commit (a handler, a subscription, a timer, a paint function, updateChart, any
//     function the body defines and hands out) must read `__heavy.committed.x`;
//   • code that runs DURING a render (the body, a memo factory, a function the body calls while rendering)
//     must read `__heavy.x`: the committed copy is one render behind there.
// An effect's own body may read either (React flushes effects before the next render starts).
// The behaviour is railed on the hook (latestCallback.test.jsx); this rail says which reads are which.

const HERE = dirname(fileURLToPath(import.meta.url))
const src = readFileSync(join(HERE, 'StockChart.jsx'), 'utf8')
const ast = Parser.extend(jsx()).parse(src, { ecmaVersion: 'latest', sourceType: 'module', locations: true })
const kids = (node) => {
  const out = []
  for (const k of Object.keys(node)) {
    if (k === 'loc' || k === 'start' || k === 'end') continue
    const v = node[k]
    if (Array.isArray(v)) v.forEach((c) => c && typeof c.type === 'string' && out.push(c))
    else if (v && typeof v.type === 'string') out.push(v)
  }
  return out
}
const isFn = (n) => n.type === 'FunctionDeclaration' || n.type === 'FunctionExpression' || n.type === 'ArrowFunctionExpression'
const calleeName = (c) => (c.type === 'Identifier' ? c.name : (c.type === 'MemberExpression' && !c.computed ? c.property.name : null))
let comp = null
const find = (n) => { if (comp) return; if (n.type === 'FunctionDeclaration' && n.id?.name === 'StockChartBody') { comp = n; return } for (const c of kids(n)) find(c) }
find(ast)

// body-level names bound to functions (plain, useCallback, useLatestCallback)
const fnNameOf = new Map()
for (const st of comp.body.body) {
  if (st.type === 'VariableDeclaration') {
    for (const d of st.declarations) {
      if (d.id.type !== 'Identifier' || !d.init) continue
      const f = d.init
      if (f.type === 'CallExpression' && /^(useCallback|useLatestCallback)$/.test(calleeName(f.callee) || '') && f.arguments[0] && isFn(f.arguments[0])) fnNameOf.set(f.arguments[0], d.id.name)
      else if (isFn(f)) fnNameOf.set(f, d.id.name)
    }
  }
  if (st.type === 'FunctionDeclaration' && st.id) fnNameOf.set(st, st.id.name)
}
const roleOf = (fnNode, parent) => {
  if (parent && parent.type === 'CallExpression' && parent.arguments[0] === fnNode) {
    const nm = calleeName(parent.callee)
    if (nm === 'useMemo') return 'memo'
    if (nm === 'useEffect' || nm === 'useLayoutEffect' || nm === 'useInsertionEffect') return 'effect'
  }
  return 'fn'
}
// an array method's callback (or an IIFE) runs synchronously: it keeps its parent's context
const SYNC = /^(map|forEach|filter|reduce|reduceRight|some|every|find|findIndex|findLast|findLastIndex|flatMap|sort|from)$/
const reads = []
const renderCalls = new Set()
const visit = (n, parent, stack) => {
  let st = stack
  if (isFn(n) && n !== comp) {
    const syncArg = parent && parent.type === 'CallExpression' && parent.arguments.includes(n)
      && parent.callee.type === 'MemberExpression' && !parent.callee.computed && SYNC.test(parent.callee.property.name)
    const iife = parent && parent.type === 'CallExpression' && parent.callee === n
    if (!syncArg && !iife) st = [...stack, { role: roleOf(n, parent), name: fnNameOf.get(n) || null, line: n.loc.start.line }]
  }
  if (n.type === 'MemberExpression' && !n.computed && n.object.type === 'Identifier' && n.object.name === '__heavy'
    && n.property.name !== 'put' && n.property.name !== 'commit') {
    const committed = n.property.name === 'committed'
    const field = committed ? (parent && parent.type === 'MemberExpression' && parent.object === n && !parent.computed ? parent.property.name : null) : n.property.name
    const ctx = !st.length ? 'render' : (st.length === 1 && st[0].role === 'memo') ? 'render'
      : (st.length === 1 && st[0].role === 'effect') ? 'effect' : 'after'
    const owner = st.find((s) => s.name)
    reads.push({ line: n.loc.start.line, field, committed, ctx, owner: owner ? owner.name : null, top: st[0] ? `${st[0].role}@${st[0].line}` : 'body' })
  }
  if (n.type === 'CallExpression' && n.callee.type === 'Identifier' && (!st.length || (st.length === 1 && st[0].role === 'memo'))) renderCalls.add(n.callee.name)
  for (const c of kids(n)) visit(c, n, st)
}
for (const s of comp.body.body) visit(s, comp.body, [])
// ⭐ THE PASS ITSELF (imperative switch, stage 1): `updateChart`'s body is the module-level `applyFrame(ctx, frame)`
// now, handed the box as `frame.__heavy`. It runs after a commit (from `updateChart`, or from the switch
// controller with a box it built), so every read in it is an AFTER read, owned by `applyFrame`.
const pass = ast.body.find((s) => s.type === 'FunctionDeclaration' && s.id && s.id.name === 'applyFrame')
const bodyReads = reads.length
if (pass) visit(pass.body, pass, [{ role: 'fn', name: 'applyFrame', line: pass.loc.start.line }])
// a body-level function called while rendering (and what IT calls) runs at render time
const bodyFn = new Map([...fnNameOf].map(([f, nm]) => [nm, f]))
const callsIn = (f) => { const out = new Set(); const v = (n) => { if (n.type === 'CallExpression' && n.callee.type === 'Identifier') out.add(n.callee.name); for (const c of kids(n)) if (!isFn(c)) v(c) }; v(f.body); return out }
for (let grew = true; grew;) {
  grew = false
  for (const nm of [...renderCalls]) { const f = bodyFn.get(nm); if (f) for (const c of callsIn(f)) if (!renderCalls.has(c)) { renderCalls.add(c); grew = true } }
}
for (const r of reads) if (r.ctx === 'after' && r.owner && renderCalls.has(r.owner)) r.ctx = 'render'
const where = (r) => `StockChart.jsx:${r.line} ${r.committed ? '__heavy.committed.' : '__heavy.'}${r.field} (${r.owner || r.top})`

describe('StockChart: every render-box read is the right one for when it runs', () => {
  it('found the box and its reads (a census that finds nothing proves nothing)', () => {
    expect(comp).toBeTruthy()
    expect(reads.filter((r) => r.ctx === 'after').length).toBeGreaterThan(100)
    expect(reads.filter((r) => r.ctx === 'render').length).toBeGreaterThan(50)
    expect(reads.every((r) => r.field)).toBe(true)
  })
  it('code that runs after a commit reads the COMMITTED copy', () => {
    expect(reads.filter((r) => r.ctx === 'after' && !r.committed).map(where)).toEqual([])
  })
  it('code that runs during a render reads the render in progress, never the committed copy', () => {
    expect(reads.filter((r) => r.ctx === 'render' && r.committed).map(where)).toEqual([])
  })
  it('the event-time readers the review named are among them', () => {
    const owners = new Set(reads.filter((r) => r.ctx === 'after' && r.committed).map((r) => r.owner))
    for (const nm of ['applyFrame', 'applyRange', 'centerFirstBar', 'replayToggle', 'replayStep', 'replayIndexChange']) expect(owners).toContain(nm)
    // the pass was found, its reads are the bulk of the after-commit ones, and `updateChart` only hands the box on
    expect(pass).toBeTruthy()
    expect(reads.length - bodyReads).toBeGreaterThan(60)
    expect(owners.has('updateChart')).toBe(false)
    // the store's developing-bar paint (a rAF-coalesced store callback), assigned to a ref in the body
    expect(src).toMatch(/_storeDevPaintRef\.current = \(afterSetData = false\) => \{[\s\S]{0,4000}__heavy\.committed\./)
  })
})
