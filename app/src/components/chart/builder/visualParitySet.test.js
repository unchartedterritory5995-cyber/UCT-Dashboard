// app/src/components/chart/builder/visualParitySet.test.js
//
// ─── C3A-CLOSE: THE FIXED 10-MEMBER COMPLEX PINE VISUAL PARITY SET ──────────
//
// The set was selected by a rule committed BEFORE any result existed (V4/V5
// only, ranked by distinct visual families, ≤4 per stratum, ≤1 per author) and
// is read from `OOS_2_PARITY_SET.json` rather than retyped here. ⛔ NO MEMBER IS
// REPLACED BECAUSE IT IS DIFFICULT — including
// `…05-supertrend-fibonacci-ote`, the richest script in the corpus at 147
// visual call sites and one of the three known silent false successes.
//
// ⛔⛔ `CHART_RENDERABLE` IS NOT `VISUAL_FULL`, and this file is built so the
// two cannot be confused. For each member it asks TWO questions from TWO
// sources and compares them:
//
//   EXPECTED — what the AUTHOR's source asks for (a census of the .pine text)
//   ACTUAL   — what the DOCUMENT the product would save actually carries
//
// A member is graded on the gap between them. A script whose calculations
// import perfectly while every one of its objects is dropped is VISUAL_MINIMAL,
// not VISUAL_FULL, and the grade is derived from the counts rather than
// asserted.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { translatePine } from '../engine/ast/pine'
import { memberInputTranslation } from './builderInputs'
import { paramLocatorsIn, manifestFromPlacements } from './pineParamManifest'
import { buildDefinition } from './BuilderSheet.jsx'
import { evaluateFormula } from './FormulaField.jsx'
import { BUILDER_INPUT_SCOPE, BUILDER_INPUTS } from './builderInputs.js'
import { validateDefinition } from '../engine/defSchema'

const OOS = path.resolve(process.cwd(), '../tests/fixtures/pine_oos')
const SET = path.resolve(process.cwd(),
  '../docs/superpowers/specs/universal-indicator-ecosystem/OOS_2_PARITY_SET.json')

// ─── the census half: what the author asked for ─────────────────────────────

function stripComments(src) {
  const out = []
  for (const line of src.split(/\r?\n/)) {
    let inStr = null
    let cut = line.length
    for (let i = 0; i < line.length; i += 1) {
      const ch = line[i]
      if (inStr) {
        if (ch === '\\') { i += 1; continue }
        if (ch === inStr) inStr = null
        continue
      }
      if (ch === '"' || ch === "'") { inStr = ch; continue }
      if (ch === '/' && line[i + 1] === '/') { cut = i; break }
    }
    out.push(line.slice(0, cut))
  }
  return out.join('\n')
}
const calls = (src, name) =>
  (src.match(new RegExp(`(^|[^A-Za-z0-9_.])${name}\\s*\\(`, 'g')) || []).length

const OBJECT_CALLS = ['line.new', 'label.new', 'box.new', 'table.new',
  'polyline.new', 'linefill.new']

function expectedOf(src) {
  const s = stripComments(src)
  return {
    plot: calls(s, 'plot'),
    fill: calls(s, 'fill'),
    hline: calls(s, 'hline'),
    plotshape: calls(s, 'plotshape'),
    plotchar: calls(s, 'plotchar'),
    bgcolor: calls(s, 'bgcolor'),
    barcolor: calls(s, 'barcolor'),
    plotcandle: calls(s, 'plotcandle') + calls(s, 'plotbar'),
    objects: OBJECT_CALLS.reduce((n, c) => n + calls(s, c), 0),
    overlay: /overlay\s*=\s*true/.test(s),
  }
}

// ─── the document half: what the product would actually save ────────────────

