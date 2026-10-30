// app/src/components/chart/engine/__tests__/memberDocumentMigration.test.js
//
// ⭐⭐ A SAVED MEMBER DOCUMENT GETS TODAY'S BEHAVIOUR ON LOAD (`memberDocumentMigration.js`)
// — exactly what its own bytes prove, and nothing they do not.
//
//   • a REAL saved document — Uncharted Clouds as origin/master's door saved it with
//     both lengths edited (TradingView set E3) — was refused (stale handle) and now
//     installs; its drawn values are TradingView's;
//   • ⛔ it places NO parameter in a condition column: graded over the saved corpus
//     against an INDEPENDENT truth — the door's TAGGED locators on a fresh paste of the
//     same source (the door no longer runs this migration, so the two cannot agree by
//     construction);
//   • pure, deterministic, idempotent, memoised, the identity on a document that
//     needs nothing.
import { describe, it, expect, afterAll } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { migrateMemberDocument } from '../memberDocumentMigration'
import { validateDefinition } from '../defSchema'
import { memberPaneDefinition } from '../../builder/memberPane/memberPaneDefinition'
import { applyParamEdit } from '../../builder/paramEdit'
import { unpackVendorColor } from '../colorInt'
import { REF, REPO, runCloudsCapture, tvColumns, ourKeys, cssToRgba, fmt, uninstallHarness } from './vendorHarness/cloudsDraw'

afterAll(() => uninstallHarness())

const SAVED = JSON.parse(fs.readFileSync(path.join(REPO, 'tests/fixtures/pine_param_ids/saved-documents-pre-c46.json'), 'utf8'))
const CLOUDS_SAVED = JSON.parse(fs.readFileSync(path.join(REPO, 'tests/fixtures/pine_param_ids/clouds-saved-master-e3-edit.json'), 'utf8'))
const scripts = Object.keys(SAVED).filter((k) => k !== '_about' && fs.existsSync(path.join(REPO, k)))

/** Measured 2026-10-29: the door's TAGGED condition-column placements over the C46 corpus. */
const CORPUS_TAGGED = 759
/** Measured 2026-10-29: band-bars the stored 9/20 colour rule puts on the other side in E3. */
const SIDE_OFF_E3 = 520
const mintedOf = (built) => new Set((built.rows || []).filter((r) => r && typeof r.conditionFor === 'string').map((r) => r.key))
const locKey = (l) => `${l.treeIndex}|${JSON.stringify(l.astPath)}`
/** The OLD door's shape: today's document with every condition-column locator removed. */
const asOldDoor = (def, minted) => ({
  ...def,
  compute: {
    ...def.compute,
    paramManifest: def.compute.paramManifest && Object.fromEntries(Object.entries(def.compute.paramManifest)
      .map(([id, e]) => [id, { ...e, locators: e.locators.filter((l) => !minted.has(l.treeIndex)) }])),
  },
})

describe('migrateMemberDocument — pure, deterministic, idempotent', () => {
  it('the identity (same object) on a document that needs nothing', () => {
    const b = memberPaneDefinition({ source: fs.readFileSync(path.join(REPO, 'tests/fixtures/member/uncharted-clouds.pine'), 'utf8'), id: 'u_member-pane-mig' })
    expect(migrateMemberDocument(b.definition)).toBe(b.definition)
  })

  it('idempotent, and it never mutates its input', () => {
    const before = JSON.stringify(CLOUDS_SAVED.definition)
    const once = migrateMemberDocument(CLOUDS_SAVED.definition)
    expect(JSON.stringify(CLOUDS_SAVED.definition)).toBe(before)
    expect(migrateMemberDocument(once)).toBe(once)
    expect(JSON.stringify(migrateMemberDocument(JSON.parse(before)))).toBe(JSON.stringify(once))
  })

  it('⭐ N6: memoised per document — a repeat call on the same object is the same answer, no re-hash', () => {
    const doc = JSON.parse(JSON.stringify(CLOUDS_SAVED.definition))
    const a = migrateMemberDocument(doc)
    expect(a).not.toBe(doc)
    expect(migrateMemberDocument(doc)).toBe(a)
  })
})

