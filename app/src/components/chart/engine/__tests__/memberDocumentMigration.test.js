// app/src/components/chart/engine/__tests__/memberDocumentMigration.test.js
//
// ⭐⭐ A SAVED MEMBER DOCUMENT GETS TODAY'S BEHAVIOUR ON LOAD (`memberDocumentMigration.js`).
//
//   • on the SAVED CORPUS (the C46 fixture's scripts): a document in the old door's
//     shape — no condition-column locators — migrates to exactly the locators the
//     door places today, parameter for parameter;
//   • on a REAL saved document: Uncharted Clouds as origin/master's door saved it
//     with both lengths edited (TradingView set E3) — refused by `defSchema` before
//     (stale handle), installed after, and DRAWN exactly as TradingView draws E3:
//     values, every band's bytes, the MA lines;
//   • pure, deterministic, idempotent, and the identity on a document that needs
//     nothing.
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

/** Measured 2026-10-29 over the C46 saved corpus (see the corpus case). */
const CORPUS_WANTED = 1029
const CORPUS_RECOVERED = 824
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
})

describe('the SAVED CORPUS — an old-shape document migrates to today\'s placements', () => {
  it('every script: old door shape → migrate → ONLY placements the door makes today, most of them', () => {
    // ⭐ What a saved document can recover is what its own drawn rows prove: a column
    // call identical to a call a parameter locates. The door today also places the
    // literals the translator TAGGED inside a condition (a parameter read only there,
    // or through a different call), which a saved document no longer carries — so the
    // migration recovers a SUBSET, and must never place one the door would not.
    const extra = []
    let wanted = 0
    let recovered = 0
    for (const script of scripts) {
      const b = memberPaneDefinition({ source: fs.readFileSync(path.join(REPO, script), 'utf8'), id: 'u_member-pane-mig', enumInputs: false })
      if (!b.ok || !b.definition.compute.paramManifest) continue
      const minted = mintedOf(b)
      const old = asOldDoor(b.definition, minted)
      const got = migrateMemberDocument(old)
      for (const [id, e] of Object.entries(b.definition.compute.paramManifest)) {
        const want = new Set(e.locators.filter((l) => minted.has(l.treeIndex)).map(locKey))
        const have = new Set(got.compute.paramManifest[id].locators.filter((l) => minted.has(l.treeIndex)).map(locKey))
        wanted += want.size
        recovered += [...want].filter((k) => have.has(k)).length
        const more = [...have].filter((k) => !want.has(k))
        if (more.length) extra.push({ script, id, more })
      }
    }
    expect(extra, 'a placement the door itself does not make').toEqual([])
    expect(wanted, 'NON-VACUITY: corpus parameters really are placed in condition columns').toBeGreaterThan(20)
    // ⭐ MEASURED 2026-10-29: pinned so a regression in either half reads red.
    expect({ wanted, recovered }).toEqual({ wanted: CORPUS_WANTED, recovered: CORPUS_RECOVERED })
  }, 900000)
})

describe('a Clouds document SAVED by origin/master\'s door, lengths edited (E3: EMA 5 / 50)', () => {
  it('was refused as stored (stale handle); installs once migrated', () => {
    expect(CLOUDS_SAVED.masterValid).toBe(false)
    expect(validateDefinition(CLOUDS_SAVED.definition).ok).toBe(false)
    const m = migrateMemberDocument(CLOUDS_SAVED.definition)
    expect(validateDefinition(m).ok, (validateDefinition(m).errors || []).join(' ')).toBe(true)
  })

  it('…and a further edit now moves the cloud\'s colour condition too', () => {
    const m = migrateMemberDocument(CLOUDS_SAVED.definition)
    const pid = Object.keys(m.compute.paramManifest).find((k) => m.compute.paramManifest[k].sourceName === 'ma1Length')
    const cond = m.plots.find((p) => p.fill && p.fill.colorMode).fill.colorMode.slice(7)
    const before = JSON.stringify(m.compute.trees[cond])
    const e = applyParamEdit(m, pid, 7)
    expect(e.ok, e.error).toBe(true)
    expect(JSON.stringify(e.definition.compute.trees[cond])).not.toBe(before)
    expect(validateDefinition(e.definition).ok).toBe(true)
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

  it('DRAWN exactly as TradingView draws E3 — values, every band byte, the MA lines', () => {
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
    // transparencies and a byte or two off for the ten fractional ones. Pinned, both
    // halves: what the document says is painted exactly, and the hue is TradingView's.
    const stored = r.owners.map((p) => Math.round(p.fillOpacity * 255))
    const bandBad = []
    let offTv = 0
    r.bands.forEach((band, j) => {
      const th = tv.col(tv.colourOf(`fill_${j}`))
      if (stored[j] !== unpackVendorColor(th[0]).alphaByte) offTv += 1
      for (let i = 0; i < r.n; i += 1) {
        const t = unpackVendorColor(th[i])
        const o = cssToRgba(band.perBar[i])
        if (!o || o.hex !== t.hex || o.a !== stored[j]) bandBad.push(`band ${j} bar ${i}: ${fmt(o)} vs ${t.hex}/${stored[j]}`)
      }
    })
    expect(r.bands).toHaveLength(20)
    expect(bandBad.slice(0, 5)).toEqual([])
    expect(offTv, 'the old door\'s truncated fractional transparencies, stored in the document').toBe(10)
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