/** ⭐⭐ R-I — THE PANE DECISION, AS ONE NAMED FUNCTION SO IT CAN BE CONTROLLED.
 *
 *  ⚰️⚰️ IT WAS INLINE AND IT READ `t.declaration.overlay`. `declaration` is the
 *  STRING `"indicator"` — the word the script declared itself with — so a string
 *  has no `overlay` property, the test was `undefined` for EVERY SCRIPT EVER
 *  WRITTEN, and every document this instrument built came out a sub-pane
 *  regardless of what its author asked for. The `pane=` column of the published
 *  parity report was a constant wearing a measurement's clothes.
 *
 *  ⛔ THE FIELD IS `presentation.overlay`, where `translatePine` puts the author's
 *  pane intent beside `levels` and `fills`. Extracted here because the defect
 *  survived precisely by being one inline expression nothing could point at. */
function placementFor(t) {
  return (t && t.presentation && t.presentation.overlay === true)
    ? { target: 'price' }
    : { target: 'pane' }
}

function documentOf(name) {
  // ⛔ A MISSING SOURCE IS A NAMED GAP, NEVER AN ENOENT. Three of the ten
  // members are `storage: "local-only"` in `pine_oos/MANIFEST.json` and are not
  // committed, so this file used to die on `readFileSync` and report NOTHING
  // about the seven that ARE here. Absence is not a pass and it is not a crash
  // either: the row says SOURCE_MISSING, the report prints the other seven, and
  // the assertion at the end names the missing ones and stays red.
  const file = path.join(OOS, `${name}.pine`)
  if (!fs.existsSync(file)) return { src: '', importResult: 'SOURCE_MISSING' }
  const src = fs.readFileSync(file, 'utf8')
  let t
  try {
    t = memberInputTranslation(translatePine, src, { paramManifest: true })
  } catch (err) {
    return { src, importResult: `THREW ${String(err.message).slice(0, 60)}` }
  }
  if (!t.ok && !(t.outputs || []).some((o) => o && o.ast)) {
    return { src, importResult: 'IMPORT_REFUSED', refusal: (t.refusal || {}).guard || null }
  }
  const outs = (t.outputs || []).filter((o) => o && o.ast && o.formula && !o.hidden).slice(0, 12)
  if (!outs.length) return { src, importResult: 'NO_OUTPUT' }

  const rows = outs.map((o, i) => {
    const ev = evaluateFormula(o.formula, BUILDER_INPUT_SCOPE)
    const op = o.presentation || {}
    return {
      key: i === 0 ? 'value' : `out${i + 1}`,
      label: o.title || '',
      source: o.formula,
      ast: o.ast,
      mode: ev.verdict ? ev.verdict.mode : 'clean',
      readback: ev.readback || '',
      style: typeof op.style === 'string' ? op.style : 'line',
      color: typeof op.color === 'string' ? op.color : BUILDER_INPUTS[0].default,
      width: BUILDER_INPUTS[1].default,
      hidden: false,
      ...(op.marker && op.marker.shape ? { marker: op.marker } : {}),
    }
  })
  const manifest = manifestFromPlacements(t.inputParams || [], outs.map((o, i) => ({
    treeIndex: i === 0 ? 'value' : `out${i + 1}`,
    locators: paramLocatorsIn(t.inputParams || [], o.ast),
  })))
  let doc = null
  try {
    doc = buildDefinition({
      defId: 'u_par000000000',
      name: name.slice(0, 40),
      source: rows[0].source,
      ast: rows[0].ast,
      mode: rows[0].mode,
      readback: rows[0].readback,
      plots: rows,
      placement: placementFor(t),
      paramManifest: Object.keys(manifest).length ? manifest : null,
    })
  } catch (err) {
    return { src, importResult: `BUILD_FAILED ${String(err.message).slice(0, 60)}`, outs }
  }
  return { src, importResult: 'IMPORTED', doc, outs, t, rows }
}

