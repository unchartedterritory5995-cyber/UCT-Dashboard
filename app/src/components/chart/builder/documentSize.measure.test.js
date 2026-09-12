// app/src/components/chart/builder/documentSize.measure.test.js
//
// ─── C2B.2/.3: WHAT A SAVED INDICATOR ACTUALLY WEIGHS ───────────────────────
//
// A MEASUREMENT. Two of the eighteen accepted OOS scripts are refused by
// `user_definitions.MAX_DEFINITION_BYTES` (64 KiB) at 362 KB and 370 KB, and the
// cap must not be moved before the bytes are understood.
//
// ⛔ THE QUESTION IS NOT "IS 64 KB TOO SMALL". It is whether those 362 KB are
// 362 KB of INDICATOR or 362 KB of REPRESENTATION. C2A already measured that
// 77-84% of the counted nodes in these documents are repeated subtrees — the same
// consensus expression written nineteen times — so the answer is not obvious and
// raising the cap without asking would enshrine the duplication.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import zlib from 'node:zlib'
import path from 'node:path'
import { translatePine } from '../engine/ast/pine'
import { memberInputTranslation } from './builderInputs'
import { buildDefinition } from './BuilderSheet.jsx'
import { evaluateFormula } from './FormulaField.jsx'
import { BUILDER_INPUT_SCOPE, BUILDER_INPUTS } from './builderInputs.js'

const OOS = path.resolve(process.cwd(), '../tests/fixtures/pine_oos')
const CAP = 64 * 1024

/** The canonical serialisation the store measures — sorted keys, no spaces. */
const canonical = (o) => JSON.stringify(o, Object.keys(o).sort().length ? undefined : undefined)
const bytes = (o) => Buffer.byteLength(JSON.stringify(o), 'utf8')

/** Build the document the product would save for a script, or null. */
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

/** Where a document's bytes go, by top-level section. */
function breakdown(doc) {
  const parts = {}
  const compute = doc.compute || {}
  parts['compute.ast'] = bytes(compute.ast || null)
  parts['compute.trees'] = bytes(compute.trees || null)
  parts['compute.source'] = bytes(compute.source || null)
  parts['compute.sources'] = bytes(compute.sources || null)
  parts['compute.paramManifest'] = bytes(compute.paramManifest || null)
  parts['compute.other'] = bytes({
    ...compute, ast: undefined, trees: undefined, source: undefined,
    sources: undefined, paramManifest: undefined,
  })
  parts.plots = bytes(doc.plots || null)
  parts.inputs = bytes(doc.inputs || null)
  return parts
}

const pctl = (arr, p) => {
  const s = [...arr].sort((a, b) => a - b)
  return s.length ? s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))] : 0
}

describe('C2B.2 — the document-size distribution of the frozen 60', () => {
  it('source, AST, presentation and final document bytes', () => {
    const files = fs.readdirSync(OOS).filter((f) => f.endsWith('.pine')).sort()
    const rows = []
    for (const f of files) {
      const name = f.replace(/\.pine$/, '')
      const doc = documentFor(name)
      if (!doc) continue
      const src = fs.statSync(path.join(OOS, f)).size
      rows.push({
        name,
        srcBytes: src,
        docBytes: bytes(doc),
        plots: (doc.plots || []).length,
        trees: Object.keys((doc.compute || {}).trees || {}).length,
      })
    }
    const docs = rows.map((r) => r.docBytes)
    const over = rows.filter((r) => r.docBytes > CAP)
    // eslint-disable-next-line no-console
    console.log(`\n=== C2B.2 DOCUMENT SIZE, ${rows.length} buildable of ${files.length} ===\n`
      + `  source bytes    P50=${pctl(rows.map((r) => r.srcBytes), 50)}  `
      + `P95=${pctl(rows.map((r) => r.srcBytes), 95)}  MAX=${Math.max(...rows.map((r) => r.srcBytes))}\n`
      + `  document bytes  P50=${pctl(docs, 50)}  P75=${pctl(docs, 75)}  P90=${pctl(docs, 90)}  `
      + `P95=${pctl(docs, 95)}  MAX=${Math.max(...docs)}\n`
      + `  cap ${CAP}; over cap: ${over.length}/${rows.length}\n`
      + `  largest:\n`
      + rows.sort((a, b) => b.docBytes - a.docBytes).slice(0, 6)
        .map((r) => `    ${String(r.docBytes).padStart(7)}B  ${r.plots} plots  ${r.trees} trees  `
          + `src ${r.srcBytes}B  ×${(r.docBytes / r.srcBytes).toFixed(1)}  ${r.name}`).join('\n'))
    expect(rows.length).toBeGreaterThan(10)
  })
})

