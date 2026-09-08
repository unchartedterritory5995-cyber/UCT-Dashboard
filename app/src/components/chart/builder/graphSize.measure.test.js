// app/src/components/chart/builder/graphSize.measure.test.js
//
// ─── C2C.9/.10: WHAT THE SAME DOCUMENTS WEIGH AS A SHARED GRAPH ─────────────
//
// A MEASUREMENT, and the one the wave is judged on. C2B established that the
// two DOCUMENT_SIZE_BLOCKED scripts are ~98.5% repetition and refused to move
// the cap. This asks the only question that settles whether the representation
// was the defect: **with the cap left exactly where it is, do those documents
// fit?**
//
// ⛔ NO GZIP. C2B used gzip as a lower bound on INFORMATION CONTENT, which is
// what it is good for; using it to make a document fit would be manipulating
// the benchmark rather than fixing the representation, and the owner named it.
// Every number below is raw canonical JSON, the same bytes
// `user_definitions.MAX_DEFINITION_BYTES` counts.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { translatePine } from '../engine/ast/pine'
import { expandGraph } from '../engine/ast/graph'
import { reduceIfOversized } from '../engine/ast/graphDocument'
import { treesHash } from '../engine/ast/trees'
import { memberInputTranslation } from './builderInputs'
import { buildDefinition } from './BuilderSheet.jsx'
import { evaluateFormula } from './FormulaField.jsx'
import { BUILDER_INPUT_SCOPE, BUILDER_INPUTS } from './builderInputs.js'

const OOS = path.resolve(process.cwd(), '../tests/fixtures/pine_oos')
const CAP = 64 * 1024
const bytes = (o) => Buffer.byteLength(JSON.stringify(o), 'utf8')

/** The V1 document the product saves today. Identical recipe to
 *  `documentSize.measure.test.js` so the two numbers are comparable. */
function documentFor(file) {
  const src = fs.readFileSync(path.join(OOS, `${file}.pine`), 'utf8')
  let t
  try { t = memberInputTranslation(translatePine, src, {}) } catch { return null }
  const outs = (t.outputs || []).filter((o) => o && o.ast && o.formula && !o.hidden).slice(0, 12)
  if (!outs.length) return null
  const rows = outs.map((o, i) => {
    const ev = evaluateFormula(o.formula, BUILDER_INPUT_SCOPE)
    return {
      key: i === 0 ? 'value' : `out${i + 1}`,
      label: o.title || '',
      source: o.formula,
      ast: o.ast,
      mode: ev.verdict ? ev.verdict.mode : 'clean',
      readback: ev.readback || '',
      style: 'line',
      color: BUILDER_INPUTS[0].default,
      width: BUILDER_INPUTS[1].default,
      hidden: false,
    }
  })
  try {
    return buildDefinition({
      defId: 'u_size00000000',
      name: file.slice(0, 40),
      source: rows[0].source,
      ast: rows[0].ast,
      mode: rows[0].mode,
      readback: rows[0].readback,
      plots: rows,
      placement: { target: 'pane' },
    })
  } catch { return null }
}

/**
 * The V2 document: the same definition with `compute.trees` (and the printed
 * `sources`, which the sheet can always re-derive from the graph) replaced by
 * `compute.graph`. Identity fields are deliberately KEPT and deliberately
 * UNCHANGED — that is the C2C.7 contract made visible in the artifact.
 */
function toV2(doc) {
  // ⛔ THE PRODUCT'S OWN SAVE-DOOR FUNCTION, NOT A LOCAL RE-IMPLEMENTATION.
  // `reduceIfOversized` is what `saveUserDefinition` calls, so this measurement
  // answers "what would actually be stored" rather than "what a graph of these
  // trees would weigh" — two questions that differ by every refusal the
  // conversion can make (a parameter it cannot place, a manifest it cannot
  // re-tag), and the second one is the flattering one.
  //
  // ⚠️ A BUDGET OF 1 FORCES THE ATTEMPT for every document, including the ones
  // that fit — this file is measuring the DISTRIBUTION, and the threshold is
  // measured on its own in `graphDocument.test.js`.
  const reduced = reduceIfOversized(doc, 1)
  return reduced === doc ? null : reduced
}

const pctl = (arr, p) => {
  const s = [...arr].sort((a, b) => a - b)
  return s.length ? s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))] : 0
}

