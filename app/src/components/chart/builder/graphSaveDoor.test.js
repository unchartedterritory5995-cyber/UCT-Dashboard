// app/src/components/chart/builder/graphSaveDoor.test.js
//
// ─── C2C/C2D: THE DOCUMENT THE PRODUCT WOULD ACTUALLY SEND ──────────────────
//
// ⚰️ THIS FILE EXISTS BECAUSE A GREEN SUITE LIED FOR AN HOUR. `graphSize.measure`
// builds its documents WITHOUT a `paramManifest`, because the recipe it copied
// (`documentSize.measure`) did. The real import path builds one, and with it
// present `toGraphDocument` refused — so the live journey reported the ORIGINAL
// "exceeds 65,536 bytes" refusal for both blocked scripts while every offline
// test said the representation shrank them forty-eight fold.
//
// ⭐ AND THE MANIFEST IS BUILT THE WAY C2D.1 BUILDS IT — one translation,
// placements per output, the address supplied by whoever owns the plot keys.
// The correct V1 manifest for `…03-supertrend` is 666 astPath locators (one
// Pine input feeds every plot, seventeen times in the first tree alone); the
// graph form is TWO. That ratio is the C2D.2 argument for a graph-native
// locator, measured rather than asserted.
//
// ⚰ THE 666-LOCATOR MEASUREMENT ABOVE IS HISTORY AS OF 2026-09-12. Ruling R-F took
// `min`/`max` out of the seed-forgetting admit set, so `…03-supertrend`'s band — a
// 250-bar rolling min this engine was presenting as the running band — refuses at
// `pine:state`. Nine of its ten columns go with it, the tenth is the author's `ohlc4`
// fill edge, and the document it now produces is a few hundred bytes with no manifest
// at all. The ratio argument for a graph-native locator still stands on
// `…22-rsi-levels-regime-map`, which is why that script carries the case below.
//
// ⛔ THE FIXTURE MUST INCLUDE THE MANIFEST, and it must be built the way the
// product builds it, or this file is measuring a document nobody saves.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { translatePine } from '../engine/ast/pine'
import { memberInputTranslation } from './builderInputs'
import { paramLocatorsIn, manifestFromPlacements } from './pineParamManifest'
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
/** The translation the product would run — exposed because a script can now carry
 *  ZERO columns, and a test about that fact must be able to say so without going
 *  through a document builder that has nothing to build. */
function translation(name) {
  const src = fs.readFileSync(path.join(OOS, `${name}.pine`), 'utf8')
  return memberInputTranslation(translatePine, src, { paramManifest: true })
}

/** The carried rows, in the product's own order. */
function productRows(name) {
  const t = translation(name)
  return (t.outputs || []).filter((o) => o && o.ast && o.formula && !o.hidden).slice(0, 12)
}

function productDocument(name) {
  const src = fs.readFileSync(path.join(OOS, `${name}.pine`), 'utf8')
  // ⭐⭐ C2D.1 — ONE TRANSLATION. This used to make PineBox's second,
  // `declareInputs`-free `translatePine(src, {paramManifest: true})` call and
  // locate the manifest in a tree the document never saved; that is the defect
  // the wave fixed, so replicating it here would keep measuring the old world.
  const t = memberInputTranslation(translatePine, src, { paramManifest: true })
  const outs = (t.outputs || []).filter((o) => o && o.ast && o.formula && !o.hidden).slice(0, 12)
  // ⭐ …and the manifest is assembled the way `BuilderSheet` assembles it: the
  // immutable metadata once, the placements per output, the ADDRESS supplied by
  // whoever knows the plot keys.
  const manifest = manifestFromPlacements(t.inputParams || [], outs.map((o, i) => ({
    treeIndex: i === 0 ? 'value' : `out${i + 1}`,
    locators: paramLocatorsIn(t.inputParams || [], o.ast),
  })))
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
  'mid_engagement__22-rsi-levels-regime-map',
]

/** ⚰ The other DOCUMENT_SIZE_BLOCKED script, which R-F made too small to block. */
const NO_LONGER_OVERSIZED = 'high_engagement__03-supertrend-kivancozbilgic'

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
      // ⭐⭐ C2D.5 — AND NOW EVERY ONE OF THEM IS ACTUALLY PLACED. Before the
      // single-translation fix, one of each script's two controls carried an
      // astPath into a tree nobody saved and arrived permanently detached; the
      // graph then carried it disabled, faithfully. With one translation there
      // is nothing left to be faithful ABOUT — they all resolve.
      for (const [pid, entry] of Object.entries(sent.compute.graph.parameters)) {
        expect(entry.locators.length, `${pid} is placed`).toBeGreaterThan(0)
      }

      // ⭐ AND IT READS BACK AS THE SAME INDICATOR.
      const back = hydrateGraphDocument(JSON.parse(JSON.stringify(sent)))
      expect(treesHash(back.compute.trees)).toBe(doc.compute.treesHash)
      expect(Object.keys(back.compute.paramManifest).sort()).toEqual(before)
      // eslint-disable-next-line no-console
      console.log(`  ${name}: ${documentBytes(doc)}B -> ${documentBytes(sent)}B `
        + `(x${(documentBytes(doc) / documentBytes(sent)).toFixed(1)}), `
        + `${after.length} parameters carried, `
        + `${after.filter((k) => sent.compute.graph.parameters[k].locators.length).length} placed; `
        + `V1 locators ${Object.values(doc.compute.paramManifest).reduce((n, e) => n + e.locators.length, 0)}`
        + ` -> graph locators ${Object.values(sent.compute.graph.parameters).reduce((n, e) => n + e.locators.length, 0)}`)
    })
  }

  it(`⚰ ${NO_LONGER_OVERSIZED} produces NO DOCUMENT AT ALL now`, () => {
    // ⚰⚰ TWO RULINGS, TWO STEPS DOWN, AND THIS RECORDS BOTH SO NEITHER READS AS AN
    // ACHIEVEMENT. The original measurement was real: ~70,000 bytes with a 666-locator
    // manifest, reduced 48-fold by the graph form. R-F then refused nine of the ten
    // columns and left the author's `ohlc4` fill edge, which briefly made this a
    // 1,041-byte one-tree document. Ruling 1.2 refuses that edge too — a helper the
    // author hid is not a column — so the script now carries nothing at all and there
    // is no document to size.
    // ⛔ "It fits now" must never read as the representation having solved something.
    const rows = productRows(NO_LONGER_OVERSIZED)
    expect(rows).toHaveLength(0)
    const t = translation(NO_LONGER_OVERSIZED)
    expect([...new Set((t.outputs || []).filter((o) => o.refusal).map((o) => o.refusal.guard))])
      .toEqual(['pine:state'])
    expect(t.selected).toBe(-1)
  })

  it('⛔ THE CONTROL: a document that fits is not reduced at all', () => {
    const doc = productDocument('mid_engagement__13-spma-trend')
    expect(documentBytes(doc)).toBeLessThan(DOCUMENT_BYTE_BUDGET)
    expect(reduceIfOversized(doc)).toBe(doc)
    // …and it COULD have been, which is what makes the line above a choice
    expect(toGraphDocument(doc).ok).toBe(true)
  })
})