describe('the SAVED CORPUS — graded against the door\'s TAGGED locators on a fresh paste', () => {
  it('every script: the door\'s document is untouched, and an old-shape copy gains NOTHING', () => {
    // ⭐ The truth is independent of the migration: `memberPaneDefinition` places only
    // literals the translator tagged (`paramLocatorsIn`) and does not call the
    // migration. A saved document cannot prove which condition-column literal came
    // from a parameter (see the module header), so the migration must add none —
    // not one of the TAGGED placements it is missing, and certainly no other.
    const touched = []
    const invented = []
    let wanted = 0
    for (const script of scripts) {
      const b = memberPaneDefinition({ source: fs.readFileSync(path.join(REPO, script), 'utf8'), id: 'u_member-pane-mig', enumInputs: false })
      if (!b.ok || !b.definition.compute.paramManifest) continue
      if (migrateMemberDocument(b.definition) !== b.definition) touched.push(script)
      const minted = mintedOf(b)
      const old = asOldDoor(b.definition, minted)
      const got = migrateMemberDocument(old)
      for (const [id, e] of Object.entries(b.definition.compute.paramManifest)) {
        wanted += e.locators.filter((l) => minted.has(l.treeIndex)).length
        const had = new Set(old.compute.paramManifest[id].locators.map(locKey))
        const more = got.compute.paramManifest[id].locators.map(locKey).filter((k) => !had.has(k))
        if (more.length) invented.push({ script, id, more })
      }
    }
    expect(touched, 'a document the door built today needs no repair').toEqual([])
    expect(invented, 'a placement the saved bytes cannot prove').toEqual([])
    // NON-VACUITY: the corpus really has tagged condition-column placements the
    // old-shape copies lack — the ones a re-save through the door restores.
    expect(wanted).toBeGreaterThan(20)
    expect(wanted).toBe(CORPUS_TAGGED)
  }, 900000)
})

