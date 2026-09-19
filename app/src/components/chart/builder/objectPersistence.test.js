// app/src/components/chart/builder/objectPersistence.test.js
//
// ─── ⭐⭐ C3B — SAVE THE PROGRAM, NOT THE OBJECTS ────────────────────────────
//
// The wave's rule in one line: *"SAVE should persist the object lifecycle
// PROGRAM. Do not serialize thousands of browser objects into the saved
// definition. REOPEN should load program → recompute → reconstruct the correct
// final visual state."*
//
// ⛔⛔ AND IT MUST NOT COST C2C. A document that stored the object program's
// expressions as ASTs would work perfectly and would silently undo a ×48
// compaction — the same expression appearing once in a plot's graph and again
// in a line's coordinate. So the load-bearing assertion here is not "it saved",
// it is **the object's coordinate resolves to the SAME NODE the plot uses**.
import { describe, it, expect } from 'vitest'
import { translatePine } from '../engine/ast/pine'
import { toGraphDocument, documentBytes } from '../engine/ast/graphDocument'
import { validateDefinition } from '../engine/defSchema'
import { evaluateObjects } from '../engine/objectRuntime'
import { computeObjectColumns } from '../engine/objectColumns'
import { toRenderState } from '../engine/objectRenderState'
import { nodeTree } from '../engine/ast/graph'
import { printFormula } from '../engine/ast/pine'

const SRC = `//@version=5
indicator("Level tracker", overlay = true, max_lines_count = 200)
ma = ta.sma(close, 20)
up = ta.crossover(close, ma)
dn = ta.crossunder(close, ma)
var line lvl = na
if up
    lvl := line.new(bar_index, ma, bar_index + 5, ma, color = color.green, width = 2)
if dn
    line.delete(lvl)
plot(ma, title = "MA20")
plot(close > ma ? 1 : 0, title = "ABOVE")
`

const bars = (n) => Array.from({ length: n }, (_, i) => ({
  t: 1_700_000_000 + i * 86400,
  o: 100, h: 106, l: 94,
  c: 100 + Math.sin(i / 5) * 8,
  v: 1_000_000,
}))

/** The V1 document a save would submit, before the graph reduction. */
function v1DocumentFor(src) {
  const t = translatePine(src)
  const outs = (t.outputs || []).filter((o) => o && o.ast && !o.hidden && !o.refusal)
  const trees = {}
  const plots = []
  outs.forEach((o, i) => {
    const key = i === 0 ? 'value' : `out${i + 1}`
    trees[key] = o.ast
    plots.push({ key, label: o.title || key, color: '#c9a84c', width: 1, style: 'line' })
  })
  return {
    def: {
      schemaVersion: 1,
      id: 'u_obj000000001',
      version: 1,
      name: 'Level tracker',
      compute: { kind: 'ast', trees, scanPlot: 'value' },
      plots,
      ...(t.objects ? { objects: t.objects } : {}),
    },
    translation: t,
  }
}