/** ⛔ THE GRADE IS DERIVED FROM THE COUNTS, never asserted per script.
 *
 *  A script is graded on the fraction of the visual systems it ASKS for that
 *  the document actually CARRIES. Objects are weighted as one whole system
 *  because for an object-heavy indicator they are the indicator. */
function classify(exp, act) {
  const systems = []
  const add = (want, got) => { if (want > 0) systems.push(got ? 1 : 0) }
  add(exp.plot, act.plots > 0)
  add(exp.fill, act.fills > 0)
  add(exp.hline, act.hlines > 0)
  add(exp.plotshape, act.markers > 0)
  add(exp.plotchar, act.markers > 0)
  add(exp.bgcolor, false)      // not built — C3A.6
  add(exp.barcolor, false)     // not built — C3A.6
  add(exp.plotcandle, false)   // not built — C3A.7
  add(exp.objects, false)      // not built — C3B
  if (!systems.length) return 'VISUAL_BLOCKED'
  const share = systems.reduce((a, b) => a + b, 0) / systems.length
  if (act.plots === 0) return 'VISUAL_BLOCKED'
  if (share === 1) return 'VISUAL_FULL'
  if (share >= 0.75) return 'VISUAL_MOSTLY_COMPLETE'
  if (share >= 0.4) return 'VISUAL_PARTIAL'
  return 'VISUAL_MINIMAL'
}