describe('C2B.2/.3 — where the blocked document spends its bytes', () => {
  // ⚰️⚰️ ONE OF THE TWO BLOCKED SCRIPTS CARRIES NOTHING SINCE 2026-09-12, AND THAT
  // IS TWO RULINGS RATHER THAN A BROKEN FIXTURE. R-F refused nine of
  // `…03-supertrend`'s ten columns (its band was folding to a 250-bar rolling min) and
  // ruling 1.2 refused the tenth — the author's untitled `ohlc4` fill edge, which the
  // door had been OFFERING under the script's own title. A script with no carried
  // column has no document to size, so it moves out of the measurement and into a named
  // record, rather than failing as "the document should build" — which reads like a
  // corpus file somebody deleted.
  it('⚰️ high_engagement__03-supertrend-kivancozbilgic builds NO document at all', () => {
    expect(documentFor('high_engagement__03-supertrend-kivancozbilgic')).toBe(null)
  })

  for (const name of ['mid_engagement__22-rsi-levels-regime-map']) {
    it(name, () => {
      const doc = documentFor(name)
      expect(doc, 'the document should build').toBeTruthy()
      const total = bytes(doc)
      const parts = breakdown(doc)
      const trees = (doc.compute || {}).trees || {}
      const treeSizes = Object.entries(trees).map(([k, v]) => [k, bytes(v)])
        .sort((a, b) => b[1] - a[1])
      // eslint-disable-next-line no-console
      console.log(`\n=== ${name} — ${total} bytes (cap ${CAP}, ×${(total / CAP).toFixed(1)}) ===\n`
        + Object.entries(parts).sort((a, b) => b[1] - a[1])
          .map(([k, v]) => `  ${String(v).padStart(7)}B  ${(100 * v / total).toFixed(1).padStart(5)}%  ${k}`).join('\n')
        + `\n  trees: ${treeSizes.length}, largest:\n`
        + treeSizes.slice(0, 4).map(([k, v]) => `    ${String(v).padStart(7)}B  ${k}`).join('\n'))
      // ⭐⭐ HOW MUCH OF THIS IS INFORMATION AND HOW MUCH IS REPETITION.
      // gzip is a fair lower bound on the first: it collapses exactly the
      // repeated byte sequences an inlined shared subtree produces. A document
      // that is mostly indicator compresses a little; one that is mostly the
      // same expression written ten times compresses enormously — and THAT is
      // the difference between "the cap is too small" and "the representation
      // is too big", which is the question C2B may not skip.
      const gz = zlib.gzipSync(Buffer.from(JSON.stringify(doc), 'utf8')).length
      // eslint-disable-next-line no-console
      console.log(`  gzip: ${gz}B  (×${(total / gz).toFixed(1)} smaller)  `
        + `— ${gz > CAP ? 'STILL over the cap' : 'UNDER the cap'}`)
      // C2B.6 — what a raised envelope would actually cost per document.
      const json = JSON.stringify(doc)
      const t0 = Date.now()
      for (let i = 0; i < 20; i += 1) JSON.parse(json)
      const parseMs = (Date.now() - t0) / 20
      const t1 = Date.now()
      for (let i = 0; i < 20; i += 1) JSON.stringify(doc)
      const strMs = (Date.now() - t1) / 20
      // eslint-disable-next-line no-console
      console.log(`  parse ${parseMs.toFixed(1)}ms  stringify ${strMs.toFixed(1)}ms  `
        + `(per document, ${total}B)`)
      expect(total).toBeGreaterThan(CAP)
    })
  }
})
