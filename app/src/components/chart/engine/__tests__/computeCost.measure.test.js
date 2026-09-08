// app/src/components/chart/engine/__tests__/computeCost.measure.test.js
//
// ─── C2A.4 + C2A.6: WHAT REAL IMPORTS ACTUALLY COST ─────────────────────────
//
// A MEASUREMENT, not a rail. Two questions the budget policy cannot be set
// without:
//
//   1. Does this engine recompute identical canonical subtrees once per output?
//      Complex Pine reuses an EMA/ATR/RSI across several plots as a matter of
//      course, so the answer decides whether the cost is in the SCRIPTS or in the
//      way we run them.
//   2. What does the accepted corpus actually cost — nodes, outputs, bars, wall
//      clock — so that any limit is derived from the distribution rather than
//      from the one script that failed.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { translatePine, printFormula } from '../ast/pine'
import { interpret, nodeCount } from '../ast/interpret'
import { DEFAULT_BUDGET } from '../ast/budget'
import { memberInputTranslation } from '../../builder/builderInputs'

const OOS = path.resolve(process.cwd(), '../tools/c0_oos_fixtures')
const N_CHART = 5000

const bars = (n) => Array.from({ length: n }, (_, i) => ({
  t: 1500000000 + i * 86400,
  o: 100 + Math.sin(i / 11) * 8, h: 104 + Math.sin(i / 11) * 8,
  l: 96 + Math.sin(i / 11) * 8, c: 100 + Math.sin(i / 7) * 9,
  v: 1_000_000 + (i % 53) * 5000,
}))

function carried(file) {
  const src = fs.readFileSync(path.join(OOS, `${file}.pine`), 'utf8')
  const t = memberInputTranslation(translatePine, src, {})
  const outs = (t.outputs || []).filter((o) => o && o.ast && o.formula && !o.hidden).slice(0, 12)
  const inputs = {}
  for (const o of outs) for (const r of (o.memberInputs || [])) inputs[r.key] = r.default
  return { outs, inputs }
}

/**
 * Every subtree of a set of trees, keyed by its printed form.
 *
 * ⛔ THE PRINTED FORM IS THE IDENTITY, and it is the RIGHT one here: two subtrees
 * that print the same are the same canonical expression over the same table, which
 * is exactly the equality a reuse cache would need. Object identity would answer a
 * different (and much rarer) question — whether the translator happened to share
 * the node — and would under-report the duplication badly.
 */
function subtreeCensus(trees) {
  const seen = new Map()
  const walk = (n) => {
    if (!n || typeof n !== 'object' || !n.type) return
    // Leaves are not worth counting: `close` appearing nine times is not waste.
    const nodes = nodeCount(n)
    if (nodes >= 3) {
      let key
      try { key = printFormula(n) } catch { key = null }
      if (key) seen.set(key, { count: (seen.get(key)?.count || 0) + 1, nodes })
    }
    if (Array.isArray(n.args)) for (const a of n.args) walk(a)
  }
  for (const t of trees) walk(t)
  return seen
}

describe('C2A.4 — is identical work done more than once?', () => {
  const SCRIPTS = [
    'mid_engagement__14-master-line-lite',
    'high_engagement__12-cm-ultimate-rsi-mtf-chrismoody',
    'mid_engagement__07-3way-bollinger-trend',
    'high_engagement__24-coppock-curve-multi-filter-markittick',
  ]

  it('duplicated canonical subtrees across a document\'s outputs', () => {
    const lines = []
    let worst = 0
    for (const f of SCRIPTS) {
      let c
      try { c = carried(f) } catch { continue }
      const trees = c.outs.map((o) => o.ast)
      if (trees.length < 2) continue
      const census = subtreeCensus(trees)
      let total = 0
      let wasted = 0
      const top = []
      for (const [expr, { count, nodes }] of census) {
        total += nodes * count
        if (count > 1) {
          wasted += nodes * (count - 1)
          top.push([count, nodes, expr])
        }
      }
      top.sort((a, b) => (b[0] * b[1]) - (a[0] * a[1]))
      const pct = total ? Math.round((wasted / total) * 100) : 0
      worst = Math.max(worst, pct)
      lines.push(`\n  ${f}`)
      lines.push(`    outputs=${trees.length}  counted-nodes=${total}  repeated=${wasted} (${pct}%)`)
      for (const [count, nodes, expr] of top.slice(0, 3)) {
        lines.push(`      ×${count} (${nodes} nodes)  ${expr.slice(0, 92)}`)
      }
    }
    // eslint-disable-next-line no-console
    console.log(`\n=== C2A.4 DUPLICATED SUBTREES ===${lines.join('\n')}`)
    expect(lines.length).toBeGreaterThan(0)
    // ⛔ THE FINDING, ASSERTED. Repetition in these documents is not a rounding
    // error — it is most of the tree (measured 77-84%) — and it is the same fact
    // that sizes C2B's document bloat. A change that quietly de-duplicated at
    // translation time would drop this sharply, which is worth being told about.
    expect(worst, 'the most-duplicated document should be heavily repeated')
      .toBeGreaterThan(50)
  })
})

describe('C2A.6 — the execution-cost distribution of the accepted corpus', () => {
  it('nodes, outputs and wall clock at chart scale', () => {
    const files = fs.readdirSync(OOS).filter((f) => f.endsWith('.pine')).sort()
    const B = bars(N_CHART)
    const rows = []
    for (const f of files) {
      const name = f.replace(/\.pine$/, '')
      let c
      try { c = carried(name) } catch { continue }
      if (!c.outs.length) continue
      let nodes = 0
      let ms = 0
      let ok = 0
      let failed = 0
      for (const o of c.outs) {
        nodes += nodeCount(o.ast)
        const t0 = Date.now()
        try { interpret(o.ast, B, c.inputs, DEFAULT_BUDGET); ok += 1 } catch { failed += 1 }
        ms += Date.now() - t0
      }
      rows.push({ name, outputs: c.outs.length, nodes, ms, ok, failed })
    }
    const pct = (arr, p) => {
      const s = [...arr].sort((a, b) => a - b)
      return s.length ? s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))] : 0
    }
    const dist = (label, vals) => `  ${label.padEnd(22)} `
      + `P50=${pct(vals, 50)}  P75=${pct(vals, 75)}  P90=${pct(vals, 90)}  `
      + `P95=${pct(vals, 95)}  MAX=${Math.max(...vals)}`
    const slow = [...rows].sort((a, b) => b.ms - a.ms).slice(0, 6)
    // eslint-disable-next-line no-console
    console.log(`\n=== C2A.6 EXECUTION COST, ${rows.length} scripts, ${N_CHART} bars ===\n`
      + `${dist('outputs/script', rows.map((r) => r.outputs))}\n`
      + `${dist('total nodes/script', rows.map((r) => r.nodes))}\n`
      + `${dist('total ms/script', rows.map((r) => r.ms))}\n`
      + `  scripts with >=1 column refused: ${rows.filter((r) => r.failed).length}/${rows.length}\n`
      + `  slowest:\n${slow.map((r) => `    ${String(r.ms).padStart(5)}ms  ${r.outputs} outputs  ${r.nodes} nodes  ${r.name}`).join('\n')}`)
    expect(rows.length).toBeGreaterThan(10)
  })
})