describe('a Clouds document SAVED by origin/master\'s door, lengths edited (E3: EMA 5 / 50)', () => {
  it('was refused as stored (stale handle); installs once migrated', () => {
    expect(CLOUDS_SAVED.masterValid).toBe(false)
    expect(validateDefinition(CLOUDS_SAVED.definition).ok).toBe(false)
    const m = migrateMemberDocument(CLOUDS_SAVED.definition)
    expect(validateDefinition(m).ok, (validateDefinition(m).errors || []).join(' ')).toBe(true)
  })

  it('⛔ …and its colour condition is left exactly as stored — unprovable, so unclaimed', () => {
    const m = migrateMemberDocument(CLOUDS_SAVED.definition)
    const cond = m.plots.find((p) => p.fill && p.fill.colorMode).fill.colorMode.slice(7)
    expect(JSON.stringify(m.compute.trees[cond])).toBe(JSON.stringify(CLOUDS_SAVED.definition.compute.trees[cond]))
    for (const e of Object.values(m.compute.paramManifest)) expect(e.locators.filter((l) => l.treeIndex === cond)).toEqual([])
  })

  it('⭐ the OLD shape honours a member\'s colour pick, alpha included (E5\'s MA colours)', () => {
    // The old door stored the default's transparency as `plots[].opacity` beside a
    // `$color` ref; `pool.resolvePlotForInstance` drops it once the member's colour
    // differs, so their pick is the whole colour, as on TradingView.
    let doc = migrateMemberDocument(CLOUDS_SAVED.definition)
    for (const [name, v] of [['ma1Length', 9], ['ma2Length', 20]]) {
      const pid = Object.keys(doc.compute.paramManifest).find((k) => doc.compute.paramManifest[k].sourceName === name)
      doc = applyParamEdit(doc, pid, v).definition
    }
    const r = runCloudsCapture({ dir: path.join(REF, 'E'), name: 'e5-custom-colours-spy-1d-250', document: doc,
      settings: { ma1Color: 'rgba(255,235,59,1)', ma2Color: 'rgba(33,150,243,0.6)' } })
    expect(r.gaps).toEqual([])
    const tv = tvColumns(r)
    r.drawnPlots.forEach((plot, j) => {
      const s = r.lineOf.get(plot.key)
      const u = unpackVendorColor(tv.col(tv.colourOf(tv.lines[j]))[0])
      expect(fmt(cssToRgba(s.__options.color)), plot.key).toBe(`${u.hex}/${u.alphaByte}`)
    })
  }, 300000)

  it('DRAWN: values and MA lines are TradingView\'s E3; the band side follows the STORED colour rule', () => {
    const r = runCloudsCapture({ dir: path.join(REF, 'E'), name: 'e3-ema-5-50-spy-1d-250', document: CLOUDS_SAVED.definition })
    expect(r.supply.kind).toBe('warm')
    const tv = tvColumns(r)
    const bad = []
    ourKeys(r).forEach((k, j) => {
      const a = r.cols[k]
      const b = tv.col(tv.lines[j])
      for (let i = 0; i < r.n; i += 1) {
        if (Number.isFinite(a[i]) !== Number.isFinite(b[i])) { bad.push(`${k} bar ${i}`); continue }
        if (Number.isFinite(b[i]) && Math.abs(a[i] - b[i]) / Math.max(Math.abs(b[i]), 1) > 1e-9) bad.push(`${k} bar ${i}`)
      }
    })
    expect(bad.slice(0, 5)).toEqual([])
    // ⚠️ THE BAND ALPHAS ARE THE ONES THIS DOCUMENT STORED. The old door truncated a
    // fractional transparency to a whole percent BEFORE writing `fillOpacity` (87.5 was
    // saved as 87), and the exact value is not in the document to recover — so a band
    // paints the stored opacity's exact byte, which is TradingView's for the ten whole
    // transparencies and a byte or two off for the ten fractional ones.
    // ⚠️ AND THE SIDE (bull/bear hue) IS DECIDED BY THE COLOUR RULE AS STORED — at the
    // lengths the script was pasted with (9/20): the old door never placed the lengths
    // there, and the document cannot prove which literal is the parameter's (module
    // header). Pinned: every band's alpha is what the document stores, and the
    // band-bars where the stored rule picks the other side from TradingView's E3 are
    // COUNTED, so the remedy (a re-save through today's door, which places the tagged
    // lengths) is measured, never silent.
    const stored = r.owners.map((p) => Math.round(p.fillOpacity * 255))
    const alphaBad = []
    let offTv = 0
    let sideOff = 0
    r.bands.forEach((band, j) => {
      const th = tv.col(tv.colourOf(`fill_${j}`))
      if (stored[j] !== unpackVendorColor(th[0]).alphaByte) offTv += 1
      for (let i = 0; i < r.n; i += 1) {
        const t = unpackVendorColor(th[i])
        const o = cssToRgba(band.perBar[i])
        if (!o || o.a !== stored[j]) alphaBad.push(`band ${j} bar ${i}: ${fmt(o)} vs ${t.hex}/${stored[j]}`)
        else if (o.hex !== t.hex) sideOff += 1
      }
    })
    expect(r.bands).toHaveLength(20)
    expect(alphaBad.slice(0, 5)).toEqual([])
    expect(offTv, 'the old door\'s truncated fractional transparencies, stored in the document').toBe(10)
    expect(sideOff, 'band-bars on the other side from TradingView\'s E3 (stored colour rule at 9/20)').toBe(SIDE_OFF_E3)
    const styles = r.meta.plotStyles
    r.drawnPlots.forEach((plot, j) => {
      const s = r.lineOf.get(plot.key)
      const u = unpackVendorColor(tv.col(tv.colourOf(tv.lines[j]))[0])
      expect(fmt(cssToRgba(s.__options.color))).toBe(`${u.hex}/${u.alphaByte}`)
      // ⚠️ the OLD document's width input defaulted to 1 (the door never carried
      // `linewidth`); a document saved before that fix keeps its own default.
      expect(s.__options.lineWidth).toBe(1)
      expect(styles[tv.lines[j]].linewidth).toBe(2)
    })
  }, 300000)
})
