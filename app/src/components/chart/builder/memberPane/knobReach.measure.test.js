// app/src/components/chart/builder/memberPane/knobReach.measure.test.js
//
// ─── H10 — DOES A PARAMETER KNOB REACH EVERY USE OF ITS INPUT? (A MEASUREMENT) ──
//
// A knob in `compute.paramManifest` is a set of locators: literals in the saved
// trees that `applyParamEdit` rewrites. The question this file answers is whether
// that set is EVERY place the input's value went. The oracle is the translator
// itself: the same script translated with the member's value as the input's value
// (`inputValues`, the path a moved `input.*` takes on TradingView) is what the
// indicator draws with that input. A knob whose edit differs from that document
// moves part of the formula and leaves the rest at the author's default - the
// half-applied knob H9 found on pivot-high-low-points' `lb`.
//
// Run on demand only (`H10_KNOB_REACH_OUT=<file>`); the product rail is
// `knobReach.test.js`, which pins the result this measures.
import { it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

import { translatePine } from '../../engine/ast/pine'
import { memberInputTranslation } from '../builderInputs'
import { applyParamEdit } from '../paramEdit'
import { memberPaneDefinition, memberTranslationOpts } from './memberPaneDefinition'
import { knobReachProbeValue, comparableDocument } from './knobReach'

const OUT = process.env.H10_KNOB_REACH_OUT
const ONLY = process.env.H10_KNOB_REACH_ONLY ? new Set(process.env.H10_KNOB_REACH_ONLY.split(',')) : null

/** Every leaf path where two JSON values differ (first 40), with both sides clipped. */
function diffs(a, b, path, out = []) {
  if (out.length >= 40 || JSON.stringify(a) === JSON.stringify(b)) return out
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])]
    for (const k of keys) diffs(a[k], b[k], [...path, k], out)
    return out
  }
  const clip = (x) => JSON.stringify(x === undefined ? null : x).slice(0, 120)
  out.push({ path: path.join('.'), edited: clip(a), oracle: clip(b) })
  return out
}
const CORPUS = path.resolve(process.cwd(), '..', 'corpus', 'committed')


it.skipIf(!OUT)('measure: every manifest knob against the re-translated oracle', () => {
  const rows = []
  for (const f of fs.readdirSync(CORPUS).sort()) {
    const slug = f.split('__')[0]
    if (ONLY && !ONLY.has(slug)) continue
    const source = fs.readFileSync(path.join(CORPUS, f), 'utf8')
    let base
    try { base = memberPaneDefinition({ source, id: 'u_h10reach' }) } catch (e) { continue }
    if (!base.ok || !base.definition) continue
    const manifest = (base.definition.compute || {}).paramManifest || {}
    for (const n of (base.notes || [])) {
      if (/is not offered as an adjustable setting here: /.test(n.note)) rows.push({ slug, name: n.name, verdict: 'locked', why: n.note.slice(0, 140) })
    }
    for (const [id, entry] of Object.entries(manifest)) {
      const v = knobReachProbeValue(entry)
      const row = { slug, id, name: entry.sourceName, def: entry.default, v, locators: entry.locators.length }
      if (v === null) { rows.push({ ...row, verdict: 'no-probe-value' }); continue }
      const edited = applyParamEdit(base.definition, id, v)
      let oracle = null
      try {
        const t = memberInputTranslation(translatePine, source, memberTranslationOpts({ [entry.sourceName]: v }))
        oracle = memberPaneDefinition({ source, id: 'u_h10reach', translation: t })
      } catch (e) { rows.push({ ...row, verdict: 'oracle-threw', why: String(e).slice(0, 120) }); continue }
      if (!oracle || !oracle.ok) { rows.push({ ...row, verdict: 'oracle-refused', why: oracle && oracle.reason }); continue }
      if (!edited.ok) { rows.push({ ...row, verdict: 'edit-refused', why: edited.error }); continue }
      const a = comparableDocument(edited.definition)
      const b = comparableDocument(oracle.definition)
      const same = JSON.stringify(a) === JSON.stringify(b)
      rows.push({ ...row, verdict: same ? 'reaches' : 'HALF', ...(same ? {} : { diff: diffs(a, b, []) }) })
    }
  }
  fs.writeFileSync(OUT, JSON.stringify(rows, null, 1))
}, 1800000)