describe('C3A-CLOSE — the fixed parity set, remeasured at HEAD', () => {
  it('all ten members, seventeen facts each', () => {
    const set = JSON.parse(fs.readFileSync(SET, 'utf8')).selected
    expect(set).toHaveLength(10)
    const rows = []
    for (const m of set) {
      const srcPath = path.join(OOS, `${m.key}.pine`)
      const exp = fs.existsSync(srcPath)
        ? expectedOf(fs.readFileSync(srcPath, 'utf8'))
        : { plot: 0, fill: 0, hline: 0, plotshape: 0, plotchar: 0, bgcolor: 0,
            barcolor: 0, plotcandle: 0, objects: 0, overlay: false }
      const built = documentOf(m.key)
      const doc = built.doc
      const plots = doc ? (doc.plots || []) : []
      const data = plots.filter((p) => p.style !== 'hlines')
      const act = {
        plots: data.length,
        markers: data.filter((p) => p.marker).length,
        fills: data.filter((p) => p.fill && p.fill.with).length,
        hlines: plots.filter((p) => p.style === 'hlines').length,
        dynamic: data.filter((p) => p.colorMode && String(p.colorMode).startsWith('column:')).length,
        staticColors: new Set(data.map((p) => p.color).filter(Boolean)).size,
        overlay: doc ? (doc.placement || {}).target === 'price' : null,
        params: doc ? Object.keys((doc.compute || {}).paramManifest || {}).length : 0,
      }
      const valid = doc ? validateDefinition(doc) : { ok: false, errors: ['not built'] }
      const grade = built.importResult === 'SOURCE_MISSING'
        ? 'SOURCE_MISSING'
        : (doc && valid.ok ? classify(exp, act) : 'VISUAL_BLOCKED')
      rows.push({ key: m.key, tier: m.tier, exp, act, built, valid, grade })
    }

    const pad = (v, n) => String(v).padStart(n)
    // eslint-disable-next-line no-console
    console.log('\n=== C3A-CLOSE — COMPLEX PINE VISUAL PARITY SET, at HEAD ===\n'
      + '  legend  P=plot F=fill H=hline S=plotshape C=plotchar B=bgcolor'
      + ' R=barcolor K=plotcandle O=objects   (asked → carried)\n'
      + rows.map((r) => {
        const e = r.exp
        const a = r.act
        return `\n  ${r.grade.padEnd(23)} ${r.tier}  ${r.key}`
          + `\n      import=${r.built.importResult}  saveGate=${r.valid.ok ? 'ACCEPTS' : 'REFUSES'}`
          + `  outputs=${a.plots}  pane=${a.overlay ? 'price(overlay)' : 'own pane'}  params=${a.params}`
          + `\n      P ${pad(e.plot, 3)}→${pad(a.plots, 3)}   F ${pad(e.fill, 3)}→${pad(a.fills, 3)}`
          + `   H ${pad(e.hline, 3)}→${pad(a.hlines, 3)}   S ${pad(e.plotshape, 3)}→${pad(a.markers, 3)}`
          + `   C ${pad(e.plotchar, 3)}→${pad(a.markers ? '↑' : 0, 3)}`
          + `\n      B ${pad(e.bgcolor, 3)}→  0   R ${pad(e.barcolor, 3)}→  0`
          + `   K ${pad(e.plotcandle, 3)}→  0   O ${pad(e.objects, 3)}→  0`
          + `   dyn-colour ${a.dynamic}  static ${a.staticColors}`
      }).join('\n'))

    const tally = {}
    for (const r of rows) tally[r.grade] = (tally[r.grade] || 0) + 1
    // eslint-disable-next-line no-console
    console.log(`\n  ${JSON.stringify(tally)}\n`
      + `  members whose OBJECT demand is unmet: `
      + `${rows.filter((r) => r.exp.objects > 0).length}/10\n`
      + `  members drawing at least one MARKER:  `
      + `${rows.filter((r) => r.act.markers > 0).length}/10`)

    // ⛔ THE GRADE MUST DISCRIMINATE. A classifier that answered one bucket for
    // everything would be a report with no information in it, and it would pass
    // any test that only checked the tally exists.
    expect(Object.keys(tally).length).toBeGreaterThan(1)
    // ⛔ AND NOTHING IS VISUAL_FULL WHILE ITS OBJECTS ARE MISSING. This is the
    // C3B.19 rule applied to C3A's own report.
    for (const r of rows) {
      if (r.exp.objects > 0) expect(r.grade).not.toBe('VISUAL_FULL')
    }
    expect(rows).toHaveLength(10)

    // ⭐⭐ R-I's CONTROL — a known `overlay = true` script must produce a
    // PRICE-pane document, and an `overlay = false` one must not. Without it
    // `placement.target` is a column nobody checks, and the defect it replaces
    // read `undefined` for every script ever written with NOTHING going red.
    const ov = translatePine(
      ['//@version=6', 'indicator("ov", overlay = true)', 'plot(sma(close, 20))', ''].join('\n'), {})
    const sub = translatePine(
      ['//@version=6', 'indicator("sub", overlay = false)', 'plot(sma(close, 20))', ''].join('\n'), {})
    expect(ov.presentation.overlay).toBe(true)
    expect(sub.presentation.overlay).toBe(false)
    expect(placementFor(ov)).toEqual({ target: 'price' })
    expect(placementFor(sub)).toEqual({ target: 'pane' })
    // ⛔ AND THE FIELD THE DEFECT READ IS STILL A STRING — pinned, so the next
    // reader who reaches for `declaration.overlay` sees why it cannot work.
    expect(typeof ov.declaration).toBe('string')
    expect(ov.declaration.overlay).toBeUndefined()

    // ⛔ AND THE GAP IS NAMED AND STAYS RED. Three members are `local-only` in
    // `pine_oos/MANIFEST.json` and are not committed, so the published numbers
    // below cover SEVEN of ten. Re-publishing all ten is owed the moment those
    // captures land.
    const missing = rows.filter((r) => r.grade === 'SOURCE_MISSING').map((r) => r.key)
    expect(missing, `these parity members have no committed source, so the set is `
      + `measured on ${10 - missing.length} of 10:\n  ${missing.join('\n  ')}\n\n`
      + 'They are `storage: "local-only"` in tests/fixtures/pine_oos/MANIFEST.json '
      + 'and each needs a fresh capture; their sha256_source is already recorded, '
      + 'so each one is verifiable on arrival.').toEqual([])
  })
})