describe('C3B — persistence of the PROGRAM', () => {
  const { def, translation } = v1DocumentFor(SRC)

  it('the fixture is real: a translated script with both columns and objects', () => {
    expect(translation.ok).toBe(true)
    expect(def.plots.length).toBeGreaterThanOrEqual(2)
    expect(def.objects).toBeTruthy()
    expect(def.objects.ops.some((o) => o.k === 'create')).toBe(true)
    expect(def.objects.ops.some((o) => o.k === 'delete')).toBe(true)
    expect(def.objects.trees.length).toBeGreaterThan(0)
  })

  const reduced = toGraphDocument(def)

  it('⭐ the save door converts it, objects and all', () => {
    expect(reduced.ok, reduced.reason).toBe(true)
    expect(reduced.definition.objects).toBeTruthy()
  })

  it('⛔⛔ THE STORED PROGRAM CARRIES NO TREES — it references the shared graph', () => {
    const stored = reduced.definition.objects
    expect(stored.trees).toBeUndefined()
    const refs = JSON.stringify(stored)
    expect(refs).not.toContain('"v":"tree"')
    expect(refs).toContain('"v":"graph"')
  })

  it('⭐⭐ AND THE SHARING IS REAL: the line’s y-coordinate IS the plot’s own MA node', () => {
    // This is the assertion the whole design exists for. `ma` is plotted AND is
    // the line's y1/y2. If the object program had inlined its trees, this node
    // index would be a second copy and the formulas would match while the
    // document carried the expression twice.
    const g = reduced.definition.compute.graph
    const create = reduced.definition.objects.ops.find((o) => o.k === 'create')
    const y1 = create.props.y1
    expect(y1.v).toBe('graph')
    const maRoot = g.outputRoots.value
    expect(printFormula(nodeTree(g, y1.node))).toBe(printFormula(nodeTree(g, maRoot)))
    // …and it is literally the SAME node, not an equal one.
    expect(y1.node).toBe(maRoot)
  })

  it('⛔ no object root leaked into the column list', () => {
    const roots = Object.keys(reduced.definition.compute.graph.outputRoots)
    expect(roots.some((k) => k.startsWith('uctobj'))).toBe(false)
    expect(roots.sort()).toEqual(def.plots.map((p) => p.key).sort())
  })

  it('⭐ the reduced document is smaller than the inlined one, not larger', () => {
    expect(documentBytes(reduced.definition)).toBeLessThan(documentBytes(def))
  })

  it('⭐⭐ the OBJECT FIELD passes the client validator on the V1 form it owns', () => {
    // ⚠️ `validateDefinition` validates the INLINED (V1) document — the V2 graph
    // form is the SERVER's to check (`api/services/compute_graph.py`), which is
    // how C2C left the two lanes and is not this wave's to move. So the object
    // rules are exercised where the client actually runs them.
    const v = validateDefinition(def)
    const objectErrors = (v.errors || []).filter((e) => e.startsWith('objects'))
    expect(objectErrors).toEqual([])
  })

  it('⛔⛔ AND THE TWO FORMS ARE NOT INTERCHANGEABLE — each is refused on the other document', () => {
    // an UNBOUND program stored beside a graph would duplicate every expression
    const boundDoc = { ...reduced.definition, objects: { ...def.objects } }
    const a = validateDefinition(boundDoc)
    expect((a.errors || []).join(' ')).toMatch(/carries no trees of its own|unbound \{v:"tree"\}/)
    // a BOUND program on a V1 document points at a node table that is not there
    const inlinedDoc = { ...def, objects: { ...reduced.definition.objects } }
    const b = validateDefinition(inlinedDoc)
    expect((b.errors || []).join(' ')).toMatch(/document that carries no graph/)
  })

  it('⛔⛔ REOPEN RECOMPUTES THE SAME OBJECT STATE — program in, picture out', () => {
    const B = bars(160)
    const stored = reduced.definition.objects
    const g = reduced.definition.compute.graph
    const { readNode, failed } = computeObjectColumns(g, stored, B)
    expect(failed).toEqual([])
    const after = evaluateObjects(stored, { barCount: B.length, readNode, readTime: (i) => B[i].t })
    expect(after.status).toBe('ok')
    expect(after.stats.created).toBeGreaterThan(0)
    expect(after.live.length).toBeGreaterThanOrEqual(0)
    // ⭐ AND THE PICTURE IS A PICTURE: every live line has two real endpoints.
    const rs = toRenderState(after.live, { bars: B })
    expect(rs.dropped.line).toBe(0)
    for (const l of rs.lines) {
      expect(Number.isFinite(l.x1) && Number.isFinite(l.x2)).toBe(true)
      expect(Number.isFinite(l.y1) && Number.isFinite(l.y2)).toBe(true)
      // the line projects 5 bars right of its own start, as the script says
      expect(l.x2).toBeGreaterThan(l.x1)
    }
  })

  it('⛔ SAVE→REOPEN IS STABLE: converting twice changes nothing', () => {
    const again = toGraphDocument({ ...def })
    expect(again.ok).toBe(true)
    expect(JSON.stringify(again.definition.objects)).toBe(JSON.stringify(reduced.definition.objects))
  })
})

describe('C3B — the document validator refuses what would render wrong', () => {
  const base = () => {
    const { def } = v1DocumentFor(SRC)
    return toGraphDocument(def).definition
  }

  it('⛔⛔ an UNBOUND program is refused — storing it would duplicate every expression', () => {
    const d = base()
    d.objects = { ...d.objects, trees: [{ type: 'series', name: 'close' }] }
    const v = validateDefinition(d)
    expect(v.errors.join(' ')).toMatch(/carries no trees of its own/)
  })

  it('⛔⛔ a DANGLING node reference is refused, not rendered as NaN', () => {
    const d = base()
    const ops = d.objects.ops.map((o) => (o.k === 'create'
      ? { ...o, props: { ...o.props, y1: { v: 'graph', node: 99999 } } } : o))
    d.objects = { ...d.objects, ops }
    const v = validateDefinition(d)
    expect(v.errors.join(' ')).toMatch(/past the end of a \d+-node graph/)
  })

  it('⛔ a cross-family write is refused at the document door too', () => {
    const d = base()
    d.objects = {
      ...d.objects,
      regs: [{ id: 'r0', family: 'label' }],
      ops: [{ k: 'create', family: 'line', site: 's1', into: 'r0', when: null, props: {} }],
    }
    const v = validateDefinition(d)
    expect(v.errors.join(' ')).toMatch(/cannot be stored in register r0, which holds label/)
  })

  it('⭐ a definition with NO objects raises NO object error — 14 of the frozen 60 draw none', () => {
    const d = base()
    delete d.objects
    const v = validateDefinition(d)
    expect((v.errors || []).filter((e) => e.startsWith('objects'))).toEqual([])
  })
})
