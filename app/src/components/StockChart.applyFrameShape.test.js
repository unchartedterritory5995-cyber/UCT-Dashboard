import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Parser } from 'acorn'
import jsx from 'acorn-jsx'

// ⛔⛔ WHAT `updateChart` HANDS OVER IS WHAT `applyFrame` TAKES APART (imperative switch, stage 1).
//
// The chart's pass is the module-level `applyFrame(ctx, frame)` (StockChart.jsx, below the component). It reads
// its inputs by name out of two objects: `ctx` (the chart's refs and state setters) and `frame` (what one pass
// reads of a render). `updateChart` builds both. A name `applyFrame` destructures that `updateChart` does not
// hand over is `undefined` inside the pass, silently: a setting that reads as off, a ref that throws only on the
// branch that touches it. So the two lists are held equal here, name for name, and every entry is a plain
// shorthand (a renamed or computed entry is a second place for the two to drift).
//
// The scan is over the syntax tree, so a name inside a comment or a string is never an entry (self-check below).

const HERE = dirname(fileURLToPath(import.meta.url))
const SRC = readFileSync(join(HERE, 'StockChart.jsx'), 'utf8')

const parse = (src) => Parser.extend(jsx()).parse(src, { ecmaVersion: 'latest', sourceType: 'module', locations: true })
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

/** The names of an object literal / pattern, or the first entry that is not a plain shorthand `name`. */
function shorthandNames(node) {
  const names = []
  for (const p of node.properties) {
    if (p.type !== 'Property' || p.computed || !p.shorthand || p.key.type !== 'Identifier') return { names, bad: `line ${p.loc.start.line}` }
    // a pattern entry with a default (`{ a = 1 }`) is shorthand too: its value is an AssignmentPattern
    if (p.value.type !== 'Identifier' || p.value.name !== p.key.name) return { names, bad: `line ${p.loc.start.line}` }
    names.push(p.key.name)
  }
  return { names, bad: null }
}

/** `{ handed: {ctx, frame}, taken: {ctx, frame}, calls }` of one source text. */
function shapeOf(src) {
  const ast = parse(src)
  const pass = ast.body.find((s) => s.type === 'FunctionDeclaration' && s.id && s.id.name === 'applyFrame')
  const comp = ast.body.find((s) => s.type === 'FunctionDeclaration' && s.id && s.id.name === 'StockChartBody')
  if (!pass || !comp) return null
  const params = pass.params.map((p) => (p.type === 'Identifier' ? p.name : null))
  const taken = {}
  for (const st of pass.body.body.slice(0, 2)) {
    const d = st.type === 'VariableDeclaration' && st.declarations.length === 1 ? st.declarations[0] : null
    if (d && d.id.type === 'ObjectPattern' && d.init && d.init.type === 'Identifier') taken[d.init.name] = shorthandNames(d.id)
  }
  const decl = comp.body.body.find((s) => s.type === 'VariableDeclaration' && s.declarations[0].id.name === 'updateChart')
  const fn = decl && decl.declarations[0].init.arguments[0]
  const handed = {}
  const calls = []
  if (fn) {
    for (const st of fn.body.body) {
      const d = st.type === 'VariableDeclaration' && st.declarations.length === 1 ? st.declarations[0] : null
      if (d && d.id.type === 'Identifier' && d.init && d.init.type === 'ObjectExpression') handed[d.id.name] = shorthandNames(d.init)
    }
    ;(function walk(n) {
      if (n.type === 'CallExpression' && n.callee.type === 'Identifier' && n.callee.name === 'applyFrame') calls.push(n.arguments.map((a) => (a.type === 'Identifier' ? a.name : null)))
      for (const c of kids(n)) walk(c)
    })(fn.body)
  }
  // the callback's statements, each by what it is (stage 3: the stale-render guard, the two objects, the pass)
  const text = (n) => src.slice(n.start, n.end)
  const kinds = (fn ? fn.body.body : []).map((st) => {
    if (st.type === 'IfStatement' && st.consequent.type === 'ReturnStatement' && !st.alternate) return `guard:${text(st.test)}`
    if (st.type === 'VariableDeclaration') return `const:${st.declarations[0].id.name}`
    if (st.type === 'IfStatement' && st.alternate) return `pass:${text(st.test)}?${text(st.consequent)}:${text(st.alternate)}`
    if (st.type === 'ExpressionStatement') return `call:${text(st.expression)}`
    return st.type
  })
  return { params, taken, handed, calls, statements: fn ? fn.body.body.length : 0, kinds }
}

