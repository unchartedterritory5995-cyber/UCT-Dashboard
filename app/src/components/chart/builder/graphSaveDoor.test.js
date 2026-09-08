// app/src/components/chart/builder/graphSaveDoor.test.js
//
// ─── C2C: THE DOCUMENT THE PRODUCT WOULD ACTUALLY SEND ──────────────────────
//
// ⚰️ THIS FILE EXISTS BECAUSE A GREEN SUITE LIED FOR AN HOUR. `graphSize.measure`
// builds its documents WITHOUT a `paramManifest`, because the recipe it copied
// (`documentSize.measure`) did. The real import path builds one — `PineBox`
// translates a SECOND time with `paramManifest: true` and hands the result to
// `BuilderSheet` — and with it present, `toGraphDocument` refused, so the live
// journey reported the ORIGINAL "exceeds 65,536 bytes" refusal for both blocked
// scripts while every offline test said ×48.
//
// ⛔ THE FIXTURE MUST INCLUDE THE MANIFEST, and it must be built the way the
// product builds it, or this file is measuring a document nobody saves.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { translatePine } from '../engine/ast/pine'
import { memberInputTranslation } from './builderInputs'
import { buildParamManifest } from './pineParamManifest'
import { buildDefinition } from './BuilderSheet.jsx'
import { evaluateFormula } from './FormulaField.jsx'
import { BUILDER_INPUT_SCOPE, BUILDER_INPUTS } from './builderInputs.js'
import {
  toGraphDocument, hydrateGraphDocument, reduceIfOversized, documentBytes,
  DOCUMENT_BYTE_BUDGET,
} from '../engine/ast/graphDocument'
import { treesHash } from '../engine/ast/trees'

const OOS = path.resolve(process.cwd(), '../tools/c0_oos_fixtures')

/** The document `BuilderSheet.save()` would hand `saveUserDefinition` — the
 *  carried multi-plot rows AND the Track F manifest `PineBox` produces. */
function productDocument(name) {
  const src = fs.readFileSync(path.join(OOS, `${name}.pine`), 'utf8')
  const t = memberInputTranslation(translatePine, src, {})
  const outs = (t.outputs || []).filter((o) => o && o.ast && o.formula && !o.hidden).slice(0, 12)
  // ⭐ PineBox's SECOND translation, verbatim: uncoupled from `declareInputs`,
  // manifest for the chosen row only, `treeIndex: null`.
  const paramReport = translatePine(src, { paramManifest: true })
  const pOuts = paramReport.outputs || []
  const manifest = buildParamManifest(paramReport.inputParams,
    pOuts.length && pOuts[0].ast ? [{ treeIndex: null, ast: pOuts[0].ast }] : [])
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
  return buildDefinition({
    defId: 'u_door00000000',
    name: name.slice(0, 40),
    source: rows[0].source,
    ast: rows[0].ast,
    mode: rows[0].mode,
    readback: rows[0].readback,
    plots: rows,
    placement: { target: 'pane' },
    paramManifest: Object.keys(manifest).length ? manifest : null,
  })
}

const BLOCKED = [
  'high_engagement__03-supertrend-kivancozbilgic',
  'mid_engagement__22-rsi-levels-regime-map',
]

describe('C2C — the two DOCUMENT_SIZE_BLOCKED scripts, through the real save door', () => {
  for (const name of BLOCKED) {
    it(name, () => {
      const doc = productDocument(name)
      expect(doc.compute.paramManifest, 'the fixture must carry a manifest — that is the point')
        .toBeTruthy()
      expect(documentBytes(doc)).toBeGreaterThan(DOCUMENT_BYTE_BUDGET)

      const sent = reduceIfOversized(doc)
      expect(sent, 'the save door must have reduced it').not.toBe(doc)
      expect(documentBytes(sent)).toBeLessThan(DOCUMENT_BYTE_BUDGET)

      // ⭐ THE IDENTITY DID NOT MOVE.
      expect(sent.compute.treesHash).toBe(doc.compute.treesHash)
      expect(sent.compute.fn).toBe(doc.compute.fn)

      // ⭐ AND EVERY CONTROL THE MEMBER HAD IS STILL THERE, placed or disabled.
      const before = Object.keys(doc.compute.paramManifest).sort()
      const after = Object.keys(sent.compute.graph.parameters).sort()
      expect(after).toEqual(before)

      // ⭐ AND IT READS BACK AS THE SAME INDICATOR.
      const back = hydrateGraphDocument(JSON.parse(JSON.stringify(sent)))
      expect(treesHash(back.compute.trees)).toBe(doc.compute.treesHash)
      expect(Object.keys(back.compute.paramManifest).sort()).toEqual(before)
      // eslint-disable-next-line no-console
      console.log(`  ${name}: ${documentBytes(doc)}B -> ${documentBytes(sent)}B `
        + `(x${(documentBytes(doc) / documentBytes(sent)).toFixed(1)}), `
        + `${after.length} parameters carried, `
        + `${after.filter((k) => sent.compute.graph.parameters[k].locators.length).length} of them placed`)
    })
  }

  it('⛔ THE CONTROL: a document that fits is not reduced at all', () => {
    const doc = productDocument('mid_engagement__13-spma-trend')
    expect(documentBytes(doc)).toBeLessThan(DOCUMENT_BYTE_BUDGET)
    expect(reduceIfOversized(doc)).toBe(doc)
    // …and it COULD have been, which is what makes the line above a choice
    expect(toGraphDocument(doc).ok).toBe(true)
  })
})