describe('C2C.9 — V1 vs V2 document size across the frozen 60', () => {
  it('the distribution, and how many clear the UNCHANGED cap', () => {
    const files = fs.readdirSync(OOS).filter((f) => f.endsWith('.pine')).sort()
    const rows = []
    for (const f of files) {
      const name = f.replace(/\.pine$/, '')
      const doc = documentFor(name)
      if (!doc) continue
      let v2
      try { v2 = toV2(doc) } catch { v2 = null }
      if (!v2) continue
      const trees = (doc.compute || {}).trees || { value: doc.compute.ast }
      rows.push({
        name,
        v1: bytes(doc),
        v2: bytes(v2),
        nodesV1: Object.values(trees).reduce((n, t) => n + JSON.stringify(t).length, 0),
        graphNodes: v2.compute.graph.nodes.length,
        trees: Object.keys(trees).length,
      })
    }
    const v1s = rows.map((r) => r.v1)
    const v2s = rows.map((r) => r.v2)
    const overV1 = rows.filter((r) => r.v1 > CAP)
    const overV2 = rows.filter((r) => r.v2 > CAP)
    const worst = [...rows].sort((a, b) => b.v1 - a.v1).slice(0, 6)
    // eslint-disable-next-line no-console
    console.log(`\n=== C2C.9 DOCUMENT SIZE, V1 vs V2, ${rows.length} buildable, cap ${CAP} UNCHANGED ===\n`
      + `  V1  P50=${pctl(v1s, 50)}  P90=${pctl(v1s, 90)}  MAX=${Math.max(...v1s)}  over cap ${overV1.length}/${rows.length}\n`
      + `  V2  P50=${pctl(v2s, 50)}  P90=${pctl(v2s, 90)}  MAX=${Math.max(...v2s)}  over cap ${overV2.length}/${rows.length}\n`
      + '  the six heaviest V1 documents:\n'
      + worst.map((r) => `    ${String(r.v1).padStart(7)}B -> ${String(r.v2).padStart(6)}B  `
        + `x${(r.v1 / r.v2).toFixed(1)}  ${r.trees} trees, ${r.graphNodes} distinct nodes  `
        + `${r.v2 <= CAP ? 'FITS' : 'STILL OVER'}  ${r.name}`).join('\n'))
    expect(rows.length).toBeGreaterThan(10)
    // ⛔ THE FINDING, ASSERTED — not merely printed. If a future change stops
    // the representation from paying for itself, this goes red rather than
    // quietly printing a worse number nobody reads.
    expect(overV2.length).toBeLessThan(overV1.length)
  })
})

describe('C2C.10 — the two blocked documents, against the cap as it stands', () => {
  for (const name of ['high_engagement__03-supertrend-kivancozbilgic',
    'mid_engagement__22-rsi-levels-regime-map']) {
    it(name, () => {
      const doc = documentFor(name)
      expect(doc, 'the V1 document should build').toBeTruthy()
      const v2 = toV2(doc)
      const trees = doc.compute.trees
      const graph = v2.compute.graph
      const v1b = bytes(doc)
      const v2b = bytes(v2)
      // eslint-disable-next-line no-console
      console.log(`\n=== ${name} ===\n`
        + `  V1 ${v1b}B (x${(v1b / CAP).toFixed(1)} the cap)  ->  V2 ${v2b}B `
        + `(${v2b <= CAP ? `${((100 * v2b) / CAP).toFixed(0)}% of the cap — FITS` : 'STILL OVER'})\n`
        + `  inlined nodes across ${Object.keys(trees).length} trees: `
        + `${Object.values(trees).reduce((n, t) => n + countNodes(t), 0)}  ->  `
        + `${graph.nodes.length} distinct  (${(100 - (100 * graph.nodes.length)
          / Object.values(trees).reduce((n, t) => n + countNodes(t), 0)).toFixed(1)}% was repetition)`)
      // ⭐ AND THE PROGRAM IS UNCHANGED. A document that fits because it lost
      // maths is not a smaller document; it is a different indicator.
      expect(treesHash(expandGraph(graph))).toBe(doc.compute.treesHash)
      expect(v2b).toBeLessThan(v1b)
    })
  }
})

function countNodes(n) {
  if (!n || typeof n !== 'object') return 0
  let c = 1
  if (Array.isArray(n.args)) for (const a of n.args) c += countNodes(a)
  return c
}
