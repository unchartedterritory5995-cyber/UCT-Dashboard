// ⛔ Rail: StockChart's six big chart-data arrays are never NAMED inside an inner function (2026-11-12).
//
// V8 gives each render one shared scope for every function created in it and keeps that scope while
// any of those functions lives; React keeps each effect's cleanup from the render it last ran in. So an
// array an inner function names is pinned by every old render some effect still remembers. The
// 2026-11-12 market-day soak measured the renderer heap floor climbing ~150-230 MB/h; a heap snapshot
// found 478 chart-data arrays alive for 4 charts, 494 of them held by ~82 old render scopes through these
// six names. Inner functions read them from the stable `_big` holder instead.
//
// Allowed: the declaration, dependency arrays (evaluated during render), plain render-level expressions,
// JSX props, and the `_big.x = x` mirror. Not allowed: the bare name inside ANY nested function.
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { parse } from '@babel/parser'
import { describe, expect, it } from 'vitest'

const SRC = readFileSync(path.resolve(globalThis.process.cwd(), 'src/components/StockChart.jsx'), 'utf8')
const BIG = ['ohlcData', 'goldOhlc', 'fadedOhlc', 'closeData', 'volData', 'fadedVolData']

const FN = new Set(['ArrowFunctionExpression', 'FunctionExpression', 'FunctionDeclaration', 'ObjectMethod', 'ClassMethod'])

/** Every bare reference to `names` that sits inside a function nested within `component`. */
export function capturedReferences(source, componentName, names) {
  const ast = parse(source, { sourceType: 'module', plugins: ['jsx'], errorRecovery: true })
  const wanted = new Set(names)
  const hits = []
  let component = null
  const findComponent = (node) => {
    if (!node || typeof node !== 'object' || component) return
    if ((node.type === 'FunctionDeclaration' && node.id?.name === componentName)
      || (node.type === 'VariableDeclarator' && node.id?.name === componentName && node.init && FN.has(node.init.type))) {
      component = node.type === 'VariableDeclarator' ? node.init : node
      return
    }
    for (const k of Object.keys(node)) {
      const v = node[k]
      if (Array.isArray(v)) v.forEach(findComponent)
      else if (v && typeof v.type === 'string') findComponent(v)
    }
  }
  findComponent(ast.program)
  if (!component) throw new Error(`no ${componentName} component found`)
  const walk = (node, depth, parent, key) => {
    if (!node || typeof node !== 'object') return
    if (FN.has(node.type) && node !== component) depth += 1
    if (node.type === 'Identifier' && wanted.has(node.name) && depth > 0) {
      const isProp = parent && (parent.type === 'MemberExpression' || parent.type === 'OptionalMemberExpression') && key === 'property' && !parent.computed
      const isKey = parent && parent.type === 'ObjectProperty' && key === 'key' && !parent.computed
      if (!isProp && !isKey) hits.push({ name: node.name, line: node.loc.start.line })
    }
    for (const k of Object.keys(node)) {
      if (k === 'loc' || k === 'start' || k === 'end') continue
      const v = node[k]
      if (Array.isArray(v)) v.forEach((c) => walk(c, depth, node, k))
      else if (v && typeof v.type === 'string') walk(v, depth, node, k)
    }
  }
  walk(component.body, 0, null, null)
  return hits
}

describe('StockChart render-scope leak rail', () => {
  it('no inner function names one of the six chart-data arrays', () => {
    const hits = capturedReferences(SRC, 'StockChart', BIG)
    expect(hits, `captured: ${hits.map((h) => `${h.name}@${h.line}`).join(', ')}`).toEqual([])
  })

  it('every one of the six is mirrored into the holder', () => {
    for (const n of BIG) expect(SRC).toContain(`_big.${n} = ${n}`)
  })

  it('the probe can fail: a captured name in a nested function is reported', () => {
    const sample = `function StockChart(){ const volData = useMemo(() => [], []); useEffect(() => { use(volData) }, [volData]); const ok = [volData]; return null }`
    expect(capturedReferences(sample, 'StockChart', ['volData'])).toEqual([{ name: 'volData', line: 1 }])
    const clean = `function StockChart(){ const volData = useMemo(() => [], []); const _big = {}; useEffect(() => { use(_big.volData) }, [volData]); return <X v={volData} /> }`
    expect(capturedReferences(clean, 'StockChart', ['volData'])).toEqual([])
  })
})