describe('StockChart: updateChart hands applyFrame exactly the names it takes apart', () => {
  const shape = shapeOf(SRC)

  it('found the pass and the callback (a rail that finds nothing proves nothing)', () => {
    expect(shape).toBeTruthy()
    expect(shape.params).toEqual(['ctx', 'frame'])
    expect(shape.taken.ctx.names.length).toBeGreaterThan(80)
    expect(shape.taken.frame.names.length).toBeGreaterThan(80)
    expect(shape.calls).toEqual([['ctx', 'frame']])
  })

  it('every entry on both sides is a plain shorthand name', () => {
    for (const side of [shape.taken.ctx, shape.taken.frame, shape.handed.ctx, shape.handed.frame]) expect(side.bad).toBe(null)
  })

  it('ctx: the names handed over are the names taken apart', () => {
    expect([...shape.handed.ctx.names].sort()).toEqual([...shape.taken.ctx.names].sort())
    expect(new Set(shape.taken.ctx.names).size).toBe(shape.taken.ctx.names.length)
  })

  it('frame: the names handed over are the names taken apart', () => {
    expect([...shape.handed.frame.names].sort()).toEqual([...shape.taken.frame.names].sort())
    expect(new Set(shape.taken.frame.names).size).toBe(shape.taken.frame.names.length)
  })

  it('no name is on both lists, and the render box travels in the frame', () => {
    const both = shape.taken.ctx.names.filter((n) => shape.taken.frame.names.includes(n))
    expect(both).toEqual([])
    expect(shape.taken.frame.names).toContain('__heavy')
  })

  it('updateChart is the hand-off and nothing else', () => {
    // Four statements, each named: the stale-render guard (stage 3: a pass of the symbol an imperative switch
    // replaced paints nothing), `const ctx = {…}`, `const frame = {…}`, and the pass: through the switch
    // controller when the chart has one (it runs the same `applyFrame`), `applyFrame(ctx, frame)` when it has
    // none, which is the switch OFF. A statement that paints from inside the callback would be a second copy
    // of the series logic.
    expect(shape.statements).toBe(4)
    expect(shape.kinds).toEqual([
      'guard:switchCtl && switchCtl.staleFor(sym)',
      'const:ctx',
      'const:frame',
      'pass:switchCtl?switchCtl.reactPass(ctx, frame):applyFrame(ctx, frame)',
    ])
  })

  describe('self-check: the scan can fail, and a comment or a string is not an entry', () => {
    const tiny = (handCtx, handFrame, body = '') => `
      function StockChartBody() {
        const updateChart = useCallback(() => {
          const ctx = { ${handCtx} }
          const frame = { ${handFrame} }
          applyFrame(ctx, frame)
        }, [])
      }
      function applyFrame(ctx, frame) {
        const { aRef, bRef } = ctx
        const { __heavy, sym } = frame
        ${body}
      }`
    it('equal lists read equal', () => {
      const s = shapeOf(tiny('aRef, bRef', '__heavy, sym'))
      expect(s.handed.ctx.names).toEqual(s.taken.ctx.names)
      expect(s.handed.frame.names).toEqual(s.taken.frame.names)
    })
    it('a name not handed over is seen', () => {
      const s = shapeOf(tiny('aRef', '__heavy, sym'))
      expect(s.handed.ctx.names).not.toEqual(s.taken.ctx.names)
    })
    it('the same name inside a comment or a string is not a match', () => {
      const s = shapeOf(tiny('aRef /* bRef, */', "__heavy, sym", "const note = 'bRef, cRef' // dRef"))
      expect(s.handed.ctx.names).toEqual(['aRef'])
      expect(s.taken.ctx.names).toEqual(['aRef', 'bRef'])
    })
    it('a renamed entry is not a plain shorthand', () => {
      const s = shapeOf(tiny('aRef, bRef: other', '__heavy, sym'))
      expect(s.handed.ctx.bad).not.toBe(null)
    })
  })
})
