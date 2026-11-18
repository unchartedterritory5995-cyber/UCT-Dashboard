// app/src/components/chart/builder/memberPane/costRouteParity.js
//
// ⭐⭐ ROUTE BY COST (Engine 73 (#1711)) — THE TWO LANES' VALUES FOR ONE SCRIPT, OUTPUT BY OUTPUT.
//
// Read by the route's parity rail (`routeByCost.test.js`) and its measurement
// (`ast/hostLaneCost.measure.test.js`), never by the product: a moved script must compute the same
// values on the runtime lane as on the host lane it left, and this is how that is asked.
//   · rows are matched as the vendor harness matches them (`ourSide.js`): a host row by the tree of
//     the translation output it draws, a runtime row by the output index it names;
//   · values are compared by the run-half rail's own rule (`nativeRegistry.sameColumnValue`: equal,
//     both `na`, or within 1e-9 of their size), imported, never restated.
import { sameColumnValue } from '../../engine/nativeRegistry'

/** translation output index -> `{key, title, col}`: the column a lane's answer drew for it. */
export function columnsByOutput(built, cols) {
  const out = new Map()
  const rows = (built && built.rows) || []
  const byAst = new Map(rows.map((r) => [r.ast, r]))
  const byOutput = new Map(rows.filter((r) => Number.isInteger(r.output)).map((r) => [r.output, r]))
  const runtime = !!(built && built.definition && built.definition.compute && built.definition.compute.kind === 'runtime')
  for (const [index, o] of ((built && built.translation && built.translation.outputs) || []).entries()) {
    if (!o || o.kind === 'alertcondition') continue
    const row = runtime ? byOutput.get(index) : (o.ast ? byAst.get(o.ast) : null)
    const col = row && cols ? cols[row.key] : null
    if (col && typeof col.length === 'number') out.set(index, { key: row.key, title: o.title || null, col })
  }
  return out
}

/** The two lanes, output by output, bar by bar: `equal`, `hostOnly` (the host drew, the run withheld
 *  the bar), `runOnly`, `differ` (both drew, different values) and the first difference. */
export function parityOf(hostBuilt, hostCols, runBuilt, runCols) {
  const h = columnsByOutput(hostBuilt, hostCols)
  const r = columnsByOutput(runBuilt, runCols)
  const rows = []
  for (const [index, hc] of h) {
    const rc = r.get(index)
    if (!rc) { rows.push({ output: index, title: hc.title, runtime: 'absent' }); continue }
    let equal = 0
    let hostOnly = 0
    let runOnly = 0
    let differ = 0
    let firstDiffer = null
    const n = Math.min(hc.col.length, rc.col.length)
    for (let i = 0; i < n; i += 1) {
      const a = hc.col[i]
      const b = rc.col[i]
      if (sameColumnValue(a, b)) { equal += 1; continue }
      const an = typeof a !== 'number' || Number.isNaN(a)
      const bn = typeof b !== 'number' || Number.isNaN(b)
      if (bn && !an) hostOnly += 1
      else if (an && !bn) runOnly += 1
      else { differ += 1; if (firstDiffer === null) firstDiffer = { bar: i, host: a, run: b } }
    }
    rows.push({ output: index, title: hc.title, bars: n, equal, hostOnly, runOnly, differ, firstDiffer })
  }
  for (const [index, rc] of r) if (!h.has(index)) rows.push({ output: index, title: rc.title, host: 'absent' })
  return rows
}
